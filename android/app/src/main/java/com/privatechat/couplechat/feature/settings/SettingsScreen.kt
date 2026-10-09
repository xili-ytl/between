package com.privatechat.couplechat.feature.settings

import android.app.Activity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.privatechat.couplechat.BuildConfig
import com.privatechat.couplechat.core.update.UpdateInstallBridge
import com.privatechat.couplechat.feature.update.UpdateInstallRequest
import com.privatechat.couplechat.feature.update.UpdatePhase
import com.privatechat.couplechat.feature.update.UpdateState
import com.privatechat.couplechat.ui.WeUiDisclosureIcon
import com.privatechat.couplechat.ui.WechatTopBar
import com.privatechat.couplechat.ui.betweenTextButtonColors

@Composable
fun SettingsScreen(
    state: SettingsState,
    onBack: () -> Unit,
    onOpenPassword: () -> Unit,
    onOpenAbout: () -> Unit,
    onLogout: () -> Unit,
    updateState: UpdateState = UpdateState(),
    updateInstaller: UpdateInstallBridge? = null,
    onCheckUpdate: () -> Unit = {},
    onStartUpdate: () -> Unit = {},
    onDismissUpdate: () -> Unit = {},
    onInstallRequestConsumed: () -> Unit = {},
) {
    val context = LocalContext.current
    var pendingPermissionRequest by remember { mutableStateOf<UpdateInstallRequest?>(null) }
    val currentInstaller by rememberUpdatedState(updateInstaller)
    val currentConsume by rememberUpdatedState(onInstallRequestConsumed)
    val permissionLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.StartActivityForResult(),
    ) { result ->
        val request = pendingPermissionRequest
        val installer = currentInstaller
        if (
            request != null &&
            installer != null &&
            (result.resultCode == Activity.RESULT_OK || installer.canRequestPackageInstalls()) &&
            installer.canRequestPackageInstalls()
        ) {
            context.startActivity(installer.installIntent(request.file))
            pendingPermissionRequest = null
            currentConsume()
        }
    }

    fun requestInstall(request: UpdateInstallRequest) {
        val installer = updateInstaller ?: return
        if (installer.canRequestPackageInstalls()) {
            context.startActivity(installer.installIntent(request.file))
            onInstallRequestConsumed()
        } else {
            pendingPermissionRequest = request
            permissionLauncher.launch(installer.unknownSourcesIntent())
        }
    }

    LaunchedEffect(updateState.installRequest?.id) {
        updateState.installRequest?.let(::requestInstall)
    }

    if (updateState.phase == UpdatePhase.AVAILABLE && updateState.release != null) {
        AlertDialog(
            onDismissRequest = onDismissUpdate,
            title = { Text("发现新版本 ${updateState.release.versionName}") },
            text = { Text(updateState.release.notes) },
            dismissButton = {
                TextButton(onClick = onDismissUpdate, colors = betweenTextButtonColors()) {
                    Text("稍后")
                }
            },
            confirmButton = {
                TextButton(onClick = onStartUpdate, colors = betweenTextButtonColors()) {
                    Text("更新")
                }
            },
        )
    }

    Scaffold(
        topBar = { WechatTopBar("设置", onBack) },
        containerColor = MaterialTheme.colorScheme.background,
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding),
        ) {
            Spacer(Modifier.height(12.dp))
            SettingRow(
                label = "修改密码",
                tag = "password-row",
                enabled = !state.busy,
                onClick = onOpenPassword,
            )
            HorizontalDivider()
            SettingRow(
                label = "检查更新",
                tag = "update-row",
                trailing = updateTrailingText(updateState),
                enabled = updateState.phase !in setOf(UpdatePhase.CHECKING, UpdatePhase.DOWNLOADING),
                onClick = {
                    when {
                        updateState.phase == UpdatePhase.READY && updateState.installRequest != null ->
                            requestInstall(updateState.installRequest)
                        updateState.phase == UpdatePhase.ERROR && updateState.release != null -> onStartUpdate()
                        updateState.phase != UpdatePhase.AVAILABLE -> onCheckUpdate()
                    }
                },
            )
            HorizontalDivider()
            SettingRow(
                label = "关于之间",
                tag = "about-row",
                trailing = "版本 ${BuildConfig.VERSION_NAME}",
                enabled = true,
                onClick = onOpenAbout,
            )
            HorizontalDivider()
            Spacer(Modifier.height(12.dp))
            androidx.compose.foundation.layout.Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp)
                    .background(MaterialTheme.colorScheme.surface)
                    .testTag("logout-row")
                    .clickable(enabled = !state.busy, onClick = onLogout),
                contentAlignment = Alignment.Center,
            ) {
                Text("退出登录", color = MaterialTheme.colorScheme.error)
            }
            HorizontalDivider()
        }
    }
}

@Composable
private fun SettingRow(
    label: String,
    tag: String,
    enabled: Boolean,
    onClick: () -> Unit,
    trailing: String? = null,
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .height(56.dp)
            .background(MaterialTheme.colorScheme.surface)
            .testTag(tag)
            .clickable(enabled = enabled, onClick = onClick)
            .padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(label, style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.weight(1f))
        trailing?.let {
            Text(
                it,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(Modifier.padding(start = 6.dp))
        }
        WeUiDisclosureIcon()
    }
}

private fun updateTrailingText(state: UpdateState): String = when (state.phase) {
    UpdatePhase.CHECKING -> "检查中…"
    UpdatePhase.CURRENT -> "已是最新版"
    UpdatePhase.AVAILABLE -> state.release?.versionName ?: BuildConfig.VERSION_NAME
    UpdatePhase.DOWNLOADING -> "${state.progress}%"
    UpdatePhase.READY -> "安装"
    UpdatePhase.ERROR -> "重试"
    UpdatePhase.IDLE -> BuildConfig.VERSION_NAME
}
