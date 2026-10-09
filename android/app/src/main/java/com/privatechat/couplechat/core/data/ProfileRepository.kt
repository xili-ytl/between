package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.SessionManager
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface ProfileDataSource {
    val profiles: StateFlow<List<Profile>>
    val loadState: StateFlow<ProfileLoadState>
    suspend fun refresh()
    suspend fun updateDisplayName(displayName: String)
    suspend fun changePassword(current: String, replacement: String)
    suspend fun updateAvatar(mimeType: String, base64: String)
    suspend fun logout()
}

enum class ProfileLoadState { IDLE, LOADING, READY, FAILED }

class ProfileRepository(
    private val api: ChatApi,
    private val sessions: SessionManager,
    private val auth: AuthRepository,
    private val cacheStore: ProfileCacheStore = NoOpProfileCacheStore,
) : ProfileDataSource {
    private val cache = MutableStateFlow(ProfileCache())
    private val operationMutex = Mutex()
    override val profiles: StateFlow<List<Profile>> = SessionBoundProfilesFlow(cache, sessions.session)
    override val loadState: StateFlow<ProfileLoadState> = SessionBoundProfileLoadStateFlow(cache, sessions.session)

    override suspend fun refresh() = operationMutex.withLock {
        val captured = requireSession()
        updateLoadState(captured, ProfileLoadState.LOADING)
        try {
            val refreshed = callApi(captured) { api.profiles(captured.token) }
            publish(captured, refreshed)
        } catch (error: CancellationException) {
            updateLoadState(captured, cache.value.profiles.readyOrIdle())
            throw error
        } catch (error: Throwable) {
            updateLoadState(captured, ProfileLoadState.FAILED)
            throw error
        }
    }

    fun primeFromCache(session: Session) {
        if (cache.value.session == session) return
        val cached = cacheStore.read(session.accountId)
        cache.value = ProfileCache(
            session = session,
            profiles = cached.orEmpty(),
            loadState = if (cached.isNullOrEmpty()) ProfileLoadState.IDLE else ProfileLoadState.READY,
        )
    }

    /** Brand entry waits for a real own+partner pair; cache hits enter without a network call. */
    suspend fun prepareForEntry(session: Session) {
        if (sessions.current() != session) return
        primeFromCache(session)
        if (isReadyForEntry(session)) return
        refresh()
        if (!isReadyForEntry(session)) {
            updateLoadState(session, ProfileLoadState.FAILED)
            throw IllegalStateException("profile pair is incomplete")
        }
    }

    fun isReadyForEntry(session: Session): Boolean {
        val current = cache.value
        if (current.session != session) return false
        return current.profiles.any { it.accountId == session.accountId } &&
            current.profiles.any { it.accountId != session.accountId }
    }

    override suspend fun updateDisplayName(displayName: String) = operationMutex.withLock {
        val captured = requireSession()
        val updated = callApi(captured) { api.updateProfile(captured.token, displayName) }
        replace(captured, updated)
    }

    override suspend fun changePassword(current: String, replacement: String) = operationMutex.withLock {
        val captured = requireSession()
        val rotated = callApi(captured) { api.changePassword(captured.token, current, replacement) }
        sessions.replaceIfCurrent(captured.token, rotated)
        Unit
    }

    override suspend fun updateAvatar(mimeType: String, base64: String) = operationMutex.withLock {
        val captured = requireSession()
        val updated = callApi(captured) { api.updateAvatar(captured.token, mimeType, base64) }
        replace(captured, updated)
    }

    override suspend fun logout() = operationMutex.withLock {
        auth.logout()
    }

    private fun publish(captured: Session, refreshed: List<Profile>) {
        if (sessions.current() == captured) {
            cache.value = ProfileCache(captured, refreshed, ProfileLoadState.READY)
            cacheStore.write(captured.accountId, refreshed)
        }
    }

    private fun replace(captured: Session, profile: Profile) {
        if (sessions.current() != captured) return
        val existing = cache.value.takeIf { it.session == captured }?.profiles.orEmpty()
        val updated = (existing.filterNot { it.accountId == profile.accountId } + profile)
            .sortedBy(Profile::accountId)
        cache.value = ProfileCache(captured, updated, ProfileLoadState.READY)
        cacheStore.write(captured.accountId, updated)
    }

    private fun updateLoadState(captured: Session, state: ProfileLoadState) {
        if (sessions.current() != captured) return
        val current = cache.value
        cache.value = if (current.session == captured) {
            current.copy(loadState = state)
        } else {
            ProfileCache(session = captured, loadState = state)
        }
    }

    private fun requireSession(): Session = sessions.current() ?: throw SessionInvalidException()

    private suspend fun <T> callApi(captured: Session, block: suspend () -> T): T = try {
        block()
    } catch (error: SessionInvalidException) {
        sessions.clearIfCurrent(captured.token)
        throw error
    }
}

private data class ProfileCache(
    val session: Session? = null,
    val profiles: List<Profile> = emptyList(),
    val loadState: ProfileLoadState = ProfileLoadState.IDLE,
)

private fun List<Profile>.readyOrIdle(): ProfileLoadState =
    if (isEmpty()) ProfileLoadState.IDLE else ProfileLoadState.READY

@OptIn(kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi::class)
private class SessionBoundProfilesFlow(
    private val cache: StateFlow<ProfileCache>,
    private val sessions: StateFlow<Session?>,
) : StateFlow<List<Profile>> {
    override val value: List<Profile>
        get() {
            val current = cache.value
            return current.profiles.takeIf { current.session == sessions.value }.orEmpty()
        }

    override val replayCache: List<List<Profile>>
        get() = listOf(value)

    override suspend fun collect(collector: FlowCollector<List<Profile>>): Nothing {
        combine(sessions, cache) { session, cached ->
            cached.profiles.takeIf { cached.session == session }.orEmpty()
        }.distinctUntilChanged().collect(collector)
        error("Session-bound profile flow completed unexpectedly")
    }
}

@OptIn(kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi::class)
private class SessionBoundProfileLoadStateFlow(
    private val cache: StateFlow<ProfileCache>,
    private val sessions: StateFlow<Session?>,
) : StateFlow<ProfileLoadState> {
    override val value: ProfileLoadState
        get() {
            val current = cache.value
            return current.loadState.takeIf { current.session == sessions.value } ?: ProfileLoadState.IDLE
        }

    override val replayCache: List<ProfileLoadState>
        get() = listOf(value)

    override suspend fun collect(collector: FlowCollector<ProfileLoadState>): Nothing {
        combine(sessions, cache) { session, cached ->
            cached.loadState.takeIf { cached.session == session } ?: ProfileLoadState.IDLE
        }.distinctUntilChanged().collect(collector)
        error("Session-bound profile load-state flow completed unexpectedly")
    }
}
