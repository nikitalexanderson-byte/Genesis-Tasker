package ru.genesis.calendar.ui

import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.text.modifiers.TextAutoSizeLayoutScope
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.ParagraphStyle
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.withStyle
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/** Optional local observer for native layout acceptance; no user text leaves the composition. */
internal val LocalGenesisTextLayoutAudit = staticCompositionLocalOf<((String, TextLayoutResult) -> Unit)?> { null }

internal fun isInsideWord(text: String, offset: Int): Boolean {
    if (offset <= 0 || offset >= text.length) return false
    fun isWordLetter(char: Char): Boolean = char.isLetterOrDigit() && when (Character.UnicodeScript.of(char.code)) {
        Character.UnicodeScript.HAN, Character.UnicodeScript.HIRAGANA,
        Character.UnicodeScript.KATAKANA -> false
        else -> true
    }
    return isWordLetter(text[offset - 1]) && isWordLetter(text[offset])
}

private val koreanWords = Regex("""[^ \t\r\n\u0085\u2028\u2029\u3000]+""")

internal fun hasSpacedHangul(text: String): Boolean = text.any { it.isWhitespace() } &&
    text.any { it >= '\u1100' && Character.UnicodeScript.of(it.code) == Character.UnicodeScript.HANGUL }

/** The platform permits breaks between Hangul syllables. Add paragraph boundaries at the
 * original spaces so selection, accessibility and annotations keep the original characters. */
internal fun wrapKoreanWords(text: AnnotatedString, unwrapped: TextLayoutResult, width: Int): AnnotatedString {
    if (unwrapped.multiParagraph.maxIntrinsicWidth <= width) return text
    fun advance(start: Int, end: Int): Float {
        var result = 0f
        for (offset in start until end) result += unwrapped.getBoundingBox(offset).width
        return result
    }
    val breaks = mutableListOf<Int>()
    var lineWidth = 0f
    var previousEnd = 0
    var previousLine = -1
    for (word in koreanWords.findAll(text.text)) {
        val start = word.range.first
        val end = word.range.last + 1
        val line = unwrapped.getLineForOffset(start)
        val wordWidth = advance(start, end)
        val gap = if (line == previousLine) advance(previousEnd, start) else 0f
        if (line == previousLine && lineWidth + gap + wordWidth > width) {
            breaks.add(start)
            lineWidth = wordWidth
        } else {
            lineWidth = (if (line == previousLine) lineWidth + gap else 0f) + wordWidth
        }
        previousEnd = end
        previousLine = line
    }
    if (breaks.isEmpty()) return text
    return buildAnnotatedString {
        var start = 0
        for (end in breaks + text.length) {
            withStyle(ParagraphStyle()) { append(text, start, end) }
            start = end
        }
    }
}

internal fun TextLayoutResult.splitsWord(): Boolean = (0 until (lineCount - 1).coerceAtLeast(0)).any { line ->
    isInsideWord(layoutInput.text.text, getLineEnd(line, visibleEnd = true))
}

/** Preserve the requested size unless the platform breaks a word or a one-line label overflows. */
internal data class WholeWordTextAutoSize(val preferred: TextUnit, val fitSingleLine: Boolean) : TextAutoSize {
    override fun TextAutoSizeLayoutScope.getFontSize(constraints: Constraints, text: AnnotatedString): TextUnit {
        if (constraints.maxWidth == 0 || constraints.maxHeight == 0) return preferred
        val largest = preferred.toPx()
        val smallest = minOf(largest, 8.sp.toPx())
        val step = .5.sp.toPx()
        fun needsMoreWidth(layout: TextLayoutResult): Boolean = layout.splitsWord() || fitSingleLine &&
            (layout.didOverflowWidth || layout.multiParagraph.didExceedMaxLines ||
                layout.lineCount > 1 || (layout.lineCount > 0 && layout.isLineEllipsized(0)))
        var candidate = largest
        while (true) {
            val layout = performLayout(constraints, text, candidate.toSp())
            val widthFailure = needsMoreWidth(layout)
            if (!widthFailure && !(fitSingleLine && layout.didOverflowHeight)) return candidate.toSp()
            if (candidate <= smallest) {
                // A fixed line height cannot be repaired by reducing only the font size.
                if (!widthFailure) return candidate.toSp()
                break
            }
            candidate = (candidate - step).coerceAtLeast(smallest)
        }

        if (fitSingleLine && text.text.any { it == '\n' || it == '\r' || it == '\u0085' ||
                it == '\u2028' || it == '\u2029' }) return smallest.toSp()
        // Only extreme user tokens reach this path. Find a fitting size below the normal 8sp floor,
        // then retain the largest fitting size. Both loops are bounded, including impossible layouts.
        var tooLarge = smallest
        var fitting = smallest
        var found = false
        for (attempt in 0 until 20) {
            fitting *= .5f
            if (!needsMoreWidth(performLayout(constraints, text, fitting.toSp()))) {
                found = true
                break
            }
            tooLarge = fitting
        }
        // Absolute span sizes or letter spacing can prevent any fit; keep their normal readable floor.
        if (!found) return smallest.toSp()
        repeat(8) {
            val probe = (fitting + tooLarge) / 2f
            if (needsMoreWidth(performLayout(constraints, text, probe.toSp()))) tooLarge = probe
            else fitting = probe
        }
        return fitting.toSp()
    }
}
