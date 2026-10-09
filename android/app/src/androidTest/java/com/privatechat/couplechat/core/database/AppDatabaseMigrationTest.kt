package com.privatechat.couplechat.core.database

import android.content.Context
import androidx.room.Room
import androidx.room.testing.MigrationTestHelper
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class AppDatabaseMigrationTest {
    @get:Rule
    val helper = MigrationTestHelper(
        InstrumentationRegistry.getInstrumentation(),
        AppDatabase::class.java,
    )

    @Test
    fun migrationFromOneToCurrentPreservesMessagesAndAddsTheOrderingIndex() = runTest {
        helper.createDatabase(DATABASE_NAME, 1).apply {
            execSQL(
                "INSERT INTO messages " +
                    "(id, relationshipId, senderId, recipientId, clientMessageId, body, createdAt) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                arrayOf("m1", "couple", "1001", "1002", "client-1", "kept", "2026-08-06T00:00:00Z"),
            )
            close()
        }

        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.databaseBuilder(context, AppDatabase::class.java, DATABASE_NAME)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4)
            .build()

        try {
            assertEquals(1, database.messageDao().count())
            database.openHelper.readableDatabase.query("PRAGMA index_list(`messages`)").use { cursor ->
                val nameColumn = cursor.getColumnIndexOrThrow("name")
                val names = buildSet {
                    while (cursor.moveToNext()) add(cursor.getString(nameColumn))
                }
                assertTrue("ordering index is missing", "index_messages_createdAt_id" in names)
            }
        } finally {
            database.close()
        }
    }

    @Test
    fun migrationFromTwoToCurrentPreservesMessagesAndBuildsSearchIndex() = runTest {
        helper.createDatabase(DATABASE_NAME, 2).apply {
            execSQL(
                "INSERT INTO messages " +
                    "(id, relationshipId, senderId, recipientId, clientMessageId, body, createdAt) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?)",
                arrayOf("m1", "couple", "1001", "1002", "client-1", "晚安", "2026-08-07T16:30:00.000Z"),
            )
            close()
        }

        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.databaseBuilder(context, AppDatabase::class.java, DATABASE_NAME)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4)
            .build()

        try {
            assertEquals(1, database.messageDao().count())
            assertEquals(listOf("m1"), database.messageDao().searchFts("\"晚安\"*").map { it.id })
            assertEquals(listOf("2026-08-08"), database.messageDao().messageDates())
        } finally {
            database.close()
        }
    }

    @Test
    fun migrationFromThreeToFourPreservesMessagesAndAddsImageColumns() = runTest {
        helper.createDatabase(DATABASE_NAME, 3).apply {
            execSQL(
                "INSERT INTO messages " +
                    "(id, relationshipId, senderId, recipientId, clientMessageId, body, createdAt, replyToMessageId, localDate) " +
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                arrayOf("m1", "couple", "1001", "1002", "client-1", "保留", "2026-08-07T16:30:00.000Z", null, "2026-08-08"),
            )
            close()
        }

        val context = ApplicationProvider.getApplicationContext<Context>()
        val database = Room.databaseBuilder(context, AppDatabase::class.java, DATABASE_NAME)
            .addMigrations(AppDatabase.MIGRATION_1_2, AppDatabase.MIGRATION_2_3, AppDatabase.MIGRATION_3_4)
            .build()

        try {
            val message = database.messageDao().newest()
            assertEquals("m1", message?.id)
            assertEquals("text", message?.type)
            assertNull(message?.imageFileId)
            assertEquals(1, database.messageDao().count())
        } finally {
            database.close()
        }
    }

    private companion object {
        const val DATABASE_NAME = "migration-test.db"
    }
}
