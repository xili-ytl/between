@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.ImageMessage
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.model.MessagePage
import com.privatechat.couplechat.core.model.MomentComment
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentLike
import com.privatechat.couplechat.core.model.MomentVisibility
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.push.PushRegistrationLifecycle
import com.privatechat.couplechat.core.session.SessionManager
import com.privatechat.couplechat.core.session.SessionStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AuthRepositoryTest {
    @Test
    fun logoutUnregistersPushBeforeTheAccountSessionAndThenClearsLocally() = runTest {
        val active = Session("1002", "Him", "active-token", 3)
        val sessions = SessionManager(AuthSessionStore(active)).also { it.load() }
        val events = mutableListOf<String>()
        val api = OrderedLogoutApi(events)
        val push = object : PushRegistrationLifecycle {
            override suspend fun unregister(session: Session) {
                events += "push:${session.token}"
            }
        }

        AuthRepository(api, sessions, push).logout()

        assertEquals(listOf("push:active-token", "logout:active-token"), events)
        assertEquals(null, sessions.current())
    }

    @Test
    fun pushUnregisterFailureDoesNotPreventNormalLogout() = runTest {
        val active = Session("1002", "Him", "active-token", 3)
        val sessions = SessionManager(AuthSessionStore(active)).also { it.load() }
        val events = mutableListOf<String>()
        val push = object : PushRegistrationLifecycle {
            override suspend fun unregister(session: Session) {
                events += "push:${session.token}"
                error("temporary push failure")
            }
        }

        AuthRepository(OrderedLogoutApi(events), sessions, push).logout()

        assertEquals(listOf("push:active-token", "logout:active-token"), events)
        assertEquals(null, sessions.current())
    }

    @Test
    fun apiLogoutFailureStillClearsLocalSession() = runTest {
        val active = Session("1002", "Him", "active-token", 3)
        val sessions = SessionManager(AuthSessionStore(active)).also { it.load() }
        val api = object : LogoutGateApi() {
            override suspend fun logout(token: String) = error("api logout down")
        }

        try {
            AuthRepository(api, sessions).logout()
        } catch (_: Throwable) {
            // 期望 logout 抛异常；关键断言是本地 session 仍被 finally 清空。
        }

        assertEquals(null, sessions.current())
    }

    @Test
    fun oldLogoutCompletionCannotClearReplacementLogin() = runTest {
        val old = Session("1001", "Her", "old-token", 1)
        val replacement = Session("1002", "Him", "new-token", 2)
        val sessions = SessionManager(AuthSessionStore(old)).also { it.load() }
        val api = LogoutGateApi()
        val request = async { AuthRepository(api, sessions).logout() }
        runCurrent()

        sessions.set(replacement)
        api.logoutGate.complete(Unit)
        request.await()

        assertEquals(replacement, sessions.current())
    }
}

private class OrderedLogoutApi(
    private val events: MutableList<String>,
) : LogoutGateApi() {
    override suspend fun logout(token: String) {
        events += "logout:$token"
    }
}

private class AuthSessionStore(initial: Session?) : SessionStore {
    private var stored = initial
    override suspend fun read(): Session? = stored
    override suspend fun save(session: Session) { stored = session }
    override suspend fun clear() { stored = null }
}

private open class LogoutGateApi : ChatApi {
    val logoutGate = CompletableDeferred<Unit>()
    open override suspend fun logout(token: String) = logoutGate.await()
    override suspend fun login(accountId: String, password: String) = error("unused")
    override suspend fun profiles(token: String): List<Profile> = error("unused")
    override suspend fun updateProfile(token: String, displayName: String): Profile = error("unused")
    override suspend fun updateAvatar(token: String, mimeType: String, base64: String): Profile = error("unused")
    override suspend fun changePassword(token: String, current: String, replacement: String): Session = error("unused")
    override suspend fun send(
        token: String,
        clientMessageId: String,
        body: String,
        replyToMessageId: String?,
        image: ImageMessage?,
    ): ChatMessage = error("unused")
    override suspend fun after(token: String, cursor: MessageCursor?): MessagePage = error("unused")
    override suspend fun before(token: String, cursor: MessageCursor?): MessagePage = error("unused")
    override suspend fun moments(token: String): List<MomentItem> = error("unused")
    override suspend fun createMoment(
        token: String,
        clientMomentId: String,
        body: String,
        visibility: MomentVisibility,
        image: ImageMessage?,
    ): MomentItem = error("unused")
    override suspend fun deleteMoment(token: String, momentId: String) = error("unused")
    override suspend fun likeMoment(token: String, momentId: String): MomentLike = error("unused")
    override suspend fun unlikeMoment(token: String, momentId: String) = error("unused")
    override suspend fun createMomentComment(
        token: String,
        momentId: String,
        clientCommentId: String,
        body: String,
        replyToCommentId: String?,
    ): MomentComment = error("unused")
    override suspend fun deleteMomentComment(token: String, commentId: String) = error("unused")
}
