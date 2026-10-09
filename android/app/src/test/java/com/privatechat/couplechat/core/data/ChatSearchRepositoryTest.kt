package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.database.MessageEntity
import com.privatechat.couplechat.core.database.MessageLocalStore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatSearchRepositoryTest {
    @Test
    fun trimsQueriesAndReturnsDatesAndFirstMessage() = runTest {
        val row = MessageEntity("m1", "couple", "1001", "1002", "m1", "晚安啦", "2026-08-08T00:00:00Z")
        val local = FakeSearchStore(row)
        val repository = ChatSearchRepository(local)

        assertEquals(listOf("m1"), repository.search("  晚安  ").map { it.id })
        assertEquals(listOf("2026-08-08"), repository.messageDates())
        assertEquals("m1", repository.firstMessageOn("2026-08-08")?.id)
        assertEquals("\"晚安\"*", local.lastFts)
        assertEquals("%晚安%", local.lastLike)
    }
}

private class FakeSearchStore(private val row: MessageEntity) : MessageLocalStore {
    var lastFts = ""
    var lastLike = ""
    override fun observeLatest(limit: Int): Flow<List<MessageEntity>> = emptyFlow()
    override suspend fun insertAll(messages: List<MessageEntity>) = 0
    override suspend fun newest() = row
    override suspend fun oldest() = row
    override suspend fun count() = 1
    override suspend fun search(fts: String, like: String): List<MessageEntity> {
        lastFts = fts
        lastLike = like
        return listOf(row)
    }
    override suspend fun messageDates() = listOf("2026-08-08")
    override suspend fun firstMessageOn(localDate: String) = row
}
