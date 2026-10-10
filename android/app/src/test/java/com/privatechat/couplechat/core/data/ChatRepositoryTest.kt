@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.core.data

import com.privatechat.couplechat.core.database.MessageEntity
import com.privatechat.couplechat.core.database.MessageLocalStore
import com.privatechat.couplechat.core.diagnostics.WenliTimingEvent
import com.privatechat.couplechat.core.model.ChatMessage
import com.privatechat.couplechat.core.model.IMAGE_MESSAGE_PLACEHOLDER
import com.privatechat.couplechat.core.model.ImageMessage
import com.privatechat.couplechat.core.model.ImageUploadCredential
import com.privatechat.couplechat.core.model.MessageCursor
import com.privatechat.couplechat.core.model.MessagePage
import com.privatechat.couplechat.core.model.MomentComment
import com.privatechat.couplechat.core.model.MomentItem
import com.privatechat.couplechat.core.model.MomentLike
import com.privatechat.couplechat.core.model.MomentVisibility
import com.privatechat.couplechat.core.model.Profile
import com.privatechat.couplechat.core.model.ReadState
import com.privatechat.couplechat.core.model.Session
import com.privatechat.couplechat.core.model.WenliKickResult
import com.privatechat.couplechat.core.model.WenliSweepResult
import com.privatechat.couplechat.core.network.ChatApi
import com.privatechat.couplechat.core.network.SessionInvalidException
import com.privatechat.couplechat.core.session.SessionManager
import com.privatechat.couplechat.core.session.SessionStore
import com.privatechat.couplechat.core.sync.MessageArrivalSignal
import com.privatechat.couplechat.core.sync.MutableMessageArrivalSignal
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.test.advanceTimeBy
import kotlinx.coroutines.test.runCurrent
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatRepositoryTest {
    @Test
    fun recreatedAppKeepsCachedHistoryWhenInitialSyncIsOffline() = runTest {
        val cached = entity("1002_cached", "已缓存的合成消息", "1002", "2026-08-06T00:00:00Z")
        val local = FakeLocalStore(listOf(cached))
        val cursor = MessageCursor(cached.createdAt, cached.id)
        val cursors = FakeSyncCursorStore(cursor, historyComplete = true)
        val repository = ChatRepository(
            api = FakeApi(beforeFailures = 1), local = local, sessions = chatSessions(),
            cursorStore = cursors,
        )

        val result = runCatching { repository.initialSync() }

        assertTrue(result.isFailure)
        assertEquals(listOf(cached), local.all())
        assertEquals(listOf(cached.body), repository.messages.first().map { it.body })
        assertEquals(cursor, cursors.load("1001"))
        assertTrue(cursors.isHistoryComplete("1001"))
    }

    @Test
    fun recreatedAppMergesRecentMessagesWithoutDiscardingOlderCachedHistory() = runTest {
        val old = entity("1001_old", "旧的合成历史", "1001", "2026-08-01T00:00:00Z")
        val recent = message("1002_new", "新的合成消息", "1002", "2026-08-06T00:00:00Z")
        val local = FakeLocalStore(listOf(old))
        val repository = ChatRepository(
            api = FakeApi(afterPage = page(recent), beforePages = ArrayDeque(listOf(page(recent)))),
            local = local, sessions = chatSessions(),
        )

        repository.initialSync()

        assertEquals(listOf(old.body, recent.body), repository.messages.first().map { it.body })
    }

    @Test
    fun visibleMessageAdvancesBothUnreadAndPartnerReceiptCursors() = runTest {
        val api = FakeApi()
        val repository = repository(api, FakeLocalStore())
        val cursor = MessageCursor("2026-09-22T05:13:00.000Z", "1002_seen")

        repository.markMessageReadThrough(cursor)

        assertEquals(cursor, api.lastLegacyReadCursor)
        assertEquals(cursor, api.lastReceiptCursor)
    }

    @Test
    fun idleSyncDoesNotReloadRecentHistoryUntilReconcileDeadline() = runTest {
        val api = FakeApi()
        val repository = ChatRepository(api, FakeLocalStore(), chatSessions(),
            monotonicMillis = { testScheduler.currentTime })
        repository.syncLatest()
        repeat(10) { repository.syncLatest() }
        assertEquals(11, api.afterCalls)
        assertEquals(1, api.beforeCursors.size)
        advanceTimeBy(60_000)
        repository.syncLatest()
        assertEquals(2, api.beforeCursors.size)
    }

    @Test
    fun emptySweepDoesNotSyncAgainAndBacksOff() = runTest {
        val api = FakeApi()
        api.sweepGate = CompletableDeferred()
        val repository = repository(api, FakeLocalStore())
        repository.startForegroundSync(backgroundScope)
        runCurrent()
        val calls = api.afterCalls
        api.sweepGate!!.complete(Unit)
        runCurrent()
        assertEquals(calls, api.afterCalls)
        advanceTimeBy(90_000)
        runCurrent()
        assertEquals(1, api.sweepCalls)
        repository.stopForegroundSync()
    }

    @Test
    fun foregroundSweepIsSingleFlightAndStopsOnBackground() = runTest {
        val api = FakeApi()
        api.sweepGate = CompletableDeferred()
        val repository = repository(api, FakeLocalStore())
        repository.startForegroundSync(backgroundScope)
        runCurrent()
        assertEquals(1, api.sweepCalls)
        advanceTimeBy(50_000)
        runCurrent()
        assertEquals(1, api.sweepCalls)
        assertTrue(api.afterCalls > 0) // Normal chat polling continues while AI waits.
        repository.stopForegroundSync()
        runCurrent()
        advanceTimeBy(120_000)
        runCurrent()
        assertEquals(1, api.sweepCalls)
    }

    @Test
    fun oldWenliResponseCannotSyncOrInvalidateReplacementSession() = runTest {
        val api = FakeApi()
        val gate = CompletableDeferred<Unit>()
        api.kickGate = gate
        val sessions = chatSessions()
        val repository = ChatRepository(api, FakeLocalStore(), sessions)
        val pending = async { repository.requestWenli("1001_source") }
        runCurrent()
        sessions.set(replacementSession)
        gate.completeExceptionally(SessionInvalidException())
        pending.await()
        assertEquals(replacementSession, sessions.current())
        assertEquals(0, api.afterCalls)
        repository.requestWenli("1001_old-source")
        assertEquals(1, api.kickCalls)
    }

    @Test
    fun wenliTimingSeparatesMessageConfirmationKickAndClientReceive() = runTest {
        val events = mutableListOf<WenliTimingEvent>()
        var tick = 0L
        val repository = ChatRepository(
            FakeApi(),
            FakeLocalStore(),
            chatSessions(),
            monotonicMillis = { tick += 10L; tick },
            wenliTiming = { event -> events += event },
        )

        repository.send("timing-message", "@小Q 记录阶段")
        repository.requestWenli("1001_timing-message")

        assertEquals(listOf("message_confirmation", "kick_request", "client_receive"), events.map { it.stage })
        assertEquals(listOf(0, 1, 0), events.map { it.requestCount })
        assertTrue(events.all { it.requestId == "1001_timing-message" })
        assertEquals(listOf(10L, 10L, 20L), events.map { it.durationMs })
        assertTrue(events.all { it.outcome == "success" })
    }

    @Test
    fun sweepDoesNotRepeatAfterLogoutEvenWhenOldRequestCompletes() = runTest {
        val api = FakeApi()
        val gate = CompletableDeferred<Unit>()
        api.sweepGate = gate
        val sessions = chatSessions()
        val repository = ChatRepository(api, FakeLocalStore(), sessions)
        repository.startForegroundSync(backgroundScope)
        runCurrent()
        sessions.clearIfCurrent(session.token)
        gate.complete(Unit)
        runCurrent()
        advanceTimeBy(120_000)
        runCurrent()
        assertEquals(1, api.sweepCalls)
        repository.stopForegroundSync()
    }
    @Test
    fun simultaneousSendCannotSkipPartnerBehindOptimisticMessage() = runTest {
        val old = message("1002_old", "old", "1002", "2026-08-06T00:00:00Z")
        val server = mutableListOf(old)
        val api = FakeApi(serverMessages = server)
        val cache = FakeLocalStore(listOf(MessageEntity.from(old)))
        val repository = repository(api, cache)
        repository.syncLatest()
        val gate = api.gateSend()
        val sending = async { repository.send("pending", "own") }
        runCurrent()
        val partner = message("1002_partner", "partner", "1002", "2026-08-06T00:01:00Z")
        server += partner

        repository.syncLatest()

        assertTrue(cache.all().any { it.id == partner.id })
        assertEquals(old.id, api.lastAfterCursor?.id)
        gate.succeed(message("1001_pending", "own", "1001", "2026-08-06T00:02:00Z"))
        sending.await()
    }

    @Test
    fun lateServerInsertBehindReceivedCursorIsReconciled() = runTest {
        val newest = message("1002_z", "newest", "1002", "2026-08-06T00:02:00Z")
        val server = mutableListOf(newest)
        val api = FakeApi(serverMessages = server)
        val cache = FakeLocalStore(listOf(MessageEntity.from(newest)))
        val repository = ChatRepository(api, cache, chatSessions(),
            monotonicMillis = { testScheduler.currentTime })
        repository.syncLatest()
        val late = message("1001_a", "late", "1001", newest.createdAt)
        server += late

        advanceTimeBy(60_000)
        repository.syncLatest()

        assertTrue(cache.all().any { it.id == late.id })
    }

    @Test
    fun backfillRepairsInteriorHolesWithoutDeletingCachedHistory() = runTest {
        val old = message("1002_old", "old", "1002", "2026-08-06T00:00:00Z")
        val missing = message("1001_missing", "missing", "1001", "2026-08-06T00:01:00Z")
        val newest = message("1002_new", "new", "1002", "2026-08-06T00:02:00Z")
        val cache = FakeLocalStore(listOf(old, newest).map(MessageEntity::from))
        val repository = repository(FakeApi(serverMessages = mutableListOf(old, missing, newest)), cache)

        repository.backfillCachedHistory()

        assertEquals(listOf(old.id, missing.id, newest.id), cache.all().map { it.id })
    }

    @Test
    fun periodicHistorySweepRepairsLateCommitOutsideRecentWindow() = runTest {
        val newest = message("1002_new", "new", "1002", "2026-08-06T00:03:00Z")
        val server = mutableListOf(newest)
        val api = FakeApi(serverMessages = server)
        val cache = FakeLocalStore(listOf(MessageEntity.from(newest)))
        val repository = repository(api, cache)
        repository.startForegroundSync(backgroundScope)
        runCurrent()
        val missing = message("1001_late", "late", "1001", "2026-08-06T00:01:00Z")
        server += missing
        server += (1..60).map { message("1002_$it", "newer", "1002", "2026-08-06T00:02:00Z") }

        advanceTimeBy(300_001)
        runCurrent()

        assertEquals(62, cache.all().size)
        assertTrue(cache.all().any { it.id == missing.id })
        repository.stopForegroundSync()
    }

    @Test
    fun historySweepTraversesMoreThanTwoPagesOfAlreadyCachedRows() = runTest {
        val rows = (1..125).map {
            message("1002_${it.toString().padStart(3, '0')}", "row", "1002", "2026-08-06T00:00:00Z")
        }
        val cache = FakeLocalStore(rows.filterIndexed { index, _ -> index != 60 }.map(MessageEntity::from))
        val repository = repository(FakeApi(serverMessages = rows.toMutableList()), cache)

        repository.backfillCachedHistory()

        assertEquals(rows.map { it.id }, cache.all().map { it.id })
    }

    @Test
    fun completedHistoryIsNotReWalkedAfterRestart() = runTest {
        val rows = (1..120).map {
            message("1002_${it.toString().padStart(3, '0')}", "row", "1002", "2026-08-06T00:00:00Z")
        }
        val cache = FakeLocalStore(rows.map(MessageEntity::from))
        val cursors = FakeSyncCursorStore(historyComplete = true)
        val api = FakeApi(serverMessages = rows.toMutableList())
        val repository = ChatRepository(api, cache, chatSessions(), cursorStore = cursors)

        val inserted = repository.backfillCachedHistory()

        assertEquals(0, inserted)
        assertEquals(emptyList<MessageCursor?>(), api.beforeCursors)
    }

    @Test
    fun historySweepStopsAfterConfirmingTheCacheIsComplete() = runTest {
        val rows = (1..120).map {
            message("1002_${it.toString().padStart(3, '0')}", "row", "1002", "2026-08-06T00:00:00Z")
        }
        val cache = FakeLocalStore(rows.map(MessageEntity::from))
        val cursors = FakeSyncCursorStore()
        val api = FakeApi(serverMessages = rows.toMutableList())
        val repository = ChatRepository(api, cache, chatSessions(), cursorStore = cursors)

        repository.backfillCachedHistory()
        val walkCalls = api.beforeCursors.size
        repository.backfillCachedHistory()

        assertTrue(walkCalls >= 2)
        assertEquals(walkCalls, api.beforeCursors.size)
    }

    @Test
    fun cachedMessagesAreVisibleBeforeTheNetworkRuns() = runTest {
        val cache = FakeLocalStore(listOf(entity("1001_cached", "旧消息", "1001", "2026-08-06T00:00:00Z")))
        val api = FakeApi()
        val repository = repository(api, cache)

        assertEquals("旧消息", repository.messages.first().single().body)
        assertEquals(0, api.afterCalls)
    }

    @Test
    fun firstSyncDoesNotTrustTheLocalNewestCursorAndCachesTheResponse() = runTest {
        val cache = FakeLocalStore(listOf(entity("1001_old", "旧", "1001", "2026-08-06T00:00:00Z")))
        val api = FakeApi(afterPage = page(message("1002_new", "新", "1002", "2026-08-06T00:01:00Z")))
        val repository = repository(api, cache)

        val added = repository.syncLatest()

        assertEquals(1, added)
        assertNull(api.lastAfterCursor)
        assertEquals(listOf("旧", "新"), repository.messages.first().map { it.body })
    }

    @Test
    fun freshDeviceLoadsLatestThenCanBackfillOlderMessages() = runTest {
        val cache = FakeLocalStore()
        val api = FakeApi(
            beforePages = ArrayDeque(
                listOf(
                    page(message("1002_recent", "最近", "1002", "2026-08-06T00:02:00Z")),
                    page(message("1001_old", "更早", "1001", "2026-08-06T00:01:00Z")),
                )
            )
        )
        val repository = repository(api, cache)

        repository.initialSync()
        repository.loadOlder()

        assertEquals(listOf("更早", "最近"), repository.messages.first().map { it.body })
        assertEquals(null, api.beforeCursors.first())
        assertEquals("1002_recent", api.beforeCursors.last()?.id)
    }

    @Test
    fun automaticBackfillCachesEveryPageButUiStartsWithLatestFifty() = runTest {
        val recent = (1..50).map { index ->
            message("1002_recent$index", "消息$index", "1002", "2026-08-06T00:${index.toString().padStart(2, '0')}:00Z")
        }
        val cache = FakeLocalStore()
        val api = FakeApi(beforePages = ArrayDeque(listOf(page(*recent.toTypedArray()), page(message("1001_old", "最早", "1001", "2026-08-05T00:00:00Z")))))
        val repository = repository(api, cache)

        repository.initialSync()
        repository.backfillCachedHistory()

        assertEquals(51, cache.all().size)
        assertEquals(50, repository.messages.first().size)
        repository.loadOlder()
        assertEquals(51, repository.messages.first().size)
    }

    @Test
    fun loadOlderRevealsCachedMessagesEvenWhenTheNetworkIsOffline() = runTest {
        val cached = (1..75).map { index ->
            entity(
                "1001_cached$index",
                "cached$index",
                "1001",
                "2026-08-06T00:${index.toString().padStart(2, '0')}:00Z",
            )
        }
        val api = FakeApi(beforeFailures = 1)
        val repository = repository(api, FakeLocalStore(cached))

        assertEquals(50, repository.messages.first().size)
        runCatching { repository.loadOlder() }

        assertEquals(75, repository.messages.first().size)
        assertTrue(api.beforeCursors.isEmpty())
    }

    @Test
    fun loadOlderReportsCachedRowsThenCloudExhaustion() = runTest {
        val cached = (1..75).map { index ->
            entity(
                "1001_cached$index",
                "cached$index",
                "1001",
                "2026-08-06T00:${index.toString().padStart(2, '0')}:00Z",
            )
        }
        val api = FakeApi(beforePages = ArrayDeque(listOf(page())))
        val repository = repository(api, FakeLocalStore(cached))

        val cachedResult = repository.loadOlder()
        assertEquals(25, cachedResult.revealed)
        assertTrue(cachedResult.hasMore)
        assertTrue(api.beforeCursors.isEmpty())

        val cloudResult = repository.loadOlder()
        assertEquals(0, cloudResult.revealed)
        assertFalse(cloudResult.hasMore)
        assertEquals(1, api.beforeCursors.size)
    }

    @Test
    fun aNewLoginResetsTheVisibleWindowToLatestFifty() = runTest {
        val cached = (1..75).map { index ->
            entity(
                "1002_cached$index",
                "cached$index",
                "1002",
                "2026-08-06T00:${index.toString().padStart(2, '0')}:00Z",
            )
        }
        val sessions = chatSessions()
        val repository = ChatRepository(FakeApi(), FakeLocalStore(cached), sessions)

        repository.startForegroundSync(backgroundScope)
        runCurrent()
        repository.loadOlder()
        assertEquals(75, repository.messages.first().size)
        repository.stopForegroundSync()

        sessions.set(session.copy(token = "new-token", sessionVersion = 2))
        repository.startForegroundSync(backgroundScope)
        runCurrent()

        assertEquals(50, repository.messages.first().size)
        repository.stopForegroundSync()
    }

    @Test
    fun revealExpandsTheWindowUntilTheRequestedCachedMessageIsVisible() = runTest {
        val cached = (1..75).map { index ->
            entity(
                "1002_cached$index",
                "cached$index",
                "1002",
                "2026-08-06T00:${index.toString().padStart(2, '0')}:00Z",
            )
        }
        val repository = repository(FakeApi(), FakeLocalStore(cached))

        assertEquals(50, repository.messages.first().size)
        assertTrue(repository.reveal("1002_cached5"))
        assertEquals(71, repository.messages.first().size)
    }

    @Test
    fun foregroundBackfillRetriesAfterATransientFailure() = runTest {
        val cached = listOf(entity("1002_recent", "recent", "1002", "2026-08-06T00:02:00Z"))
        val old = message("1001_old", "old", "1001", "2026-08-06T00:01:00Z")
        val store = FakeLocalStore(cached)
        // Both the recent-window request and the first history request fail.
        val api = FakeApi(beforePages = ArrayDeque(listOf(page(old))), beforeFailures = 2)
        val repository = repository(api, store)

        repository.startForegroundSync(backgroundScope)
        runCurrent()
        assertEquals(1, store.all().size)

        advanceTimeBy(5_000)
        runCurrent()

        assertEquals(2, store.all().size)
        repository.stopForegroundSync()
    }

    @Test
    fun backfillUsesTheReturnedPageToDecideWhetherHistoryIsComplete() = runTest {
        val cached = (1..50).map { index ->
            entity(
                "1002_cached$index",
                "cached$index",
                "1002",
                "2026-08-06T00:${index.toString().padStart(2, '0')}:00Z",
            )
        }
        val duplicatePage = cached.map(MessageEntity::toModel).toTypedArray()
        val old = message("1001_old", "old", "1001", "2026-08-05T00:00:00Z")
        val store = FakeLocalStore(cached)
        val repository = repository(
            FakeApi(beforePages = ArrayDeque(listOf(page(*duplicatePage), page(old)))),
            store,
        )

        repository.backfillCachedHistory()

        assertEquals(51, store.all().size)
    }

    @Test
    fun retryUsesTheSameClientIdAndInvalidSessionKeepsCache() = runTest {
        val cache = FakeLocalStore(listOf(entity("1001_cached", "保留", "1001", "2026-08-06T00:00:00Z")))
        val api = FakeApi(sendFailures = 1, failAfterWithInvalidSession = true)
        val sessions = chatSessions()
        val repository = ChatRepository(api, cache, sessions)

        runCatching { repository.send("stable-id", "你好") }
        repository.send("stable-id", "你好")
        repository.syncLatest()

        assertEquals(listOf("stable-id", "stable-id"), api.sentIds)
        assertNull(sessions.current())
        assertTrue(repository.messages.first().any { it.body == "保留" })
    }

    @Test
    fun sendShowsOptimisticMessageBeforeNetworkCompletes() = runTest {
        val cache = FakeLocalStore()
        val api = FakeApi()
        val gate = api.gateSend()
        val repository = ChatRepository(api, cache, chatSessions())
        val request = async { repository.send("optimistic", "秒发") }
        runCurrent()

        assertTrue(cache.all().any { it.id == "1001_optimistic" && it.body == "秒发" })

        gate.succeed(message("1001_optimistic", "秒发", "1001", "2026-08-06T00:03:00Z", "optimistic"))
        request.await()

        assertTrue(cache.all().any { it.id == "1001_optimistic" })
        assertEquals("2026-08-06T00:03:00Z", cache.all().single { it.id == "1001_optimistic" }.createdAt)
    }

    @Test
    fun failedSendRemovesOptimisticMessage() = runTest {
        val cache = FakeLocalStore()
        val api = FakeApi(sendFailures = 1)
        val repository = ChatRepository(api, cache, chatSessions())

        runCatching { repository.send("fail", "失败") }

        assertTrue(cache.all().none { it.id == "1001_fail" })
    }

    @Test
    fun failedAckAfterServerCommitStillReachesTheSender() = runTest {
        val server = mutableListOf<ChatMessage>()
        val api = FakeApi(serverMessages = server, sendCommitsThenFails = true)
        val cache = FakeLocalStore()
        val repository = repository(api, cache)

        runCatching { repository.send("lostack", "对方能看到我却看不到") }
        assertTrue(cache.all().none { it.id == "1001_lostack" })

        repository.syncLatest()

        assertTrue(cache.all().any { it.id == "1001_lostack" })
    }

    @Test
    fun restartResumesTheReceiveCursorFromDisk() = runTest {
        val server = (1..100).map {
            message("1002_${it.toString().padStart(3, '0')}", "m$it", "1002", "2026-08-06T00:00:00Z")
        }.toMutableList()
        val cursors = FakeSyncCursorStore()
        // 本地已有缓存：重启后 initialSync 不会走 fetchOlderPage，只走 syncLatest。
        val cache = FakeLocalStore((1..50).map {
            entity("1002_${it.toString().padStart(3, '0')}", "m$it", "1002", "2026-08-06T00:00:00Z")
        })
        val first = repository(FakeApi(serverMessages = server), cache, cursors)
        first.syncLatest()

        assertEquals(MessageCursor("2026-08-06T00:00:00Z", "1002_050"), cursors.load("1001"))

        // 进程重启：内存游标归零，必须从落盘游标继续，而不是从历史最早一页重来。
        val restartedApi = FakeApi(serverMessages = server)
        val restarted = repository(restartedApi, cache, cursors)
        restarted.initialSync()

        assertEquals(MessageCursor("2026-08-06T00:00:00Z", "1002_050"), restartedApi.lastAfterCursor)
    }

    @Test
    fun pushArrivalSyncsImmediatelyInsteadOfWaitingForTheNextPoll() = runTest {
        val server = mutableListOf<ChatMessage>()
        val api = FakeApi(serverMessages = server)
        val cache = FakeLocalStore()
        val signal = MutableMessageArrivalSignal()
        val repository = repository(api, cache, signal)
        repository.startForegroundSync(backgroundScope)
        runCurrent()

        server += message("1002_pushed", "对方发的", "1002", "2026-08-06T00:00:01Z")
        signal.notifyArrival()
        runCurrent()

        assertTrue(cache.all().any { it.id == "1002_pushed" })
        repository.stopForegroundSync()
    }

    @Test
    fun sendImageUploadsThenSendsWithFileId() = runTest {
        val api = FakeApi()
        val sessions = chatSessions()
        val repository = ChatRepository(api, FakeLocalStore(), sessions)
        val bytes = byteArrayOf(1, 2, 3, 4)

        val sent = repository.sendImage("img-1", bytes, "image/jpeg", 800, 600)

        assertEquals("cloud://env-bucket/chat-images/1001_img-1.jpg", api.lastUploadedCredential?.fileId)
        assertEquals(1, api.uploadedImages.size)
        assertTrue(bytes.contentEquals(api.uploadedImages.single().second))
        assertEquals(listOf("img-1"), api.sentIds)
        assertNull(api.lastReplyToMessageId)
        assertEquals("image", sent.type)
        assertEquals("cloud://env-bucket/chat-images/1001_img-1.jpg", sent.imageFileId)
        assertEquals(800, sent.imageWidth)
    }

    @Test
    fun sendImageCarriesQuoteReply() = runTest {
        val api = FakeApi()
        val sessions = chatSessions()
        val repository = ChatRepository(api, FakeLocalStore(), sessions)
        val bytes = byteArrayOf(1, 2, 3, 4)

        val sent = repository.sendImage("img-quoted", bytes, "image/jpeg", 800, 600, "1001_quoted-message")

        assertEquals("1001_quoted-message", api.lastReplyToMessageId)
        assertEquals("image", sent.type)
        assertEquals("1001_quoted-message", sent.replyToMessageId)
    }

    @Test
    fun sendImageSendsTrimmedCaptionAndUsesLegacyPlaceholderWhenEmpty() = runTest {
        val api = FakeApi()
        val repository = ChatRepository(api, FakeLocalStore(), chatSessions())

        repository.sendImage("img-caption", byteArrayOf(1), "image/jpeg", 10, 20, caption = "  说明  ")
        repository.sendImage("img-empty", byteArrayOf(2), "image/jpeg", 10, 20, caption = "   ")

        assertEquals(listOf("说明", IMAGE_MESSAGE_PLACEHOLDER), api.sentBodies)
    }

    @Test
    fun imageUrlResolvesThroughApi() = runTest {
        val repository = ChatRepository(FakeApi(), FakeLocalStore(), chatSessions())
        val url = repository.imageUrl("cloud://env-bucket/chat-images/1001_img-1.jpg")
        assertEquals("memory://cloud://env-bucket/chat-images/1001_img-1.jpg", url)
    }

    @Test
    fun localImageUriFallsBackToUrlWhenNoLocalCache() = runTest {
        val api = FakeApi()
        val repository = ChatRepository(api, FakeLocalStore(), chatSessions())
        val fileId = "cloud://env-bucket/chat-images/1001_img-1.jpg"

        val uri = repository.localImageUri(fileId)

        // 无本地缓存（测试/降级）时直接返回签名 URL。
        assertEquals("memory://$fileId", uri)
        assertEquals(1, api.imageUrlCalls)
    }

    @Test
    fun localImageUriUsesLocalFileWithoutNetworkWhenPresent() = runTest {
        val api = FakeApi()
        val dir = createTempDir()
        try {
            val fileId = "cloud://env-bucket/chat-images/1001_img-1.jpg"
            val fileName = fileId.replace(Regex("[^A-Za-z0-9._-]"), "_") + ".jpg"
            val localFile = java.io.File(dir, fileName).apply { writeBytes(byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte())) }
            val cache = com.privatechat.couplechat.core.image.ImageLocalCache(dir)
            val repository = ChatRepository(api, FakeLocalStore(), chatSessions(), imageCache = cache)

            val uri = repository.localImageUri(fileId)

            // 本地文件已存在：返回本地文件 URI（java.net.URI），不再联网解析。
            assertEquals(localFile.toURI().toString(), uri)
            assertEquals(0, api.imageUrlCalls)
        } finally {
            dir.deleteRecursively()
        }
    }

    @Test
    fun oldHistoryInvalidSessionCannotExhaustReplacementHistory() = runTest {
        val cached = entity("1002_cached", "cached", "1002", "2026-08-06T00:01:00Z")
        val older = message("1001_older", "older", "1001", "2026-08-06T00:00:00Z")
        val cache = FakeLocalStore(listOf(cached))
        val sessions = chatSessions()
        val api = FakeApi(beforePages = ArrayDeque(listOf(page(older))))
        val gate = api.gateBefore()
        val repository = ChatRepository(api, cache, sessions)
        val oldRequest = async { repository.loadOlder() }
        gate.started.await()

        sessions.set(replacementSession)
        gate.fail(SessionInvalidException())
        oldRequest.await()
        val currentResult = repository.loadOlder()

        assertEquals(replacementSession, sessions.current())
        assertEquals(2, api.beforeCursors.size)
        assertEquals(listOf(session.token, replacementSession.token), api.beforeTokens)
        assertTrue(cache.all().any { it.id == older.id })
        assertEquals(1, currentResult.revealed)
        assertTrue(currentResult.hasMore)
    }

    @Test
    fun oldHistorySuccessCannotExpandTheReplacementVisibleWindow() = runTest {
        val cached = (1..75).map { index ->
            entity("1002_cached$index", "cached$index", "1002",
                java.time.Instant.parse("2026-08-06T00:00:00Z").plusSeconds(index.toLong()).toString())
        }
        val cache = FakeLocalStore(cached.take(50))
        val sessions = chatSessions()
        val api = FakeApi()
        val gate = api.gateBefore()
        val repository = ChatRepository(api, cache, sessions)
        val oldRequest = async { repository.loadOlder() }
        gate.started.await()

        sessions.set(replacementSession)
        cache.insertAll(cached.drop(50))
        gate.succeed(page(message("1001_stale", "stale", "1001", "2026-08-05T00:00:00Z")))
        val staleResult = oldRequest.await()

        assertEquals(0, staleResult.revealed)
        assertEquals(50, repository.messages.first().size)
        assertFalse(cache.all().any { it.id == "1001_stale" })
        assertEquals(replacementSession, sessions.current())
    }

    @Test
    fun queuedOldHistoryRequestCannotFetchUsingReplacementCredentials() = runTest {
        val cached = entity("1002_cached", "cached", "1002", "2026-08-06T00:01:00Z")
        val older = message("1001_older", "older", "1001", "2026-08-06T00:00:00Z")
        val cache = FakeLocalStore(listOf(cached))
        val sessions = chatSessions()
        val api = FakeApi(beforePages = ArrayDeque(listOf(page(older))))
        val gate = api.gateBefore()
        val repository = ChatRepository(api, cache, sessions)
        val first = async { repository.loadOlder() }
        gate.started.await()
        val queued = async { repository.loadOlder() }
        runCurrent()

        sessions.set(replacementSession)
        gate.fail(SessionInvalidException())
        first.await()
        val queuedResult = queued.await()

        assertEquals(1, api.beforeCursors.size)
        assertEquals(listOf(session.token), api.beforeTokens)
        assertEquals(listOf(cached), cache.all())
        assertEquals(0, queuedResult.revealed)
        assertEquals(replacementSession, sessions.current())

        repository.loadOlder()
        assertEquals(2, api.beforeCursors.size)
        assertEquals(listOf(session.token, replacementSession.token), api.beforeTokens)
        assertTrue(cache.all().any { it.id == older.id })
    }

    @Test
    fun currentHistoryInvalidSessionClearsLoginAndKeepsCachedMessages() = runTest {
        val cached = entity("1002_cached", "cached", "1002", "2026-08-06T00:01:00Z")
        val cache = FakeLocalStore(listOf(cached))
        val sessions = chatSessions()
        val api = FakeApi()
        val gate = api.gateBefore()
        val repository = ChatRepository(api, cache, sessions)
        val request = async { repository.loadOlder() }
        gate.started.await()

        gate.fail(SessionInvalidException())
        request.await()

        assertNull(sessions.current())
        assertEquals(listOf(cached), cache.all())
    }

    @Test
    fun oldSyncInvalidSessionCannotClearReplacementLogin() = runTest {
        val sessions = chatSessions()
        val api = FakeApi()
        val gate = api.gateAfter()
        val repository = ChatRepository(api, FakeLocalStore(), sessions)
        val request = async { repository.syncLatest() }
        runCurrent()

        sessions.set(replacementSession)
        gate.fail(SessionInvalidException())
        request.await()

        assertEquals(replacementSession, sessions.current())
    }

    @Test
    fun oldSendInvalidSessionCannotClearReplacementLogin() = runTest {
        val sessions = chatSessions()
        val api = FakeApi()
        val gate = api.gateSend()
        val repository = ChatRepository(api, FakeLocalStore(), sessions)
        val request = async { runCatching { repository.send("old-client", "old-body") } }
        runCurrent()

        sessions.set(replacementSession)
        gate.fail(SessionInvalidException())
        request.await()

        assertEquals(replacementSession, sessions.current())
    }

    @Test
    fun oldSyncSuccessAfterLoginChangeDoesNotPublishMessages() = runTest {
        val sessions = chatSessions()
        val api = FakeApi()
        val gate = api.gateAfter()
        val cache = FakeLocalStore()
        val repository = ChatRepository(api, cache, sessions)
        val request = async { repository.syncLatest() }
        runCurrent()

        sessions.set(replacementSession)
        gate.succeed(page(message("1002_old", "private-old", "1002", "2026-08-06T00:01:00Z")))
        request.await()

        assertTrue(cache.all().isEmpty())
    }

    @Test
    fun oldRecentWindowAfterLoginChangeDoesNotPublishMessages() = runTest {
        val sessions = chatSessions()
        val api = FakeApi()
        val gate = api.gateBefore()
        val cache = FakeLocalStore()
        val repository = ChatRepository(api, cache, sessions)
        val request = async { repository.syncLatest() }
        runCurrent()

        sessions.set(replacementSession)
        gate.succeed(page(message("1002_old", "old", "1002", "2026-08-06T00:01:00Z")))
        request.await()

        assertTrue(cache.all().isEmpty())
        assertEquals(replacementSession, sessions.current())
    }

    @Test
    fun oldSyncFailureAfterLoginChangeDoesNotPublishOfflineStatus() = runTest {
        val sessions = chatSessions()
        val api = FakeApi()
        val gate = api.gateAfter()
        val repository = ChatRepository(api, FakeLocalStore(), sessions)
        val request = async { runCatching { repository.syncLatest() } }
        runCurrent()

        sessions.set(replacementSession)
        gate.fail(IllegalStateException("old offline"))
        request.await()

        assertFalse(repository.syncStatus.value == SyncStatus.OFFLINE)
    }

    private suspend fun chatSessions(): SessionManager = SessionManager(ChatSessionStore(session)).also { it.load() }

    private suspend fun repository(api: FakeApi, cache: FakeLocalStore) =
        ChatRepository(api, cache, chatSessions())

    private suspend fun repository(api: FakeApi, cache: FakeLocalStore, cursors: FakeSyncCursorStore) =
        ChatRepository(api, cache, chatSessions(), cursorStore = cursors)

    private suspend fun repository(api: FakeApi, cache: FakeLocalStore, arrivals: MessageArrivalSignal) =
        ChatRepository(api, cache, chatSessions(), arrivals = arrivals)

    private companion object {
        val session = Session("1001", "女", "token", 1)
        val replacementSession = Session("1002", "男", "replacement-token", 2)
    }
}

private class ChatSessionStore(initial: Session?) : SessionStore {
    private var stored = initial
    override suspend fun read(): Session? = stored
    override suspend fun save(session: Session) { stored = session }
    override suspend fun clear() { stored = null }
}

private class FakeSyncCursorStore(
    private var stored: MessageCursor? = null,
    private var historyComplete: Boolean = false,
) : SyncCursorStore {
    override suspend fun save(accountId: String, cursor: MessageCursor) { stored = cursor }
    override suspend fun load(accountId: String): MessageCursor? = stored
    override suspend fun isHistoryComplete(accountId: String): Boolean = historyComplete
    override suspend fun markHistoryComplete(accountId: String) { historyComplete = true }
}

private class FakeLocalStore(initial: List<MessageEntity> = emptyList()) : MessageLocalStore {
    private val state = MutableStateFlow(initial.sortedWith(messageOrder))

    override fun observeLatest(limit: Int): Flow<List<MessageEntity>> = state.map { rows -> rows.takeLast(limit) }

    fun all(): List<MessageEntity> = state.value

    override suspend fun clearAll() { state.value = emptyList() }

    override suspend fun insertAll(messages: List<MessageEntity>): Int {
        val oldIds = state.value.mapTo(mutableSetOf()) { it.id }
        state.value = (state.value + messages.filterNot { it.id in oldIds }).sortedWith(messageOrder)
        return state.value.size - oldIds.size
    }

    override suspend fun deleteById(messageId: String): Boolean {
        val before = state.value.size
        state.value = state.value.filterNot { it.id == messageId }.sortedWith(messageOrder)
        return state.value.size != before
    }

    override suspend fun newest(): MessageEntity? = state.value.maxWithOrNull(messageOrder)
    override suspend fun oldest(): MessageEntity? = state.value.minWithOrNull(messageOrder)
    override suspend fun count(): Int = state.value.size
    override suspend fun visibleCountThrough(messageId: String): Int {
        val index = state.value.indexOfFirst { it.id == messageId }
        return if (index < 0) 0 else state.value.size - index
    }
}

private class FakeApi(
    private val serverMessages: MutableList<ChatMessage>? = null,
    private val afterPage: MessagePage = page(),
    private val beforePages: ArrayDeque<MessagePage> = ArrayDeque(),
    private var sendFailures: Int = 0,
    private val failAfterWithInvalidSession: Boolean = false,
    private var beforeFailures: Int = 0,
    private val sendCommitsThenFails: Boolean = false,
) : ChatApi {
    var lastLegacyReadCursor: MessageCursor? = null
    var lastReceiptCursor: MessageCursor? = null

    override suspend fun readStateSet(
        token: String,
        lastReadMessageId: String?,
        lastReadMessageCreatedAt: String?,
        lastSeenMomentAt: String?,
        readReceiptMessageId: String?,
        readReceiptMessageCreatedAt: String?,
    ): ReadState {
        lastLegacyReadCursor = if (lastReadMessageId != null && lastReadMessageCreatedAt != null) {
            MessageCursor(lastReadMessageCreatedAt, lastReadMessageId)
        } else null
        lastReceiptCursor = if (readReceiptMessageId != null && readReceiptMessageCreatedAt != null) {
            MessageCursor(readReceiptMessageCreatedAt, readReceiptMessageId)
        } else null
        return ReadState(
            accountId = "1001",
            lastReadMessageId = lastReadMessageId,
            lastReadMessageCreatedAt = lastReadMessageCreatedAt,
            readReceiptMessageId = readReceiptMessageId,
            readReceiptMessageCreatedAt = readReceiptMessageCreatedAt,
        )
    }

    var sweepGate: CompletableDeferred<Unit>? = null
    var kickGate: CompletableDeferred<Unit>? = null
    var sweepCalls = 0
    var kickCalls = 0
    override suspend fun sweepWenli(token: String, limit: Int): WenliSweepResult {
        if (sweepGate == null) error("unavailable")
        sweepCalls++
        sweepGate?.await()
        return WenliSweepResult(0)
    }
    override suspend fun kickWenli(token: String, sourceMessageId: String): WenliKickResult {
        kickCalls++
        kickGate?.await()
        return WenliKickResult(false)
    }
    var afterCalls = 0
    var imageUrlCalls = 0
    var lastAfterCursor: MessageCursor? = null
    val beforeCursors = mutableListOf<MessageCursor?>()
    val beforeTokens = mutableListOf<String>()
    val sentIds = mutableListOf<String>()
    val sentBodies = mutableListOf<String>()
    var lastReplyToMessageId: String? = null
    private var afterGate: ChatTestCallGate<MessagePage>? = null
    private var beforeGate: ChatTestCallGate<MessagePage>? = null
    private var sendGate: ChatTestCallGate<ChatMessage>? = null

    fun gateAfter() = ChatTestCallGate<MessagePage>().also { afterGate = it }
    fun gateBefore() = ChatTestCallGate<MessagePage>().also { beforeGate = it }
    fun gateSend() = ChatTestCallGate<ChatMessage>().also { sendGate = it }

    override suspend fun after(token: String, cursor: MessageCursor?): MessagePage {
        afterCalls++
        lastAfterCursor = cursor
        afterGate?.also { afterGate = null }?.let { return it.await() }
        if (failAfterWithInvalidSession) throw SessionInvalidException()
        serverMessages?.let { rows ->
            return page(*rows.sortedWith(compareBy({ it.createdAt }, { it.id })).filter {
                cursor == null || it.createdAt > cursor.createdAt || (it.createdAt == cursor.createdAt && it.id > cursor.id)
            }.take(50).toTypedArray())
        }
        return afterPage
    }

    override suspend fun before(token: String, cursor: MessageCursor?): MessagePage {
        beforeCursors += cursor
        beforeTokens += token
        beforeGate?.also { beforeGate = null }?.let { return it.await() }
        if (beforeFailures-- > 0) error("offline")
        serverMessages?.let { rows ->
            val items = rows.sortedWith(compareBy<ChatMessage>({ it.createdAt }, { it.id })).filter {
                cursor == null || it.createdAt < cursor.createdAt || (it.createdAt == cursor.createdAt && it.id < cursor.id)
            }.takeLast(50)
            return MessagePage(items, items.firstOrNull()?.let { MessageCursor(it.createdAt, it.id) })
        }
        return if (beforePages.isEmpty()) page() else beforePages.removeFirst()
    }

    override suspend fun send(
        token: String,
        clientMessageId: String,
        body: String,
        replyToMessageId: String?,
        image: ImageMessage?,
    ): ChatMessage {
        sentIds += clientMessageId
        sentBodies += body
        lastReplyToMessageId = replyToMessageId
        sendGate?.also { sendGate = null }?.let { return it.await() }
        if (sendCommitsThenFails) {
            serverMessages?.add(message("1001_$clientMessageId", body, "1001", "2026-08-06T00:03:00Z", clientMessageId))
            error("connection reset after the server committed the message")
        }
        if (sendFailures-- > 0) error("offline")
        val base = message("1001_$clientMessageId", body, "1001", "2026-08-06T00:03:00Z", clientMessageId)
        val withReply = if (replyToMessageId == null) base else base.copy(replyToMessageId = replyToMessageId)
        return if (image == null) {
            withReply
        } else {
            withReply.copy(type = "image", imageFileId = image.imageFileId, imageWidth = image.imageWidth, imageHeight = image.imageHeight)
        }
    }

    var lastUploadedCredential: ImageUploadCredential? = null
    val uploadedImages = mutableListOf<Pair<String, ByteArray>>()

    override suspend fun requestImageUploadCredential(
        token: String,
        clientMessageId: String,
        imageMimeType: String,
    ): ImageUploadCredential = ImageUploadCredential(
        uploadUrl = "https://upload.invalid/$clientMessageId",
        authorization = "auth-$clientMessageId",
        token = "token-$clientMessageId",
        cosFileId = "cos-$clientMessageId",
        key = "chat-images%2F1001_$clientMessageId.jpg",
        fileId = "cloud://env-bucket/chat-images/1001_$clientMessageId.jpg",
    )

    override suspend fun uploadImage(credential: ImageUploadCredential, bytes: ByteArray, contentType: String) {
        lastUploadedCredential = credential
        uploadedImages += credential.uploadUrl to bytes
    }

    override suspend fun imageUrl(token: String, imageFileId: String): String {
        imageUrlCalls += 1
        return "memory://$imageFileId"
    }

    override suspend fun login(accountId: String, password: String) = error("unused")
    override suspend fun logout(token: String) = Unit
    override suspend fun profiles(token: String): List<Profile> = error("unused")
    override suspend fun updateProfile(token: String, displayName: String): Profile = error("unused")
    override suspend fun updateAvatar(token: String, mimeType: String, base64: String): Profile = error("unused")
    override suspend fun changePassword(token: String, current: String, replacement: String): Session = error("unused")
    override suspend fun moments(token: String): List<MomentItem> = error("unused")
    override suspend fun createMoment(
        token: String,
        clientMomentId: String,
        body: String,
        visibility: MomentVisibility,
        image: ImageMessage?,
    ): MomentItem = error("unused")
    override suspend fun deleteMoment(token: String, momentId: String) = error("unused")
    override suspend fun likeMoment(token: String, momentId: String): MomentLike = error("unused")
    override suspend fun unlikeMoment(token: String, momentId: String) = error("unused")
    override suspend fun createMomentComment(
        token: String,
        momentId: String,
        clientCommentId: String,
        body: String,
        replyToCommentId: String?,
    ): MomentComment = error("unused")
    override suspend fun deleteMomentComment(token: String, commentId: String) = error("unused")
}

private class ChatTestCallGate<T> {
    val started = CompletableDeferred<Unit>()
    private val result = CompletableDeferred<Result<T>>()
    suspend fun await(): T {
        started.complete(Unit)
        return result.await().getOrThrow()
    }
    fun succeed(value: T) { result.complete(Result.success(value)) }
    fun fail(error: Throwable) { result.complete(Result.failure(error)) }
}

private val messageOrder = compareBy<MessageEntity>({ it.createdAt }, { it.id })

private fun entity(id: String, body: String, sender: String, createdAt: String) =
    MessageEntity(id, "couple", sender, if (sender == "1001") "1002" else "1001", id.substringAfter('_'), body, createdAt)

private fun message(
    id: String,
    body: String,
    sender: String,
    createdAt: String,
    clientId: String = id.substringAfter('_'),
) = ChatMessage(id, "couple", sender, if (sender == "1001") "1002" else "1001", clientId, body, createdAt)

private fun page(vararg messages: ChatMessage) = MessagePage(messages.toList(), messages.lastOrNull()?.let { MessageCursor(it.createdAt, it.id) })
