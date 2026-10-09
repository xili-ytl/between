package com.privatechat.couplechat.feature.settings

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.ui.WechatTopBar
import com.privatechat.couplechat.ui.betweenTextButtonColors

@Composable
fun PasswordEditScreen(
    state: SettingsState,
    onBack: () -> Unit,
    onCurrentPasswordChanged: (String) -> Unit,
    onNewPasswordChanged: (String) -> Unit,
    onChangePassword: () -> Unit,
) {
    Scaffold(
        topBar = {
            WechatTopBar(
                title = "修改密码",
                onBack = onBack,
                actions = {
                    TextButton(
                        onClick = onChangePassword,
                        enabled = !state.busy &&
                            state.currentPassword.isNotEmpty() &&
                            state.newPassword.isNotEmpty(),
                        colors = betweenTextButtonColors(),
                    ) {
                        Text("完成")
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
            PasswordRow(
                label = "当前密码",
                value = state.currentPassword,
                onValueChanged = onCurrentPasswordChanged,
                enabled = !state.busy,
            )
            HorizontalDivider(modifier = Modifier.padding(start = 16.dp))
            PasswordRow(
                label = "新密码",
                value = state.newPassword,
                onValueChanged = onNewPasswordChanged,
                enabled = !state.busy,
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

@Composable
private fun PasswordRow(
    label: String,
    value: String,
    onValueChanged: (String) -> Unit,
    enabled: Boolean,
) {
    androidx.compose.foundation.layout.Row(
        modifier = Modifier
            .fillMaxWidth()
            .background(MaterialTheme.colorScheme.surface)
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        Text(label, modifier = Modifier.fillMaxWidth(0.3f))
        BasicTextField(
            value = value,
            onValueChange = onValueChanged,
            modifier = Modifier
                .weight(1f)
                .semantics { contentDescription = label },
            enabled = enabled,
            singleLine = true,
            visualTransformation = PasswordVisualTransformation(),
            textStyle = MaterialTheme.typography.bodyLarge.copy(
                color = MaterialTheme.colorScheme.onSurface,
            ),
            cursorBrush = SolidColor(MaterialTheme.colorScheme.primary),
        )
    }
}
