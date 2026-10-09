package com.privatechat.couplechat.feature.contacts

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.WeUiDisclosureIcon
import com.privatechat.couplechat.ui.WechatTopBar

@Composable
fun ContactDetailScreen(
    partner: Profile,
    onBack: () -> Unit,
    onOpenChat: () -> Unit,
    onOpenMoments: () -> Unit = {},
    previewImageUrls: List<String> = emptyList(),
) {
    Scaffold(
        topBar = {
            WechatTopBar("详细资料", onBack)
        },
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(Modifier.height(32.dp))
            ProfileAvatar(partner, 112.dp)
            Spacer(Modifier.height(20.dp))
            Text(partner.displayName, style = MaterialTheme.typography.headlineSmall)
            Spacer(Modifier.height(8.dp))
            Text(partner.gender, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Spacer(Modifier.height(40.dp))
            MomentsEntryRow(onOpenMoments, previewImageUrls)
            Spacer(Modifier.height(24.dp))
            Button(onClick = onOpenChat) { Text("发消息") }
        }
    }
}

@Composable
private fun MomentsEntryRow(onOpenMoments: () -> Unit, previewImageUrls: List<String>) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .clickable(onClick = onOpenMoments)
            .padding(horizontal = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("朋友圈", style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.weight(1f))
        if (previewImageUrls.isNotEmpty()) {
            previewImageUrls.take(3).forEach { url ->
                AsyncImage(
                    model = url,
                    contentDescription = null,
                    contentScale = ContentScale.Crop,
                    modifier = Modifier
                        .padding(start = 4.dp)
                        .size(40.dp)
                        .clip(RoundedCornerShape(4.dp)),
                )
            }
        }
        WeUiDisclosureIcon()
    }
}
