package com.privatechat.couplechat.core.database

import androidx.room.Entity

@Entity(tableName = "contact_remarks", primaryKeys = ["ownerId", "targetId"])
data class RemarkEntity(
    val ownerId: String,
    val targetId: String,
    val remark: String,
    val updatedAt: String,
)
