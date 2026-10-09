package com.privatechat.couplechat

import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.ViewModelStoreOwner
import com.privatechat.couplechat.core.model.Session

internal data class SessionIdentityKey(
    val accountId: String,
    val sessionVersion: Int,
    val token: String,
)

internal fun Session.identityKey() = SessionIdentityKey(accountId, sessionVersion, token)

internal class SignedInSessionViewModelHolder : ViewModel() {
    private var current: OwnedSession? = null

    fun ownerFor(session: Session?): ViewModelStoreOwner? {
        val identity = session?.identityKey()
        if (identity == null) {
            clearCurrent()
            return null
        }

        current?.takeIf { it.identity == identity }?.let { return it.owner }
        clearCurrent()
        return SessionOwner().also { owner ->
            current = OwnedSession(identity, owner)
        }
    }

    override fun onCleared() {
        clearCurrent()
    }

    private fun clearCurrent() {
        current?.owner?.viewModelStore?.clear()
        current = null
    }

    private data class OwnedSession(
        val identity: SessionIdentityKey,
        val owner: SessionOwner,
    )

    private class SessionOwner : ViewModelStoreOwner {
        override val viewModelStore = ViewModelStore()
    }
}
