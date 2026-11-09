package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.habits.HabitReminder
import ru.genesis.calendar.domain.habits.HabitIntervalSchedule

@Composable
internal fun HabitReminderFields(preferredTime: String, reminder: HabitReminder, enabled: Boolean,
    googleTasksReady: Boolean = false, googleCalendarReady: Boolean = false,
    intervalSchedule: HabitIntervalSchedule? = null,
    onTime: (String) -> Unit, onReminder: (HabitReminder) -> Unit) {
    val app = LocalContext.current.applicationContext as GenesisApplication
    val preferences = remember(app) { LocalPreferences(app, app.workspaceScope) }
    val prefs by preferences.values.collectAsStateWithLifecycle(UiPreferences())
    val requestAccess = rememberRequestNotificationAccess(app)
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if(intervalSchedule==null) {
        Text("Точное время привычки", style = MaterialTheme.typography.titleMedium)
        Row(Modifier.fillMaxWidth().toggleable(value=preferredTime.isNotEmpty(), enabled=enabled,
            role=Role.Checkbox, onValueChange={ checked ->
                onTime(if(checked) reminder.time.ifBlank { "09:00" } else "")
            }).testTag("habit-preferred-time-toggle"),verticalAlignment = Alignment.CenterVertically) {
            Checkbox(preferredTime.isNotEmpty(), onCheckedChange=null, enabled=enabled)
            Text("Выполнять в определённое время")
        }
        if (preferredTime.isNotEmpty()) AuthorTimePicker(preferredTime, prefs.use24) { if (enabled) onTime(it) }
        }
        HorizontalDivider()
        Text("Персональное напоминание", style = MaterialTheme.typography.titleMedium)
        Text("Действует независимо от общего напоминания о дневной цели. Для доставки нужно разрешение Android.", style = MaterialTheme.typography.bodySmall)
        Row(verticalAlignment = Alignment.CenterVertically) {
            Switch(reminder.enabled, { onReminder(reminder.copy(enabled = it,
                timing=if(it && preferredTime.isEmpty() && intervalSchedule==null) "custom" else reminder.timing)); if(it) requestAccess() }, enabled = enabled,
                modifier = Modifier.testTag("habit-personal-reminder-enabled"))
            Text("Добавить напоминание", Modifier.padding(start = 8.dp))
        }
        if (reminder.enabled) {
            HabitNotificationAccessNotice(app, true)
            listOf("habit" to if(intervalSchedule!=null) "В каждое время повтора" else "В точное время привычки", "custom" to "В отдельное время").forEach { (value, label) ->
                FilterChip(selected = reminder.timing == value, enabled = enabled && (value!="habit" || preferredTime.isNotEmpty() || intervalSchedule!=null),
                    onClick = { onReminder(reminder.copy(timing = value)) }, label = { Text(label) },
                    modifier = Modifier.testTag("habit-reminder-timing-$value"))
            }
            if (reminder.timing == "habit" && preferredTime.isEmpty() && intervalSchedule==null)
                Text("Для напоминания в точное время привычки включите время привычки выше.", style=MaterialTheme.typography.bodySmall)
            if (reminder.timing == "custom") {
                Text("Время напоминания")
                AuthorTimePicker(reminder.time, prefs.use24) { if (enabled) onReminder(reminder.copy(time = it)) }
            }
            var minutesText by remember(reminder.minutesBefore) { mutableStateOf(reminder.minutesBefore.toString()) }
            OutlinedTextField(value = minutesText, enabled = enabled,
                onValueChange = { value ->
                    if (value.isEmpty()) { minutesText = value; onReminder(reminder.copy(minutesBefore = 0)) }
                    else value.toIntOrNull()?.takeIf { it in 0..1440 }?.let { minutesText = value; onReminder(reminder.copy(minutesBefore = it)) }
                },
                label = { Text("За сколько минут") }, modifier = Modifier.fillMaxWidth().testTag("habit-reminder-minutes-before"),
                keyboardOptions = androidx.compose.foundation.text.KeyboardOptions(keyboardType = androidx.compose.ui.text.input.KeyboardType.Number))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(reminder.allowDuringQuietHours, { onReminder(reminder.copy(allowDuringQuietHours = it)) }, enabled = enabled)
                Text("Разрешить это напоминание в тихие часы", Modifier.weight(1f))
            }
            HorizontalDivider()
            Text("Синхронизация с Google", style = MaterialTheme.typography.titleSmall)
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(reminder.syncToGoogleTasks,
                    { onReminder(reminder.copy(syncToGoogleTasks = it)) },
                    enabled = enabled && (googleTasksReady || reminder.syncToGoogleTasks),
                    modifier = Modifier.testTag("habit-google-tasks"))
                Column { Text("Google Tasks")
                    Text(if (googleTasksReady) "Переносимая задача для следующего выполнения"
                        else "Сначала подключите Google Tasks в настройках аккаунта",
                        style = MaterialTheme.typography.bodySmall) }
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(reminder.showInGoogleCalendar,
                    { onReminder(reminder.copy(showInGoogleCalendar = it)) },
                    enabled = enabled && (googleCalendarReady || reminder.showInGoogleCalendar),
                    modifier = Modifier.testTag("habit-google-calendar"))
                Column { Text("Показывать в Google Calendar")
                    Text(if (googleCalendarReady) "Событие создаётся только по вашему выбору"
                        else "Сначала подключите Google Calendar в настройках аккаунта",
                        style = MaterialTheme.typography.bodySmall) }
            }
        }
    }
}
