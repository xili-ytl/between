package com.privatechat.couplechat

import android.app.Application
import coil3.ImageLoader
import coil3.SingletonImageLoader
import coil3.disk.DiskCache
import com.privatechat.couplechat.core.image.uriImageKeyer
import com.privatechat.couplechat.core.push.JPushProvider
import com.privatechat.couplechat.core.push.LegacyPushNotificationCleanup
import okio.Path.Companion.toOkioPath

class CoupleChatApplication : Application() {
    val pushProvider by lazy { JPushProvider(applicationContext) }
    val container by lazy { AppContainer(applicationContext, pushProvider) }

    override fun onCreate() {
        super.onCreate()
        LegacyPushNotificationCleanup.cancel(applicationContext)
        pushProvider.initialize()
        configureStableImageCache()
    }

    /**
     * 让 Coil 按稳定缓存键缓存图片：云端临时签名 URL 每次不同，默认按完整 URL 缓存会让
     * 每次查看同一图片都重新下载并新增缓存项（重复缓存膨胀）。改为按去掉签名后的稳定路径缓存。
     *
     * 聊天/朋友圈图片现在走 [com.privatechat.couplechat.core.image.ImageLocalCache]
     * （filesDir/images，持久、不依赖 URL），Coil 磁盘缓存只是冗余加速层，因此设一个
     * 小上限（30MB）限制双份存储；即使 Coil 淘汰也无关紧要——持久副本在文件缓存里。
     */
    private fun configureStableImageCache() {
        try {
            SingletonImageLoader.setSafe { context ->
                ImageLoader.Builder(context)
                    .components {
                        add(uriImageKeyer)
                    }
                    .diskCache {
                        DiskCache.Builder()
                            .directory(context.cacheDir.resolve("image_cache").toOkioPath())
                            .maxSizeBytes(DISK_CACHE_MAX_BYTES)
                            .build()
                    }
                    .build()
            }
        } catch (_: Throwable) {
            // 单例已被占用时回退默认加载器，不阻断启动。
        }
    }

    private companion object {
        // Coil 磁盘缓存上限：文件缓存是持久层，这里只留少量冗余加速。
        const val DISK_CACHE_MAX_BYTES = 30L * 1024 * 1024
    }
}
