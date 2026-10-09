package com.privatechat.couplechat.feature.chat

import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

internal class ChatTimeFormatter(
    private val zoneId: ZoneId = ZoneId.of("Asia/Shanghai"),
) {
    private val time = DateTimeFormatter.ofPattern("HH:mm")
    private val currentYear = DateTimeFormatter.ofPattern("M月d日 HH:mm")
    private val olderYear = DateTimeFormatter.ofPattern("yyyy年M月d日 HH:mm")

    fun format(value: Instant, now: Instant = Instant.now()): String {
        val dateTime = value.atZone(zoneId)
        val today = now.atZone(zoneId).toLocalDate()
        return when (dateTime.toLocalDate()) {
            today -> time.format(dateTime)
            today.minusDays(1) -> "昨天 ${time.format(dateTime)}"
            else -> if (dateTime.year == today.year) currentYear.format(dateTime) else olderYear.format(dateTime)
        }
    }

    fun shouldShowSeparator(previous: Instant?, current: Instant): Boolean {
        if (previous == null) return true
        val previousDate = previous.atZone(zoneId).toLocalDate()
        val currentDate = current.atZone(zoneId).toLocalDate()
        return previousDate != currentDate || Duration.between(previous, current).seconds >= FIVE_MINUTES_SECONDS
    }

    private companion object {
        const val FIVE_MINUTES_SECONDS = 5 * 60L
    }
}
