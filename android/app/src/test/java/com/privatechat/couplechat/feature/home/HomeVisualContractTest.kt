package com.privatechat.couplechat.feature.home

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class HomeVisualContractTest {
    @Test
    fun homeContainsExactlyMessagesDiscoverAndMe() {
        assertEquals(listOf("消息", "发现", "我"), HomeTab.entries.map(HomeTab::label))
    }

    @Test
    fun messageHomeStartsWithTheConversationInsteadOfATitle() {
        val source = source("feature/home/MessagesTab.kt")

        assertFalse(source.contains("PageTitle("))
        assertFalse(source.contains("Text(\"之间\""))
        assertFalse(source.contains("Text(\"消息\""))
    }

    @Test
    fun bottomNavigationSeparatesGestureInsetsFromItsVisibleHeight() {
        val source = source("ui/WechatChrome.kt")

        assertTrue(source.contains("windowInsetsBottomHeight(WindowInsets.navigationBars)"))
        assertTrue(source.contains("height(WechatUiMetrics.BottomBarHeight)"))
    }

    @Test
    fun homeScaffoldDoesNotAddASecondStatusBarInset() {
        val source = source("feature/home/HomeScreen.kt")
        val me = source("feature/me/MeScreen.kt")

        assertTrue(source.contains("contentWindowInsets = WindowInsets(0, 0, 0, 0)"))
        assertFalse(source.contains("PageTitle(\"发现\")"))
        assertFalse(me.contains("PageTitle(\"我\")"))
    }

    private fun source(relative: String): String {
        val file = File("src/main/java/com/privatechat/couplechat/$relative")
        assertTrue("Missing source file: ${file.absolutePath}", file.isFile)
        return file.readText()
    }
}
