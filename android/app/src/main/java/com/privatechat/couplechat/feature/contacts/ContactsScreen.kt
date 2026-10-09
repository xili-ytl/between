package com.privatechat.couplechat.feature.contacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ListItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.feature.home.PageTitle
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.WechatUiMetrics
import androidx.compose.ui.unit.dp
import androidx.compose.foundation.layout.height

@Composable
fun ContactsScreen(
    partner: Profile,
    onOpenContact: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(modifier.fillMaxSize()) {
        PageTitle("通讯录")
        ListItem(
            headlineContent = { Text(partner.displayName) },
            leadingContent = { ProfileAvatar(partner, WechatUiMetrics.ContactAvatarSize) },
            modifier = Modifier
                .fillMaxWidth()
                .height(WechatUiMetrics.ContactRowHeight)
                .clickable(onClick = onOpenContact),
        )
        HorizontalDivider()
    }
}
