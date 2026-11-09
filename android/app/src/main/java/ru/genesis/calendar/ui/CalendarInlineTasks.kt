package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.domain.CalendarMode

internal fun calendarModeLabel(mode: CalendarMode): String = when(mode) {
    CalendarMode.PROFANE -> "Григорианский"
    CalendarMode.SACRED -> "Сакральный"
    CalendarMode.LUNAR -> "Лунный"
}

@Composable internal fun CalendarInlineTasks(date: LocalDate, tasks: List<LocalTask>, use24: Boolean,
    onComplete: (LocalTask) -> Unit, onCreate: () -> Unit,
    onEdit: (LocalTask) -> Unit, onDelete: (LocalTask) -> Unit) {
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    Column(Modifier.fillMaxWidth().testTag("calendar-inline-tasks"), verticalArrangement=Arrangement.spacedBy(10.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Surface(Modifier.size(44.dp),shape=AffairsLayout.shape,
                color=if(LocalEveningTheme.current) MaterialTheme.colorScheme.secondaryContainer else Color(0xff123b36)) {
                Box(contentAlignment=Alignment.Center) {
                    GenesisVectorIcon(GenesisPageIcon.TASKS,Modifier.size(28.dp),
                        if(LocalEveningTheme.current) MaterialTheme.colorScheme.onSecondaryContainer else Color(0xfff3d68f),
                        animated=true)
                }
            }
            Column(Modifier.weight(1f)) {
                Text("Задачи дня", style = MaterialTheme.typography.titleLarge)
                Text("${tasks.size} · ${date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", locale))}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            Button(onClick = onCreate, modifier = Modifier.heightIn(min = 48.dp)
                .testTag("calendar-create-task")) { Text("Создать задачу") }
        }
        if(tasks.isEmpty()) Text("На этот день задач нет.",style=MaterialTheme.typography.bodySmall)
        tasks.forEach { task ->
            Surface(Modifier.fillMaxWidth(),shape=AffairsLayout.shape,
                color=if(task.done) completedTaskSurface else MaterialTheme.colorScheme.surfaceContainerLowest,
                border=BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
                Column(Modifier.padding(8.dp)) {
                    Row(verticalAlignment=Alignment.CenterVertically) {
                        Checkbox(task.done,{onComplete(task)},modifier=Modifier.testTag("calendar-inline-complete-${task.id}"))
                        Column(Modifier.weight(1f)) {
                            TaskTitle(task,style=MaterialTheme.typography.titleSmall,occurrenceDate=date)
                            if(task.time.isNotEmpty()) Text(timeLabel(task.time,use24),style=MaterialTheme.typography.bodySmall)
                        }
                    }
                    Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.spacedBy(8.dp)) {
                        TextButton({onEdit(task)},Modifier.weight(1f).heightIn(min=48.dp).testTag("calendar-inline-edit-${task.id}")) {
                            Text("Редактировать") }
                        TextButton({onDelete(task)},Modifier.weight(1f).heightIn(min=48.dp).testTag("calendar-inline-delete-${task.id}"),
                            colors=ButtonDefaults.textButtonColors(contentColor=MaterialTheme.colorScheme.error)) { Text("Удалить") }
                    }
                }
            }
        }
    }
}
