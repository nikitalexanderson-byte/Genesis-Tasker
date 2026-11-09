package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.graphics.toColorInt

internal fun validCategoryColor(value: String) = Regex("#[0-9a-fA-F]{6}").matches(value)

/** Boards, statuses and categories share the visual palette used by the other editors. */
@Composable internal fun CategoryColorPicker(value: String, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val color = value.takeIf(::validCategoryColor) ?: "#2D6C68"
    Surface(onClick = { open = true }, modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp)
        .testTag("category-color-open"), shape = AffairsLayout.controlShape,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Row(Modifier.padding(12.dp), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            CompositionLocalProvider(LocalPreserveCalendarColors provides true) {
                androidx.compose.material3.Surface(Modifier.size(32.dp).testTag("category-color-preview"),
                    color = Color(color.toColorInt()), shape = AffairsLayout.controlShape,
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline)) {}
            }
            Text("Выбрать цвет", Modifier.weight(1f))
            GenesisLucideIcon("palette")
        }
    }
    if (open) GenesisColorPicker("Цвет", color, onDismiss = { open = false },
        onColor = { chosen -> chosen?.let(onChange); open = false }, allowThemeColor = false,
        previewLabel = "Цвет", tagPrefix = "category")
}
