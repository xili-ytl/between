package com.privatechat.couplechat.feature.chat

import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

/**
 * 问理召唤（@ 提及）的唯一判定与插入规则。
 *
 * 前后都必须是 token 边界；**`@问理` 后面必须有空格、标点或直接结束**。
 * 所以插入时必须自带尾部空格，否则 `@问理在吗` 这类正文不会被识别。
 */

/** 问理在「之间」里的固定显示名，同时用作 @ 提及的候选文字。 */
const val WENLI_DISPLAY_NAME = "问理"

/** 弹窗插入的完整提及文本：自带一个空格，保证后端正则命中。 */
const val WENLI_MENTION_INSERT = "@$WENLI_DISPLAY_NAME "

private const val WENLI_MENTION_TOKEN = "@$WENLI_DISPLAY_NAME"
private val WENLI_MENTION = Regex("(?:^|[\\s，,：:])$WENLI_MENTION_TOKEN(?=$|[\\s，,：:])")

/** 正文是否显式召唤了问理（与后端判定保持一致）。 */
fun isWenliMentionBody(body: String): Boolean = WENLI_MENTION.containsMatchIn(body)

/**
 * 输入框里是否该弹出问理候选。
 * 只在**开头**打 `@`（以及继续补 `问`、`理`）时提示，避免在正文中间误弹。
 */
fun shouldOfferWenliCandidate(input: String): Boolean {
    val text = input.trimStart()
    if (text.isEmpty() || text.first() != '@' || text.contains(' ')) return false
    // 已经打完整提及（含尾空格）就不再提示
    if (text.startsWith(WENLI_MENTION_INSERT)) return false
    return WENLI_MENTION_INSERT.startsWith(text)
}

/**
 * 把用户已经打出的那截 `@` / `@问` / `@问理` 替换成完整提及，而不是再追加一遍。
 * 传进来的 input 应当以 `@` 结尾。
 */
fun insertWenliMention(input: String): String = mentionInsertion(input).text

/**
 * 插入提及并把光标放到**尾部空格之后**，这样用户可以立刻继续打字。
 *
 * 只返回文本是不够的：`BasicTextField` 接收纯 `String` 时无法指定光标，
 * 框架会把光标留在 `@` 之后，用户就得手动挪一次。所以这里同时给出目标光标位置。
 */
fun mentionInsertion(input: String): MentionInsertion {
    // 两端都 trim：与发送时的 body.trim() 及后端的 trimStart() 保持一致
    val base = input.trim()
    val prefix = when {
        base.endsWith("@$WENLI_DISPLAY_NAME") -> base.dropLast(WENLI_DISPLAY_NAME.length + 1)
        base.endsWith("@问") -> base.dropLast(2)
        base.endsWith("@") -> base.dropLast(1)
        else -> base
    }
    val text = prefix + WENLI_MENTION_INSERT
    return MentionInsertion(text, text.length)
}

data class MentionInsertion(val text: String, val cursor: Int)

/**
 * Insert the mention at the current selection, replacing a selected range and
 * ending the IME composition. A valid mention already present in the draft is
 * left untouched so repeated avatar long-presses do not stack duplicates.
 */
fun insertWenliMentionValue(value: TextFieldValue): TextFieldValue {
    if (isWenliMentionBody(value.text)) return value
    val start = minOf(value.selection.start, value.selection.end).coerceIn(0, value.text.length)
    val end = maxOf(value.selection.start, value.selection.end).coerceIn(start, value.text.length)
    val before = value.text.substring(0, start)
    val after = value.text.substring(end)
    val leftSeparator = if (before.isNotEmpty() && !isMentionSeparator(before.last())) " " else ""
    val rightStartsWithWhitespace = after.firstOrNull()?.isWhitespace() == true
    val rightSeparator = if (after.isEmpty() || !rightStartsWithWhitespace) " " else ""
    val text = before + leftSeparator + WENLI_MENTION_TOKEN + rightSeparator + after
    val cursor = before.length + leftSeparator.length + WENLI_MENTION_TOKEN.length +
        if (rightSeparator.isNotEmpty()) rightSeparator.length else if (after.isNotEmpty()) 1 else 0
    return TextFieldValue(text = text, selection = TextRange(cursor), composition = null)
}

private fun isMentionSeparator(value: Char): Boolean = value.isWhitespace() || value in "，,：:"
