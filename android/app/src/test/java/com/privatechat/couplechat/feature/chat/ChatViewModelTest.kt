@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.feature.chat

import kotlinx.coroutines.CompletableDeferred
import com.privatechat.couplechat.MainDispatcherRule
import com.privatechat.couplechat.core.data.ChatDataSource
import com.privatechat.couplechat.core.data.HistoryLoadResult
import com.privatechat.couplechat.core.data.SyncStatus
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.MessageCursor
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ChatViewModelTest {
    @Test
    fun completingOneWenliRequestKeepsTheOtherPendingAndBackgroundCancelsIt() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val first = CompletableDeferred<Unit>()
        val second = CompletableDeferred<Unit>()
        source.wenliGates["1001_1"] = first
        source.wenliGates["1001_2"] = second
        var id = 0
        val viewModel = ChatViewModel(source) { (++id).toString() }
        repeat(2) {
            viewModel.setInput("@问理 在吗")
            viewModel.send()
            runCurrent()
        }
        assertEquals(setOf("1001_1", "1001_2"), viewModel.state.value.wenliPendingIds)
        first.complete(Unit)
        runCurrent()
        assertEquals(setOf("1001_2"), viewModel.state.value.wenliPendingIds)
        viewModel.onBackground()
        runCurrent()
        assertTrue(viewModel.state.value.wenliPendingIds.isEmpty())
    }

    @Test
    fun messageFinishingAfterBackgroundDoesNotLaunchANewWenliRequest() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val gate = CompletableDeferred<Unit>()
        source.sendGate = gate
        val viewModel = ChatViewModel(source)
        viewModel.setInput("@问理 在吗")
        viewModel.send()
        runCurrent()
        viewModel.onBackground()
        gate.complete(Unit)
        advanceUntilIdle()
        assertTrue(source.wenliRequests.isEmpty())
        assertFalse(viewModel.state.value.sending)
    }
    @Test
    fun wenliRequestRunsAfterSuccessfulSendWithoutHoldingComposerAndFailureDoesNotUndoMessage() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val gate = CompletableDeferred<Unit>()
        source.wenliGate = gate
        val viewModel = ChatViewModel(source) { "mention" }
        viewModel.setInput("@问理 你好")
        viewModel.send()
        runCurrent()
        assertFalse(viewModel.state.value.sending)
        assertEquals(1, source.wenliRequests.size)
        assertEquals(1, viewModel.state.value.wenliPendingIds.size)
        gate.completeExceptionally(IllegalStateException("offline"))
        advanceUntilIdle()
        assertTrue(viewModel.state.value.wenliPendingIds.isEmpty())
        assertNull(viewModel.state.value.failedClientMessageId)
        assertEquals("", viewModel.state.value.input)
        assertNull(viewModel.state.value.error)
    }

    @Test
    fun similarOrEmbeddedMentionsDoNotKickWenli() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source)
        for (body in listOf("普通消息", "你好@问理", "你好 @问理你好", "@问理呀", "@问理助手")) {
            viewModel.setInput(body)
            viewModel.send()
            advanceUntilIdle()
        }
        assertTrue(source.wenliRequests.isEmpty())
    }
    @get:Rule
    val main = MainDispatcherRule()

    @Test
    fun displaysCachedMessagesImmediately() = runTest(main.dispatcher) {
        val source = FakeChatDataSource(listOf(message("cached", "以前的消息")))
        val viewModel = ChatViewModel(source, { "client" })
        advanceUntilIdle()

        assertEquals("以前的消息", viewModel.state.value.messages.single().body)
    }

    @Test
    fun trimsValidSendAndRejectsEmptyOrOversizeInput() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source, { "id-1" })

        viewModel.setInput("  你好  ")
        viewModel.send()
        advanceUntilIdle()
        assertEquals(listOf(Triple("id-1", "你好", null)), source.sent)
        assertEquals("", viewModel.state.value.input)

        viewModel.setInput("   ")
        viewModel.send()
        assertEquals("请输入消息", viewModel.state.value.error)

        viewModel.setInput("🐱".repeat(2001))
        viewModel.send()
        assertEquals("消息不能超过 2000 个字符", viewModel.state.value.error)
    }

    @Test
    fun sendClearsInputImmediatelyBeforeNetworkCompletes() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val gate = CompletableDeferred<Unit>()
        source.sendGate = gate
        val viewModel = ChatViewModel(source, { "id-1" })

        viewModel.setInput("秒发")
        viewModel.send()
        runCurrent()

        assertEquals("", viewModel.state.value.input)
        assertTrue(viewModel.state.value.sending)

        gate.complete(Unit)
        advanceUntilIdle()
        assertFalse(viewModel.state.value.sending)
    }

    @Test
    fun failedSendPreservesDraftAndRetryUsesStableId() = runTest(main.dispatcher) {
        val source = FakeChatDataSource(sendFailures = 1)
        val viewModel = ChatViewModel(source, { "stable-id" })
        viewModel.setInput("别丢掉我")

        viewModel.send()
        advanceUntilIdle()
        assertEquals("别丢掉我", viewModel.state.value.input)
        assertEquals("stable-id", viewModel.state.value.failedClientMessageId)

        viewModel.retry()
        advanceUntilIdle()
        assertEquals(listOf("stable-id", "stable-id"), source.sent.map { it.first })
        assertEquals("", viewModel.state.value.input)
        assertNull(viewModel.state.value.failedClientMessageId)
    }

    @Test
    fun failedTextSendDoesNotRestoreOldDraftOverNewInputOrReuseItsClientId() = runTest(main.dispatcher) {
        val source = FakeChatDataSource(sendFailures = 1)
        val gate = CompletableDeferred<Unit>()
        source.sendGate = gate
        var nextId = 0
        val viewModel = ChatViewModel(source) { "text-${++nextId}" }

        viewModel.setInput("旧草稿")
        viewModel.send()
        runCurrent()
        viewModel.setInput("新草稿")
        val replacement = message("replacement", "引用新草稿")
        viewModel.quote(replacement)
        gate.complete(Unit)
        advanceUntilIdle()

        assertEquals("新草稿", viewModel.state.value.input)
        assertEquals(replacement, viewModel.state.value.quotedMessage)
        assertNull(viewModel.state.value.failedClientMessageId)

        viewModel.send()
        advanceUntilIdle()
        assertEquals(listOf("text-1", "text-2"), source.sent.map { it.first })
        assertEquals("新草稿", source.sent.last().second)
    }

    @Test
    fun sendImageClearsSendingStateOnSuccess() = runTest(main.dispatcher) {
        val viewModel = ChatViewModel(FakeChatDataSource(), { "img-1" })

        viewModel.sendImage(byteArrayOf(1, 2, 3), "image/jpeg", 800, 600)
        advanceUntilIdle()

        assertFalse(viewModel.state.value.sending)
        assertNull(viewModel.state.value.failedImage)
    }

    @Test
    fun imagePreviewStartsWithDraftAndSendsEditedTrimmedCaption() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source, { "img-1" })

        viewModel.setInput("  初始说明  ")
        viewModel.selectImage(byteArrayOf(1), "image/jpeg", 10, 20)
        assertEquals("  初始说明  ", viewModel.state.value.pendingImage?.caption)

        viewModel.setPendingImageCaption("  @问理 请看  ")
        viewModel.confirmPendingImage()
        advanceUntilIdle()

        assertEquals("@问理 请看", source.sent.single().second)
        assertEquals("", viewModel.state.value.input)
    }

    @Test
    fun oversizedImageCaptionKeepsPreviewAndReportsCodePointLimit() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source, { "img-1" })

        viewModel.selectImage(byteArrayOf(1), "image/jpeg", 10, 20)
        viewModel.setPendingImageCaption("🐱".repeat(2001))
        viewModel.confirmPendingImage()
        advanceUntilIdle()

        assertEquals("说明不能超过 2000 个字符", viewModel.state.value.error)
        assertEquals(2001L, viewModel.state.value.pendingImage?.caption?.codePoints()?.count())
        assertTrue(source.sent.isEmpty())
    }

    @Test
    fun failedImageSendKeepsRetryAndRetryReusesClientId() = runTest(main.dispatcher) {
        val source = FakeChatDataSource(sendImageFailures = 1)
        val viewModel = ChatViewModel(source, { "img-1" })

        viewModel.sendImage(byteArrayOf(1, 2, 3), "image/jpeg", 800, 600)
        advanceUntilIdle()
        assertEquals("图片发送失败，可重试", viewModel.state.value.error)
        assertEquals("img-1", viewModel.state.value.failedImage?.clientMessageId)

        viewModel.retry()
        advanceUntilIdle()
        assertNull(viewModel.state.value.failedImage)
        assertEquals(listOf("img-1", "img-1"), source.sent.map { it.first })
    }

    @Test
    fun failedImageRetryPreservesCaptionQuoteAndClientId() = runTest(main.dispatcher) {
        val original = message("original", "原消息")
        val source = FakeChatDataSource(initial = listOf(original), sendImageFailures = 1)
        val viewModel = ChatViewModel(source, { "img-1" })
        advanceUntilIdle()

        viewModel.quote(original)
        viewModel.setInput("原始草稿")
        viewModel.selectImage(byteArrayOf(1), "image/jpeg", 10, 20)
        viewModel.setPendingImageCaption("  @问理 看看  ")
        viewModel.confirmPendingImage()
        advanceUntilIdle()

        val failed = viewModel.state.value.failedImage
        assertEquals("@问理 看看", failed?.caption?.trim())
        assertEquals(original.id, failed?.replyToMessageId)
        assertEquals("img-1", failed?.clientMessageId)

        viewModel.retry()
        advanceUntilIdle()

        assertEquals(listOf("@问理 看看", "@问理 看看"), source.sent.map { it.second })
        assertEquals(listOf(original.id, original.id), source.sent.map { it.third })
        assertEquals(listOf("img-1", "img-1"), source.sent.map { it.first })
    }

    @Test
    fun quotedMessageIsSentAndClearedOnlyAfterSuccess() = runTest(main.dispatcher) {
        val original = message("original", "原消息")
        val source = FakeChatDataSource(listOf(original))
        val viewModel = ChatViewModel(source, { "reply-id" })
        advanceUntilIdle()

        viewModel.quote(original)
        viewModel.setInput("引用回复")
        viewModel.send()
        advanceUntilIdle()

        assertEquals(original.id, source.sent.single().third)
        assertNull(viewModel.state.value.quotedMessage)
    }

    @Test
    fun quotedImageSendCarriesQuoteAndClearsIt() = runTest(main.dispatcher) {
        val original = message("original", "原消息")
        val source = FakeChatDataSource(listOf(original))
        val viewModel = ChatViewModel(source, { "img-id" })
        advanceUntilIdle()

        viewModel.quote(original)
        viewModel.sendImage(byteArrayOf(1, 2, 3), "image/jpeg", 800, 600)
        advanceUntilIdle()

        assertEquals(original.id, source.sent.single().third)
        assertNull(viewModel.state.value.quotedMessage)
    }

    @Test
    fun emptyImageCaptionUsesTheLegacyPlaceholderBody() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source, { "img-1" })

        viewModel.selectImage(byteArrayOf(1), "image/jpeg", 10, 20)
        viewModel.setPendingImageCaption("   ")
        viewModel.confirmPendingImage()
        advanceUntilIdle()

        assertEquals("[该消息新版本可见]", source.sent.single().second)
    }

    @Test
    fun foregroundAndBackgroundControlPolling() {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source, { "id" })

        viewModel.onForeground()
        viewModel.onBackground()

        assertTrue(source.started)
        assertTrue(source.stopped)
        assertFalse(viewModel.state.value.sending)
    }

    @Test
    fun historyExhaustionStopsFurtherLoads() = runTest(main.dispatcher) {
        val source = FakeChatDataSource(
            historyResults = ArrayDeque(
                listOf(
                    HistoryLoadResult(revealed = 25, hasMore = true),
                    HistoryLoadResult(revealed = 0, hasMore = false),
                )
            )
        )
        val viewModel = ChatViewModel(source, { "id" })

        viewModel.loadOlder()
        advanceUntilIdle()
        assertTrue(viewModel.state.value.hasMoreHistory)

        viewModel.loadOlder()
        advanceUntilIdle()
        assertFalse(viewModel.state.value.hasMoreHistory)

        viewModel.loadOlder()
        advanceUntilIdle()
        assertEquals(2, source.historyLoadCalls)
    }

    @Test
    fun focusesAHistorySearchResultAfterRevealingIt() = runTest(main.dispatcher) {
        val source = FakeChatDataSource(revealResult = true)
        val viewModel = ChatViewModel(source, { "id" })

        viewModel.focusMessage("1001_old")
        advanceUntilIdle()

        assertEquals("1001_old", source.revealedId)
        assertEquals("1001_old", viewModel.state.value.focusedMessageId)
        viewModel.consumeFocus()
        assertNull(viewModel.state.value.focusedMessageId)
    }

    @Test
    fun selectingAnImageOnlyQueuesAPreviewUntilConfirmed() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source, { "img" })

        viewModel.selectImage(byteArrayOf(1, 2, 3), "image/jpeg", 800, 600)
        advanceUntilIdle()

        assertEquals(3, viewModel.state.value.pendingImage?.bytes?.size)
        assertEquals(0, source.sent.size)

        viewModel.confirmPendingImage()
        advanceUntilIdle()

        assertNull(viewModel.state.value.pendingImage)
        assertEquals(1, source.sent.size)
    }

    @Test
    fun cancellingTheImagePreviewNeverSendsIt() = runTest(main.dispatcher) {
        val original = message("original", "原消息")
        val source = FakeChatDataSource(listOf(original))
        val viewModel = ChatViewModel(source, { "img" })

        viewModel.setInput("保留这段")
        viewModel.quote(original)
        viewModel.selectImage(byteArrayOf(9), "image/jpeg", 10, 10)
        viewModel.cancelPendingImage()
        advanceUntilIdle()

        assertNull(viewModel.state.value.pendingImage)
        assertEquals(0, source.sent.size)
        assertEquals("保留这段", viewModel.state.value.input)
        assertEquals(original, viewModel.state.value.quotedMessage)
    }

    @Test
    fun completedImageSendKeepsANewDraftQuoteAndPendingImage() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val gate = CompletableDeferred<Unit>()
        source.sendImageGate = gate
        val replacement = message("replacement", "新引用")
        val viewModel = ChatViewModel(source) { "unused" }

        viewModel.setInput("旧说明")
        viewModel.selectImage(byteArrayOf(1), "image/jpeg", 10, 20, clientMessageId = "img-old")
        viewModel.confirmPendingImage()
        runCurrent()

        viewModel.setInput("新草稿")
        viewModel.quote(replacement)
        viewModel.selectImage(byteArrayOf(2), "image/jpeg", 30, 40, clientMessageId = "img-new")
        gate.complete(Unit)
        advanceUntilIdle()

        assertEquals("新草稿", viewModel.state.value.input)
        assertEquals(replacement, viewModel.state.value.quotedMessage)
        assertEquals("img-new", viewModel.state.value.pendingImage?.clientMessageId)
    }

    @Test
    fun typingAtOffersTheWenliCandidateAndPickingItInsertsAMentionWithATrailingSpace() = runTest(main.dispatcher) {
        val viewModel = ChatViewModel(FakeChatDataSource())

        assertFalse(viewModel.state.value.let { shouldOfferWenliCandidate(it.input) })
        viewModel.setInput("@")
        assertTrue("@ 之后应弹出问理候选", shouldOfferWenliCandidate(viewModel.state.value.input))

        viewModel.setInput(insertWenliMention(viewModel.state.value.input))
        assertEquals("@问理 ", viewModel.state.value.input)
        assertFalse("插入完整提及后不再提示", shouldOfferWenliCandidate(viewModel.state.value.input))
    }

    @Test
    fun theInsertedMentionSatisfiesTheSharedTokenRule() = runTest(main.dispatcher) {
        // 两端都按 token 边界识别；无分隔的 @问理你好 不能误触发。
        assertTrue(isWenliMentionBody(insertWenliMention("@")))
        assertTrue(isWenliMentionBody("前文 @问理 后文"))
        assertFalse(isWenliMentionBody("前文 @问理你好"))

        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source) { "summon" }
        viewModel.setInput(insertWenliMention("@") + "帮我看看")
        viewModel.send()
        advanceUntilIdle()

        assertEquals("@问理 帮我看看", source.sent.single().second)
        assertEquals(1, source.wenliRequests.size)
    }

    @Test
    fun retypingTheMentionDoesNotDuplicateIt() = runTest(main.dispatcher) {
        // 已经打出 @问 再点候选，不应该变成 @问理 @问
        assertEquals("@问理 ", insertWenliMention("@"))
        assertEquals("@问理 ", insertWenliMention("@问"))
        assertEquals("@问理 ", insertWenliMention("@问理"))
        assertEquals("@问理 ", insertWenliMention("@问理 "))
    }

    @Test
    fun aMiddleMentionStillRequestsWenliWithoutChangingQuotedDraft() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source) { "middle-mention" }
        val quoted = ChatMessage(
            "1002_quote", "couple", "1002", "1001", "quote", "原文",
            "2026-08-31T00:00:00.000Z",
        )

        viewModel.quote(quoted)
        viewModel.setInput("前文 @问理 后文")
        assertEquals(quoted, viewModel.state.value.quotedMessage)
        viewModel.send()
        advanceUntilIdle()

        assertEquals("前文 @问理 后文", source.sent.single().second)
        assertEquals(1, source.wenliRequests.size)
    }

    @Test
    fun insertingTheMentionPutsTheCursorAfterTheTrailingSpace() = runTest(main.dispatcher) {
        // 光标必须落在尾部空格之后，用户才能直接接着打字；
        // 否则 BasicTextField 会把光标留在 @ 后面，用户要手动挪一次。
        for (draft in listOf("@", "@问", "@问理", "@问理 ", "  @")) {
            val insertion = mentionInsertion(draft)
            assertEquals("@问理 ", insertion.text)
            assertEquals(
                "草稿 \"$draft\" 的光标应在末尾",
                insertion.text.length,
                insertion.cursor,
            )
            // 光标之后不应再有字符
            assertEquals("", insertion.text.substring(insertion.cursor))
        }
    }

    @Test
    fun aPlainMessageWithoutTheMentionNeverCallsWenli() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source) { "plain" }

        viewModel.setInput("在吗")
        viewModel.send()
        advanceUntilIdle()

        assertEquals("在吗", source.sent.single().second)
        assertTrue(source.wenliRequests.isEmpty())
    }

    @Test
    fun deletingTheMentionCancelsTheSummon() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source) { "cancel" }

        viewModel.setInput(insertWenliMention("@") + "在吗")
        // 用户把那几个字删掉 = 取消召唤
        viewModel.setInput("在吗")
        viewModel.send()
        advanceUntilIdle()

        assertEquals("在吗", source.sent.single().second)
        assertTrue(source.wenliRequests.isEmpty())
    }

    @Test
    fun visibleReadPositionsAreCoalescedAndDoNotWriteDuplicates() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source)
        val first = MessageCursor("2026-08-06T00:00:01Z", "1002_first")
        val second = MessageCursor("2026-08-06T00:00:01Z", "1002_second")

        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(first)
        viewModel.onMessageVisible(second)
        runCurrent()
        assertTrue(source.readReceiptCursors.isEmpty())
        advanceTimeBy(999)
        runCurrent()
        assertTrue(source.readReceiptCursors.isEmpty())
        advanceTimeBy(1)
        runCurrent()
        assertEquals(listOf(second), source.readReceiptCursors)

        viewModel.onMessageVisible(second)
        advanceTimeBy(2_000)
        runCurrent()
        assertEquals(listOf(second), source.readReceiptCursors)
    }

    @Test
    fun visiblePositionObservedBeforeRouteResumeIsSubmittedWhenRouteBecomesVisible() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source)
        val cursor = MessageCursor("2026-09-22T10:20:00.000Z", "1001_incoming")

        // Compose can publish its first LazyColumn layout before the route's
        // DisposableEffect reports RESUMED. That position must not be lost.
        viewModel.onMessageVisible(cursor)
        viewModel.onChatReadVisibilityChanged(true)
        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(listOf(cursor), source.readReceiptCursors)
    }

    @Test
    fun failedReadReceiptStaysPendingUntilTheChatReturnsToTheForeground() = runTest(main.dispatcher) {
        val source = FakeChatDataSource().also { it.readReceiptFailures = 1 }
        val viewModel = ChatViewModel(source)
        val cursor = MessageCursor("2026-08-06T00:00:01Z", "1002_first")

        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(cursor)
        advanceTimeBy(1_000)
        runCurrent()
        assertTrue(source.readReceiptCursors.isEmpty())

        viewModel.onChatReadVisibilityChanged(false)
        advanceTimeBy(10_000)
        runCurrent()
        assertTrue(source.readReceiptCursors.isEmpty())

        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(cursor)
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(listOf(cursor), source.readReceiptCursors)
    }

    @Test
    fun readingThenImmediatelyLeavingStillSubmitsTheObservedPosition() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source)
        val cursor = MessageCursor("2026-10-02T08:00:00.000Z", "1002_seen")

        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(cursor)
        advanceTimeBy(200)
        viewModel.onChatReadVisibilityChanged(false)
        advanceTimeBy(1_000)
        runCurrent()

        assertEquals(listOf(cursor), source.readReceiptCursors)
        assertTrue(source.sent.isEmpty())
    }

    @Test
    fun leavingWhileAReadRequestIsInFlightDoesNotCancelItsConfirmation() = runTest(main.dispatcher) {
        val source = FakeChatDataSource().also { it.readReceiptGate = CompletableDeferred() }
        val viewModel = ChatViewModel(source)
        val cursor = MessageCursor("2026-10-02T08:00:00.000Z", "1002_seen")

        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(cursor)
        advanceTimeBy(1_000)
        runCurrent()
        viewModel.onChatReadVisibilityChanged(false)
        source.readReceiptGate!!.complete(Unit)
        runCurrent()

        assertEquals(listOf(cursor), source.readReceiptCursors)
        assertTrue(source.sent.isEmpty())
    }

    @Test
    fun leavingDuringAnInFlightReceiptAlsoFlushesTheNewerAlreadyViewedPosition() = runTest(main.dispatcher) {
        val source = FakeChatDataSource().also { it.readReceiptGate = CompletableDeferred() }
        val viewModel = ChatViewModel(source)
        val first = MessageCursor("2026-10-02T08:00:00.000Z", "1002_first")
        val second = MessageCursor("2026-10-02T08:00:01.000Z", "1002_second")

        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(first)
        advanceTimeBy(1_000)
        runCurrent()
        viewModel.onMessageVisible(second)
        viewModel.onChatReadVisibilityChanged(false)
        source.readReceiptGate!!.complete(Unit)
        runCurrent()

        assertEquals(listOf(first, second), source.readReceiptCursors)
    }

    @Test
    fun failedFlushWhileHiddenDoesNotPollButRetriesOnReturnWithoutSendingAMessage() = runTest(main.dispatcher) {
        val source = FakeChatDataSource().also { it.readReceiptFailures = 1 }
        val viewModel = ChatViewModel(source)
        val cursor = MessageCursor("2026-10-02T08:00:00.000Z", "1002_seen")

        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(cursor)
        advanceTimeBy(200)
        viewModel.onChatReadVisibilityChanged(false)
        advanceTimeBy(30_000)
        runCurrent()
        assertEquals(1, source.readReceiptAttempts)
        assertTrue(source.readReceiptCursors.isEmpty())

        viewModel.onChatReadVisibilityChanged(true)
        advanceTimeBy(1_000)
        runCurrent()
        assertEquals(listOf(cursor), source.readReceiptCursors)
        assertTrue(source.sent.isEmpty())
    }

    @Test
    fun messagesReceivedAfterLeavingDoNotBecomeReadWithoutViewingThem() = runTest(main.dispatcher) {
        val source = FakeChatDataSource()
        val viewModel = ChatViewModel(source)
        val cursor = MessageCursor("2026-10-02T08:00:00.000Z", "1002_seen")
        viewModel.onChatReadVisibilityChanged(true)
        viewModel.onMessageVisible(cursor)
        advanceTimeBy(200)
        viewModel.onChatReadVisibilityChanged(false)
        source.emit(listOf(message("unseen", "synthetic").copy(
            id = "1002_unseen", senderId = "1002", recipientId = "1001",
            createdAt = "2026-10-02T08:00:01.000Z",
        )))
        advanceTimeBy(30_000)
        runCurrent()

        assertEquals(listOf(cursor), source.readReceiptCursors)
        assertEquals(1, source.readReceiptAttempts)
    }
}

private class FakeChatDataSource(
    initial: List<ChatMessage> = emptyList(),
    private var sendFailures: Int = 0,
    private var sendImageFailures: Int = 0,
    private val historyResults: ArrayDeque<HistoryLoadResult> = ArrayDeque(),
    private val revealResult: Boolean = false,
) : ChatDataSource {
    private val state = MutableStateFlow(initial)
    fun emit(messages: List<ChatMessage>) { state.value = messages }
    override val messages: Flow<List<ChatMessage>> = state
    override val syncStatus: StateFlow<SyncStatus> = MutableStateFlow(SyncStatus.SYNCED)
    override val unreadCount: StateFlow<Int> = MutableStateFlow(0)
    override val partnerReadCursor: StateFlow<MessageCursor?> = MutableStateFlow(null)
    override suspend fun markRead() = Unit
    val readReceiptCursors = mutableListOf<MessageCursor>()
    var readReceiptFailures = 0
    var readReceiptAttempts = 0
    var readReceiptGate: CompletableDeferred<Unit>? = null
    override suspend fun markMessageReadThrough(cursor: MessageCursor) {
        readReceiptAttempts += 1
        if (readReceiptFailures-- > 0) error("offline")
        readReceiptGate?.await()
        readReceiptCursors += cursor
    }
    val sent = mutableListOf<Triple<String, String, String?>>()
    var started = false
    var stopped = false
    var historyLoadCalls = 0
    var revealedId: String? = null
    var sendGate: CompletableDeferred<Unit>? = null
    var wenliGate: CompletableDeferred<Unit>? = null
    val wenliGates = mutableMapOf<String, CompletableDeferred<Unit>>()
    val wenliRequests = mutableListOf<String>()
    override suspend fun requestWenli(sourceMessageId: String) {
        wenliRequests += sourceMessageId
        (wenliGates[sourceMessageId] ?: wenliGate)?.await()
    }
    var sendImageGate: CompletableDeferred<Unit>? = null

    override suspend fun send(clientMessageId: String, body: String, replyToMessageId: String?): ChatMessage {
        sent += Triple(clientMessageId, body, replyToMessageId)
        sendGate?.also { sendGate = null }?.await()
        if (sendFailures-- > 0) error("offline")
        return message(clientMessageId, body)
    }

    override suspend fun sendImage(
        clientMessageId: String,
        bytes: ByteArray,
        mimeType: String,
        width: Int?,
        height: Int?,
        replyToMessageId: String?,
        caption: String,
    ): ChatMessage {
        sent += Triple(clientMessageId, caption.trim().ifEmpty { "[该消息新版本可见]" }, replyToMessageId)
        sendImageGate?.also { sendImageGate = null }?.await()
        if (sendImageFailures-- > 0) error("offline")
        return message(clientMessageId, caption.trim().ifEmpty { "[该消息新版本可见]" })
    }

    override suspend fun imageUrl(imageFileId: String): String = "memory://$imageFileId"

    override suspend fun loadOlder(): HistoryLoadResult {
        historyLoadCalls += 1
        return if (historyResults.isEmpty()) {
            HistoryLoadResult(revealed = 0, hasMore = false)
        } else {
            historyResults.removeFirst()
        }
    }

    override suspend fun reveal(messageId: String): Boolean {
        revealedId = messageId
        return revealResult
    }

    override fun startForegroundSync(scope: CoroutineScope): Job {
        started = true
        return Job()
    }

    override fun stopForegroundSync() {
        stopped = true
    }
}

private fun message(id: String, body: String) = ChatMessage(
    id = "1001_$id",
    relationshipId = "couple",
    senderId = "1001",
    recipientId = "1002",
    clientMessageId = id,
    body = body,
    createdAt = "2026-08-06T00:00:00Z",
)
