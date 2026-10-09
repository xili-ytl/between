package com.privatechat.couplechat

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import java.io.File
import org.junit.Test

class LauncherTest {
    @Test
    fun appPackageIsStable() {
        assertEquals("com.privatechat.couplechat", BuildConfig.APPLICATION_ID)
    }

    @Test
    fun releaseVersionMatchesThePublishedUpdate() {
        assertEquals(70, BuildConfig.VERSION_CODE)
        assertEquals("1.1.37", BuildConfig.VERSION_NAME)
    }

    @Test
    fun launcherActivityExists() {
        assertNotNull(Class.forName("com.privatechat.couplechat.MainActivity"))
    }

    @Test
    fun jpushReceiverUsesTheOfficialFivePointFourCallbackEntry() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val receiver = manifest.substringAfter("JPushReceiver")
        assertTrue(
            "JPush 5.4.0+ 的 JPushMessageReceiver 必须注册官方 RECEIVER_MESSAGE 入口",
            receiver.contains("cn.jpush.android.intent.RECEIVER_MESSAGE"),
        )
    }

    @Test
    fun jpushCoreServiceIsRegisteredInThePushProcess() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        assertTrue(manifest.contains(".core.push.JPushService"))
        assertTrue(manifest.contains("cn.jiguang.user.service.action"))
        assertTrue(manifest.contains("android:process=\":pushcore\""))
        assertNotNull(Class.forName("com.privatechat.couplechat.core.push.JPushService"))
    }

    @Test
    fun jpushInitializationIsNotSuppressedInTheSdkProcess() {
        val application = File("src/main/java/com/privatechat/couplechat/CoupleChatApplication.kt").readText()
        val provider = File("src/main/java/com/privatechat/couplechat/core/push/JPushProvider.kt").readText()
        assertFalse(application.contains("isMainProcess()"))
        assertTrue(application.contains("pushProvider.initialize()"))
        assertTrue(provider.contains("JPushInterface.init(context)"))
    }

    @Test
    fun pushRuntimeUsesCurrentSupportedDependencies() {
        val catalog = File("../gradle/libs.versions.toml").readText()

        assertTrue(catalog.contains("jpush = \"6.2.0\""))
        assertTrue(catalog.contains("work = \"2.11.2\""))
        assertTrue(catalog.contains("androidx-work-runtime-ktx"))
        assertTrue(catalog.contains("androidx-work-testing"))
    }

    @Test
    fun explicitLongConnectionKeepAliveIsNotEnabled() {
        val provider = File("src/main/java/com/privatechat/couplechat/core/push/JPushProvider.kt").readText()

        assertFalse(provider.contains("setKeepLongConnInBackground"))
        assertTrue(provider.contains("JPushInterface.init(context)"))
    }

    @Test
    fun navigationDoesNotOwnPushRegistrationOrSdkRetries() {
        val navigation = File("src/main/java/com/privatechat/couplechat/AppNavHost.kt").readText()

        assertFalse(navigation.contains("JPushInterface"))
        assertFalse(navigation.contains("PushRegistrar"))
        assertFalse(navigation.contains("retryPushRegistration"))
        assertFalse(navigation.contains("startAliasBindLoop"))
    }

    @Test
    fun imageCacheUsesStableKeyToAvoidDuplicateCaching() {
        val application = File("src/main/java/com/privatechat/couplechat/CoupleChatApplication.kt").readText()
        val keyer = File("src/main/java/com/privatechat/couplechat/core/image/StableImageCacheKey.kt").readText()
        assertTrue(application.contains("SingletonImageLoader.setSafe"))
        assertTrue(application.contains("uriImageKeyer"))
        assertTrue(keyer.contains("substringBefore('?')"))
        // 缓存键作用于 String 映射后的 Uri（Coil 默认 UriKeyer 的类型），而非 String/HttpUrl。
        assertTrue(keyer.contains("Keyer<Uri>"))
        // Coil 磁盘缓存设小上限：图片持久层在 ImageLocalCache（filesDir/images），
        // Coil 只留少量冗余加速，避免双份存储膨胀。
        assertTrue(application.contains("maxSizeBytes(DISK_CACHE_MAX_BYTES)"))
    }

    @Test
    fun applicationOwnsTheOnlyAppContainerAcrossActivityRecreation() {
        assertNotNull(Class.forName("com.privatechat.couplechat.CoupleChatApplication"))
        val activity = File("src/main/java/com/privatechat/couplechat/MainActivity.kt").readText()
        val application = File("src/main/java/com/privatechat/couplechat/CoupleChatApplication.kt").readText()
        val manifest = File("src/main/AndroidManifest.xml").readText()

        assertTrue(application.contains("val container by lazy"))
        assertTrue(activity.contains("(application as CoupleChatApplication).container"))
        assertFalse(activity.contains("AppContainer(applicationContext)"))
        assertTrue(manifest.contains("android:name=\".CoupleChatApplication\""))
    }

    @Test
    fun selfBuiltForegroundConnectionServiceIsRemovedAndLegacyNotificationIsCleaned() {
        val manifest = File("src/main/AndroidManifest.xml").readText()
        val application = File("src/main/java/com/privatechat/couplechat/CoupleChatApplication.kt").readText()
        assertFalse(manifest.contains(".core.push.MessageConnectionService"))
        assertFalse(manifest.contains("android.permission.FOREGROUND_SERVICE"))
        assertFalse(manifest.contains("android.permission.FOREGROUND_SERVICE_REMOTE_MESSAGING"))
        assertFalse(File("src/main/java/com/privatechat/couplechat/core/push/MessageConnectionService.kt").exists())
        assertTrue(application.contains("LegacyPushNotificationCleanup.cancel(applicationContext)"))
        assertTrue(application.contains("pushProvider.initialize()"))
    }

    @Test
    fun foregroundNotificationGateUsesDurableChatVisibilityAndNormalLifecycle() {
        val state = File("src/main/java/com/privatechat/couplechat/core/push/ChatNotificationState.kt").readText()
        val navigation = File("src/main/java/com/privatechat/couplechat/AppNavHost.kt").readText()
       assertTrue(state.contains("FileChatVisibilityMarker"))
       assertTrue(state.contains("IMPORTANCE_FOREGROUND"))
       assertTrue(state.contains("notificationIo"))
       assertTrue(state.contains("Dispatchers.IO"))
        assertFalse(state.contains("AtomicBoolean("))
       assertTrue(navigation.contains("ChatNotificationVisibility"))
        assertTrue(navigation.contains("Lifecycle.State.RESUMED"))
    }

    @Test
    fun chatNotificationsAreDeduplicatedCancelledWhenReadAndOpenTheChatRoute() {
        val receiver = File("src/main/java/com/privatechat/couplechat/core/push/JPushReceiver.kt").readText()
        assertTrue(receiver.contains("shouldShowChatNotification"))
        assertTrue(receiver.contains("message.notificationId"))
        assertTrue(receiver.contains("chatNotificationMetadata"))
        assertTrue(receiver.contains("message_created_at"))
        assertTrue(receiver.contains("recipient_id"))
        assertTrue(receiver.contains("MainActivity.EXTRA_OPEN_CHAT"))
        assertTrue(receiver.contains("onNotifyMessageDismiss"))
        assertTrue(receiver.contains("onNotifyMessageOpened"))
    }

    @Test
    fun jpushNotificationCleanupKeepsOnlyTheOldConnectionId() {
        val cleanup = File("src/main/java/com/privatechat/couplechat/core/push/LegacyPushNotificationCleanup.kt").readText()
        assertTrue(cleanup.contains("LEGACY_CHANNEL_ID"))
        assertTrue(cleanup.contains("LEGACY_NOTIFICATION_ID"))
        assertTrue(cleanup.contains("cancel(LEGACY_NOTIFICATION_ID)"))
    }
}
