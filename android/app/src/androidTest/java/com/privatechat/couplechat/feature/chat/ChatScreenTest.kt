package com.privatechat.couplechat.feature.chat

import androidx.compose.runtime.getValue
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertHasNoClickAction
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.click
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.longClick
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.TextToolbar
import androidx.compose.ui.platform.TextToolbarStatus
import androidx.test.espresso.Espresso
import androidx.test.platform.app.InstrumentationRegistry
import android.os.SystemClock
import android.view.MotionEvent
import com.privatechat.couplechat.core.model.ChatMessage
import androidx.compose.ui.unit.Density
import org.junit.Assert.assertEquals
import com.privatechat.couplechat.core.model.Profile
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ChatScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun wenliHasIndependentAvatarAndQuotesWithoutOpeningAHumanProfile() {
        var ownOpens = 0
        var partnerOpens = 0
        val wenli = ChatMessage(
            "wenli_reply_test", "couple", "wenli", "1002", "reply_test", "我在呢",
            "2026-08-31T00:00:00.000Z", replyToMessageId = "1001_source",
        )
        val own = wenli.copy(id = "1001_source", senderId = "1001", body = "@小Q 你好", replyToMessageId = null)
        val partner = wenli.copy(id = "1002_quote", senderId = "1002", body = "听见啦", replyToMessageId = wenli.id)
        compose.setContent {
            ChatScreen(
                state = ChatState(messages = listOf(own, wenli, partner), quotedMessage = wenli),
                ownProfile = Profile("1001", "示例乙", "女", updatedAt = "2026-08-31T00:00:00Z"),
                partner = Profile("1002", "示例甲", "男", updatedAt = "2026-08-31T00:00:00Z"),
                onInputChanged = {}, onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
                onOpenOwnProfile = { ownOpens++ }, onOpenProfile = { partnerOpens++ },
            )
        }
        compose.onAllNodesWithText("小Q").assertCountEquals(2)
        compose.onNodeWithContentDescription("小Q的头像").assertHasNoClickAction().performTouchInput { click() }
        compose.runOnIdle {
            assertEquals(0, ownOpens)
            assertEquals(0, partnerOpens)
        }
        compose.onNodeWithContentDescription("示例乙的头像").performClick()
        compose.onNodeWithContentDescription("示例甲的头像").performClick()
        compose.runOnIdle {
            assertEquals(1, ownOpens)
            assertEquals(1, partnerOpens)
        }
        compose.onNodeWithTag("chat-quote-preview").assertExists()
        compose.onNodeWithText("小Q：我在呢").assertExists()
    }

    @Test
    fun longPressingOnlyTheWenliAvatarInsertsMentionAndKeepsQuoteWithoutOpeningBubbleMenu() {
        var state by mutableStateOf(
            ChatState(
                input = "保留草稿",
                quotedMessage = sampleWenliMessage(),
                messages = listOf(sampleWenliMessage()),
            ),
        )
        compose.setContent {
            ChatScreen(
                state = state,
                ownProfile = Profile("1001", "我", "", updatedAt = ""),
                partner = Profile("1002", "对方", "", updatedAt = ""),
                onInputChanged = { state = state.copy(input = it) },
                onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
            )
        }

        compose.onNodeWithContentDescription("小Q的头像").performTouchInput { longClick() }
        compose.waitForIdle()
        compose.runOnIdle {
            assertEquals("保留草稿 @小Q ", state.input)
            assertEquals(sampleWenliMessage(), state.quotedMessage)
        }
        compose.onNodeWithText("复制").assertDoesNotExist()
        compose.onNodeWithContentDescription("小Q的头像").performTouchInput { longClick() }
        compose.runOnIdle { assertEquals("保留草稿 @小Q ", state.input) }
    }

    @Test
    fun longPressCopiesWholeBodyAndStillAllowsQuote() {
        lateinit var clipboard: ClipboardManager
        lateinit var toolbar: TextToolbar
        var quoted: ChatMessage? = null
        val message = sampleMessage()
        compose.setContent {
            clipboard = LocalClipboardManager.current
            toolbar = LocalTextToolbar.current
            ChatScreen(
                state = ChatState(messages = listOf(message)),
                ownProfile = Profile("1001", "我", "", updatedAt = ""),
                partner = Profile("1002", "对方", "", updatedAt = ""),
                onInputChanged = {}, onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
                onQuote = { quoted = it },
            )
        }
        compose.onNodeWithText(message.body).performTouchInput { longClick() }
        compose.runOnIdle { assertEquals(TextToolbarStatus.Hidden, toolbar.status) }
        compose.onNodeWithText("选择文字").assertExists()
        compose.onNodeWithText("复制").performClick()
        compose.runOnIdle { assertEquals(message.body, clipboard.getText()?.text) }
        compose.onNodeWithText("引用").assertDoesNotExist()
        compose.onNodeWithText(message.body).performTouchInput { longClick() }
        compose.onNodeWithText("引用").performClick()
        compose.runOnIdle { assertEquals(message, quoted) }
    }

    @Test
    fun markdownAndLatexBodyKeepsRichNodeAndWholeRawCopyAndQuote() {
        lateinit var clipboard: ClipboardManager
        var quoted: ChatMessage? = null
        val raw = "# 标题\n\n**加粗** ${'$'}x^2${'$'}\n\n```text\n${'$'}x${'$'}\n```"
        val message = sampleWenliMessage().copy(body = raw)
        compose.setContent {
            clipboard = LocalClipboardManager.current
            ChatScreen(
                state = ChatState(messages = listOf(message)),
                ownProfile = Profile("1001", "我", "", updatedAt = ""),
                partner = Profile("1002", "对方", "", updatedAt = ""),
                onInputChanged = {}, onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
                onQuote = { quoted = it },
            )
        }

        compose.onNodeWithTag("chat-rich-text").assertExists()
        compose.onNodeWithTag("chat-rich-text").performTouchInput { longClick() }
        compose.onNodeWithText("复制").performClick()
        compose.runOnIdle { assertEquals(raw, clipboard.getText()?.text) }
        compose.onNodeWithTag("chat-rich-text").performTouchInput { longClick() }
        compose.onNodeWithText("引用").performClick()
        compose.runOnIdle { assertEquals(message, quoted) }
    }

    @Test
    fun richBlocksKeepFlowTextOutsideTableAndRefreshOnThemeAndFontScaleChanges() {
        var dark by mutableStateOf(false)
        var fontScale by mutableStateOf(1f)
        val raw = "开头中文说明，用来验证气泡宽度内的自然换行。\n\n" +
            "| 很宽的列标题 | 另一列 |\n| --- | --- |\n| 表格内容 | 更多内容 |\n\n" +
            "结尾中文说明，仍应留在正常流式段落中。"
        val message = sampleWenliMessage().copy(body = raw)
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(1f, fontScale)) {
                MaterialTheme(colorScheme = if (dark) darkColorScheme() else lightColorScheme()) {
                    ChatScreen(
                        state = ChatState(messages = listOf(message)),
                        ownProfile = Profile("1001", "我", "", updatedAt = ""),
                        partner = Profile("1002", "对方", "", updatedAt = ""),
                        onInputChanged = {}, onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
                    )
                }
            }
        }

        compose.onNodeWithTag("chat-rich-text").assertExists()
        compose.onNodeWithTag("chat-rich-text-scroll-1").assertExists()
        compose.onNodeWithTag("chat-rich-text-2").assertExists()
        val initialHeight = compose.onNodeWithTag("chat-rich-text").fetchSemanticsNode().size.height

        dark = true
        fontScale = 1.5f
        compose.waitForIdle()
        compose.onNodeWithTag("chat-rich-text").assertExists()
        val mediumHeight = compose.onNodeWithTag("chat-rich-text").fetchSemanticsNode().size.height
        assertTrue(mediumHeight > initialHeight)

        fontScale = 2f
        compose.waitForIdle()
        val largeHeight = compose.onNodeWithTag("chat-rich-text").fetchSemanticsNode().size.height
        assertTrue(largeHeight > mediumHeight)
    }

    @Test
    fun selectionIsSeparateAndCanBeClosedAndReopened() {
        val message = sampleMessage()
        compose.setContent {
            ChatScreen(
                state = ChatState(messages = listOf(message)),
                ownProfile = Profile("1001", "我", "", updatedAt = ""),
                partner = Profile("1002", "对方", "", updatedAt = ""),
                onInputChanged = {}, onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
            )
        }
        compose.onNodeWithText(message.body).performTouchInput { longClick() }
        compose.onNodeWithText("选择文字").performClick()
        compose.onNodeWithText("引用").assertDoesNotExist()
        compose.onNodeWithTag("text-selection-content").performTouchInput { longClick() }
        compose.onNodeWithText("关闭").performClick()
        compose.onNodeWithTag("text-selection-dialog").assertDoesNotExist()
        compose.onNodeWithText(message.body).performTouchInput { longClick() }
        compose.onNodeWithText("选择文字").performClick()
        compose.onNodeWithTag("text-selection-content").performTouchInput { longClick() }
        Espresso.pressBack()
        compose.onNodeWithTag("text-selection-dialog").assertDoesNotExist()
        compose.onNodeWithText(message.body).performTouchInput { longClick() }
        compose.onNodeWithText("选择文字").performClick()
        compose.onNodeWithTag("text-selection-content").performTouchInput { longClick() }
        tapOutsideDialog()
        compose.onNodeWithTag("text-selection-dialog").assertDoesNotExist()
        compose.onNodeWithText(message.body).performTouchInput { longClick() }
        compose.onNodeWithText("复制").assertExists()
    }

    private fun tapOutsideDialog() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val y = instrumentation.targetContext.resources.displayMetrics.heightPixels / 2f
        val now = SystemClock.uptimeMillis()
        // The dialog uses the platform's inset width; the screen's left edge is its scrim.
        for (action in listOf(MotionEvent.ACTION_DOWN, MotionEvent.ACTION_UP)) {
            val event = MotionEvent.obtain(now, SystemClock.uptimeMillis(), action, 1f, y, 0)
            try {
                instrumentation.uiAutomation.injectInputEvent(event, true)
            } finally {
                event.recycle()
            }
        }
        compose.waitForIdle()
    }

    private fun sampleMessage() = ChatMessage(
        id = "sample", relationshipId = "test", senderId = "1002", recipientId = "1001",
        clientMessageId = "sample", body = "会吞嘛\n第二行 🙂", createdAt = "2026-09-09T00:00:00Z",
    )

    private fun sampleWenliMessage() = ChatMessage(
        id = "wenli_long_press", relationshipId = "couple", senderId = "wenli", recipientId = "1001",
        clientMessageId = "long_press", body = "小Q在呢", createdAt = "2026-09-09T00:00:00Z",
        replyToMessageId = "1001_source",
    )

    @Test
    fun imageCaptionUsesTheExistingCopyAndSelectionDialog() {
        lateinit var clipboard: ClipboardManager
        val caption = "**图片说明** ${'$'}x^2${'$'}"
        val image = sampleMessage().copy(
            type = "image",
            body = caption,
            imageFileId = "image-1",
            imageMimeType = "image/jpeg",
            imageWidth = 10,
            imageHeight = 10,
        )
        compose.setContent {
            clipboard = LocalClipboardManager.current
            ChatScreen(
                state = ChatState(messages = listOf(image)),
                ownProfile = Profile("1001", "我", "", updatedAt = ""),
                partner = Profile("1002", "对方", "", updatedAt = ""),
                onInputChanged = {}, onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
                resolveImageUrl = { "memory://image-1" },
            )
        }

        compose.onNodeWithTag("chat-rich-text").assertExists()
        compose.onNodeWithTag("chat-rich-text").performTouchInput { longClick() }
        compose.onNodeWithText("复制").performClick()
        compose.runOnIdle { assertEquals(caption, clipboard.getText()?.text) }
        compose.onNodeWithTag("chat-rich-text").performTouchInput { longClick() }
        compose.onNodeWithText("选择文字").performClick()
        compose.onNodeWithTag("text-selection-content").assertExists()
    }

    @Test
    fun pendingImageDialogAllowsCaptionEditingAndCancelLeavesDraftUntouched() {
        var state by mutableStateOf(
            ChatState(
                input = "输入框草稿",
                pendingImage = PendingImageMessage(
                    clientMessageId = "img-1",
                    bytes = byteArrayOf(1),
                    mimeType = "image/jpeg",
                    width = 10,
                    height = 10,
                    caption = "输入框草稿",
                ),
            ),
        )
        compose.setContent {
            ChatScreen(
                state = state,
                ownProfile = Profile("1001", "我", "", updatedAt = ""),
                partner = Profile("1002", "对方", "", updatedAt = ""),
                onInputChanged = { state = state.copy(input = it) },
                onSend = {}, onRetry = {}, onLoadOlder = {}, onBack = {},
                onPendingImageCaptionChanged = { caption ->
                    state = state.copy(pendingImage = state.pendingImage?.copy(caption = caption))
                },
                onCancelPendingImage = { state = state.copy(pendingImage = null) },
            )
        }

        compose.onNodeWithTag("pending-image-caption").performTextInput(" 新说明")
        compose.runOnIdle { assertEquals("输入框草稿 新说明", state.pendingImage?.caption) }
        compose.onNodeWithText("取消").performClick()
        compose.runOnIdle {
            assertEquals("输入框草稿", state.input)
            assertEquals(null, state.pendingImage)
        }
    }

    @Test
    fun chatHasSendButNoDestructiveActions() {
        var wentBack = false
        var state by mutableStateOf(ChatState())
        compose.setContent {
            ChatScreen(
                state = state,
                ownProfile = Profile("1001", "示例乙", "女", updatedAt = "2026-08-07T00:00:00Z"),
                partner = Profile("1002", "示例甲", "男", updatedAt = "2026-08-07T00:00:00Z"),
                onInputChanged = { state = state.copy(input = it) },
                onSend = {},
                onRetry = {},
                onLoadOlder = {},
                onBack = { wentBack = true },
            )
        }

        compose.onNodeWithText("发送").assertExists()
        compose.onNodeWithTag("chat-send").assertIsNotEnabled()
        compose.onNodeWithTag("chat-input").performTextInput("你好")
        compose.onNodeWithTag("chat-send").assertIsEnabled()
        compose.onNodeWithTag("history-loader").assertDoesNotExist()
        compose.onNodeWithText("加载更早消息").assertDoesNotExist()
        compose.onNodeWithText("示例甲").assertExists()
        compose.onNodeWithTag("chat-composer").assertExists()
        compose.onNodeWithContentDescription("聊天信息").assertExists()
        compose.onNodeWithContentDescription("返回").performClick()
        compose.runOnIdle { assertTrue(wentBack) }
        compose.onNodeWithText("1002", substring = true).assertDoesNotExist()
        compose.onNodeWithText("设置").assertDoesNotExist()
        compose.onNodeWithText("删除").assertDoesNotExist()
        compose.onNodeWithText("撤回").assertDoesNotExist()
        compose.onNodeWithText("拉黑").assertDoesNotExist()
    }
}
