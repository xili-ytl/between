package com.privatechat.couplechat.core.avatar

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.util.Base64
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.io.File
import java.io.FileOutputStream
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AvatarProcessorTest {
    @Test
    fun cropsAndCompressesGalleryImageToSafeSquareJpeg() = runTest {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val file = File(context.cacheDir, "avatar-test.jpg")
        val source = Bitmap.createBitmap(1600, 900, Bitmap.Config.ARGB_8888)
        FileOutputStream(file).use { source.compress(Bitmap.CompressFormat.JPEG, 95, it) }
        source.recycle()

        val result = AvatarProcessor(context).process(Uri.fromFile(file))
        val bytes = Base64.decode(result.base64, Base64.DEFAULT)
        val decoded = BitmapFactory.decodeByteArray(bytes, 0, bytes.size)

        assertEquals("image/jpeg", result.mimeType)
        assertTrue(bytes.size <= 480 * 1024)
        assertEquals(512, decoded.width)
        assertEquals(512, decoded.height)
        decoded.recycle()
        file.delete()
    }
}
