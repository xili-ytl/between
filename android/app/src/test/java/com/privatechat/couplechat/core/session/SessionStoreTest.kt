package com.privatechat.couplechat.core.session

import com.privatechat.couplechat.core.model.Session
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SessionStoreTest {
    @Test
    fun savesReadsAndClearsTheOnlySession() = runTest {
        val store = InMemorySessionStore()
        val session = Session("1001", "女", "token", 3)

        store.save(session)
        assertEquals(session, store.read())

        store.clear()
        assertNull(store.read())
    }

    @Test
    fun clearIfCurrentCannotClearAReplacementSession() = runTest {
        val manager = SessionManager(InMemorySessionStore()).also { it.load() }
        val old = Session("1001", "Her", "old-token", 1)
        val replacement = Session("1002", "Him", "new-token", 2)
        manager.set(old)
        manager.set(replacement)

        assertFalse(manager.clearIfCurrent(old.token))
        assertEquals(replacement, manager.current())

        assertTrue(manager.clearIfCurrent(replacement.token))
        assertNull(manager.current())
    }

    @Test
    fun replaceIfCurrentCannotOverwriteAReplacementSession() = runTest {
        val manager = SessionManager(InMemorySessionStore()).also { it.load() }
        val old = Session("1001", "Her", "old-token", 1)
        val replacement = Session("1002", "Him", "new-token", 2)
        val rotatedOld = old.copy(token = "rotated-old-token", sessionVersion = 3)
        manager.set(old)
        manager.set(replacement)

        assertFalse(manager.replaceIfCurrent(old.token, rotatedOld))
        assertEquals(replacement, manager.current())
    }
}
