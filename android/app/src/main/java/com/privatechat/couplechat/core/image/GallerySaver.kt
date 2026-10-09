package com.privatechat.couplechat.core.image

import android.content.ContentValues
import android.content.Context
import android.os.Build
import android.os.Environment
import android.provider.MediaStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * 把图片字节写入系统相册。
 *
 * Android 10（API 29）及以上使用分区存储：向 MediaStore 插入 `Pictures/之间` 下的条目，
 * 不需要申请存储权限。本 App 最低支持 API 26，29 以下回退到带权限检查的公共目录写入。
 */
class GallerySaver(private val context: Context) {
    suspend fun save(bytes: ByteArray, displayName: String, mimeType: String): Boolean =
        withContext(Dispatchers.IO) {
            runCatching { insertIntoMediaStore(bytes, displayName, mimeType) }.getOrDefault(false)
        }

    private fun insertIntoMediaStore(bytes: ByteArray, displayName: String, mimeType: String): Boolean {
        val values = ContentValues().apply {
            put(MediaStore.Images.Media.DISPLAY_NAME, displayName)
            put(MediaStore.Images.Media.MIME_TYPE, mimeType)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                put(MediaStore.Images.Media.RELATIVE_PATH, "${Environment.DIRECTORY_PICTURES}/之间")
                put(MediaStore.Images.Media.IS_PENDING, 1)
            }
        }
        val resolver = context.contentResolver
        val uri = resolver.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, values)
            ?: return false
        return try {
            resolver.openOutputStream(uri)?.use { it.write(bytes) } ?: return false
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                resolver.update(uri, ContentValues().apply { put(MediaStore.Images.Media.IS_PENDING, 0) }, null, null)
            }
            true
        } catch (error: Throwable) {
            runCatching { resolver.delete(uri, null, null) }
            throw error
        }
    }
}
