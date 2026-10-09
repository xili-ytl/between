package com.privatechat.couplechat.feature.me

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import com.privatechat.couplechat.BuildConfig
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.feature.settings.AboutScreen
import com.privatechat.couplechat.feature.settings.PasswordEditScreen
import com.privatechat.couplechat.feature.settings.SettingsScreen
import com.privatechat.couplechat.feature.settings.SettingsState
import com.privatechat.couplechat.ui.BetweenTheme
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ProfileScreensTest {
    @get:Rule
    val compose = createComposeRule()

    private val profile = Profile(
        accountId = "1001",
        displayName = "示例乙",
        gender = "女",
        updatedAt = "2026-08-07T00:00:00Z",
    )

    @Test
    fun profileRootIsAThreeRowListWithoutTheLoginAccount() {
        var openedName = false
        compose.setContent {
            BetweenTheme {
                ProfileEditScreen(
                    state = SettingsState(profile = profile, displayName = "示例乙"),
                    onBack = {},
                    onOpenDisplayName = { openedName = true },
                    onAvatarSelected = {},
                )
            }
        }

        compose.onNodeWithText("头像").assertExists()
        compose.onNodeWithText("昵称").assertExists()
        compose.onNodeWithText("性别").assertExists()
        compose.onNodeWithText("女").assertExists()
        compose.onNodeWithTag("profile-name-row").performClick()
        compose.runOnIdle { assertTrue(openedName) }
        compose.onNodeWithText("更换头像").assertDoesNotExist()
        compose.onNodeWithText("用户名").assertDoesNotExist()
        compose.onNodeWithText("1001", substring = true).assertDoesNotExist()
    }

    @Test
    fun displayNameEditingLivesOnItsOwnFocusedScreen() {
        var value by mutableStateOf("")
        var saved = false
        compose.setContent {
            BetweenTheme {
                DisplayNameEditScreen(
                    state = SettingsState(profile = profile, displayName = value),
                    onBack = {},
                    onDisplayNameChanged = { value = it },
                    onSaveDisplayName = { saved = true },
                )
            }
        }

        compose.onNodeWithContentDescription("昵称").performTextInput("新昵称")
        compose.onNodeWithText("保存").performClick()
        compose.runOnIdle {
            assertEquals("新昵称", value)
            assertTrue(saved)
        }
    }

    @Test
    fun settingsRootLinksToPasswordUpdateAndLogout() {
        var openedPassword = false
        var openedAbout = false
        var checkedUpdate = false
        var loggedOut = false
        compose.setContent {
            BetweenTheme {
                SettingsScreen(
                    state = SettingsState(),
                    onBack = {},
                    onOpenPassword = { openedPassword = true },
                    onOpenAbout = { openedAbout = true },
                    onCheckUpdate = { checkedUpdate = true },
                    onLogout = { loggedOut = true },
                )
            }
        }

        compose.onNodeWithTag("password-row").performClick()
        compose.onNodeWithTag("update-row").performClick()
        compose.onNodeWithTag("about-row").performClick()
        compose.onNodeWithTag("logout-row").performClick()
        compose.runOnIdle {
            assertTrue(openedPassword)
            assertTrue(openedAbout)
            assertTrue(checkedUpdate)
            assertTrue(loggedOut)
        }
        compose.onNodeWithText("新密码").assertDoesNotExist()
        assertEquals(
            1,
            compose.onAllNodesWithText("数据由云端永久保存")
                .fetchSemanticsNodes().size,
        )
        compose.onNodeWithText("1001", substring = true).assertDoesNotExist()
    }

    @Test
    fun aboutScreenShowsProductIdentityWithoutEditableRows() {
        compose.setContent {
            BetweenTheme {
                AboutScreen(onBack = {})
            }
        }

        compose.onNodeWithText("关于之间").assertExists()
        compose.onNodeWithText("之间").assertExists()
        compose.onNodeWithText("版本 ${BuildConfig.VERSION_NAME}").assertExists()
        compose.onNodeWithText("世界之外，你我之间").assertExists()
        compose.onNodeWithText("由示例甲开发").assertExists()
        compose.onNodeWithText("数据由云端永久保存").assertExists()
        compose.onNodeWithTag("about-content").assertExists()
        compose.onNodeWithTag("about-data-note").assertExists()
        compose.onNodeWithTag("about-signature").assertExists()
        compose.onNodeWithTag("developer-row").assertDoesNotExist()
    }

    @Test
    fun passwordEditingLivesOnItsOwnFocusedScreen() {
        var state by mutableStateOf(SettingsState())
        var changed = false
        compose.setContent {
            BetweenTheme {
                PasswordEditScreen(
                    state = state,
                    onBack = {},
                    onCurrentPasswordChanged = { state = state.copy(currentPassword = it) },
                    onNewPasswordChanged = { state = state.copy(newPassword = it) },
                    onChangePassword = { changed = true },
                )
            }
        }

        compose.onNodeWithContentDescription("当前密码").performTextInput("1013")
        compose.onNodeWithContentDescription("新密码").performTextInput("new1013")
        compose.onNodeWithText("完成").performClick()
        compose.runOnIdle { assertTrue(changed) }
    }
}
