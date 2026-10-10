package com.privatechat.couplechat.core.database

import android.content.Context
import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MessageDaoTest {
    private lateinit var database: AppDatabase
    private lateinit var dao: MessageDao

    @Before
    fun createDatabase() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        database = Room.inMemoryDatabaseBuilder(context, AppDatabase::class.java).allowMainThreadQueries().build()
        dao = database.messageDao()
    }

    @After
    fun closeDatabase() = database.close()

    @Test
    fun wenliCountsForBothAccountsAndUsesTheSameExclusiveCursor() = runTest {
        val time = "2026-08-31T00:00:00.000Z"
        dao.insertAll(listOf(
            row("1001_a", "自己或伴侣", time),
            row("1002_a", "伴侣或自己", time).copy(senderId = "1002", recipientId = "1001"),
            row("wenli_a", "小Q一", time).copy(senderId = "wenli", recipientId = "1001"),
            row("wenli_b", "小Q二", time).copy(senderId = "wenli", recipientId = "1002"),
            row("other_wenli", "其他关系", time).copy(senderId = "wenli", relationshipId = "other"),
        ))
        for (partner in listOf("1001", "1002")) {
            assertEquals(3, dao.observeUnreadCount(partner, "", "").first())
            assertEquals(1, dao.observeUnreadCount(partner, time, "wenli_a").first())
            assertEquals(0, dao.observeUnreadCount(partner, time, "wenli_b").first())
        }
    }

    @Test
    fun ordersMessagesAndNeverOverwritesAnExistingId() = runTest {
        dao.insertAll(
            listOf(
                row("m2", "后", "2026-08-06T00:02:00Z"),
                row("m1", "前", "2026-08-06T00:01:00Z"),
            )
        )
        dao.insertAll(listOf(row("m1", "不能覆盖", "2026-08-06T00:03:00Z")))

        assertEquals(listOf("前", "后"), dao.observeLatest(50).first().map { it.body })
    }
}

private fun row(id: String, body: String, createdAt: String) =
    MessageEntity(id, "couple", "1001", "1002", id, body, createdAt)
