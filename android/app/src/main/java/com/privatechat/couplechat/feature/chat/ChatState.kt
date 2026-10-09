package com.privatechat.couplechat.feature.chat

import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.data.SyncStatus

data class ChatState(
    val wenliPendingIds: Set<String> = emptySet(),
    val messages: List<ChatMessage> = emptyList(),
    val input: String = "",
    val quotedMessage: ChatMessage? = null,
    val focusedMessageId: String? = null,
    val sending: Boolean = false,
    val loadingOlder: Boolean = false,
    val hasMoreHistory: Boolean = true,
    val error: String? = null,
    val failedClientMessageId: String? = null,
    val failedImage: PendingImageMessage? = null,
    /** 已选好但尚未发送的图片：先给用户看预览，确认后才真正发送。 */
    val pendingImage: PendingImageMessage? = null,
    val unreadCount: Int = 0,
    val syncStatus: SyncStatus = SyncStatus.SYNCING,
    /** 服务端确认的对方阅读位置；缺失时不显示已读。 */
    val partnerReadCursor: MessageCursor? = null,
    /** 仅用于保留现有发送中状态，不把本地乐观行误标为已发送。 */
    val pendingClientMessageIds: Set<String> = emptySet(),
)

data class PendingImageMessage(
    val clientMessageId: String,
    val bytes: ByteArray,
    val mimeType: String,
    val width: Int,
    val height: Int,
    val replyToMessageId: String? = null,
    /** The editable caption kept with the image for confirmation and retries. */
    val caption: String = "",
    /** The composer draft that selecting this image captured. */
    val draftSnapshot: String? = null,
    /** Draft/quote revisions let completion avoid clearing newer user input. */
    val inputRevision: Long = 0L,
    val quoteRevision: Long = 0L,
)
