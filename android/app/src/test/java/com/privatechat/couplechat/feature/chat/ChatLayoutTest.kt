package com.privatechat.couplechat.feature.chat

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatLayoutTest {
    @Test
    fun messageIndexIncludesEveryVisiblePrefixItem() {
        assertEquals(4, chatMessageItemIndex(4, showOfflineStatus = false, showOlderControl = false))
        assertEquals(5, chatMessageItemIndex(4, showOfflineStatus = true, showOlderControl = false))
        assertEquals(5, chatMessageItemIndex(4, showOfflineStatus = false, showOlderControl = true))
        assertEquals(6, chatMessageItemIndex(4, showOfflineStatus = true, showOlderControl = true))
    }

    @Test
    fun selectionOnlyEditKeepsTheCursorWithoutFiringInputChanged() {
        // 输入「大大笨蛋」后把光标点到第一个「大」之后，这里只有 selection 变化。
        val composer = ChatComposerTextFieldState(initialText = "大大笨蛋")

        val changed = composer.edit(TextFieldValue("大大笨蛋", selection = TextRange(1)))

        assertNull("移动光标不应产生输入回调", changed)
        assertEquals(TextRange(1), composer.value.value.selection)
    }

    @Test
    fun backspaceAfterPositioningTheCursorDeletesTheCharacterBeforeIt() {
        // 「大大笨蛋」→ 光标在第一个「大」之后 → 退格一次，应为「大笨蛋」。
        val composer = ChatComposerTextFieldState(initialText = "大大笨蛋")
        composer.edit(TextFieldValue("大大笨蛋", selection = TextRange(1)))

        // 这一步由框架根据当前 selection 计算：删除 [0,1) 得到新正文与光标 0。
        val changed = composer.edit(TextFieldValue("大笨蛋", selection = TextRange(0)))

        assertEquals("大笨蛋", changed)
        assertEquals("大笨蛋", composer.value.value.text)
        assertEquals(TextRange(0), composer.value.value.selection)
    }

    @Test
    fun rangeSelectionIsStoredAndReplacingItKeepsTheResultingCursor() {
        val composer = ChatComposerTextFieldState(initialText = "大大笨蛋")

        assertNull(composer.edit(TextFieldValue("大大笨蛋", selection = TextRange(0, 2))))
        assertEquals(TextRange(0, 2), composer.value.value.selection)

        assertEquals("笨蛋", composer.edit(TextFieldValue("笨蛋", selection = TextRange(0))))
        assertEquals(TextRange(0), composer.value.value.selection)
    }

    @Test
    fun typingAfterTappingTheMiddleInsertsThereInsteadOfAtTheEnd() {
        // 用户反馈的核心场景：根本没法把光标放到想要的位置。
        // 点到第一个「大」之后，再打字必须插在那个位置，而不是被弹回末尾追加。
        val composer = ChatComposerTextFieldState(initialText = "大大笨蛋")
        composer.edit(TextFieldValue("大大笨蛋", selection = TextRange(1)))

        val changed = composer.edit(
            TextFieldValue("大好大笨蛋", selection = TextRange(2)),
        )

        assertEquals("大好大笨蛋", changed)
        assertEquals("大好大笨蛋", composer.value.value.text)
        assertEquals(TextRange(2), composer.value.value.selection)
    }

    @Test
    fun selectionSurvivesRecompositionAndThenTypesOverTheRange() {
        val composer = ChatComposerTextFieldState(initialText = "大大笨蛋")
        composer.edit(TextFieldValue("大大笨蛋", selection = TextRange(0, 2)))

        // 收到消息引起的重组会带来一次外部回流，选区不能被清掉。
        composer.acceptExternal("大大笨蛋")
        assertEquals(TextRange(0, 2), composer.value.value.selection)

        // 选着一段直接打字 = 选区替换。
        assertEquals("笨蛋", composer.edit(TextFieldValue("笨蛋", selection = TextRange(0))))
    }

    @Test
    fun imeCompositionIsKeptWhileTyping() {
        val composer = ChatComposerTextFieldState(initialText = "")

        // 中文输入法的组合态：正文还是拼音，composition 指向正在组词的范围。
        val composing = TextFieldValue("da", selection = TextRange(2), composition = TextRange(0, 2))
        assertEquals("da", composer.edit(composing))
        assertEquals(TextRange(0, 2), composer.value.value.composition)
    }

    @Test
    fun externalDraftDoesNotMoveTheCursorWhenTheTextIsUnchanged() {
        val composer = ChatComposerTextFieldState(initialText = "你好")
        composer.edit(TextFieldValue("你好", selection = TextRange(1)))

        // 重组/回流带来的同一正文不应把光标弹回末尾。
        composer.acceptExternal("你好")

        assertEquals(TextRange(1), composer.value.value.selection)
    }

    @Test
    fun externalDraftIsAppliedWhenTheTextChanged() {
        val composer = ChatComposerTextFieldState(initialText = "你好")
        composer.edit(TextFieldValue("你好", selection = TextRange(1)))

        composer.acceptExternal("")

        assertEquals("", composer.value.value.text)
        assertEquals("", composer.text)
    }

    @Test
    fun mentionInsertionKeepsTheCursorAfterTheTrailingSpace() {
        val composer = ChatComposerTextFieldState(initialText = "@")

        val insertion = mentionInsertion("@")
        composer.acceptExternal(insertion.text, selection = TextRange(insertion.cursor))

        // 光标停在尾部空格之后，也不能被当成用户正文编辑。
        assertEquals("@小Q ", composer.value.value.text)
        assertEquals(TextRange(4), composer.value.value.selection)
        assertNull(composer.edit(TextFieldValue("@小Q ", selection = TextRange(4))))
    }

    @Test
    fun longPressInsertionHandlesEmptyMiddleSelectionAndCompositionState() {
        val empty = insertWenliMentionValue(TextFieldValue(""))
        assertEquals("@小Q ", empty.text)
        assertEquals(TextRange(4), empty.selection)

        val middle = insertWenliMentionValue(TextFieldValue("你好世界", selection = TextRange(2)))
        assertEquals("你好 @小Q 世界", middle.text)
        assertEquals(TextRange(7), middle.selection)

        val selected = insertWenliMentionValue(TextFieldValue("你好世界", selection = TextRange(1, 3)))
        assertEquals("你 @小Q 界", selected.text)
        assertEquals(TextRange(6), selected.selection)

        val composing = insertWenliMentionValue(
            TextFieldValue("da", selection = TextRange(2), composition = TextRange(0, 2)),
        )
        assertEquals("da @小Q ", composing.text)
        assertEquals(TextRange(7), composing.selection)
        assertEquals(null, composing.composition)
    }

    @Test
    fun longPressInsertionDoesNotDuplicateAnExistingMentionOrClearDraftState() {
        val current = TextFieldValue("保留 @小Q 草稿", selection = TextRange(2))

        val repeated = insertWenliMentionValue(current)

        assertEquals(current, repeated)
        assertEquals("保留 @小Q 草稿", repeated.text)
        assertTrue(isWenliMentionBody(repeated.text))
    }
}
