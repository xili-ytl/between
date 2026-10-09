package com.privatechat.couplechat.feature.moments

import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.hasAnyDescendant
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import com.privatechat.couplechat.core.model.MomentComment
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentLike
import com.privatechat.couplechat.core.model.MomentVisibility
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.ui.BetweenTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class MomentsScreenTest {
    @get:Rule
    val compose = createComposeRule()

    private val own = profile("1001", "示例乙")
    private val partner = profile("1002", "示例甲")

    @Test
    fun postAndCommentTextOfferCopyWithoutEnteringReply() {
        setFeed(state = populatedState())
        compose.onNodeWithText("今天也要好好吃饭").performTouchInput { longClick() }
        compose.onNodeWithText("复制").assertExists()
        compose.onNodeWithText("选择文字").performClick()
        compose.onNodeWithTag("text-selection-content").assertExists()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithTag("reply-to-partner-comment").performTouchInput { longClick() }
        compose.onNodeWithText("复制").assertExists()
        compose.onNodeWithTag("comment-input-own-post").assertDoesNotExist()
        compose.onNodeWithText("选择文字").performClick()
        compose.onNodeWithText("你也是").assertExists()
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithTag("reply-to-partner-comment").performClick()
        compose.onNodeWithTag("comment-input-own-post").assertExists()
    }

    @Test
    fun feedUsesNamesAndScopesPostAndCommentDeletionToTheSignedInAuthor() {
        var deletedMoment: String? = null
        var deletedComment: String? = null

        setFeed(
            state = populatedState(),
            onDeleteMoment = { deletedMoment = it },
            onDeleteComment = { deletedComment = it },
        )

        compose.onNodeWithText("示例乙").assertExists()
        compose.onNodeWithText("示例甲").assertExists()
        compose.onAllNodesWithText("1001", substring = true).assertCountEquals(0)
        compose.onAllNodesWithText("1002", substring = true).assertCountEquals(0)

        compose.onNode(hasTestTag("moment-card-own") and hasAnyDescendant(hasText("删除"))).assertExists()
        compose.onNode(hasTestTag("moment-card-partner") and hasAnyDescendant(hasText("删除"))).assertDoesNotExist()
        compose.onNode(hasTestTag("comment-own") and hasAnyDescendant(hasText("删除"))).assertExists()
        compose.onNode(hasTestTag("comment-partner") and hasAnyDescendant(hasText("删除"))).assertDoesNotExist()

        compose.onNodeWithTag("delete-moment-own-post").performClick()
        compose.onNodeWithText("确认删除").assertExists()
        compose.onNodeWithTag("confirm-delete-moment").performClick()
        compose.onNodeWithTag("delete-comment-own-comment").performClick()
        compose.runOnIdle {
            assertEquals("own-post", deletedMoment)
            assertEquals("own-comment", deletedComment)
        }
    }

    @Test
    fun twoDotMenuInvokesLikeUnlikeAndRevealsCommentEditorOnDemand() {
        val likes = mutableListOf<String>()
        val unlikes = mutableListOf<String>()
        val drafts = mutableListOf<Pair<String, String>>()
        val comments = mutableListOf<String>()
        setFeed(
            state = populatedState(),
            onLike = likes::add,
            onUnlike = unlikes::add,
            onCommentDraftChanged = { id, value -> drafts += id to value },
            onComment = comments::add,
        )

        compose.onNodeWithTag("comment-input-own-post").assertDoesNotExist()
        compose.onNodeWithTag("action-menu-own-post").performClick()
        compose.onNodeWithText("赞").performClick()
        compose.onNodeWithTag("action-menu-partner-post").performClick()
        compose.onNodeWithText("取消").performClick()
        compose.onNodeWithTag("action-menu-own-post").performClick()
        compose.onNodeWithText("评论").performClick()
        compose.onNodeWithTag("comment-input-own-post").assertExists()
        compose.onNodeWithTag("comment-input-own-post").performTextInput("晚安")
        compose.onNodeWithTag("comment-submit-own-post").performClick()

        compose.runOnIdle {
            assertEquals(listOf("own-post"), likes)
            assertEquals(listOf("partner-post"), unlikes)
            assertTrue(drafts.contains("own-post" to "晚安"))
            assertEquals(listOf("own-post"), comments)
        }
        compose.onNodeWithContentDescription("赞和评论").assertExists()
    }

    @Test
    fun emptyFeedHasTheSingleApprovedEmptyState() {
        var backed = false
        var composing = false
        setFeed(
            state = MomentsState(loadState = MomentsLoadState.LOADED),
            onBack = { backed = true },
            onOpenComposer = { composing = true },
        )

        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithText("发表").performClick()
        compose.runOnIdle {
            assertTrue(backed)
            assertTrue(composing)
        }
        compose.onAllNodesWithText("还没有动态").assertCountEquals(1)
        compose.onNodeWithText("暂无动态", substring = true).assertDoesNotExist()
        forbiddenLabels.forEach { compose.onNodeWithText(it, substring = true).assertDoesNotExist() }
    }

    @Test
    fun initialFeedShowsLoadingWithoutClaimingItIsEmpty() {
        setFeed(state = MomentsState())

        compose.onNodeWithTag("moments-loading").assertExists()
        compose.onNodeWithText("还没有动态").assertDoesNotExist()
    }

    @Test
    fun failedInitialFeedOffersRetry() {
        var refreshCalls = 0
        setFeed(
            state = MomentsState(loadState = MomentsLoadState.FAILED, error = "offline"),
            onRefresh = { refreshCalls++ },
        )

        compose.onNodeWithText("加载失败").assertExists()
        compose.onNodeWithText("重试").performClick()
        compose.runOnIdle { assertEquals(1, refreshCalls) }
    }

    @Test
    fun composerHasExactlyTwoVisibilityChoicesAndInvokesDraftVisibilityAndPublishActions() {
        var draft = ""
        var visibility: MomentVisibility? = null
        var publishCalls = 0
        var cancelled = false

        compose.setContent {
            BetweenTheme {
                MomentComposerScreen(
                    state = MomentsState(),
                    onCancel = { cancelled = true },
                    onDraftChanged = { draft = it },
                    onVisibilityChanged = { visibility = it },
                    onImageSelected = {},
                    onClearImage = {},
                    onPublish = {
                        publishCalls++
                        "request-id"
                    },
                    onPublishCompletionConsumed = {},
                    onPublished = {},
                )
            }
        }

        compose.onAllNodesWithText("对方可见").assertCountEquals(1)
        compose.onAllNodesWithText("仅自己可见").assertCountEquals(1)
        compose.onNodeWithTag("moment-body-input").performTextInput("只写文字")
        compose.onNodeWithText("仅自己可见").performClick()
        compose.onNodeWithText("发表").performClick()
        compose.onNodeWithText("取消").performClick()
        compose.runOnIdle {
            assertEquals("只写文字", draft)
            assertEquals(MomentVisibility.SELF, visibility)
            assertEquals(1, publishCalls)
            assertTrue(cancelled)
        }
        forbiddenLabels.forEach { compose.onNodeWithText(it, substring = true).assertDoesNotExist() }
    }

    @Test
    fun composerRestoresItsExactPendingRequestAndClosesAfterSuccess() {
        var state by mutableStateOf(MomentsState(draft = "original"))
        val consumed = mutableListOf<String>()
        var closeCalls = 0
        val restoration = StateRestorationTester(compose)
        restoration.setContent {
            BetweenTheme {
                MomentComposerScreen(
                    state = state,
                    onCancel = {},
                    onDraftChanged = {},
                    onVisibilityChanged = {},
                    onImageSelected = {},
                    onClearImage = {},
                    onPublish = { "request-restored" },
                    onPublishCompletionConsumed = consumed::add,
                    onPublished = { closeCalls++ },
                )
            }
        }

        compose.onNodeWithText("发表").performClick()
        compose.runOnIdle {
            state = state.copy(
                publishRequestId = "request-restored",
                busyKeys = setOf("publish"),
            )
        }
        restoration.emulateSavedInstanceStateRestore()
        compose.runOnIdle {
            state = state.copy(
                draft = "",
                publishRequestId = null,
                publishCompletionId = "request-restored",
                busyKeys = emptySet(),
            )
        }
        compose.waitForIdle()

        compose.runOnIdle {
            assertEquals(listOf("request-restored"), consumed)
            assertEquals(1, closeCalls)
        }
    }

    @Test
    fun aFreshComposerDoesNotConsumeAStalePublishCompletion() {
        var consumed = false
        var closed = false
        compose.setContent {
            BetweenTheme {
                MomentComposerScreen(
                    state = MomentsState(publishCompletionId = "stale-request"),
                    onCancel = {},
                    onDraftChanged = {},
                    onVisibilityChanged = {},
                    onImageSelected = {},
                    onClearImage = {},
                    onPublish = { null },
                    onPublishCompletionConsumed = { consumed = true },
                    onPublished = { closed = true },
                )
            }
        }

        compose.runOnIdle {
            assertFalse(consumed)
            assertFalse(closed)
        }
    }

    private fun setFeed(
        state: MomentsState,
        onRefresh: () -> Unit = {},
        onBack: () -> Unit = {},
        onOpenComposer: () -> Unit = {},
        onLike: (String) -> Unit = {},
        onUnlike: (String) -> Unit = {},
        onDeleteMoment: (String) -> Unit = {},
        onCommentDraftChanged: (String, String) -> Unit = { _, _ -> },
        onComment: (String) -> Unit = {},
        onDeleteComment: (String) -> Unit = {},
        onStartComment: (String, String?) -> Unit = { _, _ -> },
        onCancelReply: (String) -> Unit = {},
        onToggleExpanded: (String) -> Unit = {},
    ) {
        compose.setContent {
            BetweenTheme {
                MomentsScreen(
                    state = state,
                    onRefresh = onRefresh,
                    ownProfile = own,
                    partnerProfile = partner,
                    onBack = onBack,
                    onOpenComposer = onOpenComposer,
                    onLike = onLike,
                    onUnlike = onUnlike,
                    onDeleteMoment = onDeleteMoment,
                    onCommentDraftChanged = onCommentDraftChanged,
                    onComment = onComment,
                    onDeleteComment = onDeleteComment,
                    onStartComment = onStartComment,
                    onCancelReply = onCancelReply,
                    onToggleExpanded = onToggleExpanded,
                )
            }
        }
    }

    private fun populatedState() = MomentsState(
        items = listOf(
            MomentItem(
                id = "own-post",
                authorId = "1001",
                clientMomentId = "own-client",
                body = "今天也要好好吃饭",
                visibility = MomentVisibility.PARTNER,
                createdAt = "2026-08-07T08:09:10Z",
                likes = emptyList(),
                comments = listOf(
                    comment("own-comment", "1001", "记住啦"),
                    comment("partner-comment", "1002", "你也是"),
                ),
            ),
            MomentItem(
                id = "partner-post",
                authorId = "1002",
                clientMomentId = "partner-client",
                body = "晚风很好",
                visibility = MomentVisibility.PARTNER,
                createdAt = "2026-08-06T08:09:10Z",
                likes = listOf(MomentLike("like", "partner-post", "1001", "2026-08-06T08:10:10Z")),
                comments = emptyList(),
            ),
        ),
    )

    private fun profile(id: String, name: String) = Profile(
        accountId = id,
        displayName = name,
        gender = "",
        updatedAt = "2026-08-07T00:00:00Z",
    )

    private fun comment(id: String, authorId: String, body: String) = MomentComment(
        id = id,
        momentId = "own-post",
        authorId = authorId,
        clientCommentId = "client-$id",
        body = body,
        createdAt = "2026-08-07T08:11:10Z",
    )

    private val forbiddenLabels = listOf(
        "照片", "视频", "位置", "链接", "转发", "钱包", "群组", "教程", "@",
    )
}
