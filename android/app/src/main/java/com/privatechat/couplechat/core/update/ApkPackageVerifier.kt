package com.privatechat.couplechat.core.update

import com.privatechat.couplechat.core.model.ReleaseInfo
import java.io.File
import java.security.MessageDigest

data class ApkIdentity(
    val packageName: String,
    val versionCode: Long,
    val signerDigests: Set<String>,
)

fun interface ApkIdentityReader {
    fun read(file: File): ApkIdentity?
}

class ApkPackageVerifier(
    private val current: ApkIdentity,
    private val reader: ApkIdentityReader,
) {
    fun verify(file: File, release: ReleaseInfo) {
        val candidate = reader.read(file)
        if (
            !file.isFile ||
            sha256(file) != release.sha256.lowercase() ||
            candidate == null ||
            candidate.packageName != current.packageName ||
            candidate.versionCode != release.versionCode.toLong() ||
            candidate.versionCode <= current.versionCode ||
            candidate.signerDigests != current.signerDigests
        ) {
            throw InvalidUpdatePackageException()
        }
    }
}

class InvalidUpdatePackageException : Exception("更新包无效")

internal fun sha256(file: File): String {
    val digest = MessageDigest.getInstance("SHA-256")
    file.inputStream().use { input ->
        val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
        while (true) {
            val read = input.read(buffer)
            if (read < 0) break
            digest.update(buffer, 0, read)
        }
    }
    return digest.digest().joinToString("") { byte -> "%02x".format(byte) }
}
