package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.RecurrenceEngine
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

@Composable internal fun AutomationEditorSchedule(state: SharedAutomationEditorState, preferences: UiPreferences) {
    val edit = state.edit ?: return; val raw = edit.getJSONObject("definition").getJSONObject("trigger").getJSONObject("recurrence")
    val rule = SharedAutomationEditorEdits.recurrence(raw); val enabled = state.editable
    val input = SharedCustomCalendar.restore(edit.getJSONObject("dateInput")); val inputMode = if (LocalSacredFeaturesEnabled.current) input.mode else CalendarMode.PROFANE
    fun update(change: (JSONObject) -> Unit) { state.mutate { change(it.getJSONObject("definition").getJSONObject("trigger").getJSONObject("recurrence")) } }
    Text("Начало", style = MaterialTheme.typography.titleSmall)
    AuthorDatePicker(rule.rangeStart, inputMode, calculationContext = input.context, enabled = enabled,
        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-schedule-start")) { value -> update {
            it.put("rangeStart", value); if (it.getString("rangeEnd").isNotEmpty() && it.getString("rangeEnd") < value) it.put("rangeEnd", value)
        } }
    TemplateToggle("Ограничить срок", rule.rangeEnd.isNotEmpty(), enabled, "automation-schedule-limited") { value -> update { it.put("rangeEnd", if (value) rule.rangeStart else "") } }
    if (rule.rangeEnd.isNotEmpty()) AuthorDatePicker(rule.rangeEnd, inputMode, calculationContext = input.context, enabled = enabled,
        minDate = LocalDate.parse(rule.rangeStart), modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("automation-schedule-end")) { value -> update { it.put("rangeEnd", value) } }
    ImportChoice("Календарь повторения", rule.mode, listOf("classic" to genesisTranslate("Григорианский календарь"), "genesis" to genesisTranslate("Солнечный календарь"), "lunar" to genesisTranslate("Лунный календарь")), enabled && LocalSacredFeaturesEnabled.current, "automation-schedule-mode") { value ->
        state.mutate { edit ->
            val mode = when (value) { "classic" -> CalendarMode.PROFANE; "lunar" -> CalendarMode.LUNAR; else -> CalendarMode.SACRED }
            edit.getJSONObject("definition").getJSONObject("trigger").put("recurrence", SharedAutomationEditorEdits.recurrence(defaultTaskRecurrence(rule.rangeStart, mode, requireNotNull(rule.calendarContext)).copy(enabled = true, rangeEnd = rule.rangeEnd)))
            edit.getJSONObject("inputs").remove("trigger.interval")
        }
    }
    val patterns = when (rule.mode) {
        "classic" -> listOf("daily" to "Каждый день", "weekdays" to "Дни недели", "monthly" to "Ежемесячно", "yearly" to "Ежегодно")
        "genesis" -> listOf("pyata-days" to "Дни пяты", "month-days" to "Дни месяца")
        else -> listOf("lunar-days" to "Лунные дни", "lunar-decades" to "Лунные декады", "lunar-decade-days" to "Дни лунной декады", "lunar-phases" to "Лунные фазы", "lunar-yearly" to "Лунный год")
    }
    ImportChoice("Повторение", rule.pattern, patterns.map { it.first to genesisTranslate(it.second) }, enabled, "automation-schedule-pattern") { value -> update {
        it.put("pattern", value).put("days", JSONArray().put(1)).put("months", if (value == "lunar-yearly") JSONArray().put(1) else JSONArray()).put("pyatas", JSONArray())
    } }
    AutomationIntegerField("Интервал", edit.getJSONObject("inputs").optString("trigger.interval", rule.interval.toString()), enabled, "automation-schedule-interval", 1, 99) { value -> state.mutate { it.getJSONObject("inputs").put("trigger.interval", value) } }
    if (rule.pattern !in setOf("daily", "monthly", "yearly")) {
        val limit = when (rule.pattern) { "weekdays" -> 7; "pyata-days" -> 5; "lunar-decades" -> 3; "lunar-decade-days" -> 10; "lunar-phases" -> 2; else -> 30 }
        val labels = if (rule.pattern == "lunar-phases") mapOf(1 to genesisTranslate("Новолуние"), 2 to genesisTranslate("Полнолуние")) else emptyMap()
        AutomationNumberSubset(if (rule.pattern == "lunar-phases") "Лунные фазы" else "Дни расписания", rule.days, limit, enabled, false, "automation-schedule-days", labels) { values -> update { it.put("days", JSONArray(values)) } }
    }
    if (rule.mode != "classic") {
        AutomationNumberSubset(if (rule.mode == "genesis") "Сакральные месяцы" else "Лунные месяцы", rule.months, when { rule.mode == "genesis" -> 12; rule.pattern == "lunar-yearly" -> 13; else -> 72 },
            enabled, rule.pattern != "lunar-yearly", "automation-schedule-months") { values -> update { it.put("months", JSONArray(values)) } }
    }
    if (rule.pattern in setOf("pyata-days", "lunar-decade-days")) AutomationNumberSubset(if (rule.pattern == "pyata-days") "Пяты месяца" else "В каких декадах месяца", rule.pyatas,
        if (rule.pattern == "pyata-days") 6 else 3, enabled, true, "automation-schedule-pyatas") { values -> update { it.put("pyatas", JSONArray(values)) } }
    val effective = SharedAutomationEditorEdits.effective(edit).getJSONObject("trigger").getJSONObject("recurrence")
    val nextDates = remember(effective.toString()) { runCatching {
        val config = SharedAutomationEditorEdits.recurrence(effective); val context = requireNotNull(config.calendarContext)
        val today = LocalDate.now(ZoneId.of(context.timeZone)); val anchor = LocalDate.parse(config.rangeStart)
        val engine = RecurrenceEngine(GenesisCalendar(ZoneId.of(context.timeZone), context.version, context.gregorianYearStart))
        val through = minOf(today.plusYears(5), config.rangeEnd.takeIf(String::isNotEmpty)?.let(LocalDate::parse) ?: LocalDate.of(2100, 12, 31))
        generateSequence(maxOf(today, anchor)) { it.plusDays(1) }.takeWhile { it <= through }.filter { engine.matches(anchor.toString(), config, it.toString()) }.take(5).toList()
    }.getOrDefault(emptyList()) }
    val calendar = remember(input.context) { GenesisCalendar(ZoneId.of(input.context.timeZone), input.context.version, input.context.gregorianYearStart) }
    UntranslatedText(genesisTranslate("Следующие даты: {dates}").replace("{dates}", nextDates.joinToString(" · ") { calendar.formatDate(it, inputMode) }.ifEmpty { genesisTranslate("Не найдено") }),
        style = MaterialTheme.typography.bodySmall, modifier = Modifier.testTag("automation-schedule-next"))
    Text("Несуществующие дни пропускаются. Апейрон не входит в сакральные повторы; 13-й лунный месяц выбирается только в годах, где он есть.", style = MaterialTheme.typography.bodySmall)
}

@Composable private fun AutomationNumberSubset(title: String, selected: List<Int>, maximum: Int, enabled: Boolean, emptyAll: Boolean, tag: String,
    labels: Map<Int, String> = emptyMap(), onChange: (List<Int>) -> Unit) {
    val language = LocalGenesisLanguage.current; val format = NumberFormat.getIntegerInstance(Locale.forLanguageTag(language))
    var limit by rememberSaveable(tag, maximum) { mutableIntStateOf(5) }
    AffairsDisclosure(title, Modifier.testTag(tag)) {
        if (emptyAll) TemplateOutlinedButton({ onChange(emptyList()) }, Modifier.fillMaxWidth().testTag("$tag-all"), enabled) { Text("Все") }
        (1..maximum).take(limit).chunked(if (labels.isEmpty()) 5 else 2).forEach { row -> Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val columns = if (labels.isEmpty()) 5 else 2
            row.forEach { number ->
                val checked = number in selected || emptyAll && selected.isEmpty()
                FilterChip(checked, {
                    val actual = if (emptyAll && selected.isEmpty()) (1..maximum).toList() else selected
                    val next = (if (number in actual) actual - number else actual + number).distinct().sorted()
                    if (next.isNotEmpty()) onChange(if (emptyAll && next.size == maximum) emptyList() else next)
                }, enabled = enabled, label = { UntranslatedText(labels[number] ?: format.format(number)) },
                    modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("$tag-$number"))
            }
            repeat(columns - row.size) { Spacer(Modifier.weight(1f)) }
        } }
        if (maximum > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth(), enabled) { Text("Показать ещё") }
    }
}
