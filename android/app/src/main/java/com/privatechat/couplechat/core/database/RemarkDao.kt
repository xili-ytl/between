package com.privatechat.couplechat.core.database

import androidx.room.Dao
import androidx.room.Insert
import androidx.room.OnConflictStrategy
import androidx.room.Query
import kotlinx.coroutines.flow.Flow

@Dao
interface RemarkDao {
    @Query("SELECT * FROM contact_remarks WHERE ownerId = :ownerId AND targetId = :targetId LIMIT 1")
    fun observe(ownerId: String, targetId: String): Flow<RemarkEntity?>

    @Insert(onConflict = OnConflictStrategy.REPLACE)
    suspend fun upsert(remark: RemarkEntity)
}

interface RemarkLocalStore {
    fun observe(ownerId: String, targetId: String): Flow<RemarkEntity?>
    suspend fun upsert(remark: RemarkEntity)
}

class RoomRemarkLocalStore(private val dao: RemarkDao) : RemarkLocalStore {
    override fun observe(ownerId: String, targetId: String): Flow<RemarkEntity?> = dao.observe(ownerId, targetId)
    override suspend fun upsert(remark: RemarkEntity) = dao.upsert(remark)
}
