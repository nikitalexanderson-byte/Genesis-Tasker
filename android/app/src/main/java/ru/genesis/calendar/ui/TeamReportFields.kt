package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.DataExportProtocol
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate
import java.time.ZoneId

@Composable internal fun TeamReportFields(state: TeamReportState, space: String, project: String, calendars: Set<CalendarMode>,
    initialStatuses: List<JSONObject>, update: (JSONObject) -> Unit) {
    val options = state.options; val filter = options.getJSONObject("filter"); val context = options.getJSONObject("calendarContext")
    val enabled = !state.busy && !state.lost
    fun edit(change: (JSONObject) -> Unit) { val next = JSONObject(state.options.toString()); change(next); update(next) }
    fun criteria(change: (JSONObject) -> Unit) = edit { change(it.getJSONObject("filter")) }
    val from = options.getString("from"); val to = options.getString("to"); val mode = CalendarMode.fromWire(options.getString("calendarMode"))
    val zone = DataExportProtocol.timeZone(context.getString("timeZone"))
    val calculation = CalendarContext(timeZone = zone?.id ?: "UTC", gregorianYearStart = context.getString("gregorianYearStart"))
    val viewSource = filter.has("savedViewId") || filter.has("viewDefinition")
    TeamHeading("Фильтры и период отчёта")
    Text("Условия исходного списка сохранены.", style = MaterialTheme.typography.bodyMedium)
    ImportChoice("Объём", if (filter.has("spaceId") && !filter.has("projectIds")) "space" else "project",
        listOf("project" to genesisTranslate("Текущий проект"), "space" to genesisTranslate("Все доступные проекты пространства")), enabled, "team-scope") { value ->
        criteria { row -> row.remove("savedViewId"); row.remove("viewDefinition"); if (value == "space") { row.remove("projectIds"); row.put("spaceId", space) }
            else { row.remove("spaceId"); row.put("projectIds", JSONArray().put(project)) } }
        edit { it.put("cycleStartStatusIds", JSONArray()) }
    }
    ImportChoice("Календарь", mode.wireValue, CalendarMode.entries.filter { it in calendars }.map { it.wireValue to calendarModeLabel(it) }, enabled, "team-calendar") { value -> edit { it.put("calendarMode", value) } }
    @Composable fun DateField(label: String, key: String, value: String) {
        Text(label, style = MaterialTheme.typography.titleSmall)
        AuthorDatePicker(value, mode, calculationContext = calculation, enabled = enabled,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("team-$key"), onChange = { selected -> edit { it.put(key, selected) } })
    }
    DateField("Начало диапазона", "from", from); DateField("Конец диапазона", "to", to)
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        for ((kind, label) in listOf("month" to "Месяц", "year" to "Год")) OutlinedButton({
            if (zone != null) {
                val calendar = GenesisCalendar(zone, 2, context.getString("gregorianYearStart")); val today = LocalDate.now(zone)
                val range = if (kind == "month") calendar.monthRange(today, mode) else calendar.yearRange(today, mode)
                edit { it.put("from", range.start.toString()).put("to", range.end.toString()) }
            }
        }, enabled = enabled && zone != null, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("team-preset-$kind")) { Text(label) }
    }
    OutlinedTextField(context.getString("timeZone"), { value -> edit { it.getJSONObject("calendarContext").put("timeZone", value.take(200)) } },
        label = { Text("Часовой пояс") }, singleLine = true, enabled = enabled, isError = zone == null,
        modifier = Modifier.fillMaxWidth().testTag("team-time-zone"), textStyle = MaterialTheme.typography.bodyMedium)
    if (mode == CalendarMode.PROFANE) ImportChoice("Начало года", context.getString("gregorianYearStart"),
        listOf("january" to genesisTranslate("Январь"), "march" to genesisTranslate("Март")), enabled, "team-year-start") { value -> edit { it.getJSONObject("calendarContext").put("gregorianYearStart", value) } }
    AffairsDisclosure("Фильтры", Modifier.testTag("team-filters")) {
        if (viewSource) Text("Сохранённое представление", style = MaterialTheme.typography.bodyMedium)
        OutlinedTextField(filter.optString("q"), { value -> criteria { if (value.isBlank()) it.remove("q") else it.put("q", value.take(1000)) } },
            label = { Text("Поиск") }, trailingIcon = { AffairsActionIcon(AffairsAction.SEARCH) }, enabled = enabled && !viewSource,
            modifier = Modifier.fillMaxWidth().testTag("team-search"), textStyle = MaterialTheme.typography.bodyMedium)
        val statuses = state.catalog?.let { importRows(it.getJSONArray("statuses")) } ?: initialStatuses
        val all = "@all" to genesisTranslate("Все")
        fun ids(key: String) = filter.optJSONArray(key)?.let { values -> (0 until values.length()).map(values::getString) }.orEmpty()
        val chosenStatuses = ids("statusIds"); val multipleStatuses = chosenStatuses.size > 1
        val missingStatuses = chosenStatuses.filter { id -> statuses.none { it.getString("id") == id } }.map { it to genesisTranslate("Недоступно") }
        ImportChoice("Статус", if (multipleStatuses) "@source" else chosenStatuses.singleOrNull() ?: "@all",
            listOf(all) + (if (multipleStatuses) listOf("@source" to genesisTranslate("Условия исходного списка сохранены.")) else emptyList()) + statuses.map { it.getString("id") to it.getString("title") } + missingStatuses,
            enabled && !viewSource, "team-status") { value -> if (value != "@source") criteria { if (value == "@all") it.remove("statusIds") else it.put("statusIds", JSONArray().put(value)) } }
        ImportChoice("Выполнение", filter.optString("completion", "any"), listOf("any" to genesisTranslate("Все задачи"), "open" to genesisTranslate("Открытые задачи"), "completed" to genesisTranslate("Завершённые задачи")),
            enabled && !viewSource, "team-completion") { value -> criteria { it.put("completion", value) } }
        val priorities = filter.optJSONArray("priority")?.let { values -> (0 until values.length()).map(values::getInt) }.orEmpty()
        val priorityTitles = listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет")
        ImportChoice("Приоритет", if (priorities.size > 1) "@source" else priorities.singleOrNull()?.toString() ?: "@all",
            listOf(all) + (if (priorities.size > 1) listOf("@source" to genesisTranslate("Условия исходного списка сохранены.")) else emptyList()) + priorityTitles.mapIndexed { index, label -> index.toString() to genesisTranslate(label) },
            enabled && !viewSource, "team-priority") { value -> if (value != "@source") criteria { if (value == "@all") it.remove("priority") else it.put("priority", JSONArray().put(value.toInt())) } }
        val members = state.catalog?.let { importRows(it.getJSONArray("members")) }.orEmpty()
        val chosenMembers = ids("assigneeIds"); val multipleMembers = chosenMembers.size > 1
        val account = LocalGenesisUserId.current
        val ownTitle = members.find { it.getString("id") == account }?.getString("title") ?: genesisTranslate("Условия исходного списка сохранены.")
        val missingMembers = chosenMembers.filter { id -> id !in setOf("me", "unassigned") && members.none { it.getString("id") == id } }.map { it to genesisTranslate("Недоступно") }
        ImportChoice("Исполнитель", if (multipleMembers) "@source" else chosenMembers.singleOrNull() ?: "@all",
            listOf(all, "unassigned" to genesisTranslate("Без исполнителя"), "me" to ownTitle) + (if (multipleMembers) listOf("@source" to genesisTranslate("Условия исходного списка сохранены.")) else emptyList()) + members.map { it.getString("id") to it.getString("title") } + missingMembers,
            enabled && !viewSource, "team-assignee") { value -> if (value != "@source") criteria { if (value == "@all") it.remove("assigneeIds") else it.put("assigneeIds", JSONArray().put(value)) } }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Text("Включить архивные данные", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            Switch(filter.optBoolean("includeArchived") || filter.optBoolean("archived"), { value -> criteria { it.remove("archived"); it.put("includeArchived", value) } }, enabled = enabled && !viewSource,
                modifier = Modifier.testTag("team-archived"))
        }
        OutlinedButton({ edit { row ->
            val scope = JSONObject(); if (filter.has("spaceId") && !filter.has("projectIds")) scope.put("spaceId", space) else scope.put("projectIds", JSONArray().put(project))
            row.put("filter", scope).put("cycleStartStatusIds", JSONArray())
        } }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("team-reset-filters")) { Text("Сбросить фильтры") }
    }
    val statuses = (state.catalog?.let { importRows(it.getJSONArray("statuses")) } ?: initialStatuses).filter { it.opt("isDone") == false || it.opt("isDone") == 0 }
    AffairsDisclosure("Стартовые незавершённые статусы для времени цикла", Modifier.testTag("team-cycle-starts")) {
        var limit by remember { mutableIntStateOf(5) }
        statuses.take(limit).forEach { status -> key(status.getString("id")) {
        val starts = options.getJSONArray("cycleStartStatusIds"); val selected = (0 until starts.length()).map(starts::getString)
        val id = status.getString("id")
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(id in selected, { checked -> edit { it.put("cycleStartStatusIds", JSONArray(selected.filterNot { value -> value == id } + if (checked) listOf(id) else emptyList())) } }, enabled = enabled,
                modifier = Modifier.testTag("team-cycle-$id"))
            UntranslatedText(status.getString("title"), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        }
        } }
        if (limit < statuses.size) OutlinedButton({ limit += 5 }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
        if (options.getJSONArray("cycleStartStatusIds").length() > 0) TextButton({ edit { it.put("cycleStartStatusIds", JSONArray()) } }, enabled = enabled,
            modifier = Modifier.testTag("team-cycle-clear")) { Text("Очистить") }
    }
}
