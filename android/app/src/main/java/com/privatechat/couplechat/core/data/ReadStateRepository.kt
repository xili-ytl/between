package com.privatechat.couplechat.core.data

import android.content.Context
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.model.ReadState
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.session.SessionManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * 已读状态（消息游标 + 朋友圈已读时间）。本地持久化 + 云端同步（云端为准，单调向前）。
 */
class ReadStateRepository(
    private val api: ChatApi,
    private val sessions: SessionManager,
    context: Context,
    private val onServerConfirmedRead: suspend (String, MessageCursor) -> Boolean = { _, _ -> true },
) {
    private val prefs = context.getSharedPreferences("read-state", Context.MODE_PRIVATE)
    private val stateLock = Any()
    private var activeAccountId: String? = null
    private val _state = MutableStateFlow(ReadState())
    val state: StateFlow<ReadState> = _state.asStateFlow()
    private var publishedNotificationReadCursor: MessageCursor? = null

    /** 会话切换时先装载该账号自己的缓存，避免两个固定账号共享旧版无账号前缀的状态。 */
    fun activateCurrentSession() {
        val accountId = sessions.current()?.accountId ?: return
        synchronized(stateLock) {
            if (activeAccountId == accountId) return
            activeAccountId = accountId
            publishedNotificationReadCursor = null
            _state.value = loadFromPrefs(accountId)
        }
    }

    /** 标记已读到某条消息（单调向前，不回退）。 */
    fun markMessageRead(messageId: String, createdAt: String) {
        val accountId = accountForCurrentSession() ?: return
        val current = _state.value
        if (
            current.lastReadMessageCreatedAt != null &&
            compareCursors(
                MessageCursor(createdAt, messageId),
                MessageCursor(current.lastReadMessageCreatedAt, current.lastReadMessageId.orEmpty()),
            ) <= 0
        ) return
        _state.update { it.copy(lastReadMessageId = messageId, lastReadMessageCreatedAt = createdAt) }
        persist(accountId)
    }

    /** 标记朋友圈已看到某时间点（单调向前，不回退）。 */
    fun markMomentsSeen(createdAt: String) {
        val accountId = accountForCurrentSession() ?: return
        val current = _state.value
        if (current.lastSeenMomentAt != null && createdAt < current.lastSeenMomentAt) return
        _state.update { it.copy(lastSeenMomentAt = createdAt) }
        persist(accountId)
    }

    /** 从云端拉取已读状态；云端若更新则采用（不回退本地更前的位置）。 */
    suspend fun syncFromCloud() {
        val captured = sessions.current() ?: return
        activateCurrentSession()
        val cloud = runCatching { api.readStateGet(captured.token) }.getOrNull() ?: return
        if (sessions.current() != captured) return
        acceptServerState(cloud, captured.accountId)
    }

    /** 把本地已读状态推送到云端（失败不影响本地，云端以单调校验拒绝回退）。 */
    suspend fun pushToCloud() {
        val captured = sessions.current() ?: return
        accountForCurrentSession() ?: return
        val s = _state.value
        runCatching {
            api.readStateSet(
                captured.token,
                s.lastReadMessageId,
                s.lastReadMessageCreatedAt,
                s.lastSeenMomentAt,
            )
        }
    }

    /** 只接受当前会话返回的服务器状态；对方回执绝不由本地时间或旧红点推导。 */
    suspend fun acceptServerState(server: ReadState, accountId: String) {
        if (sessions.current()?.accountId != accountId) return
        activateCurrentSession()
        val merged = mergeReadState(_state.value, server, accountId)
        _state.value = merged
        persist(accountId)
        val confirmed = merged.readReceiptMessageId?.let { id ->
            merged.readReceiptMessageCreatedAt?.let { createdAt -> MessageCursor(createdAt, id) }
        }
        if (confirmed != null && (publishedNotificationReadCursor == null || confirmed.isAfter(publishedNotificationReadCursor))) {
            if (onServerConfirmedRead(accountId, confirmed)) publishedNotificationReadCursor = confirmed
        }
    }

    private fun accountForCurrentSession(): String? {
        activateCurrentSession()
        return sessions.current()?.accountId
    }

    private fun loadFromPrefs(accountId: String): ReadState {
        val prefix = "$accountId."
        return ReadState(
            accountId = accountId,
            lastReadMessageId = prefs.getString(prefix + "lastReadMessageId", null),
            lastReadMessageCreatedAt = prefs.getString(prefix + "lastReadMessageCreatedAt", null),
            readReceiptMessageId = prefs.getString(prefix + "readReceiptMessageId", null),
            readReceiptMessageCreatedAt = prefs.getString(prefix + "readReceiptMessageCreatedAt", null),
            partnerReadReceiptMessageId = prefs.getString(prefix + "partnerReadReceiptMessageId", null),
            partnerReadReceiptMessageCreatedAt = prefs.getString(prefix + "partnerReadReceiptMessageCreatedAt", null),
            lastSeenMomentAt = prefs.getString(prefix + "lastSeenMomentAt", null),
        )
    }

    private fun persist(accountId: String) {
        val s = _state.value
        val prefix = "$accountId."
        prefs.edit()
            .putString(prefix + "lastReadMessageId", s.lastReadMessageId)
            .putString(prefix + "lastReadMessageCreatedAt", s.lastReadMessageCreatedAt)
            .putString(prefix + "readReceiptMessageId", s.readReceiptMessageId)
            .putString(prefix + "readReceiptMessageCreatedAt", s.readReceiptMessageCreatedAt)
            .putString(prefix + "partnerReadReceiptMessageId", s.partnerReadReceiptMessageId)
            .putString(prefix + "partnerReadReceiptMessageCreatedAt", s.partnerReadReceiptMessageCreatedAt)
            .putString(prefix + "lastSeenMomentAt", s.lastSeenMomentAt)
            .apply()
    }

    private fun compareCursors(a: MessageCursor, b: MessageCursor): Int =
        a.createdAt.compareTo(b.createdAt).takeIf { it != 0 } ?: a.id.compareTo(b.id)

    private fun MessageCursor.isAfter(other: MessageCursor?): Boolean =
        other == null || compareCursors(this, other) > 0
}

/**
 * Merge a cloud snapshot without moving any cursor backwards.
 *
 * The current account's confirmed receipt is also proof that the same account has already viewed
 * that message. Older clients kept that cursor separate from the legacy unread cursor, so upgrades
 * must bridge it here. A partner receipt describes what the other person saw and is never eligible.
 */
internal fun mergeReadState(current: ReadState, server: ReadState, accountId: String): ReadState {
    val ownReceipt = latestCursor(
        current.readReceiptMessageCreatedAt.cursorWith(current.readReceiptMessageId),
        server.readReceiptMessageCreatedAt.cursorWith(server.readReceiptMessageId),
    )
    val legacyUnread = latestCursor(
        current.lastReadMessageCreatedAt.cursorWith(current.lastReadMessageId),
        server.lastReadMessageCreatedAt.cursorWith(server.lastReadMessageId),
        ownReceipt,
    )
    val partnerReceipt = latestCursor(
        current.partnerReadReceiptMessageCreatedAt.cursorWith(current.partnerReadReceiptMessageId),
        server.partnerReadReceiptMessageCreatedAt.cursorWith(server.partnerReadReceiptMessageId),
    )
    return current.copy(
        accountId = accountId,
        lastReadMessageId = legacyUnread?.id,
        lastReadMessageCreatedAt = legacyUnread?.createdAt,
        readReceiptMessageId = ownReceipt?.id,
        readReceiptMessageCreatedAt = ownReceipt?.createdAt,
        partnerReadReceiptMessageId = partnerReceipt?.id,
        partnerReadReceiptMessageCreatedAt = partnerReceipt?.createdAt,
        lastSeenMomentAt = listOfNotNull(current.lastSeenMomentAt, server.lastSeenMomentAt).maxOrNull(),
    )
}

private fun String?.cursorWith(id: String?): MessageCursor? =
    if (this == null || id == null) null else MessageCursor(this, id)

private fun latestCursor(vararg cursors: MessageCursor?): MessageCursor? =
    cursors.filterNotNull().maxWithOrNull(compareBy<MessageCursor> { it.createdAt }.thenBy { it.id })
