package com.privatechat.couplechat.feature.chat.search

import com.privatechat.couplechat.core.model.ChatMessage

data class ChatSearchState(
    val query: String = "",
    val results: List<ChatMessage> = emptyList(),
    val dates: List<String> = emptyList(),
    val loading: Boolean = false,
    val error: String? = null,
)
