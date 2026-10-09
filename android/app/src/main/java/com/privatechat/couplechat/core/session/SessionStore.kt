package com.privatechat.couplechat.core.session

import android.content.Context
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.privatechat.couplechat.core.model.Session
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface SessionStore {
    suspend fun read(): Session?
    suspend fun save(session: Session)
    suspend fun clear()
}

class InMemorySessionStore(initial: Session? = null) : SessionStore {
    private var session = initial

    override suspend fun read(): Session? = session

    override suspend fun save(session: Session) {
        this.session = session
    }

    override suspend fun clear() {
        session = null
    }
}

class EncryptedSessionStore(
    context: Context,
    private val json: Json = Json { ignoreUnknownKeys = true },
) : SessionStore {
    private val preferences by lazy {
        EncryptedSharedPreferences.create(
            context,
            "private_chat_session",
            MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build(),
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
        )
    }

    override suspend fun read(): Session? = preferences.getString(KEY, null)?.let { encoded ->
        runCatching { json.decodeFromString<Session>(encoded) }.getOrNull()
    }

    override suspend fun save(session: Session) {
        preferences.edit().putString(KEY, json.encodeToString(session)).apply()
    }

    override suspend fun clear() {
        preferences.edit().remove(KEY).apply()
    }

    private companion object {
        const val KEY = "active_session"
    }
}
