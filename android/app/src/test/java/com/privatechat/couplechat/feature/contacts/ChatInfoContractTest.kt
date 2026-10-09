package com.privatechat.couplechat.feature.contacts

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatInfoContractTest {
    @Test
    fun chatInfoContainsOnlyTheApprovedTwoPersonActions() {
        val source = File(
            "src/main/java/com/privatechat/couplechat/feature/contacts/ChatInfoScreen.kt",
        ).readText()

        assertTrue(source.contains("聊天信息"))
        assertTrue(source.contains("备注"))
        assertTrue(source.contains("查找聊天记录"))
        assertFalse(source.contains("清空聊天记录"))
        assertFalse(source.contains("投诉"))
        assertFalse(source.contains("拉黑"))
    }
}
