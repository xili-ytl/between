package com.privatechat.couplechat.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.WechatStatusBarSpacer
import com.privatechat.couplechat.ui.WechatUiMetrics
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter

private val UnreadBadgeColor = Color(0xFFFA5151)

@Composable
fun MessagesTab(
    partner: Profile,
    messages: List<ChatMessage>,
    unreadCount: Int,
    onOpenChat: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val latest = messages.lastOrNull()
    Column(modifier.fillMaxSize()) {
        WechatStatusBarSpacer()
        ListItem(
            headlineContent = { Text(partner.displayName) },
            supportingContent = {
                if (latest != null) {
                    Text(
                        latest.preview(),
                        maxLines = 1,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                } else {
                    Spacer(Modifier.height(20.dp))
                }
            },
            leadingContent = { ProfileAvatar(partner, WechatUiMetrics.ConversationAvatarSize) },
            trailingContent = {
                Column(
                    horizontalAlignment = Alignment.End,
                    verticalArrangement = Arrangement.Center,
                ) {
                    if (latest != null) {
                        Text(
                            remember(latest.createdAt) { conversationTime(latest.createdAt) },
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    if (unreadCount > 0) {
                        Spacer(Modifier.height(3.dp))
                        Box(
                            modifier = Modifier
                                .size(width = 20.dp, height = 20.dp)
                                .clip(CircleShape)
                                .background(UnreadBadgeColor)
                                .testTag("unread-badge"),
                            contentAlignment = Alignment.Center,
                        ) {
                            Text(
                                text = if (unreadCount > 99) "99+" else "$unreadCount",
                                color = Color.White,
                                fontSize = 11.sp,
                                lineHeight = 11.sp,
                            )
                        }
                    }
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(WechatUiMetrics.ConversationRowHeight)
                .clickable(onClick = onOpenChat),
        )
        HorizontalDivider()
    }
}

private fun ChatMessage.preview(): String =
    if (type == "image") "[图片]" else body

private val conversationTimeFormatter = DateTimeFormatter.ofPattern("HH:mm").withZone(ZoneId.systemDefault())

private fun conversationTime(value: String): String =
    runCatching { conversationTimeFormatter.format(Instant.parse(value)) }.getOrDefault(value)
