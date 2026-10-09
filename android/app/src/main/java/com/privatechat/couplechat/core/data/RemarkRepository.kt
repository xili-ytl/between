package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.database.RemarkEntity
import com.privatechat.couplechat.core.database.RemarkLocalStore
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.SessionManager
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class RemarkRepository(
    private val api: ChatApi,
    private val local: RemarkLocalStore,
    private val sessions: SessionManager,
) {
    fun remark(targetId: String): Flow<String> {
        val ownerId = requireSession().accountId
        return local.observe(ownerId, targetId).map { it?.remark.orEmpty() }
    }

    fun displayName(targetId: String, fallback: String): Flow<String> {
        val ownerId = requireSession().accountId
        return local.observe(ownerId, targetId).map { row -> row?.remark?.takeIf(String::isNotBlank) ?: fallback }
    }

    suspend fun refresh(targetId: String) {
        val session = requireSession()
        try {
            val remote = api.remark(session.token, targetId)
            local.upsert(
                RemarkEntity(
                    ownerId = session.accountId,
                    targetId = targetId,
                    remark = remote.remark,
                    updatedAt = remote.updatedAt.orEmpty(),
                )
            )
        } catch (error: SessionInvalidException) {
            sessions.clearIfCurrent(session.token)
            throw error
        }
    }

    suspend fun set(targetId: String, remark: String) {
        val session = requireSession()
        try {
            val remote = api.setRemark(session.token, targetId, remark)
            local.upsert(
                RemarkEntity(
                    ownerId = session.accountId,
                    targetId = targetId,
                    remark = remote.remark,
                    updatedAt = remote.updatedAt.orEmpty(),
                )
            )
        } catch (error: SessionInvalidException) {
            sessions.clearIfCurrent(session.token)
            throw error
        }
    }

    private fun requireSession() = sessions.current() ?: throw SessionInvalidException()
}
