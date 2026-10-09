@file:OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)

package com.privatechat.couplechat.ui

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextStyle

private enum class CopyLayer { CLOSED, MENU, SELECTION }

/** The displayed comment may contain attribution; the clipboard receives only its body. */
@Composable
fun CopyableText(
    text: AnnotatedString,
    copyText: String,
    style: TextStyle,
    color: Color,
    modifier: Modifier = Modifier,
    onClick: () -> Unit = {},
    onLongPress: () -> Unit = {},
) {
    var layer by remember(text, copyText) { mutableStateOf(CopyLayer.CLOSED) }
    val clipboard = LocalClipboardManager.current
    Box(
        modifier = modifier.combinedClickable(
            onClick = onClick,
            onLongClick = {
                if (copyText.isNotEmpty()) {
                    onLongPress()
                    layer = CopyLayer.MENU
                }
            },
        ),
    ) {
        Text(text = text, style = style, color = color)
        // Removing the popup also prevents its exit animation overlapping the dialog.
        if (layer == CopyLayer.MENU) {
            DropdownMenu(expanded = true, onDismissRequest = { layer = CopyLayer.CLOSED }) {
                DropdownMenuItem(text = { Text("复制") }, onClick = {
                    clipboard.setText(AnnotatedString(copyText))
                    layer = CopyLayer.CLOSED
                })
                DropdownMenuItem(text = { Text("选择文字") }, onClick = { layer = CopyLayer.SELECTION })
            }
        }
        if (layer == CopyLayer.SELECTION) {
            TextSelectionDialog(copyText, onDismiss = { layer = CopyLayer.CLOSED })
        }
    }
}
