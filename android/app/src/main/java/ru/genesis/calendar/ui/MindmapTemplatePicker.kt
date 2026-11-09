package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.BasicText
import androidx.compose.foundation.text.TextAutoSize
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

@Composable
internal fun MindmapTemplatePicker(value: String, onChange: (String) -> Unit) {
    Row(Modifier.fillMaxWidth().padding(vertical = 8.dp).testTag("mindmap-template-picker"),
        horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf("empty" to "Пустая", "idea" to "Идея", "project" to "Проект", "decision" to "Решение").forEach { (id, label) ->
            val chosen = value == id
            OutlinedButton(onClick = { onChange(id) }, selected = chosen,
                modifier = Modifier.weight(1f).height(48.dp).testTag("mindmap-template-$id").semantics { selected = chosen },
                shape = AffairsLayout.controlShape, contentPadding = PaddingValues(2.dp),
                colors = ButtonDefaults.outlinedButtonColors(containerColor = if (chosen)
                    MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surface,
                    contentColor = MaterialTheme.colorScheme.onSurface)) {
                BasicText(genesisTranslate(label), Modifier.fillMaxWidth(), maxLines = 1,
                    style = MaterialTheme.typography.labelSmall.copy(color = MaterialTheme.colorScheme.onSurface,
                        textAlign = TextAlign.Center),
                    autoSize = TextAutoSize.StepBased(minFontSize = 8.sp, maxFontSize = 12.sp))
            }
        }
    }
}
