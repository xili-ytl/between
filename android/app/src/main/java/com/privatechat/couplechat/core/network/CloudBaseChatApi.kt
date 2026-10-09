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
import io.ktor.client.HttpClient
import io.ktor.client.engine.okhttp.OkHttp
import io.ktor.client.plugins.HttpTimeout
import io.ktor.client.plugins.timeout
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.isSuccess
import kotlinx.serialization.KSerializer
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.Serializable
import kotlinx.serialization.builtins.ListSerializer
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.put

class CloudBaseChatApi(
    private val endpoint: String,
    private val publishableKey: String,
    client: HttpClient = HttpClient(OkHttp),
    private val json: Json = Json { ignoreUnknownKeys = true },
) : ChatApi, ReleaseApi {
    private val client = client.config { install(HttpTimeout) }
    override suspend fun latestRelease(): ReleaseInfo =
        call(
            action = "system.version",
            payload = JsonObject(emptyMap()),
            serializer = ReleaseInfo.serializer(),
        )

    override suspend fun login(accountId: String, password: String): Session =
        call(
            action = "auth.login",
            payload = buildJsonObject {
                put("accountId", accountId)
                put("password", password)
            },
            serializer = Session.serializer(),
        )

    override suspend fun logout(token: String) {
        call(token, "auth.logout", JsonObject(emptyMap()), JsonElement.serializer())
    }

    override suspend fun profiles(token: String): List<Profile> =
        call(token, "profile.get", JsonObject(emptyMap()), ListSerializer(Profile.serializer()))

    override suspend fun updateProfile(token: String, displayName: String): Profile =
        call(
            token,
            "profile.update",
            buildJsonObject { put("displayName", displayName) },
            Profile.serializer(),
        )

    override suspend fun updateAvatar(token: String, mimeType: String, base64: String): Profile =
        call(
            token,
            "profile.updateAvatar",
            buildJsonObject {
                put("contentType", mimeType)
                put("base64", base64)
            },
            Profile.serializer(),
        )

    override suspend fun changePassword(token: String, current: String, replacement: String): Session =
        call(
            token,
            "auth.changePassword",
            buildJsonObject {
                put("currentPassword", current)
                put("replacementPassword", replacement)
            },
            Session.serializer(),
        )

    override suspend fun send(
        token: String,
        clientMessageId: String,
        body: String,
        replyToMessageId: String?,
        image: ImageMessage?,
    ): ChatMessage =
        call(
            token,
            "chat.send",
            buildJsonObject {
                put("clientMessageId", clientMessageId)
                put("body", body)
                replyToMessageId?.let { put("replyToMessageId", it) }
                if (image != null) {
                    put("type", "image")
                    put("imageFileId", image.imageFileId)
                    put("imageMimeType", image.imageMimeType)
                    image.imageWidth?.let { put("imageWidth", it) }
                    image.imageHeight?.let { put("imageHeight", it) }
                }
            },
            ChatMessage.serializer(),
        )

    override suspend fun kickWenli(token: String, sourceMessageId: String): WenliKickResult =
        call(
            token,
            "wenli.kick",
            buildJsonObject { put("sourceMessageId", sourceMessageId) },
            WenliKickResult.serializer(),
        )

    override suspend fun sweepWenli(token: String, limit: Int): WenliSweepResult =
        call(
            token,
            "wenli.sweep",
            buildJsonObject { put("limit", limit) },
            WenliSweepResult.serializer(),
        )

    override suspend fun requestImageUploadCredential(
        token: String,
        clientMessageId: String,
        imageMimeType: String,
    ): ImageUploadCredential =
        call(
            token,
            "chat.imageUploadCredential",
            buildJsonObject {
                put("clientMessageId", clientMessageId)
                put("imageMimeType", imageMimeType)
            },
            ImageUploadCredential.serializer(),
        )

    override suspend fun uploadImage(credential: ImageUploadCredential, bytes: ByteArray, contentType: String) {
        val response = client.put(credential.uploadUrl) {
            header("Signature", credential.authorization)
            header("x-cos-security-token", credential.token)
            header("x-cos-meta-fileid", credential.cosFileId)
            header("authorization", credential.authorization)
            header("key", credential.key)
            setBody(bytes)
        }
        if (!response.status.isSuccess()) {
            throw ChatApiException("IMAGE_UPLOAD_FAILED", "图片上传失败")
        }
    }

    override suspend fun imageUrl(token: String, imageFileId: String): String =
        call(
            token,
            "chat.imageUrl",
            buildJsonObject { put("imageFileId", imageFileId) },
            ImageUrlResponse.serializer(),
        ).url

    override suspend fun after(token: String, cursor: MessageCursor?): MessagePage =
        page(token, "chat.after", cursor)

    override suspend fun before(token: String, cursor: MessageCursor?): MessagePage =
        page(token, "chat.before", cursor)

    override suspend fun remark(token: String, targetId: String): ContactRemark =
        call(
            token,
            "remark.get",
            buildJsonObject { put("targetId", targetId) },
            ContactRemark.serializer(),
        )

    override suspend fun setRemark(token: String, targetId: String, remark: String): ContactRemark =
        call(
            token,
            "remark.set",
            buildJsonObject {
                put("targetId", targetId)
                put("remark", remark)
            },
            ContactRemark.serializer(),
        )

    override suspend fun moments(token: String): List<MomentItem> =
        call(token, "moments.list", JsonObject(emptyMap()), ListSerializer(MomentItem.serializer()))

    override suspend fun createMoment(
        token: String,
        clientMomentId: String,
        body: String,
        visibility: MomentVisibility,
        image: ImageMessage?,
    ): MomentItem =
        call(
            token,
            "moments.create",
            buildJsonObject {
                put("clientMomentId", clientMomentId)
                put("body", body)
                put("visibility", json.encodeToJsonElement(MomentVisibility.serializer(), visibility))
                if (image != null) {
                    put("type", "image")
                    put("imageFileId", image.imageFileId)
                    put("imageMimeType", image.imageMimeType)
                    image.imageWidth?.let { put("imageWidth", it) }
                    image.imageHeight?.let { put("imageHeight", it) }
                }
            },
            MomentItem.serializer(),
        )

    override suspend fun requestMomentImageUploadCredential(
        token: String,
        clientMomentId: String,
        imageMimeType: String,
    ): ImageUploadCredential =
        call(
            token,
            "moments.imageUploadCredential",
            buildJsonObject {
                put("clientMomentId", clientMomentId)
                put("imageMimeType", imageMimeType)
            },
            ImageUploadCredential.serializer(),
        )

    override suspend fun deleteMoment(token: String, momentId: String) {
        requireTrueAcknowledgement(
            token,
            "moments.delete",
            buildJsonObject { put("momentId", momentId) },
            "deleted",
        )
    }

    override suspend fun likeMoment(token: String, momentId: String): MomentLike =
        call(
            token,
            "moments.like",
            buildJsonObject { put("momentId", momentId) },
            MomentLike.serializer(),
        )

    override suspend fun unlikeMoment(token: String, momentId: String) {
        requireTrueAcknowledgement(
            token,
            "moments.unlike",
            buildJsonObject { put("momentId", momentId) },
            "unliked",
        )
    }

    override suspend fun createMomentComment(
        token: String,
        momentId: String,
        clientCommentId: String,
        body: String,
        replyToCommentId: String?,
    ): MomentComment =
        call(
            token,
            "moments.comments.create",
            buildJsonObject {
                put("momentId", momentId)
                put("clientCommentId", clientCommentId)
                put("body", body)
                replyToCommentId?.let { put("replyToCommentId", it) }
            },
            MomentComment.serializer(),
        )

    override suspend fun deleteMomentComment(token: String, commentId: String) {
        requireTrueAcknowledgement(
            token,
            "moments.comments.delete",
            buildJsonObject { put("commentId", commentId) },
            "deleted",
        )
    }

    override suspend fun readStateGet(token: String): ReadState =
        call(token, "chat.readState.get", buildJsonObject { }, ReadState.serializer())

    override suspend fun readStateSet(
        token: String,
        lastReadMessageId: String?,
        lastReadMessageCreatedAt: String?,
        lastSeenMomentAt: String?,
        readReceiptMessageId: String?,
        readReceiptMessageCreatedAt: String?,
    ): ReadState =
        call(
            token,
            "chat.readState.set",
            buildJsonObject {
                lastReadMessageId?.let { put("lastReadMessageId", it) }
                lastReadMessageCreatedAt?.let { put("lastReadMessageCreatedAt", it) }
                lastSeenMomentAt?.let { put("lastSeenMomentAt", it) }
                readReceiptMessageId?.let { put("readReceiptMessageId", it) }
                readReceiptMessageCreatedAt?.let { put("readReceiptMessageCreatedAt", it) }
            },
            ReadState.serializer(),
        )

    override suspend fun pushRegister(token: String, registrationId: String) {
        call(
            token,
            "push.register",
            buildJsonObject { put("registrationId", registrationId) },
            JsonObject.serializer(),
        )
    }

    override suspend fun pushUnregister(token: String) {
        requireTrueAcknowledgement(token, "push.unregister", buildJsonObject { }, "unregistered")
    }

    private suspend fun requireTrueAcknowledgement(
        sessionToken: String,
        action: String,
        payload: JsonObject,
        field: String,
    ) {
        val acknowledgement = call(sessionToken, action, payload, JsonObject.serializer())
        val value = acknowledgement[field] as? JsonPrimitive
        if (value == null || value.isString || value.booleanOrNull != true) throw invalidResponse()
    }

    private suspend fun page(token: String, action: String, cursor: MessageCursor?): MessagePage =
        call(
            token,
            action,
            buildJsonObject {
                put("cursor", cursor?.let { json.encodeToJsonElement(MessageCursor.serializer(), it) } ?: JsonNull)
                put("limit", 50)
            },
            MessagePage.serializer(),
        )

    private suspend fun <T> call(
        action: String,
        payload: JsonObject,
        serializer: KSerializer<T>,
    ): T = call(null, action, payload, serializer)

    private suspend fun <T> call(
        sessionToken: String?,
        action: String,
        payload: JsonObject,
        serializer: KSerializer<T>,
    ): T {
        if (endpoint.isBlank() || publishableKey.isBlank()) throw ChatConfigurationException()
        val request = ApiRequest(action, sessionToken, payload)
        val response = try {
            client.post(endpoint) {
                if (action == "wenli.kick" || action == "wenli.sweep") {
                    timeout {
                        requestTimeoutMillis = 60_000
                        socketTimeoutMillis = 60_000
                        connectTimeoutMillis = 10_000
                    }
                }
                header(HttpHeaders.Authorization, "Bearer $publishableKey")
                contentType(ContentType.Application.Json)
                setBody(json.encodeToString(ApiRequest.serializer(), request))
            }
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            throw ChatApiException("NETWORK_ERROR", "暂时无法连接服务器")
        }
        if (!response.status.isSuccess()) {
            throw ChatApiException("NETWORK_ERROR", "服务器暂时不可用")
        }

        val inner = try {
            unwrapCloudBase(json.parseToJsonElement(response.bodyAsText()))
        } catch (_: Exception) {
            throw invalidResponse()
        }
        val envelope = try {
            json.decodeFromJsonElement(ApiEnvelope.serializer(), inner)
        } catch (_: Exception) {
            throw invalidResponse()
        }
        if (!envelope.ok) {
            val error = envelope.error ?: throw invalidResponse()
            if (error.code == "SESSION_INVALID") throw SessionInvalidException()
            throw ChatApiException(error.code, error.message)
        }
        val data = envelope.data ?: JsonNull
        return try {
            json.decodeFromJsonElement(serializer, data)
        } catch (_: Exception) {
            throw invalidResponse()
        }
    }

    private fun invalidResponse() =
        ChatApiException("RESPONSE_INVALID", "服务器返回了无法识别的数据")

    private fun unwrapCloudBase(root: JsonElement): JsonElement {
        val result = (root as? JsonObject)?.get("result") ?: return root
        return if (result is JsonPrimitive && result.isString) {
            json.parseToJsonElement(result.content)
        } else {
            result
        }
    }
}

@Serializable
private data class ApiRequest(
    val action: String,
    val sessionToken: String? = null,
    val payload: JsonObject,
)

@Serializable
private data class ApiEnvelope(
    val ok: Boolean,
    val data: JsonElement? = null,
    val error: ApiError? = null,
)

@Serializable
private data class ApiError(
    val code: String,
    val message: String,
)

@Serializable
private data class ImageUrlResponse(val url: String)
