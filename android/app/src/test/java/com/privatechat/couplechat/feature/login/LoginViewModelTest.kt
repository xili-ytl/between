@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.feature.login

import com.privatechat.couplechat.MainDispatcherRule
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApiException
import kotlinx.coroutines.delay
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class LoginViewModelTest {
    @get:Rule
    val main = MainDispatcherRule()

    @Test
    fun successfulLoginClearsPasswordAndPublishesCompletion() = runTest(main.dispatcher) {
        val gateway = FakeLoginGateway()
        val viewModel = LoginViewModel(gateway)
        viewModel.setAccountId("1001")
        viewModel.setPassword("1013")

        viewModel.submit()
        advanceUntilIdle()

        assertEquals(listOf("1001" to "1013"), gateway.attempts)
        assertTrue(viewModel.state.value.completed)
        assertEquals("", viewModel.state.value.password)
    }

    @Test
    fun invalidCredentialsShowFriendlyChineseError() = runTest(main.dispatcher) {
        val viewModel = LoginViewModel(FakeLoginGateway(ChatApiException("CREDENTIALS_INVALID", "server")))
        viewModel.setAccountId("1002")
        viewModel.setPassword("wrong")

        viewModel.submit()
        advanceUntilIdle()

        assertEquals("账号或密码错误", viewModel.state.value.error)
        assertFalse(viewModel.state.value.submitting)
    }

    @Test
    fun repeatedTapsSubmitOnlyOnce() = runTest(main.dispatcher) {
        val gateway = FakeLoginGateway(delayMillis = 100)
        val viewModel = LoginViewModel(gateway)
        viewModel.setAccountId("1001")
        viewModel.setPassword("1013")

        viewModel.submit()
        viewModel.submit()
        advanceUntilIdle()

        assertEquals(1, gateway.attempts.size)
    }
}

private class FakeLoginGateway(
    private val failure: Throwable? = null,
    private val delayMillis: Long = 0,
) : LoginGateway {
    val attempts = mutableListOf<Pair<String, String>>()

    override suspend fun login(accountId: String, password: String): Session {
        attempts += accountId to password
        if (delayMillis > 0) delay(delayMillis)
        failure?.let { throw it }
        return Session(accountId, accountId, "token", 1)
    }
}
