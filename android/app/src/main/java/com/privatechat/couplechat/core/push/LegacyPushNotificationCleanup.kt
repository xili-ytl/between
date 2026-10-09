package com.privatechat.couplechat.core.push

import android.app.NotificationManager
import android.content.Context

/** Removes the old persistent connection notification once after an app update. */
internal object LegacyPushNotificationCleanup {
    const val LEGACY_CHANNEL_ID = "message_connection"
    const val LEGACY_NOTIFICATION_ID = 1001

    fun cancel(context: Context) {
        context.applicationContext
            .getSystemService(NotificationManager::class.java)
            ?.cancel(LEGACY_NOTIFICATION_ID)
    }
}
