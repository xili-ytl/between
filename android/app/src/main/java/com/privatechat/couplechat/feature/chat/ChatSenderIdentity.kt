package com.privatechat.couplechat.feature.chat

import com.privatechat.couplechat.core.model.Profile

enum class ChatSenderIdentity { SELF, PARTNER, WENLI, UNKNOWN }

fun chatSenderIdentity(senderId: String, ownId: String, partnerId: String): ChatSenderIdentity =
    when (senderId) {
        "wenli" -> ChatSenderIdentity.WENLI
        ownId -> ChatSenderIdentity.SELF
        partnerId -> ChatSenderIdentity.PARTNER
        else -> ChatSenderIdentity.UNKNOWN
    }

fun chatSenderDisplayName(senderId: String, own: Profile, partner: Profile): String =
    when (chatSenderIdentity(senderId, own.accountId, partner.accountId)) {
        ChatSenderIdentity.SELF -> own.displayName
        ChatSenderIdentity.PARTNER -> partner.displayName
        ChatSenderIdentity.WENLI -> WENLI_DISPLAY_NAME
        ChatSenderIdentity.UNKNOWN -> "未知发送者"
    }
