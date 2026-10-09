package com.privatechat.couplechat.feature.moments

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.ui.WechatTopBar
import com.privatechat.couplechat.ui.betweenTextButtonColors

@Composable
fun MomentsScreen(
    state: MomentsState,
    ownProfile: Profile,
    partnerProfile: Profile,
    onBack: () -> Unit,
    onOpenComposer: () -> Unit,
    onRefresh: () -> Unit = {},
    onLike: (String) -> Unit,
    onUnlike: (String) -> Unit,
    onDeleteMoment: (String) -> Unit,
    onCommentDraftChanged: (String, String) -> Unit,
    onComment: (String) -> Unit,
    onDeleteComment: (String) -> Unit,
    onStartComment: (String, String?) -> Unit,
    onCancelReply: (String) -> Unit,
    onToggleExpanded: (String) -> Unit,
    onOpenAuthorProfile: (Profile) -> Unit = {},
    resolveImageUrl: suspend (String) -> String? = { null },
    filterAccountId: String? = null,
    title: String = "朋友圈",
    showComposer: Boolean = true,
) {
    val snackbarHostState = remember { SnackbarHostState() }
    var pendingDeleteMomentId by rememberSaveable { mutableStateOf<String?>(null) }
    var openActionMomentId by rememberSaveable { mutableStateOf<String?>(null) }
    val actionsEnabled = state.busyKeys.isEmpty()
    val visibleItems = filterAccountId?.let { id -> state.items.filter { it.authorId == id } }
        ?: state.items

    LaunchedEffect(state.error) {
        state.error?.takeIf(String::isNotBlank)?.let { snackbarHostState.showSnackbar(it) }
    }

    Scaffold(
        topBar = {
            WechatTopBar(
                title = title,
                onBack = onBack,
                actions = {
                    if (showComposer) {
                        TextButton(onClick = onOpenComposer, colors = betweenTextButtonColors()) {
                            Text("发表")
                        }
                    }
                },
            )
        },
        snackbarHost = { SnackbarHost(snackbarHostState) },
        containerColor = MaterialTheme.colorScheme.surface,
    ) { padding ->
        if (visibleItems.isNotEmpty()) {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .imePadding(),
                contentPadding = padding,
            ) {
                items(visibleItems, key = { it.id }) { moment ->
                    val author = momentProfile(moment.authorId, ownProfile, partnerProfile)
                    if (author != null) {
                        MomentCard(
                            moment = moment,
                            author = author,
                            ownProfile = ownProfile,
                            partnerProfile = partnerProfile,
                            commentDraft = state.commentDrafts[moment.id].orEmpty(),
                            commentEditorOpen = moment.id in state.commentEditorOpen,
                            replyingCommentId = state.replyingTo[moment.id],
                            expandedComments = moment.id in state.expandedComments,
                            actionsEnabled = actionsEnabled,
                            actionMenuOpen = openActionMomentId == moment.id,
                            onToggleActionMenu = {
                                openActionMomentId = toggledMomentActionMenu(
                                    openActionMomentId,
                                    moment.id,
                                )
                            },
                            onDismissActionMenu = { openActionMomentId = null },
                            onOpenProfile = { onOpenAuthorProfile(author) },
                            resolveImageUrl = resolveImageUrl,
                            onLike = { onLike(moment.id) },
                            onUnlike = { onUnlike(moment.id) },
                            onRequestDeleteMoment = { pendingDeleteMomentId = moment.id },
                            onCommentDraftChanged = { onCommentDraftChanged(moment.id, it) },
                            onComment = { onComment(moment.id) },
                            onDeleteComment = onDeleteComment,
                            onStartComment = { replyToCommentId -> onStartComment(moment.id, replyToCommentId) },
                            onCancelReply = { onCancelReply(moment.id) },
                            onToggleExpanded = { onToggleExpanded(moment.id) },
                        )
                    }
                }
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding),
                contentAlignment = Alignment.Center,
            ) {
                when (state.loadState) {
                    MomentsLoadState.NOT_STARTED,
                    MomentsLoadState.LOADING -> CircularProgressIndicator(
                        modifier = Modifier.testTag("moments-loading"),
                    )

                    MomentsLoadState.FAILED -> {
                        Column(horizontalAlignment = Alignment.CenterHorizontally) {
                            Text("加载失败")
                            TextButton(onClick = onRefresh, colors = betweenTextButtonColors()) {
                                Text("重试")
                            }
                        }
                    }

                    MomentsLoadState.LOADED -> Text("还没有动态")
                }
            }
        }
    }

    pendingDeleteMomentId?.let { momentId ->
        AlertDialog(
            onDismissRequest = { pendingDeleteMomentId = null },
            title = { Text("确认删除") },
            text = { Text("删除这条动态？") },
            confirmButton = {
                TextButton(
                    onClick = {
                        pendingDeleteMomentId = null
                        onDeleteMoment(momentId)
                    },
                    modifier = Modifier.testTag("confirm-delete-moment"),
                ) { Text("删除", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(
                    onClick = { pendingDeleteMomentId = null },
                    colors = betweenTextButtonColors(),
                ) { Text("取消") }
            },
        )
    }
}

internal fun toggledMomentActionMenu(current: String?, tapped: String): String? =
    if (current == tapped) null else tapped
