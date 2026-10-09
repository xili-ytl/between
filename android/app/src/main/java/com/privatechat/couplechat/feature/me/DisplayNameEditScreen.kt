package com.privatechat.couplechat.feature.me

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.feature.settings.SettingsState
import com.privatechat.couplechat.ui.WechatTopBar
import com.privatechat.couplechat.ui.betweenTextButtonColors

@Composable
fun DisplayNameEditScreen(
    state: SettingsState,
    onBack: () -> Unit,
    onDisplayNameChanged: (String) -> Unit,
    onSaveDisplayName: () -> Unit,
) {
    Scaffold(
        topBar = {
            WechatTopBar(
                title = "修改昵称",
                onBack = onBack,
                actions = {
                    TextButton(
                        onClick = onSaveDisplayName,
                        enabled = !state.busy && state.displayName.isNotBlank(),
                        colors = betweenTextButtonColors(),
                    ) {
                        Text("保存")
                    }
                },
            )
        },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(top = 12.dp),
        ) {
            BasicTextField(
                value = state.displayName,
                onValueChange = onDisplayNameChanged,
                modifier = Modifier
                    .fillMaxWidth()
                    .background(MaterialTheme.colorScheme.surface)
                    .padding(horizontal = 16.dp, vertical = 14.dp)
                    .semantics { contentDescription = "昵称" },
                enabled = !state.busy,
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(
                    color = MaterialTheme.colorScheme.onSurface,
                ),
                cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
            )
            state.error?.let {
                Text(
                    it,
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                )
            }
        }
    }
}
