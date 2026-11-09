package ru.genesis.calendar.ui

import androidx.compose.foundation.*
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.semantics.*
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ru.genesis.calendar.ui.Dialog
import java.time.*
import ru.genesis.calendar.domain.*
import kotlin.math.*

private val priorityColors = listOf(0xff4f9f68,0xff68ad63,0xff87b75b,0xffaebe50,0xffc7b943,
    0xffd8aa3b,0xffe28f38,0xffdc6f34,0xffd64f32,0xffc8332f).map { Color(it) }
private val priorityNames = listOf("Можно позже","Низкий","Ниже среднего","Умеренный","Средний",
    "Заметный","Высокий","Очень высокий","Срочный","Горит")

internal fun priorityForPosition(x: Float, width: Int): Int =
    ((x.coerceIn(0f, width.coerceAtLeast(1).toFloat()) / width.coerceAtLeast(1)) * 10)
        .toInt().coerceIn(0, 9) + 1

@Composable
fun PriorityControl(value: Int, onChange: (Int) -> Unit) {
    Column(Modifier.fillMaxWidth()) {
        val bounded = value.coerceIn(1, 10)
        val description = genesisTranslate("Приоритет $bounded, ${priorityNames[bounded - 1]}")
        Text("Приоритет · ${priorityNames[bounded - 1]} · $bounded из 10",
            modifier = Modifier.fillMaxWidth(), fontSize = 12.sp, maxLines = 1,
            softWrap = false, overflow = TextOverflow.Ellipsis)
        Row(Modifier.fillMaxWidth().height(72.dp).testTag("priority-scale")
            .semantics {
                contentDescription = description
                progressBarRangeInfo = ProgressBarRangeInfo(bounded.toFloat(), 1f..10f, 8)
                setProgress { requested -> onChange(requested.roundToInt().coerceIn(1, 10)); true }
            }
            .pointerInput(onChange) {
            fun selectAt(x: Float) {
                onChange(priorityForPosition(x, size.width))
            }
            detectDragGestures(onDragStart = { selectAt(it.x) }) { change, _ ->
                selectAt(change.position.x)
                change.consume()
            }
        }.pointerInput(onChange) {
            detectTapGestures { onChange(priorityForPosition(it.x, size.width)) }
        }, verticalAlignment = Alignment.Bottom) {
            (1..10).forEach { step ->
                Box(Modifier.weight(1f).fillMaxHeight().clearAndSetSemantics { },
                    contentAlignment = Alignment.BottomCenter) {
                    Box(Modifier.padding(horizontal = 2.dp, vertical = 8.dp).fillMaxWidth()
                        .height((7 + step * 4).dp)
                        .border(if (step == bounded) 2.dp else 0.dp, MaterialTheme.colorScheme.onSurface, RoundedCornerShape(3.dp))
                        .background((if(LocalEveningTheme.current) priorityColors[step - 1].let {
                            Color(it.red*.72f,it.green*.72f,it.blue*.72f) } else priorityColors[step - 1])
                            .copy(alpha = if (step <= bounded) 1f else .35f), RoundedCornerShape(3.dp)))
                }
            }
        }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically) {
            val lower = (bounded - 1).coerceAtLeast(1)
            val higher = (bounded + 1).coerceAtMost(10)
            AffairsIconButton("Приоритет $lower, ${priorityNames[lower - 1]}", AffairsAction.DECREASE,
                { onChange(lower) }, Modifier.testTag("priority-decrease"), enabled = bounded > 1)
            Text("$bounded / 10", style = MaterialTheme.typography.labelLarge)
            AffairsIconButton("Приоритет $higher, ${priorityNames[higher - 1]}", AffairsAction.ADD,
                { onChange(higher) }, Modifier.testTag("priority-increase"), enabled = bounded < 10)
        }
    }
}

@Composable
fun AuthorTimePicker(value: String, use24: Boolean, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    var open by rememberSaveable { mutableStateOf(false) }
    OutlinedButton(onClick = { open = true }, modifier = modifier) { Text(if (value.isEmpty()) "Выбрать время" else timeLabel(value, use24)) }
    if (!open) return
    Dialog(onDismissRequest = { open = false }) {
        Surface(shape = AffairsLayout.shape) {
            Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()), horizontalAlignment = Alignment.CenterHorizontally) {
                EditorDialogHeader("Часы · Минуты", "author-time-close") { open = false }
                val parsed = runCatching { LocalTime.parse(value) }.getOrDefault(LocalTime.MIDNIGHT)
                val current by rememberUpdatedState(parsed)
                val commit by rememberUpdatedState(onChange)
                val hourCount = if (use24) 24 else 12
                if (!use24) Row {
                    listOf("AM","PM").forEachIndexed { index, label ->
                        FilterChip(selected = parsed.hour / 12 == index, onClick = {
                            onChange(parsed.withHour(parsed.hour % 12 + index * 12).toString().take(5))
                        }, label = { Text(label) })
                    }
                }
                var ring by remember { mutableIntStateOf(0) }
                val ink = MaterialTheme.colorScheme.onSurface
                val clockDescription = genesisTranslate("Авторские часы: внешнее кольцо часов, внутреннее кольцо минут")
                Canvas(Modifier.fillMaxWidth().aspectRatio(1f)
                    .semantics { contentDescription = clockDescription }
                    .pointerInput(use24) {
                        fun update(point: Offset, chooseRing: Boolean) {
                            val scale = size.width / 244f
                            val dx = point.x / scale - 122; val dy = point.y / scale - 122
                            if (chooseRing) ring = if (hypot(dx, dy) > 75) 0 else 1
                            val angle = (atan2(dx, -dy) + 2 * PI) % (2 * PI)
                            val next = if (ring == 0) {
                                val h = (angle / (2 * PI) * hourCount).roundToInt() % hourCount
                                current.withHour(if (use24) h else h + current.hour / 12 * 12)
                            } else current.withMinute((angle / (2 * PI) * 60).roundToInt() % 60)
                            commit(next.toString().take(5))
                        }
                        detectDragGestures(onDragStart = { update(it, true) }) { change, _ -> update(change.position, false); change.consume() }
                    }.pointerInput(use24) {
                        detectTapGestures { point ->
                            val scale = size.width / 244f
                            val dx = point.x / scale - 122; val dy = point.y / scale - 122
                            val angle = (atan2(dx, -dy) + 2 * PI) % (2 * PI)
                            val next = if (hypot(dx,dy) > 75) {
                                val h = (angle / (2 * PI) * hourCount).roundToInt() % hourCount
                                current.withHour(if (use24) h else h + current.hour / 12 * 12)
                            } else current.withMinute((angle / (2 * PI) * 60).roundToInt() % 60)
                            commit(next.toString().take(5))
                        }
                    }) {
                    val scale = size.width / 244f
                    val center = Offset(122 * scale,122 * scale)
                    drawCircle(Color(0xffe1d9c8), 108 * scale, center)
                    drawCircle(Color(0xfff8f5ed), 66 * scale, center)
                    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
                        textAlign = android.graphics.Paint.Align.CENTER; textSize = 9 * scale; color = android.graphics.Color.rgb(19,36,38)
                    }
                    for (kind in 0..1) {
                        val count = if (kind == 0) hourCount else 12
                        val radius = (if (kind == 0) 96 else 54) * scale
                        repeat(count) { i ->
                            val angle = i * 2 * PI / count - PI / 2
                            val p = center + Offset((cos(angle)*radius).toFloat(),(sin(angle)*radius).toFloat())
                            val active = if (kind == 0) parsed.hour % hourCount == i else parsed.minute / 5 == i
                            drawCircle(if (active) Color(0xffb28a4a) else Color(0xffd5cab4), (if (active) 11 else 8) * scale,p)
                            val label = if (kind == 1) (i * 5).toString().padStart(2,'0') else (if (!use24 && i == 0) 12 else i).toString()
                            drawContext.canvas.nativeCanvas.drawText(label,p.x,p.y + 3*scale,paint)
                        }
                    }
                    paint.textSize = 13*scale
                    drawContext.canvas.nativeCanvas.drawText(timeLabel(value.ifEmpty { "00:00" }, use24),center.x,center.y,paint)
                }
                // Accessible adjustments complement the same author ring control.
                Row {
                    TextButton(onClick={onChange(parsed.minusHours(1).toString().take(5))}){Text("Час −")}
                    TextButton(onClick={onChange(parsed.plusHours(1).toString().take(5))}){Text("Час +")}
                    TextButton(onClick={onChange(parsed.minusMinutes(1).toString().take(5))}){Text("Мин −")}
                    TextButton(onClick={onChange(parsed.plusMinutes(1).toString().take(5))}){Text("Мин +")}
                }
                Row {
                    TextButton(onClick = { onChange(""); open=false }) { Text("Очистить") }
                    Button(onClick = { open=false }) { Text("Готово") }
                }
            }
        }
    }
}
fun timeLabel(value: String, use24: Boolean): String {
    if (value.isEmpty() || use24) return value
    val t = LocalTime.parse(value)
    return "${if (t.hour % 12 == 0) 12 else t.hour % 12}:${t.minute.toString().padStart(2,'0')} ${if (t.hour < 12) "AM" else "PM"}"
}

@Composable
fun AuthorDatePicker(value: String, mode: CalendarMode, minDate: LocalDate? = null,
    calculationContext: ru.genesis.calendar.domain.CalendarContext? = null, maxDate: LocalDate? = null, enabled: Boolean = true,
    placeholder: String? = null, modifier: Modifier = Modifier, displayMode: CalendarMode = mode, compact: Boolean = false,
    showCalendarIcon: Boolean = false, onChange: (String) -> Unit) {
    val sacredFeaturesEnabled = LocalSacredFeaturesEnabled.current
    val mode = if (sacredFeaturesEnabled) mode else CalendarMode.PROFANE
    var open by rememberSaveable { mutableStateOf(false) }
    val focusManager = LocalFocusManager.current
    val keyboardController = LocalSoftwareKeyboardController.current
    val context = calculationContext ?: ru.genesis.calendar.domain.CalendarContext()
    val calendar = remember(context) { GenesisCalendar(ZoneId.of(context.timeZone), context.version, context.gregorianYearStart) }
    val date = if (value.isBlank() && placeholder != null) LocalDate.now() else LocalDate.parse(value)
    val firstDate = LocalDate.of(1900, 1, 1)
    val lastDate = minOf(LocalDate.of(2100, 12, 31), maxDate ?: LocalDate.of(2100, 12, 31))
    // Keep the formatting fallback pure; composition locals are read above.
    val label = if(compact) compactDreamDate(date, mode, calendar) else if (value.isBlank() && placeholder != null) placeholder else runCatching {
        calendar.formatDate(date, if (sacredFeaturesEnabled) displayMode else CalendarMode.PROFANE)
    }.getOrDefault(value)
    val openPicker = { focusManager.clearFocus(); keyboardController?.hide(); open = true }
    if(compact) TextButton(onClick=openPicker,enabled=enabled,modifier=modifier.heightIn(min=48.dp),contentPadding=PaddingValues(horizontal=4.dp)) {
        if (showCalendarIcon) {
            GenesisLucideIcon("calendar-days", Modifier.size(18.dp))
            Spacer(Modifier.width(4.dp))
        }
        Text(label,maxLines=1,softWrap=false,style=MaterialTheme.typography.labelMedium)
    } else OutlinedButton(onClick=openPicker,enabled=enabled,modifier=modifier){Text(label)}
    if (open && enabled) AuthorDatePickerDialog(date, mode, calendar, firstDate, lastDate, minDate,
        onDismiss = { open = false }, onChoose = { chosen -> open = false; onChange(chosen.toString()) })
}

@Composable
private fun AuthorDatePickerDialog(date: LocalDate, mode: CalendarMode, calendar: GenesisCalendar,
    firstDate: LocalDate, lastDate: LocalDate, minDate: LocalDate?, onDismiss: () -> Unit,
    onChoose: (LocalDate) -> Unit) {
    var shown by remember { mutableStateOf(date.coerceIn(firstDate, lastDate)) }
    Dialog(onDismissRequest = onDismiss) {
        Surface(shape=AffairsLayout.shape) {
            Column(Modifier.padding(12.dp).verticalScroll(rememberScrollState())) {
                val range = calendar.monthRange(shown,mode)
                EditorDialogHeader(when(mode){CalendarMode.SACRED->"Выберите день круга";CalendarMode.LUNAR->"Выберите лунный день";else->"Выберите дату"}, "author-date-close", onDismiss)
                Row(Modifier.fillMaxWidth(),horizontalArrangement=Arrangement.SpaceBetween,verticalAlignment=Alignment.CenterVertically) {
                    TextButton(enabled=range.start > firstDate,
                        onClick={shown=range.start.minusDays(1)}){Text("←")}
                    Text(calendar.formatDate(shown,mode),Modifier.weight(1f))
                    TextButton(enabled=range.end < lastDate,
                        onClick={shown=range.end.plusDays(1)}){Text("→")}
                }
                if (mode==CalendarMode.SACRED) {
                    val sacred=calendar.sacredDate(shown)
                    Row(Modifier.horizontalScroll(rememberScrollState())) {
                        SacredCatalog.months.forEach { month ->
                            FilterChip(selected=month.index==sacred.monthIndex,
                                onClick={shown=calendar.gregorianDate(sacred.sacredYear,month.index,1)},label={Text(month.roman)})
                        }
                    }
                }
                val columns = if(mode==CalendarMode.PROFANE) 7 else 5
                val leading = if(mode==CalendarMode.PROFANE) range.start.dayOfWeek.value-1 else 0
                val cells: List<LocalDate?> = List(leading) { null } + range.dates()
                if(mode==CalendarMode.PROFANE) Row(Modifier.fillMaxWidth()) {
                    listOf("Пн","Вт","Ср","Чт","Пт","Сб","Вс").forEach {
                        Text(it,Modifier.weight(1f),style=MaterialTheme.typography.labelSmall)
                    }
                }
                // A month owns its grid composition. In particular, February 2027 has
                // four complete weeks, unlike January's rows with leading empty cells.
                key(mode, range.start) {
                for (week in cells.chunked(columns)) {
                    Row(Modifier.fillMaxWidth()) {
                        for ((cell, day) in week.withIndex()) {
                            key(day ?: cell) {
                            if(day==null) Spacer(Modifier.weight(1f)) else {
                            val s=calendar.sacredDate(day)
                            val label=when(mode) {
                                CalendarMode.SACRED -> if(s.monthIndex==12) s.day.toString() else listOf("I","II","III","IIII","V")[(s.day-1)%5]
                                CalendarMode.LUNAR -> calendar.lunarDate(day).day.toString()
                                else -> day.dayOfMonth.toString()
                            }
                            Column(Modifier.weight(1f).defaultMinSize(minHeight=56.dp)
                                .background(if(day==date) MaterialTheme.colorScheme.secondaryContainer else Color.Transparent)
                                .clickable(enabled=day in firstDate..lastDate && (minDate == null || day >= minDate)) { onChoose(day) }.padding(3.dp)
                                .semantics { contentDescription=calendar.formatDate(day,mode) },horizontalAlignment=Alignment.CenterHorizontally) {
                                if(mode==CalendarMode.SACRED) Text(if(s.monthIndex==12) "Ω" else "Пята ${(s.day-1)/5+1}",style=MaterialTheme.typography.labelSmall)
                                Text(label)
                                if(mode!=CalendarMode.PROFANE) Text("${day.dayOfMonth}.${day.monthValue}",style=MaterialTheme.typography.labelSmall)
                            }
                            }
                            }
                        }
                        repeat(columns-week.size) { Spacer(Modifier.weight(1f)) }
                    }
                }
                }
                val today = LocalDate.now()
                TextButton(onClick = { onChoose(today) },
                    enabled = today in firstDate..lastDate && (minDate == null || today >= minDate),
                    modifier = Modifier.align(Alignment.End).testTag("author-date-today")) { Text("Сегодня") }
            }
        }
    }
}

internal fun compactDreamDate(date:LocalDate,mode:CalendarMode,calendar:GenesisCalendar):String = when(mode){
    CalendarMode.PROFANE -> date.toString()
    CalendarMode.SACRED -> calendar.sacredDate(date).let { day ->
        if(day.monthIndex==12) "${day.day}.Ω" else "${listOf("I","II","III","IIII","V")[(day.day-1)%5]}.${(day.day-1)/5+1}.${day.monthIndex+1}"
    }
    CalendarMode.LUNAR -> calendar.lunarDate(date).let { day -> "${(day.day-1)%10+1}.${(day.day-1)/10+1}.${day.monthOrdinal}" }
}
