package com.privatechat.couplechat.core.push

import android.content.Context
import android.content.Intent
import com.privatechat.couplechat.MainActivity
import org.json.JSONObject
import java.time.Instant
import cn.jpush.android.api.CustomMessage
import cn.jpush.android.api.JPushMessage
import cn.jpush.android.api.NotificationMessage
import cn.jpush.android.service.JPushMessageReceiver
import com.privatechat.couplechat.CoupleChatApplication
import com.privatechat.couplechat.core.sync.MutableMessageArrivalSignal

class JPushReceiver : JPushMessageReceiver() {
    override fun onRegister(context: Context, registrationId: String) {
        super.onRegister(context, registrationId)
        context.coordinator()?.onRegistered(registrationId)
    }

    override fun onConnected(context: Context, isConnected: Boolean) {
        super.onConnected(context, isConnected)
        context.coordinator()?.onConnected(isConnected)
    }

    override fun onAliasOperatorResult(context: Context, result: JPushMessage) {
        super.onAliasOperatorResult(context, result)
        context.coordinator()?.onAliasResult(result.sequence, result.errorCode)
    }

    /**
     * 极光自定义消息（前端可见时收到，不弹通知）。只当作“对方有新消息”的唤醒信号，
     * 不解析业务数据；真正的消息内容仍由 chat.after 同步获取。
     */
    override fun onMessage(context: Context, message: CustomMessage) {
        super.onMessage(context, message)
        context.messageArrivals()?.notifyArrival()
    }

    /** 通知类消息在前台到达时同样立即唤醒一次同步。 */
    override fun onNotifyMessageArrived(context: Context, message: NotificationMessage) {
        super.onNotifyMessageArrived(context, message)
        context.messageArrivals()?.notifyArrival()
    }

    override fun onNotifyMessageDismiss(context: Context, message: NotificationMessage) {
        super.onNotifyMessageDismiss(context, message)
        context.appForeground()?.forgetChatNotification(message.notificationId)
    }

    override fun onNotifyMessageUnShow(context: Context, message: NotificationMessage) {
        super.onNotifyMessageUnShow(context, message)
        context.appForeground()?.forgetChatNotification(message.notificationId)
    }

    override fun onNotifyMessageOpened(context: Context, message: NotificationMessage) {
        super.onNotifyMessageOpened(context, message)
        context.appForeground()?.forgetChatNotification(message.notificationId)
        context.startActivity(
            Intent(context, MainActivity::class.java).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
                putExtra(MainActivity.EXTRA_OPEN_CHAT, true)
            },
        )
    }

    /**
     * 是否显示系统通知。
     *
     * App 在前台时返回 false：人就在界面上，消息马上会同步出来，再弹一条通知是纯打扰
     * （实测用户反馈"读过了还推""正在 App 里还收到推送"）。后台保持默认 true，
     * 不会漏提醒。
     */
    override fun isNeedShowNotification(
        context: Context,
        message: NotificationMessage,
        tag: String?,
    ): Boolean {
        if (!message.isBetweenChatNotification()) return super.isNeedShowNotification(context, message, tag)
        val gate = context.appForeground()
        val metadata = message.chatNotificationMetadata()
        if (
            gate != null && !gate.shouldShowChatNotification(
                accountId = metadata.accountId,
                messageId = metadata.messageId ?: message.chatMessageId(),
                messageCreatedAt = metadata.createdAt,
                notificationId = message.notificationId,
            )
        ) return false
        return super.isNeedShowNotification(context, message, tag)
    }
}

private data class ChatNotificationMetadata(
    val accountId: String?,
    val messageId: String?,
    val createdAt: String?,
)

private fun NotificationMessage.isBetweenChatNotification(): Boolean {
    val extras = notificationExtras?.trim().orEmpty()
    if (extras.isEmpty()) return true // 兼容旧版/旧推送：当前历史通知均为聊天消息。
    val json = runCatching { JSONObject(extras) }.getOrNull()
        ?: return true // 兼容旧版可能携带的非 JSON 扩展字段。
    val type = json.optString("type").trim()
    val conversation = json.optString("conversation_id").trim()
    return (type.isEmpty() || type == "chat") && (conversation.isEmpty() || conversation == "couple")
}

private fun NotificationMessage.chatMessageId(): String? {
    val extras = notificationExtras?.trim().orEmpty()
    val messageId = runCatching { JSONObject(extras).optString("message_id") }.getOrNull()
        ?.trim()
        ?.takeIf { SAFE_MESSAGE_ID.matches(it) }
    return messageId ?: msgId?.trim()?.takeIf { SAFE_MESSAGE_ID.matches(it) }
}

/**
 * New server pushes carry a validated account and message cursor. Older pushes have no
 * cursor fields and intentionally fall back to the durable provider/app id ledger.
 */
private fun NotificationMessage.chatNotificationMetadata(): ChatNotificationMetadata {
    val extras = notificationExtras?.trim().orEmpty()
    if (extras.isEmpty()) return ChatNotificationMetadata(null, null, null)
    val json = runCatching { JSONObject(extras) }.getOrNull()
        ?: return ChatNotificationMetadata(null, null, null)
    if (json.optString("type").trim() != "chat" || json.optString("conversation_id").trim() != "couple") {
        return ChatNotificationMetadata(null, null, null)
    }
    val accountId = json.optString("recipient_id").trim().takeIf { it in CHAT_ACCOUNT_IDS }
    val messageId = json.optString("message_id").trim().takeIf { SAFE_MESSAGE_ID.matches(it) }
    val createdAt = json.optString("message_created_at").trim().takeIf {
        it.length <= 64 && runCatching { Instant.parse(it) }.isSuccess
    }
    return if (accountId != null && messageId != null && createdAt != null) {
        ChatNotificationMetadata(accountId, messageId, createdAt)
    } else {
        // A partial cursor is not comparable: use the durable legacy id ledger instead.
        ChatNotificationMetadata(null, null, null)
    }
}

private fun Context.coordinator(): PushRegistrationCoordinator? =
    (applicationContext as? CoupleChatApplication)?.container?.pushRegistration

private fun Context.messageArrivals(): MutableMessageArrivalSignal? =
    (applicationContext as? CoupleChatApplication)?.container?.messageArrivals

private fun Context.appForeground(): AppForegroundState? =
    (applicationContext as? CoupleChatApplication)?.container?.appForeground

private val CHAT_ACCOUNT_IDS = setOf("1001", "1002")
private val SAFE_MESSAGE_ID = Regex("[A-Za-z0-9_.:-]{1,200}")
