package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.image.ProcessedImage
import com.privatechat.couplechat.core.model.ImageMessage
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentVisibility
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.SessionManager
import kotlinx.coroutines.flow.FlowCollector
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock

interface MomentsDataSource {
    val moments: StateFlow<List<MomentItem>>
    suspend fun refresh()
    suspend fun create(clientId: String, body: String, visibility: MomentVisibility, image: ProcessedImage? = null)
    suspend fun delete(momentId: String)
    suspend fun like(momentId: String)
    suspend fun unlike(momentId: String)
    suspend fun comment(momentId: String, clientId: String, body: String, replyToCommentId: String? = null)
    suspend fun deleteComment(commentId: String)
}

class MomentsRepository(
    private val api: ChatApi,
    private val sessions: SessionManager,
    boundSession: Session,
) : MomentsDataSource {
    private val boundSessionKey = boundSession.momentsSessionKey()
    private val cachedMoments = MutableStateFlow<List<MomentItem>>(emptyList())
    private val operationMutex = Mutex()

    override val moments: StateFlow<List<MomentItem>> = SessionBoundMomentsFlow(
        cached = cachedMoments,
        sessions = sessions.session,
        boundSessionKey = boundSessionKey,
    )

    override suspend fun refresh() = operationMutex.withLock {
        refreshLocked(requireBoundSession())
    }

    override suspend fun create(clientId: String, body: String, visibility: MomentVisibility, image: ProcessedImage?) {
        mutate { session ->
            if (image == null) {
                api.createMoment(session.token, clientId, body, visibility)
            } else {
                val credential = api.requestMomentImageUploadCredential(session.token, clientId, image.mimeType)
                api.uploadImage(credential, image.bytes, image.mimeType)
                api.createMoment(
                    session.token,
                    clientId,
                    body,
                    visibility,
                    ImageMessage(credential.fileId, image.mimeType, image.width, image.height),
                )
            }
        }
    }

    override suspend fun delete(momentId: String) {
        mutate { session -> api.deleteMoment(session.token, momentId) }
    }

    override suspend fun like(momentId: String) {
        mutate { session -> api.likeMoment(session.token, momentId) }
    }

    override suspend fun unlike(momentId: String) {
        mutate { session -> api.unlikeMoment(session.token, momentId) }
    }

    override suspend fun comment(momentId: String, clientId: String, body: String, replyToCommentId: String?) {
        mutate { session -> api.createMomentComment(session.token, momentId, clientId, body, replyToCommentId) }
    }

    override suspend fun deleteComment(commentId: String) {
        mutate { session -> api.deleteMomentComment(session.token, commentId) }
    }

    private suspend fun mutate(block: suspend (Session) -> Any?) = operationMutex.withLock {
        val capturedSession = requireBoundSession()
        callApi(capturedSession) { block(capturedSession) }
        refreshLocked(capturedSession)
    }

    private suspend fun refreshLocked(capturedSession: Session) {
        val refreshed = callApi(capturedSession) { api.moments(capturedSession.token) }
        if (sessions.current()?.momentsSessionKey() == boundSessionKey) {
            cachedMoments.value = refreshed
        }
    }

    private fun requireBoundSession(): Session = sessions.current()
        ?.takeIf { it.momentsSessionKey() == boundSessionKey }
        ?: throw SessionInvalidException()

    private suspend fun <T> callApi(
        capturedSession: Session,
        block: suspend () -> T,
    ): T = try {
        block()
    } catch (error: SessionInvalidException) {
        sessions.clearIfCurrent(capturedSession.token)
        throw error
    }
}

private data class MomentsSessionKey(
    val accountId: String,
    val sessionVersion: Int,
    val token: String,
)

private fun Session.momentsSessionKey() = MomentsSessionKey(accountId, sessionVersion, token)

@OptIn(kotlinx.coroutines.ExperimentalForInheritanceCoroutinesApi::class)
private class SessionBoundMomentsFlow(
    private val cached: StateFlow<List<MomentItem>>,
    private val sessions: StateFlow<Session?>,
    private val boundSessionKey: MomentsSessionKey,
) : StateFlow<List<MomentItem>> {
    override val value: List<MomentItem>
        get() = cached.value.takeIf { sessionMatches(sessions.value) }.orEmpty()

    override val replayCache: List<List<MomentItem>>
        get() = listOf(value)

    override suspend fun collect(collector: FlowCollector<List<MomentItem>>): Nothing {
        combine(sessions, cached) { session, items ->
            items.takeIf { sessionMatches(session) }.orEmpty()
        }.distinctUntilChanged().collect(collector)
        error("Session-bound StateFlow collection completed unexpectedly")
    }

    private fun sessionMatches(session: Session?): Boolean =
        session?.momentsSessionKey() == boundSessionKey
}
