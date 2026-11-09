package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedTemplateManifest
import ru.genesis.calendar.auth.SharedTemplateProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.time.LocalDate
import java.util.UUID

/** A single native workspace surface: compact drill-down and expanded library/detail panes. */
@Composable internal fun SharedTemplatesScreen(controller: SharedWorkspaceGateway, space: String, project: String,
    projectTitle: String, projects: List<JSONObject>, members: List<JSONObject>, preferences: UiPreferences,
    canWrite: Boolean, canCreate: Boolean, captureTask: JSONObject? = null, onClose: () -> Unit,
    onChanged: () -> Unit, onOpen: (String, String?) -> Unit) {
    val account = LocalGenesisUserId.current; val language = LocalGenesisLanguage.current; val scope = rememberCoroutineScope()
    val state = remember(controller, account, space, project, language) { SharedTemplateState(controller, account, space, project, language) }
    val draftCopy = sharedWorkflowCopy("workflow-draft-translations.json"); val copy = sharedTemplateCopy()
    val openTitle = genesisTranslate("К выполнению"); val doneTitle = genesisTranslate("Готово")
    val blankProject = genesisTranslate("Новый проект")
    val input = SharedCustomCalendar.initial(if (LocalSacredFeaturesEnabled.current) preferences else preferences.copy(input = CalendarMode.PROFANE))
    var pane by rememberSaveable(project) { mutableStateOf("tasks") }
    var search by rememberSaveable(project) { mutableStateOf("") }
    var leave by remember { mutableStateOf(false) }; var erase by remember { mutableStateOf(false) }
    fun run(action: suspend () -> Unit) { scope.launch { action() } }
    fun close() = run {
        if (state.dirty) state.save()
        if (state.dirty || state.conflicted) leave = true else { state.close(); onClose() }
    }
    fun back() = run {
        if (state.edit != null || state.source != null) {
            if (state.dirty) state.save()
            if (!state.dirty && !state.conflicted) state.showLibrary() else leave = true
        } else { state.close(); onClose() }
    }
    fun start(request: JSONObject, id: String? = null) = run {
        state.start(SharedTemplateProtocol.newEdit(space, project, "template-save", id, request).put("dateInput", input.saved()))
    }
    fun capture() {
        val request = JSONObject().put("projectId", project).put("title", captureTask?.optString("title") ?: projectTitle).put("sourceProjectId", project)
            .put("capture", JSONObject().put("calendarMode", input.mode.wireValue).put("calendarContext", input.saved().apply { remove("mode") }).put("anchorDate", LocalDate.now().toString()))
        captureTask?.let { request.put("sourceTaskId", it.getString("id")) }; start(request)
    }
    fun blank(kind: String) {
        val root = UUID.randomUUID().toString(); val manifest = JSONObject().put("schemaVersion", 1).put("kind", kind).put("calendarMode", input.mode.wireValue)
            .put("calendarContext", input.saved().apply { remove("mode") }).put("labels", JSONArray()).put("fields", JSONArray())
            .put("projects", JSONArray().put(SharedTemplateManifest.newProject(root, if (kind == "task") projectTitle else blankProject, openTitle, doneTitle)))
            .put("tasks", JSONArray())
        if (kind == "task") manifest.getJSONArray("tasks").put(SharedTemplateManifest.newTask(UUID.randomUUID().toString(), root, manifest.getJSONArray("projects").getJSONObject(0).getJSONArray("statuses").getJSONObject(0).getString("key"), ""))
        pane = if (kind == "task") "tasks" else "projects"; start(JSONObject().put("projectId", project).put("title", "").put("manifest", manifest))
    }
    fun editSource(asCopy: Boolean = false, deleted: Boolean? = null) {
        val source = state.source ?: return
        val request = JSONObject().put("projectId", if (asCopy) project else source.getString("projectId")).put("title", source.getString("title"))
        if (deleted != null) request.put("expectedRevision", source.getInt("revision")).put("deleted", deleted)
        else {
            request.put("manifest", JSONObject(source.getJSONObject("manifest").toString()))
            if (asCopy) request.put("cloneTemplateId", source.getString("id")) else request.put("expectedRevision", source.getInt("revision"))
        }
        start(request, if (asCopy) null else source.getString("id"))
    }
    fun applySource() = run {
        val source = state.source ?: return@run
        val options = JSONObject().put("spaceId", space).put("language", language).put("anchorDate", LocalDate.now().toString())
        if (source.getString("kind") == "task") options.put("projectId", project)
        state.start(SharedTemplateProtocol.newEdit(space, project, "template-apply", source.getString("id"), options).put("dateInput", input.saved()))
        if (state.error.isBlank()) state.review()
    }
    fun submit() = run {
        if (state.phase == "editing") state.prepare()
        if (state.phase == "pending") state.send()
        if (state.phase == "received") onChanged()
    }
    LaunchedEffect(state) { state.load(); if (captureTask != null && state.loaded && state.record == null && !state.lost) capture() }
    LaunchedEffect(state, canWrite, canCreate) { state.updatePermissions(canWrite, canCreate) }
    LaunchedEffect(state.inputVersion) { if (state.dirty && state.phase == "editing") { delay(250); state.save() } }
    DisposableEffect(state) { onDispose { scope.launch(NonCancellable) { try { if (state.dirty) state.save() } finally { state.close() } } } }
    Dialog(onDismissRequest = ::back, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        GenesisModalFrame(::back) {
            val compactIme = WindowInsets.ime.getBottom(LocalDensity.current) > 0 && maxHeight < 360.dp
                Column(Modifier.testTag("shared-templates-screen")) {
                    @Composable fun Header() {
                        AffairsDialogHeader("Шаблоны", projectTitle, ::close,
                            onBack = if (state.edit != null || state.source != null) ::back else null,
                            closeTag = "template-close", backTag = "template-back",
                            compact = compactIme, titleTag = "template-heading")
                    }
                    @Composable fun LocalActions() {
                        if (state.edit?.getString("kind") == "template-apply") TemplateOutlinedButton({ run { state.review() } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-review")) { Text("Предпросмотр применения") }
                        TextButton({ erase = true }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-discard")) { Text(draftCopy.getString("discard")) }
                    }
                    if (!compactIme) Header()
                    if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("template-progress"))
                    @Composable fun Notice() { if (state.error.isNotBlank()) UntranslatedText(when {
                        state.lost -> templateIssueMessage("TEMPLATE_PERMISSION_CHANGED", copy)
                        state.conflicted -> draftCopy.getString("changed")
                        state.error in setOf("PLANNING_DRAFT_STORAGE", "STORAGE") -> draftCopy.getString("error")
                        state.error in setOf("PLANNING_DRAFT_LIMIT", "TEMPLATE_SIZE_LIMIT") -> draftCopy.getString("limit")
                        state.error == "NETWORK" -> genesisTranslate("Нет сети. Повторите действие после подключения.")
                        state.error in setOf("PLANNING_DRAFT_INVALID", "PLANNING_DRAFT_SCOPE") -> genesisTranslate("Черновик не удалось прочитать. Он сохранён на устройстве. Повторите загрузку или закройте окно.")
                        else -> templateIssueMessage(state.error, copy)
                    }, Modifier.fillMaxWidth().padding(16.dp).testTag("template-error"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                    if (!compactIme) Notice()
                    if (!state.loaded && !state.busy && !state.lost) TemplateOutlinedButton({ run { state.load() } }, Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 48.dp)) { Text("Повторить") }
                    BoxWithConstraints(Modifier.weight(1f, fill = false).fillMaxWidth()) {
                        val wide = maxWidth >= 720.dp
                        @Composable fun Library(modifier: Modifier) {
                            Column(modifier.verticalScroll(rememberScrollState()).padding(16.dp).testTag("template-library"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                                if (compactIme) { Header(); Notice() }
                                if (state.record != null && state.edit == null) TemplateOutlinedButton({ state.resume() }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(draftCopy.getString("restore")) }
                                val available = state.loaded && !state.busy && !state.lost && state.record == null && state.edit == null
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    TemplateIconButton("Сохранить как шаблон", AffairsAction.TEMPLATE, canWrite && available, Modifier.weight(1f).testTag("template-capture"), onClick = ::capture)
                                    TemplateIconButton("Задача", AffairsAction.TASK, canWrite && available, Modifier.weight(1f).testTag("template-new-task")) { blank("task") }
                                    TemplateIconButton("Проект", AffairsAction.ADD, canWrite && available, Modifier.weight(1f).testTag("template-new-project")) { blank("project") }
                                    TemplateIconButton("Обновить", AffairsAction.REFRESH, state.loaded && !state.busy && !state.lost, Modifier.weight(1f).testTag("template-library-refresh")) { run { state.loadLibrary() } }
                                }
                                TemplateToggle("Удалённые шаблоны", state.deleted, state.loaded && !state.busy && !state.lost, "template-deleted") { run { state.loadLibrary(it) } }
                                TemplateField("Поиск", search, !state.busy, "template-search") { search = it }
                                val library = state.library
                                if (library != null) for ((collection, title) in listOf("systemTemplates" to "Стартовые шаблоны", "templates" to "Шаблоны пространства")) {
                                    val records = SharedTemplateEdits.rows(library.getJSONArray(collection)).filter { search.isBlank() || it.getString("title").contains(search.trim(), ignoreCase = true) }
                                    var limit by rememberSaveable(collection, state.deleted, search) { mutableIntStateOf(5) }
                                    if (records.isNotEmpty()) Text(title, style = MaterialTheme.typography.titleMedium)
                                    records.take(limit).forEach { row -> TemplateOutlinedButton({ run { state.open(row.getString("id")) } }, enabled = !state.busy && state.edit == null && !state.lost, shape = AffairsLayout.controlShape,
                                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-source-${row.getString("id")}")) {
                                        UntranslatedText(row.getString("title"), Modifier.fillMaxWidth(), style = MaterialTheme.typography.bodyMedium)
                                    } }
                                    if (records.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-library-$collection-more")) { Text("Показать ещё") }
                                }
                                if (library?.getInt("total") == 0) Text("Сохраните задачу или проект как шаблон, чтобы использовать структуру снова.", style = MaterialTheme.typography.bodyMedium)
                                if (state.hasMore) TemplateOutlinedButton({ run { state.loadLibrary(more = true) } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Показать ещё") }
                                if (state.copies.isNotEmpty()) AffairsDisclosure(draftCopy.getString("heading")) { state.copies.forEach { saved ->
                                    val title = saved.getJSONObject("edit").getJSONObject("request").optString("title").takeUnless { it == "null" }.orEmpty()
                                    UntranslatedText(title, style = MaterialTheme.typography.bodyMedium)
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        TemplateIconButton("Восстановить", AffairsAction.HISTORY, !state.busy && !state.dirty && !state.lost, Modifier.weight(1f)) { run { state.useCopy(saved.getString("id")) } }
                                        TemplateIconButton("Убрать", AffairsAction.DELETE, !state.busy && !state.lost, Modifier.weight(1f)) { run { state.removeCopy(saved.getString("id")) } }
                                    }
                                } }
                            }
                        }
                        @Composable fun Detail(modifier: Modifier) {
                            Column(modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp, vertical = if (compactIme) 4.dp else 16.dp).testTag("template-detail"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                                if (compactIme) { Header(); Notice() }
                                val edit = state.edit; val source = state.source
                                if (state.lost) Text("Нет доступа", Modifier.testTag("template-access-lost"), style = MaterialTheme.typography.titleMedium)
                                else if (edit != null) {
                                    val request = edit.getJSONObject("request")
                                    if (state.phase == "received") {
                                        Text(if (edit.getString("kind") == "template-apply") "Шаблон применён." else "Готово", Modifier.testTag("template-received"), style = MaterialTheme.typography.titleLarge)
                                        val receipt = state.receipt
                                        if (receipt != null) TemplateOutlinedButton({
                                            if (edit.getString("kind") == "template-apply") { state.close(); onOpen(receipt.getString("rootProjectId"), receipt.optString("rootTaskId").takeUnless { it == "null" || it.isBlank() }) }
                                            else run { val id = receipt.getString("id"); val deleted = receipt.getBoolean("deleted"); state.discard(); state.loadLibrary(archive = deleted); state.open(id) }
                                        }, Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text(if (edit.getString("kind") == "template-apply") "Открыть созданное" else "Открыть") }
                                    } else {
                                        if (state.phase == "pending" && (state.record?.optInt("attempts") ?: 0) > 0) Text(draftCopy.getString("pending"), style = MaterialTheme.typography.bodyMedium)
                                        if (edit.getString("kind") == "template-save") {
                                            TemplateField("Название шаблона", request.getString("title"), state.editable, "template-title", onChange = state::changeTitle)
                                            Text("Изменения шаблона не меняют ранее созданные задачи.", style = MaterialTheme.typography.bodySmall)
                                            val manifest = request.optJSONObject("manifest")
                                            if (manifest != null) {
                                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                                    for ((id, label, icon) in listOf(Triple("projects", "Структура проекта", AffairsAction.TEMPLATE), Triple("tasks", "Задачи", AffairsAction.TASK), Triple("fields", "Пользовательские поля", AffairsAction.SETTINGS))) TemplateIconButton(label, icon, !state.busy, Modifier.weight(1f).testTag("template-tab-$id"), selected = pane == id) { pane = id }
                                                }
                                                when (pane) { "projects" -> SharedTemplateProjectEditor(state, openTitle, doneTitle); "fields" -> SharedTemplateDefinitionEditor(state); else -> SharedTemplateTaskEditor(state, preferences, members) }
                                            } else request.optJSONObject("capture")?.let { capture ->
                                                val calendar = edit.optJSONObject("dateInput")?.let(SharedCustomCalendar::restore) ?: input
                                                Text("Базовая дата", style = MaterialTheme.typography.titleSmall)
                                                AuthorDatePicker(capture.getString("anchorDate"), calendar.mode, calculationContext = calendar.context, enabled = state.editable,
                                                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { value -> val next = SharedTemplateEdits.copy(edit); next.getJSONObject("request").getJSONObject("capture").put("anchorDate", value); state.change(next) }
                                                AffairsDisclosure("Календарь ввода") { EditorCalendarModePicker(calendar.mode, { state.changeDateInput(calendar.copy(mode = it)) }, state.editable, preferredMode = calendar.mode, tag = "template-capture-input-calendar") }
                                                Text("Календарь шаблона", style = MaterialTheme.typography.titleSmall)
                                                val mode = CalendarMode.entries.single { it.wireValue == capture.getString("calendarMode") }
                                                EditorCalendarModePicker(mode, { value -> val next = SharedTemplateEdits.copy(edit); next.getJSONObject("request").getJSONObject("capture").put("calendarMode", value.wireValue); state.change(next) }, state.editable, preferredMode = mode, tag = "template-capture-calendar")
                                                Text("Сроки сохранятся как сдвиг в днях от базовой даты. В редакторе можно выбрать месяцы и годы.", style = MaterialTheme.typography.bodyMedium)
                                            }
                                        } else SharedTemplateApplyEditor(state, preferences, projects)
                                    }
                                    if (state.conflicted) {
                                        TemplateOutlinedButton({ run { state.saveOwnCopy() } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Сохранить копию") }
                                        state.copies.forEachIndexed { index, saved -> TemplateOutlinedButton({ run { state.useCopy(saved.getString("id")) } }, enabled = !state.busy && !state.dirty, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                            Text(genesisTranslate("Восстановить") + " " + (index + 1))
                                        } }
                                    }
                                } else if (source != null) {
                                    UntranslatedText(source.getString("title"), style = MaterialTheme.typography.headlineSmall)
                                    Text(if (source.getBoolean("system")) "Системный шаблон" else "Пользовательский шаблон", style = MaterialTheme.typography.bodyMedium)
                                    val available = !state.busy && !state.lost && state.record == null
                                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        if (source.getBoolean("canEdit")) TemplateIconButton("Изменить", AffairsAction.EDIT, available, Modifier.weight(1f).testTag("template-source-edit")) { editSource() }
                                        TemplateIconButton("Создать копию для редактирования", AffairsAction.TEMPLATE, available && canWrite, Modifier.weight(1f).testTag("template-source-copy")) { editSource(asCopy = true) }
                                        if (source.getBoolean("canEdit")) TemplateIconButton(if (source.getBoolean("deleted")) "Восстановить" else "Удалить шаблон", if (source.getBoolean("deleted")) AffairsAction.HISTORY else AffairsAction.DELETE, available, Modifier.weight(1f).testTag("template-source-delete")) { editSource(deleted = !source.getBoolean("deleted")) }
                                    }
                                    val manifest = source.getJSONObject("manifest")
                                    for (collection in listOf("projects", "tasks")) {
                                        val rows = SharedTemplateEdits.rows(manifest.getJSONArray(collection))
                                        var limit by rememberSaveable(source.getString("id"), collection) { mutableIntStateOf(5) }
                                        rows.take(limit).forEach { row -> UntranslatedText(row.getString("title"), style = if (collection == "projects") MaterialTheme.typography.titleMedium else MaterialTheme.typography.bodyMedium) }
                                        if (rows.size > limit) TemplateOutlinedButton({ limit += 5 }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-source-$collection-more")) { Text("Показать ещё") }
                                    }
                                    if (!source.getBoolean("deleted")) Button(::applySource, enabled = available && (if (source.getString("kind") == "project") canCreate else canWrite), shape = AffairsLayout.controlShape, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-apply-open")) { Text("Применить шаблон") }
                                    TemplateIssues(source.getJSONArray("notices"), copy, "Изменения и пропуски", "template-source-notices")
                                } else Text("Выберите шаблон, чтобы посмотреть структуру и применить его.", style = MaterialTheme.typography.bodyMedium)
                                if (compactIme && state.edit != null && !state.lost && state.phase == "editing") LocalActions()
                            }
                        }
                        if (wide) Row(Modifier.fillMaxWidth()) {
                            val editing = state.edit != null || state.source != null || state.lost
                            if (!compactIme || !editing) {
                                Library(if (compactIme) Modifier.weight(1f) else Modifier.width(288.dp))
                                if (!compactIme) VerticalDivider()
                            }
                            if (!compactIme || editing) Detail(Modifier.weight(1f))
                        }
                        else if (state.edit != null || state.source != null || state.lost) Detail(Modifier.fillMaxWidth()) else Library(Modifier.fillMaxWidth())
                    }
                    if (state.edit != null && !state.lost) {
                        HorizontalDivider()
                        Column(Modifier.fillMaxWidth().padding(if (compactIme) 4.dp else 16.dp).testTag("template-footer"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            when (state.phase) {
                                "received" -> Button({ run { state.discard(); state.loadLibrary() } }, enabled = !state.busy, shape = AffairsLayout.controlShape, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-done")) { Text("Готово") }
                                "editing" -> {
                                    if (!compactIme && state.edit?.getString("kind") == "template-apply") TemplateOutlinedButton({ run { state.review() } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-review")) { Text("Предпросмотр применения") }
                                    Button(::submit, enabled = state.editable && (state.edit?.getString("kind") != "template-apply" || state.previewCurrent && state.preview?.optBoolean("canApply") == true), shape = AffairsLayout.controlShape, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-submit")) {
                                        Text(if (state.edit?.getString("kind") == "template-apply") "Создать из шаблона" else if (state.edit?.getJSONObject("request")?.optBoolean("deleted") == true) "Удалить шаблон" else "Сохранить шаблон")
                                    }
                                    if (!compactIme) TextButton({ erase = true }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-discard")) { Text(draftCopy.getString("discard")) }
                                }
                                else -> {
                                    Button(::submit, enabled = !state.busy && state.phase == "pending", shape = AffairsLayout.controlShape, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("template-retry")) { Text("Повторить") }
                                    if (state.phase == "rejected" || state.phase == "pending" && state.record?.optInt("attempts") == 0) TemplateOutlinedButton({ run { state.resumeEditing() } }, enabled = !state.busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) { Text("Изменить") }
                                }
                            }
                        }
                    }
                }
        }
    }
    if (erase) AlertDialog(onDismissRequest = { erase = false }, title = { Text(draftCopy.getString("discard")) }, text = { Text("Изменения шаблона не меняют ранее созданные задачи.") },
        confirmButton = { TextButton({ erase = false; run { state.discard() } }, Modifier.testTag("template-discard-confirm")) { Text("Удалить") } }, dismissButton = { TextButton({ erase = false }) { Text("Отмена") } })
    if (leave) AlertDialog(onDismissRequest = { leave = false }, title = { Text("Сохранить изменения?") }, text = { Text("Не удалось сохранить последние изменения. Попробуйте сохранить копию или закройте окно без них.") },
        confirmButton = { DialogActionRow(
            DialogIconAction("Отмена", AffairsAction.EDIT, { leave = false }),
            DialogIconAction("Закрыть без сохранения", AffairsAction.UNDO, { leave = false; state.close(); onClose() },
                destructive = true, modifier = Modifier.testTag("template-leave-unsaved")),
            DialogIconAction("Сохранить копию", AffairsAction.COPY, { run {
                state.saveOwnCopy(); if (state.error.isBlank()) { leave = false; state.close(); onClose() }
            } })
        ) })
}
