package com.privatechat.couplechat.feature.chat.search

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.ui.WechatTopBar
import java.time.LocalDate
import java.time.YearMonth

@Composable
fun ChatDateScreen(
    dates: List<String>,
    onDateSelected: (String) -> Unit,
    onBack: () -> Unit,
) {
    val available = dates.mapNotNull { runCatching { LocalDate.parse(it) }.getOrNull() }.toSet()
    val months = available.map { YearMonth.from(it) }.distinct().sortedDescending()
    Scaffold(
        topBar = { WechatTopBar("按日期查找", onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            items(months, key = YearMonth::toString) { month ->
                CalendarMonth(month, available, onDateSelected)
            }
        }
    }
}

@Composable
private fun CalendarMonth(
    month: YearMonth,
    available: Set<LocalDate>,
    onDateSelected: (String) -> Unit,
) {
    Column(Modifier.fillMaxWidth().background(MaterialTheme.colorScheme.surface)) {
        Text(
            "${month.year}年${month.monthValue}月",
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 14.dp),
            style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        HorizontalDivider()
        Row(Modifier.fillMaxWidth()) {
            listOf("日", "一", "二", "三", "四", "五", "六").forEach { label ->
                Box(Modifier.weight(1f).height(38.dp), contentAlignment = Alignment.Center) {
                    Text(label, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        val first = month.atDay(1)
        val leading = first.dayOfWeek.value % 7
        val cells = List(leading) { null } + (1..month.lengthOfMonth()).map(month::atDay)
        cells.chunked(7).forEach { week ->
            Row(Modifier.fillMaxWidth()) {
                repeat(7) { index ->
                    val date = week.getOrNull(index)
                    val enabled = date != null && date in available
                    Box(
                        modifier = Modifier
                            .weight(1f)
                            .height(52.dp)
                            .clickable(enabled = enabled) { onDateSelected(requireNotNull(date).toString()) },
                        contentAlignment = Alignment.Center,
                    ) {
                        date?.let {
                            Text(
                                it.dayOfMonth.toString(),
                                color = if (enabled) MaterialTheme.colorScheme.secondary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.35f),
                            )
                        }
                    }
                }
            }
        }
    }
}
