package com.privatechat.couplechat.feature.update

import com.privatechat.couplechat.core.model.ReleaseInfo
import java.io.File

enum class UpdatePhase {
    IDLE,
    CHECKING,
    CURRENT,
    AVAILABLE,
    DOWNLOADING,
    READY,
    ERROR,
}

data class UpdateInstallRequest(
    val id: Long,
    val file: File,
)

data class UpdateState(
    val phase: UpdatePhase = UpdatePhase.IDLE,
    val release: ReleaseInfo? = null,
    val progress: Int = 0,
    val error: String? = null,
    val installRequest: UpdateInstallRequest? = null,
)
