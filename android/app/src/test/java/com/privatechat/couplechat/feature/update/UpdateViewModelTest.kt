@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.feature.update

import com.privatechat.couplechat.MainDispatcherRule
import com.privatechat.couplechat.core.model.ReleaseInfo
import com.privatechat.couplechat.core.update.UpdateCheck
import com.privatechat.couplechat.core.update.UpdateDataSource
import java.io.File
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class UpdateViewModelTest {
    @get:Rule
    val main = MainDispatcherRule()

    @Test
    fun checkingReportsCurrentOrAvailable() = runTest(main.dispatcher) {
        val current = UpdateViewModel(FakeUpdateDataSource(UpdateCheck.Current(release(6))))
        current.check()
        advanceUntilIdle()
        assertEquals(UpdatePhase.CURRENT, current.state.value.phase)

        val available = UpdateViewModel(FakeUpdateDataSource(UpdateCheck.Available(release(7))))
        available.check()
        advanceUntilIdle()
        assertEquals(UpdatePhase.AVAILABLE, available.state.value.phase)
        assertEquals(7, available.state.value.release?.versionCode)
    }

    @Test
    fun downloadPublishesProgressAndOneInstallRequest() = runTest(main.dispatcher) {
        val source = FakeUpdateDataSource(UpdateCheck.Available(release(7)))
        val viewModel = UpdateViewModel(source)
        viewModel.check()
        advanceUntilIdle()

        viewModel.startUpdate()
        advanceUntilIdle()

        assertEquals(UpdatePhase.READY, viewModel.state.value.phase)
        assertEquals(100, viewModel.state.value.progress)
        assertNotNull(viewModel.state.value.installRequest)
        viewModel.consumeInstallRequest()
        assertEquals(null, viewModel.state.value.installRequest)
    }

    @Test
    fun repeatedTapsCannotStartParallelChecks() = runTest(main.dispatcher) {
        val gate = CompletableDeferred<UpdateCheck>()
        val source = FakeUpdateDataSource(gatedCheck = gate)
        val viewModel = UpdateViewModel(source)

        viewModel.check()
        viewModel.check()
        runCurrent()
        assertEquals(1, source.checkCalls)
        assertEquals(UpdatePhase.CHECKING, viewModel.state.value.phase)

        gate.complete(UpdateCheck.Current(release(6)))
        advanceUntilIdle()
        assertEquals(UpdatePhase.CURRENT, viewModel.state.value.phase)
    }

    @Test
    fun failuresAreRetryableWithoutExposingTechnicalDetails() = runTest(main.dispatcher) {
        val source = FakeUpdateDataSource(UpdateCheck.Available(release(7)), downloadFailure = true)
        val viewModel = UpdateViewModel(source)
        viewModel.check()
        advanceUntilIdle()
        viewModel.startUpdate()
        advanceUntilIdle()

        assertEquals(UpdatePhase.ERROR, viewModel.state.value.phase)
        assertTrue(viewModel.state.value.error.orEmpty().contains("重试"))
    }
}

private class FakeUpdateDataSource(
    private val result: UpdateCheck? = null,
    private val gatedCheck: CompletableDeferred<UpdateCheck>? = null,
    private val downloadFailure: Boolean = false,
) : UpdateDataSource {
    var checkCalls = 0

    override suspend fun check(): UpdateCheck {
        checkCalls += 1
        return gatedCheck?.await() ?: requireNotNull(result)
    }

    override suspend fun download(release: ReleaseInfo, onProgress: (Int) -> Unit): File {
        if (downloadFailure) error("network detail")
        onProgress(35)
        onProgress(100)
        return File("verified-${release.versionCode}.apk")
    }
}

private fun release(versionCode: Int) = ReleaseInfo(
    versionCode = versionCode,
    versionName = "1.0",
    notes = "优化聊天",
    downloadUrl = "https://download.test/between.apk",
    sha256 = "a".repeat(64),
)
