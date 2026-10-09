package com.privatechat.couplechat.core.update

import com.privatechat.couplechat.core.model.ReleaseInfo
import com.privatechat.couplechat.core.network.ReleaseApi
import java.io.File
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder

class UpdateRepositoryTest {
    @get:Rule
    val temporary = TemporaryFolder()

    @Test
    fun reportsCurrentOrAvailableFromTheInternalVersionCode() = runTest {
        val current = release(versionCode = 6)
        val newer = release(versionCode = 7)

        assertTrue(UpdateRepository(FakeReleaseApi(current), FakeDownloadEngine(), verifier(), 6).check() is UpdateCheck.Current)
        assertEquals(
            newer,
            (UpdateRepository(FakeReleaseApi(newer), FakeDownloadEngine(), verifier(), 6).check() as UpdateCheck.Available).release,
        )
    }

    @Test
    fun verifiedDownloadReturnsTheFileAndReportsProgress() = runTest {
        val file = temporary.newFile("between.apk").apply { writeBytes("safe-apk".encodeToByteArray()) }
        val release = release(versionCode = 7, sha256 = sha256(file))
        val progress = mutableListOf<Int>()
        val repository = UpdateRepository(
            FakeReleaseApi(release),
            FakeDownloadEngine(file),
            verifier(identity = ApkIdentity("com.privatechat.couplechat", 7, setOf("signer"))),
            6,
        )

        assertEquals(file, repository.download(release) { progress += it })
        assertEquals(listOf(40, 100), progress)
    }

    @Test
    fun rejectsAndDeletesWrongHashPackageVersionOrSigner() = runTest {
        val cases = listOf(
            release(versionCode = 7, sha256 = "0".repeat(64)) to ApkIdentity("com.privatechat.couplechat", 7, setOf("signer")),
            release(versionCode = 7) to ApkIdentity("other.package", 7, setOf("signer")),
            release(versionCode = 7) to ApkIdentity("com.privatechat.couplechat", 6, setOf("signer")),
            release(versionCode = 7) to ApkIdentity("com.privatechat.couplechat", 7, setOf("other-signer")),
        )

        cases.forEachIndexed { index, (template, identity) ->
            val file = temporary.newFile("invalid-$index.apk").apply { writeBytes("safe-apk".encodeToByteArray()) }
            val release = if (index == 0) template else template.copy(sha256 = sha256(file))
            val repository = UpdateRepository(
                FakeReleaseApi(release),
                FakeDownloadEngine(file),
                verifier(identity),
                6,
            )

            val error = runCatching { repository.download(release) {} }.exceptionOrNull()

            assertTrue(error is InvalidUpdatePackageException)
            assertTrue("invalid APK should be deleted", !file.exists())
        }
    }

    private fun verifier(
        identity: ApkIdentity = ApkIdentity("com.privatechat.couplechat", 7, setOf("signer")),
    ) = ApkPackageVerifier(
        current = ApkIdentity("com.privatechat.couplechat", 6, setOf("signer")),
        reader = ApkIdentityReader { identity },
    )

    private fun release(
        versionCode: Int,
        sha256: String = "a".repeat(64),
    ) = ReleaseInfo(
        versionCode = versionCode,
        versionName = "1.0",
        notes = "优化聊天",
        downloadUrl = "https://download.test/between.apk",
        sha256 = sha256,
    )
}

private class FakeReleaseApi(private val release: ReleaseInfo) : ReleaseApi {
    override suspend fun latestRelease(): ReleaseInfo = release
}

private class FakeDownloadEngine(private val file: File? = null) : ApkDownloadEngine {
    override suspend fun download(release: ReleaseInfo, onProgress: (Int) -> Unit): File {
        onProgress(40)
        onProgress(100)
        return requireNotNull(file)
    }
}
