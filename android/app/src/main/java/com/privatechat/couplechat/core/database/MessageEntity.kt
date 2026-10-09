package com.privatechat.couplechat.core.database

import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey
import com.privatechat.couplechat.core.model.ChatMessage
import java.time.Instant
import java.time.ZoneId

@Entity(
    tableName = "messages",
    indices = [Index(value = ["createdAt", "id"], name = "index_messages_createdAt_id")],
)
data class MessageEntity(
    @PrimaryKey val id: String,
    val relationshipId: String,
    val senderId: String,
    val recipientId: String,
    val clientMessageId: String,
    val body: String,
    val createdAt: String,
    val replyToMessageId: String? = null,
    val type: String = "text",
    val imageFileId: String? = null,
    val imageMimeType: String? = null,
    val imageWidth: Int? = null,
    val imageHeight: Int? = null,
    val localDate: String = "",
) {
    fun toModel() = ChatMessage(
        id = id,
        relationshipId = relationshipId,
        senderId = senderId,
        recipientId = recipientId,
        clientMessageId = clientMessageId,
        body = body,
        replyToMessageId = replyToMessageId,
        type = type,
        imageFileId = imageFileId,
        imageMimeType = imageMimeType,
        imageWidth = imageWidth,
        imageHeight = imageHeight,
        createdAt = createdAt,
    )

    companion object {
        fun from(message: ChatMessage) = MessageEntity(
            id = message.id,
            relationshipId = message.relationshipId,
            senderId = message.senderId,
            recipientId = message.recipientId,
            clientMessageId = message.clientMessageId,
            body = message.body,
            createdAt = message.createdAt,
            replyToMessageId = message.replyToMessageId,
            type = message.type,
            imageFileId = message.imageFileId,
            imageMimeType = message.imageMimeType,
            imageWidth = message.imageWidth,
            imageHeight = message.imageHeight,
            localDate = localDateOf(message.createdAt),
        )

        private fun localDateOf(createdAt: String): String =
            Instant.parse(createdAt).atZone(ZoneId.of("Asia/Shanghai")).toLocalDate().toString()
    }
}
