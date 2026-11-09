package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.DataImportCsv
import ru.genesis.calendar.domain.CalendarMode

internal fun importRows(rows: JSONArray?): List<JSONObject> = if (rows == null) emptyList() else (0 until rows.length()).map(rows::getJSONObject)
internal fun importEdit(state: DataImportState, change: (JSONObject) -> Unit) { val value = JSONObject(state.selection.toString()); change(value); state.change(value) }
internal fun importMapValue(map: JSONObject?, key: String, fallback: String = "@unset"): String = when {
    map == null || !map.has(key) -> fallback
    map.isNull(key) -> "@none"
    else -> map.getString(key)
}

@Composable internal fun ImportChoice(label: String, value: String, choices: List<Pair<String, String>>, enabled: Boolean,
    tag: String, userLabel: Boolean = false, showLabel: Boolean = true, onChange: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }; var search by remember { mutableStateOf("") }; var limit by remember { mutableIntStateOf(50) }
    val selected = choices.firstOrNull { it.first == value }?.second ?: genesisTranslate("Не задано")
    val description = (if (userLabel) label else genesisTranslate(label)) + ": " + selected
    if (LocalTemplateInspection.current && !enabled) {
        TemplateInspectionValue(if (userLabel) label else genesisTranslate(label), selected, tag)
        return
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        if (showLabel) {
            if (userLabel) UntranslatedText(label, style = MaterialTheme.typography.titleSmall) else Text(label, style = MaterialTheme.typography.titleSmall)
        }
        Box {
            OutlinedButton({ search = ""; limit = 50; open = true }, enabled = enabled,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).semantics { contentDescription = description }) {
                UntranslatedText(selected, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium, maxLines = 2, overflow = TextOverflow.Ellipsis)
                AffairsActionIcon(AffairsAction.EXPAND)
            }
            DropdownMenu(open, { open = false }, Modifier.widthIn(min = 240.dp, max = 600.dp).heightIn(max = 420.dp)) {
                if (choices.size > 12) OutlinedTextField(search, { search = it; limit = 50 }, label = { Text("Поиск") },
                    singleLine = true, modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp).testTag("$tag-search"), textStyle = MaterialTheme.typography.bodyMedium)
                val filtered = choices.filter { search.isBlank() || it.second.contains(search, ignoreCase = true) }
                filtered.take(limit).forEach { (id, title) -> DropdownMenuItem(text = {
                    UntranslatedText(title, style = MaterialTheme.typography.bodyMedium, maxLines = 3, overflow = TextOverflow.Ellipsis)
                }, onClick = { open = false; onChange(id) }, modifier = Modifier.testTag("$tag-$id")) }
                if (filtered.size > limit) DropdownMenuItem(text = { Text("Показать ещё") }, onClick = { limit += 50 }, modifier = Modifier.testTag("$tag-more"))
            }
        }
    }
}

@Composable internal fun ImportBatch(title: String, rows: List<JSONObject>, tag: String, render: @Composable (JSONObject) -> Unit) {
    if (rows.isEmpty()) return
    AffairsDisclosure(title, Modifier.testTag(tag)) {
        var limit by rememberSaveable { mutableIntStateOf(5) }
        rows.take(limit).forEach { row -> key(row.optString("key", row.optString("id", row.optString("importId", row.toString())))) { render(row) } }
        if (rows.size > limit) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("$tag-more")) { Text("Показать ещё") }
    }
}

@Composable internal fun ImportMainForm(state: DataImportState, canWrite: Boolean, canCreate: Boolean, calendars: Set<CalendarMode>, enabled: Boolean, choose: () -> Unit) {
    val selection = state.selection; val parse = selection.getJSONObject("parse"); val editable = state.editable && enabled && (canWrite || canCreate)
    val source = state.record?.getJSONObject("edit")?.getJSONObject("source")
    Text("Файл хранится на устройстве в зашифрованном виде.", style = MaterialTheme.typography.bodyMedium)
    if (!canWrite && !canCreate) Text("Нет доступа", color = MaterialTheme.colorScheme.error)
    ImportChoice("Формат", selection.getString("format"), listOf("json" to "GENESIS JSON v1", "csv" to "CSV", "trello" to "Trello JSON"), editable, "import-format") { format ->
        importEdit(state) { it.put("format", format); for (map in listOf("memberMap", "statusMap", "labelMap", "fieldMap", "optionMap", "fieldDefaults")) it.put(map, JSONObject()) }
    }
    if (source != null) UntranslatedText(source.getString("name"), Modifier.testTag("import-filename"), style = MaterialTheme.typography.titleSmall)
    OutlinedButton(choose, enabled = editable, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("import-choose")) {
        AffairsActionIcon(AffairsAction.IMPORT); Spacer(Modifier.width(8.dp)); Text("Выбрать файл")
    }
    val destinations = buildList {
        if (canCreate) { add("tree" to genesisTranslate("Новое дерево проектов")); add("child" to genesisTranslate("Вложить в текущий проект")) }
        if (canWrite) add("tasks" to genesisTranslate("Добавить задачи в текущий проект"))
    }
    val destination = if (!selection.isNull("projectId")) "tasks" else if (!selection.isNull("parentProjectId")) "child" else "tree"
    if (destinations.isNotEmpty()) ImportChoice("Место импорта", destination, destinations, editable, "import-destination") { next ->
        val host = state.hostProject
        importEdit(state) { it.put("projectId", if (next == "tasks") host else JSONObject.NULL).put("parentProjectId", if (next == "child") host else JSONObject.NULL)
            for (key in listOf("memberMap", "statusMap", "labelMap", "fieldMap", "optionMap", "fieldDefaults")) it.put(key, JSONObject()) }
    }
    if (selection.getString("format") != "json") AffairsDisclosure("Настройки файла", Modifier.testTag("import-file-settings")) {
        OutlinedTextField(parse.getString("title"), { text -> importEdit(state) { it.getJSONObject("parse").put("title", text.take(160)) } },
            label = { Text("Название") }, modifier = Modifier.fillMaxWidth().testTag("import-title"), enabled = editable, textStyle = MaterialTheme.typography.bodyMedium)
        if (selection.getString("format") != "json") {
            val selectedMode = parse.getString("calendarMode")
            ImportChoice("Календарь", selectedMode, CalendarMode.entries.filter { it in calendars }.map { it.wireValue to calendarModeLabel(it) }, editable, "import-calendar") { value ->
                importEdit(state) { it.getJSONObject("parse").put("calendarMode", value) }
            }
            val calculation = parse.getJSONObject("calendarContext")
            OutlinedTextField(calculation.getString("timeZone"), { value -> importEdit(state) { it.getJSONObject("parse").getJSONObject("calendarContext").put("timeZone", value.take(200)) } },
                label = { Text("Часовой пояс") }, modifier = Modifier.fillMaxWidth().testTag("import-time-zone"), enabled = editable, singleLine = true,
                textStyle = MaterialTheme.typography.bodyMedium)
            ImportChoice("Начало года", calculation.getString("gregorianYearStart"), listOf("january" to genesisTranslate("Январь"), "march" to genesisTranslate("Март")), editable, "import-year-start") { value ->
                importEdit(state) { it.getJSONObject("parse").getJSONObject("calendarContext").put("gregorianYearStart", value) }
            }
        }
        if (selection.getString("format") == "csv") {
            ImportChoice("Разделитель", parse.getString("delimiter"), listOf("," to ",", ";" to ";", "\t" to genesisTranslate("Табуляция")), editable, "import-delimiter") { value ->
                importEdit(state) { it.getJSONObject("parse").put("delimiter", value).put("columns", JSONObject()).put("customColumns", JSONArray()) }
            }
            ImportChoice("Формат дат", parse.getString("dateFormat"), listOf("iso" to "YYYY-MM-DD", "dmy" to "DD.MM.YYYY", "mdy" to "MM/DD/YYYY"), editable, "import-date-format") { value ->
                importEdit(state) { it.getJSONObject("parse").put("dateFormat", value) }
            }
            OutlinedTextField(parse.getString("openTitle"), { value -> importEdit(state) { it.getJSONObject("parse").put("openTitle", value.take(80)) } },
                label = { Text("К выполнению") }, enabled = editable, modifier = Modifier.fillMaxWidth(), textStyle = MaterialTheme.typography.bodyMedium)
            OutlinedTextField(parse.getString("doneTitle"), { value -> importEdit(state) { it.getJSONObject("parse").put("doneTitle", value.take(80)) } },
                label = { Text("Готово") }, enabled = editable, modifier = Modifier.fillMaxWidth(), textStyle = MaterialTheme.typography.bodyMedium)
        }
    }
    if (selection.getString("format") == "csv" && state.headers.isNotEmpty()) ImportCsvFields(state, editable)
    state.preview?.let { preview -> ImportMappings(state, preview, editable) }
}

@Composable private fun ImportCsvFields(state: DataImportState, enabled: Boolean) {
    val labels = listOf("key" to "ID", "title" to "Название", "description" to "Описание", "project" to "Проект", "status" to "Статус", "done" to "Выполнено",
        "assignee" to "Исполнитель", "priority" to "Приоритет", "labels" to "Метки", "dueDate" to "Срок", "startDate" to "Начало", "startTime" to "Время начала",
        "endTime" to "Время окончания", "parentKey" to "Родительская задача", "storyPoints" to "Оценка в баллах", "estimateHours" to "Оценка в часах")
    val choices = state.headers.mapIndexed { index, title -> index.toString() to "${index + 1}: $title" }
    AffairsDisclosure("Колонки CSV", Modifier.testTag("import-csv-columns")) {
        var limit by rememberSaveable { mutableIntStateOf(5) }
        labels.take(limit).forEach { (key, label) ->
            val columns = state.selection.getJSONObject("parse").getJSONObject("columns")
            val inferred = DataImportCsv.inferred(state.headers, key)
            val automatic = if (inferred == null) listOf("@unset" to genesisTranslate("Не задано")) else listOf("@auto" to (genesisTranslate("Автоматически") + ": " + choices[inferred].second))
            val value = if (columns.has(key)) columns.getInt(key).toString() else if (inferred != null) "@auto" else "@unset"
            ImportChoice(label, value, automatic + choices, enabled, "import-column-$key") { next ->
                importEdit(state) { val map = it.getJSONObject("parse").getJSONObject("columns"); if (next.startsWith("@")) map.remove(key) else map.put(key, next.toInt()) }
            }
        }
        if (limit < labels.size) OutlinedButton({ limit += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
        AffairsDisclosure("Пользовательские колонки") {
            val types = listOf("text" to genesisTranslate("Текст"), "number" to genesisTranslate("Число"), "date" to genesisTranslate("Дата"),
                "select" to genesisTranslate("Выбор"), "multi" to genesisTranslate("Множественный выбор"), "checkbox" to genesisTranslate("Флажок"), "url" to genesisTranslate("Ссылка"))
            var visible by rememberSaveable { mutableIntStateOf(5) }
            state.headers.take(visible).forEachIndexed { index, title ->
                val custom = importRows(state.selection.getJSONObject("parse").getJSONArray("customColumns"))
                val generated = "GENESIS CSV v1" in state.headers && Regex("\\[custom:(text|number|date|select|multi|checkbox|url):[A-Za-z0-9:_-]+]$").containsMatchIn(title)
                val automatic = if (generated) listOf("@auto" to genesisTranslate("Автоматически")) else listOf("@unset" to genesisTranslate("Не переносить"))
                val value = custom.find { it.getInt("column") == index }?.getString("type") ?: if (generated) "@auto" else "@unset"
                ImportChoice("${index + 1}: $title", value, automatic + types, enabled, "import-custom-column-$index", userLabel = true) { next ->
                    importEdit(state) { selection ->
                        val rows = importRows(selection.getJSONObject("parse").getJSONArray("customColumns")).filterNot { it.getInt("column") == index }.toMutableList()
                        if (!next.startsWith("@")) rows += JSONObject().put("column", index).put("title", title.take(160).ifBlank { "${index + 1}" }).put("type", next)
                        selection.getJSONObject("parse").put("customColumns", JSONArray(rows))
                    }
                }
            }
            if (visible < state.headers.size) OutlinedButton({ visible += 5 }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
        }
    }
}
