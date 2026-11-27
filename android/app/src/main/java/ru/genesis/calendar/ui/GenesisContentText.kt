package ru.genesis.calendar.ui

import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.InlineTextContent
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.LocalTextStyle
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.TextLayoutResult
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.font.*
import androidx.compose.ui.text.style.*
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.TextUnit
import androidx.compose.ui.unit.sp

/** User content and already-localized copy get the same word fitting without translation or recoloring. */
@Composable
internal fun UntranslatedText(text: String, modifier: Modifier = Modifier, color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified, fontStyle: FontStyle? = null, fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null, letterSpacing: TextUnit = TextUnit.Unspecified,
    textDecoration: TextDecoration? = null, textAlign: TextAlign? = null, lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip, softWrap: Boolean = true, maxLines: Int = Int.MAX_VALUE,
    minLines: Int = 1, onTextLayout: (TextLayoutResult) -> Unit = {}, style: TextStyle = LocalTextStyle.current,
    autoSize: TextAutoSize? = null) {
    Text(text, modifier, color, fontSize, fontStyle, fontWeight, fontFamily, letterSpacing, textDecoration,
        textAlign, lineHeight, overflow, softWrap, maxLines, minLines, onTextLayout, style,
        autoSize = autoSize, translate = false, adjustInk = false)
}

@Composable
internal fun UntranslatedText(text: AnnotatedString, modifier: Modifier = Modifier, color: Color = Color.Unspecified,
    fontSize: TextUnit = TextUnit.Unspecified, fontStyle: FontStyle? = null, fontWeight: FontWeight? = null,
    fontFamily: FontFamily? = null, letterSpacing: TextUnit = TextUnit.Unspecified,
    textDecoration: TextDecoration? = null, textAlign: TextAlign? = null, lineHeight: TextUnit = TextUnit.Unspecified,
    overflow: TextOverflow = TextOverflow.Clip, softWrap: Boolean = true, maxLines: Int = Int.MAX_VALUE,
    minLines: Int = 1, inlineContent: Map<String, InlineTextContent> = emptyMap(),
    onTextLayout: (TextLayoutResult) -> Unit = {}, style: TextStyle = LocalTextStyle.current, autoSize: TextAutoSize? = null) {
    val ink = if (color != Color.Unspecified) color else if (style.color != Color.Unspecified) style.color else LocalContentColor.current
    val resolved = style.merge(color = ink, fontSize = fontSize, fontStyle = fontStyle, fontWeight = fontWeight,
        fontFamily = fontFamily, letterSpacing = letterSpacing, textDecoration = textDecoration,
        textAlign = textAlign ?: TextAlign.Unspecified, lineHeight = lineHeight).copy(hyphens = Hyphens.None)
    FittedContentText(text, modifier, resolved, overflow, softWrap, maxLines, minLines, onTextLayout, autoSize, inlineContent)
}

@Composable
internal fun FittedContentText(text: AnnotatedString, modifier: Modifier, style: TextStyle,
    overflow: TextOverflow, softWrap: Boolean, maxLines: Int, minLines: Int,
    onTextLayout: (TextLayoutResult) -> Unit, autoSize: TextAutoSize?,
    inlineContent: Map<String, InlineTextContent> = emptyMap()) {
    val preferred = style.fontSize.takeIf { it != TextUnit.Unspecified } ?: 14.sp
    val fitting = autoSize ?: remember(preferred, maxLines) { WholeWordTextAutoSize(preferred, maxLines == 1) }
    val audit = LocalGenesisTextLayoutAudit.current
    val wrapKorean = softWrap && maxLines > 1 && inlineContent.isEmpty() && remember(text.text) { hasSpacedHangul(text.text) }
    var availableWidth by remember { mutableIntStateOf(Constraints.Infinity) }
    val display = if (wrapKorean && availableWidth > 0 && availableWidth != Constraints.Infinity) {
        val measurer = rememberTextMeasurer(cacheSize = 0)
        remember(measurer, text, style, availableWidth) {
            wrapKoreanWords(text, measurer.measure(text, style, softWrap = false), availableWidth)
        }
    } else text
    BasicText(display, modifier, style, overflow = overflow, softWrap = softWrap, maxLines = maxLines,
        minLines = minLines, inlineContent = inlineContent,
        autoSize = if (wrapKorean && availableWidth == Constraints.Infinity) autoSize else fitting,
        onTextLayout = { result ->
            if (wrapKorean) availableWidth = result.layoutInput.constraints.maxWidth
            onTextLayout(result)
            audit?.invoke(text.text, result)
        })
}
