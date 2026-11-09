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
import ru.genesis.calendar.auth.CustomFieldDraft
import ru.genesis.calendar.auth.SharedTemplateManifest
import ru.genesis.calendar.auth.SharedTemplateProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.util.Locale

/** Form-only binding deliberately has no command, prepare, send or apply capability. */
internal class SharedTemplateApplyForm(val edit: JSONObject?, val source: JSONObject?, val preview: JSONObject?,
    val editable: Boolean, val previewCurrent: Boolean, private val onChange: (JSONObject, Boolean) -> Boolean,
    private val onDateInput: (SharedCustomCalendar) -> Unit, private val onTitle: (String) -> Unit) {
    fun change(edit: JSONObject, invalidateReview: Boolean = true) = onChange(edit, invalidateReview)
    fun changeDateInput(calendar: SharedCustomCalendar) = onDateInput(calendar)
    fun changeTitle(value: String) = onTitle(value)
}
private fun templateApplyForm(state: SharedTemplateState) = SharedTemplateApplyForm(state.edit, state.source, state.preview,
    state.editable, state.previewCurrent, state::change, state::changeDateInput, state::changeTitle)

@Composable internal fun SharedTemplateApplyEditor(state: SharedTemplateState, preferences: UiPreferences, projects: List<JSONObject>) =
    SharedTemplateApplyEditor(templateApplyForm(state), preferences, projects)

@Composable internal fun SharedTemplateApplyEditor(state: SharedTemplateApplyForm, preferences: UiPreferences, projects: List<JSONObject>,
    automationRun: Boolean = false) {
    val edit = state.edit ?: return; val request = edit.getJSONObject("request"); val options = SharedTemplateProtocol.options(request)
    val source = state.source; val preview = state.preview; val copy = sharedTemplateCopy(); val enabled = state.editable
    val kind = source?.optString("kind") ?: if (!options.isNull("projectId")) "task" else "project"
    val calendar = edit.optJSONObject("dateInput")?.let(SharedCustomCalendar::restore) ?: SharedCustomCalendar.initial(preferences)
    fun change(action: (JSONObject) -> Unit) { val next = SharedTemplateEdits.copy(edit); action(next.getJSONObject("request")); state.change(next) }
    Column(Modifier.fillMaxWidth().testTag("template-apply-editor"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(if (automationRun) "Шаблон создаст задачи в проекте правила. Базовая дата — день запуска в часовом поясе правила. Предпросмотр показывает пример на сегодня."
            else "Будут созданы самостоятельные задачи. Файлы, обсуждения, права и подписки не копируются.", style = MaterialTheme.typography.bodyMedium)
        val destination = if (kind == "task") "projectId" else "parentProjectId"
        if (!automationRun) ImportChoice("Место создания", options.optString(destination).takeUnless { it == "null" }.orEmpty().ifBlank { "@none" },
            listOf("@none" to genesisTranslate(if (kind == "task") "Выберите проект" else "Корень пространства")) + projects.filter { it.optString("archivedAt") in setOf("", "null") && sharedTaskCanEdit(it) }.map { it.getString("id") to it.getString("title") }, enabled, "template-apply-destination") { value -> change {
                it.put(destination, value.takeUnless { it == "@none" } ?: JSONObject.NULL).put("boardStatusId", JSONObject.NULL)
                for (key in listOf("statusMap", "categoryMap", "fieldMap", "optionMap", "fieldValues")) it.put(key, JSONObject())
            }
        }
        if (!automationRun) {
            Text("Базовая дата", style = MaterialTheme.typography.titleSmall)
            AuthorDatePicker(options.getString("anchorDate"), calendar.mode, calculationContext = calendar.context, enabled = enabled,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-apply-anchor")) { value -> change { it.put("anchorDate", value) } }
        }
        if (!LocalTemplateInspection.current) AffairsDisclosure("Календарь ввода") { EditorCalendarModePicker(calendar.mode, { state.changeDateInput(calendar.copy(mode = it)) }, enabled, preferredMode = calendar.mode, tag = "template-apply-input-calendar") }
        TemplateField("Название нового объекта", options.optString("title").takeUnless { it == "null" }.orEmpty(), enabled, "template-apply-title", onChange = state::changeTitle)
        AffairsDisclosure("Переносимые данные", initiallyExpanded = true) {
            for (flag in SharedTemplateProtocol.transfer) TemplateToggle(copy.getJSONObject("options").getString(flag), options.getJSONObject("include").getBoolean(flag), enabled, "template-transfer-$flag", labelIsLocalized = true) { value -> change {
                it.put("include", SharedTemplateProtocol.dictionary(it.opt("include")).put(flag, value)).put("fieldValues", JSONObject())
            } }
        }
        if (preview != null) TemplateApplyMappings(state, preview, source, options)
        if (preview != null) SharedTemplatePreview(state, preferences)
    }
}

@Composable private fun TemplateApplyMappings(state: SharedTemplateApplyForm, preview: JSONObject, source: JSONObject?, options: JSONObject) {
    if (source == null) return
    val manifest = source.getJSONObject("manifest"); val root = manifest.getJSONArray("projects").getJSONObject(0); val enabled = state.editable
    val tasks = SharedTemplateEdits.rows(manifest.getJSONArray("tasks")); val members = SharedTemplateEdits.rows(preview.getJSONArray("members"))
    val sourceMembers = linkedSetOf<String>()
    tasks.forEach { task ->
        (task.opt("assigneeId") as? String)?.let(sourceMembers::add); sourceMembers.addAll(templateStrings(task.getJSONArray("approverIds")))
        SharedTemplateEdits.rows(task.getJSONArray("checklists")).forEach { list -> SharedTemplateEdits.rows(list.getJSONArray("items")).forEach { (it.opt("assigneeId") as? String)?.let(sourceMembers::add) } }
    }
    fun map(name: String, key: String, value: String) {
        val edit = SharedTemplateEdits.copy(requireNotNull(state.edit)); val request = edit.getJSONObject("request")
        val dictionary = SharedTemplateProtocol.dictionary(request.opt(name))
        if (value == "@auto") dictionary.remove(key) else dictionary.put(key, value.takeUnless { it == "@none" } ?: JSONObject.NULL)
        request.put(name, dictionary).put("fieldValues", JSONObject()); state.change(edit)
    }
    fun mapped(name: String, key: String) = options.getJSONObject(name).let { if (!it.has(key)) "@auto" else it.optString(key).takeUnless { value -> value == "null" }.orEmpty().ifBlank { "@none" } }
    val language = LocalGenesisLanguage.current; val number = remember(language) { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)) }
    AffairsDisclosure("Сопоставление данных", Modifier.testTag("template-mappings")) {
        if (!LocalTemplateInspection.current) TemplateOutlinedButton({ val edit = SharedTemplateEdits.copy(requireNotNull(state.edit)); for (key in listOf("statusMap", "categoryMap", "fieldMap", "optionMap", "memberMap", "fieldValues")) edit.getJSONObject("request").put(key, JSONObject()); state.change(edit) }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Сбросить") }
        if (source.getString("kind") == "task") {
            SharedTemplateEdits.rows(root.getJSONArray("statuses")).forEach { status -> ImportChoice(status.getString("title"), mapped("statusMap", status.getString("key")),
                listOf("@auto" to genesisTranslate("Автоматически")) + SharedTemplateEdits.rows(preview.getJSONArray("statuses")).filter { !it.getBoolean("isDone") }.map { it.getString("id") to it.getString("title") }, enabled, "template-status-map-${status.getString("key")}", userLabel = true) { map("statusMap", status.getString("key"), it) } }
            SharedTemplateEdits.rows(root.getJSONArray("categories")).forEach { category -> ImportChoice(category.getString("title"), mapped("categoryMap", category.getString("key")),
                listOf("@auto" to genesisTranslate("Автоматически"), "@none" to genesisTranslate("Не переносится")) + SharedTemplateEdits.rows(preview.getJSONArray("categories")).map { it.getString("id") to it.getString("title") }, enabled, "template-category-map-${category.getString("key")}", userLabel = true) { map("categoryMap", category.getString("key"), it) } }
            if (options.getJSONObject("include").getBoolean("customFields")) SharedTemplateEdits.rows(preview.getJSONArray("sourceFields")).forEach { field ->
                ImportChoice(field.getString("title"), mapped("fieldMap", field.getString("key")),
                listOf("@auto" to genesisTranslate("Автоматически"), "@none" to genesisTranslate("Не задано")) + SharedTemplateEdits.rows(preview.getJSONArray("fields")).filter { it.getString("type") == field.getString("type") }.map { it.getString("id") to it.getString("title") }, enabled, "template-field-map-${field.getString("key")}", userLabel = true) { map("fieldMap", field.getString("key"), it) } }
            if (options.getJSONObject("include").getBoolean("customFields")) SharedTemplateEdits.rows(preview.getJSONArray("sourceFields")).filter { it.getString("type") in setOf("select", "multi") }.forEach { field ->
                val fieldKey = field.getString("key")
                val fieldMap = options.getJSONObject("fieldMap")
                val automatic = SharedTemplateProtocol.dictionary(preview.opt("fieldMappings")).optJSONObject(root.getString("key"))?.optString(fieldKey)
                val target = if (fieldMap.has(fieldKey)) fieldMap.optString(fieldKey).takeUnless { it == "null" } else automatic
                val destination = SharedTemplateEdits.rows(preview.getJSONArray("fields")).firstOrNull { it.getString("id") == target && it.getString("type") == field.getString("type") }
                if (destination != null) AffairsDisclosure(field.getString("title"), titleIsUserContent = true) {
                    var limit by rememberSaveable(fieldKey, destination.getString("id")) { mutableIntStateOf(5) }
                    val choices = SharedTemplateEdits.rows(field.getJSONArray("options"))
                    choices.take(limit).forEach { option ->
                        val optionKey = option.getString("id"); val mapping = options.getJSONObject("optionMap").optJSONObject(fieldKey)
                        val selected = if (mapping?.has(optionKey) != true) "@auto" else mapping.optString(optionKey).takeUnless { it == "null" } ?: "@none"
                        ImportChoice(option.getString("title"), selected, listOf("@auto" to genesisTranslate("Автоматически"), "@none" to genesisTranslate("Не переносится")) +
                            SharedTemplateEdits.rows(destination.getJSONArray("options")).filter { !it.getBoolean("archived") }.map { it.getString("id") to it.getString("title") }, enabled, "template-option-map-$fieldKey-$optionKey", userLabel = true) { choice ->
                            val next = SharedTemplateEdits.copy(requireNotNull(state.edit)); val request = next.getJSONObject("request")
                            val all = SharedTemplateProtocol.dictionary(request.opt("optionMap")); val patch = SharedTemplateProtocol.dictionary(all.opt(fieldKey))
                            if (choice == "@auto") patch.remove(optionKey) else patch.put(optionKey, choice.takeUnless { it == "@none" } ?: JSONObject.NULL)
                            all.put(fieldKey, patch); request.put("optionMap", all).put("fieldValues", JSONObject()); state.change(next)
                        }
                    }
                    if (choices.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
                }
            }
        }
        sourceMembers.forEachIndexed { index, id -> ImportChoice(genesisTranslate("Участник") + " " + number.format(index + 1), mapped("memberMap", id),
            listOf("@auto" to (members.firstOrNull { it.getString("id") == id }?.getString("title") ?: genesisTranslate("Недоступный участник")), "@none" to genesisTranslate("Не назначен")) + members.map { it.getString("id") to it.getString("title") }, enabled, "template-member-map-$index", userLabel = true) { map("memberMap", id, it) } }
    }
}

@Composable internal fun SharedTemplatePreview(state: SharedTemplateState, preferences: UiPreferences) = SharedTemplatePreview(templateApplyForm(state), preferences)

@Composable internal fun SharedTemplatePreview(state: SharedTemplateApplyForm, preferences: UiPreferences) {
    val preview = state.preview ?: return; val copy = sharedTemplateCopy(); val language = LocalGenesisLanguage.current
    val number = remember(language) { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)) }
    val projects = SharedTemplateEdits.rows(preview.getJSONArray("projects")); val tasks = SharedTemplateEdits.rows(preview.getJSONArray("tasks"))
    val context = preview.getJSONObject("calendarContext")
    val sourceMode = CalendarMode.entries.single { it.wireValue == preview.getString("calendarMode") }
    val mode = if (LocalSacredFeaturesEnabled.current) sourceMode else CalendarMode.PROFANE
    val calendar = remember(context.toString()) { GenesisCalendar(ZoneId.of(context.getString("timeZone")), context.getInt("version"), context.getString("gregorianYearStart")) }
    fun date(value: String) = runCatching { calendar.formatDate(LocalDate.parse(value), mode) }.getOrDefault(value)
    var limit by rememberSaveable { mutableIntStateOf(5) }
    Column(Modifier.fillMaxWidth().testTag("template-preview"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Предварительный результат", style = MaterialTheme.typography.titleLarge)
        UntranslatedText(genesisTranslate("Проектов: {projects}. Задач: {tasks}.").replace("{projects}", number.format(if (preview.getString("kind") == "project") projects.size else 0)).replace("{tasks}", number.format(tasks.size)), style = MaterialTheme.typography.bodyMedium)
        if (!state.previewCurrent) Text("Предпросмотр устарел. Обновите его перед применением.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        TemplateIssues(preview.getJSONArray("blockers"), copy, "Нужно исправить", "template-blockers")
        TemplateIssues(preview.getJSONArray("notices"), copy, "Изменения и пропуски", "template-notices")
        if (preview.getString("kind") == "project") AffairsDisclosure("Структура проекта") { projects.forEach { project ->
            UntranslatedText(project.getString("title"), style = MaterialTheme.typography.titleSmall)
            SharedTemplateEdits.rows(project.getJSONArray("statuses")).forEach { status -> UntranslatedText(status.getString("title"), style = MaterialTheme.typography.bodyMedium) }
        } }
        tasks.take(limit).forEach { task -> key(task.getString("key")) {
            Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                UntranslatedText(task.getString("title"), style = MaterialTheme.typography.titleMedium)
                if (!task.isNull("dueDate")) Text(date(task.getString("dueDate")), style = MaterialTheme.typography.bodyMedium)
                if (!task.isNull("startDate")) Text(date(task.getString("startDate")), style = MaterialTheme.typography.bodyMedium)
                if (state.edit?.getString("kind") == "template-apply") TemplatePreviewFields(state, preview, task, preferences)
                HorizontalDivider()
            }
        } }
        if (tasks.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-preview-more")) { Text("Показать ещё") }
    }
}

@Composable private fun TemplatePreviewFields(state: SharedTemplateApplyForm, preview: JSONObject, task: JSONObject, preferences: UiPreferences) {
    val edit = state.edit ?: return; val key = task.getString("key"); val options = edit.getJSONObject("request")
    val fields = SharedTemplateEdits.rows(preview.getJSONArray("fields")).map { JSONObject(it.toString()).put("key", it.getString("id")) } +
        SharedTemplateEdits.rows(preview.getJSONArray("newFields")).filter { it.getString("projectKey") == task.getString("projectKey") }.map { JSONObject(it.toString()).put("key", it.getString("ref")) }
    if (fields.isEmpty()) return
    val calendar = edit.optJSONObject("dateInput")?.let(SharedCustomCalendar::restore) ?: SharedCustomCalendar.initial(preferences)
    val values = SharedTemplateProtocol.dictionary(task.opt("customValues")); val overrides = SharedTemplateProtocol.dictionary(options.opt("fieldValues"))
    overrides.optJSONObject(key)?.let { patch -> patch.keys().forEach { values.put(it, patch.get(it)) } }
    val mapped = JSONObject(); fields.forEach { field -> if (values.has(field.getString("key"))) mapped.put(SharedTemplateManifest.inputId(field.getString("key")), SharedTemplateManifest.optionValue(field, values.get(field.getString("key")), true)) }
    val draft = CustomFieldDraft.fromTask(JSONObject().put("customFields", mapped))
    val errors = draft.errors(fields.map(SharedTemplateManifest::fieldAdapter))
    var limit by rememberSaveable(key) { mutableIntStateOf(5) }
    AffairsDisclosure("Значения полей") {
        fields.take(limit).forEach { field -> key(field.getString("key")) {
            val adapter = SharedTemplateManifest.fieldAdapter(field)
            SharedCustomField(adapter, draft, errors[adapter.getString("id")], false, calendar, true, !state.editable, Modifier.fillMaxWidth(),
                onValue = { _, value ->
                    val next = SharedTemplateEdits.copy(edit); val request = next.getJSONObject("request"); val all = SharedTemplateProtocol.dictionary(request.opt("fieldValues")); val patch = SharedTemplateProtocol.dictionary(all.opt(key))
                    patch.put(field.getString("key"), SharedTemplateManifest.optionValue(field, value, false)); all.put(key, patch); request.put("fieldValues", all); state.change(next)
                }, onReset = { }, onCalendar = state::changeDateInput)
        } }
        if (fields.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
    }
}
