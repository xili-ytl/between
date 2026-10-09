package com.privatechat.couplechat.core.database

import androidx.room.Database
import androidx.room.RoomDatabase
import androidx.room.migration.Migration
import androidx.sqlite.db.SupportSQLiteDatabase

@Database(
    entities = [MessageEntity::class, MessageFtsEntity::class, RemarkEntity::class],
    version = 4,
    exportSchema = true,
)
abstract class AppDatabase : RoomDatabase() {
    abstract fun messageDao(): MessageDao
    abstract fun remarkDao(): RemarkDao

    companion object {
        val MIGRATION_1_2 = object : Migration(1, 2) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL(
                    "CREATE INDEX IF NOT EXISTS `index_messages_createdAt_id` " +
                        "ON `messages` (`createdAt`, `id`)",
                )
            }
        }

        val MIGRATION_2_3 = object : Migration(2, 3) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE `messages` ADD COLUMN `replyToMessageId` TEXT")
                database.execSQL("ALTER TABLE `messages` ADD COLUMN `localDate` TEXT NOT NULL DEFAULT ''")
                database.execSQL(
                    "UPDATE `messages` SET `localDate` = date(`createdAt`, '+8 hours')",
                )
                database.execSQL(
                    "CREATE VIRTUAL TABLE IF NOT EXISTS `message_fts` " +
                        "USING FTS4(`messageId` TEXT NOT NULL, `body` TEXT NOT NULL, tokenize=unicode61)",
                )
                database.execSQL(
                    "INSERT INTO `message_fts` (`rowid`, `messageId`, `body`) " +
                        "SELECT `rowid`, `id`, `body` FROM `messages`",
                )
                database.execSQL(
                    "CREATE TABLE IF NOT EXISTS `contact_remarks` (" +
                        "`ownerId` TEXT NOT NULL, `targetId` TEXT NOT NULL, `remark` TEXT NOT NULL, " +
                        "`updatedAt` TEXT NOT NULL, PRIMARY KEY(`ownerId`, `targetId`))",
                )
            }
        }

        val MIGRATION_3_4 = object : Migration(3, 4) {
            override fun migrate(database: SupportSQLiteDatabase) {
                database.execSQL("ALTER TABLE `messages` ADD COLUMN `type` TEXT NOT NULL DEFAULT 'text'")
                database.execSQL("ALTER TABLE `messages` ADD COLUMN `imageFileId` TEXT")
                database.execSQL("ALTER TABLE `messages` ADD COLUMN `imageMimeType` TEXT")
                database.execSQL("ALTER TABLE `messages` ADD COLUMN `imageWidth` INTEGER")
                database.execSQL("ALTER TABLE `messages` ADD COLUMN `imageHeight` INTEGER")
            }
        }
    }
}
