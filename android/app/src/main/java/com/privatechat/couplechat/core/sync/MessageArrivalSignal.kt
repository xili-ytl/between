package com.privatechat.couplechat.core.sync

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.SharedFlow

/**
 * 消息到达信号：由推送接收方（极光自定义消息）发出，让前台同步立刻执行一次，
 * 而不是等下一次自适应轮询（最长 15 秒）。只做唤醒，不携带业务数据。
 */
interface MessageArrivalSignal {
    val arrivals: SharedFlow<Unit>
    fun notifyArrival()
}

class MutableMessageArrivalSignal : MessageArrivalSignal {
    private val _arrivals = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    override val arrivals: SharedFlow<Unit> = _arrivals

    override fun notifyArrival() {
        _arrivals.tryEmit(Unit)
    }
}

object NoOpMessageArrivalSignal : MessageArrivalSignal {
    override val arrivals: SharedFlow<Unit> = MutableSharedFlow()
    override fun notifyArrival() = Unit
}
