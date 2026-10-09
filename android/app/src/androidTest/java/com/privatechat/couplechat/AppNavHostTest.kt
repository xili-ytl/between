package com.privatechat.couplechat

import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class AppNavHostTest {
    @get:Rule
    val compose = createComposeRule()

    @Test
    fun profileLoadFailureHasAWorkingRetryAction() {
        var retried = false
        compose.setContent { ProfileLoadFailure(onRetry = { retried = true }) }

        compose.onNodeWithText("资料加载失败").assertExists()
        compose.onNodeWithText("重试").performClick()
        compose.runOnIdle { assertTrue(retried) }
    }
}
