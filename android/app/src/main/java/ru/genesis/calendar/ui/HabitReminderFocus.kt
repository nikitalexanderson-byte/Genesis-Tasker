package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import ru.genesis.calendar.ui.UntranslatedText as MaterialText
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import java.time.Instant
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.habits.HabitMeasurements
import ru.genesis.calendar.domain.habits.habitReminderAction
import ru.genesis.calendar.reminders.HabitReminderOpenRequest

/** A stale notification shows its original day without modifying today's habit. */
@Composable
internal fun HabitReminderFocus(app: GenesisApplication, workspace: LocalHabitWorkspace,
    repository: HabitsRepository, request: HabitReminderOpenRequest?) {
    if (request == null || request.scope != app.workspaceScope) return
    var closed by rememberSaveable(request.nonce) { mutableStateOf(false) }
    var handled by rememberSaveable(request.nonce) { mutableStateOf(false) }
    var error by remember(request.nonce) { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val habit = workspace.habits.firstOrNull { it.id == request.target.habitId }
    val action = habitReminderAction(habit, request.target, workspace.completions, workspace.measurements, Instant.now())
    suspend fun complete(quality: Double? = null) {
        busy = true
        try { repository.completeFromReminder(request.target, quality); error = null }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = "Не удалось сохранить отметку привычки. Повторите попытку." }
        finally { busy = false }
    }
    LaunchedEffect(request.nonce) {
        if (request.action == "complete" && !handled && action in setOf("complete", "interval", "completed")) {
            handled = true; complete()
        }
    }
    if (closed) return
    OutlinedCard(Modifier.fillMaxWidth().testTag("habit-reminder-focus")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text("Напоминание", style = MaterialTheme.typography.titleMedium)
                TextButton({ closed = true }) { Text("Закрыть") }
            }
            if (habit != null) MaterialText(habitDisplayTitle(habit), style = MaterialTheme.typography.titleMedium)
            val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
            val display = LocalTimerDisplayMode.current
            val calendar = remember { ru.genesis.calendar.domain.GenesisCalendar() }
            MaterialText(if (display == ru.genesis.calendar.domain.CalendarMode.PROFANE)
                request.target.date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", locale)) else calendar.formatDate(request.target.date, display),
                style = MaterialTheme.typography.bodyMedium)
            when (action) {
                "stale" -> Text("Это напоминание относится к другой дате или прежнему правилу. Сегодняшние данные не изменены.")
                "unavailable" -> Text("Привычка недоступна. Данные не изменены.")
                "completed" -> Text("Цель уже выполнена. Повторная отметка не нужна.")
                "input" -> habit?.let { current ->
                    val entry = workspace.completions.firstOrNull { it.habitId == current.id && it.date == request.target.date }
                    if (HabitMeasurements.effective(HabitMeasurements.rule(current, request.target.date)) != null)
                        HabitMeasurementInputs(current, workspace.measurements, request.target.date, entry, !busy,
                            onRecord = { value, entryId, replaces, note ->
                                repository.recordMeasurement(current.id, request.target.date, value, entryId, replaces, note,
                                    reminderTarget = request.target); Unit
                            }, onQuality = { quality -> complete(quality) })
                    else {
                        if (current.intervalSchedule?.completionMode == "each") {
                            Text("Выберите нужное повторение в карточке привычки.")
                            HabitIntervalMarks(current, entry, !busy) { time, checked -> scope.launch {
                                busy = true
                                try { repository.recordIntervalFromReminder(request.target, time, checked); error = null }
                                catch (cancelled: CancellationException) { throw cancelled }
                                catch (_: Exception) { error = "Не удалось сохранить отметку привычки. Повторите попытку." }
                                finally { busy = false }
                            } }
                        }
                    if (current.qualityScale != "none") {
                        var quality by remember(current.id) { mutableFloatStateOf(if (current.scoringMode == "quality-ten") 5f else 0f) }
                        Text("Качество выполнения · ${quality.toInt()}")
                        Slider(quality, { quality = it }, enabled = !busy,
                            valueRange = if (current.scoringMode == "quality-ten") 1f..10f else -5f..5f,
                            steps = if (current.scoringMode == "quality-ten") 8 else 9)
                        val qualityReady = current.intervalSchedule?.completionMode != "each" || current.intervalSchedule.times().all {
                            it in ru.genesis.calendar.domain.habits.habitIntervalMarks(current, entry) }
                        Button({ scope.launch { complete(quality.toDouble()) } }, enabled = !busy && qualityReady) { Text("Выполнено") }
                    }
                    }
                }
                else -> Button({ scope.launch { complete() } }, enabled = !busy) { Text("Выполнено") }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        }
    }
}
