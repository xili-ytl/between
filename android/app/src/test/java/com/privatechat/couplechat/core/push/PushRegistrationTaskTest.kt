package com.privatechat.couplechat.core.push

import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.InMemorySessionStore
import com.privatechat.couplechat.core.session.SessionManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.fail
import org.junit.Test

class PushRegistrationTaskTest {
    private val session = Session("1002", "示例甲", "session-token", 7)

    @Test
    fun matchingSessionAndRegistrationIdAreRegistered() = runTest {
        val sessions = loadedSessions(session)
        val tokens = MemoryPushTokenStore("registration-id")
        val gateway = RecordingGateway()

        val outcome = PushRegistrationTask(sessions, tokens, gateway).run(session.pushIdentity())

        assertEquals(PushRegistrationOutcome.SUCCESS, outcome)
        assertEquals(listOf("session-token" to "registration-id"), gateway.registrations)
    }

    @Test
    fun missingSessionIsStaleWithoutNetworkAccess() = runTest {
        val gateway = RecordingGateway()

        val outcome = PushRegistrationTask(
            loadedSessions(null),
            MemoryPushTokenStore("registration-id"),
            gateway,
        ).run(session.pushIdentity())

        assertEquals(PushRegistrationOutcome.STALE, outcome)
        assertEquals(emptyList<Pair<String, String>>(), gateway.registrations)
    }

    @Test
    fun missingRegistrationIdIsStaleWithoutNetworkAccess() = runTest {
        val gateway = RecordingGateway()

        val outcome = PushRegistrationTask(
            loadedSessions(session),
            MemoryPushTokenStore(),
            gateway,
        ).run(session.pushIdentity())

        assertEquals(PushRegistrationOutcome.STALE, outcome)
        assertEquals(emptyList<Pair<String, String>>(), gateway.registrations)
    }

    @Test
    fun wrongAccountOrSessionVersionIsStale() = runTest {
        val gateway = RecordingGateway()
        val task = PushRegistrationTask(
            loadedSessions(session),
            MemoryPushTokenStore("registration-id"),
            gateway,
        )

        assertEquals(PushRegistrationOutcome.STALE, task.run(PushSessionIdentity("1001", 7)))
        assertEquals(PushRegistrationOutcome.STALE, task.run(PushSessionIdentity("1002", 8)))
        assertEquals(emptyList<Pair<String, String>>(), gateway.registrations)
    }

    @Test
    fun transientFailureRequestsWorkManagerRetry() = runTest {
        val sessions = loadedSessions(session)
        val gateway = RecordingGateway { error("temporary network failure") }

        val outcome = PushRegistrationTask(
            sessions,
            MemoryPushTokenStore("registration-id"),
            gateway,
        ).run(session.pushIdentity())

        assertEquals(PushRegistrationOutcome.RETRY, outcome)
        assertEquals(session, sessions.current())
    }

    @Test
    fun invalidSessionStopsAndClearsOnlyTheCapturedSession() = runTest {
        val sessions = loadedSessions(session)
        val gateway = RecordingGateway { throw SessionInvalidException() }

        val outcome = PushRegistrationTask(
            sessions,
            MemoryPushTokenStore("registration-id"),
            gateway,
        ).run(session.pushIdentity())

        assertEquals(PushRegistrationOutcome.STOP, outcome)
        assertNull(sessions.current())
    }

    @Test
    fun lateInvalidResponseCannotClearAReplacementSession() = runTest {
        val sessions = loadedSessions(session)
        val replacement = Session("1002", "示例甲", "replacement-token", 8)
        val gateway = RecordingGateway {
            sessions.set(replacement)
            throw SessionInvalidException()
        }

        val outcome = PushRegistrationTask(
            sessions,
            MemoryPushTokenStore("registration-id"),
            gateway,
        ).run(session.pushIdentity())

        assertEquals(PushRegistrationOutcome.STOP, outcome)
        assertEquals(replacement, sessions.current())
    }

    @Test
    fun cancellationIsRethrown() = runTest {
        val cancellation = CancellationException("cancelled")
        val task = PushRegistrationTask(
            loadedSessions(session),
            MemoryPushTokenStore("registration-id"),
            RecordingGateway { throw cancellation },
        )

        try {
            task.run(session.pushIdentity())
            fail("cancellation must be rethrown")
        } catch (thrown: CancellationException) {
            assertSame(cancellation, thrown)
        }
    }
}

private suspend fun loadedSessions(session: Session?): SessionManager =
    SessionManager(InMemorySessionStore(session)).also { it.load() }

private class MemoryPushTokenStore(initial: String? = null) : PushTokenStore {
    private var value = initial
    override fun read(): String? = value
    override fun save(registrationId: String) { value = registrationId }
    override fun clear() { value = null }
}

private class RecordingGateway(
    private val behavior: suspend () -> Unit = {},
) : PushRegistrationGateway {
    val registrations = mutableListOf<Pair<String, String>>()

    override suspend fun register(sessionToken: String, registrationId: String) {
        registrations += sessionToken to registrationId
        behavior()
    }

    override suspend fun unregister(sessionToken: String) = Unit
}
