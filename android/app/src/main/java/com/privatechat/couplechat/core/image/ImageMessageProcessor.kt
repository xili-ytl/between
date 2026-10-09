package com.privatechat.couplechat.core.image

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import kotlin.math.max
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class ProcessedImage(
    val mimeType: String,
    val bytes: ByteArray,
    val width: Int,
    val height: Int,
)

class ImageMessageProcessor(private val context: Context) {
    suspend fun process(uri: Uri): ProcessedImage = withContext(Dispatchers.IO) {
        val source = decode(uri) ?: error("无法读取所选图片")
        val width = source.width
        val height = source.height
        val scaled = if (width <= MAX_EDGE && height <= MAX_EDGE) {
            source
        } else {
            val scale = MAX_EDGE.toDouble() / max(width, height)
            Bitmap.createScaledBitmap(source, (width * scale).roundToInt(), (height * scale).roundToInt(), true)
        }
        val bytes = compress(scaled)
        val result = ProcessedImage("image/jpeg", bytes, scaled.width, scaled.height)
        if (scaled !== source) scaled.recycle()
        source.recycle()
        result
    }

    private fun decode(uri: Uri): Bitmap? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val sourceWidth = info.size.width
            val sourceHeight = info.size.height
            require(sourceWidth in 1..MAX_SOURCE_EDGE && sourceHeight in 1..MAX_SOURCE_EDGE) { "图片尺寸过大" }
            val scale = minOf(1.0, MAX_DECODE_EDGE.toDouble() / maxOf(sourceWidth, sourceHeight))
            decoder.setTargetSize(
                (sourceWidth * scale).roundToInt().coerceAtLeast(1),
                (sourceHeight * scale).roundToInt().coerceAtLeast(1),
            )
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        decodeLegacy(uri)
    }

    private fun decodeLegacy(uri: Uri): Bitmap? {
        val orientation = context.contentResolver.openInputStream(uri)?.use { input ->
            ExifInterface(input).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)
        } ?: ExifInterface.ORIENTATION_NORMAL
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.contentResolver.openInputStream(uri)?.use { BitmapFactory.decodeStream(it, null, bounds) }
        require(bounds.outWidth in 1..MAX_SOURCE_EDGE && bounds.outHeight in 1..MAX_SOURCE_EDGE) { "图片尺寸过大" }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_DECODE_EDGE) sample *= 2
        val decoded = context.contentResolver.openInputStream(uri)?.use { input ->
            BitmapFactory.decodeStream(input, null, BitmapFactory.Options().apply { inSampleSize = sample })
        } ?: return null
        val oriented = applyOrientation(decoded, orientation)
        if (oriented !== decoded) decoded.recycle()
        return oriented
    }

    private fun applyOrientation(bitmap: Bitmap, orientation: Int): Bitmap {
        val matrix = Matrix()
        when (orientation) {
            ExifInterface.ORIENTATION_FLIP_HORIZONTAL -> matrix.setScale(-1f, 1f)
            ExifInterface.ORIENTATION_ROTATE_180 -> matrix.setRotate(180f)
            ExifInterface.ORIENTATION_FLIP_VERTICAL -> {
                matrix.setRotate(180f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_TRANSPOSE -> {
                matrix.setRotate(90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_90 -> matrix.setRotate(90f)
            ExifInterface.ORIENTATION_TRANSVERSE -> {
                matrix.setRotate(-90f)
                matrix.postScale(-1f, 1f)
            }
            ExifInterface.ORIENTATION_ROTATE_270 -> matrix.setRotate(-90f)
            else -> return bitmap
        }
        return Bitmap.createBitmap(bitmap, 0, 0, bitmap.width, bitmap.height, matrix, true)
    }

    private fun compress(bitmap: Bitmap): ByteArray {
        var quality = 80
        var result: ByteArray
        do {
            result = ByteArrayOutputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)
                output.toByteArray()
            }
            quality -= 6
        } while (result.size > MAX_BYTES && quality >= 40)
        require(result.size <= MAX_BYTES) { "图片压缩后仍然过大" }
        return result
    }

    private companion object {
        const val MAX_EDGE = 1280
        const val MAX_DECODE_EDGE = 1400
        const val MAX_SOURCE_EDGE = 20_000
        const val MAX_BYTES = 800 * 1024
    }
}
