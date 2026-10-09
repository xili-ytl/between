package com.privatechat.couplechat.ui

import androidx.annotation.DrawableRes
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalContentColor
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.res.painterResource
import com.privatechat.couplechat.R

enum class AppIconSymbol {
    CHAT,
    CONTACTS,
    DISCOVER,
    ME,
    MANAGE_ACCOUNT,
    SETTINGS,
}

@Composable
fun AppIcon(
    symbol: AppIconSymbol,
    contentDescription: String?,
    modifier: Modifier = Modifier,
    tint: Color = LocalContentColor.current,
) {
    Icon(
        painter = painterResource(symbol.resourceId()),
        contentDescription = contentDescription,
        modifier = modifier,
        tint = tint,
    )
}

@DrawableRes
private fun AppIconSymbol.resourceId(): Int = when (this) {
    AppIconSymbol.CHAT -> R.drawable.phosphor_ic_chats_circle
    AppIconSymbol.CONTACTS -> R.drawable.phosphor_ic_users
    AppIconSymbol.DISCOVER -> R.drawable.phosphor_ic_compass
    AppIconSymbol.ME -> R.drawable.phosphor_ic_user
    AppIconSymbol.MANAGE_ACCOUNT -> R.drawable.phosphor_ic_user_gear
    AppIconSymbol.SETTINGS -> R.drawable.phosphor_ic_gear_six
}
