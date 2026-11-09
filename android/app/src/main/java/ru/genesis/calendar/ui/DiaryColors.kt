package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.luminance
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.data.DiaryNote

internal fun diaryPresetColor(color: String): Color = when (color) {
    "sand" -> Color(0xffe7c994)
    "rose" -> Color(0xffe3b5b6)
    "sky" -> Color(0xffabcbdc)
    else -> Color(0xffa9c5ac)
}

@Composable internal fun DiaryColorOptions(color: String, customColor: String?, enabled: Boolean,
    onPreset: (String) -> Unit, onCustom: () -> Unit) {
    CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                DiaryNote.colors.forEachIndexed { index, preset ->
                    val picked = customColor == null && color == preset
                    val label = listOf("Шалфей", "Песок", "Роза", "Небо")[index]
                    val description = genesisTranslate(label)
                    androidx.compose.material3.Surface(onClick = { onPreset(preset) }, enabled = enabled,
                        color = diaryPresetColor(preset), contentColor = Color(0xff17221b), shape = AffairsLayout.controlShape,
                        border = selectedControlBorder(picked,enabled, BorderStroke(1.dp,Color(0xff68746d)), diaryPresetColor(preset)),
                        modifier = Modifier.weight(1f).height(48.dp).testTag("diary-color-$preset")
                            .semantics { selected = picked; contentDescription = description }) {
                        Box(contentAlignment = Alignment.Center) { Text(label, style = MaterialTheme.typography.labelSmall, maxLines = 1) }
                    }
                }
            }
            val swatch = customColor?.let { Color(android.graphics.Color.parseColor(it)) } ?: MaterialTheme.colorScheme.surface
            val ink = if (swatch.luminance() > .179f) Color.Black else Color.White
            androidx.compose.material3.Surface(onClick = onCustom, enabled = enabled, color = swatch, contentColor = ink,
                shape = AffairsLayout.controlShape, border = selectedControlBorder(customColor != null,enabled,
                    BorderStroke(1.dp,MaterialTheme.colorScheme.outline),swatch),
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("diary-color-custom")
                    .semantics { selected = customColor != null }) {
                Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                    GenesisLucideIcon("palette")
                    Text("Свой цвет", Modifier.weight(1f))
                    customColor?.let { Text(it.uppercase(), style = MaterialTheme.typography.labelSmall) }
                }
            }
        }
    }
}
