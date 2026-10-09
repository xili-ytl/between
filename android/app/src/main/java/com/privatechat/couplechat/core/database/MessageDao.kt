package com.privatechat.couplechat.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import androidx.room.Transaction
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

@Dao
interface MessageDao {
    @Insert(onConflict = OnConflictStrategy.IGNORE)
    suspend fun insertMessageRows(messages: List<MessageEntity>): List<Long>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun insertSearchRows(messages: List<MessageFtsEntity>)

    @Query("DELETE FROM messages")
    suspend fun deleteAllMessages()

    @Query("DELETE FROM message_fts")
    suspend fun deleteAllFts()

    @Transaction
    suspend fun clearAll() {
        deleteAllMessages()
        deleteAllFts()
    }

    @Query("SELECT rowid FROM messages WHERE id = :messageId")
    suspend fun rowIdFor(messageId: String): Long

    @Query("SELECT rowid FROM messages WHERE id = :messageId")
    suspend fun rowIdOrNull(messageId: String): Long?

    @Query("DELETE FROM message_fts WHERE rowid = :rowId")
    suspend fun deleteFtsByRowId(rowId: Long)

    @Query("DELETE FROM messages WHERE id = :messageId")
    suspend fun deleteMessageRowById(messageId: String): Int

    @Transaction
    suspend fun deleteMessage(messageId: String): Boolean {
        val rowId = rowIdOrNull(messageId) ?: return false
        deleteFtsByRowId(rowId)
        return deleteMessageRowById(messageId) > 0
    }

    @Transaction
    suspend fun insertAll(messages: List<MessageEntity>): List<Long> {
        val results = insertMessageRows(messages)
        val inserted = messages.zip(results).filter { (_, result) -> result != -1L }
        if (inserted.isNotEmpty()) {
            insertSearchRows(inserted.map { (message, _) ->
                MessageFtsEntity(rowIdFor(message.id), message.id, message.body)
            })
        }
        return results
    }

    @Query("SELECT * FROM (SELECT * FROM messages ORDER BY createdAt DESC, id DESC LIMIT :limit) ORDER BY createdAt ASC, id ASC")
    fun observeLatest(limit: Int): Flow<List<MessageEntity>>

    @Query("SELECT * FROM messages ORDER BY createdAt DESC, id DESC LIMIT 1")
    suspend fun newest(): MessageEntity?

    @Query("SELECT * FROM messages ORDER BY createdAt ASC, id ASC LIMIT 1")
    suspend fun oldest(): MessageEntity?

    @Query("SELECT COUNT(*) FROM messages")
    suspend fun count(): Int

    @Query(
        "SELECT messages.* FROM messages " +
            "INNER JOIN message_fts ON messages.rowid = message_fts.rowid " +
            "WHERE message_fts MATCH :fts " +
            "ORDER BY messages.createdAt DESC, messages.id DESC",
    )
    suspend fun searchFts(fts: String): List<MessageEntity>

    @Query(
        "SELECT * FROM messages WHERE body LIKE :like ESCAPE '\\' " +
            "ORDER BY createdAt DESC, id DESC",
    )
    suspend fun searchLike(like: String): List<MessageEntity>

    @Query("SELECT DISTINCT localDate FROM messages WHERE localDate != '' ORDER BY localDate ASC")
    suspend fun messageDates(): List<String>

    @Query(
        "SELECT * FROM messages WHERE localDate = :localDate " +
            "ORDER BY createdAt ASC, id ASC LIMIT 1",
    )
    suspend fun firstMessageOn(localDate: String): MessageEntity?

    @Query(
        "SELECT COUNT(*) FROM messages WHERE " +
            "createdAt > (SELECT createdAt FROM messages WHERE id = :messageId) OR " +
            "(createdAt = (SELECT createdAt FROM messages WHERE id = :messageId) AND id >= :messageId)",
    )
    suspend fun visibleCountThrough(messageId: String): Int

    @Query(
        "SELECT COUNT(*) FROM messages WHERE relationshipId = 'couple' AND " +
            "senderId IN (:senderId, 'wenli') AND " +
            "(createdAt > :afterCreatedAt OR (createdAt = :afterCreatedAt AND id > :afterId))",
    )
    fun observeUnreadCount(senderId: String, afterCreatedAt: String, afterId: String): Flow<Int>
}

interface MessageLocalStore {
    fun observeLatest(limit: Int): Flow<List<MessageEntity>>
    suspend fun insertAll(messages: List<MessageEntity>): Int
    suspend fun deleteById(messageId: String): Boolean = false
    suspend fun newest(): MessageEntity?
    suspend fun oldest(): MessageEntity?
    suspend fun count(): Int
    suspend fun search(fts: String, like: String): List<MessageEntity> = emptyList()
    suspend fun messageDates(): List<String> = emptyList()
    suspend fun firstMessageOn(localDate: String): MessageEntity? = null
    suspend fun visibleCountThrough(messageId: String): Int = 0
    fun observeUnreadCount(senderId: String, afterCreatedAt: String, afterId: String): Flow<Int> =
        flowOf(0)
    suspend fun clearAll() = Unit
}

class RoomMessageLocalStore(private val dao: MessageDao) : MessageLocalStore {
    override fun observeLatest(limit: Int): Flow<List<MessageEntity>> = dao.observeLatest(limit)

    override suspend fun insertAll(messages: List<MessageEntity>): Int =
        if (messages.isEmpty()) 0 else dao.insertAll(messages).count { it != -1L }

    override suspend fun deleteById(messageId: String): Boolean =
        dao.deleteMessage(messageId)

    override suspend fun newest(): MessageEntity? = dao.newest()
    override suspend fun oldest(): MessageEntity? = dao.oldest()
    override suspend fun count(): Int = dao.count()
    override suspend fun search(fts: String, like: String): List<MessageEntity> {
        val ftsRows = runCatching { dao.searchFts(fts) }.getOrDefault(emptyList())
        val likeRows = dao.searchLike(like)
        return (ftsRows + likeRows)
            .distinctBy(MessageEntity::id)
            .sortedWith(compareByDescending<MessageEntity> { it.createdAt }.thenByDescending { it.id })
    }
    override suspend fun messageDates(): List<String> = dao.messageDates()
    override suspend fun firstMessageOn(localDate: String): MessageEntity? = dao.firstMessageOn(localDate)
    override suspend fun visibleCountThrough(messageId: String): Int = dao.visibleCountThrough(messageId)
    override fun observeUnreadCount(senderId: String, afterCreatedAt: String, afterId: String): Flow<Int> =
        dao.observeUnreadCount(senderId, afterCreatedAt, afterId)
    override suspend fun clearAll() = dao.clearAll()
}
