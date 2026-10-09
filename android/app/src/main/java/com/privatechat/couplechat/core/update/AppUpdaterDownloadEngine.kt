package com.privatechat.couplechat.core.update

import android.content.Context
import com.king.app.updater.AppUpdater
import com.king.app.updater.listener.DownloadListener
import com.privatechat.couplechat.core.model.ReleaseInfo
import java.io.File
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import kotlinx.coroutines.suspendCancellableCoroutine

class AppUpdaterDownloadEngine(context: Context) : ApkDownloadEngine {
    private val applicationContext = context.applicationContext
    private val apkDir: File? = applicationContext.getExternalFilesDir(null)?.let { File(it, "apk") }

    init {
        // 启动时清理历史下载的 APK（安装包已装好，不再需要），避免 files/apk 无限堆积占存储。
        cleanupStaleApks()
    }

    override suspend fun download(release: ReleaseInfo, onProgress: (Int) -> Unit): File =
        suspendCancellableCoroutine { continuation ->
            val updater = AppUpdater.Builder(applicationContext)
                .setUrl(release.downloadUrl)
                .setFilename("between-${release.versionCode}.apk")
                .setVersionCode(release.versionCode)
                .setShowNotification(false)
                .setInstallApk(false)
                .setRetryOnNotification(false)
                .setDownloadListener(object : DownloadListener {
                    override fun onStart(url: String) {
                        onProgress(0)
                    }

                    override fun onProgress(progress: Long, total: Long) {
                        if (total > 0L) {
                            onProgress(((progress * 100L) / total).toInt().coerceIn(0, 100))
                        }
                    }

                    override fun onSuccess(file: File) {
                        // 只保留本次下载的 APK，删除历史版本，防止存储无限膨胀。
                        cleanupStaleApks(keep = file)
                        if (continuation.isActive) continuation.resume(file)
                    }

                    override fun onError(cause: Throwable) {
                        if (continuation.isActive) continuation.resumeWithException(cause)
                    }

                    override fun onCancel() {
                        if (continuation.isActive) {
                            continuation.resumeWithException(UpdateDownloadCancelledException())
                        }
                    }
                })
                .build()

            continuation.invokeOnCancellation {
                updater.stop()
                updater.clearListener()
            }
            updater.start()
        }

    /** 删除 files/apk 下所有历史 between-*.apk，只保留 keep（下载成功时用）。 */
    private fun cleanupStaleApks(keep: File? = null) {
        val dir = apkDir ?: return
        runCatching {
            dir.listFiles()?.forEach { file ->
                if (file != keep && file.name.startsWith("between-") && file.name.endsWith(".apk")) {
                    file.delete()
                }
            }
        }
    }
}

class UpdateDownloadCancelledException : Exception("更新下载已取消")
