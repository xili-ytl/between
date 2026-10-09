package com.privatechat.couplechat.core.network

import com.privatechat.couplechat.core.model.ImageMessage
import com.privatechat.couplechat.core.model.ImageUploadCredential
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.model.MomentVisibility
import io.ktor.client.HttpClient
import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpMethod
import io.ktor.http.HttpStatusCode
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import kotlinx.coroutines.test.runTest
import kotlinx.serialization.json.Json
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CloudBaseChatApiTest {
    @Test
    fun wenliKickSendsOnlyTheAuthenticatedSourceId() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson("""{"ok":true,"data":{"processed":true,"messageId":"wenli_reply_1"}}""")
        }
        val result = api(engine).kickWenli("token-wenli", "1001_source-1")

        assertTrue(result.processed)
        assertEquals("wenli_reply_1", result.messageId)
        assertRequest(
            capturedBody,
            """{"action":"wenli.kick","sessionToken":"token-wenli","payload":{"sourceMessageId":"1001_source-1"}}""",
        )
    }

    @Test
    fun wenliSweepSendsTheBoundedLimit() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson("""{"ok":true,"data":{"processed":2}}""")
        }
        val result = api(engine).sweepWenli("token-wenli", 2)

        assertEquals(2, result.processed)
        assertRequest(
            capturedBody,
            """{"action":"wenli.sweep","sessionToken":"token-wenli","payload":{"limit":2}}""",
        )
    }

    @Test
    fun pushRegisterAcceptsTheRegistrationRecordReturnedByTheBackend() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"id":"1001","accountId":"1001","registrationId":"reg-device-1","platform":"android","updatedAt":"2026-08-09T00:00:00.000Z"}}""",
            )
        }

        api(engine).pushRegister("token-push", "reg-device-1")

        assertRequest(
            capturedBody,
            """{"action":"push.register","sessionToken":"token-push","payload":{"registrationId":"reg-device-1"}}""",
        )
    }

    @Test
    fun loginUsesPublishableKeyAndExpectedEnvelope() = runTest {
        var captured: HttpRequestData? = null
        val engine = MockEngine { request ->
            captured = request
            respond(
                content = """{"result":"{\"ok\":true,\"data\":{\"accountId\":\"1001\",\"displayName\":\"1001\",\"avatarKey\":null,\"sessionToken\":\"token-1\",\"sessionVersion\":1}}"}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }
        val api = CloudBaseChatApi("https://example.invalid/chat-api", "publishable", HttpClient(engine))

        val session = api.login("1001", "secret")

        assertEquals("1001", session.accountId)
        assertEquals("token-1", session.token)
        assertEquals("Bearer publishable", captured?.headers?.get(HttpHeaders.Authorization))
        val body = captured!!.body.bytes().decodeToString()
        assertTrue(body.contains("\"action\":\"auth.login\""))
        assertTrue(body.contains("\"accountId\":\"1001\""))
        assertTrue(body.contains("\"password\":\"secret\""))
    }

    @Test
    fun mapsInvalidSessionWithoutLeakingServerDetails() = runTest {
        val engine = MockEngine {
            respond(
                content = """{"ok":false,"error":{"code":"SESSION_INVALID","message":"invalid"}}""",
                status = HttpStatusCode.OK,
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }
        val api = CloudBaseChatApi("https://example.invalid/chat-api", "publishable", HttpClient(engine))

        val error = runCatching { api.profiles("expired") }.exceptionOrNull()

        assertTrue(error is SessionInvalidException)
    }

    @Test
    fun decodesMessagePagesAndSendsCursor() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respond(
                content = """{"result":{"ok":true,"data":{"items":[{"id":"1002_m1","relationshipId":"couple","senderId":"1002","recipientId":"1001","clientMessageId":"m1","body":"你好","createdAt":"2026-08-06T00:00:00.000Z"}],"nextCursor":{"createdAt":"2026-08-06T00:00:00.000Z","id":"1002_m1"}}}}""",
                headers = headersOf(HttpHeaders.ContentType, "application/json")
            )
        }
        val api = CloudBaseChatApi("https://example.invalid/chat-api", "publishable", HttpClient(engine))

        val page = api.after("token", MessageCursor("2026-08-05T00:00:00.000Z", "1001_old"))

        assertEquals("你好", page.items.single().body)
        assertEquals("1002_m1", page.nextCursor?.id)
        assertTrue(capturedBody.contains("\"cursor\":{"))
        assertTrue(capturedBody.contains("\"limit\":50"))
    }

    @Test
    fun momentsListSendsExactRequestAndDecodesFullFeed() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":[{"id":"moment-1","authorId":"1002","clientMomentId":"client-1","body":"今天很开心🌙","visibility":"PARTNER","createdAt":"2026-08-07T01:00:00.000Z","likes":[{"id":"like-1","momentId":"moment-1","accountId":"1001","createdAt":"2026-08-07T01:01:00.000Z"}],"comments":[{"id":"comment-1","momentId":"moment-1","authorId":"1001","clientCommentId":"comment-client-1","body":"我也是～","createdAt":"2026-08-07T01:02:00.000Z"}]}]}"""
            )
        }
        val api = api(engine)

        val moments = api.moments("token-list")

        assertRequest(
            capturedBody,
            """{"action":"moments.list","sessionToken":"token-list","payload":{}}""",
        )
        val moment = moments.single()
        assertEquals("1002", moment.authorId)
        assertEquals("今天很开心🌙", moment.body)
        assertEquals(MomentVisibility.PARTNER, moment.visibility)
        assertEquals("1001", moment.likes.single().accountId)
        assertEquals("我也是～", moment.comments.single().body)
    }

    @Test
    fun createMomentSendsExactRequestAndDecodesMoment() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"result":{"ok":true,"data":{"id":"moment-self","authorId":"1001","clientMomentId":"client-self","body":"只给自己看的晚安","visibility":"SELF","createdAt":"2026-08-07T02:00:00.000Z","likes":[],"comments":[]}}}"""
            )
        }
        val api = api(engine)

        val moment = api.createMoment(
            token = "token-create",
            clientMomentId = "client-self",
            body = "只给自己看的晚安",
            visibility = MomentVisibility.SELF,
        )

        assertRequest(
            capturedBody,
            """{"action":"moments.create","sessionToken":"token-create","payload":{"clientMomentId":"client-self","body":"只给自己看的晚安","visibility":"SELF"}}""",
        )
        assertEquals("moment-self", moment.id)
        assertEquals("1001", moment.authorId)
        assertEquals(MomentVisibility.SELF, moment.visibility)
    }

    @Test
    fun deleteMomentSendsExactRequestAndAcceptsDeletedAcknowledgement() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson("""{"ok":true,"data":{"deleted":true}}""")
        }
        val api = api(engine)

        api.deleteMoment("token-delete", "moment-delete")

        assertRequest(
            capturedBody,
            """{"action":"moments.delete","sessionToken":"token-delete","payload":{"momentId":"moment-delete"}}""",
        )
    }

    @Test
    fun likeMomentSendsExactRequestAndDecodesLike() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"id":"like-2","momentId":"moment-2","accountId":"1001","createdAt":"2026-08-07T03:00:00.000Z"}}"""
            )
        }
        val api = api(engine)

        val like = api.likeMoment("token-like", "moment-2")

        assertRequest(
            capturedBody,
            """{"action":"moments.like","sessionToken":"token-like","payload":{"momentId":"moment-2"}}""",
        )
        assertEquals("like-2", like.id)
        assertEquals("moment-2", like.momentId)
        assertEquals("1001", like.accountId)
    }

    @Test
    fun unlikeMomentSendsExactRequestAndAcceptsUnlikedAcknowledgement() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson("""{"ok":true,"data":{"unliked":true}}""")
        }
        val api = api(engine)

        api.unlikeMoment("token-unlike", "moment-2")

        assertRequest(
            capturedBody,
            """{"action":"moments.unlike","sessionToken":"token-unlike","payload":{"momentId":"moment-2"}}""",
        )
    }

    @Test
    fun createMomentCommentSendsExactRequestAndDecodesUnicodeComment() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"id":"comment-2","momentId":"moment-2","authorId":"1002","clientCommentId":"comment-client-2","body":"你拍的月亮真好看✨","createdAt":"2026-08-07T04:00:00.000Z"}}"""
            )
        }
        val api = api(engine)

        val comment = api.createMomentComment(
            token = "token-comment",
            momentId = "moment-2",
            clientCommentId = "comment-client-2",
            body = "你拍的月亮真好看✨",
        )

        assertRequest(
            capturedBody,
            """{"action":"moments.comments.create","sessionToken":"token-comment","payload":{"momentId":"moment-2","clientCommentId":"comment-client-2","body":"你拍的月亮真好看✨"}}""",
        )
        assertEquals("comment-2", comment.id)
        assertEquals("1002", comment.authorId)
        assertEquals("你拍的月亮真好看✨", comment.body)
    }

    @Test
    fun createMomentCommentReplySendsReplyTargetInPayload() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"id":"comment-reply","momentId":"moment-2","authorId":"1001","clientCommentId":"comment-client-reply","body":"好看","replyToCommentId":"1002_comment-client-2","createdAt":"2026-08-07T04:00:00.000Z"}}"""
            )
        }
        val api = api(engine)

        val comment = api.createMomentComment(
            token = "token-comment",
            momentId = "moment-2",
            clientCommentId = "comment-client-reply",
            body = "好看",
            replyToCommentId = "1002_comment-client-2",
        )

        assertRequest(
            capturedBody,
            """{"action":"moments.comments.create","sessionToken":"token-comment","payload":{"momentId":"moment-2","clientCommentId":"comment-client-reply","body":"好看","replyToCommentId":"1002_comment-client-2"}}""",
        )
        assertEquals("1002_comment-client-2", comment.replyToCommentId)
    }

    @Test
    fun readStateGetSendsActionAndDecodesCursors() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"accountId":"1001","lastReadMessageId":"1002_m1","lastReadMessageCreatedAt":"2026-08-09T00:00:01.000Z","partnerReadReceiptMessageId":"1001_m2","partnerReadReceiptMessageCreatedAt":"2026-08-09T00:00:02.000Z","lastSeenMomentAt":"2026-08-09T00:00:02.000Z","updatedAt":"2026-08-09T00:00:02.000Z"}}"""
            )
        }
        val api = api(engine)

        val state = api.readStateGet("token-read")

        assertRequest(capturedBody, """{"action":"chat.readState.get","sessionToken":"token-read","payload":{}}""")
        assertEquals("1002_m1", state.lastReadMessageId)
        assertEquals("1001_m2", state.partnerReadReceiptMessageId)
        assertEquals("2026-08-09T00:00:02.000Z", state.lastSeenMomentAt)
    }

    @Test
    fun readStateSetSendsCursorsInPayload() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"accountId":"1001","lastReadMessageId":"1002_m2","lastReadMessageCreatedAt":"2026-08-09T00:00:03.000Z","updatedAt":"2026-08-09T00:00:03.000Z"}}"""
            )
        }
        val api = api(engine)

        api.readStateSet("token-read", "1002_m2", "2026-08-09T00:00:03.000Z", null)

        assertRequest(
            capturedBody,
            """{"action":"chat.readState.set","sessionToken":"token-read","payload":{"lastReadMessageId":"1002_m2","lastReadMessageCreatedAt":"2026-08-09T00:00:03.000Z"}}""",
        )
    }

    @Test
    fun readReceiptSetSendsOnlyTheIndependentReceiptCursor() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"accountId":"1001","readReceiptMessageId":"1002_m2","readReceiptMessageCreatedAt":"2026-08-09T00:00:03.000Z","updatedAt":"2026-08-09T00:00:03.000Z"}}"""
            )
        }
        val api = api(engine)

        api.readStateSet(
            token = "token-read",
            lastReadMessageId = null,
            lastReadMessageCreatedAt = null,
            lastSeenMomentAt = null,
            readReceiptMessageId = "1002_m2",
            readReceiptMessageCreatedAt = "2026-08-09T00:00:03.000Z",
        )

        assertRequest(
            capturedBody,
            """{"action":"chat.readState.set","sessionToken":"token-read","payload":{"readReceiptMessageId":"1002_m2","readReceiptMessageCreatedAt":"2026-08-09T00:00:03.000Z"}}""",
        )
    }

    @Test
    fun deleteMomentCommentSendsExactRequestAndAcceptsDeletedAcknowledgement() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson("""{"ok":true,"data":{"deleted":true}}""")
        }
        val api = api(engine)

        api.deleteMomentComment("token-comment-delete", "comment-2")

        assertRequest(
            capturedBody,
            """{"action":"moments.comments.delete","sessionToken":"token-comment-delete","payload":{"commentId":"comment-2"}}""",
        )
    }

    @Test
    fun profileGetDecodesGender() = runTest {
        val engine = MockEngine {
            respondJson(
                """{"ok":true,"data":[{"accountId":"1001","displayName":"小猫","gender":"女","avatarUrl":null,"updatedAt":"2026-08-07T05:00:00.000Z"},{"accountId":"1002","displayName":"先生","gender":"男","avatarUrl":"https://example.invalid/avatar.jpg","updatedAt":"2026-08-07T05:00:00.000Z"}]}"""
            )
        }
        val api = api(engine)

        val profiles = api.profiles("token-profile")

        assertEquals(listOf("女", "男"), profiles.map { it.gender })
        assertEquals(listOf("小猫", "先生"), profiles.map { it.displayName })
    }

    @Test
    fun remarkActionsUseAuthenticatedOwnerAndDecodeResult() = runTest {
        val requests = mutableListOf<String>()
        val engine = MockEngine { request ->
            requests += request.body.bytes().decodeToString()
            respondJson(
                if (requests.size == 1) {
                    """{"ok":true,"data":{"targetId":"1002","remark":"","updatedAt":null}}"""
                } else {
                    """{"ok":true,"data":{"targetId":"1002","remark":"宝宝","updatedAt":"2026-08-08T08:00:00.000Z"}}"""
                }
            )
        }
        val api = api(engine)

        assertEquals("", api.remark("token", "1002").remark)
        assertEquals("宝宝", api.setRemark("token", "1002", "宝宝").remark)

        assertRequest(
            requests[0],
            """{"action":"remark.get","sessionToken":"token","payload":{"targetId":"1002"}}""",
        )
        assertRequest(
            requests[1],
            """{"action":"remark.set","sessionToken":"token","payload":{"targetId":"1002","remark":"宝宝"}}""",
        )
    }

    @Test
    fun latestReleaseUsesThePublicVersionActionAndDecodesMetadata() = runTest {
        var capturedBody = ""
        val engine = MockEngine { request ->
            capturedBody = request.body.bytes().decodeToString()
            respondJson(
                """{"ok":true,"data":{"versionCode":6,"versionName":"1.0","notes":"优化聊天","downloadUrl":"https://download.test/between.apk","sha256":"${"a".repeat(64)}"}}"""
            )
        }
        val api = api(engine)

        val release = api.latestRelease()

        assertRequest(capturedBody, """{"action":"system.version","payload":{}}""")
        assertEquals(6, release.versionCode)
        assertEquals("1.0", release.versionName)
        assertEquals("https://download.test/between.apk", release.downloadUrl)
    }

    @Test
    fun momentApiFailurePreservesServerCodeAndMessage() = runTest {
        val engine = MockEngine {
            respondJson("""{"ok":false,"error":{"code":"MOMENT_NOT_FOUND","message":"动态不存在"}}""")
        }
        val api = api(engine)

        val error = runCatching { api.deleteMoment("token", "missing") }.exceptionOrNull()

        assertTrue(error is ChatApiException)
        assertEquals("MOMENT_NOT_FOUND", (error as ChatApiException).code)
        assertEquals("动态不存在", error.message)
    }

    @Test
    fun failureEnvelopeRequiresErrorObject() = runTest {
        listOf(
            """{"ok":false}""",
            """{"ok":false,"error":null}""",
        ).forEach { response -> assertInvalidFailureEnvelope(response) }
    }

    @Test
    fun failureEnvelopeRequiresCodeAndMessage() = runTest {
        listOf(
            """{"ok":false,"error":{"message":"missing code"}}""",
            """{"ok":false,"error":{"code":"MISSING_MESSAGE"}}""",
        ).forEach { response -> assertInvalidFailureEnvelope(response) }
    }

    @Test
    fun failureEnvelopeRequiresStringCodeAndMessage() = runTest {
        listOf(
            """{"ok":false,"error":{"code":123,"message":"wrong code type"}}""",
            """{"ok":false,"error":{"code":"WRONG_MESSAGE_TYPE","message":false}}""",
        ).forEach { response -> assertInvalidFailureEnvelope(response) }
    }

    @Test
    fun momentSessionInvalidUsesExistingExceptionMapping() = runTest {
        val engine = MockEngine {
            respondJson("""{"ok":false,"error":{"code":"SESSION_INVALID","message":"server detail"}}""")
        }
        val api = api(engine)

        val error = runCatching { api.likeMoment("expired", "moment-1") }.exceptionOrNull()

        assertTrue(error is SessionInvalidException)
    }

    @Test
    fun malformedMomentResponseFailsInsteadOfDefaultingRequiredFields() = runTest {
        val engine = MockEngine {
            respondJson(
                """{"ok":true,"data":[{"id":"moment-1","clientMomentId":"client-1","body":"缺少作者","visibility":"PARTNER","createdAt":"2026-08-07T01:00:00.000Z","likes":[],"comments":[]}]}"""
            )
        }
        val api = api(engine)

        val error = runCatching { api.moments("token") }.exceptionOrNull()

        assertTrue(error is ChatApiException)
        assertEquals("RESPONSE_INVALID", (error as ChatApiException).code)
    }

    @Test
    fun deleteMomentRejectsMalformedDeletedAcknowledgements() = runTest {
        malformedAcknowledgements("deleted").forEach { data ->
            assertInvalidAcknowledgement(data) { it.deleteMoment("token", "moment-1") }
        }
    }

    @Test
    fun unlikeMomentRejectsMalformedUnlikedAcknowledgements() = runTest {
        malformedAcknowledgements("unliked").forEach { data ->
            assertInvalidAcknowledgement(data) { it.unlikeMoment("token", "moment-1") }
        }
    }

    @Test
    fun deleteMomentCommentRejectsMalformedDeletedAcknowledgements() = runTest {
        malformedAcknowledgements("deleted").forEach { data ->
            assertInvalidAcknowledgement(data) { it.deleteMomentComment("token", "comment-1") }
        }
    }

    @Test
    fun requestImageUploadCredentialUsesExpectedEnvelope() = runTest {
        var captured: HttpRequestData? = null
        val engine = MockEngine { request ->
            captured = request
            respondJson(
                """{"result":"{\"ok\":true,\"data\":{\"uploadUrl\":\"https://upload.invalid/img.jpg\",\"authorization\":\"auth-x\",\"token\":\"token-x\",\"cosFileId\":\"cos-x\",\"key\":\"chat-images%2F1001_img-1.jpg\",\"fileId\":\"cloud://env-bucket/chat-images/1001_img-1.jpg\"}}"}""",
            )
        }
        val credential = api(engine).requestImageUploadCredential("token-1", "img-1", "image/jpeg")

        assertEquals("https://upload.invalid/img.jpg", credential.uploadUrl)
        assertEquals("auth-x", credential.authorization)
        assertEquals("token-x", credential.token)
        assertEquals("cos-x", credential.cosFileId)
        assertEquals("chat-images%2F1001_img-1.jpg", credential.key)
        assertEquals("cloud://env-bucket/chat-images/1001_img-1.jpg", credential.fileId)
        val body = captured!!.body.bytes().decodeToString()
        assertTrue(body.contains("\"action\":\"chat.imageUploadCredential\""))
        assertTrue(body.contains("\"clientMessageId\":\"img-1\""))
        assertTrue(body.contains("\"imageMimeType\":\"image/jpeg\""))
    }

    @Test
    fun uploadImagePutsBytesToUploadUrlWithAuthorization() = runTest {
        var captured: HttpRequestData? = null
        val engine = MockEngine { request ->
            captured = request
            respond("", status = HttpStatusCode.OK)
        }
        val credential = ImageUploadCredential(
            "https://upload.invalid/img.jpg",
            "auth-x",
            "token-x",
            "cos-x",
            "chat-images%2F1001_img-1.jpg",
            "cloud://env-bucket/chat-images/1001_img-1.jpg",
        )
        api(engine).uploadImage(credential, byteArrayOf(1, 2, 3), "image/jpeg")

        assertEquals(HttpMethod.Put, captured?.method)
        assertEquals("auth-x", captured?.headers?.get("Signature"))
        assertEquals("auth-x", captured?.headers?.get("authorization"))
        assertEquals("token-x", captured?.headers?.get("x-cos-security-token"))
        assertEquals("cos-x", captured?.headers?.get("x-cos-meta-fileid"))
        assertEquals("chat-images%2F1001_img-1.jpg", captured?.headers?.get("key"))
        assertTrue(captured?.url?.toString()?.startsWith("https://upload.invalid/img.jpg") == true)
    }

    @Test
    fun sendImageIncludesImageFieldsInPayload() = runTest {
        var captured: HttpRequestData? = null
        val engine = MockEngine { request ->
            captured = request
            respondJson(
                """{"result":"{\"ok\":true,\"data\":{\"id\":\"1001_img-1\",\"relationshipId\":\"couple\",\"senderId\":\"1001\",\"recipientId\":\"1002\",\"clientMessageId\":\"img-1\",\"body\":\"\",\"type\":\"image\",\"imageFileId\":\"cloud://env-bucket/chat-images/1001_img-1.jpg\",\"imageMimeType\":\"image/jpeg\",\"imageWidth\":800,\"imageHeight\":600,\"createdAt\":\"2026-08-08T00:00:00Z\"}}"}""",
            )
        }
        val message = api(engine).send(
            "token-1",
            "img-1",
            "",
            null,
            ImageMessage("cloud://env-bucket/chat-images/1001_img-1.jpg", "image/jpeg", 800, 600),
        )

        assertEquals("image", message.type)
        assertEquals(800, message.imageWidth)
        val body = captured!!.body.bytes().decodeToString()
        assertTrue(body.contains("\"type\":\"image\""))
        assertTrue(body.contains("\"imageFileId\":\"cloud://env-bucket/chat-images/1001_img-1.jpg\""))
        assertTrue(body.contains("\"imageWidth\":800"))
    }
}

private fun OutgoingContent.bytes(): ByteArray =
    (this as OutgoingContent.ByteArrayContent).bytes()

private fun api(engine: MockEngine) =
    CloudBaseChatApi("https://example.invalid/chat-api", "publishable", HttpClient(engine))

private fun MockRequestHandleScope.respondJson(content: String) =
    respond(
        content = content,
        status = HttpStatusCode.OK,
        headers = headersOf(HttpHeaders.ContentType, "application/json"),
    )

private fun assertRequest(actual: String, expected: String) {
    assertEquals(Json.parseToJsonElement(expected), Json.parseToJsonElement(actual))
}

private fun malformedAcknowledgements(field: String) = listOf(
    "{}",
    """{"$field":null}""",
    """"primitive"""",
    """{"$field":"true"}""",
    """{"$field":false}""",
)

private suspend fun assertInvalidAcknowledgement(
    data: String,
    mutation: suspend (CloudBaseChatApi) -> Unit,
) {
    val engine = MockEngine { respondJson("""{"ok":true,"data":$data}""") }
    val error = runCatching { mutation(api(engine)) }.exceptionOrNull()

    assertTrue("Expected invalid response for acknowledgement data $data, got $error", error is ChatApiException)
    assertEquals("RESPONSE_INVALID", (error as ChatApiException).code)
}

private suspend fun assertInvalidFailureEnvelope(response: String) {
    val engine = MockEngine { respondJson(response) }
    val error = runCatching { api(engine).moments("token") }.exceptionOrNull()

    assertTrue("Expected invalid failure envelope for $response, got $error", error is ChatApiException)
    assertEquals("RESPONSE_INVALID", (error as ChatApiException).code)
}
