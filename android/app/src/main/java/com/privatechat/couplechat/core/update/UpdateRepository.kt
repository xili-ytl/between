package com.privatechat.couplechat.core.update

import com.privatechat.couplechat.core.model.ReleaseInfo
import com.privatechat.couplechat.core.network.ReleaseApi
import java.io.File

sealed interface UpdateCheck {
    data class Current(val release: ReleaseInfo) : UpdateCheck
    data class Available(val release: ReleaseInfo) : UpdateCheck
}

interface ApkDownloadEngine {
    suspend fun download(release: ReleaseInfo, onProgress: (Int) -> Unit): File
}

interface UpdateDataSource {
    suspend fun check(): UpdateCheck
    suspend fun download(release: ReleaseInfo, onProgress: (Int) -> Unit): File
}

class UpdateRepository(
    private val api: ReleaseApi,
    private val downloader: ApkDownloadEngine,
    private val verifier: ApkPackageVerifier,
    private val currentVersionCode: Int,
) : UpdateDataSource {
    override suspend fun check(): UpdateCheck {
        val release = api.latestRelease()
        return if (release.versionCode > currentVersionCode) {
            UpdateCheck.Available(release)
        } else {
            UpdateCheck.Current(release)
        }
    }

    override suspend fun download(release: ReleaseInfo, onProgress: (Int) -> Unit): File {
        val file = downloader.download(release, onProgress)
        try {
            verifier.verify(file, release)
            return file
        } catch (error: Throwable) {
            file.delete()
            throw error
        }
    }
}
