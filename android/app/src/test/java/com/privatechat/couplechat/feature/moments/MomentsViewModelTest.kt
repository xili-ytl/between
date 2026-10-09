@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.feature.moments

import com.privatechat.couplechat.MainDispatcherRule
import com.privatechat.couplechat.core.data.MomentsDataSource
import com.privatechat.couplechat.core.image.ProcessedImage
import com.privatechat.couplechat.core.model.MomentComment
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentVisibility
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MomentsViewModelTest {
    @get:Rule
    val main = MainDispatcherRule()

    @Test
    fun observesItemsAndRefreshesOnlyWhenExplicitlyRequested() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(listOf(moment("cached")))
        val viewModel = MomentsViewModel(source, newClientId = { "client" })
        advanceUntilIdle()

        assertEquals("cached", viewModel.state.value.items.single().id)
        assertEquals(0, source.refreshCalls)

        source.emit(listOf(moment("pushed")))
        advanceUntilIdle()
        assertEquals("pushed", viewModel.state.value.items.single().id)

        viewModel.refresh()
        advanceUntilIdle()
        assertEquals(1, source.refreshCalls)
    }

    @Test
    fun refreshMovesInitialLoadFromNotStartedThroughLoadingToLoaded() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(refreshResult = listOf(moment("fresh")))
        val gate = source.gateRefresh()
        val viewModel = MomentsViewModel(source, newClientId = { "client" })
        advanceUntilIdle()

        assertEquals(MomentsLoadState.NOT_STARTED, viewModel.state.value.loadState)

        viewModel.refresh()
        runCurrent()
        assertEquals(MomentsLoadState.LOADING, viewModel.state.value.loadState)
        assertTrue("refresh" in viewModel.state.value.busyKeys)

        gate.succeed(Unit)
        advanceUntilIdle()
        assertEquals(MomentsLoadState.LOADED, viewModel.state.value.loadState)
        assertEquals("fresh", viewModel.state.value.items.single().id)
        assertFalse("refresh" in viewModel.state.value.busyKeys)
    }

    @Test
    fun failedInitialRefreshShowsFailureAndRetryCanReachLoaded() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(refreshFailures = 1)
        val viewModel = MomentsViewModel(source, newClientId = { "client" })
        advanceUntilIdle()

        viewModel.refresh()
        advanceUntilIdle()
        assertEquals(MomentsLoadState.FAILED, viewModel.state.value.loadState)
        assertEquals("offline", viewModel.state.value.error)

        viewModel.refresh()
        advanceUntilIdle()
        assertEquals(MomentsLoadState.LOADED, viewModel.state.value.loadState)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun refreshAfterACompletedLoadKeepsExistingContentVisible() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(initial = listOf(moment("cached")))
        val viewModel = MomentsViewModel(source, newClientId = { "client" })
        advanceUntilIdle()
        viewModel.refresh()
        advanceUntilIdle()
        assertEquals(MomentsLoadState.LOADED, viewModel.state.value.loadState)

        val gate = source.gateRefresh()
        viewModel.refresh()
        runCurrent()

        assertEquals(MomentsLoadState.LOADED, viewModel.state.value.loadState)
        assertEquals("cached", viewModel.state.value.items.single().id)
        assertTrue("refresh" in viewModel.state.value.busyKeys)

        gate.succeed(Unit)
        advanceUntilIdle()
        assertEquals(MomentsLoadState.LOADED, viewModel.state.value.loadState)
    }

    @Test
    fun publishTrimsUnicodeTextHonorsVisibilityAndValidatesCodePoints() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource()
        val viewModel = MomentsViewModel(source, newClientId = { "post-id" })
        advanceUntilIdle()

        viewModel.setDraft("  hello 🐈  ")
        viewModel.setVisibility(MomentVisibility.SELF)
        viewModel.publish()
        advanceUntilIdle()

        assertEquals(
            listOf(PostCall("post-id", "hello 🐈", MomentVisibility.SELF, hasImage = false)),
            source.created,
        )
        assertEquals("", viewModel.state.value.draft)
        assertEquals(MomentVisibility.PARTNER, viewModel.state.value.visibility)

        viewModel.setDraft("   ")
        viewModel.publish()
        assertNotNull(viewModel.state.value.error)

        viewModel.setDraft("🐈".repeat(2001))
        viewModel.publish()
        assertNotNull(viewModel.state.value.error)
        assertEquals(1, source.created.size)
    }

    @Test
    fun failedPublishKeepsDraftAndReusesIdUntilDraftOrVisibilityChanges() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(createFailures = 3)
        val ids = ArrayDeque(listOf("id-1", "id-2", "id-3"))
        val viewModel = MomentsViewModel(source) { ids.removeFirst() }
        advanceUntilIdle()

        viewModel.setDraft("original")
        viewModel.publish()
        advanceUntilIdle()
        assertEquals("original", viewModel.state.value.draft)
        assertEquals(MomentVisibility.PARTNER, viewModel.state.value.visibility)
        assertNotNull(viewModel.state.value.error)

        viewModel.setDraft("revised")
        assertNull(viewModel.state.value.error)
        viewModel.publish()
        advanceUntilIdle()

        viewModel.setVisibility(MomentVisibility.SELF)
        viewModel.publish()
        advanceUntilIdle()

        viewModel.publish()
        advanceUntilIdle()

        assertEquals(listOf("id-1", "id-2", "id-3", "id-3"), source.created.map { it.clientId })
        assertEquals("", viewModel.state.value.draft)
        assertEquals(MomentVisibility.PARTNER, viewModel.state.value.visibility)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun successfulPublishDoesNotEraseDraftEditedWhileRequestIsInFlight() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource()
        val gate = source.gateCreate()
        val ids = ArrayDeque(listOf("old-id", "new-id"))
        val viewModel = MomentsViewModel(source) { ids.removeFirst() }
        advanceUntilIdle()
        viewModel.setDraft("old draft")

        viewModel.publish()
        runCurrent()
        assertTrue(gate.started.isCompleted)
        viewModel.setDraft("new draft")
        gate.succeed(Unit)
        advanceUntilIdle()

        assertEquals("new draft", viewModel.state.value.draft)
        assertNull(viewModel.state.value.publishCompletionId)
        viewModel.publish()
        advanceUntilIdle()
        assertEquals(listOf("old-id", "new-id"), source.created.map { it.clientId })
        assertEquals("", viewModel.state.value.draft)
    }

    @Test
    fun successfulPublishDoesNotResetVisibilityChangedWhileRequestIsInFlight() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource()
        val gate = source.gateCreate()
        val ids = ArrayDeque(listOf("old-id", "new-id"))
        val viewModel = MomentsViewModel(source) { ids.removeFirst() }
        advanceUntilIdle()
        viewModel.setDraft("same draft")

        viewModel.publish()
        runCurrent()
        viewModel.setVisibility(MomentVisibility.SELF)
        gate.succeed(Unit)
        advanceUntilIdle()

        assertEquals("same draft", viewModel.state.value.draft)
        assertEquals(MomentVisibility.SELF, viewModel.state.value.visibility)
        assertNull(viewModel.state.value.publishCompletionId)
        viewModel.publish()
        advanceUntilIdle()
        assertEquals(listOf("old-id", "new-id"), source.created.map { it.clientId })
        assertEquals(MomentVisibility.PARTNER, viewModel.state.value.visibility)
    }

    @Test
    fun publishCompletionIsRequestScopedAndIndependentFromARefreshFailure() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(refreshFailures = 1)
        val gate = source.gateCreate()
        val viewModel = MomentsViewModel(source) { "publish-request" }
        advanceUntilIdle()
        viewModel.setDraft("original")

        val requestId = viewModel.publish()
        runCurrent()
        assertEquals("publish-request", requestId)
        assertEquals(requestId, viewModel.state.value.publishRequestId)

        viewModel.refresh()
        runCurrent()
        assertNotNull(viewModel.state.value.error)

        gate.succeed(Unit)
        advanceUntilIdle()
        assertEquals("", viewModel.state.value.draft)
        assertEquals(requestId, viewModel.state.value.publishCompletionId)
        assertNull(viewModel.state.value.publishRequestId)

        viewModel.consumePublishCompletion("different-request")
        assertEquals(requestId, viewModel.state.value.publishCompletionId)
        viewModel.consumePublishCompletion(requestId!!)
        assertNull(viewModel.state.value.publishCompletionId)
    }

    @Test
    fun failedPublishHasNoCompletionAndPreservesTheDraft() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(createFailures = 1)
        val viewModel = MomentsViewModel(source) { "failed-request" }
        advanceUntilIdle()
        viewModel.setDraft("keep this")

        assertEquals("failed-request", viewModel.publish())
        advanceUntilIdle()

        assertEquals("keep this", viewModel.state.value.draft)
        assertNull(viewModel.state.value.publishRequestId)
        assertNull(viewModel.state.value.publishCompletionId)
        assertNotNull(viewModel.state.value.error)
    }

    @Test
    fun manuallyClearingDraftWhilePublishingPreventsCompletion() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource()
        val gate = source.gateCreate()
        val viewModel = MomentsViewModel(source) { "cleared-request" }
        advanceUntilIdle()
        viewModel.setDraft("original")

        viewModel.publish()
        runCurrent()
        viewModel.setDraft("")
        gate.succeed(Unit)
        advanceUntilIdle()

        assertEquals("", viewModel.state.value.draft)
        assertNull(viewModel.state.value.publishCompletionId)
    }

    @Test
    fun commentsTrimValidateAndRetryWithAStablePerMomentId() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(commentFailures = 1)
        val ids = ArrayDeque(listOf("comment-1", "comment-2"))
        val viewModel = MomentsViewModel(source) { ids.removeFirst() }
        advanceUntilIdle()
        viewModel.setCommentDraft("moment-1", "  lovely 🐈  ")
        viewModel.setCommentDraft("moment-2", "keep me")

        viewModel.comment("moment-1")
        advanceUntilIdle()
        assertEquals("  lovely 🐈  ", viewModel.state.value.commentDrafts["moment-1"])
        assertNotNull(viewModel.state.value.error)

        viewModel.comment("moment-1")
        advanceUntilIdle()
        assertEquals(listOf("comment-1", "comment-1"), source.comments.map { it.clientId })
        assertEquals(listOf("lovely 🐈", "lovely 🐈"), source.comments.map { it.body })
        assertFalse(viewModel.state.value.commentDrafts.containsKey("moment-1"))
        assertEquals("keep me", viewModel.state.value.commentDrafts["moment-2"])

        viewModel.setCommentDraft("moment-2", " ")
        viewModel.comment("moment-2")
        assertNotNull(viewModel.state.value.error)
        viewModel.setCommentDraft("moment-2", "🐈".repeat(501))
        viewModel.comment("moment-2")
        assertEquals(2, source.comments.size)
    }

    @Test
    fun editingOneCommentResetsOnlyThatCommentsPendingId() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(commentFailures = 2)
        val ids = ArrayDeque(listOf("id-a", "id-b", "id-c"))
        val viewModel = MomentsViewModel(source) { ids.removeFirst() }
        advanceUntilIdle()
        viewModel.setCommentDraft("moment-a", "a")
        viewModel.setCommentDraft("moment-b", "b")

        viewModel.comment("moment-a")
        advanceUntilIdle()
        viewModel.comment("moment-b")
        advanceUntilIdle()

        viewModel.setCommentDraft("moment-a", "a edited")
        viewModel.comment("moment-a")
        viewModel.comment("moment-b")
        advanceUntilIdle()

        assertEquals(
            listOf(
                CommentCall("moment-a", "id-a", "a"),
                CommentCall("moment-b", "id-b", "b"),
                CommentCall("moment-a", "id-c", "a edited"),
                CommentCall("moment-b", "id-b", "b"),
            ),
            source.comments,
        )
        assertTrue(viewModel.state.value.commentDrafts.isEmpty())
    }

    @Test
    fun replySendsWithReplyTargetAndClearsEditorState() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(listOf(moment("moment-a")))
        val viewModel = MomentsViewModel(source, newClientId = { "id-r" })
        advanceUntilIdle()

        viewModel.startComment("moment-a", "1001_root-comment")
        viewModel.setCommentDraft("moment-a", "hello")
        viewModel.comment("moment-a")
        advanceUntilIdle()

        assertEquals(CommentCall("moment-a", "id-r", "hello", "1001_root-comment"), source.comments.single())
        assertTrue("moment-a" !in viewModel.state.value.commentEditorOpen)
        assertTrue(viewModel.state.value.replyingTo.isEmpty())
        assertTrue(viewModel.state.value.commentDrafts.isEmpty())
    }

    @Test
    fun plainCommentClearsReplyTarget() = runTest(main.dispatcher) {
        val viewModel = MomentsViewModel(FakeMomentsDataSource(), newClientId = { "id" })
        advanceUntilIdle()

        viewModel.startComment("moment-a", null)
        assertTrue("moment-a" in viewModel.state.value.commentEditorOpen)
        assertTrue(viewModel.state.value.replyingTo.isEmpty())

        viewModel.cancelReply("moment-a")
        assertTrue("moment-a" in viewModel.state.value.commentEditorOpen)
    }

    @Test
    fun hasUnseenDetectsNewMomentsAndInteractionsAfterSeenCursor() {
        val base = "2026-08-09T00:00:00.000Z"
        assertFalse(hasUnseenMoments(emptyList(), base))

        val oldMoment = moment("m1").copy(createdAt = "2026-08-09T00:00:01.000Z")
        assertTrue(hasUnseenMoments(listOf(oldMoment), base))

        // 动态本身早于已读，但互动晚于已读
        val interacted = moment("m2").copy(
            createdAt = "2026-08-08T00:00:00.000Z",
            likes = listOf(com.privatechat.couplechat.core.model.MomentLike("l1", "m2", "1002", "2026-08-09T00:00:02.000Z")),
        )
        assertTrue(hasUnseenMoments(listOf(interacted), base))

        // 全部早于已读 → 无未读
        val allSeen = listOf(oldMoment, interacted).map {
            it.copy(createdAt = "2026-08-08T00:00:00.000Z", likes = emptyList(), comments = emptyList())
        }
        assertFalse(hasUnseenMoments(allSeen, base))
    }

    @Test
    fun togglingExpandCommentsTogglesExpandedSet() = runTest(main.dispatcher) {
        val viewModel = MomentsViewModel(FakeMomentsDataSource(), newClientId = { "id" })
        advanceUntilIdle()

        viewModel.toggleExpandComments("moment-a")
        assertTrue("moment-a" in viewModel.state.value.expandedComments)
        viewModel.toggleExpandComments("moment-a")
        assertTrue("moment-a" !in viewModel.state.value.expandedComments)
    }

    @Test
    fun successfulCommentDoesNotEraseDraftEditedWhileRequestIsInFlight() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource()
        val gate = source.gateComment()
        val ids = ArrayDeque(listOf("old-id", "new-id"))
        val viewModel = MomentsViewModel(source) { ids.removeFirst() }
        advanceUntilIdle()
        viewModel.setCommentDraft("moment-1", "old comment")

        viewModel.comment("moment-1")
        runCurrent()
        assertTrue(gate.started.isCompleted)
        viewModel.setCommentDraft("moment-1", "new comment")
        gate.succeed(Unit)
        advanceUntilIdle()

        assertEquals("new comment", viewModel.state.value.commentDrafts["moment-1"])
        viewModel.comment("moment-1")
        advanceUntilIdle()
        assertEquals(listOf("old-id", "new-id"), source.comments.map { it.clientId })
        assertFalse(viewModel.state.value.commentDrafts.containsKey("moment-1"))
    }

    @Test
    fun reactionAndDeleteTapsShareOneBusyKeyPerMoment() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource()
        val gate = CompletableDeferred<Unit>()
        source.likeGate = gate
        val viewModel = MomentsViewModel(source, newClientId = { "id" })
        advanceUntilIdle()

        viewModel.like("moment-1")
        runCurrent()
        viewModel.like("moment-1")
        viewModel.unlike("moment-1")
        viewModel.delete("moment-1")
        assertTrue("reaction-or-delete:moment-1" in viewModel.state.value.busyKeys)
        assertEquals(listOf("moment-1"), source.liked)
        assertTrue(source.unliked.isEmpty())
        assertTrue(source.deleted.isEmpty())

        gate.complete(Unit)
        advanceUntilIdle()
        assertFalse("reaction-or-delete:moment-1" in viewModel.state.value.busyKeys)
    }

    @Test
    fun momentActionsDelegateAndFailuresPreserveItemsAndDrafts() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(listOf(moment("old")))
        val viewModel = MomentsViewModel(source, newClientId = { "id" })
        advanceUntilIdle()
        viewModel.setDraft("post draft")
        viewModel.setCommentDraft("moment-1", "comment draft")

        viewModel.like("moment-1")
        viewModel.unlike("moment-2")
        viewModel.delete("moment-3")
        viewModel.deleteComment("comment-4")
        advanceUntilIdle()

        assertEquals(listOf("moment-1"), source.liked)
        assertEquals(listOf("moment-2"), source.unliked)
        assertEquals(listOf("moment-3"), source.deleted)
        assertEquals(listOf("comment-4"), source.deletedComments)

        source.deleteFailures = 1
        viewModel.delete("moment-5")
        advanceUntilIdle()
        assertNotNull(viewModel.state.value.error)
        assertEquals("old", viewModel.state.value.items.single().id)
        assertEquals("post draft", viewModel.state.value.draft)
        assertEquals("comment draft", viewModel.state.value.commentDrafts["moment-1"])

        viewModel.setCommentDraft("moment-1", "edited")
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun failedRefreshKeepsObservedItems() = runTest(main.dispatcher) {
        val source = FakeMomentsDataSource(listOf(moment("old")), refreshFailures = 1)
        val viewModel = MomentsViewModel(source, newClientId = { "id" })
        advanceUntilIdle()

        viewModel.refresh()
        advanceUntilIdle()

        assertEquals("old", viewModel.state.value.items.single().id)
        assertNotNull(viewModel.state.value.error)
    }
}

private data class PostCall(
    val clientId: String,
    val body: String,
    val visibility: MomentVisibility,
    val hasImage: Boolean,
)

private data class CommentCall(
    val momentId: String,
    val clientId: String,
    val body: String,
    val replyToCommentId: String? = null,
)

private class FakeMomentsDataSource(
    initial: List<MomentItem> = emptyList(),
    var createFailures: Int = 0,
    var commentFailures: Int = 0,
    var refreshFailures: Int = 0,
    private val refreshResult: List<MomentItem>? = null,
) : MomentsDataSource {
    private val mutableMoments = MutableStateFlow(initial)
    override val moments: StateFlow<List<MomentItem>> = mutableMoments

    val created = mutableListOf<PostCall>()
    val deleted = mutableListOf<String>()
    val liked = mutableListOf<String>()
    val unliked = mutableListOf<String>()
    val comments = mutableListOf<CommentCall>()
    val deletedComments = mutableListOf<String>()
    var refreshCalls = 0
    var deleteFailures = 0
    var likeGate: CompletableDeferred<Unit>? = null
    private var createGate: CallGate<Unit>? = null
    private var commentGate: CallGate<Unit>? = null
    private var refreshGate: CallGate<Unit>? = null

    fun gateCreate() = CallGate<Unit>().also { createGate = it }

    fun gateComment() = CallGate<Unit>().also { commentGate = it }

    fun gateRefresh() = CallGate<Unit>().also { refreshGate = it }

    fun emit(items: List<MomentItem>) {
        mutableMoments.value = items
    }

    override suspend fun refresh() {
        refreshCalls++
        refreshGate?.also { refreshGate = null }?.await()
        if (refreshFailures-- > 0) error("offline")
        refreshResult?.let { mutableMoments.value = it }
    }

    override suspend fun create(clientId: String, body: String, visibility: MomentVisibility, image: ProcessedImage?) {
        created += PostCall(clientId, body, visibility, image != null)
        createGate?.also { createGate = null }?.await()
        if (createFailures-- > 0) error("offline")
    }

    override suspend fun delete(momentId: String) {
        deleted += momentId
        if (deleteFailures-- > 0) error("offline")
    }

    override suspend fun like(momentId: String) {
        liked += momentId
        likeGate?.await()
    }

    override suspend fun unlike(momentId: String) {
        unliked += momentId
    }

    override suspend fun comment(momentId: String, clientId: String, body: String, replyToCommentId: String?) {
        comments += CommentCall(momentId, clientId, body, replyToCommentId)
        commentGate?.also { commentGate = null }?.await()
        if (commentFailures-- > 0) error("offline")
    }

    override suspend fun deleteComment(commentId: String) {
        deletedComments += commentId
    }
}

private class CallGate<T> {
    val started = CompletableDeferred<Unit>()
    private val result = CompletableDeferred<T>()

    suspend fun await(): T {
        started.complete(Unit)
        return result.await()
    }

    fun succeed(value: T) {
        result.complete(value)
    }
}

private const val timestamp = "2026-08-07T00:00:00Z"

private fun moment(id: String) = MomentItem(
    id = id,
    authorId = "1001",
    clientMomentId = "client-$id",
    body = id,
    visibility = MomentVisibility.PARTNER,
    createdAt = timestamp,
    likes = emptyList(),
    comments = emptyList<MomentComment>(),
)
