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
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.SessionManager
import com.privatechat.couplechat.core.session.SessionStore
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileRepositoryTest {
    @Test
    fun staleInvalidRefreshCannotClearAReplacementSession() = runTest {
        val fixture = fixture()
        val gate = fixture.api.enqueueProfiles()
        val request = async { runCatching { fixture.repository.refresh() } }
        runCurrent()
        assertTrue(gate.started.isCompleted)

        fixture.sessions.set(otherSession)
        val invalid = SessionInvalidException()
        gate.fail(invalid)

        assertSame(invalid, request.await().exceptionOrNull())
        assertEquals(otherSession, fixture.sessions.current())
    }

    @Test
    fun accountSwitchImmediatelyWithholdsCachedProfiles() = runTest {
        val fixture = fixture()
        fixture.api.profileFeed = profiles("old-her", "old-him")
        fixture.repository.refresh()
        assertEquals(listOf("old-her", "old-him"), fixture.repository.profiles.value.map(Profile::displayName))

        fixture.sessions.set(otherSession)

        assertTrue(fixture.repository.profiles.value.isEmpty())
    }

    @Test
    fun staleRefreshSuccessAfterAccountSwitchIsDiscarded() = runTest {
        val fixture = fixture()
        val gate = fixture.api.enqueueProfiles()
        val request = async { fixture.repository.refresh() }
        runCurrent()

        fixture.sessions.set(otherSession)
        gate.succeed(profiles("private-her", "private-him"))
        request.await()

        assertTrue(fixture.repository.profiles.value.isEmpty())
    }

    @Test
    fun staleProfileUpdateAfterAccountSwitchIsDiscarded() = runTest {
        val fixture = fixture()
        fixture.api.profileFeed = profiles("old-her", "old-him")
        fixture.repository.refresh()
        val gate = fixture.api.gateUpdate()
        val request = async { fixture.repository.updateDisplayName("private-name") }
        runCurrent()

        fixture.sessions.set(otherSession)
        gate.succeed(profile("1001", "private-name"))
        request.await()

        assertTrue(fixture.repository.profiles.value.isEmpty())
    }

    @Test
    fun refreshAndProfileUpdateAreSerializedSoLateRefreshCannotOverwriteUpdate() = runTest {
        val fixture = fixture()
        val refreshGate = fixture.api.enqueueProfiles()
        val updateGate = fixture.api.gateUpdate()
        val refresh = async { fixture.repository.refresh() }
        runCurrent()
        val update = async { fixture.repository.updateDisplayName("new-name") }
        runCurrent()

        assertTrue(refreshGate.started.isCompleted)
        assertFalse(updateGate.started.isCompleted)

        refreshGate.succeed(profiles("old-her", "old-him"))
        refresh.await()
        runCurrent()
        assertTrue(updateGate.started.isCompleted)
        updateGate.succeed(profile("1001", "new-name"))
        update.await()

        assertEquals("new-name", fixture.repository.profiles.value.single { it.accountId == "1001" }.displayName)
    }

    @Test
    fun loadFailureBecomesRetryableAndRetryPublishesProfiles() = runTest {
        val fixture = fixture()
        val gate = fixture.api.enqueueProfiles()
        val first = async { runCatching { fixture.repository.refresh() } }
        runCurrent()
        assertEquals(ProfileLoadState.LOADING, fixture.repository.loadState.value)

        gate.fail(IllegalStateException("offline"))
        first.await()
        assertEquals(ProfileLoadState.FAILED, fixture.repository.loadState.value)
        assertTrue(fixture.repository.profiles.value.isEmpty())

        fixture.api.profileFeed = profiles("retry-her", "retry-him")
        fixture.repository.refresh()

        assertEquals(ProfileLoadState.READY, fixture.repository.loadState.value)
        assertEquals(listOf("retry-her", "retry-him"), fixture.repository.profiles.value.map(Profile::displayName))
    }

    @Test
    fun staleLoadFailureIsNotPublishedToReplacementSession() = runTest {
        val fixture = fixture()
        val gate = fixture.api.enqueueProfiles()
        val request = async { runCatching { fixture.repository.refresh() } }
        runCurrent()

        fixture.sessions.set(otherSession)
        gate.fail(IllegalStateException("old offline"))
        request.await()

        assertEquals(ProfileLoadState.IDLE, fixture.repository.loadState.value)
        assertTrue(fixture.repository.profiles.value.isEmpty())
    }

    @Test
    fun cachedProfilesAreAvailableWithoutNetwork() = runTest {
        val cache = MemoryProfileCacheStore().apply {
            write("1001", profiles("cached-her", "cached-him"))
        }
        val fixture = fixture(cache)

        fixture.repository.primeFromCache(oldSession)

        assertEquals(
            listOf("cached-her", "cached-him"),
            fixture.repository.profiles.value.map(Profile::displayName),
        )
        assertEquals(0, fixture.api.profileCalls)
    }

    @Test
    fun refreshWritesProfilesToCache() = runTest {
        val cache = MemoryProfileCacheStore()
        val fixture = fixture(cache)
        fixture.api.profileFeed = profiles("fresh-her", "fresh-him")

        fixture.repository.refresh()

        assertEquals(
            listOf("fresh-her", "fresh-him"),
            cache.read("1001")?.map(Profile::displayName),
        )
    }

    @Test
    fun accountSwitchDoesNotUseOtherAccountsCache() = runTest {
        val cache = MemoryProfileCacheStore().apply {
            write("1001", profiles("her-cache", "him-cache"))
        }
        val fixture = fixture(cache)

        fixture.repository.primeFromCache(otherSession)

        assertTrue(fixture.repository.profiles.value.isEmpty())
    }

    @Test
    fun entryPreparationWaitsForACompleteProfilePairWhenThereIsNoCache() = runTest {
        val fixture = fixture()
        val gate = fixture.api.enqueueProfiles()
        val request = async { runCatching { fixture.repository.prepareForEntry(oldSession) } }

        runCurrent()
        assertEquals(1, fixture.api.profileCalls)
        assertEquals(ProfileLoadState.LOADING, fixture.repository.loadState.value)
        assertTrue(fixture.repository.profiles.value.isEmpty())

        gate.succeed(profiles("network-her", "network-him"))
        assertTrue(request.await().isSuccess)
        assertTrue(fixture.repository.isReadyForEntry(oldSession))
    }

    @Test
    fun entryPreparationUsesACompleteCacheWithoutNetwork() = runTest {
        val cache = MemoryProfileCacheStore().apply {
            write("1001", profiles("cached-her", "cached-him"))
        }
        val fixture = fixture(cache)

        fixture.repository.prepareForEntry(oldSession)

        assertTrue(fixture.repository.isReadyForEntry(oldSession))
        assertEquals(0, fixture.api.profileCalls)
    }

    @Test
    fun entryPreparationFailureLeavesRetryableStateAndDoesNotExposePlaceholderProfiles() = runTest {
        val fixture = fixture()
        val gate = fixture.api.enqueueProfiles()
        val first = async { runCatching { fixture.repository.prepareForEntry(oldSession) } }

        runCurrent()
        gate.fail(IllegalStateException("offline"))
        assertTrue(first.await().isFailure)
        assertEquals(ProfileLoadState.FAILED, fixture.repository.loadState.value)
        assertTrue(fixture.repository.profiles.value.isEmpty())

        fixture.api.profileFeed = profiles("retry-her", "retry-him")
        fixture.repository.prepareForEntry(oldSession)

        assertTrue(fixture.repository.isReadyForEntry(oldSession))
        assertEquals(listOf("retry-her", "retry-him"), fixture.repository.profiles.value.map(Profile::displayName))
    }

    private suspend fun fixture(): ProfileFixture {
        val api = GatedProfileApi()
        val sessions = SessionManager(MemorySessionStore(oldSession)).also { it.load() }
        return fixture(api, sessions)
    }

    private suspend fun fixture(
        cache: ProfileCacheStore = NoOpProfileCacheStore,
    ): ProfileFixture {
        val api = GatedProfileApi()
        val sessions = SessionManager(MemorySessionStore(oldSession)).also { it.load() }
        val repository = ProfileRepository(api, sessions, AuthRepository(api, sessions), cache)
        return ProfileFixture(api, sessions, repository)
    }

    private suspend fun fixture(
        api: GatedProfileApi,
        sessions: SessionManager,
    ): ProfileFixture {
        val repository = ProfileRepository(api, sessions, AuthRepository(api, sessions))
        return ProfileFixture(api, sessions, repository)
    }

    private companion object {
        val oldSession = Session("1001", "Her", "old-token", 1)
        val otherSession = Session("1002", "Him", "new-token", 2)
    }
}

private data class ProfileFixture(
    val api: GatedProfileApi,
    val sessions: SessionManager,
    val repository: ProfileRepository,
)

private class MemorySessionStore(initial: Session?) : SessionStore {
    private var stored = initial
    override suspend fun read(): Session? = stored
    override suspend fun save(session: Session) { stored = session }
    override suspend fun clear() { stored = null }
}

private class ProfileCallGate<T> {
    val started = CompletableDeferred<Unit>()
    private val result = CompletableDeferred<Result<T>>()
    suspend fun await(): T {
        started.complete(Unit)
        return result.await().getOrThrow()
    }
    fun succeed(value: T) { result.complete(Result.success(value)) }
    fun fail(error: Throwable) { result.complete(Result.failure(error)) }
}

private class GatedProfileApi : ChatApi {
    var profileFeed: List<Profile> = emptyList()
    var profileCalls = 0
    private val profileGates = ArrayDeque<ProfileCallGate<List<Profile>>>()
    private var updateGate: ProfileCallGate<Profile>? = null

    fun enqueueProfiles() = ProfileCallGate<List<Profile>>().also(profileGates::addLast)
    fun gateUpdate() = ProfileCallGate<Profile>().also { updateGate = it }

    override suspend fun profiles(token: String): List<Profile> {
        profileCalls += 1
        return if (profileGates.isEmpty()) profileFeed else profileGates.removeFirst().await()
    }

    override suspend fun updateProfile(token: String, displayName: String): Profile =
        updateGate?.also { updateGate = null }?.await() ?: profile("1001", displayName)

    override suspend fun login(accountId: String, password: String) = error("unused")
    override suspend fun logout(token: String) = Unit
    override suspend fun updateAvatar(token: String, mimeType: String, base64: String) = error("unused")
    override suspend fun changePassword(token: String, current: String, replacement: String) = error("unused")
    override suspend fun send(
        token: String,
        clientMessageId: String,
        body: String,
        replyToMessageId: String?,
        image: ImageMessage?,
    ) = error("unused")
    override suspend fun after(token: String, cursor: MessageCursor?) = error("unused")
    override suspend fun before(token: String, cursor: MessageCursor?) = error("unused")
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

private class MemoryProfileCacheStore : ProfileCacheStore {
    private val map = mutableMapOf<String, List<Profile>>()
    override fun read(accountId: String): List<Profile>? = map[accountId]
    override fun write(accountId: String, profiles: List<Profile>) { map[accountId] = profiles }
    override fun clear(accountId: String) { map.remove(accountId) }
}

private const val profileTimestamp = "2026-08-07T00:00:00Z"
private fun profile(accountId: String, name: String) = Profile(accountId, name, if (accountId == "1001") "女" else "男", null, profileTimestamp)
private fun profiles(her: String, him: String) = listOf(profile("1001", her), profile("1002", him))
