package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import ru.genesis.calendar.ui.UntranslatedText as MaterialText
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.genesis.calendar.data.HabitTimerCommand
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

internal val LocalTimerDisplayMode = staticCompositionLocalOf { CalendarMode.PROFANE }
internal val LocalTimerUse24 = staticCompositionLocalOf { true }

internal fun timerDuration(ms: Long, precise: Boolean = false): String {
    val seconds = ms / 1000
    val main = listOf(seconds / 3600, seconds / 60 % 60, seconds % 60).joinToString(":") { it.toString().padStart(2, '0') }
    return main + if (precise && ms % 1000 != 0L) "." + (ms % 1000).toString().padStart(3, '0') else ""
}
internal fun habitTimerError(error: Throwable): String = when {
    error.message.orEmpty().let { "GOAL_CHANGED" in it || "DATE_UNAVAILABLE" in it } -> "Правило цели изменилось. Проверьте привязку или сохраните только время."
    "TIMER_ACTIVE" in error.message.orEmpty() -> "Уже есть незавершённая сессия. Завершите или отмените её перед новым стартом."
    "TIMER_BUSY" in error.message.orEmpty() -> "В другом окне выполняется действие с таймером. Повторите попытку."
    "TIMER_RESET" in error.message.orEmpty() -> "История привычек была сброшена. Обновите экран перед запуском таймера."
    error.message.orEmpty().let { "CLOCK_CHANGED" in it || "HISTORY_CONFLICT" in it } -> "Системное время изменилось. Проверьте часы устройства; сессия сохранена."
    "OTHER_DEVICE" in error.message.orEmpty() -> "Управляйте этой сессией на устройстве, где она запущена."
    "TIMER_CONFLICT" in error.message.orEmpty() -> "Обнаружены разные состояния сессии. Выберите нужное."
    else -> "Не удалось сохранить сессию. Повторите попытку."
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
internal fun HabitTimerShelf(workspace: LocalHabitWorkspace, owner: String, requestedHabitId: String?, onClose: () -> Unit,
    enabled: Boolean = true, embedded: Boolean = false, excludedHabitIds: Set<String> = emptySet(), onCommand: suspend (HabitTimerCommand) -> Unit) {
    val allSessions = remember(workspace.timers) { HabitTimers.sessions(workspace.timers) }
    val access = LocalFeatureAccess.current
    val allowed = access.allows("habit-timer")
    val upgrade = LocalNativeUpgrade.current
    val sessions = allSessions.filter { session ->
        workspace.habits.firstOrNull { it.id == session.root.habitId }?.timerEnabled != false &&
            (if (embedded) session.root.habitId == requestedHabitId else session.root.habitId !in excludedHabitIds)
    }
    val pending = sessions.filter { it.state?.status !in setOf("saved", "discarded") }
    val habit = workspace.habits.firstOrNull { it.id == requestedHabitId }
    if (habit?.timerEnabled == false) return
    if (habit == null && pending.isEmpty() && requestedHabitId == null && sessions.none { it.state?.status == "saved" }) return
    val language = LocalGenesisLanguage.current; val locale = Locale.forLanguageTag(language)
    val display = LocalTimerDisplayMode.current; val use24 = LocalTimerUse24.current
    val calendar = remember { GenesisCalendar() }
    val lifecycle = LocalLifecycleOwner.current.lifecycle
    val scope = rememberCoroutineScope()
    var now by remember { mutableStateOf(Instant.now()) }
    val preferences = habit?.timerPreferences ?: HabitTimerPreferences()
    var mode by remember(habit?.id, preferences) { mutableStateOf(preferences.modes.first()) }
    var work by remember(habit?.id, preferences) { mutableStateOf(preferences.workMinutes.toString()) }; var rest by remember(habit?.id, preferences) { mutableStateOf(preferences.breakMinutes.toString()) }
    var busy by remember { mutableStateOf(false) }; var error by remember { mutableStateOf<String?>(null) }
    var retry by remember { mutableStateOf<HabitTimerCommand?>(null) }
    var historyOpen by remember { mutableStateOf(false) }; var historyCount by remember { mutableIntStateOf(10) }
    val running = sessions.any { session -> session.heads.any { it.status == "running" } }
    LaunchedEffect(lifecycle, running) {
        if (running) lifecycle.repeatOnLifecycle(Lifecycle.State.STARTED) {
            while (true) { now = Instant.now(); delay(1000) }
        }
    }
    fun execute(command: HabitTimerCommand) {
        if (command.action in setOf("start", "resume") && !access.allows("habit-timer")) { upgrade?.invoke("habit-timer"); return }
        if (busy || !enabled) return
        busy = true; retry = command; error = null
        scope.launch {
            try { onCommand(command); retry = null; if (command.action == "start" && !embedded) onClose() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = habitTimerError(failure) }
            finally { busy = false; now = Instant.now() }
        }
    }
    fun command(action: String, sessionId: String? = null, branchId: String? = null, timeOnly: Boolean = false) =
        HabitTimerCommand(action, owner, HabitTimers.instant(Instant.now()), "habit-timer-${UUID.randomUUID()}", sessionId,
            habit?.id, mode, if (mode == "pomodoro") work.toIntOrNull() ?: 0 else 25,
            if (mode == "pomodoro") rest.toIntOrNull() ?: -1 else 5, branchId, timeOnly)
    fun dateLabel(date: LocalDate): String = if (display == CalendarMode.PROFANE)
        date.format(DateTimeFormatter.ofPattern("d MMMM yyyy", locale)) else calendar.formatDate(date, display)
    fun instantLabel(value: String, zone: String): String {
        val local = Instant.parse(value).atZone(ZoneId.of(zone))
        return dateLabel(local.toLocalDate()) + " · " + local.format(DateTimeFormatter.ofPattern(if (use24) "HH:mm" else "h:mm a", locale))
    }
    fun label(state: HabitTimerState) = when (state.status) {
        "paused" -> "На паузе"; "finished" -> "Завершена"; "saved" -> "Сессия сохранена"; "discarded" -> "Отмена"; else -> "Идёт работа"
    }
    val ownPending = allSessions.any { it.root.owner == owner && it.state?.status !in setOf("saved", "discarded") }
    val validWork = work.matches(Regex("\\d{1,3}")) && (work.toIntOrNull() ?: 0) in 1..180
    val validRest = rest.matches(Regex("\\d{1,3}")) && (rest.toIntOrNull() ?: -1) in 0..120
    OutlinedCard(Modifier.fillMaxWidth().testTag("habit-timer-panel"), shape = AffairsLayout.shape,
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
        colors = CardDefaults.outlinedCardColors(containerColor = MaterialTheme.colorScheme.surfaceContainerLow)) {
        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                Text("Таймер", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
                if (requestedHabitId != null) AffairsIconButton("Свернуть", AffairsAction.COLLAPSE, onClose,
                    Modifier.testTag("habit-timer-collapse"), outlined = false)
            }
            habit?.let { target ->
                if (!allowed) NativeUpgradePrompt("habit-timer")
                MaterialText(target.title, style = MaterialTheme.typography.titleMedium)
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("stopwatch" to "Секундомер", "pomodoro" to "Pomodoro").filter { it.first in preferences.modes }.forEach { (kind, label) ->
                        OutlinedButton(onClick = { mode = kind }, enabled = !busy, selected = mode == kind,
                            modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("habit-timer-mode-$kind").semantics { selected = mode == kind },
                            shape = AffairsLayout.controlShape, contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp),
                            colors = ButtonDefaults.outlinedButtonColors(containerColor = if (mode == kind) MaterialTheme.colorScheme.secondaryContainer else androidx.compose.ui.graphics.Color.Transparent)) {
                            CompactChoiceLabel(label)
                        }
                    }
                    Button(onClick = { execute(command("start")) }, enabled = allowed && enabled && !busy && owner.isNotEmpty() && !ownPending
                        && (mode == "stopwatch" || validWork && validRest),
                        modifier = Modifier.weight(1f).fillMaxHeight().heightIn(min = 48.dp).testTag("habit-timer-start"),
                        contentPadding = PaddingValues(horizontal = 4.dp, vertical = 4.dp)) { Text("Начать", style = MaterialTheme.typography.labelSmall) }
                }
                if (mode == "pomodoro") Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedTextField(work, { work = it.take(3) }, Modifier.weight(1f).testTag("habit-timer-work-minutes"), enabled = !busy,
                        label = { Text("Рабочий интервал, мин", style = MaterialTheme.typography.labelSmall) }, supportingText = { MaterialText("1–180") }, isError = !validWork,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                    OutlinedTextField(rest, { rest = it.take(3) }, Modifier.weight(1f).testTag("habit-timer-rest-minutes"), enabled = !busy,
                        label = { Text("Перерыв, мин", style = MaterialTheme.typography.labelSmall) }, supportingText = { MaterialText("0–120") }, isError = !validRest,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                }
                if (ownPending) Text("Уже есть незавершённая сессия. Завершите или отмените её перед новым стартом.")
                else if (pending.any { it.root.owner != owner }) Text("На другом устройстве уже работает таймер. Здесь начнётся отдельная сессия.")
                if (mode == "pomodoro") Text("Перерыв не засчитывается в прогресс.", style = MaterialTheme.typography.bodySmall)
            }
            for (session in pending) {
                val plan = session.root.plan!!; val state = session.state; val own = session.root.owner == owner
                HorizontalDivider()
                MaterialText(workspace.habits.firstOrNull { it.id == session.root.habitId }?.let { habitDisplayTitle(it) } ?: plan.habitTitle,
                    style = MaterialTheme.typography.titleMedium)
                Text(instantLabel(session.root.at, plan.timeZone), style = MaterialTheme.typography.bodySmall)
                MaterialText(plan.timeZone, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (!own) { Text("Таймер на другом устройстве"); Text("Управляйте этой сессией на устройстве, где она запущена.") }
                if (state == null) {
                    Text("Обнаружены разные состояния сессии. Выберите нужное.", color = MaterialTheme.colorScheme.error)
                    if (session.heads.any { it.status == "saved" }) Text("Сохранённый результат нельзя заменить другой веткой. Исправьте значение в журнале записей.")
                    for (branch in session.heads) TextButton(onClick = { execute(command("resolve", session.id, branch.head.id)) },
                        enabled = enabled && own && !busy && (session.heads.none { it.status == "saved" } || branch.status == "saved")) {
                        Column { Text("Оставить этот вариант"); Text(label(branch)); MaterialText(timerDuration(HabitTimers.reading(branch,
                            maxOf(now, Instant.parse(branch.head.at))).workMs)); Text(instantLabel(branch.head.at, plan.timeZone)) }
                    }
                    continue
                }
                val reading = HabitTimers.reading(state, maxOf(now, Instant.parse(state.head.at)))
                Text(label(state), style = MaterialTheme.typography.labelLarge)
                Text("Рабочее время", style = MaterialTheme.typography.bodySmall)
                MaterialText(timerDuration(reading.workMs, state.status != "running"), style = MaterialTheme.typography.headlineMedium,
                    modifier = Modifier.testTag("habit-timer-work-time"))
                if (plan.mode == "pomodoro") {
                    Text("Время перерывов", style = MaterialTheme.typography.bodySmall); MaterialText(timerDuration(reading.breakMs))
                    if (state.status == "running") { Text(if (reading.onBreak) "Идёт перерыв" else "Идёт работа"); MaterialText(timerDuration(reading.phaseRemainingMs)) }
                }
                if (state.status == "running" && now < Instant.parse(state.head.at))
                    Text("Системное время изменилось. Проверьте часы устройства; сессия сохранена.", color = MaterialTheme.colorScheme.error)
                if (state.status == "finished") Column(Modifier.testTag("habit-timer-review"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Проверка результата", style = MaterialTheme.typography.titleSmall)
                    Text("Время распределяется по датам в часовом поясе цели.", style = MaterialTheme.typography.bodySmall)
                    if (state.allocations.isNullOrEmpty()) Text("Нет рабочего времени")
                    for (row in state.allocations.orEmpty()) {
                        Text(dateLabel(row.date), style = MaterialTheme.typography.titleSmall)
                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) { MaterialText(HabitMeasurements.format(row.value, language)); Text("мин") }
                        val target = workspace.habits.firstOrNull { it.id == session.root.habitId }
                        val period = runCatching { target?.let { HabitMeasurements.rule(it, row.date).periodGoal }?.let { HabitPeriodGoals.period(it, row.date) } }.getOrNull()
                        if (period != null) { Text("Период цели", style = MaterialTheme.typography.labelMedium); Text(dateLabel(period.start) + " – " + dateLabel(period.end.minusDays(1)), style = MaterialTheme.typography.bodySmall) }
                        if (row.reason != "duration") Text(when (row.reason) {
                            "not-duration" -> "Для этой привычки время сохраняется в истории. Значения и отметки добавляются отдельно."
                            "not-scheduled" -> "День не запланирован: время останется в истории без изменения прогресса."
                            else -> "Правило цели изменилось. Проверьте привязку или сохраните только время."
                        }, style = MaterialTheme.typography.bodySmall)
                    }
                    Text("Результат остаётся доступен до успешного сохранения.", style = MaterialTheme.typography.bodySmall)
                }
                if (own) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    val available = enabled && !busy
                    if (state.status == "running") OutlinedButton({ execute(command("pause", session.id)) }, enabled = available,
                        modifier = Modifier.testTag("habit-timer-pause")) { Text("Пауза") }
                    if (state.status == "paused") OutlinedButton({ execute(command("resume", session.id)) }, enabled = available && allowed,
                        modifier = Modifier.testTag("habit-timer-resume")) { Text("Продолжить") }
                    if (state.status in setOf("running", "paused")) Button({ execute(command("finish", session.id)) }, enabled = available,
                        modifier = Modifier.testTag("habit-timer-finish")) { Text("Завершить сессию") }
                    if (state.status == "finished") {
                        Button({ execute(command("save", session.id)) }, enabled = available,
                            modifier = Modifier.testTag("habit-timer-save")) { Text("Сохранить") }
                        if (state.allocations.orEmpty().any { it.reason == "rule-conflict" || it.reason == "duration" && it.value > 0 }) OutlinedButton(
                            { execute(command("save", session.id, timeOnly = true)) }, enabled = available) { Text("Сохранить только время") }
                    }
                    TextButton({ execute(command("discard", session.id)) }, enabled = available) { Text("Отменить сессию") }
                }
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            retry?.takeIf { error != null }?.let { command -> OutlinedButton({ execute(command) }, enabled = enabled && !busy,
                modifier = Modifier.testTag("habit-timer-retry")) { Text("Повторить") } }
            val history = sessions.filter { it.state?.status == "saved" && (requestedHabitId == null || it.root.habitId == requestedHabitId) }
            if (history.isNotEmpty()) {
                TextButton({ historyOpen = !historyOpen }) { Text("История сессий"); MaterialText(" · ${history.size}") }
                if (historyOpen) {
                    for (session in history.take(historyCount)) {
                        val plan = session.root.plan!!
                        MaterialText(workspace.habits.firstOrNull { it.id == session.root.habitId }?.let { habitDisplayTitle(it) }
                            ?: plan.habitTitle, style = MaterialTheme.typography.titleSmall)
                        Text(instantLabel(session.root.at, plan.timeZone), style = MaterialTheme.typography.bodySmall)
                        MaterialText(timerDuration(HabitTimers.reading(session.state!!, now).workMs, true))
                    }
                    if (history.size > historyCount) TextButton({ historyCount += 10 }) { Text("Показать ещё") }
                }
            }
        }
    }
}
