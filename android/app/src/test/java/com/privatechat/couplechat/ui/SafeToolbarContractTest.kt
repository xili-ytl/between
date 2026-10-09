package com.privatechat.couplechat.ui

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SafeToolbarContractTest {
    @Test
    fun secondaryScreensUseTheSharedInsetAwareToolbar() {
        val files = listOf(
            "feature/chat/ChatScreen.kt",
            "feature/moments/MomentsScreen.kt",
            "feature/moments/MomentComposerScreen.kt",
            "feature/me/ProfileEditScreen.kt",
            "feature/settings/SettingsScreen.kt",
        )

        files.forEach { relative ->
            val source = File("src/main/java/com/privatechat/couplechat/$relative").readText()
            assertTrue(relative, source.contains("WechatTopBar("))
            assertFalse(
                relative,
                source.contains("modifier = Modifier.height(WechatUiMetrics.TopBarHeight)"),
            )
        }
    }

    @Test
    fun chatComposerStaysAboveKeyboardAndGestureNavigation() {
        val source = File(
            "src/main/java/com/privatechat/couplechat/feature/chat/ChatScreen.kt",
        ).readText().replace("\r\n", "\n")

        val manifest = File("src/main/AndroidManifest.xml").readText()

        assertTrue(source.contains(".padding(padding)\n                .imePadding(),"))
        assertFalse(source.contains("Modifier.navigationBarsPadding().imePadding()"))
        assertTrue(source.contains("navigationBarsPadding()"))
        assertTrue(manifest.contains("android:windowSoftInputMode=\"adjustResize\""))
    }
}
