package com.privatechat.couplechat.feature.chat

import androidx.compose.runtime.Composable
import androidx.compose.runtime.State
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.text.TextRange
import androidx.compose.ui.text.input.TextFieldValue

/**
 * 输入框的完整输入状态：正文 + 光标/选区 + 输入法组合态。
 *
 * 这三者是**同一份输入状态的不同部分**，不是"正文的一个派生值"。用户把光标点到
 * 第一个字后面按下退格，正文从 `大大笨蛋` 变成 `大笨蛋` —— 这次编辑携带的
 * [TextFieldValue.selection] 必须被保存下来，否则下一次重组会把光标弹回旧位置，
 * 表现为"光标挪不动、删不掉前面的字"。
 *
 * 因此这里的规则是唯一的：
 * - 只要输入框报了新值，就整份保存，不因为是"只有选区变"而丢弃；
 * - 但只有正文真的变了才产生输入回调，避免纯移动光标也产生业务输入事件。
 *
 * 本类的回调默认为空实现，正文变化时由调用方（或单测）观察，因此可以在 JVM 单测里
 * 直接构造和断言光标与选区，不需要设备或模拟器。
 */
class ChatComposerTextFieldState(initialText: String) {
    /**
     * 正文变化时通知 ViewModel 的回调。
     *
     * 默认空实现，因此单测可以直接构造本类断言光标与选区，不需要 Compose 运行时；
     * 实际接线由 [rememberChatComposerTextFieldState] 注入。
     */
    var onInputChanged: (String) -> Unit = {}

    /** 当前输入框应当显示的完整状态（正文 + 光标 + 组合态）。 */
    var value = mutableStateOf(TextFieldValue(initialText))
        private set

    /** 最近一次与 ViewModel 对齐的正文，用来判断"正文是否真的变了"。 */
    var text = initialText
        private set

    /**
     * 用户在输入框里的编辑（打字、退格、移动光标、拖动选区、输入法组合）。
     *
     * 返回需要通知 ViewModel 的新正文；正文没变时返回 null，
     * 表示这是一次纯光标/选区事件，不应产生业务输入回调。
     */
    fun edit(next: TextFieldValue): String? {
        value.value = next
        if (next.text == text) return null
        text = next.text
        onInputChanged(next.text)
        return next.text
    }

    /**
     * 接收外部（ViewModel 回流 / 插入提及）设置的正文。
     *
     * [selection] 只在调用方明确要求时给出（插入提及要把光标放到尾部空格之后）；
     * 未给出时保留当前光标，避免重组把光标弹回末尾。
     *
     * 返回需要通知 ViewModel 的新正文；正文没变时返回 null。
     */
    fun acceptExternal(nextText: String, selection: TextRange? = null): String? {
        val textChanged = nextText != text
        text = nextText
        val current = value.value
        val nextSelection = selection ?: current.selection
        if (current.text != nextText || current.selection != nextSelection) {
            value.value = TextFieldValue(
                text = nextText,
                selection = nextSelection,
                composition = if (current.text == nextText) current.composition else null,
            )
        }
        if (!textChanged) return null
        onInputChanged(nextText)
        return nextText
    }
}

/**
 * 与输入框同生命周期地记住输入状态（跨重组保留）。
 *
 * holder 必须跨重组保持同一实例，否则每次重组都会丢掉用户当前的光标与选区；
 * 因此传给 [remember] 的是读取最新回调的稳定 lambda，而不是回调本身。
 */
@Composable
fun rememberChatComposerTextFieldState(
    initialText: String,
    onInputChanged: (String) -> Unit,
): ChatComposerTextFieldState {
    val latestOnInputChanged: State<(String) -> Unit> = rememberUpdatedState(onInputChanged)
    return remember { ChatComposerTextFieldState(initialText) }
        .also { state -> state.onInputChanged = { latestOnInputChanged.value(it) } }
}
