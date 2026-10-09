package com.privatechat.couplechat.feature.contacts

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.ui.WechatTopBar

@Composable
fun RemarkEditScreen(
    value: String,
    saving: Boolean,
    error: String?,
    onValueChanged: (String) -> Unit,
    onSave: () -> Unit,
    onBack: () -> Unit,
) {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        topBar = {
            WechatTopBar(
                title = "设置备注",
                onBack = onBack,
                actions = {
                    TextButton(onClick = onSave, enabled = !saving) {
                        Text("完成", color = Color(0xFF07C160))
                    }
                },
            )
        },
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp)) {
            Text("备注", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
            BasicTextField(
                value = value,
                onValueChange = { if (it.codePoints().count() <= 32L) onValueChanged(it) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 8.dp)
                    .background(Color.White, RoundedCornerShape(4.dp))
                    .padding(horizontal = 12.dp, vertical = 13.dp),
                singleLine = true,
                textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface),
                cursorBrush = SolidColor(Color(0xFF07C160)),
            )
            error?.let {
                Text(it, modifier = Modifier.padding(top = 8.dp), color = MaterialTheme.colorScheme.error)
            }
        }
    }
}
