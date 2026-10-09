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
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class MomentsRepositoryTest {
    @Test
    fun refreshReplacesItemsOnlyAfterASuccessfulResponse() = runTest {
        val api = FakeMomentsApi(feed = listOf(moment("first")))
        val fixture = repository(api)

        fixture.repository.refresh()
        assertEquals(listOf("first"), fixture.repository.moments.value.map { it.id })

        val failure = IllegalStateException("offline")
        api.momentsFailure = failure
        val result = runCatching { fixture.repository.refresh() }

        assertSame(failure, result.exceptionOrNull())
        assertEquals(listOf("first"), fixture.repository.moments.value.map { it.id })
    }

    @Test
    fun everyMutationCallsItsExactEndpointThenRefreshes() = runTest {
        val api = FakeMomentsApi(feed = listOf(moment("refreshed")))
        val fixture = repository(api)

        fixture.repository.create("post-client", "hello", MomentVisibility.SELF)
        fixture.repository.delete("moment-1")
        fixture.repository.like("moment-2")
        fixture.repository.unlike("moment-3")
        fixture.repository.comment("moment-4", "comment-client", "nice")
        fixture.repository.deleteComment("comment-5")

        assertEquals(
            listOf(
                "create:token:post-client:hello:SELF:none",
                "refresh:token",
                "delete:token:moment-1",
                "refresh:token",
                "like:token:moment-2",
                "refresh:token",
                "unlike:token:moment-3",
                "refresh:token",
                "comment:token:moment-4:comment-client:nice:",
                "refresh:token",
                "delete-comment:token:comment-5",
                "refresh:token",
            ),
            api.calls,
        )
        assertEquals("refreshed", fixture.repository.moments.value.single().id)
    }

    @Test
    fun failedRefreshAfterMutationRetainsOldItemsAndPropagates() = runTest {
        val api = FakeMomentsApi(feed = listOf(moment("old")))
        val fixture = repository(api)
        fixture.repository.refresh()
        api.momentsFailure = IllegalStateException("refresh failed")

        val result = runCatching { fixture.repository.like("moment-1") }

        assertEquals("refresh failed", result.exceptionOrNull()?.message)
        assertEquals(listOf("like:token:moment-1", "refresh:token"), api.calls.takeLast(2))
        assertEquals("old", fixture.repository.moments.value.single().id)
    }

    @Test
    fun invalidSessionClearsLocalSessionAndRethrows() = runTest {
        val invalid = SessionInvalidException()
        val api = FakeMomentsApi(mutationFailure = invalid)
        val fixture = repository(api)

        val result = runCatching {
            fixture.repository.create("post-client", "hello", MomentVisibility.PARTNER)
        }

        assertSame(invalid, result.exceptionOrNull())
        assertNull(fixture.sessions.current())
        assertEquals(1, fixture.store.clearCount)
        assertEquals(listOf("create:token:post-client:hello:PARTNER:none"), api.calls)
    }

    @Test
    fun nonSessionFailureDoesNotClearSessionOrRefresh() = runTest {
        val failure = IllegalStateException("offline")
        val api = FakeMomentsApi(mutationFailure = failure)
        val fixture = repository(api)

        val result = runCatching { fixture.repository.delete("moment-1") }

        assertSame(failure, result.exceptionOrNull())
        assertEquals(session, fixture.sessions.current())
        assertEquals(0, fixture.store.clearCount)
        assertEquals(listOf("delete:token:moment-1"), api.calls)
    }

    @Test
    fun missingSessionFailsBeforeCallingTheApi() = runTest {
        val api = FakeMomentsApi()
        val fixture = repository(api, initialSession = null)

        val result = runCatching { fixture.repository.refresh() }

        assertTrue(result.exceptionOrNull() is SessionInvalidException)
        assertTrue(api.calls.isEmpty())
        assertEquals(0, fixture.store.clearCount)
    }

    @Test
    fun switchingSessionImmediatelyHidesTheBoundFeedFromValuesAndCollectors() = runTest {
        val api = FakeMomentsApi(feed = listOf(moment("self", visibility = MomentVisibility.SELF)))
        val fixture = repository(api)
        val emissions = mutableListOf<List<MomentItem>>()
        backgroundScope.launch {
            fixture.repository.moments.collect { emissions += it }
        }
        runCurrent()
        fixture.repository.refresh()
        runCurrent()
        assertEquals("self", fixture.repository.moments.value.single().id)

        fixture.sessions.clear()
        fixture.sessions.set(otherSession)
        runCurrent()

        assertTrue(fixture.repository.moments.value.isEmpty())
        assertTrue(emissions.last().isEmpty())

        val replacementRepository = MomentsRepository(api, fixture.sessions, otherSession)
        assertTrue(replacementRepository.moments.value.isEmpty())
        api.momentsFailure = IllegalStateException("offline")
        runCatching { replacementRepository.refresh() }

        assertTrue(replacementRepository.moments.value.isEmpty())
        assertTrue(fixture.repository.moments.value.isEmpty())
    }

    @Test
    fun staleInvalidRequestCannotClearAReplacementSession() = runTest {
        val api = FakeMomentsApi()
        val gate = api.enqueueMomentsCall()
        val fixture = repository(api)
        val request = async { runCatching { fixture.repository.refresh() } }
        runCurrent()
        assertTrue(gate.started.isCompleted)

        fixture.sessions.set(otherSession)
        val invalid = SessionInvalidException()
        gate.fail(invalid)

        assertSame(invalid, request.await().exceptionOrNull())
        assertEquals(otherSession, fixture.sessions.current())
        assertEquals(0, fixture.store.clearCount)
        assertTrue(fixture.repository.moments.value.isEmpty())
    }

    @Test
    fun refreshesAreSerializedSoTheNewestCallFinishesLast() = runTest {
        val api = FakeMomentsApi()
        val firstGate = api.enqueueMomentsCall()
        val secondGate = api.enqueueMomentsCall()
        val fixture = repository(api)

        val first = async { fixture.repository.refresh() }
        runCurrent()
        assertTrue(firstGate.started.isCompleted)
        val second = async { fixture.repository.refresh() }
        runCurrent()
        assertFalse(secondGate.started.isCompleted)

        firstGate.succeed(listOf(moment("older")))
        first.await()
        runCurrent()
        assertTrue(secondGate.started.isCompleted)
        secondGate.succeed(listOf(moment("newer")))
        second.await()

        assertEquals("newer", fixture.repository.moments.value.single().id)
    }

    @Test
    fun sessionSwitchWhileRefreshIsPendingDiscardsTheStaleResponse() = runTest {
        val api = FakeMomentsApi()
        val gate = api.enqueueMomentsCall()
        val fixture = repository(api)
        val request = async { fixture.repository.refresh() }
        runCurrent()

        fixture.sessions.set(otherSession)
        gate.succeed(listOf(moment("private", visibility = MomentVisibility.SELF)))
        request.await()

        assertTrue(fixture.repository.moments.value.isEmpty())
        fixture.sessions.set(session)
        assertTrue(fixture.repository.moments.value.isEmpty())
    }

    @Test
    fun mutationAndRefreshUseOneCapturedSessionAndDiscardAfterASwitch() = runTest {
        val api = FakeMomentsApi(feed = listOf(moment("private", visibility = MomentVisibility.SELF)))
        val createGate = api.gateCreate()
        val fixture = repository(api)
        val request = async {
            fixture.repository.create("post-client", "hello", MomentVisibility.SELF)
        }
        runCurrent()
        assertTrue(createGate.started.isCompleted)

        fixture.sessions.set(otherSession)
        createGate.succeed(Unit)
        request.await()

        assertEquals(
            listOf(
                "create:token:post-client:hello:SELF:none",
                "refresh:token",
            ),
            api.calls,
        )
        assertTrue(fixture.repository.moments.value.isEmpty())
    }

    private suspend fun repository(
        api: FakeMomentsApi,
        initialSession: Session? = session,
        boundSession: Session = session,
    ): RepositoryFixture {
        val store = TrackingSessionStore(initialSession)
        val sessions = SessionManager(store).also { it.load() }
        return RepositoryFixture(MomentsRepository(api, sessions, boundSession), sessions, store)
    }

    private companion object {
        val session = Session("1001", "Her", "token", 1)
        val otherSession = Session("1002", "Him", "new-token", 2)
    }
}

private data class RepositoryFixture(
    val repository: MomentsRepository,
    val sessions: SessionManager,
    val store: TrackingSessionStore,
)

private class TrackingSessionStore(initial: Session?) : SessionStore {
    private var stored = initial
    var clearCount = 0

    override suspend fun read(): Session? = stored

    override suspend fun save(session: Session) {
        stored = session
    }

    override suspend fun clear() {
        clearCount++
        stored = null
    }
}

private class FakeMomentsApi(
    var feed: List<MomentItem> = emptyList(),
    var momentsFailure: Throwable? = null,
    var mutationFailure: Throwable? = null,
) : ChatApi {
    val calls = mutableListOf<String>()
    private val momentsGates = ArrayDeque<CallGate<List<MomentItem>>>()
    private var createGate: CallGate<Unit>? = null

    fun enqueueMomentsCall() = CallGate<List<MomentItem>>().also(momentsGates::addLast)

    fun gateCreate() = CallGate<Unit>().also { createGate = it }

    override suspend fun moments(token: String): List<MomentItem> {
        calls += "refresh:$token"
        if (momentsGates.isNotEmpty()) {
            return momentsGates.removeFirst().await()
        }
        momentsFailure?.let { throw it }
        return feed
    }

    override suspend fun createMoment(
        token: String,
        clientMomentId: String,
        body: String,
        visibility: MomentVisibility,
        image: ImageMessage?,
    ): MomentItem {
        calls += "create:$token:$clientMomentId:$body:$visibility:${image?.imageFileId ?: "none"}"
        createGate?.also { createGate = null }?.await()
        mutationFailure?.let { throw it }
        return moment("created", clientMomentId = clientMomentId, body = body, visibility = visibility)
    }

    override suspend fun deleteMoment(token: String, momentId: String) {
        calls += "delete:$token:$momentId"
        mutationFailure?.let { throw it }
    }

    override suspend fun likeMoment(token: String, momentId: String): MomentLike {
        calls += "like:$token:$momentId"
        mutationFailure?.let { throw it }
        return MomentLike("like-1", momentId, "1001", timestamp)
    }

    override suspend fun unlikeMoment(token: String, momentId: String) {
        calls += "unlike:$token:$momentId"
        mutationFailure?.let { throw it }
    }

    override suspend fun createMomentComment(
        token: String,
        momentId: String,
        clientCommentId: String,
        body: String,
        replyToCommentId: String?,
    ): MomentComment {
        calls += "comment:$token:$momentId:$clientCommentId:$body:${replyToCommentId ?: ""}"
        mutationFailure?.let { throw it }
        return MomentComment("comment-1", momentId, "1001", clientCommentId, body, replyToCommentId, timestamp)
    }

    override suspend fun deleteMomentComment(token: String, commentId: String) {
        calls += "delete-comment:$token:$commentId"
        mutationFailure?.let { throw it }
    }

    override suspend fun login(accountId: String, password: String): Session = error("unused")
    override suspend fun logout(token: String) = error("unused")
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
}

private class CallGate<T> {
    val started = CompletableDeferred<Unit>()
    private val result = CompletableDeferred<Result<T>>()

    suspend fun await(): T {
        started.complete(Unit)
        return result.await().getOrThrow()
    }

    fun succeed(value: T) {
        result.complete(Result.success(value))
    }

    fun fail(error: Throwable) {
        result.complete(Result.failure(error))
    }
}

private const val timestamp = "2026-08-07T00:00:00Z"

private fun moment(
    id: String,
    clientMomentId: String = "client-$id",
    body: String = id,
    visibility: MomentVisibility = MomentVisibility.PARTNER,
) = MomentItem(
    id = id,
    authorId = "1001",
    clientMomentId = clientMomentId,
    body = body,
    visibility = visibility,
    createdAt = timestamp,
    likes = emptyList(),
    comments = emptyList(),
)
