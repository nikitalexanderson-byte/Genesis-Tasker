package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.material3.Checkbox
import androidx.compose.material3.MaterialTheme

import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.Instant
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.isTaskOverdue

/** Only standalone unfinished tasks can be moved without changing a recurrence series. */
internal fun missedTasksForToday(tasks: List<LocalTask>, today: LocalDate,
    now: Instant = Instant.now()): List<LocalTask> =
    tasks.filter { task -> !task.done && !task.recurrence.enabled &&
        runCatching { LocalDate.parse(task.date) < today }.getOrDefault(false) &&
        isTaskOverdue(task, now) }

@Composable
internal fun TodayMissedTasksCard(tasks: List<LocalTask>, onComplete: (LocalTask) -> Unit,
    onMoveToToday: (LocalTask) -> Unit) {
    if (tasks.isEmpty()) return
    val dark = LocalEveningTheme.current
    val overdueSurface = if (dark) Color(0xff49232d) else Color(0xfffce8e9)
    val overdueInk = if (dark) Color(0xffffe4e8) else Color(0xff742d3a)
    val overdueBorder = if (dark) Color(0xffbd7483) else Color(0xffb76878)
    // Overdue remains red in every palette; inner task controls keep their theme colors.
    androidx.compose.material3.Surface(Modifier.fillMaxWidth().testTag("today-missed-tasks"),
        shape = AffairsLayout.shape, color = overdueSurface, contentColor = overdueInk,
        border = BorderStroke(1.dp, overdueBorder)) {
        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("${genesisTranslate("Пропущенные задачи")} · ${tasks.size}",
                style = MaterialTheme.typography.titleMedium, color = overdueInk, adjustInk = false)
            Text("Их можно выполнить сейчас или перенести на сегодня.",
                style = MaterialTheme.typography.bodySmall, color = overdueInk, adjustInk = false)
            tasks.forEach { task ->
                Surface(shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
                    BoxWithConstraints(Modifier.fillMaxWidth().padding(8.dp)) {
                        val stackAction = maxWidth < 360.dp || LocalDensity.current.fontScale > 1.2f
                        @Composable fun RowScope.taskIdentity() {
                            Checkbox(false, onCheckedChange = { if (it) onComplete(task) },
                                modifier = Modifier.size(48.dp).testTag("complete-missed-${task.id}")
                                    .semantics { contentDescription = task.title })
                            Column(Modifier.weight(1f)) {
                                UntranslatedText(task.title, style = MaterialTheme.typography.bodyMedium)
                                Text(task.date, style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                        }
                        @Composable fun moveAction(modifier: Modifier = Modifier) {
                            OutlinedButton(onClick = { onMoveToToday(task) },
                                modifier = modifier.testTag("move-missed-${task.id}")) { Text("На сегодня") }
                        }
                        if (stackAction) Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { taskIdentity() }
                            moveAction(Modifier.align(Alignment.End))
                        } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            taskIdentity()
                            moveAction()
                        }
                    }
                }
            }
        }
    }
}
