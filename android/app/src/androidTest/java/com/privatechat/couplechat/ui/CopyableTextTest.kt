package com.privatechat.couplechat.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.platform.ClipboardManager
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.longClick
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.text.AnnotatedString
import androidx.test.espresso.Espresso
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class CopyableTextTest {
    @get:Rule val compose = createComposeRule()

    @Test
    fun commentCopyExcludesAttributionAndLongPressDoesNotReply() {
        lateinit var clipboard: ClipboardManager
        var replies = 0
        val body = "记住啦\n🙂"
        val displayed = "对方 回复 我：$body 09-09 12:30"
        compose.setContent {
            clipboard = LocalClipboardManager.current
            CopyableText(
                text = AnnotatedString(displayed), copyText = body,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurface,
                onClick = { replies++ },
            )
        }
        compose.onNodeWithText(displayed).performTouchInput { longClick() }
        compose.onNodeWithText("复制").performClick()
        compose.runOnIdle {
            assertEquals(body, clipboard.getText()?.text)
            assertEquals(0, replies)
        }
        compose.onNodeWithText(displayed).performClick()
        compose.runOnIdle { assertEquals(1, replies) }
        compose.onNodeWithText(displayed).performTouchInput { longClick() }
        Espresso.pressBack()
        compose.onNodeWithText("复制").assertDoesNotExist()
        compose.onNodeWithText(displayed).performTouchInput { longClick() }
        compose.onNodeWithText("选择文字").performClick()
        compose.onNodeWithText("复制").assertDoesNotExist()
        compose.onNodeWithText(body).assertExists()
        compose.onNodeWithText("复制全文").performClick()
        compose.onNodeWithText(body).assertDoesNotExist()
        compose.runOnIdle { assertEquals(body, clipboard.getText()?.text) }
    }
}
