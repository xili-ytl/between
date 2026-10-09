package com.privatechat.couplechat.core.push

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import com.privatechat.couplechat.CoupleChatApplication

class PushRegistrationWorker(
    appContext: Context,
    parameters: WorkerParameters,
) : CoroutineWorker(appContext, parameters) {
    override suspend fun doWork(): Result {
        val accountId = inputData.getString(ACCOUNT_ID_INPUT) ?: return Result.failure()
        val sessionVersion = inputData.getInt(SESSION_VERSION_INPUT, Int.MIN_VALUE)
        if (sessionVersion == Int.MIN_VALUE) return Result.failure()
        val application = applicationContext as? CoupleChatApplication ?: return Result.failure()

        return when (
            application.container.pushRegistrationTask.run(
                PushSessionIdentity(accountId, sessionVersion),
            )
        ) {
            PushRegistrationOutcome.RETRY -> Result.retry()
            PushRegistrationOutcome.SUCCESS,
            PushRegistrationOutcome.STALE,
            PushRegistrationOutcome.STOP,
            -> Result.success()
        }
    }
}
