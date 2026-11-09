package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.ZoneId
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceConfig
import ru.genesis.calendar.domain.RecurrenceEngine
import ru.genesis.calendar.domain.SacredCatalog

internal fun recurrenceModeFor(mode: CalendarMode) = when (mode) {
    CalendarMode.PROFANE -> "classic"
    CalendarMode.LUNAR -> "lunar"
    CalendarMode.SACRED -> "genesis"
}

internal fun defaultTaskRecurrence(startDate: String, mode: CalendarMode, context: CalendarContext = CalendarContext()): RecurrenceConfig {
    val date = LocalDate.parse(startDate)
    val calendar = GenesisCalendar(ZoneId.of(context.timeZone), context.version, context.gregorianYearStart)
    val recurrenceMode = recurrenceModeFor(mode)
    val day = when (recurrenceMode) {
        "classic" -> date.dayOfWeek.value
        "lunar" -> calendar.lunarDate(date).day
        else -> (calendar.sacredDate(date).day - 1) % 5 + 1
    }
    return RecurrenceConfig(mode = recurrenceMode,
        pattern = when (recurrenceMode) { "classic" -> "weekdays"; "lunar" -> "lunar-days"; else -> "pyata-days" },
        days = listOf(day), calendarContext = context, rangeStart = startDate, rangeEnd = date.plusYears(1).minusDays(1).toString())
}

private fun toggleSubset(selected: List<Int>, item: Int, all: List<Int>): List<Int> {
    val current = if (selected.isEmpty()) all else selected
    if (current.size == 1 && item in current) return current
    val result = if (item in current) current - item else current + item
    return if (result.sorted() == all) emptyList() else result.sorted()
}

private fun toggleRequired(selected: List<Int>, item: Int): List<Int> =
    if (item in selected && selected.size > 1) selected - item else if (item !in selected) (selected + item).sorted() else selected

@Composable
private fun NumberGrid(title: String, numbers: List<Int>, selected: List<Int>,
    allWhenEmpty: Boolean = false, columns: Int = 5, label: (Int) -> String = Int::toString,
    onChoose: (Int) -> Unit) {
    Text(title, style = MaterialTheme.typography.titleSmall)
    numbers.chunked(columns).forEach { row ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
            row.forEach { value ->
                FilterChip(selected = value in selected || (allWhenEmpty && selected.isEmpty()),
                    onClick = { onChoose(value) }, label = { Text(label(value), maxLines = 1) },
                    modifier = Modifier.weight(1f).testTag("recurrence-option-$title-$value"))
            }
            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
        }
    }
}

/** Same one-task series semantics as the site's RecurrenceBuilder; display calendar is independent. */
@Composable
internal fun TaskRecurrenceEditor(value: RecurrenceConfig, startDate: String, inputMode: CalendarMode,
    sharedSeries: Boolean = false, tracker: Boolean = false, onChange: (RecurrenceConfig) -> Unit): Int {
    val engine = remember { RecurrenceEngine(GenesisCalendar()) }
    val context = value.calendarContext ?: CalendarContext(version = 1)
    val calendar = remember(context) { GenesisCalendar(ZoneId.of(context.timeZone), context.version, context.gregorianYearStart) }
    val start = runCatching { LocalDate.parse(startDate) }.getOrNull()
    val end = value.rangeEnd.takeIf { runCatching { LocalDate.parse(it) }.isSuccess }
        ?: start?.plusYears(1)?.minusDays(1)?.toString().orEmpty()
    val dates = remember(value, startDate) {
        if (!value.enabled || start == null) emptyList()
        else runCatching { engine.buildDates(startDate, value.copy(rangeStart = startDate, rangeEnd = end)) }.getOrDefault(emptyList())
    }
    val count = if (value.enabled) dates.size else 1
    Surface(Modifier.fillMaxWidth().testTag("task-recurrence-editor"),
        shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceContainerLow,
        border = BorderStroke(1.dp,MaterialTheme.colorScheme.outlineVariant)) {
    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
            Column(Modifier.weight(1f)) {
                Text(if (sharedSeries) "Расписание серии" else "Повторение", style = MaterialTheme.typography.titleMedium)
                if (!tracker) Text(if (sharedSeries) "Отдельная задача на каждую дату" else if (value.enabled) "Одна задача · календарный ритм" else "Одиночная задача без повторений",
                    style = MaterialTheme.typography.bodySmall)
            }
            if (!sharedSeries) Switch(checked = value.enabled, onCheckedChange = { enabled ->
                if (start != null) {
                    val base = if (value.rangeStart.isNotBlank() || value.calendarContext != null) value else defaultTaskRecurrence(startDate, inputMode)
                    onChange(base.copy(enabled = enabled, rangeStart = startDate,
                        rangeEnd = base.rangeEnd.ifBlank { start.plusYears(1).minusDays(1).toString() }))
                }
            }, modifier = Modifier.testTag("recurrence-enabled"))
        }
        if (!value.enabled || start == null) return@Column
        if (LocalSacredFeaturesEnabled.current) {
        Text("Календарь повторения", style = MaterialTheme.typography.titleSmall)
        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            listOf("classic" to "Григорианский", "genesis" to "Сакральный", "lunar" to "Лунный")
                .forEach { (mode, name) ->
                    FilterChip(selected = value.mode == mode, onClick = {
                        val nextMode = when (mode) { "classic" -> CalendarMode.PROFANE; "lunar" -> CalendarMode.LUNAR; else -> CalendarMode.SACRED }
                        onChange(defaultTaskRecurrence(startDate, nextMode, context).copy(enabled = true, rangeEnd = end))
                    }, label = { Text(name) }, modifier = Modifier.testTag("recurrence-mode-$mode"))
                }
        }
        }
        Text("С какого · $startDate", style = MaterialTheme.typography.bodyMedium)
        Text("По какое", style = MaterialTheme.typography.titleSmall)
        AuthorDatePicker(end, when (value.mode) {
            "classic" -> CalendarMode.PROFANE; "lunar" -> CalendarMode.LUNAR; else -> CalendarMode.SACRED
        }, calculationContext = context) { onChange(value.copy(rangeStart = startDate, rangeEnd = it,
            months = if (value.mode == "lunar") emptyList() else value.months)) }
        Text("Срок серии — не более пяти лет.", style = MaterialTheme.typography.bodySmall)
        if (value.mode == "classic") {
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                listOf("daily" to "Ежедневно", "weekdays" to "По дням недели", "monthly" to "Ежемесячно", "yearly" to "Ежегодно")
                    .forEach { (pattern, label) ->
                        FilterChip(selected = value.pattern == pattern, onClick = {
                            onChange(value.copy(pattern = pattern, days = if (pattern == "weekdays") listOf(start.dayOfWeek.value) else listOf(1), interval = 1))
                        }, label = { Text(label) }, modifier = Modifier.testTag("recurrence-pattern-$pattern"))
                    }
            }
            if (value.pattern == "weekdays") {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    listOf("Будни" to (1..5).toList(), "Выходные" to listOf(6, 7), "Все дни" to (1..7).toList())
                        .forEach { (label, set) -> FilterChip(selected = value.days == set,
                            onClick = { onChange(value.copy(days = set)) }, label = { Text(label) }) }
                }
                NumberGrid("Дни недели", (1..7).toList(), value.days, columns = 7,
                    label = { listOf("Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс")[it - 1] }) {
                    onChange(value.copy(days = toggleRequired(value.days, it)))
                }
            }
            val intervalLabel = genesisTranslate("Интервал")
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Интервал", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                TextButton(onClick = { onChange(value.copy(interval = (value.interval - 1).coerceAtLeast(1))) },
                    contentPadding = PaddingValues(0.dp), enabled = value.interval > 1,
                    modifier = Modifier.size(48.dp).testTag("recurrence-interval-less").semantics { contentDescription = "$intervalLabel −" }) {
                    GenesisLucideIcon("minus")
                }
                Text("${value.interval} ${when (value.pattern) { "daily" -> "дн."; "weekdays" -> "нед."; "monthly" -> "мес."; else -> "г." }}",
                    modifier = Modifier.widthIn(min = 48.dp), maxLines = 1, style = MaterialTheme.typography.bodyLarge)
                TextButton(onClick = { onChange(value.copy(interval = (value.interval + 1).coerceAtMost(99))) },
                    contentPadding = PaddingValues(0.dp), enabled = value.interval < 99,
                    modifier = Modifier.size(48.dp).testTag("recurrence-interval-more").semantics { contentDescription = "$intervalLabel +" }) {
                    GenesisLucideIcon("plus")
                }
            }
        } else {
            if (value.mode == "genesis") {
                Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    listOf("pyata-days" to "По пятам", "month-days" to "По дням месяца").forEach { (pattern, label) ->
                        FilterChip(selected = value.pattern == pattern, onClick = {
                            val day = if (pattern == "pyata-days") (calendar.sacredDate(start).day - 1) % 5 + 1
                                else calendar.sacredDate(start).day
                            onChange(value.copy(pattern = pattern, days = listOf(day), interval = 1))
                        }, label = { Text(label) }, modifier = Modifier.testTag("recurrence-pattern-$pattern"))
                    }
                }
                NumberGrid("Сакральные месяцы", (1..12).toList(), value.months, allWhenEmpty = true,
                    columns = 3, label = { SacredCatalog.months[it - 1].roman }) {
                    onChange(value.copy(months = toggleSubset(value.months, it, (1..12).toList())))
                }
                if (value.pattern == "pyata-days") {
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                        listOf("Все" to emptyList<Int>(), "Нечётные" to listOf(1,3,5), "Чётные" to listOf(2,4,6))
                            .forEach { (label, set) -> FilterChip(selected = value.pyatas == set,
                                onClick = { onChange(value.copy(pyatas = set)) }, label = { Text(label) }) }
                    }
                    NumberGrid("Пяты месяца", (1..6).toList(), value.pyatas, allWhenEmpty = true) {
                        onChange(value.copy(pyatas = toggleSubset(value.pyatas, it, (1..6).toList())))
                    }
                }
            } else {
                val lunarMonths = remember(startDate, end, context) { runCatching {
                    val first = calendar.lunarMonthIndex(start)
                    val last = calendar.lunarMonthIndex(LocalDate.parse(end))
                    (first..last).map { index -> index - first + 1 to calendar.lunarMonthStart(index).toString() }
                }.getOrDefault(emptyList()) }
                NumberGrid("Лунные месяцы", lunarMonths.map { it.first }, value.months,
                    allWhenEmpty = true, columns = 3,
                    label = { number -> lunarMonths.firstOrNull { it.first == number }?.let { "$number · ${it.second.takeLast(5)}" } ?: "$number" }) {
                    onChange(value.copy(months = toggleSubset(value.months, it, lunarMonths.map { item -> item.first })))
                }
            }
            NumberGrid(if (value.mode == "lunar") "Дни лунного месяца" else if (value.pattern == "pyata-days")
                "Дни пяты" else "Дни сакрального месяца",
                (1..if (value.mode == "genesis" && value.pattern == "pyata-days") 5 else 30).toList(),
                value.days, columns = if (value.mode == "genesis" && value.pattern == "pyata-days") 5 else 6) {
                onChange(value.copy(days = toggleRequired(value.days, it)))
            }
        }
        if (!tracker) Text("$count повторений одной задачи", style = MaterialTheme.typography.titleSmall,
            color = if (count in 1..500) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
            modifier = Modifier.testTag("recurrence-count"))
        if (count == 0) Text("В выбранном периоде нет дат для этого правила.", color = MaterialTheme.colorScheme.error)
        if (count > 500) Text("Максимум 500 повторений. Сократите период или выберите меньше дат.",
            color = MaterialTheme.colorScheme.error)
        Text(genesisTranslate("Следующие даты: {dates}").replace("{dates}", dates.take(5).joinToString(" · ").ifEmpty { "—" }),
            style = MaterialTheme.typography.bodySmall)
        Text(genesisTranslate("Часовой пояс повторения: {zone}").replace("{zone}", context.timeZone),
            style = MaterialTheme.typography.bodySmall)
        Text("Несуществующие дни пропускаются. Апейрон не входит в сакральные повторы; 13-й лунный месяц выбирается только в годах, где он есть.",
            style = MaterialTheme.typography.bodySmall)
        if (value.mode == "genesis" && context.version == 1) Text("Сохранённое расписание использует прежнее начало сакрального года — 20 марта.",
            style = MaterialTheme.typography.bodySmall)
    }
    }
    return count
}
