package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.clearAndSetSemantics
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.data.UiPreferences
import java.util.UUID

internal fun templateStrings(value: JSONArray) = (0 until value.length()).map(value::getString)
internal fun templateMemberId(value: JSONObject) = value.optString("userId").ifBlank { value.optString("id") }
internal fun templateMemberTitle(value: JSONObject) = value.optString("displayName").ifBlank { value.optString("name") }.ifBlank { value.optString("title") }.ifBlank { value.optString("email") }

@Composable internal fun TemplateMember(label: String, value: String?, members: List<JSONObject>, enabled: Boolean, tag: String, onChange: (String?) -> Unit) {
    val choices = listOf("@none" to genesisTranslate("Не задано")) + members.map { templateMemberId(it) to templateMemberTitle(it) } +
        if (value != null && members.none { templateMemberId(it) == value }) listOf(value to genesisTranslate("Недоступный участник")) else emptyList()
    ImportChoice(label, value ?: "@none", choices, enabled, tag) { onChange(it.takeUnless { it == "@none" }) }
}

@Composable internal fun TemplateChecks(label: String, selected: List<String>, choices: List<Pair<String, String>>, enabled: Boolean, tag: String,
    maxSelected: Int = 200, onChange: (List<String>) -> Unit) {
    var limit by rememberSaveable(tag) { mutableIntStateOf(5) }
    AffairsDisclosure(label, Modifier.testTag(tag)) {
        choices.take(limit).forEach { (id, title) -> Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("$tag-choice-$id")
            .toggleable(id in selected, enabled = enabled && (id in selected || selected.size < maxSelected), role = Role.Checkbox,
                onValueChange = { checked -> onChange((selected.filterNot { it == id } + if (checked) listOf(id) else emptyList()).distinct()) })
            .semantics(mergeDescendants = true) { contentDescription = title }, verticalAlignment = Alignment.CenterVertically) {
            Checkbox(id in selected, null, enabled = enabled && (id in selected || selected.size < maxSelected), modifier = Modifier.clearAndSetSemantics { })
            UntranslatedText(title, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        } }
        if (choices.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("$tag-more")) { Text("Показать ещё") }
        if (maxSelected == 50 && selected.size >= maxSelected) Text("Выбрано 50 зависимостей. Уберите одну, чтобы выбрать другую.", Modifier.testTag("template-dependency-limit"), style = MaterialTheme.typography.bodySmall)
    }
}

@Composable internal fun TemplateRelativeDate(label: String, value: JSONObject?, input: String?, enabled: Boolean, tag: String,
    onValue: (JSONObject?) -> Unit, onInput: (String) -> Unit) {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        TemplateToggle(label, value != null, enabled, "$tag-enabled") { onValue(if (it) JSONObject().put("amount", 0).put("unit", "day") else null) }
        if (value != null) {
            Text("От базовой даты", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            val amount = input?.toIntOrNull() ?: value.getInt("amount")
            val limit = when (value.getString("unit")) { "day" -> 74000; "month" -> 2400; else -> 200 }
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                TemplateIconButton("Уменьшить", AffairsAction.DECREASE, enabled && amount > -limit, Modifier.width(48.dp)) { onInput((amount.coerceIn(-limit, limit) - 1).coerceAtLeast(-limit).toString()) }
                Box(Modifier.weight(1f)) { TemplateField("Сдвиг", input ?: value.getInt("amount").toString(), enabled, "$tag-amount", number = true, maxLength = 200, onChange = onInput) }
                TemplateIconButton("Увеличить", AffairsAction.ADD, enabled && amount < limit, Modifier.width(48.dp)) { onInput((amount.coerceIn(-limit, limit) + 1).coerceAtMost(limit).toString()) }
            }
            ImportChoice("Единица", value.getString("unit"), listOf("day" to genesisTranslate("Дни"), "month" to genesisTranslate("Месяцы"), "year" to genesisTranslate("Годы")), enabled, "$tag-unit") {
                onValue(JSONObject(value.toString()).put("unit", it))
            }
        }
    }
}

@Composable internal fun SharedTemplateTaskEditor(state: SharedTemplateState, preferences: UiPreferences, members: List<JSONObject>) {
    val edit = state.edit ?: return; val manifest = edit.getJSONObject("request").optJSONObject("manifest") ?: return
    val projects = SharedTemplateEdits.rows(manifest.getJSONArray("projects")); val all = SharedTemplateEdits.rows(manifest.getJSONArray("tasks"))
    var chosen by rememberSaveable { mutableStateOf("") }; var destination by rememberSaveable { mutableStateOf("") }; var remove by remember { mutableStateOf(false) }
    val task = all.firstOrNull { it.getString("key") == chosen } ?: all.firstOrNull()
    val enabled = state.editable
    Column(Modifier.fillMaxWidth().testTag("template-task-editor"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Задачи", style = MaterialTheme.typography.titleLarge)
        if (task != null) ImportChoice("Задача шаблона", task.getString("key"), all.map { it.getString("key") to it.getString("title").ifBlank { genesisTranslate("Без названия") } }, !state.busy, "template-task-choice") { chosen = it }
        val target = projects.firstOrNull { it.getString("key") == destination } ?: projects.firstOrNull { it.getString("key") == task?.getString("projectKey") } ?: projects.first()
        val targetOpen = SharedTemplateEdits.rows(target.getJSONArray("statuses")).any { !it.getBoolean("isDone") }
        val taskOpen = projects.firstOrNull { it.getString("key") == task?.getString("projectKey") }?.let { project -> SharedTemplateEdits.rows(project.getJSONArray("statuses")).any { !it.getBoolean("isDone") } } == true
        if (projects.size > 1) ImportChoice("Проект для новых задач", target.getString("key"), projects.map { it.getString("key") to it.getString("title").ifBlank { genesisTranslate("Без названия") } }, enabled, "template-task-destination") { destination = it }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            TemplateIconButton("Добавить задачу", AffairsAction.ADD, enabled && targetOpen && all.size < 500, Modifier.weight(1f).testTag("template-task-add")) {
                val project = target.getString("key")
                val parent = if (manifest.getString("kind") == "task") all.firstOrNull { it.isNull("parentKey") }?.getString("key") else null
                state.addTask(project, parent)?.let { chosen = it }
            }
            if (task != null) TemplateIconButton("Добавить подзадачу", AffairsAction.SUBTASK, enabled && taskOpen && all.size < 500, Modifier.weight(1f).testTag("template-subtask-add")) {
                state.addTask(task.getString("projectKey"), task.getString("key"))?.let { chosen = it }
            }
            if (task != null) TemplateIconButton("Удалить задачу", AffairsAction.DELETE, enabled, Modifier.weight(1f).testTag("template-task-remove")) { remove = true }
        }
        if (!targetOpen || task != null && !taskOpen) Text("Для новых задач нужен незавершённый статус. Откройте «Статусы» в структуре проекта.", Modifier.testTag("template-open-status-needed"), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.error)
        if (task == null) Text("Добавить задачу", style = MaterialTheme.typography.bodyMedium)
        if (task != null) key(task.getString("key")) {
            val id = task.getString("key"); val project = projects.single { it.getString("key") == task.getString("projectKey") }
            fun change(action: (JSONObject) -> Unit) = state.proposeManifest { SharedTemplateEdits.update(manifest, "tasks", id, action) }
            TemplateField("Название", task.getString("title"), enabled, "template-task-title") { value -> change { it.put("title", value) } }
            TemplateField("Описание задачи", task.getString("description"), enabled, "template-task-description", lines = 2) { value -> change { it.put("description", value) } }
            ImportChoice("Тип записи", task.getString("entryType"), listOf("task" to templateLocalizedLabel("Задача (тип записи)"), "meeting" to templateLocalizedLabel("Встреча (тип записи)"), "event" to templateLocalizedLabel("Событие (тип записи)")), enabled, "template-task-type") { value -> change { it.put("entryType", value) } }
            val descendants = SharedTemplateEdits.descendants(manifest, "tasks", id)
            val parents = all.filter { it.getString("projectKey") == task.getString("projectKey") && it.getString("key") !in descendants }
            ImportChoice("Родительская задача", task.optString("parentKey").takeUnless { it == "null" }.orEmpty().ifBlank { "@none" },
                (if (manifest.getString("kind") != "task" || task.isNull("parentKey")) listOf("@none" to genesisTranslate("Без родителя")) else emptyList()) + parents.map { it.getString("key") to it.getString("title").ifBlank { genesisTranslate("Без названия") } }, enabled, "template-task-parent") {
                state.mutateManifest { raw -> SharedTemplateEdits.reparentTask(raw, id, it.takeUnless { key -> key == "@none" }) }
            }
            ImportChoice("Статус", task.getString("statusKey"), SharedTemplateEdits.rows(project.getJSONArray("statuses")).map { it.getString("key") to it.getString("title") }, enabled, "template-task-status") { value -> change { it.put("statusKey", value) } }
            ImportChoice("Приоритет", task.getInt("priority").toString(), listOf("0" to genesisTranslate("Без приоритета"), "1" to genesisTranslate("Низкий"), "2" to genesisTranslate("Средний"), "3" to genesisTranslate("Высокий")), enabled, "template-task-priority") { value -> change { it.put("priority", value.toInt()) } }
            AffairsDisclosure("Оценка") {
                for ((field, label) in listOf("storyPoints" to "Оценка в баллах", "estimateHours" to "Оценка в часах")) {
                    val input = edit.getJSONObject("inputs").optString("estimate/$id/$field").takeIf { edit.getJSONObject("inputs").has("estimate/$id/$field") }
                    TemplateField(label, input ?: task.opt(field).takeUnless { it == JSONObject.NULL }?.toString().orEmpty(), enabled, "template-task-$field", number = true, maxLength = 200) { state.changeEstimate(id, field, it) }
                }
            }
            AffairsDisclosure("Сроки") {
                Text("Месяцы и годы считаются по календарю шаблона. Проверяйте итоговые даты в предпросмотре.", style = MaterialTheme.typography.bodySmall)
                for ((field, label) in listOf("start" to "Начало", "due" to "Окончание")) {
                    val path = "offset/$id/$field/amount"
                    TemplateRelativeDate(label, task.optJSONObject(field), edit.getJSONObject("inputs").optString(path).takeIf { edit.getJSONObject("inputs").has(path) }, enabled, "template-task-$field",
                        onValue = { value -> change { it.put(field, value ?: JSONObject.NULL) } }, onInput = { state.changeInput(path, it) })
                }
                TemplateToggle("Время", !task.isNull("startTime"), enabled, "template-task-time") { on -> change { it.put("startTime", if (on) "09:00" else JSONObject.NULL).put("endTime", if (on) "10:00" else JSONObject.NULL) } }
                if (!task.isNull("startTime")) for ((field, label) in listOf("startTime" to "Время начала", "endTime" to "Время окончания")) {
                    Text(label, style = MaterialTheme.typography.titleSmall)
                    if (enabled) AuthorTimePicker(task.getString(field), preferences.use24) { value -> change { it.put(field, value) } }
                    else UntranslatedText(timeLabel(task.getString(field), preferences.use24), style = MaterialTheme.typography.bodyMedium)
                }
            }
            AffairsDisclosure("Связи и исполнители") {
                TemplateMember("Исполнитель", task.opt("assigneeId").takeUnless { it == JSONObject.NULL } as? String, members, enabled, "template-task-assignee") { value -> change { it.put("assigneeId", value ?: JSONObject.NULL) } }
                TemplateToggle("Требуется подтверждение", task.getBoolean("approvalRequired"), enabled, "template-task-approval") { on -> change { it.put("approvalRequired", on); if (!on) it.put("approverIds", JSONArray()) } }
                if (task.getBoolean("approvalRequired")) {
                    val selected = templateStrings(task.getJSONArray("approverIds"))
                    TemplateChecks("Участники для подтверждения", selected, members.map { templateMemberId(it) to templateMemberTitle(it) } + selected.filter { key -> members.none { templateMemberId(it) == key } }.map { it to genesisTranslate("Недоступный участник") }, enabled, "template-task-approvers") { value -> change { it.put("approverIds", JSONArray(value)) } }
                }
                TemplateChecks("Зависимости", templateStrings(task.getJSONArray("dependsOnKeys")), all.filter { it.getString("key") != id && it.getString("projectKey") == task.getString("projectKey") }.map { it.getString("key") to it.getString("title").ifBlank { genesisTranslate("Без названия") } }, enabled, "template-task-dependencies", maxSelected = 50) { value -> change { it.put("dependsOnKeys", JSONArray(value)) } }
            }
            AffairsDisclosure("Метки и категории") {
                ImportChoice("Категория", task.optString("categoryKey").takeUnless { it == "null" }.orEmpty().ifBlank { "@none" }, listOf("@none" to genesisTranslate("Не задано")) + SharedTemplateEdits.rows(project.getJSONArray("categories")).map { it.getString("key") to it.getString("title") }, enabled, "template-task-category") { value -> change { it.put("categoryKey", value.takeUnless { it == "@none" } ?: JSONObject.NULL) } }
                TemplateChecks("Метки", templateStrings(task.getJSONArray("labelKeys")), SharedTemplateEdits.rows(manifest.getJSONArray("labels")).map { it.getString("key") to it.getString("title") }, enabled, "template-task-labels") { value -> change { it.put("labelKeys", JSONArray(value)) } }
            }
            TemplateTags(state, manifest, task, "tasks")
            val calendar = edit.optJSONObject("dateInput")?.let(SharedCustomCalendar::restore) ?: SharedCustomCalendar.initial(preferences)
            TemplateCustomValues(manifest, task, calendar, enabled, state::changeDateInput) { value -> change { it.put("customValues", value) } }
            TemplateTaskChecklists(state, manifest, task, members)
        }
    }
    if (remove && task != null) AlertDialog(onDismissRequest = { remove = false }, title = { Text("Удалить задачу") },
        text = { Text("Удалить эту ветку из шаблона?") }, confirmButton = { TextButton({ if (state.proposeManifest { SharedTemplateEdits.removeTasks(manifest, SharedTemplateEdits.descendants(manifest, "tasks", task.getString("key"))) }) { chosen = ""; remove = false } }) { Text("Удалить") } },
        dismissButton = { TextButton({ remove = false }) { Text("Отмена") } })
}

@Composable internal fun TemplateTags(state: SharedTemplateState, manifest: JSONObject, task: JSONObject, collection: String) {
    val id = task.getString("key"); val path = "${if (collection == "projects") "tagProject" else "tag"}/$id/pending"; val tags = templateStrings(task.getJSONArray("tags"))
    val pending = state.edit?.getJSONObject("inputs")?.optString(path).orEmpty()
    AffairsDisclosure("Текстовые теги") {
        tags.forEach { tag -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            UntranslatedText(tag, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            AffairsIconButton("Убрать", AffairsAction.CLOSE, { state.proposeManifest { SharedTemplateEdits.update(manifest, collection, id) { it.put("tags", JSONArray(tags.filterNot { value -> value == tag })) } } }, enabled = state.editable)
        } }
        TemplateField("Тег", pending, state.editable && tags.size < 30, "template-tag-input", maxLength = 80) { state.changeInput(path, it) }
        TemplateOutlinedButton({ if (state.proposeManifest { SharedTemplateEdits.update(manifest, collection, id) { it.put("tags", JSONArray((tags + pending.trim()).distinct())) } }) state.clearInput(path) },
            enabled = state.editable && pending.isNotBlank() && tags.size < 30, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Добавить") }
    }
}

@Composable private fun TemplateTaskChecklists(state: SharedTemplateState, manifest: JSONObject, task: JSONObject, members: List<JSONObject>) {
    val id = task.getString("key"); val lists = SharedTemplateEdits.rows(task.getJSONArray("checklists")); val enabled = state.editable
    fun change(action: (JSONObject) -> Unit) = state.proposeManifest { SharedTemplateEdits.update(manifest, "tasks", id, action) }
    AffairsDisclosure("Чек-листы") {
        lists.forEach { list -> key(list.getString("key")) {
            val listId = list.getString("key")
            fun changeList(action: (JSONObject) -> Unit) = change { value -> action(SharedTemplateEdits.rows(value.getJSONArray("checklists")).single { it.getString("key") == listId }) }
            AffairsDisclosure(list.getString("title").ifBlank { genesisTranslate("Чек-лист") }, titleIsUserContent = true) {
                TemplateField("Название", list.getString("title"), enabled, "template-checklist-title") { value -> changeList { it.put("title", value) } }
                var limit by rememberSaveable { mutableIntStateOf(5) }
                val items = SharedTemplateEdits.rows(list.getJSONArray("items")); val itemCount = lists.sumOf { it.getJSONArray("items").length() }
                items.take(limit).forEach { item -> key(item.getString("key")) {
                    val itemId = item.getString("key"); val path = "checklistOffset/$id/$listId/$itemId/amount"
                    fun changeItem(action: (JSONObject) -> Unit) = changeList { value -> action(SharedTemplateEdits.rows(value.getJSONArray("items")).single { it.getString("key") == itemId }) }
                    TemplateField("Пункт чек-листа", item.getString("title"), enabled, "template-item-title", maxLength = 500) { value -> changeItem { it.put("title", value) } }
                    TemplateMember("Исполнитель", item.opt("assigneeId").takeUnless { it == JSONObject.NULL } as? String, members, enabled, "template-item-assignee") { value -> changeItem { it.put("assigneeId", value ?: JSONObject.NULL) } }
                    ImportChoice("Связанная задача", item.optString("linkedTaskKey").takeUnless { it == "null" }.orEmpty().ifBlank { "@none" }, listOf("@none" to genesisTranslate("Не задано")) + SharedTemplateEdits.rows(manifest.getJSONArray("tasks")).filter { it.getString("projectKey") == task.getString("projectKey") && it.getString("key") != id }.map { it.getString("key") to it.getString("title") }, enabled, "template-item-link") { value -> changeItem { it.put("linkedTaskKey", value.takeUnless { it == "@none" } ?: JSONObject.NULL) } }
                    TemplateRelativeDate("Окончание", item.optJSONObject("due"), state.edit?.getJSONObject("inputs")?.optString(path)?.takeIf { state.edit?.getJSONObject("inputs")?.has(path) == true }, enabled, "template-item-due",
                        onValue = { value -> changeItem { it.put("due", value ?: JSONObject.NULL) } }, onInput = { state.changeInput(path, it) })
                    AffairsIconButton("Убрать", AffairsAction.DELETE, { changeList { it.put("items", JSONArray(items.filterNot { row -> row.getString("key") == itemId })) } }, enabled = enabled)
                    HorizontalDivider()
                } }
                if (items.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
                TemplateOutlinedButton({ changeList { it.getJSONArray("items").put(JSONObject().put("key", UUID.randomUUID().toString()).put("title", "").put("assigneeId", JSONObject.NULL).put("due", JSONObject.NULL).put("linkedTaskKey", JSONObject.NULL)) } },
                    enabled = enabled && itemCount < 300, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Новый пункт") }
                TemplateOutlinedButton({ change { it.put("checklists", JSONArray(lists.filterNot { row -> row.getString("key") == listId })) } }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Убрать") }
            }
        } }
        TemplateOutlinedButton({ change { it.getJSONArray("checklists").put(JSONObject().put("key", UUID.randomUUID().toString()).put("title", "").put("items", JSONArray())) } },
            enabled = enabled && lists.size < 20, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Добавить чек-лист") }
    }
}
