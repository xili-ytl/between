package com.privatechat.couplechat.feature.contacts

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.privatechat.couplechat.core.data.RemarkRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RemarkState(
    val value: String = "",
    val saving: Boolean = false,
    val saved: Boolean = false,
    val error: String? = null,
)

class RemarkViewModel(
    private val targetId: String,
    private val repository: RemarkRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(RemarkState())
    val state = _state.asStateFlow()
    private var edited = false

    init {
        viewModelScope.launch {
            repository.remark(targetId).collect { remote ->
                if (!edited) _state.update { it.copy(value = remote) }
            }
        }
        viewModelScope.launch { runCatching { repository.refresh(targetId) } }
    }

    fun setValue(value: String) {
        edited = true
        _state.update { it.copy(value = value, error = null, saved = false) }
    }

    fun save() {
        if (_state.value.saving) return
        _state.update { it.copy(saving = true, error = null) }
        viewModelScope.launch {
            try {
                repository.set(targetId, _state.value.value)
                edited = false
                _state.update { it.copy(saving = false, saved = true) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.update { it.copy(saving = false, error = "备注保存失败") }
            }
        }
    }

    fun consumeSaved() {
        _state.update { it.copy(saved = false) }
    }
}
