package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.data.HABIT_LAUREL_RETENTION_COMPLETIONS
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.data.habitCompletionCount
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.domain.habits.*
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

internal val habitLifecycleLabels = linkedMapOf("active" to "Активные", "paused" to "Пауза", "archived" to "Архив", "deleted" to "Удалённые")
internal fun habitLifecycleFailure(code: String?) = when (code) {
    "HABIT_LIFECYCLE_CLOCK_CONFLICT" -> "Не удалось сохранить. Проверьте дату и время устройства и повторите."
    "HABIT_LIFECYCLE_EDIT_CONFLICT", "HABIT_LIFECYCLE_TRANSITION_UNAVAILABLE", "HABIT_LIFECYCLE_ID_CONFLICT" -> "Есть изменения с другого устройства. Выберите состояние."
    else -> code
}

@Composable internal fun HabitLifecycleFilters(workspace: LocalHabitWorkspace, selected: String, onSelect: (String) -> Unit) {
    val number = NumberFormat.getIntegerInstance(Locale.forLanguageTag(LocalGenesisLanguage.current))
    var menuOpen by remember { mutableStateOf(false) }
    val finiteCopy=habitPracticeCopy()
    val choices=habitLifecycleLabels.mapValues { genesisTranslate(it.value) } + mapOf("completed" to finiteCopy.getString("completedFilter"),"missed" to finiteCopy.getString("missedFilter"))
    val counts = workspace.habits.groupingBy { habitPracticeLibraryStatus(it,workspace.completions) }.eachCount()
    val selectedLabel = choices.getValue(selected) + " · " + number.format(counts[selected] ?: 0)
    val displayLabel = genesisTranslate("Показывать привычки")
    Column(Modifier.fillMaxWidth().testTag("habit-lifecycle-filters"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Box(Modifier.fillMaxWidth()) {
            OutlinedButton(onClick = { menuOpen = true }, shape=AffairsLayout.controlShape, modifier = Modifier.fillMaxWidth().heightIn(min=48.dp)
                .testTag("habit-state-choice").semantics { contentDescription = displayLabel; stateDescription = selectedLabel }) {
                Text(selectedLabel, Modifier.weight(1f))
                Spacer(Modifier.width(8.dp))
                AffairsActionIcon(if (menuOpen) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                for ((status, label) in choices) {
                    DropdownMenuItem(text = {
                        Text(label + " · " + number.format(counts[status] ?: 0))
                    }, onClick = { onSelect(status); menuOpen = false },
                        modifier = Modifier.testTag("habit-state-$status").selectedControlDecoration(selected == status)
                            .semantics { this.selected = selected == status })
                }
            }
        }
        if(selected == "paused") Text("Пауза выключает расписание и напоминания.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if(selected == "archived" || selected == "deleted") Text("История и награды сохранены. Восстановленная привычка вернётся на паузу.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable internal fun HabitCardActions(habit: Habit, enabled: Boolean, scheduled: Boolean,
    onEdit: () -> Unit, onToggle: () -> Unit, onArchive: () -> Unit, onTimer: () -> Unit, onDelete: () -> Unit) {
    var expanded by remember(habit.id) { mutableStateOf(false) }
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (scheduled && habit.timerEnabled) AffairsIconButton("Таймер", AffairsAction.TIMER, onTimer, Modifier.testTag("habit-timer-open-${habit.id}"), enabled, outlined = false)
        Box {
            AffairsIconButton("Действия привычки", AffairsAction.MORE, { expanded = true }, Modifier.testTag("habit-actions-${habit.id}"), enabled, outlined = false)
            DropdownMenu(expanded, { expanded = false }) {
                DropdownMenuItem(text = { Text("Изменить") }, leadingIcon = { GenesisLucideIcon("pencil") },
                    onClick = { expanded = false; onEdit() }, modifier = Modifier.testTag("edit-habit-${habit.id}"))
                DropdownMenuItem(text = { Text(if (habit.active) "Пауза" else "Включить") },
                    leadingIcon = { GenesisLucideIcon(if (habit.active) "pause" else "play") },
                    onClick = { expanded = false; onToggle() }, modifier = Modifier.testTag("toggle-habit-${habit.id}"))
                DropdownMenuItem(text = { Text("В архив") }, leadingIcon = { GenesisLucideIcon("archive") },
                    onClick = { expanded = false; onArchive() }, modifier = Modifier.testTag("archive-habit-${habit.id}"))
                DropdownMenuItem(text = { Text("Удалить", color = MaterialTheme.colorScheme.error) },
                    leadingIcon = { GenesisLucideIcon("trash-2", tint = MaterialTheme.colorScheme.error) },
                    onClick = { expanded = false; onDelete() }, modifier = Modifier.testTag("delete-habit-${habit.id}"))
            }
        }
    }
}

@Composable internal fun HabitLifecycleResolution(habit: Habit, enabled: Boolean, onResolve: (String) -> Unit) {
    val state = HabitLifecycle.state(habit)
    if (!state.conflict) return
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val app = LocalContext.current.applicationContext as GenesisApplication
    val preferences = remember(app, app.workspaceScope) { LocalPreferences(app, app.workspaceScope) }
    val prefs by preferences.values.collectAsState(initial = UiPreferences())
    Column(Modifier.fillMaxWidth().testTag("habit-state-conflict-${habit.id}"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Есть изменения с другого устройства. Выберите состояние.", color = MaterialTheme.colorScheme.error)
        for (head in state.heads) {
            val at = Instant.parse(head.at).atZone(ZoneId.of(habit.schedule.timezone))
            val timestamp = at.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) + " · " +
                at.format(DateTimeFormatter.ofPattern(if (prefs.use24) "HH:mm" else "h:mm a", locale))
            OutlinedButton({ onResolve(head.id) }, enabled = enabled, shape = AffairsLayout.controlShape,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("resolve-habit-${habit.id}-${head.id}")) {
                Text(genesisTranslate(habitLifecycleLabels.getValue(head.status)) + " · " + timestamp)
            }
        }
    }
}

@Composable internal fun HabitRetiredRows(workspace: LocalHabitWorkspace, habits: List<Habit>, enabled: Boolean,
    onRestore: (Habit) -> Unit, onDelete: (Habit) -> Unit, onResolve: (Habit, String) -> Unit) {
    val number = NumberFormat.getIntegerInstance(Locale.forLanguageTag(LocalGenesisLanguage.current))
    val economy = HabitHistory.economy(workspace)
    Text("Восстановление вернёт привычку на паузу. Награды и прежний штраф не изменятся.", style = MaterialTheme.typography.bodySmall)
    for (habit in habits) {
        val state = HabitLifecycle.state(habit)
        Column(Modifier.fillMaxWidth().testTag("retired-habit-${habit.id}").padding(vertical = 8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            UntranslatedText(habit.emoji + " " + habitDisplayTitle(habit), style = MaterialTheme.typography.titleMedium)
            if(habit.practiceGoal != null) HabitPracticeStatus(habit,workspace.completions)
            else Text(genesisTranslate("Выполнено дней") + ": " + number.format(habitCompletionCount(economy.completions, habit.id)) + " · " +
                habitPracticeCopy().getString("retention"), style = MaterialTheme.typography.bodySmall)
            HabitLifecycleResolution(habit, enabled) { onResolve(habit, it) }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                AffairsIconButton("Восстановить", AffairsAction.RESTORE, { onRestore(habit) }, Modifier.testTag("restore-habit-${habit.id}"), enabled && !state.conflict)
                if (state.status != "deleted") CompositionLocalProvider(LocalContentColor provides MaterialTheme.colorScheme.error) {
                    AffairsIconButton("Удалить", AffairsAction.DELETE, { onDelete(habit) }, Modifier.testTag("delete-habit-${habit.id}"), enabled && !state.conflict)
                }
            }
            HorizontalDivider()
        }
    }
}
