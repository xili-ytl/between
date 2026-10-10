@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package com.privatechat.couplechat.feature.chat

import android.net.Uri
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.ime
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.OutlinedTextField
import com.privatechat.couplechat.core.model.IMAGE_MESSAGE_PLACEHOLDER
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.snapshotFlow
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.input.nestedscroll.NestedScrollConnection
import androidx.compose.ui.input.nestedscroll.NestedScrollSource
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.OffsetMapping
import androidx.compose.ui.text.input.TextFieldValue
import androidx.compose.ui.text.input.TransformedText
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.semantics.CustomAccessibilityAction
import androidx.compose.ui.semantics.customActions
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.repeatOnLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import coil3.compose.AsyncImage
import com.privatechat.couplechat.R
import com.privatechat.couplechat.core.data.SyncStatus
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.core.text.ChatRichText
import com.privatechat.couplechat.core.text.prepareChatMarkdown
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.WenliAvatar
import com.privatechat.couplechat.ui.TextSelectionDialog
import com.privatechat.couplechat.ui.WechatTopBar
import com.privatechat.couplechat.ui.WechatUiMetrics
import com.privatechat.couplechat.ui.betweenTextButtonColors
import com.privatechat.couplechat.ui.betweenOutlinedTextFieldColors
import java.time.Instant
import kotlinx.coroutines.launch

private val ComposerBackground = Color(0xFFF7F7F7)
private val ComposerFieldBackground = Color.White
private val WechatGreen = Color(0xFF07C160)
private val ImagePlaceholderColor = Color(0xFF8A8A8E)

/** 小Q的专属蓝（与蓝企鹅头像一致），只用于 @小Q 提及本身。 */
private val WenliBlue = Color(0xFF1E88E5)

private val WenliMentionPattern = Regex("(?:^|[\\s，,：:])@小Q(?=$|[\\s，,：:])")

/**
 * 把正文里的 `@小Q` 提及标蓝，其余文字保持原色。
 *
 * 性能：绝大多数消息不含提及，这种情况返回 null（不分配 AnnotatedString，
 * 也不打断 Text 的字符串快路径）；调用方配合 remember 避免重复计算。
 */
private fun annotatedWenliMention(body: String): AnnotatedString? {
    val match = WenliMentionPattern.find(body) ?: return null
    val start = match.range.first + if (body[match.range.first] == '@') 0 else 1
    val end = start + WENLI_DISPLAY_NAME.length + 1
    return buildAnnotatedString {
        append(body)
        addStyle(SpanStyle(color = WenliBlue, fontWeight = FontWeight.SemiBold), start, end)
    }
}

/** 按正文缓存高亮结果；无提及（返回 null）时走普通文本渲染。 */
@Composable
private fun WenliMentionText(body: String, fontSize: TextUnit, repairMalformedGeneratedFences: Boolean = false) {
    val richTextPlan = remember(body, repairMalformedGeneratedFences) {
        prepareChatMarkdown(body, repairMalformedGeneratedFences)
    }
    if (richTextPlan.markdown != null) {
        ChatRichText(
            markdown = richTextPlan.markdown,
            textSize = fontSize,
            textColor = MaterialTheme.colorScheme.onSurface,
            mentionColor = WenliBlue,
            requiresHorizontalScroll = richTextPlan.requiresHorizontalScroll,
            segments = richTextPlan.segments,
        )
        return
    }

    val annotated = remember(body) { annotatedWenliMention(body) }
    if (annotated == null) {
        Text(body, fontSize = fontSize, color = MaterialTheme.colorScheme.onSurface)
    } else {
        Text(annotated, fontSize = fontSize)
    }
}

/** 输入框里把 `@小Q` 提及也标蓝，与气泡保持一致。 */
private class WenliMentionHighlight : VisualTransformation {
    override fun filter(text: AnnotatedString): TransformedText {
        val mention = annotatedWenliMention(text.text) ?: return TransformedText(text, OffsetMapping.Identity)
        return TransformedText(mention, OffsetMapping.Identity)
    }
}

private sealed interface ChatTimelineItem {
    val key: String

    data class Time(val label: String, val messageId: String) : ChatTimelineItem {
        override val key: String = "time-$messageId"
    }

    data class Message(val value: ChatMessage) : ChatTimelineItem {
        override val key: String = value.id
    }
}

@Composable
fun ChatScreen(
    state: ChatState,
    ownProfile: Profile,
    partner: Profile,
    onInputChanged: (String) -> Unit,
    onSend: () -> Unit,
    onRetry: () -> Unit,
    onClearError: () -> Unit = {},
    onLoadOlder: () -> Unit,
    onBack: () -> Unit,
    onOpenInfo: () -> Unit = {},
    onOpenProfile: () -> Unit = {},
    onOpenOwnProfile: () -> Unit = {},
    onImageSelected: (Uri) -> Unit = {},
    resolveImageUrl: suspend (String) -> String? = { null },
    onQuote: (ChatMessage) -> Unit = {},
    onMentionWenli: () -> Unit = {},
    onCancelQuote: () -> Unit = {},
    onFocusConsumed: () -> Unit = {},
    onConfirmPendingImage: () -> Unit = {},
    onPendingImageCaptionChanged: (String) -> Unit = {},
    onCancelPendingImage: () -> Unit = {},
    onSaveImage: (ChatMessage) -> Unit = {},
    onMessageVisible: (MessageCursor) -> Unit = {},
) {
    val listState = rememberLazyListState()
    val timeline = remember(state.messages) { buildTimeline(state.messages) }
    val displayedTimeline = remember(timeline) { timeline.asReversed() }
    var previousLatestId by remember { mutableStateOf<String?>(null) }
    val latestId = state.messages.lastOrNull()?.id
    val density = LocalDensity.current
    val keyboardVisible = WindowInsets.ime.getBottom(density) > 0
    val keyboardController = LocalSoftwareKeyboardController.current
    val currentKeyboardVisible by rememberUpdatedState(keyboardVisible)
    val dismissKeyboardOnScrollDown = remember {
        object : NestedScrollConnection {
            override fun onPreScroll(available: Offset, source: NestedScrollSource): Offset {
                if (source == NestedScrollSource.UserInput && available.y > 0 && currentKeyboardVisible) {
                    keyboardController?.hide()
                }
                return Offset.Zero
            }
        }
    }
    val scope = rememberCoroutineScope()
    val imagePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> uri?.let(onImageSelected) }
    var fullscreenImageUrl by remember { mutableStateOf<String?>(null) }
    var wenliMentionRequest by remember { mutableIntStateOf(0) }
    val lifecycleOwner = LocalLifecycleOwner.current
    BackHandler(enabled = fullscreenImageUrl != null) {
        fullscreenImageUrl = null
    }
    val messagesById = remember(state.messages) { state.messages.associateBy(ChatMessage::id) }
    val reachedHistoryEdge by remember {
        derivedStateOf {
            val layoutInfo = listState.layoutInfo
            listState.isScrollInProgress &&
                state.messages.isNotEmpty() &&
                listState.firstVisibleItemIndex + layoutInfo.visibleItemsInfo.size >=
                layoutInfo.totalItemsCount - 3
        }
    }

    LaunchedEffect(latestId, displayedTimeline.size) {
        val isNewLatest = latestId != previousLatestId
        val latestFromMe = isNewLatest &&
            state.messages.lastOrNull()?.senderId == ownProfile.accountId
        val canAutoScroll = !listState.isScrollInProgress && listState.isNearNewest()
        if (displayedTimeline.isNotEmpty() && (previousLatestId == null || latestFromMe || canAutoScroll)) {
            listState.scrollToItem(0)
        }
        previousLatestId = latestId
    }
    LaunchedEffect(keyboardVisible) {
        if (keyboardVisible && displayedTimeline.isNotEmpty()) {
            listState.scrollToItem(0)
        }
    }
    LaunchedEffect(reachedHistoryEdge, state.loadingOlder, state.hasMoreHistory, state.messages.size) {
        if (reachedHistoryEdge && state.hasMoreHistory && !state.loadingOlder) onLoadOlder()
    }
    LaunchedEffect(state.focusedMessageId, displayedTimeline.size) {
        val targetId = state.focusedMessageId ?: return@LaunchedEffect
        val targetIndex = displayedTimeline.indexOfFirst {
            it is ChatTimelineItem.Message && it.value.id == targetId
        }
        if (targetIndex >= 0) {
            listState.animateScrollToItem(targetIndex + 1)
            onFocusConsumed()
        }
    }
    LaunchedEffect(listState, timeline, lifecycleOwner, state.pendingClientMessageIds) {
        lifecycleOwner.lifecycle.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            snapshotFlow {
                listState.layoutInfo.visibleItemsInfo.mapNotNull { item ->
                    // LazyColumn has a leading spacer before the timeline; use the
                    // actual item offset so the visible bubble maps to its message.
                    (displayedTimeline.getOrNull(item.index - 1) as? ChatTimelineItem.Message)?.value
                }
            }.collect { visibleMessages ->
                visibleMessages
                    .asSequence()
                    .maxWithOrNull(compareBy<ChatMessage>({ it.createdAt }, { it.id }))
                    ?.let { message ->
                        if (message.clientMessageId !in state.pendingClientMessageIds) {
                            onMessageVisible(MessageCursor(message.createdAt, message.id))
                        }
                    }
            }
        }
    }

    Box {
        Scaffold(
            containerColor = MaterialTheme.colorScheme.background,
            contentWindowInsets = WindowInsets(0, 0, 0, 0),
            topBar = {
                WechatTopBar(
                    title = partner.displayName,
                    onBack = onBack,
                    actions = {
                        IconButton(onClick = onOpenInfo) {
                            Icon(
                                painter = painterResource(R.drawable.ic_dots_two_horizontal),
                                contentDescription = "聊天信息",
                                tint = MaterialTheme.colorScheme.onSurface,
                            )
                        }
                    },
                )
            },
        ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .imePadding(),
        ) {
            MessageList(
                state = state,
                timeline = displayedTimeline,
                ownProfile = ownProfile,
                partner = partner,
                listState = listState,
                messagesById = messagesById,
                onQuote = onQuote,
                onMentionWenli = { wenliMentionRequest += 1; onMentionWenli() },
                onOpenProfile = onOpenProfile,
                onOpenOwnProfile = onOpenOwnProfile,
                resolveImageUrl = resolveImageUrl,
                onOpenImage = { fullscreenImageUrl = it },
                onSaveImage = onSaveImage,
                onQuotedClick = { messageId ->
                    val index = displayedTimeline.indexOfFirst {
                        it is ChatTimelineItem.Message && it.value.id == messageId
                    }
                    if (index >= 0) scope.launch { listState.animateScrollToItem(index + 1) }
                },
                modifier = Modifier
                    .weight(1f)
                    .nestedScroll(dismissKeyboardOnScrollDown),
            )
            if (state.wenliPendingIds.isNotEmpty()) {
                Text("小Q正在回复…", modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp).testTag("wenli-pending"), fontSize = 12.sp)
            }
            ChatComposer(
                state = state,
                onInputChanged = onInputChanged,
                wenliMentionRequest = wenliMentionRequest,
                onSend = onSend,
                onRetry = onRetry,
                onClearError = onClearError,
                onPickImage = {
                    imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                },
                quotedName = state.quotedMessage?.let { quoted ->
                    chatSenderDisplayName(quoted.senderId, ownProfile, partner)
                },
                onCancelQuote = onCancelQuote,
                modifier = Modifier.navigationBarsPadding(),
            )
        }
        }
        FullscreenImageViewer(
            url = fullscreenImageUrl,
            onDismiss = { fullscreenImageUrl = null },
        )
        PendingImageDialog(
            pending = state.pendingImage,
            onConfirm = onConfirmPendingImage,
            onCaptionChanged = onPendingImageCaptionChanged,
            sending = state.sending,
            onCancel = onCancelPendingImage,
        )
    }
}

@Composable
private fun MessageList(
    state: ChatState,
    timeline: List<ChatTimelineItem>,
    ownProfile: Profile,
    partner: Profile,
    listState: LazyListState,
    messagesById: Map<String, ChatMessage>,
    onQuote: (ChatMessage) -> Unit,
    onMentionWenli: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenOwnProfile: () -> Unit,
    resolveImageUrl: suspend (String) -> String?,
    onOpenImage: (String) -> Unit,
    onSaveImage: (ChatMessage) -> Unit,
    onQuotedClick: (String) -> Unit,
    modifier: Modifier = Modifier,
) {
    LazyColumn(
        state = listState,
        reverseLayout = true,
        modifier = modifier
            .fillMaxWidth()
            .testTag("chat-list")
            .padding(horizontal = 12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        item(key = "bottom-space") { Spacer(Modifier.height(4.dp)) }
        items(timeline, key = ChatTimelineItem::key) { item ->
            when (item) {
                is ChatTimelineItem.Time -> ChatTimeSeparator(item.label)
                is ChatTimelineItem.Message -> MessageBubble(
                    message = item.value,
                    ownProfile = ownProfile,
                    partner = partner,
                    partnerReadCursor = state.partnerReadCursor,
                    pending = item.value.clientMessageId in state.pendingClientMessageIds,
                    repliedMessage = item.value.replyToMessageId?.let(messagesById::get),
                    onQuote = onQuote,
                    onMentionWenli = onMentionWenli,
                    onOpenProfile = onOpenProfile,
                    onOpenOwnProfile = onOpenOwnProfile,
                    resolveImageUrl = resolveImageUrl,
                    onOpenImage = onOpenImage,
                    onSaveImage = onSaveImage,
                    onQuotedClick = onQuotedClick,
                )
            }
        }
        if (state.syncStatus == SyncStatus.OFFLINE) {
            item(key = "offline") {
                Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                    Text(
                        "离线，正在重试",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
        if (state.loadingOlder) {
            item(key = "history-loader") {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp)
                        .testTag("history-loader"),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        strokeWidth = 2.dp,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        }
    }
}

@Composable
private fun ChatTimeSeparator(label: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun ChatComposer(
    state: ChatState,
    wenliMentionRequest: Int,
    onInputChanged: (String) -> Unit,
    onSend: () -> Unit,
    onRetry: () -> Unit,
    onClearError: () -> Unit,
    onPickImage: () -> Unit,
    quotedName: String?,
    onCancelQuote: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val keyboardController = LocalSoftwareKeyboardController.current
    val focusRequester = remember { FocusRequester() }
    // 输入框的正文 + 光标/选区/组合态。三者是同一份输入状态，必须整份保存：
    // 只保存"正文变化"的那次事件，会让纯移动光标/拖动选区的事件丢失，下次重组时
    // 光标被弹回旧位置（用户表现为"光标挪不动、删不掉前面的字"）。
    val composer = rememberChatComposerTextFieldState(state.input, onInputChanged)
    val textField = composer.value.value
    // 只有 ViewModel 的正文和输入框不一致时才回填（发送后清空、发送失败后还回草稿）；
    // 正文没变时不动光标，否则收到消息引起的重组会把用户的光标顶回末尾。
    LaunchedEffect(state.input) {
        composer.acceptExternal(state.input)
    }
    LaunchedEffect(wenliMentionRequest) {
        if (wenliMentionRequest == 0) return@LaunchedEffect
        val next = insertWenliMentionValue(composer.value.value)
        composer.acceptExternal(next.text, selection = next.selection)
        focusRequester.requestFocus()
        keyboardController?.show()
    }
    Column(
        modifier = modifier
            .fillMaxWidth()
            .background(ComposerBackground)
            .testTag("chat-composer"),
    ) {
        HorizontalDivider(color = Color(0xFFE5E5E5), thickness = 0.5.dp)
        state.quotedMessage?.let { quoted ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFF0F0F0))
                    .padding(horizontal = 12.dp, vertical = 7.dp)
                    .testTag("chat-quote-preview"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = quotedName.orEmpty(),
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Text(
                        text = quoted.preview(),
                        style = MaterialTheme.typography.bodySmall,
                        maxLines = 1,
                    )
                }
                TextButton(onClick = onCancelQuote, colors = betweenTextButtonColors()) { Text("取消") }
            }
        }
        state.error?.let { error ->
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 12.dp, end = 8.dp, top = 5.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    error,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.labelMedium,
                    modifier = Modifier.weight(1f),
                )
                if (state.failedClientMessageId != null || state.failedImage != null) {
                    TextButton(onClick = onRetry, colors = betweenTextButtonColors()) { Text("重试") }
                }
                TextButton(onClick = onClearError, colors = betweenTextButtonColors()) { Text("关闭") }
            }
        }
        if (shouldOfferWenliCandidate(state.input)) {
            // 打出 @ 才提示：点一下插入 "@小Q "（自带空格，后端才认）
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(Color(0xFFF0F0F0))
                    .clickable {
                        val insertion = mentionInsertion(state.input)
                        // 同时给出文本与光标：插入提及后光标要在尾部空格之后。
                        // 通知 ViewModel 由 acceptExternal 负责，这里不重复调用。
                        composer.acceptExternal(
                            nextText = insertion.text,
                            selection = TextRange(insertion.cursor),
                        )
                    }
                    .padding(horizontal = 14.dp, vertical = 10.dp)
                    .testTag("wenli-mention-candidate"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                WenliAvatar(22.dp)
                Spacer(Modifier.width(8.dp))
                Text(WENLI_DISPLAY_NAME, color = WenliBlue, fontWeight = FontWeight.SemiBold)
            }
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 7.dp),
            verticalAlignment = Alignment.Bottom,
        ) {
            TextButton(
                onClick = onPickImage,
                enabled = !state.sending,
                colors = betweenTextButtonColors(),
                contentPadding = PaddingValues(horizontal = 6.dp, vertical = 10.dp),
                modifier = Modifier.testTag("chat-pick-image"),
            ) { Text("图片") }
            BasicTextField(
                // 用 TextFieldValue 而不是纯 String：光标、选区和输入法组合态都是输入状态，
                // 必须完整保存；插入 @小Q 时也要能用它指定光标位置。
                value = textField,
                onValueChange = { value ->
                    // 整份保存：光标、选区和输入法组合态都属于输入状态。
                    // 只保存"正文变化"的事件会丢掉纯移动光标/拖动选区，
                    // 下一次重组就会把光标弹回旧位置。
                    composer.edit(value)
                },
                modifier = Modifier
                    .weight(1f)
                    .focusRequester(focusRequester)
                    .defaultMinSize(minHeight = 40.dp)
                    .clip(RoundedCornerShape(5.dp))
                    .background(ComposerFieldBackground)
                    .padding(horizontal = 12.dp, vertical = 9.dp)
                    .testTag("chat-input"),
                minLines = 1,
                maxLines = 4,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                // 输入框里的 @小Q 也标蓝；只改显示，底层文本不变，光标与选区不受影响
                visualTransformation = WenliMentionHighlight(),
                cursorBrush = SolidColor(WechatGreen),
                keyboardOptions = KeyboardOptions(imeAction = ImeAction.Send),
                keyboardActions = KeyboardActions(
                    onSend = {
                        if (state.input.isNotBlank() && !state.sending) onSend()
                        keyboardController?.show()
                    },
                ),
                decorationBox = { innerTextField ->
                    Box(contentAlignment = Alignment.CenterStart) {
                        if (state.input.isEmpty()) {
                            Text(
                                "输入文字…",
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                style = MaterialTheme.typography.bodyLarge,
                            )
                        }
                        innerTextField()
                    }
                },
            )
            Spacer(Modifier.width(7.dp))
            Button(
                onClick = onSend,
                enabled = state.input.isNotBlank() && !state.sending,
                modifier = Modifier.height(40.dp).testTag("chat-send"),
                shape = RoundedCornerShape(4.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = WechatGreen,
                    disabledContainerColor = Color(0xFFE1E1E1),
                    disabledContentColor = Color(0xFF9B9B9B),
                ),
                contentPadding = ButtonDefaults.TextButtonContentPadding,
            ) {
                if (state.sending) {
                    CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White)
                } else {
                    Text("发送")
                }
            }
        }
    }
}

private fun buildTimeline(messages: List<ChatMessage>): List<ChatTimelineItem> {
    val formatter = ChatTimeFormatter()
    val now = Instant.now()
    var previous: Instant? = null
    return buildList {
        messages.forEach { message ->
            val current = runCatching { Instant.parse(message.createdAt) }.getOrNull()
            if (current != null && formatter.shouldShowSeparator(previous, current)) {
                add(ChatTimelineItem.Time(formatter.format(current, now), message.id))
            }
            add(ChatTimelineItem.Message(message))
            if (current != null) previous = current
        }
    }
}

private fun LazyListState.isNearNewest(): Boolean {
    return layoutInfo.totalItemsCount == 0 || firstVisibleItemIndex <= 1
}

@Composable
private fun MessageBubble(
    message: ChatMessage,
    ownProfile: Profile,
    partner: Profile,
    partnerReadCursor: MessageCursor?,
    pending: Boolean,
    repliedMessage: ChatMessage?,
    onQuote: (ChatMessage) -> Unit,
    onMentionWenli: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenOwnProfile: () -> Unit,
    resolveImageUrl: suspend (String) -> String?,
    onOpenImage: (String) -> Unit,
    onSaveImage: (ChatMessage) -> Unit,
    onQuotedClick: (String) -> Unit,
) {
    val identity = chatSenderIdentity(message.senderId, ownProfile.accountId, partner.accountId)
    val mine = identity == ChatSenderIdentity.SELF
    val bubbleColor = if (mine) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceVariant
    var menuExpanded by remember(message.id) { mutableStateOf(false) }
    var selectingText by remember(message.id) { mutableStateOf(false) }
    val clipboard = LocalClipboardManager.current
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (mine) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Top,
    ) {
        if (!mine) {
            when (identity) {
                ChatSenderIdentity.WENLI -> WenliAvatar(
                    WechatUiMetrics.ChatAvatarSize,
                    modifier = Modifier
                        .pointerInput(onMentionWenli) {
                            detectTapGestures(onLongPress = { onMentionWenli() })
                        }
                        .semantics(mergeDescendants = true) {
                            customActions = listOf(
                                CustomAccessibilityAction("艾特小Q") {
                                    onMentionWenli()
                                    true
                                },
                            )
                        }
                        .testTag("wenli-avatar"),
                )
                ChatSenderIdentity.PARTNER -> ProfileAvatar(
                    partner,
                    WechatUiMetrics.ChatAvatarSize,
                    modifier = Modifier.clickable(onClick = onOpenProfile),
                )
                else -> Box(
                    Modifier.size(WechatUiMetrics.ChatAvatarSize)
                        .clip(RoundedCornerShape(WechatUiMetrics.AvatarCornerRadius))
                        .background(MaterialTheme.colorScheme.surfaceVariant),
                    contentAlignment = Alignment.Center,
                ) { Text("?") }
            }
            Spacer(Modifier.width(8.dp))
        }
        Column(
            horizontalAlignment = if (mine) Alignment.End else Alignment.Start,
        ) {
            Box {
            Column(
                modifier = Modifier
                    .widthIn(max = WechatUiMetrics.ChatBubbleMaxWidth)
                    .clip(RoundedCornerShape(4.dp))
                    .background(bubbleColor)
                    .combinedClickable(
                        onClick = {},
                        onLongClick = { menuExpanded = true },
                    )
                    .padding(horizontal = 12.dp, vertical = 10.dp),
            ) {
                if (identity == ChatSenderIdentity.WENLI || identity == ChatSenderIdentity.UNKNOWN) {
                    Text(
                        text = if (identity == ChatSenderIdentity.WENLI) "小Q" else "未知发送者",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(4.dp))
                }
                if (message.replyToMessageId != null) {
                    val repliedName = repliedMessage?.let {
                        chatSenderDisplayName(it.senderId, ownProfile, partner)
                    }.orEmpty()
                    Text(
                        text = if (repliedMessage == null) "原消息" else "$repliedName：${repliedMessage.preview()}",
                        modifier = Modifier
                            .clip(RoundedCornerShape(3.dp))
                            .background(Color(0x22000000))
                            .combinedClickable(
                                onClick = { onQuotedClick(message.replyToMessageId) },
                                onLongClick = {},
                            )
                            .padding(horizontal = 7.dp, vertical = 5.dp),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                    Spacer(Modifier.height(6.dp))
                }
                if (message.type == "image" && message.imageFileId != null) {
                    ImageBubble(
                        message,
                        resolveImageUrl,
                        onOpenImage,
                        onLongPress = { menuExpanded = true },
                    )
                    if (message.body.isNotBlank() && message.body != IMAGE_MESSAGE_PLACEHOLDER) {
                        Spacer(Modifier.height(6.dp))
                        WenliMentionText(
                            message.body,
                            fontSize = 16.sp,
                            repairMalformedGeneratedFences = identity == ChatSenderIdentity.WENLI,
                        )
                    }
                } else {
                    WenliMentionText(
                        message.body,
                        fontSize = 16.sp,
                        repairMalformedGeneratedFences = identity == ChatSenderIdentity.WENLI,
                    )
                }
            }
            if (menuExpanded) {
                DropdownMenu(expanded = true, onDismissRequest = { menuExpanded = false }) {
                    DropdownMenuItem(
                        text = { Text("引用") },
                        onClick = {
                            menuExpanded = false
                            onQuote(message)
                        },
                    )
                    if (message.type != "image" || (message.body.isNotBlank() && message.body != IMAGE_MESSAGE_PLACEHOLDER)) {
                        DropdownMenuItem(
                            text = { Text("复制") },
                            onClick = {
                                menuExpanded = false
                                clipboard.setText(AnnotatedString(message.body))
                            },
                        )
                        DropdownMenuItem(
                            text = { Text("选择文字") },
                            onClick = {
                                menuExpanded = false
                                selectingText = true
                            },
                        )
                    }
                    if (message.type == "image" && message.imageFileId != null) {
                        DropdownMenuItem(
                            text = { Text("保存图片") },
                            onClick = {
                                menuExpanded = false
                                onSaveImage(message)
                            },
                        )
                    }
                }
            }
            if (selectingText) {
                TextSelectionDialog(message.body, onDismiss = { selectingText = false })
            }
            }
            if (mine) {
                val label = when {
                    pending -> "发送中"
                    partnerReadCursor.isAtOrAfter(message) -> "已读"
                    else -> "已发送"
                }
                Text(
                    text = label,
                    modifier = Modifier
                        .padding(top = 4.dp)
                        .testTag("read-receipt-${message.id}"),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp, lineHeight = 16.sp),
                    color = if (label == "已读") MaterialTheme.colorScheme.secondary
                    else MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        if (mine) {
            Spacer(Modifier.width(8.dp))
            ProfileAvatar(
                ownProfile,
                WechatUiMetrics.ChatAvatarSize,
                modifier = Modifier.clickable(onClick = onOpenOwnProfile),
            )
        }
    }
}

private fun MessageCursor?.isAtOrAfter(message: ChatMessage): Boolean =
    this != null && (createdAt > message.createdAt || (createdAt == message.createdAt && id >= message.id))

private sealed interface ImageLoadState {
    data object Loading : ImageLoadState
    data class Loaded(val url: String) : ImageLoadState
    data object Failed : ImageLoadState
}

@Composable
private fun ImageBubble(
    message: ChatMessage,
    resolveImageUrl: suspend (String) -> String?,
    onOpenImage: (String) -> Unit,
    onLongPress: () -> Unit = {},
) {
    var imageState by remember(message.imageFileId) { mutableStateOf<ImageLoadState>(ImageLoadState.Loading) }
    LaunchedEffect(message.imageFileId) {
        val fileId = message.imageFileId
        if (fileId == null) {
            imageState = ImageLoadState.Failed
        } else {
            val url = resolveImageUrl(fileId)
            imageState = if (url == null) ImageLoadState.Failed else ImageLoadState.Loaded(url)
        }
    }
    val ratio = (message.imageWidth?.takeIf { it > 0 }?.toFloat() ?: 0f) /
        (message.imageHeight?.takeIf { it > 0 }?.toFloat() ?: 1f)
    val imageModifier = (if (ratio > 0f) {
        Modifier.width(180.dp).aspectRatio(ratio)
    } else {
        Modifier.width(180.dp).height(180.dp)
    })
        .clip(RoundedCornerShape(4.dp))
        .background(Color(0xFFEFEFEF))
    val placeholderModifier = Modifier
        .width(180.dp)
        .height(160.dp)
        .clip(RoundedCornerShape(4.dp))
        .background(Color(0xFFEFEFEF))
    when (val state = imageState) {
        is ImageLoadState.Loaded -> AsyncImage(
            model = state.url,
            contentDescription = "图片消息",
            contentScale = ContentScale.Fit,
            modifier = imageModifier.combinedClickable(
                onClick = { onOpenImage(state.url) },
                onLongClick = onLongPress,
            ),
        )
        ImageLoadState.Failed -> Box(
            modifier = placeholderModifier
                .combinedClickable(onClick = {}, onLongClick = onLongPress)
                .padding(8.dp),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                "图片加载失败",
                color = ImagePlaceholderColor,
                style = MaterialTheme.typography.labelMedium,
                textAlign = TextAlign.Center,
            )
        }
        ImageLoadState.Loading -> Box(
            modifier = placeholderModifier.combinedClickable(onClick = {}, onLongClick = onLongPress),
            contentAlignment = Alignment.Center,
        ) {
            CircularProgressIndicator(modifier = Modifier.size(18.dp), strokeWidth = 2.dp)
        }
    }
}

private fun ChatMessage.preview(): String =
    if (type == "image") "[图片]" else body

/**
 * 选图后的确认预览：先看清楚要发的是哪张，点“发送”才真正上传。
 * 直接点系统选图器就发出是危险的，这里给一次明确的确认机会。
 */
@Composable
private fun PendingImageDialog(
    pending: PendingImageMessage?,
    onConfirm: () -> Unit,
    onCancel: () -> Unit,
    onCaptionChanged: (String) -> Unit,
    sending: Boolean,
) {
    if (pending == null) return
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("发送这张图片？") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
            AsyncImage(
                model = pending.bytes,
                contentDescription = "待发送的图片",
                contentScale = ContentScale.Fit,
                modifier = Modifier
                    .fillMaxWidth()
                    .heightIn(max = 320.dp)
                    .clip(RoundedCornerShape(6.dp)),
            )
                OutlinedTextField(
                    colors = betweenOutlinedTextFieldColors(),
                    value = pending.caption,
                    onValueChange = onCaptionChanged,
                    label = { Text("添加说明") },
                    placeholder = { Text("可输入 @小Q 请它看看") },
                    minLines = 2,
                    maxLines = 5,
                    isError = pending.caption.trim().codePointCount(0, pending.caption.trim().length) > 2000,
                    modifier = Modifier.fillMaxWidth().testTag("pending-image-caption"),
                )
            }
        },
        dismissButton = {
            TextButton(onClick = onCancel, colors = betweenTextButtonColors()) { Text("取消") }
        },
        confirmButton = {
            TextButton(onClick = onConfirm, enabled = !sending && pending.caption.trim().codePointCount(0, pending.caption.trim().length) <= 2000, colors = betweenTextButtonColors()) { Text("发送") }
        },
        modifier = Modifier.testTag("pending-image-dialog"),
    )
}

@Composable
private fun FullscreenImageViewer(url: String?, onDismiss: () -> Unit) {
    if (url == null) return
    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .clickable(onClick = onDismiss)
            .testTag("fullscreen-image"),
        contentAlignment = Alignment.Center,
    ) {
        AsyncImage(
            model = url,
            contentDescription = "原图",
            contentScale = ContentScale.Fit,
            modifier = Modifier.fillMaxSize(),
        )
    }
}
