package com.privatechat.couplechat.core.data

import android.content.Context
import com.privatechat.couplechat.core.model.MessageCursor

/**
 * 同步游标的本地持久化。
 *
 * - `cursor` 只由 `chat.after` 的响应推进，绝不使用本地乐观消息或自己发出的消息。
 *   进程重启后如果游标归零，`chat.after` 会从历史最早的一页重新开始，与「最近窗口对账」
 *   之间会留下空档；把游标落盘即可让重启后从上次位置继续。
 * - `historyComplete` 表示本机历史已经确认与云端一致。确认之后不需要再周期性全量重扫，
 *   该标记同样落盘，避免每次重启都重扫一遍全部历史。
 */
interface SyncCursorStore {
    suspend fun save(accountId: String, cursor: MessageCursor)
    suspend fun load(accountId: String): MessageCursor?
    suspend fun isHistoryComplete(accountId: String): Boolean = false
    suspend fun markHistoryComplete(accountId: String) = Unit
}

class SharedPrefsSyncCursorStore(context: Context) : SyncCursorStore {
    private val prefs = context.getSharedPreferences("sync-cursor", Context.MODE_PRIVATE)

    override suspend fun save(accountId: String, cursor: MessageCursor) {
        prefs.edit()
            .putString(key(accountId), cursor.createdAt)
            .putString(idKey(accountId), cursor.id)
            .apply()
    }

    override suspend fun load(accountId: String): MessageCursor? {
        val createdAt = prefs.getString(key(accountId), null) ?: return null
        val id = prefs.getString(idKey(accountId), null) ?: return null
        return MessageCursor(createdAt, id)
    }

    override suspend fun isHistoryComplete(accountId: String): Boolean =
        prefs.getBoolean(completeKey(accountId), false)

    override suspend fun markHistoryComplete(accountId: String) {
        prefs.edit().putBoolean(completeKey(accountId), true).apply()
    }

    private fun key(accountId: String) = "${accountId}_createdAt"

    private fun idKey(accountId: String) = "${accountId}_id"

    private fun completeKey(accountId: String) = "${accountId}_history_complete"
}

object NoOpSyncCursorStore : SyncCursorStore {
    override suspend fun save(accountId: String, cursor: MessageCursor) = Unit
    override suspend fun load(accountId: String): MessageCursor? = null
}
