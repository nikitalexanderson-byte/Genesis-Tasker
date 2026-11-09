package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.Saver
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.CustomFieldDraft
import ru.genesis.calendar.auth.CustomFieldProtocol
import ru.genesis.calendar.auth.CustomFieldQueryProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode

internal data class SharedTaskFieldCatalog(val fields: List<JSONObject>, val error: Boolean, val identity: String)
/** Keep feature locals and composable bookkeeping out of the large workspace method. */
internal class SharedTaskListContext(val project: String, val query: SharedTaskFieldQuery, val reader: SharedTaskListReader) {
    var catalog = SharedTaskFieldCatalog(emptyList(), false, ""); private set
    var sort = "position"; private set
    var valid = true; private set
    var calendarReader: SharedTaskListReader? = null
    val calendarTasks: List<JSONObject> get() = calendarReader?.pageState?.value?.optJSONArray("tasks")?.let { rows ->
        (0 until rows.length()).map(rows::getJSONObject) }.orEmpty()
    private var calendarCountsJson by mutableStateOf("{}")
    var calendarCounts: JSONObject
        get() = JSONObject(calendarCountsJson)
        set(value) { calendarCountsJson = value.toString() }
    fun bind(snapshot: JSONObject?, filter: JSONObject, default: TaskListSort) {
        catalog = sharedTaskFieldCatalog(snapshot, project); sort = query.order(default)
        valid = !catalog.error && query.valid(filter, catalog.fields, default)
    }
}

@Composable internal fun rememberSharedTaskListContext(gateway: ru.genesis.calendar.auth.SharedWorkspaceGateway,
    project: String, prefs: UiPreferences): SharedTaskListContext {
    val query = rememberSharedTaskFieldQuery(project, prefs)
    val reader = rememberSharedTaskListReader(gateway)
    return remember(project, query, reader) { SharedTaskListContext(project, query, reader) }
}

@Composable internal fun ObserveSharedTaskListContext(context: SharedTaskListContext, gateway: ru.genesis.calendar.auth.SharedWorkspaceGateway,
    filter: JSONObject, active: Boolean, ready: Boolean, view: String, mode: CalendarMode, anchor: java.time.LocalDate, onLost: () -> Unit) {
    context.calendarReader = rememberSharedTaskCalendarCounts(gateway, filter, context.catalog.identity, mode, anchor,
        active && ready && context.valid && view == "calendar" && context.project.isNotBlank())
    context.calendarCounts = context.calendarReader?.pageState?.value?.optJSONObject("dateCounts") ?: JSONObject()
    ObserveSharedTaskList(context.reader, filter, context.sort, context.catalog.identity, active,
        context.valid && ready && context.project.isNotBlank(), onLost)
}
internal fun sharedTaskFieldCatalog(snapshot: JSONObject?, project: String): SharedTaskFieldCatalog = try {
    if (snapshot == null) SharedTaskFieldCatalog(emptyList(), false, "") else {
        val source = snapshot.getJSONObject("project")
        require(source.getString("id") == project)
        val fields = CustomFieldProtocol.definitions(source.getString("spaceId"), project, snapshot.optJSONArray("customFieldDefinitions") ?: JSONArray())
        SharedTaskFieldCatalog(fields, false, JSONArray(fields).toString())
    }
} catch (_: Exception) { SharedTaskFieldCatalog(emptyList(), true, "invalid") }

internal class SharedTaskFieldQuery(saved: JSONObject) {
    init {
        require(saved.keys().asSequence().toSet() == setOf("criteria", "sort", "calendar"))
        require(saved.getJSONArray("criteria").length() <= 20)
        SharedCustomCalendar.restore(saved.getJSONObject("calendar"))
        require(saved.getString("sort").isEmpty() || Regex("custom:[A-Za-z0-9_-]{1,100}:(asc|desc)").matches(saved.getString("sort")))
        for (index in 0 until saved.getJSONArray("criteria").length()) {
            val row = saved.getJSONArray("criteria").getJSONObject(index)
            CustomFieldProtocol.id(row.getString("fieldId"))
            require(row.getString("op") in setOf("eq", "ne", "contains", "exists", "missing", "gt", "gte", "lt", "lte"))
            require(row.keys().asSequence().all { it in setOf("fieldId", "op", "value") })
            if (row.has("value")) CustomFieldProtocol.values(JSONObject().put("value", row.get("value")))
        }
    }
    var criteriaJson by mutableStateOf(saved.getJSONArray("criteria").toString())
    var customSort by mutableStateOf(saved.getString("sort"))
    var calendarJson by mutableStateOf(saved.getJSONObject("calendar").toString())
    val criteria get() = JSONArray(criteriaJson)
    val count get() = criteria.length()
    val calendar get() = SharedCustomCalendar.restore(JSONObject(calendarJson))
    fun saved() = JSONObject().put("criteria", criteria).put("sort", customSort).put("calendar", JSONObject(calendarJson))
    fun order(default: TaskListSort) = customSort.ifBlank { default.wire }
    fun filter(base: JSONObject) = JSONObject(base.toString()).apply { if (count > 0) put("customFields", criteria) }
    fun valid(base: JSONObject, fields: List<JSONObject>, default: TaskListSort): Boolean = runCatching {
        CustomFieldQueryProtocol.filter(base, criteria, fields); CustomFieldQueryProtocol.sort(order(default), fields)
    }.isSuccess
    fun reset() { criteriaJson = "[]" }
    fun remove(index: Int) { criteriaJson = JSONArray((0 until count).filter { it != index }.map { criteria.getJSONObject(it) }).toString() }
}

@Composable internal fun rememberSharedTaskFieldQuery(project: String, prefs: UiPreferences): SharedTaskFieldQuery {
    val account = LocalGenesisUserId.current
    // The workspace briefly clears projectId while restoring membership. Keep each project's
    // own conditions across that transition without retaining any downloaded catalog or task.
    val queries = rememberSaveable(account, saver = Saver<LinkedHashMap<String, SharedTaskFieldQuery>, String>(
        save = { values -> JSONObject().apply { values.forEach { (id, query) -> put(id, query.saved()) } }.toString() },
        restore = { raw -> runCatching { val saved = JSONObject(raw); linkedMapOf<String, SharedTaskFieldQuery>().apply {
            saved.keys().asSequence().take(20).forEach { id -> put(id, SharedTaskFieldQuery(saved.getJSONObject(id))) }
        } }.getOrDefault(linkedMapOf()) })) { linkedMapOf() }
    return queries.getOrPut(project) {
        if (queries.size >= 20) queries.remove(queries.keys.first())
        SharedTaskFieldQuery(JSONObject().put("criteria", JSONArray()).put("sort", "").put("calendar", SharedCustomCalendar.initial(prefs).saved()))
    }
}

internal fun customFieldOperationLabel(op: String) = when (op) {
    "eq" -> "Равно"; "ne" -> "Не равно"; "contains" -> "Содержит"; "exists" -> "Значение задано"
    "missing" -> "Значение отсутствует"; "gt" -> "Больше"; "gte" -> "Не меньше"; "lt" -> "Меньше"; else -> "Не больше"
}

@Composable internal fun SharedTaskFieldCriteria(rows: JSONArray, fields: List<JSONObject>, calendar: SharedCustomCalendar,
    remove: (Int) -> Unit) {
    val language = LocalGenesisLanguage.current
    val unavailable = genesisTranslate("Недоступно")
    val displayCalendar = if (LocalSacredFeaturesEnabled.current) calendar else calendar.copy(mode = CalendarMode.PROFANE)
    for (index in 0 until rows.length()) {
        val row = rows.getJSONObject(index)
        val field = fields.find { it.getString("id") == row.optString("fieldId") }
        Row(Modifier.fillMaxWidth().testTag("field-criterion-$index"), verticalAlignment = Alignment.CenterVertically) {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                UntranslatedText(field?.getString("title") ?: unavailable, style = MaterialTheme.typography.titleSmall)
                Text(customFieldOperationLabel(row.getString("op")), style = MaterialTheme.typography.bodySmall)
                if (row.has("value") && field != null) {
                    val value = row.get("value")
                    val text = when {
                        value is Boolean -> genesisTranslate(if (value) "Да" else "Нет")
                        field.getString("type") == "date" -> genesisTranslate(sharedTaskFieldValueText(field, value, language, displayCalendar, unavailable))
                        else -> sharedTaskFieldValueText(field, value, language, displayCalendar, unavailable)
                    }
                    UntranslatedText(text, style = MaterialTheme.typography.bodyMedium)
                }
            }
            AffairsIconButton("Убрать фильтр", AffairsAction.CLOSE, { remove(index) }, Modifier.testTag("field-criterion-remove-$index"))
        }
    }
}

@Composable internal fun SharedTaskFieldFilterEditor(query: SharedTaskFieldQuery, fields: List<JSONObject>,
    onCalendar: ((SharedCustomCalendar) -> Unit)? = null) {
    var fieldId by rememberSaveable { mutableStateOf("") }
    var op by rememberSaveable { mutableStateOf("eq") }
    var input by rememberSaveable { mutableStateOf("{}") }
    var failure by remember { mutableStateOf(false) }
    val field = fields.find { it.getString("id") == fieldId }
    if (fields.isEmpty() && query.count == 0) return
    AffairsDisclosure("Пользовательские поля", Modifier.testTag("field-filter-block")) {
        SharedTaskFieldCriteria(query.criteria, fields, query.calendar) { query.remove(it) }
        ImportChoice("Поле", fieldId, listOf("" to genesisTranslate("Выберите поле")) + fields.map {
            it.getString("id") to (it.getString("title") + if (it.getBoolean("archived")) " · " + genesisTranslate("Архив") else "")
        }, query.count < 20, "field-filter-choice") { fieldId = it; input = "{}"; op = "eq"; failure = false }
        if (field != null) {
            val operations = CustomFieldQueryProtocol.operations(field.getString("type"))
            ImportChoice("Условие", op, operations.map { it to genesisTranslate(customFieldOperationLabel(it)) }, query.count < 20, "field-filter-op") { op = it; failure = false }
            val value = JSONObject(input).opt(fieldId)
            if (op !in setOf("exists", "missing")) {
                // Reuse typed controls but allow archived search choices. Task writers keep their stricter rules.
                val searchable = JSONObject(field.toString()).put("archived", false).put("required", false)
                val options = searchable.getJSONArray("options")
                for (index in 0 until options.length()) options.getJSONObject(index).put("archived", false)
                SharedCustomField(searchable, CustomFieldDraft.fromTask(JSONObject().put("customFields", JSONObject(input))), null, false,
                    query.calendar, true, query.count >= 20, Modifier, { id, next ->
                        input = JSONObject(input).put(id, next ?: JSONObject.NULL).toString(); failure = false
                    }, { input = "{}" }, { query.calendarJson = it.saved().toString(); onCalendar?.invoke(it) })
            }
            val criterion = runCatching { CustomFieldQueryProtocol.criterion(field, op, value) }.getOrNull()
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Добавить фильтр", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                AffairsIconButton("Добавить фильтр", AffairsAction.ADD, {
                    try {
                        val rows = JSONArray(query.criteriaJson).put(requireNotNull(criterion))
                        CustomFieldQueryProtocol.filter(JSONObject(), rows, fields)
                        query.criteriaJson = rows.toString(); input = "{}"; failure = false
                    } catch (_: Exception) { failure = true }
                }, Modifier.testTag("field-filter-add"), enabled = criterion != null && query.count < 20)
            }
        }
        if (failure) Text("Условия выборки недействительны. Исправьте или сбросьте фильтр.", color = MaterialTheme.colorScheme.error)
    }
}

@Composable internal fun SharedTaskFieldSort(default: TaskListSort, onDefault: (TaskListSort) -> Unit,
    query: SharedTaskFieldQuery, fields: List<JSONObject>, modifier: Modifier = Modifier, iconOnly: Boolean = false) {
    var open by rememberSaveable { mutableStateOf(false) }
    val current = query.customSort.split(':')
    val field = current.getOrNull(1)?.let { id -> fields.find { it.getString("id") == id } }
    val label = if (query.customSort.isBlank()) genesisTranslate(default.ru) else
        (field?.getString("title") ?: genesisTranslate("Недоступно")) + " · " + genesisTranslate(if (current.lastOrNull() == "desc") "По убыванию" else "По возрастанию")
    Row(modifier, verticalAlignment = Alignment.CenterVertically) {
        if (!iconOnly) UntranslatedText(label, Modifier.weight(1f), style = MaterialTheme.typography.bodySmall)
        AffairsIconButton(genesisTranslate("Сортировка") + ": " + label, AffairsAction.SORT, { open = true }, Modifier.testTag("shared-field-sort"))
    }
    if (open) AlertDialog(onDismissRequest = { open = false }, title = { Text("Сортировка") },
        text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            TaskListSort.entries.forEach { order ->
                FilterChip(query.customSort.isBlank() && default == order, { onDefault(order); query.customSort = ""; open = false },
                    label = { Text(order.ru) }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("task-sort-${order.wire}"))
            }
            Text("Пользовательские поля", style = MaterialTheme.typography.titleSmall)
            var search by remember { mutableStateOf("") }
            AffairsSearchField(search, { search = it }, "Поиск", Modifier.testTag("field-sort-search"))
            var limit by rememberSaveable(search) { mutableIntStateOf(5) }
            val choices = fields.filter { it.getString("type") != "multi" && it.getString("title").contains(search, true) }
            choices.take(limit).forEach { choice ->
                UntranslatedText(choice.getString("title"), style = MaterialTheme.typography.titleSmall)
                if (choice.getBoolean("archived")) Text("Архив", style = MaterialTheme.typography.labelSmall)
                FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    listOf("asc" to "По возрастанию", "desc" to "По убыванию").forEach { (direction, title) ->
                        val wire = "custom:${choice.getString("id")}:$direction"
                        FilterChip(query.customSort == wire, { query.customSort = wire; open = false }, label = { Text(title) },
                            modifier = Modifier.heightIn(min = 48.dp).testTag("field-sort-${choice.getString("id")}-$direction"))
                    }
                }
            }
            if (choices.size > limit) OutlinedButton({ limit += 5 }, Modifier.heightIn(min = 48.dp).testTag("field-sort-more")) { Text("Показать ещё") }
        } }, confirmButton = {})
}

@Composable internal fun SharedTaskListFilterDialog(status: String, completion: String, assignee: String, priority: Int,
    statuses: List<JSONObject>, members: List<JSONObject>, query: SharedTaskFieldQuery, fields: List<JSONObject>,
    onDismiss: () -> Unit, onApply: (String, String, String, Int) -> Unit) {
    var draftStatus by rememberSaveable { mutableStateOf(status) }
    var draftCompletion by rememberSaveable { mutableStateOf(completion) }
    var draftAssignee by rememberSaveable { mutableStateOf(assignee) }
    var draftPriority by rememberSaveable { mutableIntStateOf(priority) }
    val draft = rememberSaveable(saver = Saver<SharedTaskFieldQuery, String>(save = { it.saved().toString() }, restore = { SharedTaskFieldQuery(JSONObject(it)) })) { SharedTaskFieldQuery(query.saved()) }
    AffairsFilterDialog(onDismiss, {
        query.criteriaJson = draft.criteriaJson; query.calendarJson = draft.calendarJson
        onApply(draftStatus, draftCompletion, draftAssignee, draftPriority)
    }, { draftStatus = ""; draftCompletion = "any"; draftAssignee = ""; draftPriority = -1; draft.reset() }) {
        ImportChoice("Выполнение", draftCompletion, listOf("any" to "Все задачи", "open" to "Незавершённые", "completed" to "Завершённые")
            .map { it.first to genesisTranslate(it.second) }, true, "shared-filter-completion") { draftCompletion = it }
        ImportChoice("Статус", draftStatus, listOf("" to genesisTranslate("Все")) + statuses.map { row ->
            val title = row.getString("title")
            row.getString("id") to if (title in setOf("К выполнению", "В работе", "Готово")) genesisTranslate(title) else title
        }, true, "shared-filter-status") { draftStatus = it }
        ImportChoice("Исполнитель", draftAssignee, listOf("" to "Все", "me" to "Назначено мне", "unassigned" to "Без исполнителя")
            .map { it.first to genesisTranslate(it.second) } + members.map { it.getString("userId") to it.getString("displayName") }, true, "shared-filter-assignee") { draftAssignee = it }
        ImportChoice("Приоритет", draftPriority.toString(), listOf("Все", "Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет")
            .mapIndexed { index, label -> (index - 1).toString() to genesisTranslate(label) }, true, "shared-filter-priority") { draftPriority = it.toInt() }
        HorizontalDivider()
        SharedTaskFieldFilterEditor(draft, fields)
    }
}

internal fun sharedTaskListFieldValues(task: JSONObject, fields: List<JSONObject>): List<Pair<JSONObject, Any>> {
    val values = runCatching { CustomFieldProtocol.fromTask(task) }.getOrNull() ?: return emptyList()
    return fields.filter { it.getBoolean("showList") && !it.getBoolean("archived") &&
        (it.isNull("projectId") || it.getString("projectId") == task.optString("projectId")) && it.getString("spaceId") == task.optString("spaceId") }
        .mapNotNull { field ->
            val value = values.opt(field.getString("id"))
            if (CustomFieldProtocol.absent(value)) null else field to runCatching { CustomFieldProtocol.normalize(field, value, value, input = false) }.getOrDefault(JSONObject.NULL)
        }
}

internal fun sharedTaskFieldValueText(field: JSONObject, value: Any?, language: String, calendar: SharedCustomCalendar, unavailable: String): String =
    if (field.getString("type") == "date" && value is String && calendar.mode == CalendarMode.PROFANE)
        runCatching { java.time.LocalDate.parse(value).format(java.time.format.DateTimeFormatter.ofLocalizedDate(java.time.format.FormatStyle.MEDIUM)
            .withLocale(java.util.Locale.forLanguageTag(language))) }.getOrDefault(value)
    else customDisplay(field, value, language, calendar, unavailable).orEmpty()

@Composable internal fun SharedTaskListCustomValues(task: JSONObject, fields: List<JSONObject>, calendar: SharedCustomCalendar) {
    val values = sharedTaskListFieldValues(task, fields)
    if (values.isEmpty()) return
    val language = LocalGenesisLanguage.current
    val unavailable = genesisTranslate("Недоступно")
    val safeCalendar = if (LocalSacredFeaturesEnabled.current) calendar else calendar.copy(mode = CalendarMode.PROFANE)
    FlowRow(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 8.dp).testTag("task-list-fields"),
        horizontalArrangement = Arrangement.spacedBy(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        values.forEach { (field, value) ->
            val text = when {
                CustomFieldProtocol.absent(value) -> unavailable
                value is Boolean -> genesisTranslate(if (value) "Да" else "Нет")
                field.getString("type") == "date" -> genesisTranslate(sharedTaskFieldValueText(field, value, language, safeCalendar, unavailable))
                else -> sharedTaskFieldValueText(field, value, language, safeCalendar, unavailable)
            }
            UntranslatedText(field.getString("title") + ": " + text,
                Modifier.widthIn(min = 160.dp, max = 400.dp).testTag("task-list-field-${field.getString("id")}"), style = MaterialTheme.typography.bodySmall)
        }
    }
}

@Composable internal fun SharedTaskListQueryStatus(reader: SharedTaskListReader, valid: Boolean) {
    if (!valid || reader.error.isNotBlank()) {
        Text(if (!valid || reader.error in setOf("CUSTOM_FIELD_FILTER_INVALID", "CUSTOM_FIELD_SORT_INVALID", "CUSTOM_FIELD_UNAVAILABLE", "INVALID_TASK_FILTER"))
            "Условия выборки недействительны. Исправьте или сбросьте фильтр." else "Не удалось загрузить данные",
            Modifier.testTag("field-query-error"), color = MaterialTheme.colorScheme.error)
    }
}
