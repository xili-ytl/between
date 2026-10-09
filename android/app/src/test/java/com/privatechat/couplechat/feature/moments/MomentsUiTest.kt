package com.privatechat.couplechat.feature.moments

import com.privatechat.couplechat.core.model.Profile
import java.io.File
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MomentsUiTest {
    private val own = profile("1001", "示例乙")
    private val partner = profile("1002", "示例甲")

    @Test
    fun resolvesOnlyTheTwoSuppliedProfilesWithoutLeakingUnknownIds() {
        assertEquals("示例乙", momentProfile("1001", own, partner)?.displayName)
        assertEquals("示例甲", momentProfile("1002", own, partner)?.displayName)
        assertNull(momentProfile("raw-account-id", own, partner))
    }

    @Test
    fun ownershipRulesAllowOnlyTheSignedInAuthorsOwnContentToBeDeleted() {
        assertTrue(canDeleteMoment("1001", own))
        assertFalse(canDeleteMoment("1002", own))
        assertTrue(canDeleteComment("1001", own))
        assertFalse(canDeleteComment("1002", own))
    }

    @Test
    fun compactTimeNeverFallsBackToAnAccountOrVerboseHelper() {
        val expected = DateTimeFormatter.ofPattern("MM-dd HH:mm")
            .withZone(ZoneId.systemDefault())
            .format(Instant.parse("2026-08-07T08:09:10Z"))
        assertEquals(expected, compactMomentTime("2026-08-07T08:09:10Z"))
        assertEquals("", compactMomentTime("not-a-time"))
    }

    @Test
    fun feedSourceSeparatesInitialLoadingFromTheApprovedEmptyState() {
        val source = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentsScreen.kt",
        ).readText()

        assertTrue(source.contains("CircularProgressIndicator"))
        assertTrue(source.contains(".testTag(\"moments-loading\")"))
        assertTrue(source.contains("MomentsLoadState.FAILED"))
        assertTrue(source.contains("Text(\"加载失败\")"))
        assertTrue(source.contains("Text(\"重试\")"))
        assertFalse(source.contains("暂无动态"))
        assertTrue(source.contains("Text(\"还没有动态\")"))
    }

    @Test
    fun composerKeepsDraftAndVisibilityEditableWhilePublishIsInFlight() {
        val source = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentComposerScreen.kt",
        ).readText()

        assertEquals(1, Regex("enabled = !publishing").findAll(source).count())
    }

    @Test
    fun momentsAccessibilityAndRestorationContractsStayExplicit() {
        val screen = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentsScreen.kt",
        ).readText()
        val card = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentCard.kt",
        ).readText()
        val composer = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentComposerScreen.kt",
        ).readText()

        assertTrue(screen.contains("rememberSaveable"))
        assertFalse(card.contains("OutlinedTextField"))
        assertTrue(card.contains("contentDescription = \"赞和评论\""))
        assertTrue(card.contains("contentDescription = \"评论内容\""))
        assertTrue(card.contains("focusRequester.requestFocus()"))
        assertTrue(card.contains("keyboardController?.show()"))
        assertTrue(screen.contains("imePadding()"))
        assertTrue(card.contains("key(comment.id)"))
        assertTrue(composer.contains(".selectable("))
        assertTrue(composer.contains("onClick = null"))
        assertTrue(composer.contains("contentDescription = \"动态内容\""))
    }

    @Test
    fun rejectedPublishDoesNotForgetAnExistingExpectedCompletion() {
        val composer = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentComposerScreen.kt",
        ).readText()

        assertTrue(composer.contains("onPublish()?.let { expectedPublishId = it }"))
        assertFalse(composer.contains("expectedPublishId = onPublish()"))
    }

    private fun profile(id: String, name: String) = Profile(
        accountId = id,
        displayName = name,
        gender = "",
        updatedAt = "2026-08-07T00:00:00Z",
    )
}
