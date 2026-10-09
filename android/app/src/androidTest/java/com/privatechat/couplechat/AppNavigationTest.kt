package com.privatechat.couplechat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.navigation.compose.rememberNavController
import com.privatechat.couplechat.core.data.SyncStatus
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.feature.chat.ChatState
import com.privatechat.couplechat.feature.moments.MomentsState
import com.privatechat.couplechat.feature.settings.SettingsState
import com.privatechat.couplechat.ui.BetweenTheme
import org.junit.Rule
import org.junit.Test

class AppNavigationTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun signedInExperienceStartsAtTheSingleConversationAndReturnsHome() {
        setSignedInContent()

        compose.onNodeWithText("消息").assertExists()
        compose.onAllNodesWithText("通讯录").assertCountEquals(0)
        compose.onNodeWithText("示例甲").performClick()
        compose.onNodeWithText("发送").assertExists()
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithText("消息").assertExists()
    }

    @Test
    fun discoverAndMeRowsReachTheirSecondaryScreens() {
        setSignedInContent()

        compose.onNodeWithText("发现").performClick()
        compose.onNodeWithText("朋友圈").performClick()
        compose.onNodeWithText("发表").performClick()
        compose.onNodeWithText("发表动态").assertExists()
        compose.onNodeWithText("取消").performClick()
        compose.onNodeWithContentDescription("返回").performClick()

        compose.onNodeWithText("我").performClick()
        compose.onNodeWithTag("me-profile-row").performClick()
        compose.onNodeWithText("头像").assertExists()
        compose.onNodeWithText("性别").assertExists()
        compose.onNodeWithTag("profile-name-row").performClick()
        compose.onNodeWithText("修改昵称").assertExists()
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithText("设置").performClick()
        compose.onNodeWithTag("password-row").performClick()
        compose.onNodeWithText("当前密码").assertExists()
        compose.onNodeWithContentDescription("返回").performClick()
        compose.onNodeWithText("退出登录").assertExists()
    }

    @Test
    fun sameSessionStateRestorationKeepsTheCurrentBackStackEntry() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { SignedInTestContent() }
        compose.onNodeWithText("示例甲").performClick()
        compose.onNodeWithText("发送").assertExists()

        restoration.emulateSavedInstanceStateRestore()

        compose.onNodeWithText("发送").assertExists()
        compose.onNodeWithContentDescription("返回").assertExists()
    }

    private fun setSignedInContent() {
        compose.setContent { SignedInTestContent() }
    }

    @Composable
    private fun SignedInTestContent() {
        BetweenTheme {
            val navController = rememberNavController()
            val actions = remember { SignedInActions() }
            val own = remember {
                Profile("1001", "示例乙", "女", updatedAt = "2026-08-07T00:00:00Z")
            }
            SignedInNavHost(
                navController = navController,
                active = Session("1001", "示例乙", "token", 1),
                ownProfile = own,
                partnerProfile = Profile("1002", "示例甲", "男", updatedAt = "2026-08-07T00:00:00Z"),
                chatState = ChatState(syncStatus = SyncStatus.SYNCED),
                settingsState = SettingsState(profile = own, displayName = own.displayName),
                momentsState = MomentsState(),
                actions = actions,
            )
        }
    }
}
