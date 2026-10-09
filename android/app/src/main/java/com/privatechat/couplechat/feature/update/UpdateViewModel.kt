package com.privatechat.couplechat.feature.update

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.privatechat.couplechat.core.update.InvalidUpdatePackageException
import com.privatechat.couplechat.core.update.UpdateCheck
import com.privatechat.couplechat.core.update.UpdateDataSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class UpdateViewModel(private val source: UpdateDataSource) : ViewModel() {
    private val _state = MutableStateFlow(UpdateState())
    val state: StateFlow<UpdateState> = _state.asStateFlow()
    private var nextInstallRequestId = 1L

    fun check() {
        if (_state.value.phase in setOf(UpdatePhase.CHECKING, UpdatePhase.DOWNLOADING)) return
        _state.value = UpdateState(phase = UpdatePhase.CHECKING)
        viewModelScope.launch {
            try {
                _state.value = when (val result = source.check()) {
                    is UpdateCheck.Current -> UpdateState(
                        phase = UpdatePhase.CURRENT,
                        release = result.release,
                    )
                    is UpdateCheck.Available -> UpdateState(
                        phase = UpdatePhase.AVAILABLE,
                        release = result.release,
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.value = UpdateState(
                    phase = UpdatePhase.ERROR,
                    error = "检查失败，请重试",
                )
            }
        }
    }

    fun startUpdate() {
        val release = _state.value.release ?: return
        if (_state.value.phase == UpdatePhase.DOWNLOADING) return
        _state.update {
            it.copy(
                phase = UpdatePhase.DOWNLOADING,
                progress = 0,
                error = null,
                installRequest = null,
            )
        }
        viewModelScope.launch {
            try {
                val file = source.download(release) { progress ->
                    _state.update { current ->
                        if (current.phase == UpdatePhase.DOWNLOADING) {
                            current.copy(progress = progress.coerceIn(0, 100))
                        } else {
                            current
                        }
                    }
                }
                _state.update {
                    it.copy(
                        phase = UpdatePhase.READY,
                        progress = 100,
                        installRequest = UpdateInstallRequest(nextInstallRequestId++, file),
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (_: InvalidUpdatePackageException) {
                _state.update {
                    it.copy(
                        phase = UpdatePhase.ERROR,
                        error = "更新包无效，请重试",
                    )
                }
            } catch (_: Throwable) {
                _state.update {
                    it.copy(
                        phase = UpdatePhase.ERROR,
                        error = "下载失败，请重试",
                    )
                }
            }
        }
    }

    fun dismissAvailable() {
        if (_state.value.phase == UpdatePhase.AVAILABLE) {
            _state.value = UpdateState()
        }
    }

    fun consumeInstallRequest() {
        _state.update { it.copy(installRequest = null) }
    }
}
