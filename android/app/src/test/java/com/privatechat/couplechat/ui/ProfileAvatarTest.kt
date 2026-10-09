package com.privatechat.couplechat.ui

import com.privatechat.couplechat.core.model.Profile
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileAvatarTest {
    @Test
    fun missingOrFailedImageUsesTheProfileInitial() {
        assertTrue(profileAvatarShowsInitial(null, loadFailed = false))
        assertTrue(profileAvatarShowsInitial("", loadFailed = false))
        assertFalse(profileAvatarShowsInitial("https://example.test/avatar.jpg", loadFailed = false))
        assertTrue(profileAvatarShowsInitial("https://example.test/avatar.jpg", loadFailed = true))
    }

    @Test
    fun cacheKeyTracksTheProfileRevisionRatherThanTheTemporaryUrl() {
        val original = profile(updatedAt = "2026-08-08T00:00:00Z", avatarUrl = "https://img.test/a.jpg?token=old")
        val sameRevisionNewUrl = profile(updatedAt = original.updatedAt, avatarUrl = "https://img.test/a.jpg?token=new")
        val replacement = profile(updatedAt = original.updatedAt, avatarUrl = "https://img.test/b.jpg?token=new")

        assertEquals(profileAvatarCacheKey(original), profileAvatarCacheKey(sameRevisionNewUrl))
        assertNotEquals(profileAvatarCacheKey(original), profileAvatarCacheKey(replacement))
    }

    private fun profile(updatedAt: String, avatarUrl: String?) = Profile(
        accountId = "1001",
        displayName = "示例乙",
        gender = "女",
        avatarUrl = avatarUrl,
        updatedAt = updatedAt,
    )
}
