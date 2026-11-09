package ru.genesis.calendar.ui

import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.compose.ui.unit.TextUnit

/** Keeps short setting choices on one line without hiding the end of a translated label. */
@Composable
internal fun CompactChoiceLabel(label: String, minFontSize: TextUnit = 8.sp, maxFontSize: TextUnit = 11.sp) {
    Text(label, modifier = Modifier.fillMaxWidth(),
        style = MaterialTheme.typography.labelSmall.copy(color = LocalContentColor.current,
            textAlign = TextAlign.Center),
        maxLines = 1, softWrap = false,
        autoSize = TextAutoSize.StepBased(minFontSize = minFontSize, maxFontSize = maxFontSize))
}
