package com.privatechat.couplechat.core.push

import android.content.SharedPreferences
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PushTokenStoreTest {
    @Test
    fun registrationIdSurvivesAStoreRecreation() {
        val preferences = MemorySharedPreferences()
        SharedPreferencesPushTokenStore(preferences).save("registration-one")

        assertEquals("registration-one", SharedPreferencesPushTokenStore(preferences).read())
    }

    @Test
    fun blankRegistrationIdIsIgnored() {
        val store = SharedPreferencesPushTokenStore(MemorySharedPreferences())
        store.save("registration-one")

        store.save("   ")

        assertEquals("registration-one", store.read())
    }

    @Test
    fun newerRegistrationIdReplacesTheOldOne() {
        val store = SharedPreferencesPushTokenStore(MemorySharedPreferences())
        store.save("registration-one")

        store.save("registration-two")

        assertEquals("registration-two", store.read())
    }

    @Test
    fun clearRemovesTheRegistrationId() {
        val store = SharedPreferencesPushTokenStore(MemorySharedPreferences())
        store.save("registration-one")

        store.clear()

        assertNull(store.read())
    }
}

private class MemorySharedPreferences : SharedPreferences {
    private val values = mutableMapOf<String, Any?>()

    override fun getAll(): Map<String, *> = values.toMap()
    override fun getString(key: String?, default: String?): String? = values[key] as? String ?: default
    override fun getStringSet(key: String?, default: Set<String>?): Set<String>? = default
    override fun getInt(key: String?, default: Int): Int = default
    override fun getLong(key: String?, default: Long): Long = default
    override fun getFloat(key: String?, default: Float): Float = default
    override fun getBoolean(key: String?, default: Boolean): Boolean = default
    override fun contains(key: String?): Boolean = values.containsKey(key)
    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) = Unit
    override fun edit(): SharedPreferences.Editor = Editor(values)

    private class Editor(private val values: MutableMap<String, Any?>) : SharedPreferences.Editor {
        private val updates = mutableMapOf<String, Any?>()
        private val removals = mutableSetOf<String>()
        private var clear = false

        override fun putString(key: String?, value: String?): SharedPreferences.Editor = apply { updates[key.orEmpty()] = value }
        override fun putStringSet(key: String?, values: Set<String>?): SharedPreferences.Editor = this
        override fun putInt(key: String?, value: Int): SharedPreferences.Editor = this
        override fun putLong(key: String?, value: Long): SharedPreferences.Editor = this
        override fun putFloat(key: String?, value: Float): SharedPreferences.Editor = this
        override fun putBoolean(key: String?, value: Boolean): SharedPreferences.Editor = this
        override fun remove(key: String?): SharedPreferences.Editor = apply { removals += key.orEmpty() }
        override fun clear(): SharedPreferences.Editor = apply { clear = true }
        override fun commit(): Boolean {
            applyChanges()
            return true
        }
        override fun apply() = applyChanges()

        private fun applyChanges() {
            if (clear) values.clear()
            removals.forEach(values::remove)
            values.putAll(updates)
        }
    }
}
