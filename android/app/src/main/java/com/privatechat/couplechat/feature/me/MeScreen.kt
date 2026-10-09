package com.privatechat.couplechat.feature.me

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.ui.AppIcon
import com.privatechat.couplechat.ui.AppIconSymbol
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.WeUiDisclosureIcon
import com.privatechat.couplechat.ui.WechatUiMetrics
import com.privatechat.couplechat.ui.WechatStatusBarSpacer
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.height

@Composable
fun MeScreen(
    ownProfile: Profile,
    onOpenProfile: () -> Unit,
    onOpenSettings: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        WechatStatusBarSpacer()
        ListItem(
            headlineContent = { Text(ownProfile.displayName) },
            leadingContent = { ProfileAvatar(ownProfile, WechatUiMetrics.MeAvatarSize) },
            trailingContent = { WeUiDisclosureIcon() },
            modifier = Modifier
                .fillMaxWidth()
                .testTag("me-profile-row")
                .clickable(onClick = onOpenProfile),
        )
        HorizontalDivider()
        ListItem(
            headlineContent = { Text("设置") },
            leadingContent = { AppIcon(AppIconSymbol.SETTINGS, contentDescription = null) },
            trailingContent = { WeUiDisclosureIcon() },
            modifier = Modifier
                .fillMaxWidth()
                .height(WechatUiMetrics.SettingRowHeight)
                .clickable(onClick = onOpenSettings),
        )
        HorizontalDivider()
    }
}
