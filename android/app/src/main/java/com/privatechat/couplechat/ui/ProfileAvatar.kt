package com.privatechat.couplechat.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.unit.Dp
import coil3.compose.AsyncImage
import coil3.request.ImageRequest
import com.privatechat.couplechat.core.model.Profile

@Composable
fun ProfileAvatar(
    profile: Profile,
    size: Dp,
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val cacheKey = profileAvatarCacheKey(profile)
    val imageRequest = remember(profile.avatarUrl, cacheKey) {
        ImageRequest.Builder(context)
            .data(profile.avatarUrl)
            .memoryCacheKey(cacheKey)
            .diskCacheKey(cacheKey)
            .build()
    }
    var loadFailed by remember(cacheKey) { mutableStateOf(false) }
    val avatarDescription = "${profile.displayName}的头像"
    if (profileAvatarShowsInitial(profile.avatarUrl, loadFailed)) {
        Box(
            modifier = modifier
                .size(size)
                .clip(RoundedCornerShape(WechatUiMetrics.AvatarCornerRadius))
                .background(MaterialTheme.colorScheme.primaryContainer)
                .clearAndSetSemantics { contentDescription = avatarDescription },
            contentAlignment = Alignment.Center,
        ) {
            Text(profile.displayName.take(1))
        }
    } else {
        AsyncImage(
            model = imageRequest,
            contentDescription = avatarDescription,
            onError = { loadFailed = true },
            modifier = modifier
                .size(size)
                .clip(RoundedCornerShape(WechatUiMetrics.AvatarCornerRadius)),
        )
    }
}

internal fun profileAvatarShowsInitial(avatarUrl: String?, loadFailed: Boolean): Boolean =
    avatarUrl.isNullOrBlank() || loadFailed

internal fun profileAvatarCacheKey(profile: Profile): String =
    "${profile.accountId}:${profile.updatedAt}:${profile.avatarUrl?.substringBefore('?').orEmpty()}"
