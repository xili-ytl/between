package com.privatechat.couplechat.core.session

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

sealed interface SessionRestoreState {
    data object Loading : SessionRestoreState
    data object Ready : SessionRestoreState
    data object Failed : SessionRestoreState
}

/** Keeps startup restore single-flight and makes a failed restore retryable without navigation replay. */
class SessionRestoreCoordinator(
    private val scope: CoroutineScope,
    alreadyLoaded: () -> Boolean,
    private val restore: suspend () -> Unit,
    private val prepare: suspend () -> Unit = {},
) {
    private val loaded = alreadyLoaded
    private val _state = MutableStateFlow<SessionRestoreState>(SessionRestoreState.Loading)
    val state: StateFlow<SessionRestoreState> = _state.asStateFlow()
    private var restoreJob: Job? = null

    fun start() {
        if (restoreJob?.isActive == true) return
        if (_state.value is SessionRestoreState.Ready) return
        _state.value = SessionRestoreState.Loading
        restoreJob = scope.launch {
            try {
                if (!loaded()) restore()
                prepare()
                _state.value = SessionRestoreState.Ready
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.value = SessionRestoreState.Failed
            } finally {
                restoreJob = null
            }
        }
    }

    fun retry() {
        if (_state.value is SessionRestoreState.Failed) start()
    }

    fun cancel() {
        restoreJob?.cancel()
        restoreJob = null
    }
}
