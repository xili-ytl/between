package com.privatechat.couplechat.feature.chat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.privatechat.couplechat.core.data.ChatDataSource
import com.privatechat.couplechat.core.model.IMAGE_MESSAGE_PLACEHOLDER
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.isActive
import kotlinx.coroutines.Job
import kotlinx.coroutines.CoroutineStart
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.MessageCursor

class ChatViewModel(
    private val source: ChatDataSource,
    private val newClientMessageId: () -> String = { UUID.randomUUID().toString() },
) : ViewModel() {
    private val _state = MutableStateFlow(ChatState())
    val state: StateFlow<ChatState> = _state.asStateFlow()
    private var inputRevision = 0L
    private var quoteRevision = 0L
    private val wenliRequests = mutableMapOf<String, Job>()
    private var foreground = true
    private var chatReadVisible = false
    private var pendingReadCursor: MessageCursor? = null
    private var lastSubmittedReadCursor: MessageCursor? = null
    private var readReceiptJob: Job? = null

    init {
        viewModelScope.launch {
            source.messages.collect { messages ->
                // 小Q的回复已经到达时，熄灭对应的「回复中」。
                //
                // 原来这个标记只在 requestWenli（wenli.kick）返回时清除；执行放在本机 Opus 之后，
                // kick 只是"排了个队"就返回，标记会瞬间消失，而回复还要几十秒才写入，
                // 看起来像"卡住了"。改为按回复消息本身判断：有 replyToMessageId 指向它，就算已回复。
                val answered = messages
                    .asSequence()
                    .filter { it.senderId == "wenli" }
                    .mapNotNull { it.replyToMessageId }
                    .toSet()
                _state.update { current ->
                    current.copy(
                        messages = messages,
                        wenliPendingIds = if (answered.isEmpty()) {
                            current.wenliPendingIds
                        } else {
                            current.wenliPendingIds - answered
                        },
                    )
                }
            }
        }
        viewModelScope.launch {
            source.syncStatus.collect { status -> _state.update { it.copy(syncStatus = status) } }
        }
        viewModelScope.launch {
            source.unreadCount.collect { count -> _state.update { it.copy(unreadCount = count) } }
        }
        viewModelScope.launch {
            source.partnerReadCursor.collect { cursor -> _state.update { it.copy(partnerReadCursor = cursor) } }
        }
    }

    fun markRead() {
        viewModelScope.launch {
            runCatching { source.markRead() }
        }
    }

    /** 保留首帧已经可见的位置；路由进入 RESUMED 后才真正提交。 */
    fun onMessageVisible(cursor: MessageCursor) {
        if (!cursor.isAfter(lastSubmittedReadCursor)) return
        if (pendingReadCursor == null || cursor.isAfter(pendingReadCursor)) pendingReadCursor = cursor
        if (chatReadVisible) scheduleReadReceipt()
    }

    fun onChatReadVisibilityChanged(visible: Boolean) {
        chatReadVisible = visible
        // Navigation must not cancel a position the user has already viewed.
        // Only already viewed positions can drain while hidden; no background polling.
        if (visible) scheduleReadReceipt()
    }

    fun setInput(value: String) {
        if (value != _state.value.input) inputRevision += 1
        _state.update {
            it.copy(
                input = value,
                error = null,
                failedClientMessageId = if (value == it.input) it.failedClientMessageId else null,
            )
        }
    }

    fun send() {
        submit(_state.value.failedClientMessageId ?: newClientMessageId())
    }

    fun quote(message: com.privatechat.couplechat.core.model.ChatMessage) {
        if (_state.value.quotedMessage?.id != message.id) quoteRevision += 1
        _state.update { it.copy(quotedMessage = message) }
    }

    fun cancelQuote() {
        if (_state.value.quotedMessage != null) quoteRevision += 1
        _state.update { it.copy(quotedMessage = null) }
    }

    fun retry() {
        val pendingImage = _state.value.failedImage
        if (pendingImage != null) {
            sendImageInternal(
                pendingImage.bytes,
                pendingImage.mimeType,
                pendingImage.width,
                pendingImage.height,
                pendingImage.clientMessageId,
                pendingImage.replyToMessageId,
                pendingImage.caption,
                pendingImage.draftSnapshot,
                pendingImage.inputRevision,
                pendingImage.quoteRevision,
                pendingImage.replyToMessageId,
            )
        } else {
            _state.value.failedClientMessageId?.let(::submit)
        }
    }

    /**
     * 选好图片后只进入待确认状态，不直接发送。
     * 用户在预览里确认后才由 [confirmPendingImage] 真正发出，避免误发。
     */
    fun selectImage(
        bytes: ByteArray,
        mimeType: String,
        width: Int,
        height: Int,
        clientMessageId: String = newClientMessageId(),
    ) {
        _state.update {
            it.copy(
                pendingImage = PendingImageMessage(
                    clientMessageId = clientMessageId,
                    bytes = bytes,
                    mimeType = mimeType,
                    width = width,
                    height = height,
                    replyToMessageId = it.quotedMessage?.id,
                    caption = it.input,
                    draftSnapshot = it.input,
                    inputRevision = inputRevision,
                    quoteRevision = quoteRevision,
                ),
                error = null,
            )
        }
    }

    fun cancelPendingImage() {
        _state.update { it.copy(pendingImage = null, error = null) }
    }

    fun setPendingImageCaption(value: String) {
        _state.update { state ->
            state.pendingImage?.let { pending ->
                state.copy(pendingImage = pending.copy(caption = value), error = null)
            } ?: state
        }
    }

    fun confirmPendingImage() {
        val current = _state.value
        if (current.sending) return
        val pending = current.pendingImage ?: return
        val caption = normalizeImageCaption(pending.caption)
        if (caption == null) {
            _state.update { it.copy(error = "说明不能超过 2000 个字符") }
            return
        }
        _state.update { state ->
            if (state.pendingImage?.clientMessageId == pending.clientMessageId) {
                state.copy(pendingImage = null, error = null)
            } else {
                state
            }
        }
        sendImageInternal(
            pending.bytes,
            pending.mimeType,
            pending.width,
            pending.height,
            pending.clientMessageId,
            pending.replyToMessageId,
            caption,
            pending.draftSnapshot,
            pending.inputRevision,
            pending.quoteRevision,
            pending.replyToMessageId,
        )
    }

    fun sendImage(
        bytes: ByteArray,
        mimeType: String,
        width: Int,
        height: Int,
        clientMessageId: String = newClientMessageId(),
        replyToMessageId: String? = null,
        caption: String = "",
    ) {
        val current = _state.value
        if (current.sending) return
        val normalizedCaption = normalizeImageCaption(caption)
        if (normalizedCaption == null) {
            _state.update { it.copy(error = "说明不能超过 2000 个字符") }
            return
        }
        val quotedMessageId = current.quotedMessage?.id
        val replyTo = replyToMessageId ?: quotedMessageId
        sendImageInternal(
            bytes,
            mimeType,
            width,
            height,
            clientMessageId,
            replyTo,
            normalizedCaption,
            draftSnapshot = null,
            inputRevisionAtStart = inputRevision,
            quoteRevisionAtStart = quoteRevision,
            quoteToClear = quotedMessageId,
        )
    }

    private fun sendImageInternal(
        bytes: ByteArray,
        mimeType: String,
        width: Int,
        height: Int,
        clientMessageId: String,
        replyToMessageId: String?,
        caption: String,
        draftSnapshot: String?,
        inputRevisionAtStart: Long,
        quoteRevisionAtStart: Long,
        quoteToClear: String?,
    ) {
        if (_state.value.sending) return
        _state.update {
            it.copy(
                sending = true,
                error = null,
                failedImage = null,
                pendingClientMessageIds = it.pendingClientMessageIds + clientMessageId,
            )
        }
        viewModelScope.launch {
            try {
                val saved = source.sendImage(
                    clientMessageId,
                    bytes,
                    mimeType,
                    width,
                    height,
                    replyToMessageId,
                    caption,
                )
                _state.update { state ->
                    val clearDraft = draftSnapshot != null &&
                        inputRevision == inputRevisionAtStart &&
                        state.input == draftSnapshot
                    val clearQuote = quoteRevision == quoteRevisionAtStart &&
                        state.quotedMessage?.id == quoteToClear
                    state.copy(
                        sending = false,
                        failedImage = null,
                        error = null,
                        pendingClientMessageIds = state.pendingClientMessageIds - clientMessageId,
                        input = if (clearDraft) "" else state.input,
                        quotedMessage = if (clearQuote) null else state.quotedMessage,
                    )
                }
                launchWenli(saved)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.update {
                    it.copy(
                        sending = false,
                        failedImage = PendingImageMessage(
                            clientMessageId = clientMessageId,
                            bytes = bytes,
                            mimeType = mimeType,
                            width = width,
                            height = height,
                            replyToMessageId = replyToMessageId,
                            caption = caption,
                            draftSnapshot = draftSnapshot,
                            inputRevision = inputRevisionAtStart,
                            quoteRevision = quoteRevisionAtStart,
                        ),
                        error = "图片发送失败，可重试",
                        pendingClientMessageIds = it.pendingClientMessageIds - clientMessageId,
                    )
                }
            }
        }
    }

    fun showError(message: String) {
        _state.update { it.copy(error = message) }
    }

    fun clearError() {
        _state.update { it.copy(error = null) }
    }

    suspend fun resolveImageUrl(imageFileId: String): String? =
        runCatching { source.localImageUri(imageFileId) }.getOrNull()

    suspend fun resolveImageBytes(imageFileId: String): ByteArray? =
        runCatching { source.localImageBytes(imageFileId) }.getOrNull()

    fun loadOlder() {
        if (_state.value.loadingOlder || !_state.value.hasMoreHistory) return
        _state.update { it.copy(loadingOlder = true) }
        viewModelScope.launch {
            try {
                val result = source.loadOlder()
                _state.update { state -> state.copy(hasMoreHistory = result.hasMore) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.update { state -> state.copy(error = "暂时无法加载更早消息") }
            } finally {
                _state.update { it.copy(loadingOlder = false) }
            }
        }
    }

    fun focusMessage(messageId: String) {
        viewModelScope.launch {
            try {
                if (source.reveal(messageId)) {
                    _state.update { it.copy(focusedMessageId = messageId, error = null) }
                } else {
                    _state.update { it.copy(error = "未找到这条消息") }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.update { it.copy(error = "暂时无法打开这条消息") }
            }
        }
    }

    fun consumeFocus() {
        _state.update { it.copy(focusedMessageId = null) }
    }

    fun onForeground() {
        foreground = true
        source.startForegroundSync(viewModelScope)
    }

    fun onBackground() {
        foreground = false
        source.stopForegroundSync()
        wenliRequests.values.toList().forEach { it.cancel() }
    }

    override fun onCleared() {
        readReceiptJob?.cancel()
        source.stopForegroundSync()
    }

    private fun submit(clientMessageId: String) {
        val current = _state.value
        if (current.sending) return
        val body = current.input.trim()
        when {
            body.isEmpty() -> {
                _state.update { it.copy(error = "请输入消息") }
                return
            }
            body.codePoints().count() > 2000 -> {
                _state.update { it.copy(error = "消息不能超过 2000 个字符") }
                return
            }
        }

        val quoted = current.quotedMessage
        val inputRevisionAtStart = inputRevision
        val quoteRevisionAtStart = quoteRevision
        _state.update {
            it.copy(
                input = "",
                quotedMessage = null,
                sending = true,
                error = null,
                failedClientMessageId = null,
                pendingClientMessageIds = it.pendingClientMessageIds + clientMessageId,
            )
        }
        viewModelScope.launch {
            try {
                val saved = source.send(clientMessageId, body, quoted?.id)
                _state.update {
                    it.copy(
                        sending = false,
                        failedClientMessageId = null,
                        error = null,
                        pendingClientMessageIds = it.pendingClientMessageIds - clientMessageId,
                    )
                }
                launchWenli(saved)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.update {
                    val restoreRequest =
                        inputRevision == inputRevisionAtStart && quoteRevision == quoteRevisionAtStart
                    it.copy(
                        sending = false,
                        input = if (restoreRequest) body else it.input,
                        quotedMessage = if (restoreRequest) quoted else it.quotedMessage,
                        failedClientMessageId = if (restoreRequest) clientMessageId else null,
                        error = if (restoreRequest) "发送失败，消息仍在输入框中" else "发送失败，新草稿已保留",
                        pendingClientMessageIds = it.pendingClientMessageIds - clientMessageId,
                    )
                }
            }
        }
    }

    private fun normalizeImageCaption(value: String): String? {
        val trimmed = value.trim()
        return trimmed.takeIf { it.codePoints().count() <= 2000 }
    }

    private fun launchWenli(message: ChatMessage) {
        if (!foreground || wenliRequests.size >= 2 || message.senderId !in setOf("1001", "1002") ||
            !isWenliMentionBody(message.body) ||
            wenliRequests.containsKey(message.id)) return
        val job = viewModelScope.launch(start = CoroutineStart.LAZY) {
            _state.update { it.copy(wenliPendingIds = it.wenliPendingIds + message.id) }
            try {
                source.requestWenli(message.id)
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Sending already succeeded; foreground recovery handles failed kicks.
            } finally {
                wenliRequests.remove(message.id)
                _state.update { it.copy(wenliPendingIds = it.wenliPendingIds - message.id) }
            }
        }
        wenliRequests[message.id] = job
        job.start()
    }

    private fun scheduleReadReceipt() {
        if (!chatReadVisible || pendingReadCursor == null || readReceiptJob?.isActive == true) return
        readReceiptJob = viewModelScope.launch {
            // 连续滚动只保留最后一个可见位置，最多约每秒一次网络写入。
            kotlinx.coroutines.delay(1_000L)
            while (isActive) {
                val target = pendingReadCursor ?: return@launch
                if (!target.isAfter(lastSubmittedReadCursor)) {
                    pendingReadCursor = null
                    return@launch
                }
                try {
                    source.markMessageReadThrough(target)
                    lastSubmittedReadCursor = target
                    if (pendingReadCursor == target) pendingReadCursor = null
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Exception) {
                    // 未成功得到服务端确认时保留待提交位置，回到前台后继续补交。
                    if (!chatReadVisible) return@launch
                    kotlinx.coroutines.delay(5_000L)
                    if (!chatReadVisible) return@launch
                    continue
                }
                if (pendingReadCursor == null) return@launch
            }
        }
    }
}

private fun MessageCursor.isAfter(other: MessageCursor?): Boolean =
    other == null || createdAt > other.createdAt || (createdAt == other.createdAt && id > other.id)
