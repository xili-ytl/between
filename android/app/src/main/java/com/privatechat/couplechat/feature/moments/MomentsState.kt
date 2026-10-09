package com.privatechat.couplechat.feature.moments

import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentVisibility

enum class MomentsLoadState {
    NOT_STARTED,
    LOADING,
    LOADED,
    FAILED,
}

data class MomentsState(
    val items: List<MomentItem> = emptyList(),
    val draft: String = "",
    val visibility: MomentVisibility = MomentVisibility.PARTNER,
    val pendingImage: PendingMomentImage? = null,
    val commentDrafts: Map<String, String> = emptyMap(),
    /** 评论编辑器打开的动态 id 集合 */
    val commentEditorOpen: Set<String> = emptySet(),
    /** 动态 id → 被回复的评论 id；不在 map 即普通评论 */
    val replyingTo: Map<String, String> = emptyMap(),
    /** 评论已展开全部的动态 id 集合（折叠策略见 MomentCard） */
    val expandedComments: Set<String> = emptySet(),
    /** 有新动态/互动未查看时 true（发现页红点） */
    val hasUnseen: Boolean = false,
    val loadState: MomentsLoadState = MomentsLoadState.NOT_STARTED,
    val busyKeys: Set<String> = emptySet(),
    val error: String? = null,
    val publishRequestId: String? = null,
    val publishCompletionId: String? = null,
)

data class PendingMomentImage(
    val uri: String,
    val mimeType: String,
    val bytes: ByteArray,
    val width: Int,
    val height: Int,
)
