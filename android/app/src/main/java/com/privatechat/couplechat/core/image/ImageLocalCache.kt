package com.privatechat.couplechat.core.image

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request
import java.io.File
import java.io.IOException

/**
 * 按 imageFileId 把图片字节持久缓存到本地文件（`filesDir/images`）。
 *
 * 第一次查看时下载并落盘，之后重进/重启都直接读本地文件——不依赖签名 URL（会过期）、
 * 不依赖 Coil 磁盘命中。这是"看过的图片永远秒开"的正确方案。
 */
class ImageLocalCache(
    private val dir: File,
    private val client: OkHttpClient = OkHttpClient(),
) {
    fun get(fileId: String): File? = File(dir, fileName(fileId)).takeIf { it.isFile }

    /** 本地已缓存时的原始字节；未缓存返回 null（不触发下载）。 */
    fun bytes(fileId: String): ByteArray? = get(fileId)?.readBytes()

    /** 本地已有则直接返回；否则下载 URL 字节落盘后返回本地文件。 */
    suspend fun ensure(fileId: String, url: String): File = withContext(Dispatchers.IO) {
        get(fileId) ?: run {
            val request = Request.Builder().url(url).build()
            val bytes = client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) throw IOException("图片下载失败: HTTP ${response.code}")
                response.body?.bytes() ?: throw IOException("空图片响应")
            }
            dir.mkdirs()
            val target = File(dir, fileName(fileId))
            target.writeBytes(bytes)
            target
        }
    }

    private fun fileName(fileId: String): String = fileId.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".jpg"
}
