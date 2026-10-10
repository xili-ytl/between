@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.core.data

import java.time.Instant
import com.privatechat.couplechat.core.database.MessageEntity
import com.privatechat.couplechat.core.database.MessageLocalStore
import com.privatechat.couplechat.core.diagnostics.NoOpWenliTimingSink
import com.privatechat.couplechat.core.diagnostics.WenliTimingEvent
import com.privatechat.couplechat.core.diagnostics.WenliTimingSink
import com.privatechat.couplechat.core.image.ImageLocalCache
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.IMAGE_MESSAGE_PLACEHOLDER
import com.privatechat.couplechat.core.model.ImageMessage
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.model.ReadState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.SharingStarted
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.flow.stateIn
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.SessionManager
import com.privatechat.couplechat.core.sync.AdaptiveSyncPolicy
import com.privatechat.couplechat.core.sync.MessageArrivalSignal
import com.privatechat.couplechat.core.sync.NoOpMessageArrivalSignal
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.flatMapLatest
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withTimeoutOrNull
import kotlinx.coroutines.withTimeout
import com.privatechat.couplechat.core.network.ChatApiException

interface ChatDataSource {
    suspend fun requestWenli(sourceMessageId: String) = Unit
    val messages: Flow<List<ChatMessage>>
    val syncStatus: StateFlow<SyncStatus>
    val unreadCount: StateFlow<Int>
    val partnerReadCursor: StateFlow<MessageCursor?>
        get() = MutableStateFlow<MessageCursor?>(null)
    suspend fun markRead()
    suspend fun markMessageReadThrough(cursor: MessageCursor) = Unit
    suspend fun loadOlder(): HistoryLoadResult
    suspend fun send(clientMessageId: String, body: String, replyToMessageId: String? = null): ChatMessage
    suspend fun sendImage(
        clientMessageId: String,
        bytes: ByteArray,
        mimeType: String,
        width: Int?,
        height: Int?,
        replyToMessageId: String? = null,
        caption: String = "",
    ): ChatMessage
    suspend fun imageUrl(imageFileId: String): String
    suspend fun localImageUri(imageFileId: String): String? = null
    /** 取图片原始字节用于保存到相册；本地没有则按签名 URL 下载。 */
    suspend fun localImageBytes(imageFileId: String): ByteArray? = null
    suspend fun reveal(messageId: String): Boolean = false
    fun startForegroundSync(scope: CoroutineScope): Job
    fun stopForegroundSync()
}

data class HistoryLoadResult(
    val revealed: Int,
    val hasMore: Boolean,
)

enum class SyncStatus { SYNCING, SYNCED, OFFLINE }

class ChatRepository(
    private val api: ChatApi,
    private val local: MessageLocalStore,
    private val sessions: SessionManager,
    private val policy: AdaptiveSyncPolicy = AdaptiveSyncPolicy(),
    private val readStates: ReadStateRepository? = null,
    private val imageCache: ImageLocalCache? = null,
    private val cursorStore: SyncCursorStore = NoOpSyncCursorStore,
    private val arrivals: MessageArrivalSignal = NoOpMessageArrivalSignal,
    private val clock: () -> Instant = Instant::now,
    private val monotonicMillis: () -> Long = { System.nanoTime() / 1_000_000 },
    private val wenliTiming: WenliTimingSink = NoOpWenliTimingSink,
) : ChatDataSource {
    private val visibleLimit = MutableStateFlow(PAGE_SIZE)
    private val readStateFlow: StateFlow<ReadState> = readStates?.state ?: MutableStateFlow(ReadState())
    override val messages: Flow<List<ChatMessage>> = visibleLimit
        .flatMapLatest(local::observeLatest)
        .map { rows -> rows.map(MessageEntity::toModel) }

    override val partnerReadCursor: StateFlow<MessageCursor?> = readStateFlow
        .map { state ->
            if (state.partnerReadReceiptMessageId == null || state.partnerReadReceiptMessageCreatedAt == null) {
                null
            } else {
                MessageCursor(state.partnerReadReceiptMessageCreatedAt, state.partnerReadReceiptMessageId)
            }
        }
        .stateIn(CoroutineScope(SupervisorJob() + Dispatchers.Default), SharingStarted.Eagerly, null)

    override val unreadCount: StateFlow<Int> =
        readStateFlow.flatMapLatest { state ->
            val accountId = sessions.current()?.accountId
            val partnerId = if (accountId == "1001") "1002" else if (accountId == "1002") "1001" else null
            if (partnerId == null) flowOf(0)
            else local.observeUnreadCount(
                partnerId,
                state.lastReadMessageCreatedAt ?: "",
                state.lastReadMessageId ?: "",
            )
        }.stateIn(CoroutineScope(SupervisorJob() + Dispatchers.Default), SharingStarted.Eagerly, 0)

    private val _syncStatus = MutableStateFlow(SyncStatus.SYNCING)
    override val syncStatus: StateFlow<SyncStatus> = _syncStatus.asStateFlow()

    private var syncJob: Job? = null
    private var visibleSession: Session? = null
    @Volatile
    private var cloudHistoryExhausted = false
    private val olderFetchMutex = Mutex()
    private val latestFetchMutex = Mutex()
    private var receiveSession: Session? = null
    private var lastRecentReconcileMs: Long? = null
    // Only chat.after responses advance this cursor, never optimistic or sent rows.
    private var receiveCursor: MessageCursor? = null
    private var receiveCursorLoaded = false

    suspend fun initialSync(): Int {
        readStates?.activateCurrentSession()
        // App releases do not invalidate history. Room owns schema migrations;
        // merge server pages so cached messages remain readable while offline.
        val inserted = if (local.newest() == null) {
            fetchOlderPage().inserted
        } else {
            syncLatest()
        }
        // 与本人未读红点兼容；这不是新的对方阅读回执，不能用于显示“已读”。
        val readStore = readStates
        readStore?.syncFromCloud()
        if (readStore != null && readStore.state.value.lastReadMessageCreatedAt == null) {
            local.newest()?.let { newest -> readStore.markMessageRead(newest.id, newest.createdAt) }
        }
        return inserted
    }

    override suspend fun markRead() {
        val readStore = readStates ?: return
        val newest = local.newest() ?: return
        readStore.markMessageRead(newest.id, newest.createdAt)
        readStore.pushToCloud()
    }

    override suspend fun markMessageReadThrough(cursor: MessageCursor) {
        val captured = requireSession()
        if (!isCurrent(captured)) return
        val server = api.readStateSet(
            captured.token,
            // A bubble that was actually visible also clears the local unread
            // badge. The legacy unread cursor and the partner-visible receipt
            // describe the same observed position, but remain separate fields.
            lastReadMessageId = cursor.id,
            lastReadMessageCreatedAt = cursor.createdAt,
            lastSeenMomentAt = null,
            readReceiptMessageId = cursor.id,
            readReceiptMessageCreatedAt = cursor.createdAt,
        )
        if (isCurrent(captured)) readStates?.acceptServerState(server, captured.accountId)
    }

    suspend fun syncLatest(): Int = latestFetchMutex.withLock {
        val captured = requireSession()
        if (receiveSession != captured) {
            receiveSession = captured
            lastRecentReconcileMs = null
            receiveCursor = null
            receiveCursorLoaded = false
        }
        try {
            if (!receiveCursorLoaded) {
                // 进程重启后从落盘游标继续，避免 chat.after 从历史最早一页重新开始而留下空档。
                receiveCursor = cursorStore.load(captured.accountId)
                receiveCursorLoaded = true
            }
            val page = api.after(captured.token, receiveCursor)
            if (!isCurrent(captured)) return@withLock 0
            // 与现有增量调度共用一次轻量读取；即使本次没有新消息，也刷新对方回执。
            readStates?.syncFromCloud()
            if (!isCurrent(captured)) return@withLock 0
            var inserted = local.insertAll(page.items.map(MessageEntity::from))
            if (!isCurrent(captured)) return@withLock 0
            val advanced = page.items.lastOrNull()?.let { MessageCursor(it.createdAt, it.id) }
            if (advanced != null && advanced != receiveCursor) {
                receiveCursor = advanced
                cursorStore.save(captured.accountId, advanced)
            }
            // A concurrent cloud write can commit behind the timestamp cursor.
            // Reconcile the recent server window independently of local ordering.
            val now = monotonicMillis()
            val previous = lastRecentReconcileMs
            if (previous == null || now - previous >= RECENT_RECONCILE_INTERVAL_MS) {
                val recent = api.before(captured.token, null)
                if (!isCurrent(captured)) return@withLock 0
                inserted += local.insertAll(recent.items.map(MessageEntity::from))
                lastRecentReconcileMs = now
            }
            if (isCurrent(captured)) _syncStatus.value = SyncStatus.SYNCED
            inserted.takeIf { isCurrent(captured) } ?: 0
        } catch (_: SessionInvalidException) {
            sessions.clearIfCurrent(captured.token)
            0
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            if (isCurrent(captured)) _syncStatus.value = SyncStatus.OFFLINE
            throw error
        }
    }

    override suspend fun loadOlder(): HistoryLoadResult {
        val captured = requireSession()
        val previousLimit = visibleLimit.value
        val cachedBeforeFetch = local.count()
        if (!isCurrent(captured)) return HistoryLoadResult(0, true)
        if (cachedBeforeFetch <= previousLimit && !cloudHistoryExhausted) {
            fetchOlderPage(captured)
        }

        val available = local.count()
        if (!isCurrent(captured)) return HistoryLoadResult(0, true)
        val nextLimit = previousLimit + PAGE_SIZE
        visibleLimit.value = nextLimit
        val previouslyVisible = minOf(cachedBeforeFetch, previousLimit)
        val nowVisible = minOf(available, nextLimit)
        return HistoryLoadResult(
            revealed = (nowVisible - previouslyVisible).coerceAtLeast(0),
            hasMore = available > nextLimit || !cloudHistoryExhausted,
        )
    }

    suspend fun backfillCachedHistory(): Int {
        val captured = requireSession()
        // 历史已确认与云端一致后不再重扫；标记落盘，重启后同样跳过。
        if (cursorStore.isHistoryComplete(captured.accountId)) return 0
        var cursor: MessageCursor? = null
        var total = 0
        while (true) {
            // Walk cloud pages, not local.oldest(): old versions may have holes
            // anywhere in the cache. Merge without clearing local history.
            val page = api.before(captured.token, cursor)
            if (!isCurrent(captured)) return total
            total += local.insertAll(page.items.map(MessageEntity::from))
            if (!isCurrent(captured)) return total
            val next = page.nextCursor
            if (next == null) {
                cloudHistoryExhausted = true
                // 只有走到云端历史起点（返回空页）才能确认本机历史完整。
                if (total == 0) cursorStore.markHistoryComplete(captured.accountId)
                return total
            }
            check(next != cursor) { "History cursor did not advance" }
            cursor = next
        }
    }

    override suspend fun send(clientMessageId: String, body: String, replyToMessageId: String?): ChatMessage {
        val captured = requireSession()
        val optimistic = optimisticMessage(captured.accountId, clientMessageId, body, replyToMessageId)
        if (isCurrent(captured)) {
            local.insertAll(listOf(MessageEntity.from(optimistic)))
        }
        val timingStartedAt = if (isWenliMentionForTiming(body)) monotonicMillis() else null
        var timingOutcome = "failure"
        return try {
            val message = api.send(captured.token, clientMessageId, body, replyToMessageId)
            if (isCurrent(captured)) {
                // Replace the local optimistic row with the server-confirmed timestamp.
                // Read receipts must never submit a client clock value as proof.
                local.deleteById(optimistic.id)
                local.insertAll(listOf(MessageEntity.from(message)))
            } else {
                local.deleteById(optimistic.id)
            }
            timingOutcome = "success"
            message
        } catch (error: CancellationException) {
            local.deleteById(optimistic.id)
            throw error
        } catch (error: SessionInvalidException) {
            sessions.clearIfCurrent(captured.token)
            local.deleteById(optimistic.id)
            throw error
        } catch (error: Throwable) {
            local.deleteById(optimistic.id)
            throw error
        } finally {
            recordWenliTiming(timingStartedAt, optimistic.id, "message_confirmation", timingOutcome)
        }
    }

    override suspend fun sendImage(
        clientMessageId: String,
        bytes: ByteArray,
        mimeType: String,
        width: Int?,
        height: Int?,
        replyToMessageId: String?,
        caption: String,
    ): ChatMessage {
        val captured = requireSession()
        val body = caption.trim().takeIf(String::isNotEmpty) ?: IMAGE_MESSAGE_PLACEHOLDER
        return try {
            val credential = api.requestImageUploadCredential(captured.token, clientMessageId, mimeType)
            api.uploadImage(credential, bytes, mimeType)
            val message = api.send(
                captured.token,
                clientMessageId,
                body,
                replyToMessageId,
                ImageMessage(credential.fileId, mimeType, width, height),
            )
            if (isCurrent(captured)) local.insertAll(listOf(MessageEntity.from(message)))
            message
        } catch (error: SessionInvalidException) {
            sessions.clearIfCurrent(captured.token)
            throw error
        }
    }

    override suspend fun imageUrl(imageFileId: String): String {
        val captured = requireSession()
        return api.imageUrl(captured.token, imageFileId)
    }

    /**
     * 图片显示路径：优先返回本地文件 URI（`filesDir/images`），本地没有才下载并落盘。
     * 已看过的图片永远本地秒开，不依赖签名 URL（会过期）或 Coil 磁盘命中。
     */
    override suspend fun localImageUri(imageFileId: String): String? {
        val cache = imageCache
        if (cache == null) {
            // 测试/降级：无本地缓存时直接返回签名 URL。
            return runCatching { api.imageUrl(requireSession().token, imageFileId) }.getOrNull()
        }
        cache.get(imageFileId)?.let { return it.toURI().toString() }
        val url = runCatching { api.imageUrl(requireSession().token, imageFileId) }.getOrNull() ?: return null
        return runCatching { cache.ensure(imageFileId, url) }.getOrNull()?.toURI()?.toString() ?: url
    }

    override suspend fun localImageBytes(imageFileId: String): ByteArray? {
        val cache = imageCache
        if (cache == null) {
            val url = runCatching { api.imageUrl(requireSession().token, imageFileId) }.getOrNull() ?: return null
            return runCatching { java.net.URL(url).openStream().use { it.readBytes() } }.getOrNull()
        }
        cache.bytes(imageFileId)?.let { return it }
        val url = runCatching { api.imageUrl(requireSession().token, imageFileId) }.getOrNull() ?: return null
        val file = runCatching { cache.ensure(imageFileId, url) }.getOrNull() ?: return null
        return runCatching { file.readBytes() }.getOrNull()
    }

    override suspend fun reveal(messageId: String): Boolean {
        val required = local.visibleCountThrough(messageId)
        if (required <= 0) return false
        if (required > visibleLimit.value) visibleLimit.value = required
        return true
    }

    override fun startForegroundSync(scope: CoroutineScope): Job {
        syncJob?.cancel()
        return scope.launch {
            var idlePolls = 0
            val currentSession = sessions.current()
            if (currentSession != null) launch { sweepWenliWhileForeground(currentSession) }
            if (currentSession != visibleSession) {
                visibleLimit.value = PAGE_SIZE
                cloudHistoryExhausted = false
                visibleSession = currentSession
            }
            _syncStatus.value = SyncStatus.SYNCING
            // 先开始监听推送唤醒信号，避免启动瞬间到达的信号被丢掉。
            launch { arrivals.arrivals.collect { } }
            attempt { initialSync() }
            launch { backfillWithRetry() }
            while (isActive) {
                // 推送自定义消息到达时立刻同步，其余时间按自适应间隔轮询。
                withTimeoutOrNull(policy.nextDelay(idlePolls)) {
                    arrivals.arrivals.first()
                }
                val inserted = attempt { syncLatest() }
                idlePolls = if (inserted > 0) 0 else (idlePolls + 1).coerceAtMost(100)
            }
        }.also { syncJob = it }
    }

    override fun stopForegroundSync() {
        syncJob?.cancel()
        syncJob = null
    }

    private suspend fun backfillWithRetry() {
        while (currentCoroutineContext().isActive) {
            try {
                backfillCachedHistory()
                val captured = sessions.current() ?: return
                // 历史确认完整后彻底结束重扫循环，不再周期性遍历云端历史。
                if (cursorStore.isHistoryComplete(captured.accountId)) return
                // Also recover unusually late commits outside the recent window
                // without requiring either person to reopen the conversation.
                delay(HISTORY_RECONCILE_DELAY_MS)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                delay(BACKFILL_RETRY_DELAY_MS)
            }
        }
    }

    override suspend fun requestWenli(sourceMessageId: String) {
        val captured = requireSession()
        if (!sourceMessageId.startsWith("${captured.accountId}_")) return
        try {
            measureWenliStage(sourceMessageId, "kick_request", requestCount = 1) {
                withTimeout(60_000L) { api.kickWenli(captured.token, sourceMessageId) }
            }
            if (isCurrent(captured)) {
                measureWenliStage(sourceMessageId, "client_receive") { attempt { syncLatest() } }
            }
        } catch (error: SessionInvalidException) {
            sessions.clearIfCurrent(captured.token)
        }
    }

    private suspend fun <T> measureWenliStage(
        requestId: String,
        stage: String,
        requestCount: Int = 0,
        operation: suspend () -> T,
    ): T {
        if (!SAFE_WENLI_TIMING_ID.matches(requestId)) return operation()
        val startedAt = monotonicMillis()
        var outcome = "failure"
        return try {
            val value = operation()
            outcome = "success"
            value
        } finally {
            recordWenliTiming(startedAt, requestId, stage, outcome, requestCount)
        }
    }

    private fun recordWenliTiming(
        startedAt: Long?,
        requestId: String,
        stage: String,
        outcome: String,
        requestCount: Int = 0,
    ) {
        if (startedAt == null || !SAFE_WENLI_TIMING_ID.matches(requestId) || !SAFE_WENLI_TIMING_STAGE.matches(stage)) return
        try {
            wenliTiming.record(
                WenliTimingEvent(
                    requestId = requestId,
                    stage = stage,
                    durationMs = (monotonicMillis() - startedAt).coerceAtLeast(0),
                    requestCount = requestCount.coerceAtLeast(0),
                    outcome = outcome,
                ),
            )
        } catch (_: Throwable) {
            // Diagnostics must never change the chat or Wenli request path.
        }
    }

    private suspend fun sweepWenliWhileForeground(captured: Session) {
        while (currentCoroutineContext().isActive && isCurrent(captured)) {
            var waitMs = 45_000L
            try {
                val result = withTimeout(60_000L) { api.sweepWenli(captured.token, 1) }
                if (!isCurrent(captured)) return
                if (result.processed > 0) attempt { syncLatest() }
                else waitMs = 300_000L
            } catch (error: SessionInvalidException) {
                sessions.clearIfCurrent(captured.token)
                return
            } catch (error: kotlinx.coroutines.TimeoutCancellationException) {
                // The next foreground sweep recovers the durable server job.
            } catch (error: CancellationException) {
                throw error
            } catch (error: ChatApiException) {
                if (error.code == "WENLI_UNAVAILABLE") waitMs = 300_000L
            } catch (_: Exception) {
                // Companion failures must not stop ordinary message synchronization.
            }
            delay(waitMs)
        }
    }

    private suspend fun fetchOlderPage(captured: Session = requireSession()): OlderFetchResult = olderFetchMutex.withLock {
        if (!isCurrent(captured)) return@withLock OlderFetchResult(0, true)
        try {
            val cursor = local.oldest()?.cursor()
            if (!isCurrent(captured)) return@withLock OlderFetchResult(0, true)
            val page = api.before(captured.token, cursor)
            if (!isCurrent(captured)) return@withLock OlderFetchResult(0, true)
            val inserted = local.insertAll(page.items.map(MessageEntity::from))
            if (isCurrent(captured)) _syncStatus.value = SyncStatus.SYNCED
            OlderFetchResult(
                inserted = inserted.takeIf { isCurrent(captured) } ?: 0,
                exhausted = page.nextCursor == null,
            ).also { result ->
                if (isCurrent(captured)) cloudHistoryExhausted = result.exhausted
            }
        } catch (_: SessionInvalidException) {
            sessions.clearIfCurrent(captured.token)
            // An authentication failure says nothing about the end of history.
            OlderFetchResult(inserted = 0, exhausted = true)
        } catch (error: CancellationException) {
            throw error
        } catch (error: Throwable) {
            if (isCurrent(captured)) _syncStatus.value = SyncStatus.OFFLINE
            throw error
        }
    }

    private fun requireSession(): Session = sessions.current() ?: throw SessionInvalidException()

    private fun isCurrent(captured: Session): Boolean = sessions.current() == captured

    private fun optimisticMessage(
        senderId: String,
        clientMessageId: String,
        body: String,
        replyToMessageId: String?,
    ): ChatMessage = ChatMessage(
        id = "${senderId}_$clientMessageId",
        relationshipId = "couple",
        senderId = senderId,
        recipientId = if (senderId == "1001") "1002" else "1001",
        clientMessageId = clientMessageId,
        body = body,
        createdAt = clock().toString(),
        replyToMessageId = replyToMessageId,
    )

    private suspend fun attempt(block: suspend () -> Int): Int = try {
        block()
    } catch (error: CancellationException) {
        throw error
    } catch (_: Throwable) {
        0
    }

    private companion object {
        const val PAGE_SIZE = 50
        const val BACKFILL_RETRY_DELAY_MS = 5_000L
        const val RECENT_RECONCILE_INTERVAL_MS = 60_000L
        const val HISTORY_RECONCILE_DELAY_MS = 300_000L
        val SAFE_WENLI_TIMING_ID = Regex("[A-Za-z0-9_-]{1,200}")
        val SAFE_WENLI_TIMING_STAGE = Regex("[a-z_]{1,64}")

        fun isWenliMentionForTiming(body: String): Boolean = body.trimStart().startsWith("@问理")
    }
}

private data class OlderFetchResult(val inserted: Int, val exhausted: Boolean)

private fun MessageEntity.cursor() = MessageCursor(createdAt, id)
