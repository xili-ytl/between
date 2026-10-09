package com.privatechat.couplechat.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class WeUiIconsContractTest {
    @Test
    fun backAndDisclosureIconsUseTheRecordedOfficialWeUiGlyphs() {
        val icons = source("ui/WeUiIcons.kt")
        val back = resource("drawable/weui_ic_back_arrow.xml")
        val disclosure = resource("drawable/weui_ic_disclosure_arrow.xml")

        assertTrue(icons.contains("R.drawable.weui_ic_back_arrow"))
        assertTrue(icons.contains("R.drawable.weui_ic_disclosure_arrow"))
        assertTrue(back.contains("M3.343,12l7.071,7.071L9,20.485l-7.778,-7.778"))
        assertTrue(disclosure.contains("M2.454,6.58l1.06,-1.06 5.78,5.779"))
        assertTrue(notice().contains("7a6f8ad7700d0d6f1361dbe5e2942b4b129e7a7e"))
        assertTrue(notice().contains("src/style/icon/weui-icon.less"))
        assertTrue(notice().contains("MIT License"))
    }

    @Test
    fun screensUseWeUiBackAndDisclosureInsteadOfMaterialEquivalents() {
        val chrome = source("ui/WechatChrome.kt")
        assertTrue(chrome.contains("WeUiBackIcon("))

        listOf(
            "feature/chat/ChatScreen.kt",
            "feature/contacts/ContactDetailScreen.kt",
            "feature/me/ProfileEditScreen.kt",
            "feature/settings/SettingsScreen.kt",
        ).forEach { relative ->
            val source = source(relative)
            assertTrue(
                "$relative should use the WeUI-backed shared or direct back icon",
                source.contains("WechatTopBar(") || source.contains("WeUiBackIcon("),
            )
            assertFalse("$relative still imports Material ArrowBack", source.contains("ArrowBack"))
        }

        val me = source("feature/me/MeScreen.kt")
        assertTrue(me.contains("WeUiDisclosureIcon("))
        assertFalse(me.contains("KeyboardArrowRight"))
    }

    private fun source(relative: String): String =
        File("src/main/java/com/privatechat/couplechat/$relative").also {
            assertTrue("Missing source file: ${it.absolutePath}", it.isFile)
        }.readText()

    private fun resource(relative: String): String =
        File("src/main/res/$relative").also {
            assertTrue("Missing resource file: ${it.absolutePath}", it.isFile)
        }.readText()

    private fun notice(): String =
        File("../../THIRD_PARTY_NOTICES.md").also {
            assertTrue("Missing notice file: ${it.absolutePath}", it.isFile)
        }.readText()
}
