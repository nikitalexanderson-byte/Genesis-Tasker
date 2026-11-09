package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material3.*
import ru.genesis.calendar.ui.UntranslatedText as MaterialText
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import java.time.*
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.data.*
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*

@Composable internal fun HabitHistoryPanel(workspace: LocalHabitWorkspace, repository: HabitsRepository,
    mode: ru.genesis.calendar.domain.CalendarMode, focus: Pair<String,LocalDate>? = null,
    selectedHabitId: String? = null, onFocusConsumed: () -> Unit = {}) {
    val app = LocalContext.current.applicationContext as GenesisApplication
    val preferences = remember(app) { LocalPreferences(app, app.workspaceScope) }
    val prefs by preferences.values.collectAsState(initial = UiPreferences())
    val use24 = prefs.use24
    var historyVisible by rememberSaveable(app.workspaceScope) { mutableStateOf(false) }
    val historyState = rememberSaveableStateHolder()
    var expanded by rememberSaveable { mutableStateOf(false) }
    var selected by rememberSaveable { mutableStateOf(workspace.habits.firstOrNull()?.id.orEmpty()) }
    val habit = workspace.habits.firstOrNull { it.id == selected } ?: workspace.habits.firstOrNull()
    var dateValue by rememberSaveable { mutableStateOf("") }
    val historyFocus = remember { BringIntoViewRequester() }
    var requestedFocus by remember { mutableStateOf(false) }
    LaunchedEffect(selectedHabitId) {
        if (selectedHabitId != null && focus == null) {
            historyVisible = true
            selected = selectedHabitId
            dateValue = ""
            expanded = false
        }
    }
    LaunchedEffect(focus) { focus?.let { historyVisible=true;selected=it.first;dateValue=it.second.toString();expanded=true;requestedFocus=true;onFocusConsumed() } }
    LaunchedEffect(requestedFocus, expanded, historyVisible) { if (requestedFocus && expanded && historyVisible) { withFrameNanos { }; historyFocus.bringIntoView(); requestedFocus=false } }
    var visible by rememberSaveable { mutableIntStateOf(30) }
    val disclosureState = genesisTranslate(if (historyVisible) "Развёрнуто" else "Свёрнуто")
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(onClick = { historyVisible = !historyVisible },
            modifier = Modifier.fillMaxWidth().testTag("habit-history-disclosure")
                .semantics { stateDescription = disclosureState }) {
            Text("История отметок", Modifier.weight(1f))
            AffairsActionIcon(if (historyVisible) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
        }
        if (historyVisible) historyState.SaveableStateProvider("history") {
            Column(Modifier.fillMaxWidth().testTag("habit-history-content"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                val contextualHistory = selectedHabitId != null && selected.isNotBlank()
                val historyEntries = workspace.completions.filter { !contextualHistory || it.habitId == selected }
                if (contextualHistory && habit != null) {
                    MaterialText(habitDisplayTitle(habit), style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.testTag("habit-history-selected-title"))
                    TextButton(onClick = { selected = ""; expanded = false; visible = 30 },
                        modifier = Modifier.heightIn(min = 48.dp)) { Text("Все привычки") }
                    if (historyEntries.isEmpty()) Text("История появится после первой отметки.")
                }
                TextButton(onClick = { expanded = !expanded }, shape = AffairsLayout.controlShape,
                    modifier = Modifier.heightIn(min = 48.dp).bringIntoViewRequester(historyFocus).testTag("habit-history-toggle")) { Text("Исправить историю") }
                if (expanded && habit != null) {
                    val rule = HabitMeasurements.rule(habit, dateValue.takeIf { it.isNotEmpty() }?.let(LocalDate::parse) ?: habit.createdDate)
                    val yesterday = LocalDate.now(ZoneId.of(rule.schedule.timezone)).minusDays(1)
                    val date = dateValue.takeIf { it.isNotEmpty() }?.let(LocalDate::parse) ?: yesterday
                    Text("Историческая корректировка меняет статистику и серии. XP и Лавры не начисляются; выданные награды и потраченная защита сохраняются.",
                        style = MaterialTheme.typography.bodySmall)
                    HistoryChoice("Привычка", habitDisplayTitle(habit), workspace.habits.map { it.id to habitDisplayTitle(it) }, userContent = true) { selected = it; dateValue = "" }
                    Text("Прошлая дата", style = MaterialTheme.typography.labelLarge)
                    if (yesterday >= habit.createdDate) AuthorDatePicker(date.toString(), mode, minDate = habit.createdDate, maxDate = yesterday,
                        calculationContext = ru.genesis.calendar.domain.CalendarContext(timeZone = rule.schedule.timezone,
                            gregorianYearStart = if(prefs.gregorianYearStartsInMarch) "march" else "january")) { dateValue = it }
                    key(habit.id, date) { HabitHistoryForm(workspace, repository, habit, date, mode, use24) }
                }
                historyEntries.sortedByDescending { it.date }.take(visible).forEach { entry ->
                    val target = workspace.habits.firstOrNull { it.id == entry.habitId } ?: return@forEach
                    TextButton(onClick = { selected = target.id; dateValue = entry.date.toString(); expanded = true }) {
                        Text("${entry.date} · ${target.title} · ${if (entry.completed) genesisTranslate("Выполнено") else genesisTranslate("Отметка снята")}",
                            style = MaterialTheme.typography.bodySmall)
                    }
                }
                if (historyEntries.size > visible) TextButton(onClick = { visible += 30 }) { Text("Показать ещё") }
            }
        }
    }
}

@Composable private fun HistoryChoice(label: String, selected: String, choices: List<Pair<String, String>>, userContent: Boolean = false, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Column {
        Text(label, style = MaterialTheme.typography.labelLarge)
        OutlinedButton(onClick = { open = true }, shape = AffairsLayout.controlShape, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { if(userContent) MaterialText(selected) else Text(selected) }
        DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
            choices.forEach { (id, title) -> DropdownMenuItem(text = { if(userContent) MaterialText(title) else Text(title) }, onClick = { open = false; onChange(id) }) }
        }
    }
}

@Composable private fun HabitHistoryForm(workspace: LocalHabitWorkspace, repository: HabitsRepository, habit: Habit,
    date: LocalDate, mode: ru.genesis.calendar.domain.CalendarMode, use24: Boolean) {
    val original = workspace.completions.firstOrNull { it.habitId == habit.id && it.date == date }
    val rule = HabitMeasurements.rule(habit, date); val definition = HabitMeasurements.effective(rule)
    val history = HabitHistory.state(workspace.history, habit.id, date)
    val measured = if (definition != null) HabitMeasurements.progress(habit, date, workspace.measurements) else null
    var completed by rememberSaveable { mutableStateOf(original?.completed ?: false) }
    var times by rememberSaveable { mutableStateOf(ArrayList(original?.completedTimes.orEmpty())) }
    var quality by rememberSaveable { mutableStateOf(original?.qualityValue?.toString().orEmpty()) }
    var note by rememberSaveable { mutableStateOf(original?.note.orEmpty()) }
    var amount by rememberSaveable { mutableStateOf("") }; var entryId by rememberSaveable { mutableStateOf("") }
    var remove by rememberSaveable { mutableStateOf(false) }
    var preview by remember { mutableStateOf<Pair<HabitHistoryCommand, LocalHabitWorkspace>?>(null) }
    var error by remember { mutableStateOf("") }; var saved by remember { mutableStateOf(false) }; var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    val language = LocalGenesisLanguage.current
    val unit = if(definition?.kind == "duration") genesisTranslate("мин") else definition?.unit.orEmpty()
    fun amountLabel(value: Long) = (HabitMeasurements.format(value,language) + " " + unit).trim()
    fun changed() { preview = null; error = ""; saved = false }
    val entry = measured?.entries?.firstOrNull { it.id == entryId }
    val slots = habit.intervalSchedule?.takeIf { it.completionMode == "each" }?.times().orEmpty()
    Column(Modifier.fillMaxWidth().testTag("habit-history-form"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        MaterialText(habitDisplayTitle(habit), style = MaterialTheme.typography.titleMedium)
        Text(GenesisCalendar(ZoneId.of(rule.schedule.timezone)).formatDate(date, mode) + " · " + rule.schedule.timezone)
        if (history.conflict || measured?.entries?.any { it.conflict } == true) Text("Одновременные исправления. Выберите правильное значение.", color = MaterialTheme.colorScheme.error)
        if (definition != null) {
            HistoryChoice("Записи", entry?.current?.value?.let { (it / 1000.0).toString() } ?: genesisTranslate("Добавить значение"),
                listOf("" to genesisTranslate("Добавить значение")) + measured!!.entries.map { row -> row.id to
                    (row.current?.value?.let { (it / 1000.0).toString() } ?: genesisTranslate("Запись удалена")) }) {
                entryId = it; amount = measured.entries.firstOrNull { row -> row.id == it }?.current?.value?.let { value -> (value / 1000.0).toString() }.orEmpty()
                remove = false; changed()
            }
            if (rule.measurement != null) OutlinedTextField(value = amount, onValueChange = { amount = it; changed() }, enabled = !busy && !remove,
                label = { Text("Значение") }, supportingText = { if(definition.kind == "duration") Text("мин") else MaterialText(definition.unit) }, modifier = Modifier.fillMaxWidth())
            if (entry != null) Row { Checkbox(checked = remove, onCheckedChange = { remove = it; changed() }, enabled = !busy); Text("Удалить запись") }
            measured.entries.filter { it.conflict }.forEach { conflict -> conflict.heads.forEach { head ->
                OutlinedButton(enabled = !busy, onClick = { entryId = conflict.id; amount = head.value?.let { (it/1000.0).toString() }.orEmpty();remove = head.value == null;note=head.note;changed() }) {
                    Text(genesisTranslate("Оставить {value}").replace("{value}",head.value?.let(::amountLabel) ?: genesisTranslate("Запись удалена")))
                }
            } }
        } else if (slots.isNotEmpty()) slots.forEach { time -> Row {
            Checkbox(checked = time in times, onCheckedChange = { checked -> times = ArrayList(if (checked) times + time else times - time); changed() }, enabled = !busy)
            Text(timeLabel(time, use24))
        } } else Row { Checkbox(checked = completed, onCheckedChange = { completed = it; changed() }, enabled = !busy); Text("Выполнено") }
        if (habit.qualityScale != "none") HistoryChoice("Качество", quality.ifEmpty { "—" }, listOf("" to "—") +
            (if (habit.qualityScale == "ten") 1..10 else -5..5).map { it.toDouble().toString() to it.toString() }) { quality = it; changed() }
        OutlinedTextField(value = note, onValueChange = { note = it.take(2000); changed() }, enabled = !busy,
            label = { Text("Заметка") }, modifier = Modifier.fillMaxWidth())
        if (preview == null) OutlinedButton(enabled = !busy, onClick = {
            try {
                val at = Instant.now().toString(); val value = HabitHistoryValue(if (definition != null) measured!!.completed else if (slots.isNotEmpty()) slots.all { it in times } else completed,
                    times, quality.toDoubleOrNull(), if (habit.qualityScale != "none" && quality.toDoubleOrNull() != null) at else null, note)
                val measurement = if (definition != null && (remove || amount.isNotEmpty() || rule.measurement == null)) {
                    val number = if (remove) null else if (rule.measurement == null) 1000L else requireNotNull(HabitMeasurements.parse(amount))
                    require(!remove || entry != null)
                    HabitHistoryMeasurement(number, entry?.id, entry?.heads?.map { it.entity.id }.orEmpty(), note)
                } else null
                val command = HabitHistoryCommand("habit-history-${UUID.randomUUID()}", at, habit.id, date, rule.id,
                    history.heads.map { it.entity.id }, value, measurement)
                val next = HabitHistory.apply(workspace, command)
                preview = command to reconcileHabitWorkspace(next, LocalDate.now(), ZoneId.systemDefault().id, at); error = ""; saved = false
            } catch (_: Exception) { error = "В этот день запись недоступна. Проверьте дату, значение и действующее правило." }
        }) { Text("Предпросмотр изменений") }
        preview?.let { (command, after) ->
            Text("Предпросмотр изменений", style = MaterialTheme.typography.titleSmall)
            Text(genesisTranslate("Выполнено") + ": ${workspace.completions.count { it.date == date && it.completed }} → ${after.completions.count { it.date == date && it.completed }}")
            Text(genesisTranslate("Текущая серия") + ": ${workspace.progress.currentStreak} → ${after.progress.currentStreak}")
            if(measured != null) Text(genesisTranslate("Значение") + ": ${amountLabel(measured.total)} → ${amountLabel(HabitMeasurements.progress(habit,date,after.measurements).total)}")
            if(habit.qualityScale != "none") Text(genesisTranslate("Качество") + ": ${original?.qualityValue ?: "—"} → ${after.completions.firstOrNull { it.habitId == habit.id && it.date == date }?.qualityValue ?: "—"}")
            val beforePeriod = HabitPeriodGoals.progress(habit,date,workspace.measurements,workspace.completions)
            val afterPeriod = HabitPeriodGoals.progress(habit,date,after.measurements,after.completions)
            if(beforePeriod != null && afterPeriod != null) {
                fun periodLabel(value:Long) = if(afterPeriod.goal.metric == "sum") amountLabel(value) else value.toString()
                Text(genesisTranslate("Цель периода") + ": ${periodLabel(beforePeriod.qualifiedValue)} → ${periodLabel(afterPeriod.qualifiedValue)} / ${periodLabel(afterPeriod.goal.target)}")
            }
            Text("Цели и статистика будут пересчитаны. Квесты и достижения задним числом не выдаются.", style = MaterialTheme.typography.bodySmall)
            Button(enabled = !busy, onClick = { scope.launch {
                busy = true
                try { repository.correctHistory(command); preview = null; amount = ""; entryId = ""; remove = false; saved = true; error = "" }
                catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { error = "Не удалось исправить историю. Обновите данные и повторите." }
                finally { busy = false }
            } }) { Text("Сохранить") }
        }
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error)
        if (saved) Text("Запись исправлена.")
        if (history.rows.isNotEmpty()) {
            Text("История исправлений", style = MaterialTheme.typography.titleSmall)
            history.rows.forEach { row ->
                val at = Instant.parse(row.entity.createdAt).atZone(ZoneId.of(rule.schedule.timezone))
                Text("${at.toLocalDate()} · ${timeLabel(at.toLocalTime().toString().take(5), use24)} · ${genesisTranslate(if (row.value.completed) "Выполнено" else "Отметка снята")}", style = MaterialTheme.typography.bodySmall)
                workspace.measurements.firstOrNull { it.entity.id == "${row.entity.id}:value" }?.let { measurement ->
                    Text(measurement.value?.let(::amountLabel) ?: genesisTranslate("Запись удалена"),style=MaterialTheme.typography.bodySmall)
                }
                if (row.value.note.isNotEmpty()) MaterialText(row.value.note, style = MaterialTheme.typography.bodySmall)
                if (history.conflict && row in history.heads) TextButton(onClick = {
                    completed = row.value.completed; times = ArrayList(row.value.completedTimes); quality = row.value.qualityValue?.toString().orEmpty(); note = row.value.note; changed()
                }) { Text("Выбрать") }
            }
        }
        if(measured?.entries?.isNotEmpty() == true) {
            var recordsOpen by rememberSaveable { mutableStateOf(false) }
            TextButton(onClick={recordsOpen = !recordsOpen}) { Text("Записи") }
            if(recordsOpen) measured.entries.forEach { record -> record.revisions.forEach { revision ->
                val at = Instant.parse(revision.entity.createdAt).atZone(ZoneId.of(rule.schedule.timezone))
                Text("${at.toLocalDate()} · ${timeLabel(at.toLocalTime().toString().take(5),use24)}",style=MaterialTheme.typography.bodySmall)
                Text(revision.value?.let(::amountLabel) ?: genesisTranslate("Запись удалена"),style=MaterialTheme.typography.bodySmall)
                if(revision.note.isNotEmpty()) MaterialText(revision.note,style=MaterialTheme.typography.bodySmall)
            } }
        }
    }
}
