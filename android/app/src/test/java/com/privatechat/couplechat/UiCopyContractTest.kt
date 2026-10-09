package com.privatechat.couplechat

import java.io.File
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UiCopyContractTest {
    @Test
    fun settingsUsesOnlyTheExactNewPasswordLabel() {
        val editor = source("feature/settings/PasswordEditScreen.kt")
        val settingsRoot = source("feature/settings/SettingsScreen.kt")

        assertTrue(editor.contains("label = \"\u65b0\u5bc6\u7801\""))
        assertFalse(editor.contains("\u81f3\u5c11 4 \u4e2a\u5b57\u7b26"))
        assertFalse(settingsRoot.contains("\u5f53\u524d\u5bc6\u7801"))
        assertFalse(settingsRoot.contains("\u65b0\u5bc6\u7801"))
        val about = source("feature/settings/AboutScreen.kt")
        assertFalse(settingsRoot.contains("数据由云端永久保存"))
        assertTrue(about.contains("数据由云端永久保存"))
        assertFalse(settingsRoot.contains("你们的聊天记录"))
    }

    @Test
    fun enteringScreenShowsTheIconAndTaglineInsteadOfASpinner() {
        val source = source("AppNavHost.kt")
        val brand = source("ui/BrandIdentity.kt")

        assertTrue(brand.contains("testTag(\"entering-between\")"))
        assertTrue(brand.contains("世界之外，\\n你我之间。"))
        assertTrue(brand.contains("Beyond the World, Between You and Me."))
        assertTrue(brand.contains("R.drawable.ic_launcher_foreground"))
        assertTrue(brand.contains("iconSize: Dp = 80.dp"))
        assertTrue(brand.contains("restoreFailed"))
        assertTrue(brand.contains("暂时无法完成加载"))
        assertTrue(brand.contains("TextButton"))
        // 等待恢复会话期间不再转圈
        assertFalse(source.contains("if (!loaded) {\n        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {"))
        // 资料准备也属于同一品牌入口；资料未齐不能再落到第二个全屏转圈。
        assertTrue(source.contains("prepare ="))
        assertTrue(source.contains("prepareForEntry"))
        assertTrue(source.contains("remember(container, session)"))
        assertTrue(source.contains("restoreFailed = true"))
        assertFalse(source.contains("CircularProgressIndicator"))
        assertFalse(source.contains("profileLoadState"))
    }

    @Test
    fun loginReusesTheBrandLockupAndKeepsTheFormAccessible() {
        val login = source("feature/login/LoginScreen.kt")

        assertTrue(login.contains("BetweenBrand("))
        assertTrue(login.contains("iconSize = 64.dp"))
        // Spacing is a visual design choice, not an accessibility contract.
        assertTrue(login.contains("verticalScroll(rememberScrollState())"))
        assertTrue(login.contains("imePadding()"))
        assertTrue(login.contains("RoundedCornerShape(12.dp)"))
        assertTrue(login.contains("heightIn(min = 56.dp)"))
        assertTrue(login.contains("heightIn(min = 52.dp)"))
        assertFalse(login.contains("Text(\"之间\""))
    }

    @Test
    fun chatRequiresARealPartnerWithoutPlaceholderCopy() {
        val source = source("feature/chat/ChatScreen.kt")

        assertTrue(source.contains("partner: Profile,"))
        assertTrue(source.contains("ownProfile: Profile,"))
        assertFalse(source.contains("partner: Profile?"))
        assertFalse(source.contains("\"对方\""))
        assertFalse(source.contains("\"♡\""))
    }

    @Test
    fun navigationIconsDoNotDuplicateTheirVisibleLabelsForScreenReaders() {
        val source = source("feature/home/HomeScreen.kt")

        assertFalse(source.contains("contentDescription = tab.label"))
        assertTrue(source.contains("contentDescription = null"))
    }

    @Test
    fun chatUsesSingleOwnerImeInsetsAndAutomaticHistoryLoading() {
        val source = source("feature/chat/ChatScreen.kt")

        assertTrue(source.contains("BasicTextField("))
        assertTrue(source.contains("val displayedTimeline = remember(timeline) { timeline.asReversed() }"))
        assertTrue(source.contains("reverseLayout = true"))
        assertFalse(source.contains("exclude(WindowInsets.navigationBars)"))
        assertFalse(source.contains("exclude(WindowInsets.ime)"))
        assertTrue(source.contains(".padding(padding)\n                .imePadding(),"))
        assertTrue(source.contains("Modifier.navigationBarsPadding()"))
        assertFalse(source.contains("Modifier.navigationBarsPadding().imePadding()"))
        assertTrue(source.contains("if (keyboardVisible && displayedTimeline.isNotEmpty())"))
        assertFalse(source.contains("keyboardVisible && listState.isNearNewest()"))
        assertTrue(source.contains("listState.scrollToItem(0)"))
        assertFalse(source.contains("listState.scrollToItem(timeline.lastIndex)"))
        assertTrue(source.contains("firstVisibleItemIndex + layoutInfo.visibleItemsInfo.size >="))
        assertTrue(source.contains("val isNewLatest = latestId != previousLatestId"))
        assertTrue(source.contains("val latestFromMe = isNewLatest &&"))
        assertTrue(source.contains("!listState.isScrollInProgress && listState.isNearNewest()"))
        assertTrue(source.contains("listState.isScrollInProgress &&\n                state.messages.isNotEmpty()"))
        assertTrue(source.contains("state.hasMoreHistory"))
        // The main composer stays compact; the separate image preview has its own field.
        assertFalse(source.substringBefore("private fun PendingImageDialog(").contains("OutlinedTextField("))
        assertFalse(source.contains("bottomBar ="))
        assertFalse(source.contains("加载更早消息"))
    }

    @Test
    fun notificationDeliveryDoesNotObserveTheHistoricalChatList() {
        val navigation = source("AppNavHost.kt")

        assertFalse(navigation.contains("MessageNotifier"))
        assertFalse(navigation.contains("LaunchedEffect(chatState.messages"))
    }

    @Test
    fun chatComposerStoresTheWholeInputValueIncludingSelection() {
        val source = source("feature/chat/ChatScreen.kt")
        val holder = source("feature/chat/ChatComposerTextField.kt")

        // 输入框整份保存：正文、光标、选区、输入法组合态都属于同一次编辑事件。
        assertTrue(source.contains("composer.edit(value)"))
        assertTrue(source.contains("val textField = composer.value.value"))
        // 旧写法只在正文变化时保存，纯移动光标/拖动选区会丢，光标被弹回旧位置。
        assertFalse(source.contains("if (value.text != textField.text) textField = value"))
        assertFalse(holder.contains("if (value.text != textField.text)"))

        // 正文没变时不得产生业务输入回调，也不得把光标弹回末尾。
        assertTrue(holder.contains("if (next.text == text) return null"))
        assertTrue(holder.contains("val nextSelection = selection ?: current.selection"))
    }

    private fun source(relative: String): String {
        val file = File("src/main/java/com/privatechat/couplechat/$relative")
        assertTrue("Missing source file: ${file.absolutePath}", file.isFile)
        return file.readText().replace("\r\n", "\n")
    }
}
