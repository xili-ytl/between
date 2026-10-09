package com.privatechat.couplechat.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.privatechat.couplechat.core.data.ProfileDataSource
import com.privatechat.couplechat.core.network.ChatApiException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class SettingsViewModel(
    private val accountId: String,
    private val source: ProfileDataSource,
) : ViewModel() {
    private val _state = MutableStateFlow(SettingsState())
    val state: StateFlow<SettingsState> = _state.asStateFlow()

    init {
        viewModelScope.launch {
            source.profiles.collect { profiles ->
                val own = profiles.find { it.accountId == accountId }
                _state.update { current ->
                    current.copy(
                        profile = own,
                        displayName = if (current.displayNameDirty) current.displayName else own?.displayName.orEmpty(),
                    )
                }
            }
        }
        viewModelScope.launch { runCatching { source.refresh() } }
    }

    fun setDisplayName(value: String) {
        _state.update {
            it.copy(
                displayName = value,
                displayNameDirty = value != it.profile?.displayName.orEmpty(),
                error = null,
                message = null,
            )
        }
    }

    fun setCurrentPassword(value: String) {
        _state.update { it.copy(currentPassword = value, error = null, message = null) }
    }

    fun setNewPassword(value: String) {
        _state.update { it.copy(newPassword = value, error = null, message = null) }
    }

    fun saveDisplayName() {
        val name = _state.value.displayName.trim()
        if (name.codePoints().count() !in 1..30) {
            _state.update { it.copy(error = "用户名需为 1 到 30 个字符") }
            return
        }
        launchAction("用户名已保存") {
            source.updateDisplayName(name)
            _state.update { current ->
                if (current.displayName.trim() == name) {
                    current.copy(displayName = name, displayNameDirty = false)
                } else {
                    current
                }
            }
        }
    }

    fun changePassword() {
        val state = _state.value
        if (state.currentPassword.isEmpty()) {
            _state.update { it.copy(error = "请输入当前密码") }
            return
        }
        if (state.newPassword.codePoints().count() !in 4..128) {
            _state.update { it.copy(error = "新密码至少需要 4 个字符") }
            return
        }
        launchAction("密码已修改") {
            source.changePassword(state.currentPassword, state.newPassword)
            _state.update { it.copy(currentPassword = "", newPassword = "") }
        }
    }

    fun uploadAvatar(mimeType: String, base64: String) {
        launchAction("头像已更新") { source.updateAvatar(mimeType, base64) }
    }

    fun showAvatarError(message: String) {
        _state.update { it.copy(error = message, message = null) }
    }

    fun clearFeedback() {
        _state.update { it.copy(error = null, message = null) }
    }

    fun logout() {
        launchAction(null) { source.logout() }
    }

    private fun launchAction(successMessage: String?, action: suspend () -> Unit) {
        if (_state.value.busy) return
        _state.update { it.copy(busy = true, error = null, message = null) }
        viewModelScope.launch {
            try {
                action()
                _state.update { it.copy(busy = false, message = successMessage) }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                _state.update { it.copy(busy = false, error = settingsError(error)) }
            }
        }
    }
}

private fun settingsError(error: Throwable): String = when ((error as? ChatApiException)?.code) {
    "PASSWORD_INVALID" -> "当前密码不正确，或新密码格式不正确"
    "NETWORK_ERROR" -> "暂时无法连接服务器"
    "SESSION_INVALID" -> "登录已失效，请重新登录"
    else -> error.message?.takeIf { it.isNotBlank() } ?: "操作失败，请稍后再试"
}
