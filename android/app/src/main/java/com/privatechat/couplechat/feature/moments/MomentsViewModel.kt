package com.privatechat.couplechat.feature.moments

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import androidx.annotation.MainThread
import com.privatechat.couplechat.core.data.MomentsDataSource
import com.privatechat.couplechat.core.data.ReadStateRepository
import com.privatechat.couplechat.core.image.ProcessedImage
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentVisibility
import java.time.Instant
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

class MomentsViewModel(
    private val source: MomentsDataSource,
    private val readStates: ReadStateRepository? = null,
    private val newClientId: () -> String = { UUID.randomUUID().toString() },
) : ViewModel() {
    private val _state = MutableStateFlow(MomentsState())
    val state: StateFlow<MomentsState> = _state.asStateFlow()

    private var pendingPublishId: String? = null
    private val pendingCommentIds = mutableMapOf<String, String>()

    init {
        viewModelScope.launch {
            source.moments.collect { items ->
                val seenAt = readStates?.state?.value?.lastSeenMomentAt ?: ""
                _state.update { it.copy(items = items, hasUnseen = hasUnseenMoments(items, seenAt)) }
            }
        }
    }

    /** 进入朋友圈时标记已读，清除发现页红点。 */
    @MainThread
    fun markSeen() {
        val store = readStates ?: return
        store.markMomentsSeen(Instant.now().toString())
        viewModelScope.launch { store.pushToCloud() }
        _state.update { it.copy(hasUnseen = false) }
    }

    @MainThread
    fun refresh() {
        val hadLoaded = _state.value.loadState == MomentsLoadState.LOADED
        if (!startAction(REFRESH_KEY)) return
        if (!hadLoaded) {
            _state.update { it.copy(loadState = MomentsLoadState.LOADING) }
        }
        viewModelScope.launch {
            try {
                source.refresh()
                val items = source.moments.value
                val seenAt = readStates?.state?.value?.lastSeenMomentAt ?: ""
                _state.update {
                    it.copy(
                        items = items,
                        hasUnseen = hasUnseenMoments(items, seenAt),
                        loadState = MomentsLoadState.LOADED,
                    )
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                _state.update {
                    it.copy(
                        loadState = if (hadLoaded) MomentsLoadState.LOADED else MomentsLoadState.FAILED,
                        error = transientError(error),
                    )
                }
            } finally {
                finishAction(REFRESH_KEY)
            }
        }
    }

    @MainThread
    fun setDraft(value: String) {
        val current = _state.value
        if (value != current.draft) pendingPublishId = null
        _state.update { it.copy(draft = value, error = null) }
    }

    @MainThread
    fun setVisibility(value: MomentVisibility) {
        val current = _state.value
        if (value != current.visibility) pendingPublishId = null
        _state.update { it.copy(visibility = value, error = null) }
    }

    @MainThread
    fun setPendingImage(uri: String, image: ProcessedImage) {
        _state.update {
            it.copy(
                pendingImage = PendingMomentImage(uri, image.mimeType, image.bytes, image.width, image.height),
                error = null,
            )
        }
    }

    @MainThread
    fun clearPendingImage() {
        _state.update { it.copy(pendingImage = null) }
    }

    @MainThread
    fun showError(message: String) {
        _state.update { it.copy(error = message) }
    }

    @MainThread
    fun publish(): String? {
        if (PUBLISH_KEY in _state.value.busyKeys) return null
        val current = _state.value
        val submittedDraft = current.draft
        val submittedVisibility = current.visibility
        val submittedImage = current.pendingImage
        val body = submittedDraft.trim()
        when {
            body.isEmpty() && submittedImage == null -> {
                _state.update { it.copy(error = "请输入动态内容或选择图片") }
                return null
            }

            body.codePoints().count() > POST_LIMIT -> {
                _state.update { it.copy(error = "动态内容不能超过 2000 个字符") }
                return null
            }
        }

        val clientId = pendingPublishId ?: newClientId().also { pendingPublishId = it }
        if (!startAction(PUBLISH_KEY)) return null
        _state.update {
            it.copy(
                publishRequestId = clientId,
                publishCompletionId = null,
            )
        }
        viewModelScope.launch {
            try {
                source.create(
                    clientId,
                    body,
                    submittedVisibility,
                    submittedImage?.let { ProcessedImage(it.mimeType, it.bytes, it.width, it.height) },
                )
                if (
                    pendingPublishId == clientId &&
                    _state.value.draft == submittedDraft &&
                    _state.value.visibility == submittedVisibility
                ) {
                    pendingPublishId = null
                    _state.update {
                        it.copy(
                            draft = "",
                            visibility = MomentVisibility.PARTNER,
                            pendingImage = null,
                            error = null,
                            publishCompletionId = clientId,
                        )
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                _state.update { it.copy(error = transientError(error)) }
            } finally {
                finishAction(PUBLISH_KEY)
                _state.update {
                    if (it.publishRequestId == clientId) it.copy(publishRequestId = null) else it
                }
            }
        }
        return clientId
    }

    @MainThread
    fun consumePublishCompletion(requestId: String) {
        _state.update {
            if (it.publishCompletionId == requestId) it.copy(publishCompletionId = null) else it
        }
    }

    @MainThread
    fun setCommentDraft(momentId: String, value: String) {
        val currentValue = _state.value.commentDrafts[momentId]
        if (value != currentValue) pendingCommentIds.remove(momentId)
        _state.update {
            it.copy(
                commentDrafts = it.commentDrafts + (momentId to value),
                error = null,
            )
        }
    }

    @MainThread
    fun startComment(momentId: String, replyToCommentId: String?) {
        _state.update {
            it.copy(
                commentEditorOpen = it.commentEditorOpen + momentId,
                replyingTo = if (replyToCommentId == null) it.replyingTo - momentId
                else it.replyingTo + (momentId to replyToCommentId),
                error = null,
            )
        }
    }

    @MainThread
    fun cancelReply(momentId: String) {
        _state.update { it.copy(replyingTo = it.replyingTo - momentId) }
    }

    @MainThread
    fun toggleExpandComments(momentId: String) {
        _state.update {
            it.copy(
                expandedComments = if (momentId in it.expandedComments) it.expandedComments - momentId
                else it.expandedComments + momentId,
            )
        }
    }

    @MainThread
    fun comment(momentId: String) {
        val key = commentKey(momentId)
        if (key in _state.value.busyKeys) return
        val submittedDraft = _state.value.commentDrafts[momentId].orEmpty()
        val submittedReplyTo = _state.value.replyingTo[momentId]
        val body = submittedDraft.trim()
        when {
            body.isEmpty() -> {
                _state.update { it.copy(error = "请输入评论内容") }
                return
            }

            body.codePoints().count() > COMMENT_LIMIT -> {
                _state.update { it.copy(error = "评论不能超过 500 个字符") }
                return
            }
        }

        val clientId = pendingCommentIds[momentId] ?: newClientId().also {
            pendingCommentIds[momentId] = it
        }
        if (!startAction(key)) return
        viewModelScope.launch {
            try {
                source.comment(momentId, clientId, body, submittedReplyTo)
                if (
                    pendingCommentIds[momentId] == clientId &&
                    _state.value.commentDrafts[momentId] == submittedDraft &&
                    _state.value.replyingTo[momentId] == submittedReplyTo
                ) {
                    pendingCommentIds.remove(momentId)
                    _state.update {
                        it.copy(
                            commentDrafts = it.commentDrafts - momentId,
                            commentEditorOpen = it.commentEditorOpen - momentId,
                            replyingTo = it.replyingTo - momentId,
                            error = null,
                        )
                    }
                }
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                _state.update { it.copy(error = transientError(error)) }
            } finally {
                finishAction(key)
            }
        }
    }

    @MainThread
    fun like(momentId: String) {
        launchAction(reactionOrDeleteKey(momentId)) { source.like(momentId) }
    }

    @MainThread
    fun unlike(momentId: String) {
        launchAction(reactionOrDeleteKey(momentId)) { source.unlike(momentId) }
    }

    @MainThread
    fun delete(momentId: String) {
        launchAction(reactionOrDeleteKey(momentId)) { source.delete(momentId) }
    }

    @MainThread
    fun deleteComment(commentId: String) {
        launchAction("delete-comment:$commentId") { source.deleteComment(commentId) }
    }

    private fun launchAction(key: String, action: suspend () -> Unit) {
        if (!startAction(key)) return
        viewModelScope.launch {
            try {
                action()
            } catch (error: CancellationException) {
                throw error
            } catch (error: Throwable) {
                _state.update { it.copy(error = transientError(error)) }
            } finally {
                finishAction(key)
            }
        }
    }

    private fun startAction(key: String): Boolean {
        if (key in _state.value.busyKeys) return false
        _state.update { it.copy(busyKeys = it.busyKeys + key, error = null) }
        return true
    }

    private fun finishAction(key: String) {
        _state.update { it.copy(busyKeys = it.busyKeys - key) }
    }

    private companion object {
        const val REFRESH_KEY = "refresh"
        const val PUBLISH_KEY = "publish"
        const val POST_LIMIT = 2_000
        const val COMMENT_LIMIT = 500

        fun commentKey(momentId: String) = "comment:$momentId"
        fun reactionOrDeleteKey(momentId: String) = "reaction-or-delete:$momentId"
    }
}

private fun transientError(error: Throwable): String =
    error.message?.takeIf(String::isNotBlank) ?: "操作失败，请稍后重试"

/** 是否还有动态/互动晚于已读时间点（发现页红点判定）。 */
internal fun hasUnseenMoments(items: List<MomentItem>, seenAt: String): Boolean =
    items.any { moment ->
        moment.createdAt > seenAt ||
            moment.likes.any { it.createdAt > seenAt } ||
            moment.comments.any { it.createdAt > seenAt }
    }
