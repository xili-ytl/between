package com.privatechat.couplechat.feature.chat

internal fun chatMessageItemIndex(
    messageIndex: Int,
    showOfflineStatus: Boolean,
    showOlderControl: Boolean,
): Int = messageIndex + showOfflineStatus.toInt() + showOlderControl.toInt()

private fun Boolean.toInt(): Int = if (this) 1 else 0
