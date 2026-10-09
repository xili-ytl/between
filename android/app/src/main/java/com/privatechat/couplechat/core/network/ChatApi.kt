package com.privatechat.couplechat.core.network

import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.ContactRemark
import com.privatechat.couplechat.core.model.ImageMessage
import com.privatechat.couplechat.core.model.ImageUploadCredential
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.model.MessagePage
import com.privatechat.couplechat.core.model.MomentComment
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentLike
import com.privatechat.couplechat.core.model.MomentVisibility
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.core.model.ReadState
import com.privatechat.couplechat.core.model.ReleaseInfo
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.model.WenliKickResult
import com.privatechat.couplechat.core.model.WenliSweepResult

interface ChatApi {
    suspend fun login(accountId: String, password: String): Session
    suspend fun logout(token: String)
    suspend fun profiles(token: String): List<Profile>
    suspend fun updateProfile(token: String, displayName: String): Profile
    suspend fun updateAvatar(token: String, mimeType: String, base64: String): Profile
    suspend fun changePassword(token: String, current: String, replacement: String): Session
    suspend fun send(
        token: String,
        clientMessageId: String,
        body: String,
        replyToMessageId: String? = null,
        image: ImageMessage? = null,
    ): ChatMessage
    suspend fun kickWenli(token: String, sourceMessageId: String): WenliKickResult =
        error("Wenli kick unavailable")
    suspend fun sweepWenli(token: String, limit: Int = 2): WenliSweepResult =
        error("Wenli sweep unavailable")
    suspend fun requestImageUploadCredential(token: String, clientMessageId: String, imageMimeType: String): ImageUploadCredential =
        error("image upload credential unavailable")
    suspend fun uploadImage(credential: ImageUploadCredential, bytes: ByteArray, contentType: String): Unit =
        error("image upload unavailable")
    suspend fun imageUrl(token: String, imageFileId: String): String = error("image url unavailable")
    suspend fun after(token: String, cursor: MessageCursor?): MessagePage
    suspend fun before(token: String, cursor: MessageCursor?): MessagePage
    suspend fun remark(token: String, targetId: String): ContactRemark = error("remark unavailable")
    suspend fun setRemark(token: String, targetId: String, remark: String): ContactRemark = error("remark unavailable")
    suspend fun moments(token: String): List<MomentItem>
    suspend fun createMoment(
        token: String,
        clientMomentId: String,
        body: String,
        visibility: MomentVisibility,
        image: ImageMessage? = null,
    ): MomentItem
    suspend fun requestMomentImageUploadCredential(token: String, clientMomentId: String, imageMimeType: String): ImageUploadCredential =
        error("moment image upload credential unavailable")
    suspend fun deleteMoment(token: String, momentId: String)
    suspend fun likeMoment(token: String, momentId: String): MomentLike
    suspend fun unlikeMoment(token: String, momentId: String)
    suspend fun createMomentComment(
        token: String,
        momentId: String,
        clientCommentId: String,
        body: String,
        replyToCommentId: String? = null,
    ): MomentComment
    suspend fun deleteMomentComment(token: String, commentId: String)
    suspend fun readStateGet(token: String): ReadState = error("read state unavailable")
    suspend fun readStateSet(
        token: String,
        lastReadMessageId: String?,
        lastReadMessageCreatedAt: String?,
        lastSeenMomentAt: String?,
        readReceiptMessageId: String? = null,
        readReceiptMessageCreatedAt: String? = null,
    ): ReadState = error("read state unavailable")
    suspend fun pushRegister(token: String, registrationId: String): Unit = error("push unavailable")
    suspend fun pushUnregister(token: String): Unit = error("push unavailable")
}

interface ReleaseApi {
    suspend fun latestRelease(): ReleaseInfo
}

open class ChatApiException(
    val code: String,
    message: String,
) : Exception(message)

class SessionInvalidException : ChatApiException("SESSION_INVALID", "此账号已在新设备登录，请重新登录")

class ChatConfigurationException : ChatApiException("CLIENT_NOT_CONFIGURED", "应用尚未连接 CloudBase")
