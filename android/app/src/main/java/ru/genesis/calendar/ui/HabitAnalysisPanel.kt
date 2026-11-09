package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.material3.*
import ru.genesis.calendar.ui.UntranslatedText as MaterialText
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.unit.dp
import java.text.NumberFormat
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

internal val habitActivityLabels = mapOf("completed" to "Выполнено", "activity" to "Активность", "partial" to "Частично",
    "quality-pending" to "Ожидает качества", "skipped" to "Осознанный пропуск", "unmarked" to "Без отметки выполнения", "missing" to "Нет записи", "conflict" to "Конфликт")

@Composable internal fun HabitAnalysisPanel(workspace: LocalHabitWorkspace, today: LocalDate, initialMode: CalendarMode,
    onOpenHistory: (String, LocalDate) -> Unit, onDecision: suspend (HabitDayDecisionCommand) -> Unit) {
    val app = LocalContext.current.applicationContext as GenesisApplication
    val preferences = remember(app, app.workspaceScope) { LocalPreferences(app, app.workspaceScope) }
    val prefs by preferences.values.collectAsState(initial = UiPreferences())
    val language = LocalGenesisLanguage.current; val locale = Locale.forLanguageTag(language)
    val number = NumberFormat.getNumberInstance(locale).apply { maximumFractionDigits = 1 }
    var selectedId by rememberSaveable { mutableStateOf("") }; val habit = workspace.habits.firstOrNull { it.id == selectedId } ?: workspace.habits.firstOrNull()
    var year by rememberSaveable { mutableStateOf(false) }
    var anchorValue by rememberSaveable { mutableStateOf(today.toString()) }; var selectedDate by rememberSaveable { mutableStateOf("") }
    val enabled = LocalEnabledCalendars.current; val mode = initialMode.takeIf { it in enabled } ?: enabled.firstOrNull() ?: initialMode
    val context = CalendarContext(timeZone = ZoneId.systemDefault().id, gregorianYearStart = if (prefs.gregorianYearStartsInMarch) "march" else "january")
    val calendar = remember(context) { GenesisCalendar(ZoneId.of(context.timeZone), context.version, context.gregorianYearStart) }
    val anchor = LocalDate.parse(anchorValue); val period = if (year) calendar.yearRange(anchor, mode) else calendar.monthRange(anchor, mode)
    val range = HabitGoalPeriod(period.start, period.end.plusDays(1))
    val report by produceState<HabitRangeAnalysis?>(null, workspace, habit?.id, range) {
        value = null
        value = habit?.let { withContext(Dispatchers.Default) { HabitAnalysis.range(workspace, it, range) } }
    }
    val comparison by produceState<HabitGoalComparison?>(null, workspace, mode, context, today) {
        value = null; value = withContext(Dispatchers.Default) { HabitAnalysis.comparison(workspace, today, mode, context) }
    }
    val records by produceState<HabitRangeAnalysis?>(null, workspace, habit?.id, today) {
        value = null
        value = habit?.takeIf { it.createdDate <= today }?.let { withContext(Dispatchers.Default) { HabitAnalysis.range(workspace, it, HabitGoalPeriod(it.createdDate, today.plusDays(1))) } }
    }
    fun percent(value: Double?) = value?.let { number.format(it) + "%" } ?: "—"
    var choiceOpen by remember { mutableStateOf(false) }
    fun periodLabel(date: LocalDate) = if (mode == CalendarMode.PROFANE)
        date.format(DateTimeFormatter.ofPattern("d MMM yyyy", locale)) else calendar.formatDate(date, mode)
    Column(Modifier.fillMaxWidth().testTag("habit-analysis"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text("Календарь выполнения привычек", style = MaterialTheme.typography.titleLarge)
        HabitAnalysisBlock("Привычка и период", "habit-analysis-controls") {
            if (habit == null) Text("Создайте привычку, чтобы увидеть её историю.") else {
                Box {
                    OutlinedButton({ choiceOpen = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("habit-analysis-habit"), shape = AffairsLayout.controlShape) { MaterialText(habitDisplayTitle(habit)) }
                    DropdownMenu(choiceOpen, { choiceOpen = false }) { workspace.habits.forEach { item ->
                        DropdownMenuItem({ MaterialText(habitDisplayTitle(item)) }, { selectedId = item.id; selectedDate = ""; choiceOpen = false })
                    } }
                }
            }
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!year, { year = false }, { Text("Месяц") }, shape = AffairsLayout.controlShape, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("habit-analysis-month"))
                FilterChip(year, { year = true }, { Text("Год") }, shape = AffairsLayout.controlShape, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("habit-analysis-year"))
            }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                AffairsIconButton("Назад", AffairsAction.BACK, { anchorValue = period.start.minusDays(1).toString(); selectedDate = "" }, Modifier.testTag("habit-analysis-previous"), outlined = false)
                Text(periodLabel(period.start) + " — " + periodLabel(period.end), Modifier.weight(1f).padding(horizontal = 8.dp).testTag("habit-analysis-period"),
                    textAlign = androidx.compose.ui.text.style.TextAlign.Center, style = MaterialTheme.typography.titleSmall)
                AffairsIconButton("Вперёд", AffairsAction.NEXT, { anchorValue = period.end.plusDays(1).toString(); selectedDate = "" }, Modifier.testTag("habit-analysis-next"), outlined = false)
            }
        }
        if (habit != null) {
            val data = report
            if (data == null) WorkspaceLoadingLine(Modifier.fillMaxWidth()) else {
                HabitAnalysisBlock("Итоги периода", "habit-analysis-summary") {
                    Text("Проценты целей и объёма рассчитываются отдельно.", style = MaterialTheme.typography.bodySmall)
                    Text("Успешные закрытые цели", style = MaterialTheme.typography.labelLarge)
                    MaterialText("${number.format(data.completedCount)}/${number.format(data.closedCount)} · ${percent(data.completionPercent)}", Modifier.testTag("habit-goal-rate"), style = MaterialTheme.typography.titleMedium)
                    for (volume in data.volumes) {
                        Text("Факт / план объёма", style = MaterialTheme.typography.labelLarge)
                        MaterialText("${HabitMeasurements.format(volume.actual, language)} / ${if (volume.hasPlan) HabitMeasurements.format(volume.target, language) else "—"} " +
                            (if (volume.kind == "duration") genesisTranslate("мин") else volume.unit) + " · " + percent(volume.percent), Modifier.testTag("habit-volume-${volume.kind}-${volume.plan}"))
                        for ((label, amount) in listOf("Открытый период" to volume.openActual, "Вне плана" to volume.extraActual, "Доступность неизвестна" to volume.unknownActual)) if (amount > 0)
                            MaterialText(genesisTranslate(label) + ": " + HabitMeasurements.format(amount, language), style = MaterialTheme.typography.bodySmall)
                    }
                    Text("В процент целей входят только закрытые возможности с известным расписанием. Текущий открытый период показан отдельно.", style = MaterialTheme.typography.bodySmall)
                    MaterialText(genesisTranslate("Доступность неизвестна") + ": " + number.format(data.unknownDays), style = MaterialTheme.typography.bodySmall)
                    MaterialText(genesisTranslate("Открытый период") + ": " + number.format(data.open.size), style = MaterialTheme.typography.bodySmall)
                }
                HabitAnalysisBlock("Календарь выполнения", "habit-analysis-calendar") {
                    val groups = data.days.groupBy { calendar.monthRange(it.date, mode).start }
                    for ((month, days) in groups) {
                        Text(if (mode == CalendarMode.PROFANE) month.format(DateTimeFormatter.ofPattern("LLLL yyyy", locale))
                            .replaceFirstChar { it.titlecase(locale) } else calendar.formatDate(month, mode), style = MaterialTheme.typography.titleSmall)
                        BoxWithConstraints(Modifier.fillMaxWidth().testTag("habit-analysis-grid-$month")) {
                            // Six sequential dates per row; day31 occupies the bottom-right cell.
                            // The seventh column remains a complete, unlabelled grid for shorter months.
                            val byDay = days.associateBy { when (mode) {
                                CalendarMode.PROFANE -> it.date.dayOfMonth
                                CalendarMode.SACRED -> calendar.sacredDate(it.date).day
                                CalendarMode.LUNAR -> calendar.lunarDate(it.date).day
                            } }
                            val slots = (0 until 35).map { index ->
                                val row = index / 7; val column = index % 7
                                val day = if (column < 6) row * 6 + column + 1 else if (row == 4) 31 else 0
                                byDay[day]
                            }
                            val cellWidth = ((maxWidth - 12.dp) / 7).coerceAtLeast(48.dp)
                            Column(Modifier.horizontalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                            for (week in slots.chunked(7)) Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                for (day in week) {
                                    if (day == null) {
                                        Surface(Modifier.width(cellWidth).height(48.dp), shape = AffairsLayout.shape,
                                            color = MaterialTheme.colorScheme.surfaceContainerLow) {}
                                    } else {
                                    val label = habitAnalysisStateLabel(day)
                                    val description = calendar.formatDate(day.date, mode) + " · " + label
                                    val ink = if (day.activity == "conflict") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
                                    Surface(shape = AffairsLayout.shape, color = if (selectedDate == day.date.toString()) MaterialTheme.colorScheme.primaryContainer
                                        else if (day.activity == "completed") MaterialTheme.colorScheme.secondaryContainer else MaterialTheme.colorScheme.surfaceContainerLow) {
                                        TextButton({ selectedDate = day.date.toString() }, selected = selectedDate == day.date.toString(),
                                            enabled = !day.future && !day.beforeCreation, shape = AffairsLayout.controlShape,
                                            modifier = Modifier.width(cellWidth).height(48.dp).testTag("habit-analysis-day-${day.date}")
                                                .semantics { contentDescription = description; selected = selectedDate == day.date.toString() }, contentPadding = PaddingValues(4.dp)) {
                                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                                MaterialText(number.format(when (mode) { CalendarMode.PROFANE -> day.date.dayOfMonth; CalendarMode.SACRED -> calendar.sacredDate(day.date).day; CalendarMode.LUNAR -> calendar.lunarDate(day.date).day }), color = ink)
                                                HabitAnalysisDayMarker(day)
                                            }
                                        }
                                    }
                                    }
                                }
                            }
                            }
                        }
                    }
                    data.days.firstOrNull { it.date.toString() == selectedDate }?.let { day ->
                        HabitAnalysisSource(workspace, habit, day, calendar, mode, prefs.use24, onOpenHistory, onDecision)
                    }
                }
            }
            HabitAnalysisBlock("Личные рекорды и мастерство", "habit-analysis-records") {
                records?.let { personal ->
                    var run = 0; var best = 0
                    for (goal in personal.opportunities.filter { it.eligible || !it.closed && it.completed && it.availabilityKnown && !it.conflict }.sortedBy { it.start }) {
                        run = if (goal.completed) run + 1 else 0; best = maxOf(best, run)
                    }
                    MaterialText(genesisTranslate("Текущая серия") + ": " + number.format(run) + " · " + genesisTranslate("Лучшая серия") + ": " + number.format(best), Modifier.testTag("habit-personal-streaks"))
                    MaterialText(genesisTranslate("Успешные закрытые цели") + ": " + number.format(personal.completedCount) + "/" + number.format(personal.closedCount) + " · " + percent(personal.completionPercent))
                }
            }
        }
        HabitAnalysisBlock(null, "habit-analysis-comparison") {
            AffairsDisclosure("Сравнение") {
                comparison?.let { data -> HabitComparisonDetails(data, calendar, mode) }
            }
        }
    }
}

@Composable
private fun HabitAnalysisBlock(title: String?, tag: String, content: @Composable ColumnScope.() -> Unit) {
    Card(Modifier.fillMaxWidth().testTag(tag), shape = AffairsLayout.shape,
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        border = androidx.compose.foundation.BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            title?.let { Text(it, style = MaterialTheme.typography.titleMedium) }
            content()
        }
    }
}

/** Distinct shapes keep the mosaic readable without relying on color. Full meaning is in each date label. */
@Composable private fun HabitAnalysisDayMarker(day: HabitAnalysisDay) {
    val ink = LocalContentColor.current
    Canvas(Modifier.size(10.dp)) {
        val unit = size.width / 10
        fun segment(x: Float, y: Float, a: Float, b: Float) = drawLine(ink, Offset(x * unit, y * unit), Offset(a * unit, b * unit), unit, StrokeCap.Round)
        when {
            day.beforeCreation || day.future -> Unit
            day.availability == "paused" -> { segment(3f, 2f, 3f, 8f); segment(7f, 2f, 7f, 8f) }
            day.availability == "archived" || day.availability == "deleted" -> drawRect(ink, Offset(2 * unit, 3 * unit), androidx.compose.ui.geometry.Size(6 * unit, 4 * unit), style = Stroke(unit))
            day.activity == "conflict" -> { segment(2f, 2f, 8f, 8f); segment(8f, 2f, 2f, 8f) }
            day.activity == "completed" -> { segment(1f, 5f, 4f, 8f); segment(4f, 8f, 9f, 2f) }
            day.activity == "skipped" -> segment(2f, 8f, 8f, 2f)
            day.activity == "quality-pending" -> {
                val path = Path().apply { moveTo(5 * unit, unit); lineTo(9 * unit, 5 * unit); lineTo(5 * unit, 9 * unit); lineTo(unit, 5 * unit); close() }
                drawPath(path, ink, style = Stroke(unit))
            }
            day.activity == "partial" -> drawArc(ink, -90f, 180f, false, Offset(unit, unit), androidx.compose.ui.geometry.Size(8 * unit, 8 * unit), style = Stroke(unit))
            day.activity == "activity" -> drawCircle(ink, 2 * unit)
            day.activity == "unmarked" || !day.scheduled -> segment(2f, 5f, 8f, 5f)
        }
    }
}

@Composable internal fun habitAnalysisStateLabel(day: HabitAnalysisDay): String = when {
    day.beforeCreation -> genesisTranslate("До начала привычки")
    day.future -> genesisTranslate("Будущее")
    day.availability != "active" -> genesisTranslate(habitLifecycleLabels.getValue(day.availability)) + " · " + genesisTranslate(habitActivityLabels.getValue(day.activity))
    !day.scheduled -> genesisTranslate("Отдых") + " · " + genesisTranslate(habitActivityLabels.getValue(day.activity))
    else -> genesisTranslate(habitActivityLabels.getValue(day.activity))
}

@Composable private fun HabitAnalysisSource(workspace: LocalHabitWorkspace, habit: Habit, day: HabitAnalysisDay,
    calendar: GenesisCalendar, mode: CalendarMode, use24: Boolean, onOpenHistory: (String, LocalDate) -> Unit,
    onDecision: suspend (HabitDayDecisionCommand) -> Unit) {
    val scope = rememberCoroutineScope(); val language = LocalGenesisLanguage.current; val locale = Locale.forLanguageTag(language)
    var busy by remember { mutableStateOf(false) }; var message by remember { mutableStateOf("") }
    var pending by remember(habit.id, day.date) { mutableStateOf<HabitDayDecisionCommand?>(null) }
    val sourceFocus = remember { BringIntoViewRequester() }
    LaunchedEffect(habit.id, day.date) { withFrameNanos { }; sourceFocus.bringIntoView() }
    fun instant(value: String): String {
        val time = Instant.parse(value).atZone(ZoneId.of(HabitMeasurements.rule(habit, day.date).schedule.timezone))
        return time.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(locale)) + " · " + time.format(DateTimeFormatter.ofPattern(if (use24) "HH:mm" else "h:mm a", locale))
    }
    Column(Modifier.fillMaxWidth().testTag("habit-analysis-source"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text(calendar.formatDate(day.date, mode), Modifier.bringIntoViewRequester(sourceFocus), style = MaterialTheme.typography.titleMedium)
        MaterialText(habitAnalysisStateLabel(day))
        MaterialText(genesisTranslate("Факт") + ": " + (if (day.kind == "binary") if (day.completed) "1" else "0" else HabitMeasurements.format(day.volume, language)) +
            " " + (if (day.kind == "duration") genesisTranslate("мин") else day.unit.orEmpty()) + (day.target?.let { " · " + genesisTranslate("План") + ": " +
                if (day.kind == "binary") it.toString() else HabitMeasurements.format(it, language) } ?: ""))
        day.completion?.let { row ->
            MaterialText(genesisTranslate("Выданные XP") + ": " + NumberFormat.getIntegerInstance(locale).format(row.xpAwarded))
            if (row.note.isNotEmpty()) MaterialText(row.note)
        }
        Text("Исходные записи", style = MaterialTheme.typography.titleSmall)
        val events = workspace.measurements.filter { it.habitId == habit.id && it.date == day.date }.sortedBy { it.entity.createdAt }
        val edits = workspace.history.filter { it.habitId == habit.id && it.date == day.date }
        for (event in events) {
            MaterialText(event.entity.id, Modifier.testTag("habit-source-${event.entity.id}"), style = MaterialTheme.typography.labelSmall)
            MaterialText(instant(event.entity.createdAt) + " · " + (event.value?.let { HabitMeasurements.format(it, language) } ?: genesisTranslate("Запись удалена")))
            Text(when (event.source) { "timer" -> "Таймер"; "import" -> "Импорт"; "correction" -> "Исправление истории"; else -> "Ручной ввод" }, style = MaterialTheme.typography.bodySmall)
            if (event.note.isNotEmpty()) MaterialText(event.note)
        }
        for (edit in edits) {
            MaterialText(edit.entity.id, Modifier.testTag("habit-source-${edit.entity.id}"), style = MaterialTheme.typography.labelSmall)
            MaterialText(instant(edit.entity.createdAt))
            Text(if (edit.value.skippedAt != null) "Осознанный пропуск" else if (edit.source == "import") "Импорт" else if (edit.source == "decision") "Без отметки выполнения" else "Исправление истории")
            if (edit.value.note.isNotEmpty()) MaterialText(edit.value.note)
        }
        if (events.isEmpty() && edits.isEmpty()) day.completion?.let { MaterialText(instant(it.entity.createdAt)) } ?: Text("Нет записи")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (day.date < day.today) AffairsIconButton("Исправить историю", AffairsAction.EDIT, { onOpenHistory(habit.id, day.date) }, Modifier.testTag("habit-analysis-edit"), !busy)
            if (day.date == LocalDate.now(ZoneId.of(HabitMeasurements.rule(habit, day.date).schedule.timezone)) && day.scheduled && (day.activity != "completed" || day.completion?.skippedAt != null)) {
                AffairsIconButton(if (day.completion?.skippedAt == null) "Пропустить" else "Отменить пропуск", AffairsAction.UNDO, {
                    if (!busy) scope.launch {
                        busy = true
                        val skipped = day.completion?.skippedAt == null
                        val command = pending?.takeIf { it.skipped == skipped } ?: HabitDayDecisionCommand("habit-day:${UUID.randomUUID()}", Instant.now().toString(), habit.id, day.date,
                            HabitHistory.state(workspace.history, habit.id, day.date).heads.map { it.entity.id }, skipped).also { pending = it }
                        try { onDecision(command); pending = null; message = "Состояние сохранено." }
                        catch (e: CancellationException) { throw e }
                        catch (_: Exception) { message = "Не удалось сохранить. Проверьте синхронизацию и повторите." }
                        finally { busy = false }
                    }
                }, Modifier.testTag("habit-analysis-skip"), !busy)
            }
        }
        if (message.isNotEmpty()) Text(message)
    }
}
