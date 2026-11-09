package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitCompletion
import ru.genesis.calendar.domain.habits.HabitIntervalSchedule
import ru.genesis.calendar.domain.habits.habitIntervalMarks
import java.time.LocalTime
import java.time.format.DateTimeFormatter
import java.util.Locale

private fun intervalTimeLabel(time: String, use24: Boolean): String = runCatching {
    LocalTime.parse(time).format(DateTimeFormatter.ofPattern(if(use24) "HH:mm" else "h:mm a",Locale.ROOT))
}.getOrDefault(time)

@Composable
internal fun HabitIntervalFields(value: HabitIntervalSchedule?, enabled: Boolean,
    onChange: (HabitIntervalSchedule?) -> Unit) {
    val app = LocalContext.current.applicationContext as GenesisApplication
    val preferences = remember(app) { LocalPreferences(app,app.workspaceScope) }
    val prefs by preferences.values.collectAsStateWithLifecycle(UiPreferences())
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth().toggleable(value!=null,enabled=enabled,role=Role.Checkbox,
            onValueChange={onChange(if(it) HabitIntervalSchedule() else null)}).testTag("habit-interval-enabled"),verticalAlignment=Alignment.CenterVertically) {
            Checkbox(value!=null,onCheckedChange=null,enabled=enabled)
            Text("Повторять в течение дня")
        }
        if(value!=null) {
            OutlinedTextField(value=if(value.intervalMinutes==0) "" else value.intervalMinutes.toString(),
                onValueChange={ onChange(value.copy(intervalMinutes=it.toIntOrNull() ?: 0)) },enabled=enabled,
                label={Text("Интервал, минут")},keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Number),
                modifier=Modifier.fillMaxWidth().testTag("habit-interval-minutes"))
            Text("Начало промежутка")
            Box(Modifier.testTag("habit-interval-start")) { AuthorTimePicker(value.startTime,prefs.use24) { if(enabled) onChange(value.copy(startTime=it)) } }
            Text("Конец промежутка")
            Box(Modifier.testTag("habit-interval-end")) { AuthorTimePicker(value.endTime,prefs.use24) { if(enabled) onChange(value.copy(endTime=it)) } }
            Text("Способ отметки",style=MaterialTheme.typography.titleSmall)
            listOf("each" to "Каждое повторение отдельно","day" to "Одна отметка за день").forEach { (mode,label) ->
                FilterChip(selected=value.completionMode==mode,onClick={onChange(value.copy(completionMode=mode))},
                    enabled=enabled,label={Text(label)},modifier=Modifier.testTag("habit-interval-mode-$mode"))
            }
            if(!value.valid()) Text("Укажите интервал от 1 до 1440 минут и время окончания не раньше начала.",
                color=MaterialTheme.colorScheme.error)
            else {
                Text("Запланированные времена",style=MaterialTheme.typography.labelLarge)
                Text(value.times().take(6).joinToString(" · "){intervalTimeLabel(it,prefs.use24)}+if(value.times().size>6) " · … · ${intervalTimeLabel(value.times().last(),prefs.use24)}" else "")
                Row(horizontalArrangement=Arrangement.spacedBy(4.dp)) { Text("Повторений за день:",style=MaterialTheme.typography.bodySmall); Text(value.times().size.toString(),style=MaterialTheme.typography.bodySmall) }
            }
            Text(if(value.completionMode=="each") "Все повторения завершены — привычка выполнена за день."
                else "Одна отметка подтверждает выполнение привычки за весь день.",style=MaterialTheme.typography.bodySmall)
        }
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HabitIntervalMarks(habit: Habit, entry: HabitCompletion?, enabled: Boolean,
    expanded: Boolean? = null, onExpandedChange: ((Boolean) -> Unit)? = null,
    trailing: (@Composable () -> Unit)? = null,
    onMark: (String,Boolean) -> Unit) {
    val interval=habit.intervalSchedule ?: return
    val app=LocalContext.current.applicationContext as GenesisApplication
    val preferences=remember(app) { LocalPreferences(app,app.workspaceScope) }
    val prefs by preferences.values.collectAsStateWithLifecycle(UiPreferences())
    val times=interval.times()
    val marks=habitIntervalMarks(habit,entry)
    var localExpanded by rememberSaveable(habit.id) { mutableStateOf(false) }
    val marksExpanded = expanded ?: localExpanded
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(8.dp)) {
        Text("Интервал, минут: ${interval.intervalMinutes} · ${intervalTimeLabel(interval.startTime,prefs.use24)}–${intervalTimeLabel(interval.endTime,prefs.use24)}",
            Modifier.testTag("habit-interval-summary-${habit.id}"), style=MaterialTheme.typography.bodySmall)
        if(interval.completionMode=="each" && habit.measurement==null) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TextButton(onClick={
                val next = !marksExpanded
                if (expanded == null) localExpanded = next
                onExpandedChange?.invoke(next)
            }, contentPadding = PaddingValues(vertical = 8.dp),
                modifier=Modifier.weight(1f).heightIn(min=48.dp).testTag("habit-interval-marks-toggle")) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement=Arrangement.spacedBy(8.dp),
                    verticalAlignment=Alignment.CenterVertically) {
                    Text("Отметки повторений:", style=MaterialTheme.typography.labelLarge)
                    UntranslatedText("${marks.size} / ${times.size}", maxLines=1, style=MaterialTheme.typography.labelLarge)
                }
            }
            trailing?.invoke()
            }
            if(marksExpanded) BoxWithConstraints(Modifier.fillMaxWidth().testTag("habit-interval-grid")) {
                val fontScale = androidx.compose.ui.platform.LocalDensity.current.fontScale
                val minimumCell = (if (prefs.use24) 80.dp else 112.dp) * fontScale
                val columns = ((maxWidth + 8.dp) / (minimumCell + 8.dp)).toInt().coerceIn(1, 6)
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    times.chunked(columns).forEach { row ->
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            row.forEach { time -> FilterChip(selected=time in marks,onClick={onMark(time,time !in marks)},
                                enabled=enabled,label={Text(intervalTimeLabel(time,prefs.use24), Modifier.fillMaxWidth(),
                                    textAlign=androidx.compose.ui.text.style.TextAlign.Center,
                                    style=MaterialTheme.typography.labelLarge.copy(fontFeatureSettings="tnum"))},
                                modifier=Modifier.weight(1f).height(48.dp).testTag("habit-interval-mark-$time")) }
                            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
                        }
                    }
                }
            }
        }
    }
}
