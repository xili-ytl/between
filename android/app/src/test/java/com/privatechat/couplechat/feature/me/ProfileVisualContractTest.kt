package com.privatechat.couplechat.feature.me

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileVisualContractTest {
    @Test
    fun profileAndSettingsRootScreensAreListsInsteadOfMaterialForms() {
        val profile = File(
            "src/main/java/com/privatechat/couplechat/feature/me/ProfileEditScreen.kt",
        ).readText()
        val settings = File(
            "src/main/java/com/privatechat/couplechat/feature/settings/SettingsScreen.kt",
        ).readText()
        val about = File(
            "src/main/java/com/privatechat/couplechat/feature/settings/AboutScreen.kt",
        ).readText()

        assertFalse(profile.contains("OutlinedTextField"))
        assertFalse(profile.contains("Button("))
        assertFalse(settings.contains("OutlinedTextField"))
        assertTrue(profile.contains("Text(\"头像\")"))
        assertTrue(profile.contains("Text(\"昵称\")"))
        assertTrue(profile.contains("Text(\"性别\")"))
        assertTrue(profile.contains("state.error?.let"))
        assertTrue(settings.contains("label = \"关于之间\""))
        assertTrue(settings.contains("tag = \"about-row\""))
        assertTrue(settings.contains("trailing = \"版本 \${BuildConfig.VERSION_NAME}\""))
        assertFalse(settings.contains("testTag(\"developer-row\")"))
        assertTrue(about.contains("BuildConfig.VERSION_NAME"))
        assertFalse(about.contains("BuildConfig.VERSION_CODE"))
        assertFalse(about.contains("buildPushDiagnostic"))
        assertFalse(about.contains("JPushInterface"))
        assertFalse(about.contains("PushRegistrar"))
        assertTrue(about.contains("世界之外，你我之间"))
        assertTrue(about.contains("由示例甲开发"))
        assertTrue(about.contains("数据由云端永久保存"))
        // 关于页不再有列表行/容器，改为一句话说明 + 底部低调署名
        assertFalse(about.contains("AboutInfoRow"))
        assertFalse(about.contains("HorizontalDivider"))
        assertFalse(about.contains("©"))
        assertFalse(about.contains("WeUiDisclosureIcon"))
    }

    @Test
    fun meProfileHeaderIsTheOnlyProfileEntry() {
        val me = File(
            "src/main/java/com/privatechat/couplechat/feature/me/MeScreen.kt",
        ).readText()

        assertTrue(me.contains("testTag(\"me-profile-row\")"))
        assertFalse(me.contains("Text(\"个人资料\")"))
    }
}
