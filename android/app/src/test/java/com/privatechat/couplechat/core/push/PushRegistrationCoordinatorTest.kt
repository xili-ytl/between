@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.core.push

import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.session.InMemorySessionStore
import com.privatechat.couplechat.core.session.SessionManager
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class PushRegistrationCoordinatorTest {
    private val session = Session("1002", "示例甲", "session-token", 7)

    @Test
    fun tokenBeforeSessionSchedulesWhenSessionAppears() = runTest {
        val fixture = fixture(null)
        fixture.coordinator.start()
        runCurrent()

        fixture.coordinator.onRegistered("registration-id")
        runCurrent()
        assertEquals(emptyList<PushSessionIdentity>(), fixture.scheduler.enqueued)

        fixture.sessions.set(session)
        runCurrent()

        assertEquals(listOf(session.pushIdentity()), fixture.scheduler.enqueued)
    }

    @Test
    fun sessionBeforeTokenSchedulesWhenTokenArrives() = runTest {
        val fixture = fixture(session)
        fixture.coordinator.start()
        runCurrent()

        fixture.coordinator.onRegistered("registration-id")
        runCurrent()

        assertEquals(listOf(session.pushIdentity()), fixture.scheduler.enqueued)
    }

    @Test
    fun duplicateBindingCallbackIsDeduplicated() = runTest {
        val fixture = fixture(session, "registration-id")
        fixture.coordinator.start()
        runCurrent()

        fixture.coordinator.onRegistered("registration-id")
        fixture.coordinator.onRegistered("registration-id")
        runCurrent()

        assertEquals(listOf(session.pushIdentity()), fixture.scheduler.enqueued)
    }

    @Test
    fun newTokenAndNewSessionReplaceTheUniqueWork() = runTest {
        val fixture = fixture(session, "registration-one")
        fixture.coordinator.start()
        runCurrent()

        fixture.coordinator.onRegistered("registration-two")
        runCurrent()
        val replacement = Session("1002", "示例甲", "replacement-token", 8)
        fixture.sessions.set(replacement)
        runCurrent()

        assertEquals(
            listOf(session.pushIdentity(), session.pushIdentity(), replacement.pushIdentity()),
            fixture.scheduler.enqueued,
        )
    }

    @Test
    fun logoutCancelsUniqueRegistrationWork() = runTest {
        val fixture = fixture(session, "registration-id")
        fixture.coordinator.start()
        runCurrent()

        fixture.sessions.clear()
        runCurrent()

        assertEquals(1, fixture.scheduler.cancellations)
        assertEquals(1, fixture.provider.resumes.size)
        assertEquals(1, fixture.provider.stops.size)
        assertEquals(listOf(AliasCall("1002", 1)), fixture.provider.deletes)
    }

    @Test
    fun aliasIsAttemptedOnlyWhenConnectedWithAnAccount() = runTest {
        val fixture = fixture(null, "registration-id")
        fixture.coordinator.start()
        fixture.coordinator.onConnected(true)
        runCurrent()
        assertEquals(emptyList<AliasCall>(), fixture.provider.aliases)

        fixture.sessions.set(session)
        runCurrent()

        assertEquals(listOf(AliasCall("1002", 1)), fixture.provider.aliases)
    }

    @Test
    fun explicitAliasFailureGetsOneBoundedRetry() = runTest {
        val fixture = fixture(session, "registration-id")
        fixture.coordinator.start()
        fixture.coordinator.onConnected(true)
        runCurrent()
        assertEquals(listOf(AliasCall("1002", 1)), fixture.provider.aliases)

        fixture.coordinator.onAliasResult(sequence = 1, errorCode = 6002)
        runCurrent()
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(listOf(AliasCall("1002", 1), AliasCall("1002", 2)), fixture.provider.aliases)

        fixture.coordinator.onAliasResult(sequence = 2, errorCode = 6002)
        advanceTimeBy(60_000)
        runCurrent()

        assertEquals(listOf(AliasCall("1002", 1), AliasCall("1002", 2)), fixture.provider.aliases)
    }

    @Test
    fun successfulOrStaleAliasCallbackDoesNotRetry() = runTest {
        val fixture = fixture(session, "registration-id")
        fixture.coordinator.start()
        fixture.coordinator.onConnected(true)
        runCurrent()

        fixture.coordinator.onAliasResult(sequence = 999, errorCode = 6002)
        fixture.coordinator.onAliasResult(sequence = 1, errorCode = 0)
        advanceTimeBy(60_000)
        runCurrent()

        assertEquals(listOf(AliasCall("1002", 1)), fixture.provider.aliases)
    }

    private suspend fun kotlinx.coroutines.test.TestScope.fixture(
        initialSession: Session?,
        initialRegistrationId: String? = null,
        gateway: PushRegistrationGateway = NoOpPushRegistrationGateway,
    ): CoordinatorFixture {
        val sessions = SessionManager(InMemorySessionStore(initialSession)).also { it.load() }
        val provider = RecordingProvider(initialRegistrationId)
        val tokens = CoordinatorTokenStore(initialRegistrationId)
        val scheduler = RecordingScheduler()
        val coordinator = PushRegistrationCoordinator(
            sessions = sessions,
            tokens = tokens,
            provider = provider,
            scheduler = scheduler,
            gateway = gateway,
            scope = backgroundScope,
            aliasRetryDelayMs = 30_000,
        )
        return CoordinatorFixture(sessions, provider, scheduler, coordinator)
    }
}

private data class CoordinatorFixture(
    val sessions: SessionManager,
    val provider: RecordingProvider,
    val scheduler: RecordingScheduler,
    val coordinator: PushRegistrationCoordinator,
)

private data class AliasCall(val accountId: String, val sequence: Int)

private class RecordingProvider(
    private var registrationId: String?,
) : PushProvider {
    val aliases = mutableListOf<AliasCall>()
    val deletes = mutableListOf<AliasCall>()
    val resumes = mutableListOf<Unit>()
    val stops = mutableListOf<Unit>()
    override fun initialize() = Unit
    override fun currentRegistrationId(): String? = registrationId
    override fun setAlias(accountId: String, sequence: Int) {
        aliases += AliasCall(accountId, sequence)
    }
    override fun deleteAlias(accountId: String, sequence: Int) {
        deletes += AliasCall(accountId, sequence)
    }
    override fun resumePush() {
        resumes += Unit
    }
    override fun stopPush() {
        stops += Unit
    }
}

private class CoordinatorTokenStore(initial: String?) : PushTokenStore {
    private var value = initial
    override fun read(): String? = value
    override fun save(registrationId: String) { value = registrationId }
    override fun clear() { value = null }
}

private class RecordingScheduler : PushWorkScheduler {
    val enqueued = mutableListOf<PushSessionIdentity>()
    var cancellations = 0
    override fun enqueue(identity: PushSessionIdentity) { enqueued += identity }
    override fun cancel() { cancellations += 1 }
}
