package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.database.MessageLocalStore
import com.privatechat.couplechat.core.model.ChatMessage

interface ChatSearchDataSource {
    suspend fun search(rawQuery: String): List<ChatMessage>
    suspend fun messageDates(): List<String>
    suspend fun firstMessageOn(localDate: String): ChatMessage?
}

class ChatSearchRepository(
    private val local: MessageLocalStore,
) : ChatSearchDataSource {
    override suspend fun search(rawQuery: String): List<ChatMessage> {
        val query = rawQuery.trim()
        if (query.isEmpty()) return emptyList()
        return local.search(ftsQuery(query), "%${escapeLike(query)}%").map { it.toModel() }
    }

    override suspend fun messageDates(): List<String> = local.messageDates()

    override suspend fun firstMessageOn(localDate: String): ChatMessage? = local.firstMessageOn(localDate)?.toModel()

    private fun ftsQuery(query: String): String = query
        .split(Regex("\\s+"))
        .filter(String::isNotBlank)
        .joinToString(" ") { token -> "\"${token.replace("\"", "\"\"")}\"*" }

    private fun escapeLike(query: String): String = query
        .replace("%", "\\%")
        .replace("_", "\\_")
}
