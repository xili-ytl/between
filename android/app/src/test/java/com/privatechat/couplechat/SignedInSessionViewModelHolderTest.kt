package com.privatechat.couplechat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import com.privatechat.couplechat.core.model.Session
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertTrue
import org.junit.Test

class SignedInSessionViewModelHolderTest {
    @Test
    fun sameCompleteSessionIdentityReusesOwnerAndStoredViewModel() {
        val holder = SignedInSessionViewModelHolder()
        val firstSession = session()
        val firstOwner = requireNotNull(holder.ownerFor(firstSession))
        val stored = probe(firstOwner)

        val recreatedOwner = requireNotNull(
            holder.ownerFor(firstSession.copy(displayName = "后来的名字")),
        )

        assertSame(firstOwner, recreatedOwner)
        assertSame(stored, probe(recreatedOwner))
        assertFalse(stored.cleared)
    }

    @Test
    fun anyCompleteIdentityChangeReplacesAndClearsThePreviousOwner() {
        val variants = listOf(
            session().copy(accountId = "1002"),
            session().copy(sessionVersion = 2),
            session().copy(token = "other-token"),
        )

        variants.forEach { replacement ->
            val holder = SignedInSessionViewModelHolder()
            val firstOwner = requireNotNull(holder.ownerFor(session()))
            val stored = probe(firstOwner)

            val replacementOwner = requireNotNull(holder.ownerFor(replacement))

            assertNotSame(firstOwner, replacementOwner)
            assertTrue(stored.cleared)
        }
    }

    @Test
    fun nullSessionClearsTheCurrentOwner() {
        val holder = SignedInSessionViewModelHolder()
        val stored = probe(requireNotNull(holder.ownerFor(session())))

        assertNull(holder.ownerFor(null))

        assertTrue(stored.cleared)
    }

    @Test
    fun activityViewModelStoreFinalClearClearsTheSessionOwner() {
        val activityOwner = TestOwner()
        val holder = ViewModelProvider(activityOwner, holderFactory)
            .get(SignedInSessionViewModelHolder::class.java)
        val stored = probe(requireNotNull(holder.ownerFor(session())))

        activityOwner.viewModelStore.clear()

        assertTrue(stored.cleared)
    }

    private fun session() = Session("1001", "示例乙", "session-token", 1)

    private fun probe(owner: ViewModelStoreOwner): ClearProbe =
        ViewModelProvider(owner, probeFactory).get("screen", ClearProbe::class.java)

    private class TestOwner : ViewModelStoreOwner {
        override val viewModelStore = ViewModelStore()
    }

    private class ClearProbe : ViewModel() {
        var cleared = false

        override fun onCleared() {
            cleared = true
        }
    }

    private companion object {
        val holderFactory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T =
                SignedInSessionViewModelHolder() as T
        }

        val probeFactory = object : ViewModelProvider.Factory {
            @Suppress("UNCHECKED_CAST")
            override fun <T : ViewModel> create(modelClass: Class<T>): T = ClearProbe() as T
        }
    }
}
