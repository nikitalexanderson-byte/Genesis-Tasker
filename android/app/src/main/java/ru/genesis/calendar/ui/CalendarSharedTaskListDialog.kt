package ru.genesis.calendar.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
internal fun CalendarSharedTaskListDialog(date: LocalDate, load: suspend (LocalDate) -> List<SharedCalendarEntry>,
    onDismiss: () -> Unit, onOpen: (SharedCalendarEntry) -> Unit, onOpenDay: () -> Unit) {
    var tasks by remember(date) { mutableStateOf<List<SharedCalendarEntry>?>(null) }
    var failed by remember(date) { mutableStateOf(false) }
    var retry by remember(date) { mutableIntStateOf(0) }
    LaunchedEffect(date, retry) {
        failed = false
        try { tasks = load(date) }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { failed = true }
    }
    Dialog(onDismissRequest = onDismiss) {
        Surface(Modifier.fillMaxWidth().heightIn(max = 560.dp).testTag("calendar-shared-task-list-dialog"),
            shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceContainerHigh) {
            Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                EditorDialogHeader("Общие задачи дня", "calendar-shared-dialog-close", onDismiss)
                Text(date.format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.forLanguageTag(LocalGenesisLanguage.current))),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                HorizontalDivider()
                when {
                    failed -> {
                        Text("Не удалось загрузить задачи", color = MaterialTheme.colorScheme.error)
                        TextButton(onClick = { retry++ }) { Text("Повторить") }
                    }
                    tasks == null -> WorkspaceLoadingIndicator(Modifier.size(32.dp))
                    tasks!!.isEmpty() -> Text("На этот день задач больше нет.")
                    else -> LazyColumn(Modifier.weight(1f, fill = false), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        items(tasks!!, key = { it.id }) { task ->
                            Surface(shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.secondaryContainer,
                                modifier = Modifier.fillMaxWidth().testTag("calendar-shared-task-${task.id}")
                                    .clickable { onOpen(task) }) {
                                Column(Modifier.padding(12.dp).heightIn(min = 48.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(task.title, style = MaterialTheme.typography.titleSmall)
                                    Text(task.projectTitle, style = MaterialTheme.typography.bodySmall)
                                    Text(if (task.completed) "Выполнено" else "Не выполнено", style = MaterialTheme.typography.labelSmall)
                                }
                            }
                        }
                    }
                }
                Button(onClick = onOpenDay, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                    Text("Показать день в календаре")
                }
            }
        }
    }
}
