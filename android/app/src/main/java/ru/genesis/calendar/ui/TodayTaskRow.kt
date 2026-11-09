package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CheckboxDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

@Composable internal fun TodayTaskGroup(title: String, modifier: Modifier = Modifier,
    titleModifier: Modifier = Modifier, content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth(), shape = AffairsLayout.shape,
        color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(4.dp), verticalArrangement = Arrangement.spacedBy(AffairsLayout.gap)) {
            Text(title, titleModifier, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }
}

/** Both task scopes use the same card; shared completion remains governed by its workflow. */
@Composable internal fun TodayTaskRow(completed: Boolean, onOpen: () -> Unit,
    modifier: Modifier = Modifier, onComplete: (() -> Unit)? = null,
    content: @Composable ColumnScope.() -> Unit) {
    Surface(modifier.fillMaxWidth().clickable(onClick = onOpen), shape = AffairsLayout.shape,
        color = if (completed) completedTaskSurface else if (LocalEveningTheme.current)
            MaterialTheme.colorScheme.surfaceContainerLowest else Color(0xfff7f1e5),
        contentColor = if (completed) completedTaskInk else MaterialTheme.colorScheme.onSurface,
        border = BorderStroke(1.dp, if (completed && LocalEveningTheme.current) MaterialTheme.colorScheme.outlineVariant
            else if (completed) Color(0xffc8ccc6) else Color(0x44b28a4a))) {
        Row(Modifier.fillMaxWidth().padding(3.dp), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = completed, onCheckedChange = onComplete?.let { complete -> { _: Boolean -> complete() } },
                modifier = Modifier.size(48.dp), colors = CheckboxDefaults.colors(checkedColor = completedTaskInk))
            Column(Modifier.weight(1f).padding(4.dp).heightIn(min = 48.dp),
                verticalArrangement = Arrangement.spacedBy(3.dp), content = content)
        }
    }
}
