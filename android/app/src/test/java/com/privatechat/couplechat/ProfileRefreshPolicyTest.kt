package com.privatechat.couplechat

import kotlin.time.Duration.Companion.seconds
import org.junit.Assert.assertEquals
import org.junit.Test

class ProfileRefreshPolicyTest {
    @Test
    fun partnerProfileRefreshesPromptlyWhileTheAppIsForegrounded() {
        assertEquals(15.seconds, PROFILE_REFRESH_INTERVAL)
    }
}
