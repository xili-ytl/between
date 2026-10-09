package com.privatechat.couplechat.feature.chat.search

import com.privatechat.couplechat.MainDispatcherRule
import com.privatechat.couplechat.core.data.ChatSearchDataSource
import com.privatechat.couplechat.core.model.ChatMessage
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class ChatSearchViewModelTest {
    @get:Rule
    val main = MainDispatcherRule()

    @Test
    fun loadsAvailableDatesAndSearchesTrimmedText() = runTest(main.dispatcher) {
        val result = message("m1", "晚安")
        val source = FakeSearchSource(result)
        val viewModel = ChatSearchViewModel(source)
        runCurrent()

        assertEquals(listOf("2026-08-08"), viewModel.state.value.dates)

        viewModel.setQuery("  晚安  ")
        runCurrent()

        assertEquals("晚安", source.lastQuery)
        assertEquals(listOf(result), viewModel.state.value.results)
    }

    @Test
    fun clearingQueryClearsResultsWithoutSearching() = runTest(main.dispatcher) {
        val source = FakeSearchSource(message("m1", "晚安"))
        val viewModel = ChatSearchViewModel(source)
        runCurrent()
        viewModel.setQuery("晚安")
        runCurrent()
        viewModel.setQuery("")

        assertEquals(emptyList<ChatMessage>(), viewModel.state.value.results)
    }
}

private class FakeSearchSource(private val result: ChatMessage) : ChatSearchDataSource {
    var lastQuery = ""
    override suspend fun search(rawQuery: String): List<ChatMessage> {
        lastQuery = rawQuery
        return listOf(result)
    }
    override suspend fun messageDates() = listOf("2026-08-08")
    override suspend fun firstMessageOn(localDate: String) = result
}

private fun message(id: String, body: String) = ChatMessage(
    id = id,
    relationshipId = "couple",
    senderId = "1001",
    recipientId = "1002",
    clientMessageId = id,
    body = body,
    createdAt = "2026-08-08T00:00:00Z",
)
