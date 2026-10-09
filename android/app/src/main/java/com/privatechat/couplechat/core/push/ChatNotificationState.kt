package com.privatechat.couplechat.core.push

import android.app.ActivityManager
import android.app.NotificationManager
import android.content.Context
import com.privatechat.couplechat.core.model.MessageCursor
import java.io.File
import java.io.FileOutputStream
import java.io.RandomAccessFile
import java.time.Instant
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch

/**
 * Cross-process marker for the real chat surface.
 *
 * The JPush callback can be reached while the SDK is in `:pushcore`. A process-local
 * AtomicBoolean therefore cannot describe the main activity. The marker is deliberately
 * tiny and contains only the main-process PID; the reader also verifies that PID is still
 * the foreground process, so a crashed/restarted activity cannot leave the gate open.
 */
internal interface ChatVisibilityMarker {
    fun markVisible(processId: Int)
    fun clear()
    fun activeProcessId(): Int?
}

internal class FileChatVisibilityMarker(
    private val file: File,
) : ChatVisibilityMarker {
    override fun markVisible(processId: Int) {
        if (processId <= 0) return
        writeAtomically(processId.toString())
    }

    override fun clear() {
        file.delete()
    }

    override fun activeProcessId(): Int? = runCatching {
        file.readText(Charsets.UTF_8).trim().toIntOrNull()
    }.getOrNull()

    private fun writeAtomically(value: String) {
        file.parentFile?.mkdirs()
        val temp = File(file.parentFile, "${file.name}.tmp-${Thread.currentThread().id}")
        FileOutputStream(temp).use { output ->
            output.write(value.toByteArray(Charsets.UTF_8))
            // This is an ephemeral foreground marker. Atomic rename publishes it across
            // :pushcore without making the lifecycle callback wait for durable storage.
            output.flush()
        }
        if (!temp.renameTo(file)) {
            if (file.exists()) check(file.delete()) { "Cannot replace ${file.absolutePath}" }
            check(temp.renameTo(file)) { "Cannot write ${file.absolutePath}" }
        }
    }

}

/**
 * Durable, bounded notification ledger. It remembers provider/app message ids even when
 * the notification is suppressed in the foreground, so an old retry cannot reappear after
 * the user opens the chat or clears the system shade.
 */
internal class ChatNotificationStateStore(
    private val file: File,
) {
    private val monitor = Any()
    private val lockFile = File(file.parentFile ?: file.absoluteFile.parentFile!!, "${file.name}.lock")

    fun shouldShow(messageId: String?, notificationId: Int, chatVisible: Boolean): Boolean {
        return shouldShow(
            accountId = null,
            messageId = messageId,
            messageCreatedAt = null,
            notificationId = notificationId,
            chatVisible = chatVisible,
        )
    }

    fun shouldShow(
        accountId: String?,
        messageId: String?,
        messageCreatedAt: String?,
        notificationId: Int,
        chatVisible: Boolean,
    ): Boolean {
        val normalizedId = normalizeMessageId(messageId)
        val normalizedAccountId = normalizeAccountId(accountId)
        val normalizedCreatedAt = normalizeCreatedAt(messageCreatedAt)
        return runCatching {
            withLock {
                val previous = readSnapshot()
                val duplicate = normalizedId != null && normalizedId in previous.seenMessageIds
                val alreadyRead = normalizedAccountId != null && normalizedId != null && normalizedCreatedAt != null &&
                    previous.readCursors.any { read ->
                        read.accountId == normalizedAccountId &&
                            compareCursors(
                                MessageCursor(normalizedCreatedAt, normalizedId),
                                MessageCursor(read.createdAt, read.messageId),
                            ) <= 0
                    }
                val show = !chatVisible && !duplicate && !alreadyRead
                val seen = if (normalizedId == null || duplicate) {
                    previous.seenMessageIds
                } else {
                    (previous.seenMessageIds + normalizedId).takeLast(MAX_SEEN_MESSAGE_IDS)
                }
                val displayed = if (show && notificationId > 0) {
                    (previous.displayedNotificationIds + notificationId).distinct().takeLast(MAX_DISPLAYED_IDS)
                } else {
                    previous.displayedNotificationIds
                }
                writeSnapshot(Snapshot(seen, displayed, previous.readCursors))
                show
            }
        }.getOrDefault(!chatVisible)
    }

    /** Stores only a server-confirmed, account-owned read cursor for cross-process notification gating. */
    fun recordServerConfirmedRead(accountId: String, cursor: MessageCursor): Boolean {
        val normalizedAccountId = normalizeAccountId(accountId) ?: return false
        val normalizedId = normalizeMessageId(cursor.id) ?: return false
        val normalizedCreatedAt = normalizeCreatedAt(cursor.createdAt) ?: return false
        val normalized = ReadCursor(normalizedAccountId, normalizedCreatedAt, normalizedId)
        return runCatching {
            withLock {
                val previous = readSnapshot()
                val existing = previous.readCursors.firstOrNull { it.accountId == normalizedAccountId }
                if (existing == null || compareCursors(
                        MessageCursor(normalized.createdAt, normalized.messageId),
                        MessageCursor(existing.createdAt, existing.messageId),
                    ) > 0
                ) {
                    val updated = (previous.readCursors.filterNot { it.accountId == normalizedAccountId } + normalized)
                        .takeLast(MAX_READ_CURSORS)
                    writeSnapshot(previous.copy(readCursors = updated))
                }
            }
            true
        }.getOrDefault(false)
    }

    fun takeDisplayedNotificationIds(): List<Int> = runCatching {
        withLock {
            val previous = readSnapshot()
            if (previous.displayedNotificationIds.isEmpty()) return@withLock emptyList()
            writeSnapshot(previous.copy(displayedNotificationIds = emptyList()))
            previous.displayedNotificationIds
        }
    }.getOrDefault(emptyList())

    fun forgetDisplayedNotificationId(notificationId: Int) {
        if (notificationId <= 0) return
        runCatching {
            withLock {
                val previous = readSnapshot()
                if (notificationId in previous.displayedNotificationIds) {
                    writeSnapshot(previous.copy(displayedNotificationIds = previous.displayedNotificationIds - notificationId))
                }
            }
        }
    }

    private data class Snapshot(
        val seenMessageIds: List<String> = emptyList(),
        val displayedNotificationIds: List<Int> = emptyList(),
        val readCursors: List<ReadCursor> = emptyList(),
    )

    private data class ReadCursor(
        val accountId: String,
        val createdAt: String,
        val messageId: String,
    )

    private fun readSnapshot(): Snapshot {
        if (!file.isFile) return Snapshot()
        val seen = mutableListOf<String>()
        val displayed = mutableListOf<Int>()
        val readCursors = mutableListOf<ReadCursor>()
        runCatching { file.readLines(Charsets.UTF_8) }.getOrDefault(emptyList()).forEach { line ->
            when {
                line.startsWith("seen|") -> normalizeMessageId(line.removePrefix("seen|"))?.let { seen += it }
                line.startsWith("displayed|") -> line.removePrefix("displayed|").toIntOrNull()?.takeIf { it > 0 }?.let { displayed += it }
                line.startsWith("read|") -> line.split('|', limit = 4).takeIf { it.size == 4 }?.let { parts ->
                    val accountId = normalizeAccountId(parts[1])
                    val createdAt = normalizeCreatedAt(parts[2])
                    val messageId = normalizeMessageId(parts[3])
                    if (accountId != null && createdAt != null && messageId != null) {
                        readCursors += ReadCursor(accountId, createdAt, messageId)
                    }
                }
            }
        }
        return Snapshot(
            seenMessageIds = seen.distinct().takeLast(MAX_SEEN_MESSAGE_IDS),
            displayedNotificationIds = displayed.distinct().takeLast(MAX_DISPLAYED_IDS),
            readCursors = readCursors
                .distinctBy(ReadCursor::accountId)
                .takeLast(MAX_READ_CURSORS),
        )
    }

    private fun writeSnapshot(snapshot: Snapshot) {
        file.parentFile?.mkdirs()
        if (snapshot.seenMessageIds.isEmpty() && snapshot.displayedNotificationIds.isEmpty() && snapshot.readCursors.isEmpty()) {
            file.delete()
            return
        }
        val content = buildString {
            snapshot.seenMessageIds.forEach { append("seen|").append(it).append('\n') }
            snapshot.displayedNotificationIds.forEach { append("displayed|").append(it).append('\n') }
            snapshot.readCursors.forEach {
                append("read|").append(it.accountId).append('|').append(it.createdAt).append('|').append(it.messageId).append('\n')
            }
        }
        val temp = File(file.parentFile, "${file.name}.tmp-${Thread.currentThread().id}")
        FileOutputStream(temp).use { output ->
            output.write(content.toByteArray(Charsets.UTF_8))
            output.flush()
            output.fd.sync()
        }
        if (!temp.renameTo(file)) {
            if (file.exists()) check(file.delete()) { "Cannot replace ${file.absolutePath}" }
            check(temp.renameTo(file)) { "Cannot write ${file.absolutePath}" }
        }
    }

    private inline fun <T> withLock(block: () -> T): T = synchronized(monitor) {
        lockFile.parentFile?.mkdirs()
        RandomAccessFile(lockFile, "rw").use { access ->
            access.channel.lock().use { block() }
        }
    }

    private companion object {
        const val MAX_SEEN_MESSAGE_IDS = 128
        const val MAX_DISPLAYED_IDS = 32
        const val MAX_READ_CURSORS = 2
        val SAFE_MESSAGE_ID = Regex("[A-Za-z0-9_.:-]{1,200}")
        val SAFE_ACCOUNT_ID = setOf("1001", "1002")

        fun normalizeMessageId(value: String?): String? = value?.trim()?.takeIf { SAFE_MESSAGE_ID.matches(it) }

        fun normalizeAccountId(value: String?): String? = value?.trim()?.takeIf { it in SAFE_ACCOUNT_ID }

        fun normalizeCreatedAt(value: String?): String? = value?.trim()?.takeIf {
            it.length <= 64 && runCatching { Instant.parse(it) }.isSuccess
        }

        fun compareCursors(a: MessageCursor, b: MessageCursor): Int =
            a.createdAt.compareTo(b.createdAt).takeIf { it != 0 } ?: a.id.compareTo(b.id)
    }
}

class AppForegroundState(context: Context) {
    private val appContext = context.applicationContext
    private val visibility = FileChatVisibilityMarker(
        File(appContext.filesDir, CHAT_VISIBILITY_FILE),
    )
    private val notifications = ChatNotificationStateStore(
        File(appContext.filesDir, CHAT_NOTIFICATION_FILE),
    )
    private val notificationIo = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    @Volatile
    private var localChatVisible = false

    val isChatVisible: Boolean
        get() = localChatVisible || visibility.activeProcessId()?.let(::isMainProcessForeground) == true

    fun onChatForeground() {
        localChatVisible = true
        visibility.markVisible(android.os.Process.myPid())
        notificationIo.launch {
            if (localChatVisible) {
                notifications.takeDisplayedNotificationIds().forEach(::cancelNotification)
            }
        }
    }

    fun onChatBackground() {
        localChatVisible = false
        visibility.clear()
    }

    fun shouldShowChatNotification(
        accountId: String?,
        messageId: String?,
        messageCreatedAt: String?,
        notificationId: Int,
    ): Boolean {
        val visible = isChatVisible
        val show = notifications.shouldShow(
            accountId = accountId,
            messageId = messageId,
            messageCreatedAt = messageCreatedAt,
            notificationId = notificationId,
            chatVisible = visible,
        )
        if (!show && visible) cancelNotification(notificationId)
        return show
    }

    /** Called only after the backend accepted a real visible-message read cursor. */
    suspend fun recordServerConfirmedRead(accountId: String, cursor: MessageCursor) =
        kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            notifications.recordServerConfirmedRead(accountId, cursor)
        }

    fun forgetChatNotification(notificationId: Int) {
        notifications.forgetDisplayedNotificationId(notificationId)
    }

    private fun cancelNotification(notificationId: Int) {
        if (notificationId <= 0) return
        appContext.getSystemService(NotificationManager::class.java)?.cancel(notificationId)
    }

    private fun isMainProcessForeground(processId: Int): Boolean {
        val manager = appContext.getSystemService(ActivityManager::class.java) ?: return false
        return manager.runningAppProcesses.orEmpty().any { process ->
            process.pid == processId &&
                process.processName == appContext.packageName &&
                process.importance == ActivityManager.RunningAppProcessInfo.IMPORTANCE_FOREGROUND
        }
    }

    private companion object {
        const val CHAT_VISIBILITY_FILE = "between-chat-visibility.state"
        const val CHAT_NOTIFICATION_FILE = "between-chat-notifications.state"
    }
}
