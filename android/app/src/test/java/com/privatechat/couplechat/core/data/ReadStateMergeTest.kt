package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.model.ReadState
import org.junit.Assert.assertEquals
import org.junit.Test

class ReadStateMergeTest {
    @Test
    fun ownConfirmedReceiptRepairsStaleLegacyUnreadCursor() {
        val merged = mergeReadState(
            current = ReadState(
                accountId = "1002",
                lastReadMessageId = "old",
                lastReadMessageCreatedAt = "2026-09-20T10:00:00.000Z",
            ),
            server = ReadState(
                accountId = "1002",
                lastReadMessageId = "old",
                lastReadMessageCreatedAt = "2026-09-20T10:00:00.000Z",
                readReceiptMessageId = "seen",
                readReceiptMessageCreatedAt = "2026-09-22T09:30:00.000Z",
            ),
            accountId = "1002",
        )

        assertEquals("seen", merged.lastReadMessageId)
        assertEquals("2026-09-22T09:30:00.000Z", merged.lastReadMessageCreatedAt)
    }

    @Test
    fun partnerReceiptNeverClearsMyUnreadMessages() {
        val merged = mergeReadState(
            current = ReadState(
                accountId = "1002",
                lastReadMessageId = "mine",
                lastReadMessageCreatedAt = "2026-09-20T10:00:00.000Z",
            ),
            server = ReadState(
                accountId = "1002",
                partnerReadReceiptMessageId = "partner-seen",
                partnerReadReceiptMessageCreatedAt = "2026-09-22T09:30:00.000Z",
            ),
            accountId = "1002",
        )

        assertEquals("mine", merged.lastReadMessageId)
        assertEquals("2026-09-20T10:00:00.000Z", merged.lastReadMessageCreatedAt)
    }
}
