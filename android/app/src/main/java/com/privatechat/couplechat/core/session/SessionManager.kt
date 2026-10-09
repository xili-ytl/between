package com.privatechat.couplechat.core.session

import com.privatechat.couplechat.core.model.Session
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

class SessionManager(private val store: SessionStore) {
    private val mutationMutex = Mutex()
    private val _session = MutableStateFlow<Session?>(null)
    val session: StateFlow<Session?> = _session.asStateFlow()

    private val _loaded = MutableStateFlow(false)
    val loaded: StateFlow<Boolean> = _loaded.asStateFlow()

    suspend fun load() = mutationMutex.withLock {
        _session.value = withContext(Dispatchers.IO) { store.read() }
        _loaded.value = true
    }

    suspend fun set(session: Session) = mutationMutex.withLock {
        store.save(session)
        _session.value = session
        _loaded.value = true
    }

    suspend fun clear() = mutationMutex.withLock {
        store.clear()
        _session.value = null
        _loaded.value = true
    }

    suspend fun clearIfCurrent(token: String): Boolean = mutationMutex.withLock {
        if (_session.value?.token != token) return@withLock false
        store.clear()
        _session.value = null
        _loaded.value = true
        true
    }

    suspend fun replaceIfCurrent(token: String, replacement: Session): Boolean = mutationMutex.withLock {
        if (_session.value?.token != token) return@withLock false
        store.save(replacement)
        _session.value = replacement
        _loaded.value = true
        true
    }

    fun current(): Session? = _session.value
}
