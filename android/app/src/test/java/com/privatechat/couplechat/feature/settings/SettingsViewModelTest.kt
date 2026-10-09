@file:OptIn(kotlinx.coroutines.ExperimentalCoroutinesApi::class)

package com.privatechat.couplechat.feature.settings

import com.privatechat.couplechat.MainDispatcherRule
import com.privatechat.couplechat.core.data.ProfileDataSource
import com.privatechat.couplechat.core.data.ProfileLoadState
import com.privatechat.couplechat.core.model.Profile
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class SettingsViewModelTest {
    @get:Rule
    val main = MainDispatcherRule()

    @Test
    fun updatesOnlyTheSignedInUsersDisplayName() = runTest(main.dispatcher) {
        val source = FakeProfileDataSource()
        val viewModel = SettingsViewModel("1001", source)
        advanceUntilIdle()

        viewModel.setDisplayName("  小猫  ")
        viewModel.saveDisplayName()
        advanceUntilIdle()

        assertEquals(listOf("小猫"), source.savedNames)
        assertEquals("男", source.profiles.value.single { it.accountId == "1002" }.displayName)
    }

    @Test
    fun validatesNameAndPasswordBeforeNetworkRequest() = runTest(main.dispatcher) {
        val source = FakeProfileDataSource()
        val viewModel = SettingsViewModel("1001", source)
        advanceUntilIdle()

        viewModel.setDisplayName("")
        viewModel.saveDisplayName()
        assertEquals("用户名需为 1 到 30 个字符", viewModel.state.value.error)

        viewModel.setCurrentPassword("1013")
        viewModel.setNewPassword("123")
        viewModel.changePassword()
        assertEquals("新密码至少需要 4 个字符", viewModel.state.value.error)
        assertTrue(source.passwordChanges.isEmpty())
    }

    @Test
    fun passwordChangeClearsFieldsAndLogoutIsAvailable() = runTest(main.dispatcher) {
        val source = FakeProfileDataSource()
        val viewModel = SettingsViewModel("1001", source)
        advanceUntilIdle()
        viewModel.setCurrentPassword("1013")
        viewModel.setNewPassword("new-password")

        viewModel.changePassword()
        advanceUntilIdle()
        assertEquals(listOf("1013" to "new-password"), source.passwordChanges)
        assertEquals("", viewModel.state.value.currentPassword)
        assertEquals("", viewModel.state.value.newPassword)

        viewModel.logout()
        advanceUntilIdle()
        assertTrue(source.loggedOut)
        assertFalse(viewModel.state.value.busy)
    }

    @Test
    fun uploadsProcessedAvatarPayload() = runTest(main.dispatcher) {
        val source = FakeProfileDataSource()
        val viewModel = SettingsViewModel("1001", source)
        advanceUntilIdle()

        viewModel.uploadAvatar("image/jpeg", "encoded")
        advanceUntilIdle()

        assertEquals(listOf("image/jpeg" to "encoded"), source.avatars)
    }

    @Test
    fun clearsFeedbackWhenOpeningAnotherSettingsFlow() = runTest(main.dispatcher) {
        val viewModel = SettingsViewModel("1001", FakeProfileDataSource())
        advanceUntilIdle()

        viewModel.showAvatarError("头像处理失败")
        viewModel.clearFeedback()

        assertEquals(null, viewModel.state.value.error)
        assertEquals(null, viewModel.state.value.message)
    }

    @Test
    fun cleanDisplayNameDraftTracksEveryFreshProfile() = runTest(main.dispatcher) {
        val source = FakeProfileDataSource()
        val viewModel = SettingsViewModel("1001", source)
        advanceUntilIdle()

        source.emitOwnDisplayName("示例乙")
        advanceUntilIdle()

        assertEquals("示例乙", viewModel.state.value.displayName)
    }

    @Test
    fun dirtyDisplayNameDraftIsNotOverwrittenByFreshProfiles() = runTest(main.dispatcher) {
        val source = FakeProfileDataSource()
        val viewModel = SettingsViewModel("1001", source)
        advanceUntilIdle()
        viewModel.setDisplayName("正在编辑")

        source.emitOwnDisplayName("示例乙")
        advanceUntilIdle()

        assertEquals("正在编辑", viewModel.state.value.displayName)
    }

    @Test
    fun successfulSaveMakesUnchangedDraftCleanAgain() = runTest(main.dispatcher) {
        val source = FakeProfileDataSource()
        val viewModel = SettingsViewModel("1001", source)
        advanceUntilIdle()
        viewModel.setDisplayName("新名字")

        viewModel.saveDisplayName()
        advanceUntilIdle()
        source.emitOwnDisplayName("云端新名字")
        advanceUntilIdle()

        assertEquals("云端新名字", viewModel.state.value.displayName)
    }
}

private class FakeProfileDataSource : ProfileDataSource {
    private val mutableProfiles = MutableStateFlow(
        listOf(
            Profile("1001", "女", "女", null, "2026-08-06T00:00:00Z"),
            Profile("1002", "男", "男", null, "2026-08-06T00:00:00Z"),
        )
    )
    override val profiles: StateFlow<List<Profile>> = mutableProfiles
    override val loadState: StateFlow<ProfileLoadState> = MutableStateFlow(ProfileLoadState.READY)
    val savedNames = mutableListOf<String>()
    val passwordChanges = mutableListOf<Pair<String, String>>()
    val avatars = mutableListOf<Pair<String, String>>()
    var loggedOut = false

    fun emitOwnDisplayName(displayName: String) {
        mutableProfiles.value = mutableProfiles.value.map {
            if (it.accountId == "1001") it.copy(displayName = displayName) else it
        }
    }

    override suspend fun refresh() = Unit

    override suspend fun updateDisplayName(displayName: String) {
        savedNames += displayName
        mutableProfiles.value = mutableProfiles.value.map {
            if (it.accountId == "1001") it.copy(displayName = displayName) else it
        }
    }

    override suspend fun changePassword(current: String, replacement: String) {
        passwordChanges += current to replacement
    }

    override suspend fun updateAvatar(mimeType: String, base64: String) {
        avatars += mimeType to base64
    }

    override suspend fun logout() {
        loggedOut = true
    }
}
