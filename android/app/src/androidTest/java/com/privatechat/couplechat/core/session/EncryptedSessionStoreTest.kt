package com.privatechat.couplechat.core.session

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.privatechat.couplechat.core.model.Session
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class EncryptedSessionStoreTest {
    @Test
    fun productionStoreRoundTripsAndClearsSession() = runTest {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val store = EncryptedSessionStore(context)
        store.clear()
        val session = Session("1001", "女", "opaque-token", 2)

        store.save(session)
        assertEquals(session, store.read())
        store.clear()
        assertNull(store.read())
    }
}
