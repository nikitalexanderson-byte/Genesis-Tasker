package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.DataExportProtocol
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import java.time.LocalDate

private fun mappedChange(state: DataImportState, map: String, key: String, value: String) = importEdit(state) { selection ->
    val values = selection.getJSONObject(map)
    if (value == "@unset") values.remove(key) else values.put(key, if (value == "@none") JSONObject.NULL else value)
}
private fun done(row: JSONObject) = row.opt("isDone") == true || (row.opt("isDone") as? Number)?.toInt() == 1

@Composable internal fun ImportMappings(state: DataImportState, preview: JSONObject, enabled: Boolean) {
    val source = preview.getJSONObject("data")
    val statuses = importRows(source.getJSONArray("projects")).flatMap { project -> importRows(project.getJSONArray("statuses")) }
    if (state.selection.getString("format") == "trello") ImportBatch("Выполненные списки", statuses, "import-trello-done") { row ->
        val keys = state.selection.getJSONObject("parse").getJSONArray("doneStatusKeys"); val current = (0 until keys.length()).map(keys::getString)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(row.getString("key") in current, { checked -> importEdit(state) { selection ->
                val next = current.filterNot { it == row.getString("key") }.toMutableList(); if (checked) next += row.getString("key")
                selection.getJSONObject("parse").put("doneStatusKeys", JSONArray(next))
            } }, enabled = enabled)
            UntranslatedText(row.getString("title"), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        }
    }
    val none = "@none" to genesisTranslate("Без исполнителя"); val unset = "@unset" to genesisTranslate("Не задано")
    val hasMappings = listOf("members", "labels", "fields").any { source.getJSONArray(it).length() > 0 } ||
        !state.selection.isNull("projectId") && statuses.isNotEmpty() || importRows(preview.getJSONArray("destinationFields")).any { it.optBoolean("required") && !it.optBoolean("archived") }
    if (!hasMappings) return
    AffairsDisclosure("Сопоставление", Modifier.testTag("import-mapping")) {
        val members = importRows(preview.getJSONArray("destinationMembers")).map { it.getString("id") to it.getString("title") }
        ImportBatch("Участники", importRows(source.getJSONArray("members")), "import-members") { row ->
            val key = row.getString("key"); val defaults = preview.getJSONObject("memberMap")
            val fallback = if (defaults.isNull(key)) "@unset" else importMapValue(defaults, key)
            ImportChoice(row.getString("title"), importMapValue(state.selection.getJSONObject("memberMap"), key, fallback), listOf(unset, none) + members, enabled,
                "import-member-$key", userLabel = true) { mappedChange(state, "memberMap", key, it) }
        }
        if (!state.selection.isNull("projectId")) ImportBatch("Статусы", statuses, "import-statuses") { row ->
            val key = row.getString("key"); val targets = importRows(preview.getJSONArray("destinationStatuses")).filter { done(it) == done(row) }.map { it.getString("id") to it.getString("title") }
            val fallback = importMapValue(preview.getJSONObject("statusMap"), key).takeUnless { it == "@none" } ?: "@unset"
            ImportChoice(row.getString("title"), importMapValue(state.selection.getJSONObject("statusMap"), key, fallback), listOf(unset) + targets, enabled,
                "import-status-$key", userLabel = true) { mappedChange(state, "statusMap", key, it) }
        }
        val labelTargets = importRows(preview.getJSONArray("destinationLabels")).map { it.getString("id") to it.getString("title") }
        ImportBatch("Метки", importRows(source.getJSONArray("labels")), "import-labels") { row ->
            val key = row.getString("key"); val fallback = importMapValue(preview.getJSONObject("labelMap"), key, "new")
            ImportChoice(row.getString("title"), importMapValue(state.selection.getJSONObject("labelMap"), key, fallback),
                listOf("new" to genesisTranslate("Создать новую метку"), "@none" to genesisTranslate("Не переносить")) + labelTargets, enabled, "import-label-$key", userLabel = true) { mappedChange(state, "labelMap", key, it) }
        }
        val destinationFields = importRows(preview.getJSONArray("destinationFields"))
        ImportBatch("Пользовательские поля", importRows(source.getJSONArray("fields")), "import-fields") { row ->
            val key = row.getString("key"); val fallback = importMapValue(preview.getJSONObject("fieldMap"), key, "new")
            val selected = importMapValue(state.selection.getJSONObject("fieldMap"), key, fallback)
            val targets = if (row.getBoolean("archived")) emptyList() else destinationFields.filter { it.getString("type") == row.getString("type") && !it.optBoolean("archived") }
            ImportChoice(row.getString("title"), selected, listOf("new" to genesisTranslate("Создать поле")) + targets.map { it.getString("id") to it.getString("title") }, enabled,
                "import-field-$key", userLabel = true) { value ->
                importEdit(state) { selection -> selection.getJSONObject("fieldMap").put(key, value); selection.getJSONObject("optionMap").remove(key) }
            }
            val target = targets.find { it.getString("id") == selected }
            if (target != null && row.getJSONArray("options").length() > 0) {
                ImportBatch("Варианты", importRows(row.getJSONArray("options")), "import-options-$key") { option ->
                    val optionKey = option.getString("id"); val fromPreview = preview.optJSONObject("optionMap")?.optJSONObject(key)
                    val initial = importMapValue(fromPreview, optionKey).takeUnless { it == "@none" } ?: "@unset"
                    val value = importMapValue(state.selection.getJSONObject("optionMap").optJSONObject(key), optionKey, initial)
                    val choices = importRows(target.getJSONArray("options")).filterNot { it.optBoolean("archived") }.map { it.getString("id") to it.getString("title") }
                    ImportChoice(option.getString("title"), value, listOf(unset) + choices, enabled, "import-option-$key-$optionKey", userLabel = true) { next ->
                        importEdit(state) { selection ->
                            val options = selection.getJSONObject("optionMap"); val map = options.optJSONObject(key) ?: JSONObject()
                            if (next == "@unset") map.remove(optionKey) else map.put(optionKey, next); options.put(key, map)
                        }
                    }
                }
            }
        }
        ImportBatch("Обязательные поля", destinationFields.filter { it.optBoolean("required") && !it.optBoolean("archived") }, "import-required") { field ->
            ImportRequiredField(state, field, enabled)
        }
    }
}

@Composable private fun ImportRequiredField(state: DataImportState, field: JSONObject, enabled: Boolean) {
    val id = field.getString("id"); val values = state.selection.getJSONObject("fieldDefaults"); val value = values.opt(id).takeUnless { it == JSONObject.NULL }
    fun set(next: Any?) { importEdit(state) { if (next == null) it.getJSONObject("fieldDefaults").remove(id) else it.getJSONObject("fieldDefaults").put(id, next) } }
    val title = field.getString("title"); val type = field.getString("type")
    when (type) {
        "checkbox" -> ImportChoice(title, if (value == null) "@unset" else if (value == true) "true" else "false",
            listOf("@unset" to genesisTranslate("Не задано"), "true" to genesisTranslate("Да"), "false" to genesisTranslate("Нет")), enabled, "import-default-$id", userLabel = true) {
            set(if (it == "@unset") null else it == "true")
        }
        "select" -> ImportChoice(title, value as? String ?: "@unset", listOf("@unset" to genesisTranslate("Не задано")) +
            importRows(field.getJSONArray("options")).filterNot { it.optBoolean("archived") }.map { it.getString("id") to it.getString("title") }, enabled, "import-default-$id", userLabel = true) { set(it.takeUnless { it == "@unset" }) }
        "multi" -> {
            UntranslatedText(title, style = MaterialTheme.typography.titleSmall)
            val selected = (value as? JSONArray)?.let { rows -> (0 until rows.length()).map(rows::getString) }.orEmpty()
            ImportBatch("Варианты", importRows(field.getJSONArray("options")).filterNot { it.optBoolean("archived") }, "import-default-$id") { option ->
                val key = option.getString("id")
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(key in selected, { checked -> set(JSONArray((selected.filterNot { it == key } + if (checked) listOf(key) else emptyList()).distinct())) }, enabled = enabled,
                        modifier = Modifier.testTag("import-default-$id-$key"))
                    UntranslatedText(option.getString("title"), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (value != null) TextButton({ set(null) }, enabled = enabled, modifier = Modifier.testTag("import-default-$id-clear")) { Text("Очистить") }
        }
        "date" -> {
            UntranslatedText(title, style = MaterialTheme.typography.titleSmall)
            val parse = state.selection.getJSONObject("parse"); val calendar = parse.getJSONObject("calendarContext")
            val date = (value as? String)?.takeIf { runCatching { LocalDate.parse(it) }.isSuccess }.orEmpty()
            AuthorDatePicker(date, CalendarMode.fromWire(parse.getString("calendarMode")),
                calculationContext = CalendarContext(timeZone = DataExportProtocol.timeZone(calendar.getString("timeZone"))?.id ?: "UTC", gregorianYearStart = calendar.getString("gregorianYearStart")),
                enabled = enabled, placeholder = "Выберите дату", modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("import-default-$id"), onChange = { set(it) })
            if (value != null) TextButton({ set(null) }, enabled = enabled) { Text("Очистить") }
        }
        else -> {
            var text by rememberSaveable(id) { mutableStateOf(value?.toString().orEmpty()) }; var focused by remember { mutableStateOf(false) }
            LaunchedEffect(value?.toString(), focused) { if (!focused) text = value?.toString().orEmpty() }
            OutlinedTextField(text, { next ->
                text = next.take(5000)
                set(if (text.isBlank()) null else if (type == "number") text.replace(',', '.').toDoubleOrNull()?.takeIf { it.isFinite() } ?: text else text)
            }, label = { UntranslatedText(title) }, enabled = enabled,
                isError = type == "number" && text.isNotBlank() && text.replace(',', '.').toDoubleOrNull()?.isFinite() != true,
                modifier = Modifier.fillMaxWidth().onFocusChanged { focused = it.isFocused }.testTag("import-default-$id"), textStyle = MaterialTheme.typography.bodyMedium)
        }
    }
}
