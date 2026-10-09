package com.privatechat.couplechat.feature.moments

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.privatechat.couplechat.core.model.MomentVisibility
import com.privatechat.couplechat.ui.betweenOutlinedTextFieldColors
import com.privatechat.couplechat.ui.betweenTextButtonColors
import com.privatechat.couplechat.ui.WechatTopBar

@Composable
fun MomentComposerScreen(
    state: MomentsState,
    onCancel: () -> Unit,
    onDraftChanged: (String) -> Unit,
    onVisibilityChanged: (MomentVisibility) -> Unit,
    onImageSelected: (Uri) -> Unit,
    onClearImage: () -> Unit,
    onPublish: () -> String?,
    onPublishCompletionConsumed: (String) -> Unit,
    onPublished: () -> Unit,
) {
    var expectedPublishId by rememberSaveable { mutableStateOf<String?>(null) }
    val publishing = "publish" in state.busyKeys
    val imagePicker = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia(),
    ) { uri -> uri?.let(onImageSelected) }

    LaunchedEffect(state.publishCompletionId, expectedPublishId) {
        val completionId = state.publishCompletionId
        if (completionId != null && completionId == expectedPublishId) {
            expectedPublishId = null
            onPublishCompletionConsumed(completionId)
            onPublished()
        }
    }

    Scaffold(
        topBar = {
            WechatTopBar(
                title = "发表动态",
                navigationContent = {
                    TextButton(onClick = onCancel, colors = betweenTextButtonColors()) {
                        Text("取消")
                    }
                },
                actions = {
                    TextButton(
                        onClick = {
                            onPublish()?.let { expectedPublishId = it }
                        },
                        enabled = !publishing,
                        colors = betweenTextButtonColors(),
                    ) { Text("发表") }
                },
            )
        },
    ) { padding ->
        Column(
            modifier = Modifier.fillMaxSize().padding(padding).padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedTextField(
                value = state.draft,
                onValueChange = onDraftChanged,
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .testTag("moment-body-input")
                    .semantics { contentDescription = "动态内容" },
                minLines = 8,
                colors = betweenOutlinedTextFieldColors(),
            )
            Row(verticalAlignment = Alignment.CenterVertically) {
                TextButton(
                    onClick = {
                        imagePicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
                    },
                    colors = betweenTextButtonColors(),
                    modifier = Modifier.testTag("moment-pick-image"),
                ) { Text("图片") }
                state.pendingImage?.let { pending ->
                    Spacer(Modifier.width(8.dp))
                    AsyncImage(
                        model = pending.uri,
                        contentDescription = "待发表图片",
                        contentScale = ContentScale.Crop,
                        modifier = Modifier
                            .size(64.dp)
                            .clip(RoundedCornerShape(4.dp)),
                    )
                    TextButton(onClick = onClearImage, colors = betweenTextButtonColors()) { Text("×") }
                }
            }
            VisibilityChoice(
                label = "对方可见",
                selected = state.visibility == MomentVisibility.PARTNER,
                onClick = { onVisibilityChanged(MomentVisibility.PARTNER) },
            )
            VisibilityChoice(
                label = "仅自己可见",
                selected = state.visibility == MomentVisibility.SELF,
                onClick = { onVisibilityChanged(MomentVisibility.SELF) },
            )
            state.error?.let {
                Text(it, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun VisibilityChoice(
    label: String,
    selected: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier = Modifier.fillMaxWidth().selectable(
            selected = selected,
            onClick = onClick,
            role = Role.RadioButton,
        ),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        RadioButton(selected = selected, onClick = null)
        Text(label, color = MaterialTheme.colorScheme.onSurface)
    }
}
