package com.privatechat.couplechat.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ListItem
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.feature.me.MeScreen
import com.privatechat.couplechat.ui.AppIcon
import com.privatechat.couplechat.ui.AppIconSymbol
import com.privatechat.couplechat.ui.WechatUiMetrics
import com.privatechat.couplechat.ui.WechatBottomBar
import com.privatechat.couplechat.ui.WechatStatusBarSpacer

private val UnreadDotColor = Color(0xFFFA5151)

@Composable
fun HomeScreen(
    ownProfile: Profile,
    partnerProfile: Profile,
    messages: List<ChatMessage>,
    unreadCount: Int,
    hasUnseenMoments: Boolean,
    onOpenChat: () -> Unit,
    onOpenMoments: () -> Unit,
    onOpenProfile: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    var selectedTab by rememberSaveable { mutableStateOf(HomeTab.MESSAGES) }
    val pageState = rememberSaveableStateHolder()

    Scaffold(
        contentWindowInsets = WindowInsets(0, 0, 0, 0),
        bottomBar = {
            WechatBottomBar {
                HomeTab.entries.forEach { tab ->
                    NavigationBarItem(
                        selected = selectedTab == tab,
                        onClick = { selectedTab = tab },
                        icon = {
                            AppIcon(
                                tab.icon(),
                                contentDescription = null,
                                modifier = Modifier.size(WechatUiMetrics.BottomIconSize),
                            )
                        },
                        label = { Text(tab.label, fontSize = 12.sp) },
                        colors = NavigationBarItemDefaults.colors(
                            selectedIconColor = MaterialTheme.colorScheme.secondary,
                            selectedTextColor = MaterialTheme.colorScheme.secondary,
                            unselectedIconColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            unselectedTextColor = MaterialTheme.colorScheme.onSurfaceVariant,
                            indicatorColor = Color.Transparent,
                        ),
                    )
                }
            }
        },
    ) { padding ->
        pageState.SaveableStateProvider(selectedTab.name) {
            val pageModifier = Modifier.fillMaxSize().padding(padding)
            when (selectedTab) {
                HomeTab.MESSAGES -> MessagesTab(
                    partner = partnerProfile,
                    messages = messages,
                    unreadCount = unreadCount,
                    onOpenChat = onOpenChat,
                    modifier = pageModifier,
                )
                HomeTab.DISCOVER -> DiscoverScreen(hasUnseenMoments, onOpenMoments, pageModifier)
                HomeTab.ME -> MeScreen(ownProfile, onOpenProfile, onOpenSettings, pageModifier)
            }
        }
    }
}

@Composable
private fun DiscoverScreen(hasUnseen: Boolean, onOpenMoments: () -> Unit, modifier: Modifier) {
    Column(modifier.fillMaxSize()) {
        WechatStatusBarSpacer()
        ListItem(
            headlineContent = { Text("朋友圈") },
            trailingContent = {
                if (hasUnseen) {
                    Box(
                        modifier = Modifier
                            .size(10.dp)
                            .clip(CircleShape)
                            .background(UnreadDotColor)
                            .testTag("discover-unseen-dot"),
                    )
                }
            },
            modifier = Modifier
                .fillMaxWidth()
                .height(WechatUiMetrics.SettingRowHeight)
                .clickable(onClick = onOpenMoments),
        )
        HorizontalDivider()
    }
}

private fun HomeTab.icon(): AppIconSymbol = when (this) {
    HomeTab.MESSAGES -> AppIconSymbol.CHAT
    HomeTab.DISCOVER -> AppIconSymbol.DISCOVER
    HomeTab.ME -> AppIconSymbol.ME
}
