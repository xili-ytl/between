package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.push.NoOpPushRegistrationLifecycle
import com.privatechat.couplechat.core.push.PushRegistrationLifecycle
import com.privatechat.couplechat.core.session.SessionManager
import com.privatechat.couplechat.feature.login.LoginGateway
import kotlinx.coroutines.CancellationException

class AuthRepository(
    private val api: ChatApi,
    private val sessions: SessionManager,
    private val pushRegistration: PushRegistrationLifecycle = NoOpPushRegistrationLifecycle,
) : LoginGateway {
    override suspend fun login(accountId: String, password: String): Session {
        val session = api.login(accountId, password)
        sessions.set(session)
        return session
    }

    suspend fun logout() {
        val captured = sessions.current()
        try {
            if (captured != null) {
                try {
                    pushRegistration.unregister(captured)
                } catch (error: CancellationException) {
                    throw error
                } catch (_: Throwable) {
                    // Push unregistration is best effort and cannot block account logout.
                }
                api.logout(captured.token)
            }
        } finally {
            if (captured != null) sessions.clearIfCurrent(captured.token)
        }
    }
}
