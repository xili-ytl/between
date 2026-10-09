package com.privatechat.couplechat

import com.privatechat.couplechat.core.model.Session
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Test

class AppNavigationContractTest {
    @Test
    fun signedInGraphStartsAtHomeInsteadOfChat() {
        assertEquals("home", Routes.HOME)
        assertEquals("chat", Routes.CHAT)
        assertEquals("moments", Routes.MOMENTS)
        assertEquals("moment-compose", Routes.MOMENT_COMPOSE)
        assertEquals("profile", Routes.PROFILE)
        assertEquals("profile-name", Routes.PROFILE_NAME)
        assertEquals("settings", Routes.SETTINGS)
        assertEquals("about", Routes.ABOUT)
        assertEquals("password", Routes.PASSWORD)
        assertEquals(Routes.HOME, SIGNED_IN_START_DESTINATION)
        assertNotEquals(Routes.CHAT, SIGNED_IN_START_DESTINATION)

        val source = File("src/main/java/com/privatechat/couplechat/AppNavHost.kt").readText()
        assertFalse(source.contains("const val CONTACT"))
        assertFalse(source.contains("composable(Routes.CONTACT)"))
    }

    @Test
    fun screenStateKeysIncludeTheCompleteSessionIdentity() {
        val first = Session("1001", "示例乙", "token-a", 1)
        val tokenRotated = first.copy(token = "token-b")
        val versionChanged = first.copy(sessionVersion = 2)
        val accountChanged = first.copy(accountId = "1002")

        assertNotEquals(first.screenStateKey("chat"), tokenRotated.screenStateKey("chat"))
        assertNotEquals(first.screenStateKey("chat"), versionChanged.screenStateKey("chat"))
        assertNotEquals(first.screenStateKey("chat"), accountChanged.screenStateKey("chat"))
        assertNotEquals(first.screenStateKey("chat"), first.screenStateKey("moments"))
    }
}
