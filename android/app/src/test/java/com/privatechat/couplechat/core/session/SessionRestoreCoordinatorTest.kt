@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.core.session

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class SessionRestoreCoordinatorTest {
    @Test
    fun loadingIsSingleFlightAndEndsReady() = runTest {
        val gate = CompletableDeferred<Unit>()
        var calls = 0
        val coordinator = SessionRestoreCoordinator(
            scope = this,
            alreadyLoaded = { false },
            restore = {
                calls += 1
                gate.await()
            },
        )

        coordinator.start()
        coordinator.start()
        runCurrent()
        assertEquals(1, calls)
        assertEquals(SessionRestoreState.Loading, coordinator.state.value)

        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(SessionRestoreState.Ready, coordinator.state.value)
    }

    @Test
    fun failureIsVisibleAndRetryRunsOnlyAfterTheFailedAttempt() = runTest {
        var calls = 0
        val coordinator = SessionRestoreCoordinator(
            scope = this,
            alreadyLoaded = { false },
            restore = {
                calls += 1
                if (calls == 1) error("secure store unavailable")
            },
        )

        coordinator.start()
        advanceUntilIdle()
        assertEquals(SessionRestoreState.Failed, coordinator.state.value)
        assertEquals(1, calls)

        coordinator.retry()
        advanceUntilIdle()
        assertEquals(SessionRestoreState.Ready, coordinator.state.value)
        assertEquals(2, calls)
    }

    @Test
    fun loadedSessionWaitsForEntryPreparationBeforeBecomingReady() = runTest {
        val gate = CompletableDeferred<Unit>()
        var prepareCalls = 0
        val coordinator = SessionRestoreCoordinator(
            scope = this,
            alreadyLoaded = { true },
            restore = { error("restore must not run for a loaded session") },
            prepare = {
                prepareCalls += 1
                gate.await()
            },
        )

        coordinator.start()
        coordinator.start()
        runCurrent()
        assertEquals(1, prepareCalls)
        assertEquals(SessionRestoreState.Loading, coordinator.state.value)

        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(SessionRestoreState.Ready, coordinator.state.value)
    }

    @Test
    fun failedEntryPreparationCanBeRetriedWithoutLaunchingTwoPreparations() = runTest {
        val gate = CompletableDeferred<Unit>()
        var attempts = 0
        val coordinator = SessionRestoreCoordinator(
            scope = this,
            alreadyLoaded = { true },
            restore = {},
            prepare = {
                attempts += 1
                if (attempts == 1) error("profile request failed") else gate.await()
            },
        )

        coordinator.start()
        advanceUntilIdle()
        assertEquals(SessionRestoreState.Failed, coordinator.state.value)

        coordinator.retry()
        coordinator.retry()
        runCurrent()
        assertEquals(2, attempts)
        assertEquals(SessionRestoreState.Loading, coordinator.state.value)

        gate.complete(Unit)
        advanceUntilIdle()
        assertEquals(SessionRestoreState.Ready, coordinator.state.value)
    }
}
