package com.privatechat.couplechat.core.sync

import kotlin.time.Duration
import kotlin.time.Duration.Companion.seconds

class AdaptiveSyncPolicy {
    fun nextDelay(consecutiveIdlePolls: Int): Duration = when {
        consecutiveIdlePolls < 3 -> 2.seconds
        consecutiveIdlePolls < 10 -> 5.seconds
        else -> 15.seconds
    }
}
