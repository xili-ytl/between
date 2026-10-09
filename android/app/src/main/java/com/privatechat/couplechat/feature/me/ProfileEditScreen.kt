package com.privatechat.couplechat.feature.me

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.foundation.clickable
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.feature.settings.SettingsState
import com.privatechat.couplechat.ui.ProfileAvatar
import com.privatechat.couplechat.ui.WeUiDisclosureIcon
import com.privatechat.couplechat.ui.WechatTopBar

@Composable
fun ProfileEditScreen(
    state: SettingsState,
    onBack: () -> Unit,
    onOpenDisplayName: () -> Unit,
    onAvatarSelected: (Uri) -> Unit,
) {
    val picker = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
        uri?.let(onAvatarSelected)
    }

    Scaffold(
        topBar = { WechatTopBar("个人信息", onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(top = 12.dp),
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(88.dp)
                    .background(MaterialTheme.colorScheme.surface)
                    .testTag("profile-avatar-row")
                    .clickable(enabled = !state.busy) {
                        picker.launch(PickVisualMediaRequest(PickVisualMedia.ImageOnly))
                    }
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("头像")
                Spacer(Modifier.weight(1f))
                state.profile?.let { ProfileAvatar(it, 64.dp) }
                Spacer(Modifier.size(12.dp))
                WeUiDisclosureIcon()
            }
            HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .background(MaterialTheme.colorScheme.surface)
                    .testTag("profile-name-row")
                    .clickable(enabled = !state.busy, onClick = onOpenDisplayName)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("昵称")
                Spacer(Modifier.weight(1f))
                Text(
                    state.profile?.displayName.orEmpty(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.size(8.dp))
                WeUiDisclosureIcon()
            }
            HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 16.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text("性别")
                Spacer(Modifier.weight(1f))
                Text(
                    state.profile?.gender.orEmpty(),
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
            HorizontalDivider()
            state.error?.let {
                Text(
                    it,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 10.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
