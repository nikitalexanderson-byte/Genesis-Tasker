package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.trackers.*

/** Management belongs to Habits; Today only records observations for configured trackers. */
@Composable
internal fun AbstinenceScreen(app: GenesisApplication, onBack: () -> Unit) {
    val repo = remember(app, app.workspaceScope) { TrackersRepository(app) }
    val preferences = remember(app, app.workspaceScope) { LocalPreferences(app, app.workspaceScope) }
    val prefs by preferences.values.collectAsStateWithLifecycle(initialValue = UiPreferences())
    val scope = rememberCoroutineScope()
    var data by remember(repo) { mutableStateOf<LocalTrackersWorkspace?>(null) }
    var error by remember(repo) { mutableStateOf<String?>(null) }
    var retry by remember(repo) { mutableIntStateOf(0) }
    var busy by remember(repo) { mutableStateOf(false) }
    var dateValue by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    val date = LocalDate.parse(dateValue)
    var editing by remember(repo) { mutableStateOf<AddictionTracker?>(null) }
    var observation by remember(repo, date) { mutableStateOf<Pair<AddictionTracker, AddictionEntry?>?>(null) }
    var deleting by remember(repo) { mutableStateOf<AddictionTracker?>(null) }
    var actionsOpen by remember { mutableStateOf(false) }
    LaunchedEffect(repo, retry) {
        try { repo.workspace.collect { data = it; error = null } }
        catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { data = null; error = "Защищённые записи недоступны. Сохранённые данные не будут заменены пустыми." }
    }
    fun save(close: () -> Unit = {}, action: suspend () -> Unit) {
        if (busy) return
        busy = true
        scope.launch {
            try { action(); error = null; close() }
            catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: IllegalArgumentException) { error = failure.message ?: "Проверьте введённые данные." }
            catch (_: Exception) { error = "Не удалось сохранить запись. Введённые данные остаются в форме." }
            finally { busy = false }
        }
    }
    // Shell actions compose outside this screen. Observe readiness as state there,
    // so a cold Room emission directly invalidates both create entry points.
    val ready by remember(repo) {
        derivedStateOf { data != null && (data!!.addictionDataLoaded || !app.workspaceScope.startsWith("account-")) }
    }
    val create = {
        error = null
        editing = AddictionTracker(TrackerEntity.create("addiction"), dailySleepSchedule(date, prefs.input))
    }
    val header: @Composable () -> Unit = {
        WorkspaceHeaderButton("Добавить трекер воздержания", "abstinence-create", enabled = ready && !busy,
            onClick = create) { GenesisLucideIcon("plus") }
        Box {
            WorkspaceHeaderButton("Действия", "abstinence-actions", onClick = { actionsOpen = true }) { GenesisLucideIcon("ellipsis") }
            DropdownMenu(actionsOpen, { actionsOpen = false }) {
                DropdownMenuItem(text = { Text("Добавить трекер воздержания") }, leadingIcon = { GenesisLucideIcon("plus") },
                    enabled = ready && !busy, onClick = { actionsOpen = false; create() },
                    modifier = Modifier.testTag("abstinence-action-create"))
                DropdownMenuItem(text = { Text("Сегодня") }, leadingIcon = { GenesisLucideIcon("calendar-days") },
                    enabled = !busy, onClick = { actionsOpen = false; dateValue = LocalDate.now().toString() },
                    modifier = Modifier.testTag("abstinence-action-today"))
                DropdownMenuItem(text = { Text("Обновить") }, leadingIcon = { GenesisLucideIcon("refresh-cw") },
                    enabled = !busy, onClick = { actionsOpen = false; retry++ },
                    modifier = Modifier.testTag("abstinence-action-refresh"))
            }
        }
    }
    val inShell = WorkspaceScreenHeader("Воздержание", navigation = {
        WorkspaceHeaderButton("К привычкам", "abstinence-back", onClick = onBack) { GenesisLucideIcon("chevron-left") }
    }, actions = header, showThemeToggle = false)
    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp).testTag("abstinence-screen"),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!inShell) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            AffairsIconButton("К привычкам", AffairsAction.BACK, onBack)
            Text("Воздержание", Modifier.weight(1f), style = MaterialTheme.typography.titleLarge)
            header()
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AuthorDatePicker(dateValue, prefs.display, enabled = !busy, modifier = Modifier.weight(1f)
                .testTag("abstinence-date")) { dateValue = it }
            FilledTonalButton({ dateValue = LocalDate.now().toString() }, enabled = !busy,
                shape = AffairsLayout.controlShape, modifier = Modifier.heightIn(min = 48.dp).testTag("abstinence-today")) {
                Text("Сегодня", maxLines = 1)
            }
        }
        error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
        if (data == null) {
            if (error == null) WorkspaceLoadingLine(Modifier.fillMaxWidth())
            else TextButton({ retry++ }) { Text("Повторить") }
        } else {
            if (!ready) Text("Обновите данные аккаунта и повторите попытку.")
            if (data!!.addictionTrackers.isEmpty()) Text(
                "Чистые дни, срывы, тяга и триггеры хранятся отдельно от выполнений привычек.",
                color = MaterialTheme.colorScheme.onSurfaceVariant)
            data!!.addictionTrackers.forEach { tracker ->
                val entry = data!!.addictionEntries.firstOrNull { it.trackerId == tracker.id && it.date == date }
                val scheduled = tracker.status == "active" && TrackerSchedules.isScheduled(tracker.schedule, date)
                Surface(Modifier.fillMaxWidth().testTag("abstinence-tracker-${tracker.id}"), shape = AffairsLayout.shape,
                    color = MaterialTheme.colorScheme.surface, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            UntranslatedText(tracker.trackedBehavior, Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                            AffairsIconButton("Изменить", AffairsAction.EDIT, { error = null; editing = tracker },
                                Modifier.testTag("abstinence-edit-${tracker.id}"), enabled = !busy, outlined = false)
                            AffairsIconButton("Удалить", AffairsAction.DELETE, { deleting = tracker }, enabled = !busy, outlined = false)
                        }
                        if (tracker.description.isNotBlank()) UntranslatedText(tracker.description)
                        Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min).testTag("abstinence-actions-${tracker.id}"),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(tracker.status == "active", { save { repo.saveAddiction(tracker.copy(status = "active")) } },
                                enabled = !busy, label = { Text("Активен", Modifier.fillMaxWidth(), textAlign = TextAlign.Center, maxLines = 1) }, shape = AffairsLayout.controlShape,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).fillMaxHeight().testTag("abstinence-active-${tracker.id}"))
                            FilterChip(tracker.status == "paused", { save { repo.saveAddiction(tracker.copy(status = "paused")) } },
                                enabled = !busy, label = { Text("На паузе", Modifier.fillMaxWidth(), textAlign = TextAlign.Center, maxLines = 1) }, shape = AffairsLayout.controlShape,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).fillMaxHeight().testTag("abstinence-paused-${tracker.id}"))
                            Button({ error = null; observation = tracker to entry }, enabled = scheduled && !busy,
                                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 8.dp), shape = AffairsLayout.controlShape,
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).fillMaxHeight().testTag("abstinence-record-${tracker.id}")) {
                                Text("Итог дня", maxLines = 1)
                            }
                        }
                        Text(when { entry?.relapse == true -> "Срыв"; entry?.cleanDay == true -> "Чистый день"; else -> "Не выбрано" },
                            color = if (entry?.relapse == true) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
                        entry?.let { Text("Сила тяги" + ": ${it.cravingIntensity}/10", style = MaterialTheme.typography.bodySmall) }
                        if (!scheduled) Text("На этот день ничего не запланировано.", style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
            Button(create, enabled = ready && !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("abstinence-add")) {
                GenesisLucideIcon("plus", Modifier.size(20.dp))
                Spacer(Modifier.width(8.dp))
                Text("Добавить трекер воздержания", maxLines = 1)
            }
        }
    }
    editing?.let { tracker -> AbstinenceTrackerEditor(tracker, busy, error, { if (!busy) editing = null }) { next ->
        save({ editing = null }) { repo.saveAddiction(next) }
    } }
    observation?.let { (tracker, entry) ->
        AbstinenceObservationEditor(tracker, entry, busy, error, { if (!busy) observation = null }) { clean, relapse, craving, trigger, note ->
            save({ observation = null }) { repo.saveAbstinence(tracker.id, date, clean, relapse, craving, trigger, note, entry?.entity?.version ?: 0) }
        }
    }
    deleting?.let { tracker -> AlertDialog(onDismissRequest = { if (!busy) deleting = null }, title = { Text("Удалить") },
        text = { UntranslatedText(tracker.trackedBehavior) },
        confirmButton = { TextButton({ save({ deleting = null }) { repo.deleteAddiction(tracker.id, tracker.entity.version) } }, enabled = !busy) { Text("Удалить") } },
        dismissButton = { TextButton({ deleting = null }, enabled = !busy) { Text("Отмена") } }) }
}

@Composable
private fun AbstinenceTrackerEditor(tracker: AddictionTracker, busy: Boolean, error: String?, onDismiss: () -> Unit,
    onSave: (AddictionTracker) -> Unit) {
    var behavior by rememberSaveable(tracker.id) { mutableStateOf(tracker.trackedBehavior) }
    var description by rememberSaveable(tracker.id) { mutableStateOf(tracker.description) }
    var points by rememberSaveable(tracker.id) { mutableStateOf(tracker.cleanDayPoints.toString()) }
    var penalty by rememberSaveable(tracker.id) { mutableStateOf(tracker.relapsePenalty.toString()) }
    var schedule by remember(tracker.id) { mutableStateOf(tracker.schedule) }
    var forever by rememberSaveable(tracker.id) { mutableStateOf(tracker.schedule.endDate == null) }
    var zone by rememberSaveable(tracker.id) { mutableStateOf(schedule.timezone) }
    val mode = when (schedule.recurrence.mode) { "classic" -> CalendarMode.PROFANE; "lunar" -> CalendarMode.LUNAR; else -> CalendarMode.SACRED }
    val valid = behavior.isNotBlank() && points.toIntOrNull() in 0..100 && penalty.toIntOrNull() in 0..100 && runCatching { ZoneId.of(zone) }.isSuccess
    Dialog(onDismissRequest = { if (!busy) onDismiss() }) { GenesisModalFrame({ if (!busy) onDismiss() }) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            EditorDialogHeader("Трекер воздержания", "abstinence-editor-close") { if (!busy) onDismiss() }
            Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            OutlinedTextField(behavior, { behavior = it.take(500) }, label = { Text("Наблюдаемое поведение") }, enabled = !busy,
                modifier = Modifier.fillMaxWidth().testTag("abstinence-name"))
            OutlinedTextField(description, { description = it.take(4000) }, label = { Text("Описание") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
            Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(points, { points = it.take(3) }, Modifier.weight(1f).fillMaxHeight(), enabled = !busy,
                    label = { Text("Баллы за чистый день") }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
                OutlinedTextField(penalty, { penalty = it.take(3) }, Modifier.weight(1f).fillMaxHeight(), enabled = !busy,
                    label = { Text("Штраф за срыв", maxLines = 1) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
            }
            if (LocalSacredFeaturesEnabled.current) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                CalendarMode.entries.forEach { next -> FilterChip(mode == next, {
                    schedule = dailySleepSchedule(schedule.startDate, next).copy(endDate = schedule.endDate, timezone = zone)
                }, enabled = !busy, label = { CompactChoiceLabel(when (next) {
                    CalendarMode.SACRED -> "Сакральный"; CalendarMode.LUNAR -> "Лунный"; else -> "Григорианский"
                }) }, modifier = Modifier.weight(1f).heightIn(min = 48.dp)) }
            }
            Text("Начало", style = MaterialTheme.typography.labelLarge)
            AuthorDatePicker(schedule.startDate.toString(), mode, enabled = !busy) { value ->
                val start = LocalDate.parse(value)
                schedule = schedule.copy(startDate = start, recurrence = schedule.recurrence.copy(rangeStart = value))
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Отслеживать всегда", Modifier.weight(1f))
                Switch(forever, { forever = it }, enabled = !busy)
            }
            if (!forever) AuthorDatePicker((schedule.endDate ?: schedule.startDate.plusYears(1)).toString(), mode, enabled = !busy) { value ->
                schedule = schedule.copy(endDate = maxOf(schedule.startDate, LocalDate.parse(value)),
                    recurrence = schedule.recurrence.copy(rangeEnd = value))
            }
            // The recurrence engine and date pickers are shared with native task/sleep scheduling.
            TaskRecurrenceEditor(schedule.recurrence, schedule.startDate.toString(), mode, tracker = true) { recurrence ->
                if (!busy) schedule = schedule.copy(recurrence = recurrence,
                    startDate = runCatching { LocalDate.parse(recurrence.rangeStart) }.getOrDefault(schedule.startDate),
                    endDate = if (forever) null else runCatching { LocalDate.parse(recurrence.rangeEnd) }.getOrNull() ?: schedule.endDate)
            }
            TimeZonePicker(zone, !busy) { selected ->
                zone = selected
                schedule = schedule.copy(timezone = selected, recurrence = schedule.recurrence.copy(
                    calendarContext = schedule.recurrence.calendarContext?.copy(timeZone = selected)))
            }
            error?.let { Text(it, color = MaterialTheme.colorScheme.error) }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onDismiss, enabled = !busy, modifier = Modifier.weight(1f)) { Text("Отмена", maxLines = 1) }
                Button({ onSave(tracker.copy(trackedBehavior = behavior.trim(), description = description,
                    cleanDayPoints = points.toInt(), relapsePenalty = penalty.toInt(), schedule = schedule.copy(timezone = zone,
                        endDate = if (forever) null else schedule.endDate ?: schedule.startDate.plusYears(1)))) },
                    enabled = !busy && valid, modifier = Modifier.weight(1f).testTag("abstinence-tracker-save")) { Text("Сохранить", maxLines = 1) }
            }
        }
    } }
}
