package com.privatechat.couplechat.core.push

import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.SessionManager
import kotlinx.coroutines.CancellationException

data class PushSessionIdentity(
    val accountId: String,
    val sessionVersion: Int,
)

fun Session.pushIdentity(): PushSessionIdentity = PushSessionIdentity(accountId, sessionVersion)

enum class PushRegistrationOutcome { SUCCESS, STALE, RETRY, STOP }

interface PushRegistrationGateway {
    suspend fun register(sessionToken: String, registrationId: String)
    suspend fun unregister(sessionToken: String)
}

interface PushRegistrationLifecycle {
    suspend fun unregister(session: Session)
}

object NoOpPushRegistrationLifecycle : PushRegistrationLifecycle {
    override suspend fun unregister(session: Session) = Unit
}

object NoOpPushRegistrationGateway : PushRegistrationGateway {
    override suspend fun register(sessionToken: String, registrationId: String) = Unit
    override suspend fun unregister(sessionToken: String) = Unit
}

class ChatApiPushRegistrationGateway(
    private val api: ChatApi,
) : PushRegistrationGateway {
    override suspend fun register(sessionToken: String, registrationId: String) {
        api.pushRegister(sessionToken, registrationId)
    }

    override suspend fun unregister(sessionToken: String) {
        api.pushUnregister(sessionToken)
    }
}

class PushRegistrationTask(
    private val sessions: SessionManager,
    private val tokens: PushTokenStore,
    private val gateway: PushRegistrationGateway,
) {
    suspend fun run(identity: PushSessionIdentity): PushRegistrationOutcome {
        if (!sessions.loaded.value) sessions.load()
        val captured = sessions.current() ?: return PushRegistrationOutcome.STALE
        if (captured.pushIdentity() != identity) return PushRegistrationOutcome.STALE
        val registrationId = tokens.read() ?: return PushRegistrationOutcome.STALE

        return try {
            gateway.register(captured.token, registrationId)
            PushRegistrationOutcome.SUCCESS
        } catch (error: CancellationException) {
            throw error
        } catch (error: SessionInvalidException) {
            sessions.clearIfCurrent(captured.token)
            PushRegistrationOutcome.STOP
        } catch (_: Throwable) {
            PushRegistrationOutcome.RETRY
        }
    }
}
