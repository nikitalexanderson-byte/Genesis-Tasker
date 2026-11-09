package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.ProjectAccessProtocol
import java.text.NumberFormat
import java.util.Locale

@Composable internal fun AccessHeading(label: String) = Text(label, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleMedium)

@Composable internal fun ProjectAccessFields(state: ProjectAccessEditorState) {
    val edit = state.edit ?: return; val data = state.data ?: return; val draft = edit.getJSONObject("draft")
    val language = LocalGenesisLanguage.current; val number = remember(language) { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)) }
    var query by rememberSaveable { mutableStateOf("") }; var limit by rememberSaveable(query) { mutableIntStateOf(5) }
    val projects = importRows(data.getJSONArray("projects")); val catalog = projects.associateBy { it.getString("id") }
    val rules = importRows(draft.getJSONArray("grants")); val missing = rules.filter { it.getString("projectId") !in catalog }
    fun change(change: (JSONObject) -> Unit) { val value = JSONObject(edit.toString()); change(value.getJSONObject("draft")); state.change(value) }
    fun rule(project: String, role: String, descendants: Boolean = rules.find { it.getString("projectId") == project }?.getBoolean("includeDescendants") ?: false) = change { value ->
        value.put("grants", JSONArray(rules.filterNot { it.getString("projectId") == project } + if (role == "inherit") emptyList() else listOf(
            JSONObject().put("projectId", project).put("role", role).put("includeDescendants", descendants))))
    }
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Все проекты пространства, включая будущие", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Switch(draft.getBoolean("allProjects"), { value -> change { it.put("allProjects", value) } }, enabled = state.editable, modifier = Modifier.testTag("access-all-projects"))
    }
    AffairsDisclosure("Описание", Modifier.testTag("access-help")) {
        Text("Выберите проекты и права участника. Правило для подпроектов применяется только при явном включении наследования.", style = MaterialTheme.typography.bodyMedium)
        Text("Без отдельного правила действует ближайшее включённое правило родителя. Если его нет, доступа нет. «Нет доступа» создаёт явное исключение.", style = MaterialTheme.typography.bodyMedium)
        Text("Проектные ограничения имеют приоритет над правами категории. Уже скачанные участником файлы удалить с его устройства невозможно.", style = MaterialTheme.typography.bodyMedium)
    }
    if (draft.getBoolean("allProjects")) return
    if (missing.isNotEmpty()) {
        Text("Некоторые выбранные проекты больше недоступны. Уберите их правила перед предпросмотром.", color = MaterialTheme.colorScheme.error)
        OutlinedButton({ change { it.put("grants", JSONArray(rules.filter { row -> row.getString("projectId") in catalog })) } }, enabled = state.editable,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("access-remove-missing")) { Text("Убрать недоступные правила") }
    }
    OutlinedTextField(query, { query = it.take(1000) }, label = { Text("Найти проект") }, trailingIcon = { AffairsActionIcon(AffairsAction.SEARCH) }, singleLine = true,
        modifier = Modifier.fillMaxWidth().testTag("access-search"), textStyle = MaterialTheme.typography.bodyMedium)
    val filtered = projects.filter { it.getString("title").lowercase(Locale.forLanguageTag(language)).contains(query.trim().lowercase(Locale.forLanguageTag(language))) }
    val choices = listOf("inherit" to "Без отдельного правила", "member" to "Редактирование", "commenter" to "Комментарии", "viewer" to "Просмотр", "none" to "Нет доступа")
        .map { it.first to genesisTranslate(it.second) }
    filtered.take(limit).forEach { project -> key(project.getString("id")) {
        val id = project.getString("id"); val selected = rules.find { it.getString("projectId") == id }
        Column(Modifier.fillMaxWidth().testTag("access-rule-$id"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            UntranslatedText(project.getString("title"), style = MaterialTheme.typography.titleSmall)
            catalog[project.optString("parentId")]?.let { UntranslatedText(it.getString("title"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
            if (project.optInt("inTrash") == 1) Text("Корзина", style = MaterialTheme.typography.bodySmall)
            else if (!project.isNull("archivedAt")) Text("Архив", style = MaterialTheme.typography.bodySmall)
            ImportChoice("Правило доступа", selected?.getString("role") ?: "inherit", choices, state.editable, "access-role-$id") { role -> rule(id, role) }
            if (selected != null) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Checkbox(selected.getBoolean("includeDescendants"), { value -> rule(id, selected.getString("role"), value) }, enabled = state.editable,
                    modifier = Modifier.testTag("access-descendants-$id"))
                Text("Включая существующие и будущие подпроекты", Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    } }
    if (filtered.isEmpty()) Text("Проекты не найдены.") else UntranslatedText(genesisTranslate("Показано {shown} из {total}")
        .replace("{shown}", number.format(minOf(limit, filtered.size))).replace("{total}", number.format(filtered.size)), Modifier.testTag("access-project-count"), style = MaterialTheme.typography.bodySmall)
    if (limit < filtered.size) OutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("access-more-projects")) { Text("Показать ещё") }
}

@Composable internal fun ProjectAccessPreview(state: ProjectAccessEditorState, edit: () -> Unit) {
    val preview = state.preview ?: return
    val language = LocalGenesisLanguage.current; val number = remember(language) { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)) }
    val changes = importRows(preview.getJSONArray("changes")); val projects = importRows(preview.getJSONArray("projects")).associateBy { it.getString("id") }
    var limit by remember(preview) { mutableIntStateOf(5) }
    @Composable fun permissions(value: JSONObject): String {
        if (!value.getBoolean("read")) return genesisTranslate("Нет доступа")
        return (listOf("Просмотр") + ProjectAccessProtocol.permissionKeys.filter { value.getBoolean(it) }.map { key -> when (key) {
            "editTasks" -> "Редактирование"; "comment" -> "Комментарии"; "organizeTasks" -> "Организация задач"
            "createProjects" -> "Создание проектов"; "manageProjects" -> "Управление проектами"; else -> "Приглашение участников"
        } }).map { genesisTranslate(it) }.joinToString(" · ")
    }
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) { AccessHeading("Предпросмотр изменений") }
        AffairsIconButton("Редактировать", AffairsAction.EDIT, edit, Modifier.testTag("access-edit-rules"), !state.busy)
    }
    importRows(preview.getJSONArray("blockers")).forEach { blocker ->
        Text("Сначала передайте владение проектом другому участнику.", Modifier.testTag("access-last-owner"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
        projects[blocker.getString("projectId")]?.let { UntranslatedText(it.getString("title"), style = MaterialTheme.typography.titleSmall) }
    }
    UntranslatedText(genesisTranslate("Проектов с изменениями: {count}").replace("{count}", number.format(changes.size)), Modifier.testTag("access-change-count"), style = MaterialTheme.typography.titleSmall)
    val assignments = changes.sumOf { it.getLong("clearedAssignments") }
    if (assignments > 0) UntranslatedText(genesisTranslate("Будут сняты назначения: {count}").replace("{count}", number.format(assignments)), Modifier.testTag("access-assignment-count"), style = MaterialTheme.typography.bodyMedium)
    AffairsDisclosure("Правило доступа", Modifier.testTag("access-preview-policy")) {
        val desired = preview.getJSONObject("desired")
        if (desired.getBoolean("allProjects")) Text("Все проекты пространства, включая будущие", style = MaterialTheme.typography.bodyMedium)
        else {
            Text("Без отдельного правила действует ближайшее включённое правило родителя. Если его нет, доступа нет. «Нет доступа» создаёт явное исключение.", style = MaterialTheme.typography.bodyMedium)
            val rules = importRows(desired.getJSONArray("grants")); var shown by remember(preview) { mutableIntStateOf(5) }
            rules.take(shown).forEach { rule ->
                projects[rule.getString("projectId")]?.let { UntranslatedText(it.getString("title"), style = MaterialTheme.typography.titleSmall) }
                Text(when (rule.getString("role")) { "member" -> "Редактирование"; "commenter" -> "Комментарии"; "viewer" -> "Просмотр"; else -> "Нет доступа" }, style = MaterialTheme.typography.bodyMedium)
                if (rule.getBoolean("includeDescendants")) Text("Включая существующие и будущие подпроекты", style = MaterialTheme.typography.bodySmall)
            }
            if (rules.size > shown) OutlinedButton({ shown += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
        }
    }
    if (changes.isEmpty()) Text("Текущие права проектов не изменятся.")
    changes.take(limit).forEach { row -> key(row.getString("projectId")) {
        Column(Modifier.fillMaxWidth().testTag("access-change-${row.getString("projectId")}"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            UntranslatedText(row.getString("title"), style = MaterialTheme.typography.titleSmall)
            UntranslatedText(permissions(row.getJSONObject("beforePermissions")) + " → " + permissions(row.getJSONObject("afterPermissions")), style = MaterialTheme.typography.bodyMedium)
            HorizontalDivider(color = MaterialTheme.colorScheme.outlineVariant)
        }
    } }
    if (changes.size > limit) OutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("access-more-changes")) { Text("Показать ещё") }
}
