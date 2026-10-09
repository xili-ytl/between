package com.privatechat.couplechat.feature.moments

import java.io.File
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MomentActionContractTest {
    @Test
    fun menuToggleKeepsAtMostOneMomentOpen() {
        assertEquals("moment-1", toggledMomentActionMenu(null, "moment-1"))
        assertNull(toggledMomentActionMenu("moment-1", "moment-1"))
        assertEquals("moment-2", toggledMomentActionMenu("moment-1", "moment-2"))
    }

    @Test
    fun bundledIconIsTheRecordedCc0TwoDotAsset() {
        val vector = File("src/main/res/drawable/ic_dots_two_horizontal.xml").readText()
        val notice = File("../../THIRD_PARTY_NOTICES.md").readText()

        assertTrue(vector.contains("M14.001,7.8"))
        assertTrue(vector.contains("M6.001,7.8"))
        assertTrue(notice.contains("Dots Two Horizontal"))
        assertTrue(notice.contains("CC0"))
    }

    @Test
    fun actionStripIsAnAnchoredOverlayInsteadOfConsumingTheNarrowRow() {
        val card = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentCard.kt",
        ).readText()

        assertTrue(card.contains("Popup("))
        assertTrue(card.contains("anchorBounds.left - popupContentSize.width"))
    }

    @Test
    fun likeAndUnlikeActionUsesTheRecordedPhosphorHeartIcon() {
        val card = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentCard.kt",
        ).readText()
        val vector = File("src/main/res/drawable/phosphor_ic_heart.xml")
        val notice = File("../../THIRD_PARTY_NOTICES.md").readText()

        assertTrue(vector.isFile)
        assertTrue(card.contains("R.drawable.phosphor_ic_heart"))
        assertTrue(card.contains("tint = Color.White"))
        assertTrue(notice.contains("assets/regular/heart.svg"))
    }

    @Test
    fun likeSummaryShowsTheHeartBeforeTheNames() {
        val card = File(
            "src/main/java/com/privatechat/couplechat/feature/moments/MomentCard.kt",
        ).readText()
        val summaryStart = card.indexOf("if (likeNames.isNotEmpty())")
        val summaryEnd = card.indexOf(
            "if (likeNames.isNotEmpty() && visibleComments.isNotEmpty())",
            startIndex = summaryStart,
        )
        val summary = card.substring(summaryStart, summaryEnd)

        assertTrue(summary.contains("testTag(\"moment-like-summary\")"))
        assertTrue(summary.contains("R.drawable.phosphor_ic_heart"))
        assertTrue(summary.contains("tint = MomentBlue"))
    }
}
