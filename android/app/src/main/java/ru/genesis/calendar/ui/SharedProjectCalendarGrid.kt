package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.Alignment
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.semantics.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONObject
import ru.genesis.calendar.domain.*
import java.time.LocalDate
import java.time.format.TextStyle
import java.util.Locale

/** Project planning retains calendar-specific date arithmetic, with task cards as the primary cell content. */
@Composable internal fun SharedProjectCalendarGrid(calendar: GenesisCalendar, anchor: LocalDate, mode: CalendarMode,
    selected: LocalDate, sundayFirst: Boolean, counts: JSONObject, onChoose: (LocalDate) -> Unit,
    dropBounds: MutableMap<String, Rect>, draggingAt: Offset?, tasks: List<JSONObject> = emptyList(),
    onTask: (JSONObject) -> Unit = {}, canEdit: Boolean = false,
    onTaskDragStart: (JSONObject, Offset) -> Unit = { _, _ -> }, onTaskDragMove: (Offset) -> Unit = {},
    onTaskDragEnd: () -> Unit = {}, onTaskDragCancel: () -> Unit = {}) {
    val range = remember(anchor, mode) { calendar.monthRange(anchor, mode) }
    val dates = when (mode) {
        CalendarMode.PROFANE -> gregorianGridDates(range, sundayFirst)
        // Lunar decades and sacred pentads are intrinsic to these calendars.
        else -> range.dates()
    }
    val columns = if (mode == CalendarMode.PROFANE) 7 else 5
    val locale = Locale.forLanguageTag(LocalGenesisLanguage.current)
    val sharedCounts = range.dates().associate { it.toString() to counts.optInt(it.toString()) }
    DisposableEffect(range, mode) { onDispose { dropBounds.clear() } }
    CompositionLocalProvider(LocalSharedCalendarCounts provides sharedCounts) {
    Surface(Modifier.fillMaxWidth().testTag("shared-calendar-grid"), shape = AffairsLayout.shape,
        color = MaterialTheme.colorScheme.surfaceContainerLow, border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
        BoxWithConstraints(Modifier.padding(4.dp)) {
        Column(Modifier.horizontalScroll(rememberScrollState()).width(maxOf(maxWidth, (columns * 48 + columns - 1).dp)),
            verticalArrangement = Arrangement.spacedBy(4.dp)) {
            if (mode == CalendarMode.PROFANE) Row(Modifier.fillMaxWidth()) {
                val first = if (sundayFirst) java.time.DayOfWeek.SUNDAY else java.time.DayOfWeek.MONDAY
                repeat(7) { index -> Text(first.plus(index.toLong()).getDisplayName(TextStyle.SHORT, locale),
                    Modifier.weight(1f), style = MaterialTheme.typography.labelSmall) }
            }
            dates.chunked(columns).forEachIndexed { row, week ->
                if (mode == CalendarMode.LUNAR && row % 2 == 0) Text(
                    listOf("Декада Роста", "Декада Полноты", "Декада Исхода")[(row / 2).coerceAtMost(2)],
                    style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 4.dp))
                Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                    week.forEach { date ->
                        val adjacent = date !in range.start..range.end
                        val bounds = dropBounds[date.toString()]
                        val hovered = !adjacent && draggingAt != null && bounds?.contains(draggingAt) == true
                        val day = when (mode) {
                            CalendarMode.SACRED -> calendar.sacredDate(date).day
                            CalendarMode.LUNAR -> calendar.lunarDate(date).day
                            else -> date.dayOfMonth
                        }
                        val dayTasks = tasks.filter { it.optString("dueDate") == date.toString() }
                        Surface(onClick = { onChoose(date) },
                            modifier = Modifier.weight(1f).heightIn(min = 78.dp).fillMaxHeight()
                                .onGloballyPositioned { if (!adjacent) dropBounds[date.toString()] = it.boundsInWindow() }
                                .testTag("shared-calendar-day-$date").semantics {
                                    contentDescription = calendar.formatDate(date, mode)
                                    this.selected = selected == date
                                }, shape = AffairsLayout.shape,
                            color = selectedControlContainer(selected == date || hovered, fallback = MaterialTheme.colorScheme.surface),
                            border = selectedControlBorder(selected == date || hovered,
                                fallback = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant))) {
                            Column(Modifier.padding(3.dp), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                val remaining = (counts.optInt(date.toString()) - dayTasks.take(1).size).coerceAtLeast(0)
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                                    Text(day.toString(), style = MaterialTheme.typography.labelLarge,
                                        color = if (adjacent) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.onSurface)
                                    if (remaining > 0) Text("+$remaining", style = MaterialTheme.typography.labelSmall)
                                }
                                dayTasks.take(1).forEach { task ->
                                    SharedCalendarTaskChip(task, canEdit, { onTask(task) }, onTaskDragStart, onTaskDragMove, onTaskDragEnd, onTaskDragCancel)
                                }
                            }
                        }
                    }
                    repeat(columns - week.size) { Spacer(Modifier.weight(1f)) }
                }
            }
        }
        }
    }
    }
}


@Composable private fun SharedCalendarTaskChip(task: JSONObject, editable: Boolean, onOpen: () -> Unit,
    onStart: (JSONObject, Offset) -> Unit, onMove: (Offset) -> Unit, onEnd: () -> Unit, onCancel: () -> Unit) {
    var topLeft by remember { mutableStateOf(Offset.Zero) }
    Surface(onClick = onOpen, shape = AffairsLayout.controlShape, color = MaterialTheme.colorScheme.secondaryContainer,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("shared-calendar-task-${task.optString("id")}")
            .onGloballyPositioned { topLeft = it.boundsInWindow().topLeft }
            .pointerInput(task.optString("id"), task.optInt("revision"), editable) {
                if (editable && !task.optBoolean("pending")) detectDragGesturesAfterLongPress(
                    onDragStart = { onStart(task, topLeft + it) }, onDrag = { change, delta -> change.consume(); onMove(delta) },
                    onDragEnd = onEnd, onDragCancel = onCancel)
            }) {
        UntranslatedText(task.optString("title"), Modifier.padding(3.dp),
            style = MaterialTheme.typography.labelSmall, maxLines = 3, overflow = TextOverflow.Ellipsis)
    }
}
