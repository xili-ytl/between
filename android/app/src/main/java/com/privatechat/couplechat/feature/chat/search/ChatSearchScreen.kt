package com.privatechat.couplechat.feature.chat.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.ui.WeUiDisclosureIcon
import com.privatechat.couplechat.ui.WechatTopBar
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

@Composable
fun ChatSearchScreen(
    state: ChatSearchState,
    onQueryChanged: (String) -> Unit,
    onOpenDate: () -> Unit,
    onOpenMessage: (String) -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(
        topBar = { WechatTopBar("查找聊天记录", onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding)) {
            SearchField(state.query, onQueryChanged)
            when {
                state.query.isBlank() -> DateEntry(state.dates.isNotEmpty(), onOpenDate)
                state.loading -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                }
                state.error != null -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text(state.error, color = MaterialTheme.colorScheme.error)
                }
                state.results.isEmpty() -> Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    Text("无搜索结果", color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                else -> SearchResults(state.results, onOpenMessage)
            }
        }
    }
}

@Composable
private fun SearchField(value: String, onValueChanged: (String) -> Unit) {
    Box(
        Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surfaceVariant)
            .padding(horizontal = 12.dp, vertical = 10.dp),
    ) {
        BasicTextField(
            value = value,
            onValueChange = onValueChanged,
            singleLine = true,
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.secondary),
            modifier = Modifier
                .fillMaxWidth()
                .clip(RoundedCornerShape(6.dp))
                .background(MaterialTheme.colorScheme.surface)
                .padding(horizontal = 12.dp, vertical = 9.dp),
            decorationBox = { input ->
                Box(contentAlignment = Alignment.CenterStart) {
                    if (value.isBlank()) {
                        Text("搜索", color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    input()
                }
            },
        )
    }
}

@Composable
private fun DateEntry(enabled: Boolean, onClick: () -> Unit) {
    Column {
        Spacer(Modifier.height(12.dp))
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .height(56.dp)
                .background(MaterialTheme.colorScheme.surface)
                .clickable(enabled = enabled, onClick = onClick)
                .padding(horizontal = 16.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(
                "日期",
                modifier = Modifier.weight(1f),
                color = if (enabled) MaterialTheme.colorScheme.onSurface else MaterialTheme.colorScheme.onSurfaceVariant,
            )
            WeUiDisclosureIcon(contentDescription = null)
        }
        HorizontalDivider()
    }
}

@Composable
private fun SearchResults(results: List<ChatMessage>, onOpenMessage: (String) -> Unit) {
    LazyColumn(Modifier.fillMaxSize()) {
        items(results, key = ChatMessage::id) { message ->
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .clickable { onOpenMessage(message.id) }
                    .padding(horizontal = 16.dp, vertical = 12.dp),
            ) {
                Text(message.body, style = MaterialTheme.typography.bodyLarge, maxLines = 2)
                Spacer(Modifier.height(4.dp))
                Text(
                    formatSearchTime(message.createdAt),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
        }
    }
}

private fun formatSearchTime(createdAt: String): String = runCatching {
    SEARCH_TIME.format(Instant.parse(createdAt).atZone(CHINA_ZONE))
}.getOrDefault(createdAt)

private val CHINA_ZONE = ZoneId.of("Asia/Shanghai")
private val SEARCH_TIME = DateTimeFormatter.ofPattern("yyyy年M月d日 HH:mm")
