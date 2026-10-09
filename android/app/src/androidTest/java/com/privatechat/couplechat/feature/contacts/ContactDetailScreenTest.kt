package com.privatechat.couplechat.feature.contacts

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.privatechat.couplechat.core.model.Profile
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ContactDetailScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun detailShowsProfileAndCanOpenChatWithoutShowingAccountId() {
        var openedChat = false
        var wentBack = false

        compose.setContent {
            ContactDetailScreen(
                partner = Profile("1002", "示例甲", "男", updatedAt = "2026-08-07T00:00:00Z"),
                onBack = { wentBack = true },
                onOpenChat = { openedChat = true },
            )
        }

        compose.onNodeWithText("示例甲").assertExists()
        compose.onNodeWithText("男").assertExists()
        compose.onNodeWithText("发消息").performClick()
        compose.runOnIdle { assertTrue(openedChat) }
        compose.onNodeWithContentDescription("返回").performClick()
        compose.runOnIdle { assertTrue(wentBack) }
        compose.onNodeWithText("1002", substring = true).assertDoesNotExist()
    }
}
