package com.privatechat.couplechat.core.data

import android.content.Context
import com.privatechat.couplechat.BuildConfig

/**
 * 记录已同步到的 App 版本。App 升级后本地缓存可能携带旧结构/旧字段，
 * 此时应清空本地消息缓存、从云端重新同步，保证云端数据覆盖本地。
 */
interface CacheVersionStore {
    fun shouldClearCache(): Boolean
    fun markCacheSynced()
}

class SharedPrefsCacheVersionStore(context: Context) : CacheVersionStore {
    private val prefs = context.getSharedPreferences("cache-version", Context.MODE_PRIVATE)

    override fun shouldClearCache(): Boolean = prefs.getInt("synced_version", 0) < BuildConfig.VERSION_CODE

    override fun markCacheSynced() {
        prefs.edit().putInt("synced_version", BuildConfig.VERSION_CODE).apply()
    }
}

object NoOpCacheVersionStore : CacheVersionStore {
    override fun shouldClearCache(): Boolean = false
    override fun markCacheSynced() = Unit
}
