package com.privatechat.couplechat.feature.home

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.Profile
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class HomeScreenTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun homeShowsThreeTabsAndOpensThePartnerConversationWithoutAccountIds() {
        var openedChat = false

        compose.setContent {
            HomeScreen(
                ownProfile = profile("1001", "示例乙", "女"),
                partnerProfile = profile("1002", "示例甲", "男"),
                messages = emptyList(),
                unreadCount = 0,
                hasUnseenMoments = false,
                onOpenChat = { openedChat = true },
                onOpenMoments = {},
                onOpenProfile = {},
                onOpenSettings = {},
            )
        }

        compose.onNodeWithText("消息").assertExists()
        compose.onNodeWithText("通讯录").assertDoesNotExist()
        compose.onNodeWithText("发现").assertExists()
        compose.onNodeWithText("我").assertExists()
        compose.onNodeWithText("示例甲").assertExists().performClick()
        compose.onNodeWithContentDescription("示例甲的头像").assertExists()
        compose.runOnIdle { assertTrue(openedChat) }
        compose.onNodeWithText("1002", substring = true).assertDoesNotExist()
    }

    @Test
    fun homeRoutesTheSingleContactDiscoverAndMeRows() {
        var openedMoments = false
        var openedProfile = false
        var openedSettings = false

        compose.setContent {
            HomeScreen(
                ownProfile = profile("1001", "示例乙", "女"),
                partnerProfile = profile("1002", "示例甲", "男"),
                messages = emptyList(),
                unreadCount = 0,
                hasUnseenMoments = false,
                onOpenChat = {},
                onOpenMoments = { openedMoments = true },
                onOpenProfile = { openedProfile = true },
                onOpenSettings = { openedSettings = true },
            )
        }

        compose.onNodeWithText("发现").performClick()
        compose.onNodeWithText("朋友圈").performClick()
        compose.runOnIdle { assertTrue(openedMoments) }

        compose.onNodeWithText("我").performClick()
        compose.onNodeWithText("个人资料").performClick()
        compose.runOnIdle { assertTrue(openedProfile) }
        compose.onNodeWithText("设置").performClick()
        compose.runOnIdle { assertTrue(openedSettings) }
        compose.onNodeWithText("1001", substring = true).assertDoesNotExist()
    }

    @Test
    fun messagePreviewUsesTheNewestRetainedMessageAndFormattedTime() {
        val newest = message("new", "今天吃什么", "2026-08-07T08:09:10.000Z")
        val expectedTime = DateTimeFormatter.ofPattern("HH:mm")
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse(newest.createdAt))

        compose.setContent {
            HomeScreen(
                ownProfile = profile("1001", "示例乙", "女"),
                partnerProfile = profile("1002", "示例甲", "男"),
                messages = listOf(
                    message("old", "旧消息", "2026-08-06T08:09:10.000Z"),
                    newest,
                ),
                unreadCount = 0,
                hasUnseenMoments = false,
                onOpenChat = {},
                onOpenMoments = {},
                onOpenProfile = {},
                onOpenSettings = {},
            )
        }

        compose.onNodeWithText("今天吃什么").assertExists()
        compose.onNodeWithText(expectedTime).assertExists()
        assertEquals(0, compose.onAllNodesWithText("旧消息").fetchSemanticsNodes().size)
    }

    private fun profile(accountId: String, displayName: String, gender: String) = Profile(
        accountId = accountId,
        displayName = displayName,
        gender = gender,
        updatedAt = "2026-08-07T00:00:00.000Z",
    )

    private fun message(id: String, body: String, createdAt: String) = ChatMessage(
        id = id,
        relationshipId = "couple",
        senderId = "1001",
        recipientId = "1002",
        clientMessageId = "client-$id",
        body = body,
        createdAt = createdAt,
    )
}
