package com.privatechat.couplechat.core.push

import com.privatechat.couplechat.core.model.MessageCursor
import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatNotificationStateTest {
    @Test
    fun sameMessageIsShownOnceAndDisplayedNotificationIdsCanBeConsumed() {
        val state = ChatNotificationStateStore(tempFile())

        assertTrue(state.shouldShow("message-1", 101, chatVisible = false))
        assertFalse(state.shouldShow("message-1", 102, chatVisible = false))
        assertEquals(listOf(101), state.takeDisplayedNotificationIds())
        assertEquals(emptyList<Int>(), state.takeDisplayedNotificationIds())
        assertFalse(state.shouldShow("message-1", 103, chatVisible = false))
    }

    @Test
    fun foregroundMessageIsSuppressedAndDoesNotCreateDisplayedNotification() {
        val state = ChatNotificationStateStore(tempFile())

        assertFalse(state.shouldShow("message-2", 201, chatVisible = true))
        assertEquals(emptyList<Int>(), state.takeDisplayedNotificationIds())
        assertFalse(state.shouldShow("message-2", 202, chatVisible = false))
    }

    @Test
    fun serverConfirmedReadSuppressesAFirstLatePushAfterSyncAndSurvivesRestart() {
        val file = tempFile()
        ChatNotificationStateStore(file).recordServerConfirmedRead(
            accountId = "1001",
            cursor = MessageCursor("2026-09-16T03:00:00.000Z", "1002_read"),
        )
        val restarted = ChatNotificationStateStore(file)

        assertFalse(
            restarted.shouldShow(
                accountId = "1001",
                messageId = "1002_read",
                messageCreatedAt = "2026-09-16T03:00:00.000Z",
                notificationId = 301,
                chatVisible = false,
            ),
        )
        assertFalse(
            restarted.shouldShow(
                accountId = "1001",
                messageId = "1002_history",
                messageCreatedAt = "2026-09-16T02:59:00.000Z",
                notificationId = 302,
                chatVisible = false,
            ),
        )
        assertTrue(
            restarted.shouldShow(
                accountId = "1001",
                messageId = "1002_new",
                messageCreatedAt = "2026-09-16T03:01:00.000Z",
                notificationId = 303,
                chatVisible = false,
            ),
        )
    }

    @Test
    fun readCursorIsMonotonicAndIsolatedByAccount() {
        val state = ChatNotificationStateStore(tempFile())
        state.recordServerConfirmedRead(
            "1001",
            MessageCursor("2026-09-16T03:05:00.000Z", "1002_newer"),
        )
        state.recordServerConfirmedRead(
            "1001",
            MessageCursor("2026-09-16T03:04:00.000Z", "1002_older"),
        )

        assertFalse(
            state.shouldShow(
                accountId = "1001",
                messageId = "1002_older",
                messageCreatedAt = "2026-09-16T03:04:00.000Z",
                notificationId = 304,
                chatVisible = false,
            ),
        )
        assertTrue(
            state.shouldShow(
                accountId = "1002",
                messageId = "1001_same-time",
                messageCreatedAt = "2026-09-16T03:05:00.000Z",
                notificationId = 305,
                chatVisible = false,
            ),
        )
    }

    @Test
    fun readCursorUsesMessageIdAsTheTieBreakerAtTheSameTimestamp() {
        val state = ChatNotificationStateStore(tempFile())
        val timestamp = "2026-09-16T03:05:00.000Z"

        state.recordServerConfirmedRead("1001", MessageCursor(timestamp, "1002_b"))

        assertFalse(
            state.shouldShow(
                accountId = "1001",
                messageId = "1002_a",
                messageCreatedAt = timestamp,
                notificationId = 307,
                chatVisible = false,
            ),
        )
        assertTrue(
            state.shouldShow(
                accountId = "1001",
                messageId = "1002_c",
                messageCreatedAt = timestamp,
                notificationId = 308,
                chatVisible = false,
            ),
        )
    }

    @Test
    fun missingServerTimestampUsesTheLegacyMessageIdFallback() {
        val state = ChatNotificationStateStore(tempFile())
        state.recordServerConfirmedRead(
            "1001",
            MessageCursor("2026-09-16T03:10:00.000Z", "1002_read"),
        )

        assertTrue(
            state.shouldShow(
                accountId = "1001",
                messageId = "1002_legacy",
                messageCreatedAt = null,
                notificationId = 306,
                chatVisible = false,
            ),
        )
        assertFalse(state.shouldShow("1002_legacy", 307, chatVisible = false))
    }

    @Test
    fun fileMarkerIsVisibleToAnotherStoreInstanceAndCanBeCleared() {
        val file = tempFile()
        val first = FileChatVisibilityMarker(file)
        val second = FileChatVisibilityMarker(file)

        first.markVisible(1234)
        assertEquals(1234, second.activeProcessId())
        second.clear()
        assertEquals(null, first.activeProcessId())
    }

    private fun tempFile(): File = File.createTempFile("between-chat-notifications", ".state").also { it.deleteOnExit() }
}
