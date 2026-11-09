package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.rotate
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.CustomFieldDraft
import ru.genesis.calendar.auth.CustomFieldProtocol
import ru.genesis.calendar.auth.SharedAutomationEditorProtocol
import ru.genesis.calendar.auth.SharedAutomationProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.text.NumberFormat
import java.util.Locale
import java.time.ZoneId

@Composable internal fun AutomationEditorBasics(state: SharedAutomationEditorState, preferences: UiPreferences) {
    val edit = state.edit ?: return; val definition = edit.getJSONObject("definition"); val trigger = definition.getJSONObject("trigger")
    val enabled = state.editable
    TemplateField("Название правила", edit.getString("title"), enabled, "automation-editor-title", maxLength = 200) { value -> state.mutate { it.put("title", value) } }
    TemplateToggle("Включить правило", edit.getBoolean("enabled"), enabled, "automation-editor-enabled") { value -> state.mutate { it.put("enabled", value) } }
    ImportChoice("Триггер", trigger.getString("type"), SharedAutomationProtocol.triggers.map { it to genesisTranslate(automationTriggerLabel(it)) }, enabled, "automation-editor-trigger") {
        state.mutate { edit -> SharedAutomationEditorEdits.trigger(edit, it) }
    }
    if (trigger.getString("type") == "dueSoon") AutomationIntegerField("За сколько дней", edit.getJSONObject("inputs").optString("trigger.leadDays", trigger.getInt("leadDays").toString()), enabled,
        "automation-editor-lead-days", 1, 366) { value -> state.mutate { it.getJSONObject("inputs").put("trigger.leadDays", value) } }
    if (trigger.has("time")) {
        Text("Время", style = MaterialTheme.typography.titleSmall)
        if (enabled) Box(Modifier.testTag("automation-editor-time")) { AuthorTimePicker(trigger.getString("time"), preferences.use24) { value -> state.mutate { it.getJSONObject("definition").getJSONObject("trigger").put("time", value) } } }
        else UntranslatedText(timeLabel(trigger.getString("time"), preferences.use24), style = MaterialTheme.typography.bodyMedium)
    }
    if (trigger.getString("type") == "schedule") {
        ImportChoice("Применять к", trigger.getString("target"), listOf("tasks" to genesisTranslate("Задачи"), "project" to genesisTranslate("Проект")), enabled, "automation-editor-target") { value ->
            state.mutate { it.getJSONObject("definition").getJSONObject("trigger").put("target", value) }
        }
        if (trigger.getString("target") == "project") {
            val incompatible = importRows(definition.getJSONArray("conditions")).any { it.getString("field") != "project" } ||
                importRows(definition.getJSONArray("actions")).any { it.getString("type") !in setOf("createTemplate", "notify") }
            Text(if (incompatible) "Для проекта по расписанию оставьте только условия проекта, создание из шаблона и уведомления. Остальные строки сохранены: измените или удалите их."
                else "Расписание проекта поддерживает создание из шаблона и уведомления.", style = MaterialTheme.typography.bodyMedium,
                color = if (incompatible) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.testTag("automation-editor-target-notice"))
        }
        AffairsDisclosure("Расписание", Modifier.testTag("automation-editor-schedule")) { AutomationEditorSchedule(state, preferences) }
    }
    AffairsDisclosure("Владелец и календарь", Modifier.testTag("automation-editor-context")) {
        ImportChoice("Владелец", edit.optString("ownerId").takeUnless { it == "null" } ?: "@none",
            listOf("@none" to genesisTranslate("Выберите владельца")) + state.members.map { it.getString("userId") to it.getString("displayName") },
            enabled && state.project?.getJSONObject("permissions")?.optBoolean("manageProjects") == true, "automation-editor-owner") { owner -> state.mutate { it.put("ownerId", owner.takeUnless { it == "@none" } ?: JSONObject.NULL) } }
        val calendar = definition.getString("calendarMode")
        ImportChoice("Календарь правила", calendar, listOf("profane" to genesisTranslate("Григорианский календарь"), "sacred" to genesisTranslate("Солнечный календарь"), "lunar" to genesisTranslate("Лунный календарь")),
            enabled && LocalSacredFeaturesEnabled.current, "automation-editor-calendar") { value -> state.mutate { it.getJSONObject("definition").put("calendarMode", value) } }
        Text("Календарь правила определяет сдвиги дат. Календарь просмотра и календарь ввода не меняют правило.", style = MaterialTheme.typography.bodySmall)
        val context = definition.getJSONObject("calendarContext")
        val zone = edit.getJSONObject("inputs").optString("calendar.timeZone", context.getString("timeZone"))
        val validZone = (zone.trim() == "UTC" || zone.trim().contains('/')) && runCatching { ZoneId.of(zone.trim()) }.isSuccess
        TemplateField("Часовой пояс", zone, enabled, "automation-editor-zone", error = if (validZone) null else genesisTranslate(automationEditorErrorText("INVALID_CALENDAR_CONTEXT"))) { value -> state.mutate { it.getJSONObject("inputs").put("calendar.timeZone", value) } }
        ImportChoice("Начало григорианского года", context.getString("gregorianYearStart"), listOf("january" to genesisTranslate("Январь"), "march" to genesisTranslate("Март")), enabled, "automation-editor-year-start") { value -> state.mutate {
            val definition = it.getJSONObject("definition"); definition.getJSONObject("calendarContext").put("gregorianYearStart", value)
            definition.getJSONObject("trigger").optJSONObject("recurrence")?.put("calendarContext", SharedAutomationEditorEdits.copy(definition.getJSONObject("calendarContext")))
        } }
        ImportChoice("Версия календаря", context.getInt("version").toString(), listOf("1" to genesisTranslate("Прежнее начало года"), "2" to genesisTranslate("Текущее начало года")), enabled, "automation-editor-version") { value -> state.mutate {
            val definition = it.getJSONObject("definition"); definition.getJSONObject("calendarContext").put("version", value.toInt())
            definition.getJSONObject("trigger").optJSONObject("recurrence")?.put("calendarContext", SharedAutomationEditorEdits.copy(definition.getJSONObject("calendarContext")))
        } }
        val input = SharedCustomCalendar.restore(edit.getJSONObject("dateInput"))
        Text("Календарь ввода", style = MaterialTheme.typography.titleSmall)
        EditorCalendarModePicker(input.mode, { value -> state.mutate { it.put("dateInput", input.copy(mode = value).saved()) } }, enabled, preferredMode = input.mode, tag = "automation-editor-input-calendar")
    }
}

@Composable internal fun AutomationEditorRows(state: SharedAutomationEditorState, actions: Boolean, preferences: UiPreferences, onTemplate: (String) -> Unit) {
    val edit = state.edit ?: return; val rows = importRows(edit.getJSONObject("definition").getJSONArray(if (actions) "actions" else "conditions"))
    val enabled = state.editable; val number = NumberFormat.getIntegerInstance(Locale.forLanguageTag(state.language))
    var limit by rememberSaveable(actions) { mutableIntStateOf(5) }
    AffairsDisclosure(if (actions) "Действия" else "Условия", Modifier.testTag(if (actions) "automation-editor-actions" else "automation-editor-conditions"), initiallyExpanded = actions) {
        if (rows.isEmpty()) Text("Без условий", style = MaterialTheme.typography.bodyMedium)
        rows.take(limit).forEachIndexed { index, row -> key(SharedAutomationEditorEdits.rowKey(edit, actions, index)) {
            val tag = "automation-editor-${if (actions) "action" else "condition"}-$index"
            Row(Modifier.fillMaxWidth().testTag(tag), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                UntranslatedText(genesisTranslate(if (actions) "Действие" else "Условие") + " " + number.format(index + 1), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
                AffairsIconButton("Выше", AffairsAction.BACK, { state.mutate { SharedAutomationEditorEdits.move(it, actions, index, index - 1) } }, Modifier.rotate(90f).testTag("$tag-up"), enabled && index > 0)
                AffairsIconButton("Ниже", AffairsAction.BACK, { state.mutate { SharedAutomationEditorEdits.move(it, actions, index, index + 1) } }, Modifier.rotate(270f).testTag("$tag-down"), enabled && index < rows.lastIndex)
                AffairsIconButton("Удалить", AffairsAction.DELETE, { state.mutate { SharedAutomationEditorEdits.remove(it, actions, index) } }, Modifier.testTag("$tag-remove"), enabled && (!actions || rows.size > 1))
            }
            if (actions) AutomationEditorAction(state, row, index, preferences, onTemplate) else AutomationEditorCondition(state, row, index)
            HorizontalDivider(Modifier.padding(top = 8.dp))
        } }
        if (rows.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().testTag("automation-editor-${if (actions) "actions" else "conditions"}-more")) { Text("Показать ещё") }
        TemplateOutlinedButton({ state.mutate { edit -> SharedAutomationEditorEdits.append(edit, actions,
            if (actions) SharedAutomationEditorEdits.action("priority", state.statuses, state.fields, state.account)
            else SharedAutomationEditorEdits.condition("project", state.projectId, state.fields.firstOrNull()?.getString("id"))) } },
            Modifier.fillMaxWidth().testTag("automation-editor-${if (actions) "action" else "condition"}-add"), enabled && rows.size < (if (actions) 10 else 20)) {
            AffairsActionIcon(AffairsAction.ADD); Spacer(Modifier.width(8.dp)); Text(if (actions) "Добавить действие" else "Добавить условие")
        }
    }
}

@Composable private fun AutomationEditorCondition(state: SharedAutomationEditorState, row: JSONObject, index: Int) {
    val field = row.getString("field"); val enabled = state.editable; val operator = row.getString("operator"); val tag = "automation-editor-condition-$index"
    val definition = if (field == "custom") state.fields.firstOrNull { it.getString("id") == row.getString("fieldId") } else null
    ImportChoice("Поле условия", field, listOf("project", "status", "label", "assignee", "priority", "custom").map { it to genesisTranslate(automationFieldLabel(it)) }, enabled, "$tag-field") { value ->
        state.mutate { SharedAutomationEditorEdits.replace(it, false, index, SharedAutomationEditorEdits.condition(value, state.projectId, state.fields.firstOrNull()?.getString("id"))) }
    }
    if (field == "custom") ImportChoice("Пользовательское поле", row.getString("fieldId"), state.fields.map { it.getString("id") to it.getString("title") }, enabled, "$tag-custom") { value -> state.mutate {
        SharedAutomationEditorEdits.replace(it, false, index, SharedAutomationEditorEdits.condition("custom", state.projectId, value))
    } }
    ImportChoice("Сравнение", operator, SharedAutomationEditorProtocol.operators(field, definition?.getString("type")).map { it to genesisTranslate(automationOperatorLabel(it)) }, enabled, "$tag-operator") { value ->
        state.mutate { edit -> val next = SharedAutomationEditorEdits.copy(row).put("operator", value)
            if (field == "custom" && definition?.getString("type") == "multi" && (operator in setOf("contains", "notContains")) != (value in setOf("contains", "notContains"))) next.put("value", JSONObject.NULL)
            SharedAutomationEditorEdits.replace(edit, false, index, next)
        }
    }
    if (operator !in setOf("missing", "present")) when (field) {
        "project" -> state.project?.let { UntranslatedText(it.getString("title"), style = MaterialTheme.typography.bodyMedium) }
        "custom" -> AutomationEditorTypedValue(state, row, false, index, definition, operator in setOf("contains", "notContains"))
        else -> AutomationEditorReference(state, row, false, index, field, "$tag-value")
    }
}

@Composable private fun AutomationEditorAction(state: SharedAutomationEditorState, row: JSONObject, index: Int, preferences: UiPreferences, onTemplate: (String) -> Unit) {
    val type = row.getString("type"); val enabled = state.editable; val tag = "automation-editor-action-$index"
    val scope = rememberCoroutineScope()
    fun update(action: (JSONObject) -> Unit) { state.mutate { action(SharedAutomationEditorEdits.row(it, true, index)) } }
    ImportChoice("Действие", type, SharedAutomationProtocol.actions.map { it to genesisTranslate(automationActionLabel(it)) }, enabled, "$tag-type") { value ->
        val changed = state.mutate { SharedAutomationEditorEdits.replace(it, true, index, SharedAutomationEditorEdits.action(value, state.statuses, state.fields, state.account)) }
        if (changed && value == "createTemplate") scope.launch { state.templateLibrary() }
    }
    when (type) {
        "status", "assignee", "priority" -> AutomationEditorReference(state, row, true, index, type, "$tag-value")
        "addLabels", "removeLabels" -> AutomationEditorMulti("Метки", state.labels.map { it.getString("id") to it.getString("title") }, row.getJSONArray("value"), enabled, "$tag-labels") { value -> update { it.put("value", value) } }
        "custom" -> {
            ImportChoice("Пользовательское поле", row.getString("fieldId"), state.fields.map { it.getString("id") to it.getString("title") }, enabled, "$tag-custom") { value -> state.mutate {
                SharedAutomationEditorEdits.replace(it, true, index, JSONObject().put("type", "custom").put("fieldId", value).put("value", JSONObject.NULL))
            } }
            AutomationEditorTypedValue(state, row, true, index, state.fields.firstOrNull { it.getString("id") == row.getString("fieldId") })
        }
        "due" -> {
            val mode = row.getString("mode")
            ImportChoice("Изменение срока", mode, listOf("set" to genesisTranslate("Установить дату"), "shift" to genesisTranslate("Сдвинуть срок"), "clear" to genesisTranslate("Очистить срок")), enabled, "$tag-due-mode") { value -> state.mutate {
                SharedAutomationEditorEdits.replace(it, true, index, JSONObject().put("type", "due").put("mode", value).apply {
                    if (value == "set") put("date", "") else if (value == "shift") put("offset", JSONObject().put("amount", 1).put("unit", "day"))
                })
            } }
            if (mode == "set") {
                val calendar = SharedCustomCalendar.restore(requireNotNull(state.edit).getJSONObject("dateInput"))
                AuthorDatePicker(row.getString("date"), if (LocalSacredFeaturesEnabled.current) calendar.mode else CalendarMode.PROFANE, calculationContext = calendar.context,
                    enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("$tag-due-date")) { value -> update { it.put("date", value) } }
            }
            if (mode == "shift") {
                val offset = row.getJSONObject("offset"); val edit = requireNotNull(state.edit); val key = SharedAutomationEditorEdits.numericKey(edit, true, index, "offset")
                val maximum = when (offset.getString("unit")) { "day" -> 74000; "month" -> 2400; else -> 200 }
                AutomationIntegerField("Сдвиг", edit.getJSONObject("inputs").optString(key, offset.getInt("amount").toString()), enabled, "$tag-offset", -maximum, maximum) { value -> state.mutate { SharedAutomationEditorEdits.number(it, true, index, value, "offset") } }
                ImportChoice("Единица сдвига", offset.getString("unit"), listOf("day" to genesisTranslate("Дни"), "month" to genesisTranslate("Месяцы"), "year" to genesisTranslate("Годы")), enabled, "$tag-offset-unit") { value -> update { it.getJSONObject("offset").put("unit", value) } }
            }
        }
        "notify" -> {
            AutomationEditorMulti("Получатели", state.members.map { it.getString("userId") to it.getString("displayName") }, row.getJSONArray("recipientIds"), enabled, "$tag-recipients") { value -> update { it.put("recipientIds", value) } }
            TemplateField("Текст уведомления", row.getString("message"), enabled, "$tag-message", lines = 3, maxLength = 1000) { value -> update { it.put("message", value) } }
            Text("Язык, каналы, частота и тихие часы берутся из настроек получателя. Ваш текст сохраняется как введён.", style = MaterialTheme.typography.bodySmall)
        }
        "createTemplate" -> {
            val templates = (importRows(state.templates?.optJSONArray("systemTemplates")) + importRows(state.templates?.optJSONArray("templates"))).filter { it.getString("kind") == "task" }
            val choices = (templates.map { it.getString("id") to it.getString("title") } + state.templateNames.toList()).distinctBy { it.first }
            val selected = row.getString("templateId")
            ImportChoice("Шаблон задачи", selected, choices + if (selected.isNotEmpty() && choices.none { it.first == selected }) listOf(selected to genesisTranslate("Недоступно")) else emptyList(),
                enabled && state.templates != null && choices.isNotEmpty(), "$tag-template") { value -> state.mutate {
                SharedAutomationEditorEdits.replace(it, true, index, JSONObject().put("type", "createTemplate").put("templateId", value).put("options", JSONObject().put("language", state.language)))
            } }
            if (state.templates != null && choices.isEmpty()) Text("Создайте шаблон задачи в разделе «Шаблоны».", style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.testTag("$tag-template-empty"))
            if (row.optBoolean("unavailable")) Text("Шаблон недоступен. Выберите другой шаблон.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TemplateIconButton("Обновить шаблоны", AffairsAction.REFRESH, enabled, Modifier.weight(1f).testTag("$tag-template-load")) { scope.launch { state.templateLibrary() } }
                TemplateIconButton("Настроить применение", AffairsAction.SETTINGS, enabled && row.getString("templateId").isNotEmpty() && !row.optBoolean("unavailable"), Modifier.weight(1f).testTag("$tag-template-configure")) {
                    onTemplate(SharedAutomationEditorEdits.rowKey(requireNotNull(state.edit), true, index))
                }
            }
            if (state.templates?.optBoolean("hasMore") == true) TemplateOutlinedButton({ scope.launch { state.templateLibrary(true) } }, Modifier.fillMaxWidth(), enabled) { Text("Показать ещё") }
        }
    }
}

@Composable internal fun AutomationIntegerField(label: String, value: String, enabled: Boolean, tag: String,
    minimum: Int, maximum: Int, onChange: (String) -> Unit) {
    val number = NumberFormat.getIntegerInstance(Locale.forLanguageTag(LocalGenesisLanguage.current))
    val valid = value.trim().toIntOrNull()?.let { it in minimum..maximum } == true
    val error = if (valid) null else genesisTranslate("Целое число: от {min} до {max}.").replace("{min}", number.format(minimum)).replace("{max}", number.format(maximum))
    TemplateField(label, value, enabled, tag, number = true, maxLength = 20, error = error, onChange = onChange)
}

@Composable private fun AutomationEditorReference(state: SharedAutomationEditorState, row: JSONObject, actions: Boolean, index: Int, field: String, tag: String) {
    val choices = when (field) {
        "status" -> listOf("@unset" to genesisTranslate("Выберите статус")) + state.statuses.map { it.getString("id") to it.getString("title") }
        "assignee" -> listOf("@unset" to genesisTranslate("Не назначен")) + state.members.map { it.getString("userId") to it.getString("displayName") }
        "label" -> listOf("@unset" to genesisTranslate("Выберите значение")) + state.labels.map { it.getString("id") to it.getString("title") }
        else -> (0..3).map { it.toString() to genesisTranslate(listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет")[it]) }
    }
    val selected = row.opt("value").takeUnless { it == JSONObject.NULL }?.toString() ?: "@unset"
    ImportChoice(automationFieldLabel(field), selected, choices + if (choices.none { it.first == selected }) listOf(selected to genesisTranslate("Недоступно")) else emptyList(), state.editable, tag) { value -> state.mutate {
        SharedAutomationEditorEdits.row(it, actions, index).put("value", if (field == "priority") value.toInt() else value.takeUnless { it == "@unset" } ?: JSONObject.NULL)
        it.getJSONObject("inputs").remove(SharedAutomationEditorEdits.numericKey(it, actions, index))
    } }
}

@Composable private fun AutomationEditorTypedValue(state: SharedAutomationEditorState, row: JSONObject, actions: Boolean, index: Int, definition: JSONObject?, contains: Boolean = false) {
    if (definition == null) { Text("Поле больше недоступно. Обновите данные; черновик сохранён.", color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium); return }
    val field = SharedAutomationEditorEdits.copy(definition).put("required", false).apply { if (contains && getString("type") == "multi") put("type", "select") }
    val edit = requireNotNull(state.edit); val id = field.getString("id"); val key = SharedAutomationEditorEdits.numericKey(edit, actions, index)
    val number = field.getString("type") == "number"
    val value = if (number && edit.getJSONObject("inputs").has(key)) edit.getJSONObject("inputs").getString(key) else row.get("value")
    val draft = CustomFieldDraft.fromTask(JSONObject().put("customFields", JSONObject().put(id, value)))
    val error = runCatching { CustomFieldProtocol.normalize(field, value, null) }.exceptionOrNull()?.message
    val calendar = SharedCustomCalendar.restore(edit.getJSONObject("dateInput"))
    SharedCustomField(field, draft, error, false, calendar, true, !state.editable, Modifier.fillMaxWidth(), onValue = { _, value -> state.mutate {
        if (number && value != null && value != JSONObject.NULL) SharedAutomationEditorEdits.number(it, actions, index, value.toString())
        else { SharedAutomationEditorEdits.row(it, actions, index).put("value", value ?: JSONObject.NULL); it.getJSONObject("inputs").remove(key) }
    } }, onReset = {}, onCalendar = { calendar -> state.mutate { it.put("dateInput", calendar.saved()) } })
}

@Composable internal fun AutomationEditorMulti(label: String, choices: List<Pair<String, String>>, selected: JSONArray, enabled: Boolean, tag: String, onChange: (JSONArray) -> Unit) {
    var limit by rememberSaveable(tag) { mutableIntStateOf(5) }; val ids = (0 until selected.length()).map(selected::getString)
    AffairsDisclosure(label, Modifier.testTag(tag)) {
        if (ids.any { id -> choices.none { it.first == id } }) Text("Не все выбранные значения доступны. Обновите данные или очистите выбор.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        choices.take(limit).forEach { (id, title) -> Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("$tag-$id")
            .toggleable(id in ids, enabled, Role.Checkbox) { value -> onChange(JSONArray(ids.filterNot { it == id } + if (value) listOf(id) else emptyList())) }
            .semantics(mergeDescendants = true) { contentDescription = title }, verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Checkbox(id in ids, null, enabled = enabled, modifier = Modifier.clearAndSetSemantics { })
            UntranslatedText(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        } }
        if (choices.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth()) { Text("Показать ещё") }
        if (ids.isNotEmpty()) TemplateOutlinedButton({ onChange(JSONArray()) }, Modifier.fillMaxWidth().testTag("$tag-clear"), enabled) { Text("Очистить") }
    }
}
