package com.privatechat.couplechat.feature.moments

import com.privatechat.couplechat.core.model.MomentComment
import org.junit.Assert.assertEquals
import org.junit.Test

class MomentCommentCollapseTest {
    private fun comment(id: String, body: String) = MomentComment(
        id = id,
        momentId = "m1",
        authorId = "1001",
        clientCommentId = id,
        body = body,
        createdAt = "2026-08-08T00:00:00Z",
    )

    @Test
    fun estimatesLinesByCharacterCount() {
        assertEquals(1, estimatedCommentLines("短"))
        assertEquals(2, estimatedCommentLines("长".repeat(23)))
        assertEquals(3, estimatedCommentLines("长".repeat(45)))
    }

    @Test
    fun allCommentsShownWhenWithinBudget() {
        val comments = List(3) { comment("c$it", "hi") }
        val shown = collapsedCommentSelection(comments, 6) { 1 }
        assertEquals(comments, shown)
    }

    @Test
    fun exactlyAtBudgetIsNotCollapsed() {
        val comments = List(3) { comment("c$it", "hi") }
        val shown = collapsedCommentSelection(comments, 3) { 1 }
        assertEquals(comments, shown)
    }

    @Test
    fun keepsNewestWithinBudgetAndDropsOlder() {
        val comments = List(6) { comment("c$it", "hi") }
        val shown = collapsedCommentSelection(comments, 3) { 1 }
        assertEquals(listOf("c3", "c4", "c5"), shown.map { it.id })
    }

    @Test
    fun singleLongCommentStillShownEvenIfOverBudget() {
        val comments = listOf(comment("old", "hi"), comment("new-long", "长".repeat(50)))
        val shown = collapsedCommentSelection(comments, 3) { estimatedCommentLines(it.body) }
        assertEquals(listOf("new-long"), shown.map { it.id })
    }

    @Test
    fun emptyCommentsReturnEmpty() {
        assertEquals(emptyList<MomentComment>(), collapsedCommentSelection(emptyList(), 6) { 1 })
    }
}
