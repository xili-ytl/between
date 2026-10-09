package com.privatechat.couplechat.core.sync

import kotlin.time.Duration.Companion.seconds
import org.junit.Assert.assertEquals
import org.junit.Test

class AdaptiveSyncPolicyTest {
    private val policy = AdaptiveSyncPolicy()

    @Test
    fun startsFastAndBacksOffWhileConversationIsIdle() {
        assertEquals(2.seconds, policy.nextDelay(0))
        assertEquals(5.seconds, policy.nextDelay(5))
        assertEquals(15.seconds, policy.nextDelay(100))
    }

    @Test
    fun neverReturnsAZeroOrBackgroundInterval() {
        assertEquals(2.seconds, policy.nextDelay(-1))
        assertEquals(15.seconds, policy.nextDelay(Int.MAX_VALUE))
    }
}
