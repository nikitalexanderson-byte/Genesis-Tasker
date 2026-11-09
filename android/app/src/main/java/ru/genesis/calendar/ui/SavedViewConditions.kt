package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SavedViewProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import java.time.ZoneId

private fun savedViewIds(filter: JSONObject, key: String) = filter.optJSONArray(key)?.let { values -> (0 until values.length()).map(values::getString) }.orEmpty()

@Composable internal fun SavedViewConditions(gateway: SharedWorkspaceGateway, state: SharedSavedViewsState, spaces: List<JSONObject>, prefs: UiPreferences) {
    val value = state.edit ?: return
    val definition = state.definition
    val enabled = !state.busy && !state.locked && state.library != null && state.source?.optBoolean("canEdit") != false
    if (definition == null) {
        Text("Часть условий больше недоступна. Исправьте представление перед открытием.", color = MaterialTheme.colorScheme.error)
        val repaired = value.optJSONObject("definition")?.let { raw -> runCatching {
            SavedViewProtocol.definition(JSONObject(raw.toString()).put("calendarContext", freshSavedView(prefs, "").getJSONObject("calendarContext")))
        }.getOrNull() }
        if (repaired != null) OutlinedButton({ state.change { it.put("definition", repaired) } }, enabled = enabled) { Text("Использовать текущий календарный контекст") }
        return
    }
    val filter = definition.getJSONObject("filter")
    val space = value.optString("spaceId").takeUnless { it.isBlank() || it == "null" }.orEmpty()
    fun definition(change: (JSONObject) -> Unit) = state.change { change(it.getJSONObject("definition")) }
    fun ids(key: String, values: List<String>) = state.criteria { if (values.isEmpty()) it.remove(key) else it.put(key, JSONArray(values)) }
    Text("Условия", style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(definition.getString("title"), { text -> definition { it.put("title", text) } }, enabled = enabled,
        label = { Text("Название") }, modifier = Modifier.fillMaxWidth().testTag("saved-view-name"))
    val noSpace = genesisTranslate("Все доступные проекты")
    ImportChoice(genesisTranslate("Пространство"), space, listOf("" to noSpace) + spaces.map { it.getString("id") to it.getString("title") },
        enabled && state.source == null, "saved-view-space", userLabel = true) { selected -> state.change { edit ->
            edit.put("spaceId", selected.takeIf(String::isNotBlank) ?: JSONObject.NULL)
            if (selected.isBlank()) edit.put("visibility", "personal")
            val criteria = SavedViewProtocol.filter(edit.getJSONObject("definition").get("filter"))
            if (selected.isBlank()) criteria.remove("spaceId") else criteria.put("spaceId", selected)
            edit.getJSONObject("definition").put("filter", criteria)
        }
    }
    val canShare = spaces.any { it.getString("id") == space && it.optString("role") in setOf("owner", "admin") }
    ImportChoice("Видимость", value.getString("visibility"), listOf("personal" to genesisTranslate("Личное"), "shared" to genesisTranslate("Общее")),
        enabled && state.source == null && canShare, "saved-view-visibility") { selected -> state.change { it.put("visibility", selected) } }
    Text("Личное представление видно только вам. Общим представлением могут пользоваться участники пространства с доступом к выбранным проектам.", style = MaterialTheme.typography.bodySmall)
    val optionFilter = JSONObject().apply {
        if (space.isNotBlank()) put("spaceId", space)
        if (savedViewIds(filter, "projectIds").isNotEmpty()) put("projectIds", filter.getJSONArray("projectIds"))
    }
    AffairsDisclosure("Фильтры", Modifier.testTag("saved-view-basic-filters")) {
        Text("Пустой выбор включает все доступные проекты. Условия не выдают доступ к задачам.", style = MaterialTheme.typography.bodySmall)
        listOf("projects" to "Проекты", "statuses" to "Статусы", "assignees" to "Исполнители", "labels" to "Метки").forEach { (kind, label) ->
            val key = when (kind) { "projects" -> "projectIds"; "statuses" -> "statusIds"; "assignees" -> "assigneeIds"; else -> "labelIds" }
            SavedViewOptionChoice(gateway, kind, label, if (kind == "projects") JSONObject().apply { if (space.isNotBlank()) put("spaceId", space) } else optionFilter,
                savedViewIds(filter, key), enabled) { ids(key, it) }
        }
        ImportChoice("Выполнение", filter.optString("completion", "any"), listOf("any" to genesisTranslate("Все задачи"), "open" to genesisTranslate("Открытые задачи"), "completed" to genesisTranslate("Завершённые задачи")),
            enabled, "saved-view-completion") { selected -> state.criteria { if (selected == "any") it.remove("completion") else it.put("completion", selected) } }
        val priorities = filter.optJSONArray("priority")?.let { rows -> (0 until rows.length()).map(rows::getInt) }.orEmpty()
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет").forEachIndexed { index, title ->
                FilterChip(index in priorities, { state.criteria { it.put("priority", JSONArray(if (index in priorities) priorities - index else priorities + index)) } },
                    label = { Text(title) }, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp).testTag("saved-view-priority-$index"))
            }
        }
        OutlinedTextField(filter.optString("q"), { text -> state.criteria { if (text.isBlank()) it.remove("q") else it.put("q", text) } },
            enabled = enabled, label = { Text("Поиск") }, modifier = Modifier.fillMaxWidth().testTag("saved-view-search"))
        var tagsInput by remember(state.selection) { mutableStateOf(savedViewIds(filter, "tags").joinToString(", ")) }
        OutlinedTextField(tagsInput, { text -> tagsInput = text; ids("tags", text.split(',').map(String::trim).filter(String::isNotEmpty).distinct()) },
            enabled = enabled, label = { Text("Теги через запятую") }, modifier = Modifier.fillMaxWidth().testTag("saved-view-tags"))
        for ((key, label) in listOf("createdBy" to "Создано мной", "approvalPending" to "Ожидает утверждения", "includeArchived" to "Включить архивные данные")) {
            val checked = if (key == "createdBy") filter.optString(key) == "me" else filter.optBoolean(key)
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text(label, Modifier.weight(1f))
                Switch(checked, { yes -> state.criteria { criteria -> if (yes) criteria.put(key, if (key == "createdBy") "me" else true) else criteria.remove(key) } },
                    enabled = enabled, modifier = Modifier.testTag("saved-view-$key"))
            }
        }
    }
    val context = definition.getJSONObject("calendarContext")
    val zone = runCatching { ZoneId.of(context.getString("timeZone")) }.getOrNull()
    val mode = CalendarMode.fromWire(definition.getString("calendarMode"))
    val calendars = if (LocalSacredFeaturesEnabled.current) CalendarMode.entries else listOf(CalendarMode.PROFANE)
    AffairsDisclosure("Период", Modifier.testTag("saved-view-period")) {
        ImportChoice("Период", definition.getString("relative"), listOf("none" to genesisTranslate("Фиксированный диапазон"), "overdue" to genesisTranslate("Просрочено"),
            "this-week" to genesisTranslate("На этой неделе"), "this-month" to genesisTranslate("В этом месяце")), enabled, "saved-view-relative") { selected -> definition {
            it.put("relative", selected); if (selected != "none") { val criteria = SavedViewProtocol.filter(it.get("filter")); criteria.remove("dueFrom"); criteria.remove("dueTo"); it.put("filter", criteria) }
        } }
        ImportChoice("Календарь", mode.wireValue, (calendars + mode).distinct().map { it.wireValue to genesisTranslate(when (it) { CalendarMode.PROFANE -> "Григорианский"; CalendarMode.SACRED -> "Сакральный"; CalendarMode.LUNAR -> "Лунный" }) }, enabled, "saved-view-calendar") { selected -> definition { it.put("calendarMode", selected) } }
        OutlinedTextField(context.getString("timeZone"), { text -> definition { it.getJSONObject("calendarContext").put("timeZone", text) } }, enabled = enabled,
            isError = zone == null, label = { Text("Часовой пояс") }, modifier = Modifier.fillMaxWidth().testTag("saved-view-zone"))
        if (zone == null) Text("Введите действительный часовой пояс IANA, например Europe/Moscow. Черновик сохранён.", color = MaterialTheme.colorScheme.error)
        ImportChoice("Начало года", context.getString("gregorianYearStart"), listOf("january" to genesisTranslate("Январь"), "march" to genesisTranslate("Март")), enabled, "saved-view-year-start") { selected -> definition { it.getJSONObject("calendarContext").put("gregorianYearStart", selected) } }
        if (zone != null && definition.getString("relative") == "none") {
            val calculation = CalendarContext(timeZone = zone.id, gregorianYearStart = context.getString("gregorianYearStart"))
            val visible = if (LocalSacredFeaturesEnabled.current) mode else CalendarMode.PROFANE
            for ((key, label) in listOf("dueFrom" to "Начало", "dueTo" to "Окончание")) {
                Text(label, style = MaterialTheme.typography.titleSmall)
                val rawDate = filter.optString(key)
                val validDate = rawDate.isBlank() || runCatching { java.time.LocalDate.parse(rawDate) }.isSuccess
                if (!validDate) UntranslatedText(rawDate, color = MaterialTheme.colorScheme.error)
                AuthorDatePicker(if (validDate) rawDate else "", visible, calculationContext = calculation, enabled = enabled, placeholder = "Выберите дату",
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("saved-view-$key")) { selected -> state.criteria { if (selected.isBlank()) it.remove(key) else it.put(key, selected) } }
                if (filter.has(key)) AffairsIconButton("Очистить дату", AffairsAction.CLOSE, { state.criteria { it.remove(key) } }, enabled = enabled)
            }
        }
    }
    var fields by remember(gateway, space) { mutableStateOf(emptyList<JSONObject>()) }
    var fieldsError by remember(gateway, space) { mutableStateOf(false) }
    val metadataAllowed = state.library != null
    LaunchedEffect(gateway, space, state.selection, metadataAllowed) {
        fields = emptyList(); fieldsError = false
        if (metadataAllowed && space.isNotBlank()) try { fields = importRows(gateway.sharedSavedViewFields(space).getJSONArray("fields")) }
        catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { fieldsError = true }
    }
    val visibleFields = if (metadataAllowed) fields else emptyList()
    if (fieldsError) Text("Не удалось загрузить данные", color = MaterialTheme.colorScheme.error)
    val sortLabels = listOf("Порядок на доске", "Новые вверху", "Старые вверху", "Приоритет", "Срок", "Название", "Последнее изменение")
    val sorts = SavedViewProtocol.sorts.mapIndexed { index, sort -> sort to genesisTranslate(sortLabels[index]) } + visibleFields.filter { it.getString("type") != "multi" }.flatMap { field ->
        listOf("asc", "desc").map { direction -> "custom:${field.getString("id")}:$direction" to (field.getString("title") + " · " + genesisTranslate(if (direction == "asc") "По возрастанию" else "По убыванию")) }
    }
    ImportChoice(genesisTranslate("Сортировка"), definition.getString("sort"), sorts + if (sorts.none { it.first == definition.getString("sort") }) listOf(definition.getString("sort") to genesisTranslate("Недоступно")) else emptyList(),
        enabled, "saved-view-sort", userLabel = true) { selected -> definition { it.put("sort", selected) } }
    run {
        val calendar = value.optJSONObject("inputCalendar")?.let(SharedCustomCalendar::restore) ?: SharedCustomCalendar.initial(prefs)
        val query = remember(state.selection) { SharedTaskFieldQuery(JSONObject().put("criteria", filter.optJSONArray("customFields") ?: JSONArray()).put("sort", "").put("calendar", calendar.saved())) }
        // A date-field input calendar is independent of the view's relative-period calendar.
        // This editor owns the input-calendar changes for this selection. Feeding the
        // stored value back into the editor races its first local change and can undo it.
        if (enabled) SharedTaskFieldFilterEditor(query, visibleFields) { selected -> state.change { it.put("inputCalendar", selected.saved()) } }
        else SharedTaskFieldCriteria(query.criteria, visibleFields, calendar) { }
        LaunchedEffect(query.criteriaJson, query.calendarJson, enabled) {
            if (enabled) {
                val rows = JSONArray(query.criteriaJson)
                if ((filter.optJSONArray("customFields") ?: JSONArray()).toString() != rows.toString()) state.criteria { if (rows.length() == 0) it.remove("customFields") else it.put("customFields", rows) }
            }
        }
    }
}

@Composable private fun SavedViewOptionChoice(gateway: SharedWorkspaceGateway, kind: String, label: String, filter: JSONObject,
    values: List<String>, enabled: Boolean, onChange: (List<String>) -> Unit) {
    var open by remember { mutableStateOf(false) }
    val key = filter.toString()
    var page by remember(key, kind) { mutableStateOf<JSONObject?>(null) }
    var failure by remember(key, kind) { mutableStateOf(false) }
    var busy by remember(key, kind) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(gateway, key, kind, open, enabled) {
        page = null; failure = false
        if (!open || !enabled) return@LaunchedEffect
        busy = true
        try { page = gateway.sharedBulkOptions(kind, JSONObject(key), null) }
        catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { failure = true } finally { busy = false }
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f))
        UntranslatedText(java.text.NumberFormat.getIntegerInstance(java.util.Locale.forLanguageTag(LocalGenesisLanguage.current)).format(values.size))
        AffairsIconButton("Изменить условия", AffairsAction.EDIT, { open = true }, Modifier.testTag("saved-view-options-$kind"), enabled = enabled)
    }
    if (open && enabled) AlertDialog(onDismissRequest = { open = false }, title = { Text(label) }, text = {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (busy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
            val base = if (kind == "assignees") listOf(JSONObject().put("id", "me").put("title", genesisTranslate("Назначено мне")), JSONObject().put("id", "unassigned").put("title", genesisTranslate("Без исполнителя"))) else emptyList()
            val rows = base + page?.getJSONArray("options")?.let(::importRows).orEmpty()
            val choices = rows + values.filter { id -> rows.none { it.getString("id") == id } }.map { JSONObject().put("id", it).put("title", genesisTranslate("Недоступно") + " · " + it.take(8)) }
            choices.forEach { option -> val id = option.getString("id")
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(id in values, { yes -> onChange(if (yes) (values + id).distinct() else values - id) }, enabled = enabled,
                        modifier = Modifier.testTag("saved-view-option-$id").semantics { contentDescription = option.getString("title") })
                    UntranslatedText(option.getString("title"), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
                }
            }
            if (failure) Text("Не удалось загрузить данные", color = MaterialTheme.colorScheme.error)
            if (page?.optBoolean("hasMore") == true) OutlinedButton({
                val previous = page ?: return@OutlinedButton; val cursor = previous.getString("nextCursor")
                scope.launch { busy = true; try {
                    val next = gateway.sharedBulkOptions(kind, JSONObject(key), cursor)
                    if (open && key == filter.toString()) page = next.put("options", JSONArray((importRows(previous.getJSONArray("options")) + importRows(next.getJSONArray("options"))).distinctBy { it.getString("id") }))
                } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { page = null; failure = true } finally { busy = false } }
            }, enabled = !busy) { Text("Показать ещё") }
        }
    }, confirmButton = { TextButton({ open = false }, Modifier.heightIn(min = 48.dp)) { Text("Готово") } })
}
