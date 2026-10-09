package com.privatechat.couplechat.core.diagnostics

import android.util.Log

data class WenliTimingEvent(
    val requestId: String,
    val stage: String,
    val durationMs: Long,
    val requestCount: Int,
    val outcome: String,
)

fun interface WenliTimingSink {
    fun record(event: WenliTimingEvent)
}

object NoOpWenliTimingSink : WenliTimingSink {
    override fun record(event: WenliTimingEvent) = Unit
}

/** Opt-in Logcat sink. It never logs message text, query text, tokens or response bodies. */
class LogWenliTimingSink : WenliTimingSink {
    override fun record(event: WenliTimingEvent) {
        if (!SAFE_ID.matches(event.requestId) || !SAFE_STAGE.matches(event.stage)) return
        Log.i(
            TAG,
            "requestId=${event.requestId} stage=${event.stage} durationMs=${event.durationMs.coerceAtLeast(0)} " +
                "requestCount=${event.requestCount.coerceAtLeast(0)} outcome=${event.outcome}",
        )
    }

    private companion object {
        const val TAG = "WenliTiming"
        val SAFE_ID = Regex("[A-Za-z0-9_-]{1,200}")
        val SAFE_STAGE = Regex("[a-z_]{1,64}")
    }
}
