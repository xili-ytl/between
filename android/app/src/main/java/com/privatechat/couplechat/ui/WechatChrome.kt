package com.privatechat.couplechat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.windowInsetsBottomHeight
import androidx.compose.foundation.layout.windowInsetsTopHeight
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

@Composable
fun WechatStatusBarSpacer(modifier: Modifier = Modifier) {
    Spacer(modifier.windowInsetsTopHeight(WindowInsets.statusBars))
}

@Composable
fun WechatTopBar(
    title: String,
    onBack: (() -> Unit)? = null,
    navigationContent: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    WechatTopBar(
        titleContent = { Text(title, style = MaterialTheme.typography.titleLarge) },
        onBack = onBack,
        navigationContent = navigationContent,
        actions = actions,
    )
}

@Composable
fun WechatTopBar(
    titleContent: @Composable () -> Unit,
    onBack: (() -> Unit)? = null,
    navigationContent: (@Composable () -> Unit)? = null,
    actions: @Composable RowScope.() -> Unit = {},
) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface),
    ) {
        WechatStatusBarSpacer()
        Box(
            modifier = Modifier
                .fillMaxWidth()
                .height(WechatUiMetrics.TopBarHeight),
        ) {
            if (navigationContent != null) {
                Box(
                    modifier = Modifier
                        .align(Alignment.CenterStart)
                        .fillMaxHeight(),
                    contentAlignment = Alignment.Center,
                ) {
                    navigationContent()
                }
            } else if (onBack != null) {
                IconButton(
                    onClick = onBack,
                    modifier = Modifier.align(Alignment.CenterStart),
                ) {
                    WeUiBackIcon(contentDescription = "返回")
                }
            }
            Box(modifier = Modifier.align(Alignment.Center)) {
                titleContent()
            }
            Row(
                modifier = Modifier
                    .align(Alignment.CenterEnd)
                    .fillMaxHeight(),
                verticalAlignment = Alignment.CenterVertically,
                content = actions,
            )
        }
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
    }
}

@Composable
fun WechatBottomBar(content: @Composable RowScope.() -> Unit) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface),
    ) {
        HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        NavigationBar(
            modifier = Modifier
                .fillMaxWidth()
                .height(WechatUiMetrics.BottomBarHeight),
            containerColor = MaterialTheme.colorScheme.surface,
            tonalElevation = 0.dp,
            windowInsets = WindowInsets(0, 0, 0, 0),
            content = content,
        )
        Spacer(Modifier.windowInsetsBottomHeight(WindowInsets.navigationBars))
    }
}
