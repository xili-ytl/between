package com.privatechat.couplechat.core.data

import android.content.Context
import com.privatechat.couplechat.core.model.Profile
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json

interface ProfileCacheStore {
    fun read(accountId: String): List<Profile>?
    fun write(accountId: String, profiles: List<Profile>)
    fun clear(accountId: String)
}

object NoOpProfileCacheStore : ProfileCacheStore {
    override fun read(accountId: String): List<Profile>? = null
    override fun write(accountId: String, profiles: List<Profile>) = Unit
    override fun clear(accountId: String) = Unit
}

class SharedPreferencesProfileCacheStore(context: Context) : ProfileCacheStore {
    private val prefs = context.getSharedPreferences("profile_cache", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    override fun read(accountId: String): List<Profile>? {
        val encoded = prefs.getString(key(accountId), null) ?: return null
        return runCatching { json.decodeFromString<List<Profile>>(encoded) }.getOrNull()
    }

    override fun write(accountId: String, profiles: List<Profile>) {
        prefs.edit().putString(key(accountId), json.encodeToString(profiles)).apply()
    }

    override fun clear(accountId: String) {
        prefs.edit().remove(key(accountId)).apply()
    }

    private fun key(accountId: String) = "profiles_$accountId"
}
