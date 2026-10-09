package com.privatechat.couplechat.core.push

import android.content.Context
import android.content.SharedPreferences

interface PushTokenStore {
    fun read(): String?
    fun save(registrationId: String)
    fun clear()
}

class SharedPreferencesPushTokenStore internal constructor(
    private val preferences: SharedPreferences,
) : PushTokenStore {
    constructor(context: Context) : this(
        context.applicationContext.getSharedPreferences(PREFERENCES_NAME, Context.MODE_PRIVATE),
    )

    override fun read(): String? =
        preferences.getString(REGISTRATION_ID_KEY, null)?.trim()?.takeIf(String::isNotEmpty)

    override fun save(registrationId: String) {
        val normalized = registrationId.trim().takeIf(String::isNotEmpty) ?: return
        preferences.edit().putString(REGISTRATION_ID_KEY, normalized).apply()
    }

    override fun clear() {
        preferences.edit().remove(REGISTRATION_ID_KEY).apply()
    }
}

internal const val PREFERENCES_NAME = "between_push"
private const val REGISTRATION_ID_KEY = "registration_id"
