package com.privatechat.couplechat.core.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable

@Serializable
data class Session(
    val accountId: String,
    val displayName: String,
    @SerialName("sessionToken") val token: String,
    val sessionVersion: Int,
)

@Serializable
data class Profile(
    val accountId: String,
    val displayName: String,
    val gender: String,
    val avatarUrl: String? = null,
    val updatedAt: String,
)

@Serializable
enum class MomentVisibility {
    PARTNER,
    SELF,
}

@Serializable
data class MomentLike(
    val id: String,
    val momentId: String,
    val accountId: String,
    val createdAt: String,
)

@Serializable
data class MomentComment(
    val id: String,
    val momentId: String,
    val authorId: String,
    val clientCommentId: String,
    val body: String,
    val replyToCommentId: String? = null,
    val createdAt: String,
)

@Serializable
data class MomentItem(
    val id: String,
    val authorId: String,
    val clientMomentId: String,
    val body: String,
    val visibility: MomentVisibility,
    val imageFileId: String? = null,
    val imageMimeType: String? = null,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
    val createdAt: String,
    val likes: List<MomentLike>,
    val comments: List<MomentComment>,
)

@Serializable
data class ChatMessage(
    val id: String,
    val relationshipId: String,
    val senderId: String,
    val recipientId: String,
    val clientMessageId: String,
    val body: String,
    val createdAt: String,
    val replyToMessageId: String? = null,
    val type: String = "text",
    val imageFileId: String? = null,
    val imageMimeType: String? = null,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
)

/** 图片消息的 body 占位文案：旧版本无法显示图片时回退为此文本。 */
const val IMAGE_MESSAGE_PLACEHOLDER = "[该消息新版本可见]"

@Serializable
data class ImageMessage(
    val imageFileId: String,
    val imageMimeType: String,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
)

@Serializable
data class ImageUploadCredential(
    val uploadUrl: String,
    val authorization: String,
    val token: String,
    val cosFileId: String,
    val key: String,
    val fileId: String,
)

@Serializable
data class MessageCursor(
    val createdAt: String,
    val id: String,
)

@Serializable
data class MessagePage(
    val items: List<ChatMessage>,
    val nextCursor: MessageCursor? = null,
)

@Serializable
data class WenliKickResult(
    val processed: Boolean,
    val messageId: String? = null,
)

@Serializable
data class WenliSweepResult(
    val processed: Int,
)

@Serializable
data class ContactRemark(
    val targetId: String,
    val remark: String,
    val updatedAt: String? = null,
)

@Serializable
data class ReleaseInfo(
    val versionCode: Int,
    val versionName: String,
    val notes: String,
    val downloadUrl: String,
    val sha256: String,
)

@Serializable
data class ReadState(
    val accountId: String? = null,
    val lastReadMessageId: String? = null,
    val lastReadMessageCreatedAt: String? = null,
    val readReceiptMessageId: String? = null,
    val readReceiptMessageCreatedAt: String? = null,
    val partnerReadReceiptMessageId: String? = null,
    val partnerReadReceiptMessageCreatedAt: String? = null,
    val lastSeenMomentAt: String? = null,
    val updatedAt: String? = null,
)
