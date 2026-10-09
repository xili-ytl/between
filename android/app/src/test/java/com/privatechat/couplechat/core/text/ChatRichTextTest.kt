package com.privatechat.couplechat.core.text

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatRichTextTest {
    @Test
    fun normalizesSupportedLatexDelimitersOutsideCodeAndPreservesMoney() {
        val plan = prepareChatMarkdown(
            """总价 ${'$'}5，公式 ${'$'}x^2${'$'}，\(a+b\)，\[
                \sum_{i=1}^n i
                \]
                ```text
                ${'$'}x${'$'}
                ```""".trimIndent(),
        )

        assertFalse(plan.fallbackToRaw)
        assertNotNull(plan.markdown)
        val markdown = plan.markdown!!
        assertTrue(markdown.contains("""总价 ${'$'}5"""))
        assertTrue(markdown.contains("""${'$'}${'$'}x^2${'$'}${'$'}"""))
        assertTrue(markdown.contains("""${'$'}${'$'}a+b${'$'}${'$'}"""))
        val normalizedBlock = """
${'$'}${'$'}
\sum_{i=1}^n i
${'$'}${'$'}""".trimIndent()
        assertTrue(markdown.contains(normalizedBlock))
        assertTrue(markdown.contains("```text"))
        assertTrue(markdown.contains("${'$'}x${'$'}"))
    }

    @Test
    fun escapedDollarAndInlineCodeAreNotFormulas() {
        val source = """价格是 \${'$'}5，字面量 `${'$'}x${'$'}`，转义 \${'$'}x\${'$'}"""
        val plan = prepareChatMarkdown(source)

        assertFalse(plan.fallbackToRaw)
        assertEquals(source, plan.markdown)
    }

    @Test
    fun unclosedFormulaFallsBackToRawWithoutBlankingMessage() {
        val plan = prepareChatMarkdown("请看 ${'$'}x^2 和后面的说明")

        assertTrue(plan.fallbackToRaw)
        assertNull(plan.markdown)
    }

    @Test
    fun unknownFormulaCommandFallsBackToRaw() {
        val source = "未知公式 ${'$'}\\notACommand{x}${'$'}"
        val plan = prepareChatMarkdown(source)

        assertTrue(plan.fallbackToRaw)
        assertNull(plan.markdown)
    }

    @Test
    fun keepsRequiredFractionPowersSumAndMatrixFormulaContent() {
        val source = "${'$'}\\frac{a_1}{b^2}${'$'} ${'$'}\\sum_{i=1}^n i${'$'} \\[\\begin{matrix}1 & 0 \\\\ 0 & 1\\end{matrix}\\]"
        val plan = prepareChatMarkdown(source)

        assertFalse(plan.fallbackToRaw)
        assertTrue(plan.markdown.orEmpty().contains("\\frac{a_1}{b^2}"))
        assertTrue(plan.markdown.orEmpty().contains("\\sum_{i=1}^n i"))
        assertTrue(plan.markdown.orEmpty().contains("\\begin{matrix}"))
    }

    @Test
    fun recognizesEachMarkdownHeadingLevelWithIndependentInputsAndRealNewlines() {
        (1..6).forEach { level ->
            val source = "#".repeat(level) + " 标题$level\n正文"
            val plan = prepareChatMarkdown(source)

            assertFalse("heading level $level", plan.fallbackToRaw)
            assertEquals(source, plan.markdown)
        }
    }

    @Test
    fun recognizesEachItalicMarkdownSyntaxWithIndependentInputsAndRealNewlines() {
        listOf("*斜体*", "_另一种斜体_").forEach { syntax ->
            val source = "$syntax\n正文"
            val plan = prepareChatMarkdown(source)

            assertFalse(syntax, plan.fallbackToRaw)
            assertEquals(source, plan.markdown)
        }
    }

    @Test
    fun markdownPlanMarksCodeAndTablesAsHorizontallyScrollable() {
        val code = prepareChatMarkdown("开头说明\n\n```kotlin\nval veryLongName = 1\n```\n\n结尾说明")
        val table = prepareChatMarkdown("开头说明\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n\n结尾说明")

        assertTrue(code.markdown != null)
        assertTrue(code.requiresHorizontalScroll)
        assertEquals(listOf(false, true, false), code.segments.map(ChatMarkdownSegment::requiresHorizontalScroll))
        assertEquals("开头说明", code.segments.first().markdown.trim())
        assertEquals("结尾说明", code.segments.last().markdown.trim())
        assertTrue(table.markdown != null)
        assertTrue(table.requiresHorizontalScroll)
        assertEquals(listOf(false, true, false), table.segments.map(ChatMarkdownSegment::requiresHorizontalScroll))
        assertEquals("开头说明", table.segments.first().markdown.trim())
        assertEquals("结尾说明", table.segments.last().markdown.trim())
    }

    @Test
    fun nestedQuotedCodeBlockIsolatedWithoutChangingSegmentOrder() {
        val plan = prepareChatMarkdown(
            "- 列表开头\n\n> 引用说明\n>\n> ```text\n> 很长的代码内容\n> ```\n\n列表结尾",
        )

        assertEquals(listOf(false, true, false), plan.segments.map(ChatMarkdownSegment::requiresHorizontalScroll))
        assertTrue(plan.segments[0].markdown.contains("列表开头"))
        assertTrue(plan.segments[1].markdown.contains("很长的代码内容"))
        assertTrue(plan.segments[2].markdown.contains("列表结尾"))
    }

    @Test
    fun malformedGeneratedFenceIsRepairedWithoutChangingStoredRawMessage() {
        val source = "说明\n\n```text\nresult = I\n```n\n\n后续正文"

        val plan = prepareChatMarkdown(source, repairMalformedGeneratedFences = true)

        assertFalse(plan.fallbackToRaw)
        assertEquals("说明\n\n```text\nresult = I\n```\n\n后续正文", plan.markdown)
        assertEquals(listOf(false, true, false), plan.segments.map(ChatMarkdownSegment::requiresHorizontalScroll))
    }

    @Test
    fun malformedGeneratedFenceBeforeSecondCodeBlockKeepsProseOutsideBothBlocks() {
        val source = "思路：\n\n```text\nresult = I\n```n\n关键点是结合律。\n\n再看例子：\n\n```text\n| F(n+1) F(n) |\n```"

        val plan = prepareChatMarkdown(source, repairMalformedGeneratedFences = true)

        assertFalse(plan.fallbackToRaw)
        assertEquals(listOf(false, true, false, true), plan.segments.map(ChatMarkdownSegment::requiresHorizontalScroll))
        assertTrue(plan.segments[2].markdown.contains("关键点是结合律。"))
        assertTrue(plan.segments[3].markdown.contains("F(n+1)"))
    }

    @Test
    fun malformedGeneratedFenceBeforeUnlabeledSecondCodeBlockKeepsProseOutside() {
        val source = "```text\nresult = I\n```n\n关键点是结合律。\n\n再看矩阵：\n\n```\n| F(n+1) F(n) |\n```"

        val plan = prepareChatMarkdown(source, repairMalformedGeneratedFences = true)

        assertFalse(plan.fallbackToRaw)
        assertEquals(listOf(true, false, true), plan.segments.map(ChatMarkdownSegment::requiresHorizontalScroll))
        assertTrue(plan.segments[1].markdown.contains("关键点是结合律。"))
    }

    @Test
    fun commonMarkClosingFenceRejectsTrailingTextWhenRepairIsDisabled() {
        val source = "说明\n\n```text\nresult = I\n```n\n\n后续正文"

        val plan = prepareChatMarkdown(source)

        assertFalse(plan.fallbackToRaw)
        assertEquals(source, plan.markdown)
        assertEquals(listOf(false, true), plan.segments.map(ChatMarkdownSegment::requiresHorizontalScroll))
        assertTrue(plan.segments.last().markdown.contains("后续正文"))
    }

    @Test
    fun htmlAndImagesUseRawFallbackAndPlainTextUsesLowCostPath() {
        val html = prepareChatMarkdown("hello <b>world</b>")
        val image = prepareChatMarkdown("![remote](https://example.com/a.png)")
        val plain = prepareChatMarkdown("普通短消息\n第二行")

        assertTrue(html.fallbackToRaw)
        assertTrue(image.fallbackToRaw)
        assertFalse(plain.fallbackToRaw)
        assertNull(plain.markdown)
    }
}
