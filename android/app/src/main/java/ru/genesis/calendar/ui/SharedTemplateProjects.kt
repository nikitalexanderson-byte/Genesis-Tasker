package ru.genesis.calendar.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedTemplateManifest
import ru.genesis.calendar.domain.CalendarMode
import java.util.UUID

@Composable internal fun TemplateColor(value: String, enabled: Boolean, onChange: (String) -> Unit) {
    val palette = listOf("#2d6c68" to "Зелёный", "#946f35" to "Золотой", "#476784" to "Синий", "#a15c62" to "Красный", "#7c628d" to "Фиолетовый", "#6a7471" to "Серый")
    val colors = palette + if (palette.none { it.first.equals(value, true) }) listOf(value to "Текущий цвет") else emptyList()
    FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        colors.forEach { (hex, label) -> FilterChip(value.equals(hex, true), { onChange(hex) }, enabled = enabled,
            modifier = Modifier.heightIn(min = 48.dp), label = { Text(label) }, leadingIcon = {
                Canvas(Modifier.size(14.dp)) { drawCircle(Color(android.graphics.Color.parseColor(hex))) }
            }) }
    }
}

@Composable internal fun SharedTemplateProjectEditor(state: SharedTemplateState, openTitle: String, doneTitle: String) {
    val manifest = state.edit?.getJSONObject("request")?.optJSONObject("manifest") ?: return
    val projects = SharedTemplateEdits.rows(manifest.getJSONArray("projects")); val enabled = state.editable
    var chosen by rememberSaveable { mutableStateOf("") }; var remove by remember { mutableStateOf(false) }
    val project = projects.firstOrNull { it.getString("key") == chosen } ?: projects.first(); val id = project.getString("key")
    fun change(action: (JSONObject) -> Unit) = state.proposeManifest { SharedTemplateEdits.update(manifest, "projects", id, action) }
    Column(Modifier.fillMaxWidth().testTag("template-project-editor"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text("Структура проекта", style = MaterialTheme.typography.titleLarge)
        ImportChoice("Проект шаблона", id, projects.map { it.getString("key") to it.getString("title").ifBlank { genesisTranslate("Без названия") } }, !state.busy, "template-project-choice") { chosen = it }
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            if (manifest.getString("kind") == "project") TemplateIconButton("Добавить подпроект", AffairsAction.ADD, enabled && projects.size < 50, Modifier.weight(1f).testTag("template-project-add")) {
                val child = UUID.randomUUID().toString()
                if (state.proposeManifest { SharedTemplateEdits.copy(manifest).apply {
                    getJSONArray("projects").put(SharedTemplateManifest.newProject(child, "", openTitle, doneTitle, parent = id))
                } }) chosen = child
            }
            if (projects.first().getString("key") != id) TemplateIconButton("Удалить подпроект", AffairsAction.DELETE, enabled, Modifier.weight(1f).testTag("template-project-remove")) { remove = true }
        }
        TemplateField("Название", project.getString("title"), enabled, "template-project-title") { value -> change { it.put("title", value) } }
        TemplateField("Описание проекта", project.getString("description"), enabled, "template-project-description", lines = 2, maxLength = 5000) { value -> change { it.put("description", value) } }
        ImportChoice("Вид", project.getString("layout"), listOf("list" to genesisTranslate("Список"), "board" to genesisTranslate("Доска")), enabled, "template-project-layout") { value -> change { it.put("layout", value) } }
        ImportChoice("Тип", project.getString("kind"), listOf("project" to genesisTranslate("Проект"), "task-list" to genesisTranslate("Список задач")), enabled, "template-project-kind") { value -> change { it.put("kind", value) } }
        val parent = projects.firstOrNull { it.getString("key") == project.optString("parentKey") }
        if (parent?.getString("layout") == "board") ImportChoice("Статус", project.optString("boardStatusKey").takeUnless { it == "null" }.orEmpty().ifBlank { "@none" },
            listOf("@none" to genesisTranslate("Автоматически")) + SharedTemplateEdits.rows(parent.getJSONArray("statuses")).map { it.getString("key") to it.getString("title") }, enabled, "template-project-board-status") {
            value -> change { it.put("boardStatusKey", value.takeUnless { it == "@none" } ?: JSONObject.NULL) }
        }
        AffairsDisclosure("Календарь шаблона") {
            val mode = CalendarMode.entries.single { it.wireValue == manifest.getString("calendarMode") }
            EditorCalendarModePicker(mode, { value -> state.proposeManifest { SharedTemplateEdits.copy(manifest).put("calendarMode", value.wireValue) } }, enabled, preferredMode = mode, tag = "template-offset-calendar")
            Text("Месяцы и годы считаются по календарю шаблона. Проверяйте итоговые даты в предпросмотре.", style = MaterialTheme.typography.bodySmall)
            TemplateToggle("Григорианский год с марта", manifest.getJSONObject("calendarContext").getString("gregorianYearStart") == "march", enabled, "template-year-start") {
                value -> val next = SharedTemplateEdits.copy(manifest); next.getJSONObject("calendarContext").put("gregorianYearStart", if (value) "march" else "january"); state.proposeManifest { next }
            }
        }
        TemplateTags(state, manifest, project, "projects")
        TemplateChecks("Метки", templateStrings(project.getJSONArray("labelKeys")), SharedTemplateEdits.rows(manifest.getJSONArray("labels")).map { it.getString("key") to it.getString("title") }, enabled, "template-project-labels") { value -> change { it.put("labelKeys", JSONArray(value)) } }
        TemplateStatuses(state, manifest, project)
        TemplateCategories(state, manifest, project)
        TemplateLabels(state, manifest)
    }
    if (remove) AlertDialog(onDismissRequest = { remove = false }, title = { Text("Удалить подпроект") }, text = { Text("Удалить эту ветку из шаблона?") },
        confirmButton = { TextButton({ if (state.proposeManifest { SharedTemplateEdits.removeProject(manifest, id) }) { chosen = ""; remove = false } }) { Text("Удалить") } },
        dismissButton = { TextButton({ remove = false }) { Text("Отмена") } })
}

@Composable private fun TemplateStatuses(state: SharedTemplateState, manifest: JSONObject, project: JSONObject) {
    val projectId = project.getString("key"); val statuses = SharedTemplateEdits.rows(project.getJSONArray("statuses")); val enabled = state.editable
    var deleting by remember { mutableStateOf<String?>(null) }; var replacement by remember { mutableStateOf("") }; var limit by rememberSaveable(projectId) { mutableIntStateOf(5) }
    fun changeStatus(id: String, action: (JSONObject) -> Unit) = state.proposeManifest { SharedTemplateEdits.update(manifest, "projects", projectId) { value -> action(SharedTemplateEdits.rows(value.getJSONArray("statuses")).single { it.getString("key") == id }) } }
    AffairsDisclosure("Статусы", Modifier.testTag("template-statuses")) {
        statuses.take(limit).forEach { status -> key(status.getString("key")) {
            val id = status.getString("key")
            TemplateField("Название", status.getString("title"), enabled, "template-status-title", maxLength = 80) { value -> changeStatus(id) { it.put("title", value) } }
            TemplateColor(status.getString("color"), enabled) { value -> changeStatus(id) { it.put("color", value) } }
            TemplateToggle("Завершённый статус", status.getBoolean("isDone"), enabled, "template-status-done-$id") { value -> changeStatus(id) { it.put("isDone", value) } }
            ImportChoice("Строки заголовка", status.getInt("taskTitleLines").toString(), (0..3).map { it.toString() to if (it == 0) genesisTranslate("Автоматически") else it.toString() }, enabled, "template-status-lines") { value -> changeStatus(id) { it.put("taskTitleLines", value.toInt()) } }
            ImportChoice("Показывать задач", status.getInt("visibleTaskCount").toString(), (listOf(0, 3, 5, 10, 20, 50, 100, 1000) + status.getInt("visibleTaskCount")).distinct().sorted().map { it.toString() to if (it == 0) genesisTranslate("Все") else it.toString() }, enabled, "template-status-count") { value -> changeStatus(id) { it.put("visibleTaskCount", value.toInt()) } }
            AffairsIconButton("Убрать", AffairsAction.DELETE, { deleting = id; replacement = statuses.firstOrNull { it.getString("key") != id }?.getString("key").orEmpty() }, enabled = enabled && statuses.size > 2)
            HorizontalDivider()
        } }
        if (statuses.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
        TemplateOutlinedButton({ state.proposeManifest { SharedTemplateEdits.update(manifest, "projects", projectId) { it.getJSONArray("statuses").put(JSONObject().put("key", UUID.randomUUID().toString()).put("title", "").put("isDone", false).put("color", "#2d6c68").put("taskTitleLines", 0).put("visibleTaskCount", 0)) } } }, enabled = enabled && statuses.size < 30, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Добавить статус") }
    }
    if (deleting != null) AlertDialog(onDismissRequest = { deleting = null }, title = { Text("Убрать") }, text = {
        ImportChoice("Перенести задачи", replacement, statuses.filter { it.getString("key") != deleting }.map { it.getString("key") to it.getString("title") }, true, "template-status-replacement") { replacement = it }
    }, confirmButton = { TextButton({ state.proposeManifest { SharedTemplateEdits.removeStatus(manifest, projectId, requireNotNull(deleting), replacement) }; deleting = null }, enabled = replacement.isNotBlank()) { Text("Убрать") } }, dismissButton = { TextButton({ deleting = null }) { Text("Отмена") } })
}

@Composable private fun TemplateCategories(state: SharedTemplateState, manifest: JSONObject, project: JSONObject) {
    val id = project.getString("key"); val categories = SharedTemplateEdits.rows(project.getJSONArray("categories")); val enabled = state.editable
    var limit by rememberSaveable(id) { mutableIntStateOf(5) }
    AffairsDisclosure("Категории") {
        categories.take(limit).forEach { category -> key(category.getString("key")) {
            fun change(action: (JSONObject) -> Unit) = state.proposeManifest { SharedTemplateEdits.update(manifest, "projects", id) { action(SharedTemplateEdits.rows(it.getJSONArray("categories")).single { it.getString("key") == category.getString("key") }) } }
            TemplateField("Название", category.getString("title"), enabled, "template-category-title", maxLength = 80) { value -> change { it.put("title", value) } }
            TemplateColor(category.getString("color"), enabled) { value -> change { it.put("color", value) } }
            AffairsIconButton("Убрать", AffairsAction.DELETE, { state.proposeManifest { SharedTemplateEdits.removeCategory(manifest, id, category.getString("key")) } }, enabled = enabled)
        } }
        if (categories.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
        TemplateOutlinedButton({ state.proposeManifest { SharedTemplateEdits.update(manifest, "projects", id) { it.getJSONArray("categories").put(JSONObject().put("key", UUID.randomUUID().toString()).put("title", "").put("color", "#2d6c68")) } } }, enabled = enabled && categories.size < 50, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Добавить категорию") }
    }
}

@Composable private fun TemplateLabels(state: SharedTemplateState, manifest: JSONObject) {
    val labels = SharedTemplateEdits.rows(manifest.getJSONArray("labels")); val enabled = state.editable
    var limit by rememberSaveable { mutableIntStateOf(5) }
    AffairsDisclosure("Метки пространства") {
        labels.take(limit).forEach { label -> key(label.getString("key")) {
            fun change(action: (JSONObject) -> Unit) = state.proposeManifest { SharedTemplateEdits.update(manifest, "labels", label.getString("key"), action) }
            TemplateField("Название", label.getString("title"), enabled, "template-label-title", maxLength = 40) { value -> change { it.put("title", value) } }
            TemplateColor(label.getString("color"), enabled) { value -> change { it.put("color", value) } }
            AffairsIconButton("Убрать", AffairsAction.DELETE, { state.proposeManifest { SharedTemplateEdits.removeLabel(manifest, label.getString("key")) } }, enabled = enabled)
        } }
        if (labels.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
        TemplateOutlinedButton({ val next = SharedTemplateEdits.copy(manifest); next.getJSONArray("labels").put(JSONObject().put("key", UUID.randomUUID().toString()).put("title", "").put("color", "#2d6c68")); state.proposeManifest { next } }, enabled = enabled && labels.size < 50, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Добавить метку") }
    }
}
