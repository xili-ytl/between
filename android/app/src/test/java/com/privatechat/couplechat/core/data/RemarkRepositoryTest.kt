package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.database.RemarkEntity
import com.privatechat.couplechat.core.database.RemarkLocalStore
import com.privatechat.couplechat.core.model.ContactRemark
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.session.SessionManager
import com.privatechat.couplechat.core.session.InMemorySessionStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class RemarkRepositoryTest {
    @Test
    fun resolvesCachedRemarkThenSyncsCloudChanges() = runTest {
        val local = FakeRemarkStore()
        local.upsert(RemarkEntity("1001", "1002", "宝宝", "2026-08-08T00:00:00Z"))
        val api = FakeRemarkApi(ContactRemark("1002", "先生", "2026-08-08T01:00:00Z"))
        val sessions = SessionManager(InMemorySessionStore())
        sessions.set(com.privatechat.couplechat.core.model.Session("1001", "示例乙", "token", 1))
        val repository = RemarkRepository(api, local, sessions)

        assertEquals("宝宝", repository.displayName("1002", "示例甲").first())
        repository.refresh("1002")
        assertEquals("先生", repository.displayName("1002", "示例甲").first())
    }
}

private class FakeRemarkStore : RemarkLocalStore {
    private val state = MutableStateFlow<RemarkEntity?>(null)
    override fun observe(ownerId: String, targetId: String): Flow<RemarkEntity?> = state
    override suspend fun upsert(remark: RemarkEntity) { state.value = remark }
}

private class FakeRemarkApi(private val remote: ContactRemark) : ChatApi by unusedChatApi() {
    override suspend fun remark(token: String, targetId: String): ContactRemark = remote
    override suspend fun setRemark(token: String, targetId: String, remark: String): ContactRemark =
        ContactRemark(targetId, remark, "2026-08-08T02:00:00Z")
}

private fun unusedChatApi(): ChatApi = object : ChatApi {
    override suspend fun login(accountId: String, password: String) = error("unused")
    override suspend fun logout(token: String) = Unit
    override suspend fun profiles(token: String) = error("unused")
    override suspend fun updateProfile(token: String, displayName: String) = error("unused")
    override suspend fun updateAvatar(token: String, mimeType: String, base64: String) = error("unused")
    override suspend fun changePassword(token: String, current: String, replacement: String) = error("unused")
    override suspend fun send(
        token: String,
        clientMessageId: String,
        body: String,
        replyToMessageId: String?,
        image: com.privatechat.couplechat.core.model.ImageMessage?,
    ) = error("unused")
    override suspend fun after(token: String, cursor: com.privatechat.couplechat.core.model.MessageCursor?) = error("unused")
    override suspend fun before(token: String, cursor: com.privatechat.couplechat.core.model.MessageCursor?) = error("unused")
    override suspend fun moments(token: String) = error("unused")
    override suspend fun createMoment(
        token: String,
        clientMomentId: String,
        body: String,
        visibility: com.privatechat.couplechat.core.model.MomentVisibility,
        image: com.privatechat.couplechat.core.model.ImageMessage?,
    ) = error("unused")
    override suspend fun deleteMoment(token: String, momentId: String) = Unit
    override suspend fun likeMoment(token: String, momentId: String) = error("unused")
    override suspend fun unlikeMoment(token: String, momentId: String) = Unit
    override suspend fun createMomentComment(token: String, momentId: String, clientCommentId: String, body: String, replyToCommentId: String?) = error("unused")
    override suspend fun deleteMomentComment(token: String, commentId: String) = Unit
}
