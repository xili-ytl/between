package com.privatechat.couplechat.feature.chat

import com.privatechat.couplechat.core.database.MessageEntity
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.Profile
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatSenderIdentityTest {
    private val first = Profile("1001", "示例乙", "女", updatedAt = "2026-08-31T00:00:00Z")
    private val second = Profile("1002", "示例甲", "男", updatedAt = "2026-08-31T00:00:00Z")

    @Test
    fun wenliIsIndependentFromBothHumanParticipants() {
        for ((own, partner) in listOf(first to second, second to first)) {
            assertEquals(ChatSenderIdentity.WENLI, chatSenderIdentity("wenli", own.accountId, partner.accountId))
            assertEquals("小Q", chatSenderDisplayName("wenli", own, partner))
        }
    }

    @Test
    fun humanNamesAndRolesFollowTheCurrentAccountAndRemark() {
        for ((own, partner) in listOf(first to second, second to first)) {
            assertEquals(ChatSenderIdentity.SELF, chatSenderIdentity(own.accountId, own.accountId, partner.accountId))
            assertEquals(ChatSenderIdentity.PARTNER, chatSenderIdentity(partner.accountId, own.accountId, partner.accountId))
            assertEquals(own.displayName, chatSenderDisplayName(own.accountId, own, partner))
            assertEquals("特别备注", chatSenderDisplayName(partner.accountId, own, partner.copy(displayName = "特别备注")))
        }
    }

    @Test
    fun unknownIdsCannotImpersonateThePartnerOrWenli() {
        for (id in listOf("", "robot", "Wenli", "wenli ", "pet")) {
            assertEquals(ChatSenderIdentity.UNKNOWN, chatSenderIdentity(id, first.accountId, second.accountId))
            assertEquals("未知发送者", chatSenderDisplayName(id, first, second))
        }
    }

    @Test
    fun wenliAndItsQuoteReferenceRoundTripThroughTheExistingCache() {
        val reply = ChatMessage(
            id = "wenli_reply_example", relationshipId = "couple", senderId = "wenli",
            recipientId = "1002", clientMessageId = "reply_example", body = "我在呢",
            createdAt = "2026-08-31T00:00:00.000Z", replyToMessageId = "1001_source",
        )
        assertEquals(reply, MessageEntity.from(reply).toModel())
        val humanQuote = reply.copy(
            id = "1002_quote", senderId = "1002", recipientId = "1001", clientMessageId = "quote",
            replyToMessageId = reply.id,
        )
        assertEquals(humanQuote, MessageEntity.from(humanQuote).toModel())
    }

    @Test
    fun screenUsesTheSharedIdentityForBothQuoteLocationsAndDedicatedAvatar() {
        val source = File("src/main/java/com/privatechat/couplechat/feature/chat/ChatScreen.kt").readText()
        assertEquals(2, Regex("chatSenderDisplayName\\(").findAll(source).count())
        assertTrue(source.contains("ChatSenderIdentity.WENLI -> WenliAvatar"))
        assertTrue(source.contains("ChatSenderIdentity.PARTNER -> ProfileAvatar"))
        assertFalse(source.contains("ownProfile.displayName else partner.displayName"))
    }
}
