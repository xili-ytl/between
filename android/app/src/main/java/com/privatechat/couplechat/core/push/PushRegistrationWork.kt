package com.privatechat.couplechat.core.push

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.workDataOf
import java.util.concurrent.TimeUnit

interface PushWorkScheduler {
    fun enqueue(identity: PushSessionIdentity)
    fun cancel()
}

class WorkManagerPushWorkScheduler(
    context: Context,
) : PushWorkScheduler {
    private val workManager = WorkManager.getInstance(context.applicationContext)

    override fun enqueue(identity: PushSessionIdentity) {
        val request = OneTimeWorkRequestBuilder<PushRegistrationWorker>()
            .setInputData(
                workDataOf(
                    ACCOUNT_ID_INPUT to identity.accountId,
                    SESSION_VERSION_INPUT to identity.sessionVersion,
                ),
            )
            .setConstraints(
                Constraints.Builder()
                    .setRequiredNetworkType(NetworkType.CONNECTED)
                    .build(),
            )
            .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
            .build()
        workManager.enqueueUniqueWork(WORK_NAME, ExistingWorkPolicy.REPLACE, request)
    }

    override fun cancel() {
        workManager.cancelUniqueWork(WORK_NAME)
    }
}

internal const val WORK_NAME = "between-push-registration"
internal const val ACCOUNT_ID_INPUT = "account_id"
internal const val SESSION_VERSION_INPUT = "session_version"
