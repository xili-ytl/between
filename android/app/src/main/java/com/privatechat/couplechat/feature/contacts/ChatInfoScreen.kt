package com.privatechat.couplechat.feature.contacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.WeUiDisclosureIcon
import com.privatechat.couplechat.ui.WechatTopBar
import com.privatechat.couplechat.ui.WechatUiMetrics

@Composable
fun ChatInfoScreen(
    partner: Profile,
    onBack: () -> Unit,
    onOpenRemark: () -> Unit,
    onOpenSearch: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = { WechatTopBar("聊天信息", onBack) },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 24.dp),
                contentAlignment = Alignment.Center,
            ) {
                Person(partner)
            }
            Spacer(Modifier.height(8.dp))
            InfoRow("备注", onOpenRemark)
            HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
            InfoRow("查找聊天记录", onOpenSearch)
        }
    }
}

@Composable
private fun Person(profile: Profile) {
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        ProfileAvatar(profile, WechatUiMetrics.ContactAvatarSize)
        Spacer(Modifier.height(6.dp))
        Text(profile.displayName, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun InfoRow(label: String, onClick: () -> Unit) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, modifier = Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
        WeUiDisclosureIcon(contentDescription = null)
    }
}
