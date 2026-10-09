package com.privatechat.couplechat.feature.chat.search

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.privatechat.couplechat.core.data.ChatSearchDataSource
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class ChatSearchViewModel(
    private val source: ChatSearchDataSource,
) : ViewModel() {
    private val _state = MutableStateFlow(ChatSearchState())
    val state: StateFlow<ChatSearchState> = _state.asStateFlow()
    private var searchJob: Job? = null

    init {
        viewModelScope.launch {
            runCatching { source.messageDates() }
                .onSuccess { dates -> _state.update { it.copy(dates = dates) } }
        }
    }

    fun setQuery(value: String) {
        val query = value.trim()
        searchJob?.cancel()
        if (query.isEmpty()) {
            _state.update { it.copy(query = "", results = emptyList(), loading = false, error = null) }
            return
        }
        _state.update { it.copy(query = query, loading = true, error = null) }
        searchJob = viewModelScope.launch {
            try {
                val results = source.search(query)
                _state.update { it.copy(results = results, loading = false) }
            } catch (error: CancellationException) {
                throw error
            } catch (_: Throwable) {
                _state.update { it.copy(loading = false, error = "搜索失败") }
            }
        }
    }

    suspend fun firstMessageOn(localDate: String) = source.firstMessageOn(localDate)
}
