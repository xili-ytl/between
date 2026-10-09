package com.privatechat.couplechat.ui

import androidx.compose.ui.unit.dp
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WechatVisualContractTest {
    @Test
    fun highImpactGeometryMatchesThePinnedAndroidReference() {
        assertEquals(50.dp, WechatUiMetrics.TopBarHeight)
        assertEquals(54.dp, WechatUiMetrics.BottomBarHeight)
        assertEquals(28.dp, WechatUiMetrics.BottomIconSize)
        assertEquals(65.dp, WechatUiMetrics.ConversationRowHeight)
        assertEquals(50.dp, WechatUiMetrics.ConversationAvatarSize)
        assertEquals(65.dp, WechatUiMetrics.ContactRowHeight)
        assertEquals(40.dp, WechatUiMetrics.ContactAvatarSize)
        assertEquals(50.dp, WechatUiMetrics.SettingRowHeight)
        assertEquals(80.dp, WechatUiMetrics.MeAvatarSize)
        assertEquals(225.dp, WechatUiMetrics.ChatBubbleMaxWidth)
    }

    @Test
    fun calibratedSurfacesConsumeTheSharedMeasurements() {
        val root = File("src/main/java/com/privatechat/couplechat")
        val home = File(root, "feature/home/HomeScreen.kt").readText()
        val chrome = File(root, "ui/WechatChrome.kt").readText()
        val messages = File(root, "feature/home/MessagesTab.kt").readText()
        val contacts = File(root, "feature/contacts/ContactsScreen.kt").readText()
        val me = File(root, "feature/me/MeScreen.kt").readText()
        val chat = File(root, "feature/chat/ChatScreen.kt").readText()

        assertTrue(chrome.contains("WechatUiMetrics.BottomBarHeight"))
        assertTrue(home.contains("WechatUiMetrics.BottomIconSize"))
        assertTrue(messages.contains("WechatUiMetrics.ConversationRowHeight"))
        assertTrue(contacts.contains("WechatUiMetrics.ContactRowHeight"))
        assertTrue(me.contains("WechatUiMetrics.MeAvatarSize"))
        assertTrue(chat.contains("WechatUiMetrics.ChatBubbleMaxWidth"))
    }

    @Test
    fun sharedChromeKeepsSystemInsetsOutsideTheVisibleBars() {
        val chrome = File(
            "src/main/java/com/privatechat/couplechat/ui/WechatChrome.kt",
        )
        assertTrue("Missing shared chrome source", chrome.isFile)
        val source = chrome.readText()

        assertTrue(source.contains("windowInsetsTopHeight(WindowInsets.statusBars)"))
        assertTrue(source.contains("windowInsetsBottomHeight(WindowInsets.navigationBars)"))
        assertTrue(source.contains("height(WechatUiMetrics.TopBarHeight)"))
        assertTrue(source.contains("height(WechatUiMetrics.BottomBarHeight)"))
        assertFalse(source.contains("TopAppBar("))
    }
}
