package com.privatechat.couplechat.feature.login

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

fun interface LoginGateway {
    suspend fun login(accountId: String, password: String): Session
}

class LoginViewModel(private val gateway: LoginGateway) : ViewModel() {
    private val _state = MutableStateFlow(LoginState())
    val state: StateFlow<LoginState> = _state.asStateFlow()

    fun setAccountId(value: String) {
        _state.update { it.copy(accountId = value.filter(Char::isDigit).take(4), error = null) }
    }

    fun setPassword(value: String) {
        _state.update { it.copy(password = value, error = null) }
    }

    fun submit() {
        val current = _state.value
        if (current.submitting) return
        if (current.accountId !in setOf("1001", "1002") || current.password.isEmpty()) {
            _state.update { it.copy(error = "请输入账号和密码") }
            return
        }
        _state.update { it.copy(submitting = true, error = null) }
        viewModelScope.launch {
            try {
                gateway.login(current.accountId, current.password)
                _state.update { it.copy(password = "", submitting = false, completed = true) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                _state.update { it.copy(submitting = false, error = friendlyError(error)) }
            }
        }
    }
}

private fun friendlyError(error: Throwable): String = when ((error as? ChatApiException)?.code) {
    "CREDENTIALS_INVALID" -> "账号或密码错误"
    "RATE_LIMITED" -> "尝试次数过多，请稍后再试"
    "CLIENT_NOT_CONFIGURED" -> "应用尚未连接云端，请先完成配置"
    "NETWORK_ERROR" -> "暂时无法连接服务器"
    else -> "登录失败，请稍后再试"
}
