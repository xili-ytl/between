package com.privatechat.couplechat.core.text

import android.content.Context
import android.content.Intent
import android.graphics.Canvas
import android.graphics.Paint
import android.graphics.PixelFormat
import android.graphics.Typeface
import android.graphics.drawable.Drawable
import android.net.Uri
import android.text.Spannable
import android.text.Spanned
import android.text.TextPaint
import android.text.method.LinkMovementMethod
import android.text.style.ForegroundColorSpan
import android.text.style.StyleSpan
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.viewinterop.AndroidView
import io.noties.markwon.AbstractMarkwonPlugin
import io.noties.markwon.LinkResolver
import io.noties.markwon.Markwon
import io.noties.markwon.MarkwonConfiguration
import io.noties.markwon.core.CorePlugin
import io.noties.markwon.core.MarkwonTheme
import io.noties.markwon.ext.latex.JLatexMathPlugin
import io.noties.markwon.ext.strikethrough.StrikethroughPlugin
import io.noties.markwon.ext.tables.TablePlugin
import io.noties.markwon.ext.tasklist.TaskListPlugin
import io.noties.markwon.image.AsyncDrawableLoader
import io.noties.markwon.inlineparser.MarkwonInlineParserPlugin
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors
import java.util.concurrent.ThreadFactory

private const val WENLI_MENTION_TOKEN = "@小Q"
private const val MARKWON_LATEX_DELIMITER = "$$"
/** Shared so a long LazyColumn cannot create one formula thread pool per visible message. */
private val ChatLatexExecutor: ExecutorService by lazy {
    Executors.newFixedThreadPool(2, ThreadFactory { runnable ->
        Thread(runnable, "wenli-latex").apply { isDaemon = true }
    })
}
private val HTML_TAG = Regex("</?[A-Za-z][^>]*>|<!--[\\s\\S]*?-->")
private val MARKDOWN_IMAGE = Regex("!\\[[^]]*]\\s*(?:\\([^)]*\\)|\\[[^]]*])")
private val MARKDOWN_EMPHASIS = Regex("""(?<!\w)(\*|_)(?=\S)(.+?\S)\1(?!\w)""")
private val WENLI_MENTION = Regex("(?:^|[\\s，,：:])@小Q(?=$|[\\s，,：:])")
private val LATEX_COMMAND = Regex("\\\\([A-Za-z]+)")
private val TABLE_SEPARATOR = Regex("\\|?\\s*:?-{3,}:?\\s*(?:\\|\\s*:?-{3,}:?\\s*)+\\|?")
private val SUPPORTED_LATEX_COMMANDS = setOf(
    "alpha", "beta", "gamma", "delta", "epsilon", "theta", "lambda", "mu", "pi", "sigma", "phi", "omega",
    "Gamma", "Delta", "Theta", "Lambda", "Pi", "Sigma", "Phi", "Omega",
    "frac", "dfrac", "tfrac", "sqrt", "sum", "prod", "int", "lim", "infty",
    "begin", "end", "matrix", "pmatrix", "bmatrix", "vmatrix", "cases",
    "left", "right", "cdot", "times", "div", "pm", "mp", "le", "leq", "ge", "geq", "neq", "approx",
    "sin", "cos", "tan", "log", "ln", "exp", "mathrm", "mathbf", "mathit", "text",
)

/** The result of the parser boundary used before handing content to Markwon. */
internal data class ChatMarkdownPlan(
    val markdown: String?,
    val fallbackToRaw: Boolean,
    val requiresHorizontalScroll: Boolean,
    val segments: List<ChatMarkdownSegment> = emptyList(),
)

internal data class ChatMarkdownSegment(
    val markdown: String,
    val requiresHorizontalScroll: Boolean,
)

/**
 * Normalize the chat formula dialect to Markwon's native `$$...$$` dialect.
 *
 * This scanner intentionally treats code spans/fences as opaque. It also
 * rejects HTML and image syntax before Markwon sees it, because this screen
 * has no HTML plugin or image loader for message markdown.
 */
internal fun prepareChatMarkdown(
    source: String,
    repairMalformedGeneratedFences: Boolean = false,
): ChatMarkdownPlan {
    val renderSource = if (repairMalformedGeneratedFences) normalizeGeneratedMarkdownFences(source) else source
    if (renderSource.isEmpty()) return ChatMarkdownPlan(null, false, false)

    val output = StringBuilder(renderSource.length)
    var index = 0
    var hasFormula = false
    var requiresHorizontalScroll = false

    while (index < renderSource.length) {
        val fence = fencedCodeAt(renderSource, index)
        if (fence != null) {
            val end = findFenceEnd(renderSource, index, fence.first, fence.second)
            output.append(renderSource, index, end)
            requiresHorizontalScroll = true
            index = end
            continue
        }

        if (renderSource[index] == '`') {
            val runLength = repeatedRunLength(renderSource, index, '`')
            val close = findBacktickRun(renderSource, index + runLength, runLength)
            if (close >= 0) {
                val end = close + runLength
                output.append(renderSource, index, end)
                index = end
            } else {
                output.append(renderSource, index, index + runLength)
                index += runLength
            }
            continue
        }

        if (renderSource[index] == '<' && HTML_TAG.matchAt(renderSource, index) != null) {
            return ChatMarkdownPlan(null, true, false)
        }
        if (renderSource[index] == '!' && MARKDOWN_IMAGE.find(renderSource, index)?.range?.first == index) {
            return ChatMarkdownPlan(null, true, false)
        }

        when {
            renderSource.startsWith("\\(", index) && !isEscaped(renderSource, index) -> {
                val close = findUnescaped(renderSource, index + 2, "\\)")
                if (close < 0) return ChatMarkdownPlan(null, true, false)
                val content = renderSource.substring(index + 2, close)
                if (content.isBlank()) return ChatMarkdownPlan(null, true, false)
                if (containsUnsupportedLatexCommand(content)) return ChatMarkdownPlan(null, true, false)
                output.append(MARKWON_LATEX_DELIMITER).append(content).append(MARKWON_LATEX_DELIMITER)
                hasFormula = true
                index = close + 2
            }

            renderSource.startsWith("\\[", index) && !isEscaped(renderSource, index) -> {
                val close = findUnescaped(renderSource, index + 2, "\\]")
                if (close < 0) return ChatMarkdownPlan(null, true, false)
                val content = renderSource.substring(index + 2, close).trim()
                if (content.isBlank()) return ChatMarkdownPlan(null, true, false)
                if (containsUnsupportedLatexCommand(content)) return ChatMarkdownPlan(null, true, false)
                appendBlockFormula(output, content)
                hasFormula = true
                index = close + 2
            }

            renderSource.startsWith(MARKWON_LATEX_DELIMITER, index) && !isEscaped(renderSource, index) -> {
                val close = findUnescaped(renderSource, index + 2, MARKWON_LATEX_DELIMITER)
                if (close < 0) return ChatMarkdownPlan(null, true, false)
                val content = renderSource.substring(index + 2, close)
                if (content.isBlank()) return ChatMarkdownPlan(null, true, false)
                if (containsUnsupportedLatexCommand(content)) return ChatMarkdownPlan(null, true, false)
                output.append(renderSource, index, close + 2)
                hasFormula = true
                index = close + 2
            }

            renderSource[index] == '$' && !isEscaped(renderSource, index) -> {
                val close = findSingleDollar(renderSource, index + 1)
                if (close >= 0) {
                    val content = renderSource.substring(index + 1, close)
                    if (isSingleDollarFormula(content, renderSource, index, close)) {
                        if (containsUnsupportedLatexCommand(content)) return ChatMarkdownPlan(null, true, false)
                        if (isBlockDollarFormula(renderSource, index, close)) {
                            appendBlockFormula(output, content.trim())
                        } else {
                            output.append(MARKWON_LATEX_DELIMITER).append(content).append(MARKWON_LATEX_DELIMITER)
                        }
                        hasFormula = true
                        index = close + 1
                    } else {
                        output.append('$')
                        index += 1
                    }
                } else if (looksLikeUnclosedDollar(renderSource, index)) {
                    return ChatMarkdownPlan(null, true, false)
                } else {
                    output.append('$')
                    index += 1
                }
            }

            else -> {
                output.append(renderSource[index])
                index += 1
            }
        }
    }

    if (hasTable(renderSource)) requiresHorizontalScroll = true
    val hasMarkdown = hasMarkdownSyntax(renderSource)
    if (!hasFormula && !hasMarkdown) return ChatMarkdownPlan(null, false, false)
    val markdown = output.toString()
    val segments = splitHorizontalBlocks(markdown)
    return ChatMarkdownPlan(markdown, false, requiresHorizontalScroll, segments)
}

private fun splitHorizontalBlocks(markdown: String): List<ChatMarkdownSegment> {
    if (markdown.isEmpty()) return emptyList()
    val segments = mutableListOf<ChatMarkdownSegment>()
    var segmentStart = 0
    var index = 0
    while (index < markdown.length) {
        val fence = fencedCodeAt(markdown, index)
        val tableEnd = if (isLineStart(markdown, index)) tableEndAt(markdown, index) else null
        when {
            fence != null -> {
                val end = findFenceEnd(markdown, index, fence.first, fence.second)
                appendSegment(segments, markdown.substring(segmentStart, index), false)
                appendSegment(segments, markdown.substring(index, end), true)
                segmentStart = end
                index = end
            }

            tableEnd != null -> {
                appendSegment(segments, markdown.substring(segmentStart, index), false)
                appendSegment(segments, markdown.substring(index, tableEnd), true)
                segmentStart = tableEnd
                index = tableEnd
            }

            else -> index += 1
        }
    }
    appendSegment(segments, markdown.substring(segmentStart), false)
    return segments
}

private fun appendSegment(
    segments: MutableList<ChatMarkdownSegment>,
    markdown: String,
    requiresHorizontalScroll: Boolean,
) {
    if (markdown.isNotEmpty()) segments += ChatMarkdownSegment(markdown, requiresHorizontalScroll)
}

private fun tableEndAt(markdown: String, start: Int): Int? {
    val headerEnd = lineEndExclusive(markdown, start)
    if (headerEnd <= start || !tableLineBody(markdown.substring(start, headerEnd)).contains('|')) return null
    if (headerEnd >= markdown.length) return null
    val separatorEnd = lineEndExclusive(markdown, headerEnd)
    if (!tableLineBody(markdown.substring(headerEnd, separatorEnd)).trim().matches(TABLE_SEPARATOR)) return null

    var end = separatorEnd
    while (end < markdown.length) {
        val rowEnd = lineEndExclusive(markdown, end)
        val row = tableLineBody(markdown.substring(end, rowEnd))
        if (row.isBlank() || !row.contains('|')) break
        end = rowEnd
    }
    return end
}

private fun isLineStart(source: String, index: Int): Boolean = index == 0 || source[index - 1] == '\n'

private fun lineEndExclusive(source: String, start: Int): Int {
    val newline = source.indexOf('\n', start)
    return if (newline < 0) source.length else newline + 1
}

private fun tableLineBody(line: String): String {
    var body = line.trimStart(' ')
    while (body.startsWith(">")) body = body.removePrefix(">").removePrefix(" ")
    return body
}

/** Render already-validated rich text with native TextView spans/drawables. */
@Composable
internal fun ChatRichText(
    markdown: String,
    textSize: TextUnit,
    textColor: Color,
    mentionColor: Color,
    requiresHorizontalScroll: Boolean,
    segments: List<ChatMarkdownSegment> = emptyList(),
    modifier: Modifier = Modifier,
) {
    val context = LocalContext.current
    val density = LocalDensity.current
    val textSizePx = with(density) { textSize.toPx() }
    val renderer = remember(context, textSizePx, textColor, mentionColor) {
        ChatRichTextRenderer(
            context = context,
            textSizePx = textSizePx,
            textColor = textColor.toArgb(),
            mentionColor = mentionColor.toArgb(),
        )
    }
    val renderSegments = remember(markdown, requiresHorizontalScroll, segments) {
        when {
            segments.isNotEmpty() -> segments
            requiresHorizontalScroll -> splitHorizontalBlocks(markdown)
            else -> listOf(ChatMarkdownSegment(markdown, false))
        }
    }
    Column(modifier = modifier.fillMaxWidth()) {
        renderSegments.forEachIndexed { index, segment ->
            val tag = if (index == 0) "chat-rich-text" else "chat-rich-text-$index"
            val content: @Composable () -> Unit = {
                AndroidView(
                    factory = renderer::createTextView,
                    update = { renderer.render(it, segment.markdown) },
                    modifier = Modifier
                        .then(if (segment.requiresHorizontalScroll) Modifier else Modifier.fillMaxWidth())
                        .testTag(tag),
                )
            }
            if (segment.requiresHorizontalScroll) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .testTag("chat-rich-text-scroll-$index"),
                ) { content() }
            } else {
                content()
            }
        }
    }
}

private class ChatRichTextRenderer(
    context: Context,
    private val textSizePx: Float,
    private val textColor: Int,
    private val mentionColor: Int,
) {
    private val markwon = createMarkwon(context)

    private data class RenderKey(
        val markdown: String,
        val textSizePx: Float,
        val textColor: Int,
        val mentionColor: Int,
    )

    fun createTextView(context: Context): TextView = TextView(context).also(::applyTextViewStyle)

    fun render(textView: TextView, markdown: String) {
        applyTextViewStyle(textView)
        val renderKey = RenderKey(markdown, textSizePx, textColor, mentionColor)
        if (textView.tag == renderKey) return
        textView.tag = renderKey
        markwon.setMarkdown(textView, markdown)
        applyWenliMentionSpans(textView)
    }

    private fun applyTextViewStyle(textView: TextView) {
        textView.apply {
            layoutParams = ViewGroup.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT)
            setTextSize(android.util.TypedValue.COMPLEX_UNIT_PX, textSizePx)
            setTextColor(textColor)
            setLinkTextColor(0xFF1E88E5.toInt())
            includeFontPadding = false
            setLineSpacing(0f, 1.05f)
            movementMethod = LinkMovementMethod.getInstance()
            setTextIsSelectable(false)
            isLongClickable = false
            isFocusable = false
            importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_YES
        }
    }

    private fun createMarkwon(context: Context): Markwon = Markwon.builderNoCore(context)
        .usePlugin(CorePlugin.create())
        .usePlugin(MarkwonInlineParserPlugin.create())
        .usePlugin(StrikethroughPlugin.create())
        .usePlugin(TablePlugin.create(context))
        .usePlugin(TaskListPlugin.create(context))
        .usePlugin(
            JLatexMathPlugin.create(textSizePx) { builder ->
                builder
                    .inlinesEnabled(true)
                    .executorService(ChatLatexExecutor)
                    .errorHandler { latex, _ ->
                        RawLatexDrawable("$$$latex$$", textColor, textSizePx)
                    }
                builder.theme()
                    .textColor(textColor)
                    .blockFitCanvas(true)
            },
        )
        .usePlugin(object : AbstractMarkwonPlugin() {
            override fun configureTheme(builder: MarkwonTheme.Builder) {
                val codeBackground = textColor and 0x19FFFFFF
                val quoteColor = textColor and 0x40FFFFFF
                builder
                    .linkColor(0xFF1E88E5.toInt())
                    .isLinkUnderlined(true)
                    .codeTextColor(textColor)
                    .codeBlockTextColor(textColor)
                    .codeBackgroundColor(codeBackground)
                    .codeBlockBackgroundColor(codeBackground)
                    .blockQuoteColor(quoteColor)
                    .listItemColor(textColor)
            }

            override fun configureConfiguration(builder: MarkwonConfiguration.Builder) {
                builder
                    .asyncDrawableLoader(AsyncDrawableLoader.noOp())
                    .linkResolver(object : LinkResolver {
                        override fun resolve(view: View, link: String) {
                            val uri = Uri.parse(link)
                            val scheme = uri.scheme?.lowercase()
                            if (scheme != "http" && scheme != "https") return
                            runCatching {
                                view.context.startActivity(Intent(Intent.ACTION_VIEW, uri))
                            }
                        }
                    })
            }
        })
        .fallbackToRawInputWhenEmpty(true)
        .build()

    private fun applyWenliMentionSpans(textView: TextView) {
        val spannable = textView.text as? Spannable ?: return
        WENLI_MENTION.findAll(spannable).forEach { match ->
            val tokenStart = match.range.first + if (spannable[match.range.first] == '@') 0 else 1
            val tokenEnd = tokenStart + WENLI_MENTION_TOKEN.length
            spannable.setSpan(ForegroundColorSpan(mentionColor), tokenStart, tokenEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
            spannable.setSpan(StyleSpan(Typeface.BOLD), tokenStart, tokenEnd, Spanned.SPAN_EXCLUSIVE_EXCLUSIVE)
        }
    }
}

private class RawLatexDrawable(
    private val value: String,
    color: Int,
    sizePx: Float,
) : Drawable() {
    private val paint = TextPaint(Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color
        textSize = sizePx
    }
    private val lines = value.split('\n')
    private val lineHeight = (-paint.ascent() + paint.descent()).toInt().coerceAtLeast(1)

    override fun draw(canvas: Canvas) {
        var baseline = -paint.ascent()
        lines.forEach { line ->
            canvas.drawText(line, bounds.left.toFloat(), bounds.top + baseline, paint)
            baseline += lineHeight
        }
    }

    override fun getIntrinsicWidth(): Int = lines.maxOfOrNull { paint.measureText(it).toInt() }?.coerceAtLeast(1) ?: 1

    override fun getIntrinsicHeight(): Int = (lineHeight * lines.size).coerceAtLeast(1)

    override fun setAlpha(alpha: Int) {
        paint.alpha = alpha
    }

    override fun setColorFilter(colorFilter: android.graphics.ColorFilter?) {
        paint.colorFilter = colorFilter
    }

    @Deprecated("Drawable.getOpacity is deprecated", ReplaceWith("PixelFormat.TRANSLUCENT"))
    override fun getOpacity(): Int = PixelFormat.TRANSLUCENT
}

private fun appendBlockFormula(output: StringBuilder, content: String) {
    if (output.isNotEmpty() && output.last() != '\n') output.append('\n')
    output.append(MARKWON_LATEX_DELIMITER).append('\n')
        .append(content)
        .append('\n').append(MARKWON_LATEX_DELIMITER).append('\n')
}

private fun isSingleDollarFormula(content: String, source: String, start: Int, close: Int): Boolean {
    if (content.isBlank()) return false
    if (content.contains('\n') && !isBlockDollarFormula(source, start, close)) return false
    if (content.trim().matches(Regex("[0-9][0-9.,]*"))) return false
    val mathSignal = content.any { it in "\\^_{}=+*/-" }
    if (content.trimStart().firstOrNull()?.isDigit() == true && !mathSignal) return false
    return true
}

private fun containsUnsupportedLatexCommand(content: String): Boolean {
    return LATEX_COMMAND.findAll(content).any { it.groupValues[1] !in SUPPORTED_LATEX_COMMANDS }
}

private fun isBlockDollarFormula(source: String, start: Int, close: Int): Boolean {
    val lineStart = source.lastIndexOf('\n', start - 1) + 1
    val closeLineStart = source.lastIndexOf('\n', close - 1) + 1
    return source.substring(lineStart, start).isBlank() &&
        source.substring(closeLineStart, close).isBlank()
}

private fun looksLikeUnclosedDollar(source: String, start: Int): Boolean {
    val next = source.getOrNull(start + 1) ?: return false
    if (next.isDigit() || next.isWhitespace()) return false
    val lineEnd = source.indexOf('\n', start + 1).let { if (it < 0) source.length else it }
    val content = source.substring(start + 1, lineEnd)
    return content.any { it.isLetter() || it == '\\' || it == '^' || it == '_' || it == '{' || it == '}' }
}

private fun findSingleDollar(source: String, start: Int): Int {
    var index = start
    while (index < source.length) {
        if (source[index] == '$' && !isEscaped(source, index) && !source.startsWith(MARKWON_LATEX_DELIMITER, index)) {
            return index
        }
        index += 1
    }
    return -1
}

private fun findUnescaped(source: String, start: Int, delimiter: String): Int {
    var index = start
    while (index <= source.length - delimiter.length) {
        if (source.startsWith(delimiter, index) && !isEscaped(source, index)) return index
        index += 1
    }
    return -1
}

private fun isEscaped(source: String, index: Int): Boolean {
    var slashCount = 0
    var cursor = index - 1
    while (cursor >= 0 && source[cursor] == '\\') {
        slashCount += 1
        cursor -= 1
    }
    return slashCount % 2 == 1
}

private fun fencedCodeAt(source: String, index: Int): Pair<Char, Int>? {
    if (index >= source.length || (source[index] != '`' && source[index] != '~')) return null
    val lineStart = source.lastIndexOf('\n', index - 1) + 1
    if (!isFencePrefix(source.substring(lineStart, index))) return null
    val length = repeatedRunLength(source, index, source[index])
    return if (length >= 3) source[index] to length else null
}

private fun findFenceEnd(source: String, start: Int, marker: Char, length: Int): Int {
    var lineStart = source.indexOf('\n', start).let { if (it < 0) source.length else it + 1 }
    while (lineStart < source.length) {
        val lineEnd = lineEndExclusive(source, lineStart)
        var markerStart = lineStart
        while (markerStart < lineEnd) {
            val run = repeatedRunLength(source, markerStart, marker)
            if (run >= length && isFencePrefix(source.substring(lineStart, markerStart)) &&
                isBlankFenceSuffix(source, markerStart + run, lineEnd)
            ) {
                return lineEnd
            }
            markerStart += 1
        }
        lineStart = lineEnd
    }
    return source.length
}

private fun isBlankFenceSuffix(source: String, start: Int, lineEnd: Int): Boolean {
    var bodyEnd = lineEnd
    if (bodyEnd > start && source[bodyEnd - 1] == '\n') bodyEnd -= 1
    if (bodyEnd > start && source[bodyEnd - 1] == '\r') bodyEnd -= 1
    return source.substring(start, bodyEnd).all { it == ' ' || it == '\t' }
}

private data class GeneratedFenceLine(
    val prefix: String,
    val marker: Char,
    val length: Int,
    val suffix: String,
    val ending: String,
)

private fun normalizeGeneratedMarkdownFences(source: String): String {
    val lines = preservingLines(source)
    var openMarker: Char? = null
    var openLength = 0
    return lines.mapIndexed { index, line ->
        val fence = parseGeneratedFenceLine(line) ?: return@mapIndexed line
        val currentMarker = openMarker
        if (currentMarker == null) {
            if (fence.marker != '`' || !fence.suffix.contains('`')) {
                openMarker = fence.marker
                openLength = fence.length
            }
            return@mapIndexed line
        }
        if (fence.marker != currentMarker || fence.length < openLength) return@mapIndexed line
        if (fence.suffix.isBlank()) {
            openMarker = null
            openLength = 0
            return@mapIndexed line
        }
        val malformedSuffix = fence.suffix.trim() == "n" || fence.suffix.trim() == "\\n"
        val laterValidClose = hasGeneratedClosingFence(lines, index + 1, currentMarker, openLength)
        if (malformedSuffix && !laterValidClose) {
            openMarker = null
            openLength = 0
            "${fence.prefix}${fence.marker.toString().repeat(fence.length)}${fence.ending}"
        } else {
            line
        }
    }.joinToString("")
}

private fun hasGeneratedClosingFence(lines: List<String>, start: Int, marker: Char, length: Int): Boolean {
    var sawProse = false
    var paragraphBreak = false
    for (index in start until lines.size) {
        val line = lines[index]
        val fence = parseGeneratedFenceLine(line)
        if (fence == null || fence.marker != marker || fence.length < length) {
            if (Regex("[。！？]\\s*$").containsMatchIn(line)) sawProse = true
            else if (sawProse && line.isBlank()) paragraphBreak = true
            continue
        }
        val suffix = fence.suffix.trim()
        if (suffix.isNotEmpty()) {
            if (sawProse && suffix != "n" && suffix != "\\n") return false
            continue
        }
        if (sawProse && paragraphBreak && lines.drop(index + 1).any { later ->
            val candidate = parseGeneratedFenceLine(later)
            candidate != null && candidate.marker == marker && candidate.length >= length && candidate.suffix.isBlank()
        }) return false
        return true
    }
    return false
}

private fun preservingLines(source: String): List<String> {
    if (source.isEmpty()) return emptyList()
    val lines = mutableListOf<String>()
    var start = 0
    while (start < source.length) {
        val newline = source.indexOf('\n', start)
        if (newline < 0) {
            lines += source.substring(start)
            break
        }
        lines += source.substring(start, newline + 1)
        start = newline + 1
    }
    return lines
}

private fun parseGeneratedFenceLine(line: String): GeneratedFenceLine? {
    val ending = when {
        line.endsWith("\r\n") -> "\r\n"
        line.endsWith("\n") -> "\n"
        else -> ""
    }
    val body = if (ending.isEmpty()) line else line.dropLast(ending.length)
    val match = Regex("^( {0,3})(`{3,}|~{3,})(.*)$").matchEntire(body) ?: return null
    val markerRun = match.groupValues[2]
    return GeneratedFenceLine(
        prefix = match.groupValues[1],
        marker = markerRun.first(),
        length = markerRun.length,
        suffix = match.groupValues[3],
        ending = ending,
    )
}

private fun isFencePrefix(prefix: String): Boolean {
    if (prefix.all { it == ' ' } && prefix.length <= 8) return true
    if (prefix.matches(Regex("(?: {0,3}> ?)+"))) return true
    return prefix.matches(Regex(" {0,3}(?:[-+*]|\\d+[.)]) +"))
}

private fun repeatedRunLength(source: String, start: Int, value: Char): Int {
    var length = 0
    while (start + length < source.length && source[start + length] == value) length += 1
    return length
}

private fun findBacktickRun(source: String, start: Int, length: Int): Int {
    var index = start
    while (index <= source.length - length) {
        if (source.startsWith("`".repeat(length), index)) return index
        index += 1
    }
    return -1
}

private fun hasMarkdownSyntax(source: String): Boolean {
    if (source.contains("**") || source.contains("__") || source.contains("~~") || source.contains('`') ||
        MARKDOWN_EMPHASIS.containsMatchIn(source)
    ) return true
    if (source.contains(Regex("\\[[^]]+]\\([^)]*https?://[^)]*\\)"))) return true
    return source.lineSequence().any { line ->
        val trimmed = line.trimStart()
        trimmed.matches(Regex("#{1,6}\\s+.*")) || trimmed.startsWith("> ") ||
            trimmed.startsWith("- ") || trimmed.startsWith("* ") || trimmed.startsWith("+ ") ||
            trimmed.matches(Regex("\\d+\\.\\s+.*")) || trimmed == "---" || trimmed == "***"
    } || hasTable(source)
}

private fun hasTable(source: String): Boolean {
    var index = 0
    while (index < source.length) {
        if (isLineStart(source, index) && tableEndAt(source, index) != null) return true
        index = lineEndExclusive(source, index)
    }
    return false
}
