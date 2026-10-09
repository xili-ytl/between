package com.privatechat.couplechat.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalTextToolbar
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog

/** Selection exists only for the lifetime of this dialog, never in a list item. */
@Composable
fun TextSelectionDialog(text: String, onDismiss: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        val toolbar = LocalTextToolbar.current
        val clipboard = LocalClipboardManager.current
        DisposableEffect(toolbar) {
            onDispose { toolbar.hide() }
        }
        Surface(shape = MaterialTheme.shapes.large) {
            Column(Modifier.padding(20.dp).testTag("text-selection-dialog")) {
                Text("选择文字", style = MaterialTheme.typography.titleLarge)
                Text(
                    "长按文字可选择部分内容复制",
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.padding(vertical = 12.dp),
                )
                SelectionContainer(
                    Modifier.weight(1f, fill = false).heightIn(max = 360.dp)
                        .verticalScroll(rememberScrollState()),
                ) {
                    Text(
                        text,
                        modifier = Modifier.fillMaxWidth().testTag("text-selection-content"),
                        style = MaterialTheme.typography.bodyLarge,
                    )
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = {
                        clipboard.setText(AnnotatedString(text))
                        onDismiss()
                    }) { Text("复制全文") }
                    TextButton(onClick = onDismiss) { Text("关闭") }
                }
            }
        }
    }
}
