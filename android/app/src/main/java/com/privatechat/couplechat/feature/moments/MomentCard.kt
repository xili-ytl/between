package com.privatechat.couplechat.feature.moments

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.IntOffset
import androidx.compose.foundation.layout.width
import androidx.compose.ui.unit.IntRect
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupPositionProvider
import coil3.compose.AsyncImage
import com.privatechat.couplechat.R
import com.privatechat.couplechat.core.model.MomentComment
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.CopyableText
import com.privatechat.couplechat.ui.betweenTextButtonColors
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val MomentBlue = Color(0xFF576B95)
private val MomentActionBackground = Color(0xFF4C5157)
private val MomentInteractionBackground = Color(0xFFF3F3F5)

@Composable
fun MomentCard(
    moment: MomentItem,
    author: Profile,
    ownProfile: Profile,
    partnerProfile: Profile,
    commentDraft: String,
    commentEditorOpen: Boolean,
    replyingCommentId: String?,
    expandedComments: Boolean,
    actionsEnabled: Boolean,
    actionMenuOpen: Boolean,
    onToggleActionMenu: () -> Unit,
    onDismissActionMenu: () -> Unit,
    onOpenProfile: () -> Unit = {},
    resolveImageUrl: suspend (String) -> String? = { null },
    onLike: () -> Unit,
    onUnlike: () -> Unit,
    onRequestDeleteMoment: () -> Unit,
    onCommentDraftChanged: (String) -> Unit,
    onComment: () -> Unit,
    onDeleteComment: (String) -> Unit,
    onStartComment: (String?) -> Unit,
    onCancelReply: () -> Unit,
    onToggleExpanded: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val isOwnPost = canDeleteMoment(moment.authorId, ownProfile)
    val ownLike = moment.likes.any { it.accountId == ownProfile.accountId }
    val likeNames = moment.likes.mapNotNull { like ->
        momentProfile(like.accountId, ownProfile, partnerProfile)?.displayName
    }.distinct()
    val visibleComments = moment.comments.mapNotNull { comment ->
        momentProfile(comment.authorId, ownProfile, partnerProfile)?.let { it to comment }
    }
    fun commentLineCount(comment: MomentComment): Int {
        val name = momentProfile(comment.authorId, ownProfile, partnerProfile)?.displayName ?: ""
        val replied = moment.repliedCommentName(comment, ownProfile, partnerProfile)
        return estimatedCommentLines(commentDisplayText(name, replied, comment.body, compactMomentTime(comment.createdAt)))
    }
    val shownComments = if (expandedComments) moment.comments
    else collapsedCommentSelection(moment.comments, COMMENT_LINE_BUDGET, ::commentLineCount)
    val hasHiddenComments = shownComments.size < moment.comments.size
    val replyingCommentName = replyingCommentId?.let { repliedId ->
        moment.comments.find { it.id == repliedId }?.authorId
            ?.let { repliedAuthorId -> momentProfile(repliedAuthorId, ownProfile, partnerProfile)?.displayName }
    }
    val focusRequester = remember { FocusRequester() }
    val keyboardController = LocalSoftwareKeyboardController.current
    val actionMenuGapPx = with(LocalDensity.current) { 6.dp.roundToPx() }
    val actionMenuPositionProvider = remember(actionMenuGapPx) {
        MomentActionMenuPositionProvider(actionMenuGapPx)
    }

    LaunchedEffect(commentEditorOpen) {
        if (commentEditorOpen) {
            focusRequester.requestFocus()
            keyboardController?.show()
        }
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .testTag(if (isOwnPost) "moment-card-own" else "moment-card-partner")
            .padding(horizontal = 16.dp, vertical = 14.dp),
        horizontalArrangement = Arrangement.spacedBy(12.dp),
        verticalAlignment = Alignment.Top,
    ) {
        ProfileAvatar(
            author,
            44.dp,
            modifier = Modifier.clickable(onClick = onOpenProfile),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = author.displayName,
                style = MaterialTheme.typography.titleMedium,
                color = MomentBlue,
                fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clickable(onClick = onOpenProfile),
            )
            CopyableText(
                text = AnnotatedString(moment.body),
                copyText = moment.body,
                onLongPress = onDismissActionMenu,
                modifier = Modifier.padding(top = 4.dp),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurface,
            )
            if (moment.imageFileId != null) {
                MomentCardImage(moment, resolveImageUrl)
            }
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = compactMomentTime(moment.createdAt),
                    style = MaterialTheme.typography.labelMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                if (isOwnPost) {
                    TextButton(
                        onClick = onRequestDeleteMoment,
                        enabled = actionsEnabled,
                        contentPadding = PaddingValues(horizontal = 8.dp),
                        modifier = Modifier.testTag("delete-moment-${moment.id}"),
                    ) {
                        Text("删除", color = MomentBlue)
                    }
                }
                Spacer(Modifier.weight(1f))
                Box(
                    modifier = Modifier
                        .size(width = 38.dp, height = 28.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(MomentInteractionBackground)
                        .testTag("action-menu-${moment.id}")
                        .clickable(enabled = actionsEnabled, onClick = onToggleActionMenu),
                    contentAlignment = Alignment.Center,
                ) {
                    if (actionMenuOpen) {
                        Popup(
                            popupPositionProvider = actionMenuPositionProvider,
                            onDismissRequest = onDismissActionMenu,
                        ) {
                            Row(
                                modifier = Modifier
                                    .height(36.dp)
                                    .clip(RoundedCornerShape(4.dp))
                                    .background(MomentActionBackground),
                                verticalAlignment = Alignment.CenterVertically,
                            ) {
                                TextButton(
                                    onClick = {
                                        if (ownLike) onUnlike() else onLike()
                                        onDismissActionMenu()
                                    },
                                    enabled = actionsEnabled,
                                    contentPadding = PaddingValues(horizontal = 14.dp),
                                    modifier = Modifier.height(36.dp),
                                ) {
                                    Row(
                                        horizontalArrangement = Arrangement.spacedBy(6.dp),
                                        verticalAlignment = Alignment.CenterVertically,
                                    ) {
                                        Icon(
                                            painter = painterResource(R.drawable.phosphor_ic_heart),
                                            contentDescription = null,
                                            tint = Color.White,
                                            modifier = Modifier.size(17.dp),
                                        )
                                        Text(if (ownLike) "取消" else "赞", color = Color.White)
                                    }
                                }
                                VerticalDivider(
                                    modifier = Modifier.height(18.dp),
                                    color = Color.White.copy(alpha = 0.2f),
                                )
                                TextButton(
                                    onClick = {
                                        onStartComment(null)
                                        onDismissActionMenu()
                                    },
                                    enabled = actionsEnabled,
                                    contentPadding = PaddingValues(horizontal = 14.dp),
                                    modifier = Modifier.height(36.dp),
                                ) {
                                    Text("评论", color = Color.White)
                                }
                            }
                        }
                    }
                    Icon(
                        painter = painterResource(R.drawable.ic_dots_two_horizontal),
                        contentDescription = "赞和评论",
                        tint = Color.Unspecified,
                        modifier = Modifier.size(20.dp),
                    )
                }
            }

            if (likeNames.isNotEmpty() || visibleComments.isNotEmpty()) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp)
                        .clip(RoundedCornerShape(3.dp))
                        .background(MomentInteractionBackground),
                ) {
                    if (likeNames.isNotEmpty()) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("moment-like-summary")
                                .padding(horizontal = 10.dp, vertical = 7.dp),
                            horizontalArrangement = Arrangement.spacedBy(6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Icon(
                                painter = painterResource(R.drawable.phosphor_ic_heart),
                                contentDescription = null,
                                tint = MomentBlue,
                                modifier = Modifier.size(17.dp),
                            )
                            Text(
                                text = likeNames.joinToString("、"),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MomentBlue,
                            )
                        }
                    }
                    if (likeNames.isNotEmpty() && visibleComments.isNotEmpty()) {
                        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
                    }
                    shownComments.forEach { comment ->
                        val commentAuthor = momentProfile(comment.authorId, ownProfile, partnerProfile)
                        if (commentAuthor != null) {
                            val canDelete = canDeleteComment(comment.authorId, ownProfile)
                            val repliedName = moment.repliedCommentName(comment, ownProfile, partnerProfile)
                            key(comment.id) {
                                Row(
                                    modifier = Modifier
                                        .fillMaxWidth()
                                        .testTag(if (canDelete) "comment-own" else "comment-partner")
                                        .padding(start = 10.dp, end = 4.dp, top = 3.dp, bottom = 3.dp),
                                    verticalAlignment = Alignment.Top,
                                ) {
                                    CopyableText(
                                        text = commentAnnotated(commentAuthor, repliedName, comment.body, compactMomentTime(comment.createdAt)),
                                        copyText = comment.body,
                                        onLongPress = onDismissActionMenu,
                                        onClick = { if (!canDelete) onStartComment(comment.id) },
                                        // 微信对齐：只能点击回复他人的评论；自己的评论点击不进入回复（只能删除）
                                        modifier = Modifier
                                            .weight(1f)
                                            .testTag("reply-to-${comment.id}"),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurface,
                                    )
                                    if (canDelete) {
                                        TextButton(
                                            onClick = { onDeleteComment(comment.id) },
                                            enabled = actionsEnabled,
                                            contentPadding = PaddingValues(horizontal = 6.dp),
                                            modifier = Modifier.testTag("delete-comment-${comment.id}"),
                                        ) {
                                            Text("删除", color = MomentBlue)
                                        }
                                    }
                                }
                            }
                        }
                    }
                    if (hasHiddenComments) {
                        Text(
                            text = "展开全部 ${moment.comments.size} 条评论",
                            modifier = Modifier
                                .padding(start = 10.dp, top = 2.dp, bottom = 4.dp)
                                .clickable(onClick = onToggleExpanded)
                                .testTag("expand-comments-${moment.id}"),
                            style = MaterialTheme.typography.labelMedium,
                            color = MomentBlue,
                        )
                    }
                }
            }

            if (commentEditorOpen) {
                Column(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 8.dp),
                ) {
                    if (replyingCommentId != null) {
                        Row(
                            modifier = Modifier
                                .fillMaxWidth()
                                .testTag("comment-reply-indicator-${moment.id}"),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Text(
                                text = if (replyingCommentName != null) "回复 @$replyingCommentName" else "回复",
                                modifier = Modifier.weight(1f),
                                style = MaterialTheme.typography.labelMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                            TextButton(
                                onClick = onCancelReply,
                                colors = betweenTextButtonColors(),
                            ) {
                                Text("取消")
                            }
                        }
                    }
                    Row(
                        modifier = Modifier
                            .fillMaxWidth(),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                    ) {
                        BasicTextField(
                            value = commentDraft,
                            onValueChange = onCommentDraftChanged,
                            modifier = Modifier
                                .weight(1f)
                                .height(40.dp)
                                .clip(RoundedCornerShape(4.dp))
                                .background(MomentInteractionBackground)
                                .padding(horizontal = 10.dp, vertical = 9.dp)
                                .focusRequester(focusRequester)
                                .testTag("comment-input-${moment.id}")
                                .semantics { contentDescription = "评论内容" },
                            singleLine = true,
                            enabled = actionsEnabled,
                            textStyle = MaterialTheme.typography.bodyMedium.copy(
                                color = MaterialTheme.colorScheme.onSurface,
                            ),
                            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
                        )
                        TextButton(
                            onClick = {
                                onComment()
                                keyboardController?.hide()
                            },
                            enabled = actionsEnabled && commentDraft.isNotBlank(),
                            colors = betweenTextButtonColors(),
                            modifier = Modifier.testTag("comment-submit-${moment.id}"),
                        ) {
                            Text("发送")
                        }
                    }
                }
            }
        }
    }
    HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
}

internal fun momentProfile(
    accountId: String,
    ownProfile: Profile,
    partnerProfile: Profile,
): Profile? = when (accountId) {
    ownProfile.accountId -> ownProfile
    partnerProfile.accountId -> partnerProfile
    else -> null
}

internal fun canDeleteMoment(authorId: String, ownProfile: Profile): Boolean =
    authorId == ownProfile.accountId

internal fun canDeleteComment(authorId: String, ownProfile: Profile): Boolean =
    authorId == ownProfile.accountId

/** 评论折叠时的行数预算（约 6 行，可调） */
const val COMMENT_LINE_BUDGET = 6

/** 评论块单行可容纳的字符数估算（14sp 在 ~252dp 宽块内的 CJK 密度） */
private const val COMMENT_CHARS_PER_LINE = 22

private fun MomentItem.repliedCommentName(
    comment: MomentComment,
    ownProfile: Profile,
    partnerProfile: Profile,
): String? = comment.replyToCommentId
    ?.let { repliedId -> comments.find { it.id == repliedId }?.authorId }
    ?.let { repliedAuthorId -> momentProfile(repliedAuthorId, ownProfile, partnerProfile)?.displayName }

/** 评论折叠时估算单条评论显示的行数 */
fun estimatedCommentLines(text: String): Int =
    maxOf(1, (text.length + COMMENT_CHARS_PER_LINE - 1) / COMMENT_CHARS_PER_LINE)

/** 从最新往前累计行数，选出行数预算内的评论（保持时间序）；全放得下则返回全部 */
fun collapsedCommentSelection(
    comments: List<MomentComment>,
    budget: Int,
    linesOf: (MomentComment) -> Int,
): List<MomentComment> {
    if (comments.isEmpty()) return comments
    var used = 0
    val selected = mutableListOf<MomentComment>()
    for (comment in comments.asReversed()) {
        val lineCount = linesOf(comment)
        if (selected.isNotEmpty() && used + lineCount > budget) break
        selected.add(comment)
        used += lineCount
    }
    return selected.asReversed()
}

private fun commentDisplayText(authorName: String, repliedName: String?, body: String, time: String): String {
    val reply = if (repliedName == null) "" else " 回复 $repliedName"
    return "$authorName$reply：$body $time"
}

@Composable
private fun commentAnnotated(
    commentAuthor: Profile,
    repliedName: String?,
    body: String,
    time: String,
): AnnotatedString {
    val onSurface = MaterialTheme.colorScheme.onSurface
    val onSurfaceVariant = MaterialTheme.colorScheme.onSurfaceVariant
    // 用不换行空格拼接时间，保证「08-08 14:30」作为一个整体换行、绝不拆成两行
    val timeAtomic = time.replace(" ", " ")
    return buildAnnotatedString {
        pushStyle(SpanStyle(color = MomentBlue, fontWeight = FontWeight.SemiBold))
        append(commentAuthor.displayName)
        if (repliedName != null) {
            pushStyle(SpanStyle(color = onSurface, fontWeight = FontWeight.Normal))
            append(" 回复 ")
            pop()
            pushStyle(SpanStyle(color = MomentBlue, fontWeight = FontWeight.SemiBold))
            append(repliedName)
        }
        pop()
        pushStyle(SpanStyle(color = onSurface, fontWeight = FontWeight.Normal))
        append("：$body ")
        pop()
        pushStyle(SpanStyle(color = onSurfaceVariant, fontSize = 12.sp))
        append(timeAtomic)
        pop()
    }
}

private val momentTimeFormatter = DateTimeFormatter.ofPattern("MM-dd HH:mm")
    .withZone(ZoneId.systemDefault())

internal fun compactMomentTime(value: String): String =
    runCatching { momentTimeFormatter.format(Instant.parse(value)) }.getOrDefault("")

private class MomentActionMenuPositionProvider(
    private val gapPx: Int,
) : PopupPositionProvider {
    override fun calculatePosition(
        anchorBounds: IntRect,
        windowSize: IntSize,
        layoutDirection: LayoutDirection,
        popupContentSize: IntSize,
    ): IntOffset {
        val desiredX = anchorBounds.left - popupContentSize.width - gapPx
        val maxX = (windowSize.width - popupContentSize.width).coerceAtLeast(0)
        val x = desiredX.coerceIn(0, maxX)
        val desiredY = anchorBounds.top + (anchorBounds.height - popupContentSize.height) / 2
        val maxY = (windowSize.height - popupContentSize.height).coerceAtLeast(0)
        return IntOffset(x, desiredY.coerceIn(0, maxY))
    }
}

@Composable
private fun MomentCardImage(moment: MomentItem, resolveImageUrl: suspend (String) -> String?) {
    var imageUrl by remember(moment.imageFileId) { mutableStateOf<String?>(null) }
    LaunchedEffect(moment.imageFileId) {
        val fileId = moment.imageFileId
        imageUrl = if (fileId == null) null else resolveImageUrl(fileId)
    }
    val url = imageUrl
    if (url != null) {
        AsyncImage(
            model = url,
            contentDescription = "朋友圈图片",
            contentScale = ContentScale.Fit,
            modifier = Modifier
                .padding(top = 8.dp)
                .width(200.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Color(0xFFF0F0F0)),
        )
    } else {
        Box(
            modifier = Modifier
                .padding(top = 8.dp)
                .width(200.dp)
                .height(140.dp)
                .clip(RoundedCornerShape(4.dp))
                .background(Color(0xFFF0F0F0)),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        }
    }
}
