package com.privatechat.couplechat.feature.chat

import java.time.Instant
import java.time.ZoneId
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatTimeFormatterTest {
    private val formatter = ChatTimeFormatter(ZoneId.of("Asia/Shanghai"))
    private val now = Instant.parse("2026-08-08T04:00:00Z")

    @Test
    fun formatsTodayYesterdayCurrentYearAndOlderYear() {
        assertEquals("11:30", formatter.format(Instant.parse("2026-08-08T03:30:00Z"), now))
        assertEquals("昨天 23:12", formatter.format(Instant.parse("2026-08-07T15:12:00Z"), now))
        assertEquals("6月12日 08:00", formatter.format(Instant.parse("2026-06-12T00:00:00Z"), now))
        assertEquals("2025年12月31日 23:00", formatter.format(Instant.parse("2025-12-31T15:00:00Z"), now))
    }

    @Test
    fun showsSeparatorsAfterFiveMinutesOrAcrossDates() {
        val first = Instant.parse("2026-08-08T03:00:00Z")
        assertTrue(formatter.shouldShowSeparator(previous = null, current = first))
        assertFalse(formatter.shouldShowSeparator(first, first.plusSeconds(299)))
        assertTrue(formatter.shouldShowSeparator(first, first.plusSeconds(300)))
        assertTrue(formatter.shouldShowSeparator(
            Instant.parse("2026-08-07T15:59:59Z"),
            Instant.parse("2026-08-07T16:00:01Z"),
        ))
    }
}
