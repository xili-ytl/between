package com.privatechat.couplechat.core.avatar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.net.Uri
import android.os.Build
import android.util.Base64
import androidx.exifinterface.media.ExifInterface
import java.io.ByteArrayOutputStream
import kotlin.math.roundToInt
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

data class EncodedAvatar(
    val mimeType: String,
    val base64: String,
)

class AvatarProcessor(private val context: Context) {
    suspend fun process(uri: Uri): EncodedAvatar = withContext(Dispatchers.IO) {
        val source = decode(uri) ?: error("无法读取所选图片")
        val square = centerSquare(source)
        val scaled = if (square.width == SIZE && square.height == SIZE) square
        else Bitmap.createScaledBitmap(square, SIZE, SIZE, true)
        val bytes = compress(scaled)
        if (scaled !== square) scaled.recycle()
        if (square !== source) square.recycle()
        source.recycle()
        EncodedAvatar("image/jpeg", Base64.encodeToString(bytes, Base64.NO_WRAP))
    }

    private fun decode(uri: Uri): Bitmap? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(context.contentResolver, uri)) { decoder, info, _ ->
            val width = info.size.width
            val height = info.size.height
            require(width in 1..MAX_SOURCE_EDGE && height in 1..MAX_SOURCE_EDGE) { "图片尺寸过大" }
            val scale = minOf(1.0, MAX_DECODE_EDGE.toDouble() / maxOf(width, height))
            decoder.setTargetSize(
                (width * scale).roundToInt().coerceAtLeast(1),
                (height * scale).roundToInt().coerceAtLeast(1),
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

    private fun centerSquare(bitmap: Bitmap): Bitmap {
        val size = minOf(bitmap.width, bitmap.height)
        return Bitmap.createBitmap(bitmap, (bitmap.width - size) / 2, (bitmap.height - size) / 2, size, size)
    }

    private fun compress(bitmap: Bitmap): ByteArray {
        var quality = 92
        var result: ByteArray
        do {
            result = ByteArrayOutputStream().use { output ->
                bitmap.compress(Bitmap.CompressFormat.JPEG, quality, output)
                output.toByteArray()
            }
            quality -= 8
        } while (result.size > MAX_BYTES && quality >= 36)
        require(result.size <= MAX_BYTES) { "图片压缩后仍然过大" }
        return result
    }

    private companion object {
        const val SIZE = 512
        const val MAX_DECODE_EDGE = 2048
        const val MAX_SOURCE_EDGE = 20_000
        const val MAX_BYTES = 480 * 1024
    }
}
