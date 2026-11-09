package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitHorizontalTouchSlopOrCancellation
import androidx.compose.foundation.gestures.horizontalDrag
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SacredCatalog
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.floor
import kotlin.math.max
import kotlin.math.roundToInt

private val ganttCellWidth = 96.dp
private val ganttNameWidth = 144.dp
private val ganttRowHeight = 64.dp

/** Uses the same filtered, paginated task reader and revision checks as the other project views. */
@Composable internal fun SharedGanttView(tasks: List<JSONObject>, statuses: List<JSONObject>,
    calendarMode: CalendarMode, inputCalendarMode: CalendarMode, use24: Boolean, canEdit: Boolean,
    busy: Boolean, onOpen: (JSONObject) -> Unit, onSchedule: suspend (JSONObject, JSONObject) -> JSONObject,
    gateway: ru.genesis.calendar.auth.SharedWorkspaceGateway? = null, baseFilter: JSONObject = JSONObject(), bounds: JSONObject? = null,
    onDragScroll: (Float) -> Unit = {}) {
    val calendar = remember { GenesisCalendar() }
    val scope = rememberCoroutineScope()
    var anchorValue by rememberSaveable { mutableStateOf(LocalDate.now().toString()) }
    var scaleValue by rememberSaveable { mutableStateOf(SharedGanttScale.WEEKS.name) }
    val anchor = LocalDate.parse(anchorValue)
    val scale = SharedGanttScale.valueOf(scaleValue)
    var fit by rememberSaveable { mutableStateOf(false) }
    var help by remember { mutableStateOf(false) }
    val first = runCatching { LocalDate.parse(bounds?.optString("first")) }.getOrNull()
        ?: tasks.mapNotNull(::sharedGanttSpan).minOfOrNull { LocalDate.ofEpochDay(floor(it.start).toLong()) }
    val last = runCatching { LocalDate.parse(bounds?.optString("last")) }.getOrNull()
        ?: tasks.mapNotNull(::sharedGanttSpan).maxOfOrNull { LocalDate.ofEpochDay(floor(it.end - 1e-7).toLong()) }
    val periods = remember(anchor, scale, calendarMode, fit, first, last) {
        if (fit && first != null && last != null && scale != SharedGanttScale.HOURS) sharedGanttFitPeriods(first, last, scale, calendarMode, calendar)
        else sharedGanttPeriods(anchor, scale, calendarMode, calendar)
    }
    val source = if (gateway != null) rememberSharedGanttData(gateway, baseFilter, periods, scale, baseFilter.toString()) else null
    val edits = remember(gateway, baseFilter.toString(), LocalGenesisUserId.current) { SharedGanttEdits(scope) }
    val persist by rememberUpdatedState(onSchedule)
    val authoritative = if (source == null) tasks else source.scheduled.ganttRows() + source.unscheduled.ganttRows() + source.completed.ganttRows()
    LaunchedEffect(authoritative.map { it.toString() }) { edits.reconcile(authoritative) }
    val readable = source == null || (source.scheduled.pageState.value != null && source.unscheduled.pageState.value != null)
    val visible = if (readable) (authoritative.map { edits.rows[it.optString("id")] ?: it } + edits.rows.values)
        .distinctBy { it.optString("id") } else authoritative
    val done = statuses.filter { it.optInt("isDone") == 1 || it.optBoolean("isDone") }.map { it.optString("id") }.toSet()
    val active = visible.filter { it.optString("statusId") !in done }
    val scheduled = active.filter { sharedGanttSpan(it)?.let { span -> scale != SharedGanttScale.HOURS || span.timed } == true }
    val rows = scheduled.filter { sharedGanttSpan(it)!!.let { span -> span.end > periods.first().start && span.start < periods.last().end } }
    val unscheduled = active.filter { it !in scheduled }
    val completed = visible.filter { it.optString("statusId") in done }
    var editingJson by rememberSaveable { mutableStateOf("") }
    val saving = edits.saving
    val error = edits.error
    val timelineScroll = rememberScrollState()
    var trackBounds by remember { mutableStateOf(Rect.Zero) }
    var rootPosition by remember { mutableStateOf(Offset.Zero) }
    var dragTask by remember { mutableStateOf<JSONObject?>(null) }
    var dragPoint by remember { mutableStateOf<Offset?>(null) }
    val cellPixels = with(LocalDensity.current) { ganttCellWidth.toPx() }
    val dragScrollEdge = with(LocalDensity.current) { 180.dp.toPx() }
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    LaunchedEffect(anchor, scale, calendarMode, fit) { timelineScroll.scrollTo(0); dragTask = null; dragPoint = null }
    val save: (JSONObject, JSONObject) -> Boolean = { task, changes ->
        if (busy || !canEdit || !readable || task.optBoolean("pending")) false
        else {
            edits.submit(task, changes, { row, patch -> persist(row, patch) }) {
                source?.scheduled?.refresh(); source?.unscheduled?.refresh(); source?.completed?.refresh()
                if (source != null && listOf(source.scheduled, source.unscheduled, source.completed).all {
                        it.error.isBlank() && it.pageState.value != null }) {
                    edits.reconcile(source.scheduled.ganttRows() + source.unscheduled.ganttRows() + source.completed.ganttRows(), dropMissing = true)
                }
            }
            true
        }
    }
    Box(Modifier.fillMaxWidth().onGloballyPositioned { rootPosition = it.boundsInWindow().topLeft }) {
    Column(Modifier.fillMaxWidth().testTag("shared-gantt").semantics { stateDescription = calendarMode.wireValue }, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Surface(shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Масштаб времени", style = MaterialTheme.typography.titleSmall)
                Row(Modifier.fillMaxWidth().testTag("gantt-scales"), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    SharedGanttScale.entries.forEach { choice ->
                        val title = if (choice == SharedGanttScale.WEEKS) when (calendarMode) {
                            CalendarMode.SACRED -> "Пяты"; CalendarMode.LUNAR -> "Декады"; else -> choice.label
                        } else choice.label
                        FilterChip(scale == choice, { scaleValue = choice.name; fit = false },
                            { CompactChoiceLabel(title, minFontSize = 11.sp, maxFontSize = 14.sp) }, enabled = !saving,
                            shape = AffairsLayout.controlShape,
                            modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("gantt-scale-${choice.name.lowercase()}"))
                    }
                }
                HorizontalDivider()
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    AffairsIconButton("Предыдущий период", AffairsAction.BACK, {
                        fit = false; anchorValue = sharedGanttShift(anchor, scale, calendarMode, calendar, -1).toString()
                    }, Modifier.testTag("gantt-previous"), !saving, outlined = false)
                    AuthorDatePicker(anchorValue, calendarMode, enabled = !saving,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("gantt-anchor")) { anchorValue = it; fit = false }
                    AffairsIconButton("Следующий период", AffairsAction.NEXT, {
                        fit = false; anchorValue = sharedGanttShift(anchor, scale, calendarMode, calendar, 1).toString()
                    }, Modifier.testTag("gantt-next"), !saving, outlined = false)
                }
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton({ anchorValue = LocalDate.now().toString(); fit = false },
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp),
                        contentPadding = PaddingValues(horizontal = 4.dp)) {
                        CompactChoiceLabel("Сегодня", minFontSize = 11.sp, maxFontSize = 14.sp)
                    }
                    if (scale != SharedGanttScale.HOURS) TextButton({ fit = !fit }, enabled = first != null && !saving,
                        modifier = Modifier.weight(1.2f).heightIn(min = 48.dp).testTag("gantt-fit"),
                        contentPadding = PaddingValues(horizontal = 4.dp)) {
                        CompactChoiceLabel("По задачам", minFontSize = 11.sp, maxFontSize = 14.sp)
                    }
                    TextButton({ help = true }, modifier = Modifier.weight(1.8f).heightIn(min = 48.dp).testTag("gantt-help"),
                        contentPadding = PaddingValues(horizontal = 4.dp)) {
                        CompactChoiceLabel("Как пользоваться", minFontSize = 11.sp, maxFontSize = 14.sp)
                    }
                }
            }
        }
        if (error.isNotEmpty()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("gantt-error"))
        if (saving) AffairsLoading(Modifier.height(48.dp))
        Surface(shape = AffairsLayout.shape, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
            Column {
                Row(Modifier.fillMaxWidth()) {
                    Box(Modifier.width(ganttNameWidth).height(72.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh), contentAlignment = Alignment.CenterStart) {
                        Text("Задача", Modifier.padding(12.dp), style = MaterialTheme.typography.labelLarge)
                    }
                    Row(Modifier.weight(1f).horizontalScroll(timelineScroll).height(72.dp).background(MaterialTheme.colorScheme.surfaceContainerHigh),
                        verticalAlignment = Alignment.CenterVertically) {
                    periods.forEach { period ->
                        val date = LocalDate.ofEpochDay(floor(period.start + 1e-7).toLong())
                        val title = when (scale) {
                            SharedGanttScale.HOURS -> timeLabel("%02d:00".format(Locale.ROOT, ((period.start - anchor.toEpochDay()) * 24).roundToInt()), use24)
                            SharedGanttScale.MONTHS -> when (calendarMode) {
                                CalendarMode.PROFANE -> date.format(DateTimeFormatter.ofPattern("LLL yyyy", locale))
                                CalendarMode.SACRED -> SacredCatalog.months[calendar.sacredDate(date).monthIndex].name
                                CalendarMode.LUNAR -> calendar.lunarDate(date).month.name
                            }
                            else -> calendar.formatDate(date, calendarMode)
                        }
                        Text(title, Modifier.width(ganttCellWidth).padding(8.dp), style = MaterialTheme.typography.labelSmall,
                            maxLines = 3, overflow = TextOverflow.Ellipsis)
                    }
                    }
                }
                HorizontalDivider()
                Row(Modifier.fillMaxWidth().heightIn(min = 72.dp, max = 312.dp).verticalScroll(rememberScrollState())) {
                    Column(Modifier.width(ganttNameWidth)) {
                    rows.forEach { task -> Row(Modifier.fillMaxWidth().height(ganttRowHeight), verticalAlignment = Alignment.CenterVertically) {
                        TextButton({ onOpen(task) }, Modifier.weight(1f).fillMaxHeight(), contentPadding = PaddingValues(6.dp)) {
                            UntranslatedText(task.optString("title"), maxLines = 3, overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                        }
                    } }
                    }
                    Box(Modifier.weight(1f).onGloballyPositioned { trackBounds = it.boundsInWindow() }.horizontalScroll(timelineScroll)) {
                        Box(Modifier.width(ganttCellWidth * periods.size).heightIn(min = 72.dp).testTag("gantt-drop-track")) {
                            GanttDependencies(rows, periods)
                            Column {
                        rows.forEach { task -> key(task.getString("id")) {
                            GanttTaskRow(task, periods, scale, calendarMode, calendar,
                                editable = canEdit && !busy && readable && !task.optBoolean("pending"),
                                onOpen = { onOpen(task) },
                                onMove = { changes -> save(task, changes) })
                        } }
                            }
                        }
                    }
                }
            }
        }
        source?.scheduled?.let { GanttPageControls(it, "gantt-timeline-more") }
        if (rows.isEmpty()) Text("На выбранный период задач нет.", style = MaterialTheme.typography.bodySmall)
        if (scheduled.size > rows.size) Text(genesisTranslate("Задачи вне периода") + ": ${scheduled.size - rows.size}",
            style = MaterialTheme.typography.bodySmall)
        Surface(Modifier.fillMaxWidth().testTag("gantt-unplaced"), shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceContainerLow) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Неразмещённые задачи", style = MaterialTheme.typography.titleMedium)
                if (canEdit) Text("Удерживайте карточку и перенесите на шкалу времени.", style = MaterialTheme.typography.bodySmall)
                unscheduled.forEach { task -> key(task.optString("id")) {
                    var position by remember { mutableStateOf(Offset.Zero) }
                    Surface(Modifier.fillMaxWidth().onGloballyPositioned { position = it.boundsInWindow().topLeft }
                        .testTag("gantt-unplaced-${task.optString("id")}")
                        .pointerInput(task.optString("id"), task.optInt("revision"), canEdit, busy, saving, periods) {
                            if (canEdit && !busy && !saving && !task.optBoolean("pending")) detectDragGesturesAfterLongPress(
                                onDragStart = { dragTask = task; dragPoint = position + it },
                                onDrag = { change, delta -> change.consume(); dragPoint = dragPoint?.plus(delta)
                                    if (dragPoint != null && dragPoint!!.y < dragScrollEdge) onDragScroll(-20f)
                                },
                                onDragCancel = { dragTask = null; dragPoint = null }, onDragEnd = {
                                    val point = dragPoint
                                    if (point != null && trackBounds.contains(point)) {
                                        val axis = ((point.x - trackBounds.left + timelineScroll.value) / cellPixels).toDouble().coerceIn(0.0, periods.size - .000001)
                                        val changes = sharedGanttMove(task, sharedGanttPoint(periods, axis), scale)
                                        scope.launch { save(task, changes) }
                                    }
                                    dragTask = null; dragPoint = null
                                })
                        }, shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
                        Row(Modifier.padding(start = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            TextButton({ onOpen(task) }, Modifier.weight(1f)) { UntranslatedText(task.optString("title"), Modifier.fillMaxWidth()) }
                            if (canEdit) AffairsIconButton("Запланировать задачу", AffairsAction.MORE,
                                { editingJson = task.toString() }, Modifier.testTag("gantt-schedule-${task.optString("id")}"), !busy && !saving && !task.optBoolean("pending"), outlined = false)
                        }
                    }
                } }
                source?.unscheduled?.let { GanttPageControls(it, "gantt-unscheduled-more") }
            }
        }
        if (completed.isNotEmpty()) AffairsDisclosure("Завершённые", Modifier.testTag("gantt-completed")) {
            completed.forEach { task -> TextButton({ onOpen(task) }, Modifier.fillMaxWidth()) {
                UntranslatedText(task.optString("title"), Modifier.fillMaxWidth())
            } }
            source?.completed?.let { GanttPageControls(it, "gantt-completed-more") }
        }
    }
    val previewTask = dragTask
    val previewPoint = dragPoint
    if (previewTask != null && previewPoint != null) Surface(Modifier.offset {
        val point = dragPoint ?: previewPoint
        androidx.compose.ui.unit.IntOffset((point.x - rootPosition.x - 80.dp.toPx()).roundToInt(),
            (point.y - rootPosition.y - 24.dp.toPx()).roundToInt())
    }.widthIn(max = 200.dp), shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.primaryContainer, shadowElevation = 6.dp) {
        UntranslatedText(previewTask.optString("title"), Modifier.padding(8.dp), maxLines = 2)
    }
    }
    if (help) AlertDialog(onDismissRequest = { help = false }, title = { Text("Диаграмма Ганта") },
        text = { Text("Нажмите полосу и потяните её края. Двойное нажатие открывает задачу. Удерживайте карточку для переноса. Шаг времени — 15 минут.") },
        confirmButton = { TextButton({ help = false }) { Text("Понятно") } })
    if (editingJson.isNotBlank()) {
        val task = remember(editingJson) { JSONObject(editingJson) }
        GanttScheduleDialog(task, anchor, inputCalendarMode, calendarMode, use24, !saving && !busy && canEdit,
            error, onDismiss = { if (!saving) editingJson = "" },
            onSave = { changes -> scope.launch { if (save(task, changes)) editingJson = "" } })
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable private fun GanttTaskRow(task: JSONObject, periods: List<SharedGanttPeriod>, scale: SharedGanttScale,
    mode: CalendarMode, calendar: GenesisCalendar, editable: Boolean, onOpen: () -> Unit,
    onMove: (JSONObject) -> Unit) {
    val span = sharedGanttSpan(task)!!
    val id = task.optString("id")
    var delta by remember { mutableDoubleStateOf(0.0) }
    var edge by remember { mutableStateOf<Boolean?>(null) }
    var handles by remember { mutableStateOf(false) }
    val pixels = with(LocalDensity.current) { ganttCellWidth.toPx() }
    val move by rememberUpdatedState(onMove)
    val startAxis = sharedGanttAxis(periods, span.start)
    fun changes(): JSONObject {
        val boundary = if (edge == true) span.start else span.end
        val origin = if (edge == null) startAxis else sharedGanttAxis(periods, boundary)
        val point = sharedGanttPoint(periods, (origin + delta).coerceIn(0.0, periods.size.toDouble()))
        return if (edge == null) sharedGanttMove(task, point, scale) else sharedGanttResize(task, point, scale, edge!!)
    }
    val preview = if (delta == 0.0) span else sharedGanttSpan(JSONObject(task.toString()).apply {
        val patch = changes(); patch.keys().forEach { put(it, patch.get(it)) }
    })!!
    val x = sharedGanttAxis(periods, preview.start).coerceIn(0.0, periods.size.toDouble())
    val end = sharedGanttAxis(periods, preview.end).coerceIn(0.0, periods.size.toDouble())
    val trackWidth = ganttCellWidth * periods.size
    val visualWidth = max(48f, ((end - x) * ganttCellWidth.value).toFloat()).coerceAtMost(trackWidth.value)
    val visualStart = (x * ganttCellWidth.value).toFloat().coerceIn(0f, trackWidth.value - visualWidth)
    val visualEnd = visualStart + visualWidth
    val stroke = MaterialTheme.colorScheme.outlineVariant
    val todayInk = MaterialTheme.colorScheme.secondary
    val today = sharedGanttAxis(periods, LocalDate.now().toEpochDay().toDouble())
    val label = task.optString("title") + ": " + calendar.formatDate(LocalDate.ofEpochDay(floor(preview.start).toLong()), mode) +
        " — " + calendar.formatDate(LocalDate.ofEpochDay(floor(preview.end - (if (preview.timed) 0.0 else 1.0)).toLong()), mode)
    fun finish() { if (delta != 0.0) move(changes()); delta = 0.0; edge = null }
    val finishMove by rememberUpdatedState({ finish() })
    Box(Modifier.width(trackWidth).height(ganttRowHeight).testTag("gantt-task-$id"), contentAlignment = Alignment.CenterStart) {
        Canvas(Modifier.matchParentSize()) {
            repeat(periods.size + 1) { index ->
                val left = index * ganttCellWidth.toPx()
                drawLine(stroke.copy(alpha = .6f), Offset(left, 0f), Offset(left, size.height), 1.dp.toPx())
            }
            if (today in 0.0..periods.size.toDouble()) drawLine(todayInk,
                Offset((today * ganttCellWidth.toPx()).toFloat(), 0f), Offset((today * ganttCellWidth.toPx()).toFloat(), size.height), 2.dp.toPx())
        }
        Surface(modifier = Modifier.offset(x = visualStart.dp).width(visualWidth.dp)
            .height(48.dp).testTag("gantt-bar-$id").semantics { contentDescription = label }
            .combinedClickable(onClick = { if (editable) handles = true else onOpen() }, onDoubleClick = onOpen)
            .pointerInput(id, periods, editable) {
                if (editable) detectDragGesturesAfterLongPress(onDragStart = { delta = 0.0; edge = null },
                    onDrag = { change, amount -> change.consume(); delta += amount.x / pixels },
                    onDragCancel = { delta = 0.0; edge = null }, onDragEnd = { finishMove() })
            }, shape = AffairsLayout.shape, color = androidx.compose.ui.graphics.Color.Transparent) {
            Box(contentAlignment = Alignment.CenterStart) {
                Box(Modifier.fillMaxWidth().height(28.dp).testTag("gantt-strip-$id")
                    .background(MaterialTheme.colorScheme.primaryContainer, AffairsLayout.shape)
                    .border(BorderStroke(if (handles) 2.dp else 1.dp, MaterialTheme.colorScheme.primary), AffairsLayout.shape))
            }
        }
        if (handles && editable) {
            // Quiet grips sit on the selected strip. Their invisible touch areas stay 48dp.
            listOf(true to visualStart, false to visualEnd).forEach { (startEdge, boundary) ->
                // Place the large touch areas mainly outside the strip, so short spans
                // keep two separate resize targets without detaching the visible grips.
                val position = (boundary - if (startEdge) 44f else 4f).coerceIn(0f, trackWidth.value - 48f)
                val edgeLabel = genesisTranslate(if (startEdge) "Изменить начало" else "Изменить окончание")
                var gripWindowX by remember(id, startEdge) { mutableFloatStateOf(0f) }
                Box(Modifier.offset(x = position.dp).size(48.dp)
                    .onGloballyPositioned { gripWindowX = it.boundsInWindow().left }
                    .testTag("gantt-resize-${if (startEdge) "start" else "end"}-$id")
                    .semantics { contentDescription = edgeLabel }
                    .combinedClickable(onClick = {}, onDoubleClick = onOpen)
                    .pointerInput(id, periods, startEdge, editable) {
                        awaitEachGesture {
                            val down = awaitFirstDown(requireUnconsumed = false)
                            val originWindowX = gripWindowX + down.position.x
                            val captured = awaitHorizontalTouchSlopOrCancellation(down.id) { change, _ ->
                                change.consume()
                                edge = startEdge
                                // Include the initial movement; the grip itself moves with the preview.
                                delta = ((gripWindowX + change.position.x - originWindowX) / pixels).toDouble()
                            }
                            if (captured != null) {
                                try {
                                    val released = horizontalDrag(captured.id) { change ->
                                        delta = ((gripWindowX + change.position.x - originWindowX) / pixels).toDouble()
                                        change.consume()
                                    }
                                    if (released) finishMove()
                                } finally { delta = 0.0; edge = null }
                            }
                        }
                    }, contentAlignment = Alignment.CenterStart) {
                    Box(Modifier.offset(x = (boundary - position - if (startEdge) 0f else 4f).dp)
                        .width(4.dp).height(24.dp).testTag("gantt-grip-${if (startEdge) "start" else "end"}-$id")
                        .background(MaterialTheme.colorScheme.primary, AffairsLayout.shape))
                }
            }
        }
    }
}

@Composable private fun GanttPageControls(reader: SharedTaskListReader, tag: String) {
    val scope = rememberCoroutineScope()
    if (reader.error.isNotBlank()) {
        Text("Не удалось загрузить задачи.", color = MaterialTheme.colorScheme.error)
        TextButton({ scope.launch { reader.refresh() } }) { Text("Повторить") }
    }
    if (reader.busy && reader.pageState.value == null) AffairsLoading()
    if (reader.pageState.value?.optBoolean("hasMore") == true) TextButton({ scope.launch { reader.more() } },
        enabled = !reader.busy, modifier = Modifier.heightIn(min = 48.dp).testTag(tag)) { Text("Показать ещё") }
}

@Composable private fun GanttDependencies(tasks: List<JSONObject>, periods: List<SharedGanttPeriod>) {
    val ink = MaterialTheme.colorScheme.primary
    Canvas(Modifier.width(ganttCellWidth * periods.size).height(ganttRowHeight * tasks.size)) {
        val positions = tasks.withIndex().associateBy { it.value.optString("id") }
        tasks.forEachIndexed { index, task ->
            val dependencies = task.optJSONArray("dependsOnIds") ?: return@forEachIndexed
            for (dependency in 0 until dependencies.length()) {
                val prior = positions[dependencies.optString(dependency)] ?: continue
                val from = sharedGanttSpan(prior.value) ?: continue
                val to = sharedGanttSpan(task) ?: continue
                val left = 0f
                val fromX = left + (sharedGanttAxis(periods, from.end) * ganttCellWidth.toPx()).toFloat()
                val toX = left + (sharedGanttAxis(periods, to.start) * ganttCellWidth.toPx()).toFloat()
                if (fromX !in left..size.width || toX !in left..size.width) continue
                val fromY = (prior.index + .5f) * ganttRowHeight.toPx()
                val toY = (index + .5f) * ganttRowHeight.toPx()
                val elbow = max(fromX + 8.dp.toPx(), toX - 8.dp.toPx())
                val path = Path().apply {
                    moveTo(fromX, fromY); lineTo(elbow, fromY); lineTo(elbow, toY); lineTo(toX, toY)
                    moveTo(toX + 4.dp.toPx(), toY - 3.dp.toPx()); lineTo(toX, toY); lineTo(toX + 4.dp.toPx(), toY + 3.dp.toPx())
                }
                drawPath(path, ink, style = Stroke(1.dp.toPx()))
            }
        }
    }
}

@Composable private fun GanttScheduleDialog(task: JSONObject, anchor: LocalDate, inputMode: CalendarMode, displayMode: CalendarMode, use24: Boolean,
    enabled: Boolean, error: String, onDismiss: () -> Unit, onSave: (JSONObject) -> Unit) {
    fun date(key: String) = task.optString(key).takeUnless { it.isBlank() || it == "null" }
    var start by rememberSaveable(task.optString("id")) { mutableStateOf(date("startDate") ?: date("dueDate") ?: anchor.toString()) }
    var end by rememberSaveable(task.optString("id")) { mutableStateOf(date("dueDate") ?: start) }
    var timed by rememberSaveable(task.optString("id")) { mutableStateOf(!task.isNull("startTime") && !task.isNull("endTime")) }
    var startTime by rememberSaveable(task.optString("id")) { mutableStateOf(task.optString("startTime").takeUnless { it.isBlank() || it == "null" } ?: "09:00") }
    var endTime by rememberSaveable(task.optString("id")) { mutableStateOf(task.optString("endTime").takeUnless { it.isBlank() || it == "null" } ?: "10:00") }
    val changes = runCatching { sharedGanttChanges(LocalDate.parse(start), LocalDate.parse(end),
        startTime.takeIf { timed }, endTime.takeIf { timed }) }.getOrNull()
    AlertDialog(onDismissRequest = { if (enabled) onDismiss() }, title = { Text("Сроки задачи") },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            UntranslatedText(task.optString("title"), style = MaterialTheme.typography.titleSmall)
            Text("Начало")
            AuthorDatePicker(start, inputMode, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag("gantt-start-date"), displayMode = displayMode) { start = it }
            Text("Окончание")
            AuthorDatePicker(end, inputMode, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag("gantt-end-date"), displayMode = displayMode) { end = it }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Checkbox(timed, { timed = it }, enabled = enabled)
                Text("Указать время")
            }
            if (timed) {
                Text("Время начала")
                if (enabled) AuthorTimePicker(startTime, use24) { startTime = it } else Text(timeLabel(startTime, use24))
                Text("Время окончания")
                if (enabled) AuthorTimePicker(endTime, use24) { endTime = it } else Text(timeLabel(endTime, use24))
            }
            if (changes == null) Text("Окончание должно быть позже начала.", color = MaterialTheme.colorScheme.error)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            OutlinedButton({ onSave(sharedGanttClear()) }, enabled = enabled, modifier = Modifier.fillMaxWidth().testTag("gantt-unschedule")) {
                Text("Вернуть задачу в список")
            }
        } }, confirmButton = { Button({ changes?.let(onSave) }, enabled = enabled && changes != null,
            modifier = Modifier.testTag("gantt-save-schedule")) { Text("Сохранить") } },
        dismissButton = { TextButton(onDismiss, enabled = enabled) { Text("Отмена") } })
}
