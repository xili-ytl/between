package com.privatechat.couplechat.core.push

import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.session.SessionManager
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.launch

class PushRegistrationCoordinator(
    private val sessions: SessionManager,
    private val tokens: PushTokenStore,
    private val provider: PushProvider,
    private val scheduler: PushWorkScheduler,
    private val gateway: PushRegistrationGateway = NoOpPushRegistrationGateway,
    private val scope: CoroutineScope,
    private val aliasRetryDelayMs: Long = 30_000,
) : PushRegistrationLifecycle {
    private val started = AtomicBoolean(false)
    private val aliasSequence = AtomicInteger(0)
    private var lastScheduled: PushBinding? = null
    private var connected = false
    private var aliasAccountId: String? = null
    private var pendingAliasSequence: Int? = null
    private var aliasRetryAvailable = true
    private var aliasRetryJob: Job? = null
    private var lastActiveAccountId: String? = null

    fun start() {
        if (!started.compareAndSet(false, true)) return
        scope.launch {
            if (!sessions.loaded.value) sessions.load()
            provider.currentRegistrationId()?.let(::handleRegistered)
            sessions.session.collect(::handleSession)
        }
    }

    fun onRegistered(registrationId: String) {
        scope.launch { handleRegistered(registrationId) }
    }

    fun onConnected(isConnected: Boolean) {
        scope.launch {
            val becameConnected = isConnected && !connected
            connected = isConnected
            if (!isConnected) {
                aliasRetryJob?.cancel()
                aliasRetryJob = null
                pendingAliasSequence = null
                return@launch
            }
            bindAliasIfPossible(resetRetryBudget = becameConnected)
        }
    }

    fun onAliasResult(sequence: Int, errorCode: Int) {
        scope.launch {
            if (pendingAliasSequence != sequence) return@launch
            pendingAliasSequence = null
            if (errorCode == 0) {
                aliasAccountId = sessions.current()?.accountId
                aliasRetryJob?.cancel()
                aliasRetryJob = null
            } else if (aliasRetryAvailable) {
                aliasRetryAvailable = false
                val expectedAccountId = sessions.current()?.accountId ?: return@launch
                aliasRetryJob?.cancel()
                aliasRetryJob = scope.launch {
                    delay(aliasRetryDelayMs)
                    if (connected && sessions.current()?.accountId == expectedAccountId) {
                        bindAliasIfPossible(resetRetryBudget = false)
                    }
                }
            }
        }
    }

    override suspend fun unregister(session: Session) {
        lastScheduled = null
        scheduler.cancel()
        try {
            gateway.unregister(session.token)
        } catch (error: CancellationException) {
            throw error
        } catch (_: Throwable) {
            // Push cleanup is best effort; account logout must remain available.
        }
    }

    private fun handleRegistered(registrationId: String) {
        val normalized = registrationId.trim().takeIf(String::isNotEmpty) ?: return
        tokens.save(normalized)
        scheduleIfReady(sessions.current(), normalized)
    }

    private fun handleSession(session: Session?) {
        if (session == null) {
            stopLocalPush()
            return
        }
       provider.resumePush()
        lastActiveAccountId = session.accountId
        scheduleIfReady(session, tokens.read())
        if (aliasAccountId != session.accountId) {
            resetAliasState()
        }
        bindAliasIfPossible(resetRetryBudget = true)
    }

   /**
     * 无有效会话时的本地停推单一出口：取消注册任务、尽力删除 alias 并停止当前设备推送。
    */
    private fun stopLocalPush() {
        lastScheduled = null
        scheduler.cancel()
       val account = lastActiveAccountId
        if (account != null) {
            provider.deleteAlias(account, aliasSequence.incrementAndGet())
        }
        provider.stopPush()
        resetAliasState()
    }

    private fun scheduleIfReady(session: Session?, registrationId: String?) {
        val active = session ?: return
        val normalized = registrationId?.trim()?.takeIf(String::isNotEmpty) ?: return
        val binding = PushBinding(active.pushIdentity(), normalized)
        if (binding == lastScheduled) return
        lastScheduled = binding
        scheduler.enqueue(binding.identity)
    }

    private fun bindAliasIfPossible(resetRetryBudget: Boolean) {
        val accountId = sessions.current()?.accountId ?: return
        if (!connected || aliasAccountId == accountId || pendingAliasSequence != null) return
        if (resetRetryBudget) aliasRetryAvailable = true
        val sequence = aliasSequence.incrementAndGet()
        pendingAliasSequence = sequence
        provider.setAlias(accountId, sequence)
    }

    private fun resetAliasState() {
        aliasRetryJob?.cancel()
        aliasRetryJob = null
        aliasAccountId = null
        pendingAliasSequence = null
        aliasRetryAvailable = true
    }
}

private data class PushBinding(
    val identity: PushSessionIdentity,
    val registrationId: String,
)
