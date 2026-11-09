package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.data.LocalHabitWorkspace
import java.time.LocalDate

/** Daily obligations use the repository's accounting, including period-end goals. */
@Composable
internal fun HabitDaySummary(workspace: LocalHabitWorkspace, today: LocalDate, onHistory: () -> Unit) {
    val historyLabel = genesisTranslate("История и статистика")
    val goal = workspace.goals.firstOrNull { it.date == today }
    val planned = goal?.scheduledCount ?: 0
    val completed = goal?.completedCount ?: 0
    Surface(Modifier.fillMaxWidth().testTag("habit-daily-hero"), shape = AffairsLayout.shape,
        color = MaterialTheme.colorScheme.surface,
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(if (planned == 0) "Свободный день" else "Сегодня · $completed из $planned",
                        style = MaterialTheme.typography.titleMedium)
                    Text(when {
                        goal?.status == "rest" -> "День отдыха. Серия сохраняется."
                        goal?.status == "timezone-shift" -> "Смена часового пояса. Серия сохраняется."
                        goal?.status == "protected" -> "Серия защищена."
                        planned == 0 -> "На сегодня нет обязательных привычек. Серия сохраняется."
                        else -> "Дневная цель: ${goal!!.targetCount} · ${if (goal.status in setOf("qualified", "perfect")) "достигнута" else "впереди"}"
                    },
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                FilledTonalIconButton(onClick = onHistory, modifier = Modifier.size(48.dp).testTag("habit-progress-toggle")
                    .semantics { contentDescription = historyLabel }, shape = AffairsLayout.controlShape) {
                    AffairsActionIcon(AffairsAction.REPORT)
                }
            }
            if (planned > 0) LinearProgressIndicator(
                progress = { (completed.toFloat() / planned).coerceIn(0f, 1f) },
                modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.primary,
                trackColor = MaterialTheme.colorScheme.surfaceVariant)
        }
    }
}

@Composable
internal fun HabitWorkspaceTabs(selected: String, onSelect: (String) -> Unit) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        listOf("today" to "Сегодня", "library" to "Все привычки").forEach { (id, title) ->
            FilterChip(selected = selected == id, onClick = { onSelect(id) }, shape = AffairsLayout.controlShape,
                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("habit-view-$id"),
                label = { Text(title, Modifier.fillMaxWidth(), textAlign = TextAlign.Center, maxLines = 1) })
        }
    }
}

@Composable
internal fun HabitSectionHeading(title: String, count: Int? = null) {
    Row(Modifier.fillMaxWidth().padding(top = 4.dp), verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(title, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleMedium)
        count?.let { Text(it.toString(), style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
}
