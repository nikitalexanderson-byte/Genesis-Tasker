package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Composable internal fun sharedWorkflowCopy(file: String = "workflow-translations.json"): JSONObject {
    val context = LocalContext.current; val language = LocalGenesisLanguage.current
    val all = remember(context, file) { context.assets.open("originals/i18n/$file").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) } }
    return remember(all, language) { all.optJSONObject(language) ?: all.getJSONObject("ru") }
}

internal fun workflowAccessLost(failure: Exception): Boolean =
    failure is AuthFailure && failure.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.NOT_DEPLOYED) ||
        failure is AuthApiError && failure.code in setOf("SHARED_PROJECT_FORBIDDEN", "SHARED_PROJECT_NOT_FOUND", "SHARED_PROJECTS_DISABLED", "SHARED_FORBIDDEN", "UNAUTHORIZED")
internal fun workflowMessage(code: String, copy: JSONObject): String? { return copy.optString(when (code) {
    "WORKFLOW_WIP_LIMIT" -> "wipError"
    "WORKFLOW_REQUIRED_FIELDS" -> "requiredError"
    "WORKFLOW_TRANSITION_FORBIDDEN" -> "transitionError"
    "WORKFLOW_ROLE_FORBIDDEN" -> "roleError"
    "WORKFLOW_STATUS_EDIT_REQUIRES_DISABLE" -> "statusError"
    "WORKFLOW_FIELD_IN_USE" -> "fieldError"
    "WORKFLOW_NO_SAFE_ENTRY" -> "entryError"
    "WORKFLOW_NO_SAFE_EXIT" -> "exitError"
    "WORKFLOW_FIELD_UNAVAILABLE", "WORKFLOW_STATUS_UNCONFIGURED" -> "unavailableError"
    "WORKFLOW_CONFLICT", "CONFLICT" -> "conflict"
    "WORKFLOW_INVALID" -> "invalidError"
    else -> return null
}).takeIf { it.isNotBlank() } }

/** One project surface, also reachable before restoring an archived/deleted project. */
@Composable internal fun SharedWorkflowScreen(controller: SharedWorkspaceGateway, projectId: String, onClose: () -> Unit, onChanged: () -> Unit) {
    key(projectId, LocalGenesisUserId.current) { WorkflowScreenContent(controller, projectId, onClose, onChanged) }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun WorkflowScreenContent(controller: SharedWorkspaceGateway, projectId: String, onClose: () -> Unit, onChanged: () -> Unit) {
    val copy = sharedWorkflowCopy(); val drafts = sharedWorkflowCopy("workflow-draft-translations.json"); val planning = sharedPlanningCopy()
    val language = LocalGenesisLanguage.current; val context = LocalContext.current
    val number = remember(language) { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)) }
    val scope = rememberCoroutineScope(); val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    var data by remember { mutableStateOf<JSONObject?>(null) }; var history by remember { mutableStateOf<JSONObject?>(null) }
    var section by rememberSaveable { mutableStateOf("statuses") }; var source by rememberSaveable { mutableStateOf("") }
    var error by remember { mutableStateOf("") }; var loading by remember { mutableStateOf(true) }; var historyBusy by remember { mutableStateOf(false) }
    var lost by remember { mutableStateOf(false) }; var refresh by remember { mutableIntStateOf(0) }
    var generation by remember { mutableIntStateOf(0) }
    val changed by rememberUpdatedState(onChanged)
    val editor = remember(controller, projectId) { SharedWorkflowEditorState(controller, projectId,
        onLost = { lost = true; data = null; history = null; error = "UNAUTHORIZED"; generation++ },
        onSaved = { history = null; refresh++; changed() }, onRefreshed = { data = WorkflowLifecycle.snapshot(projectId, it); history = null; generation++ }) }
    fun fail(failure: Exception) {
        if (failure is CancellationException) throw failure
        error = if (failure is AuthFailure) sharedFailureCode(failure) else failure.message ?: "PROTOCOL"
        if (workflowAccessLost(failure)) { lost = true; data = null; history = null; generation++; editor.hide() }
    }
    fun leave() {
        if (editor.busy) return
        if (editor.active && editor.phase == "editing" && !editor.saved) scope.launch { if (editor.persist()) onClose() }
        else onClose()
    }
    LaunchedEffect(projectId, refresh, lifecycle.isAtLeast(Lifecycle.State.STARTED)) {
        if (!lifecycle.isAtLeast(Lifecycle.State.STARTED)) return@LaunchedEffect
        loading = data == null
        try {
            val fresh = WorkflowLifecycle.snapshot(projectId, controller.sharedWorkflow(projectId)); currentCoroutineContext().ensureActive()
            val oldRevision = data?.getJSONObject("config")?.getLong("revision")
            if (oldRevision != fresh.getJSONObject("config").getLong("revision")) { history = null; generation++ }
            data = fresh; lost = false; error = ""
            if (!editor.ready) editor.load()
        } catch (failure: Exception) { fail(failure) }
        finally { loading = false }
    }
    LaunchedEffect(editor.inputVersion) { delay(150); if (editor.editable && !editor.saved) editor.persist() }
    val offline = data?.optBoolean("offlineCache") == true
    val manage = data?.getJSONObject("context")?.getJSONObject("project")?.getJSONObject("permissions")?.optBoolean("manageProjects") == true
    val controls = manage && !offline && !lost && !editor.busy && editor.ready
    val writable = controls && editor.editable && !editor.conflicted
    val form = editor.edit
    val stale = form != null && data != null && (form.getLong("expectedRevision") != data!!.getJSONObject("config").getLong("revision") || form.getString("fingerprint") != WorkflowLifecycle.fingerprint(data!!))
    fun moreHistory() {
        val snapshot = data ?: return
        if (offline || lost || historyBusy || history?.isNull("nextCursor") == true) return
        val previous = history; val before = previous?.getLong("nextCursor"); val ticket = generation
        val ceiling = snapshot.getJSONObject("config").getLong("revision")
        historyBusy = true
        scope.launch {
            try {
                val page = controller.sharedWorkflowHistory(projectId, before); currentCoroutineContext().ensureActive()
                if (ticket == generation && history === previous && !lost) { history = WorkflowLifecycle.history(previous, page, before, ceiling); error = "" }
            } catch (failure: Exception) { if (ticket == generation) fail(failure) }
            finally { historyBusy = false }
        }
    }
    val labels = listOf("statuses" to genesisTranslate("Настройки"), "transitions" to copy.getString("transitions"), "history" to genesisTranslate("История"))
    @Composable fun Navigation(modifier: Modifier) {
        ConnectedSubmenu(labels.map { SubmenuItem(it.first, it.second, tag = "workflow-section-${it.first}") },
            section, { section = it }, modifier, connectToParent = false)
    }
    @Composable fun EditorActions() {
        val current = data ?: return
        if (editor.notice) UntranslatedText(copy.getString("saved"), Modifier.testTag("workflow-saved"), color = MaterialTheme.colorScheme.primary)
        if (editor.error.isNotBlank()) {
            val message = workflowMessage(editor.error, copy) ?: when (editor.error) {
                "PLANNING_DRAFT_CHANGED" -> drafts.getString("changed")
                "PLANNING_DRAFT_LIMIT" -> drafts.getString("limit")
                "PLANNING_DRAFT_STORAGE" -> drafts.getString("error")
                "PLANNING_DRAFT_INVALID", "PLANNING_DRAFT_SCOPE" -> planning.getString("deviceInvalid")
                "WORKFLOW_LOCAL_QUEUE" -> planning.getString("localQueue")
                "WORKFLOW_PERMISSION_CHANGED" -> drafts.getString("cached")
                else -> planning.getString("error")
            }
            UntranslatedText(message, Modifier.testTag("workflow-editor-error"), color = MaterialTheme.colorScheme.error)
            if (!editor.ready) TextButton({ scope.launch { editor.load() } }) { Text("Повторить") }
            if (editor.error == "PLANNING_DRAFT_STORAGE" && editor.active) TextButton({ scope.launch { editor.persist() } }, enabled = !editor.busy) { Text("Повторить") }
            if (editor.conflicted) TextButton({ scope.launch { editor.versions() } }, Modifier.testTag("workflow-versions"), enabled = !editor.busy) { UntranslatedText(planning.getString("draftVersions")) }
        }
        if (editor.copies.isNotEmpty() && !editor.active) AffairsDisclosure(planning.getString("draftVersions")) {
            UntranslatedText(planning.getString("draftVersionsHint"), style = MaterialTheme.typography.bodySmall)
            editor.copies.forEach { version -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                UntranslatedText(copy.getString("revision") + " " + number.format(version.getJSONObject("edit").getLong("expectedRevision")), Modifier.weight(1f))
                AffairsIconButton(planning.getString("useDraftVersion"), AffairsAction.EDIT, { scope.launch { editor.useCopy(version) } }, Modifier.testTag("workflow-use-${version.getString("id")}"), controls && editor.phase !in setOf("pending", "received"))
                AffairsIconButton(drafts.getString("discard"), AffairsAction.DELETE, { scope.launch { editor.removeCopy(version) } }, enabled = !editor.busy)
            } }
        }
        if (editor.record != null && !editor.active) {
            UntranslatedText(drafts.getString("heading"), style = MaterialTheme.typography.titleSmall)
            Button({ editor.restore() }, Modifier.heightIn(min = 48.dp).testTag("workflow-restore"), enabled = !editor.busy) { UntranslatedText(drafts.getString("restore")) }
        }
        if (editor.active) {
            if (editor.phase in setOf("pending", "received")) {
                UntranslatedText(drafts.getString("pending"), Modifier.testTag("workflow-pending"))
                Button({ scope.launch { editor.retry() } }, Modifier.heightIn(min = 48.dp).testTag("workflow-retry"), enabled = controls) { Text("Повторить") }
            } else if (stale || editor.phase == "rejected") {
                UntranslatedText(copy.getString("conflict"), Modifier.testTag("workflow-stale"))
                Button({ scope.launch { editor.rebase() } }, Modifier.heightIn(min = 48.dp).testTag("workflow-rebase"), enabled = controls && !editor.conflicted) { UntranslatedText(copy.getString("rebase")) }
            }
            if (editor.phase == "editing") {
                UntranslatedText(drafts.getString(if (editor.saved) "saved" else "saving"), Modifier.testTag("workflow-draft-status"), style = MaterialTheme.typography.bodySmall)
            } else if (editor.phase == "rejected" || editor.phase == "pending" && editor.record?.optInt("attempts") == 0) {
                OutlinedButton({ scope.launch { editor.discard() } }, Modifier.testTag("workflow-discard"), enabled = !editor.busy) { UntranslatedText(drafts.getString("discard")) }
            }
        } else if (editor.record == null && manage) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton({ scope.launch { editor.start(WorkflowLifecycle.newEdit(current)) } },
                    Modifier.heightIn(min = 48.dp).testTag("workflow-configure"), enabled = controls) {
                    AffairsActionIcon(AffairsAction.EDIT); Spacer(Modifier.width(8.dp)); UntranslatedText(copy.getString("configure"))
                }
                if (current.getJSONObject("config").getBoolean("enabled")) OutlinedButton({ scope.launch {
                    editor.start(WorkflowLifecycle.newEdit(current, disableOnly = true)); editor.submit()
                } }, Modifier.heightIn(min = 48.dp).testTag("workflow-disable"), enabled = controls) { UntranslatedText(copy.getString("disable")) }
            }
        }
        if (editor.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("workflow-editor-busy"))
    }
    val listState = rememberLazyListState()
    LaunchedEffect(section) { listState.scrollToItem(0) }
    @Composable fun Content(modifier: Modifier, phone: Boolean) {
        LazyColumn(modifier.testTag("workflow-content"), state = listState, verticalArrangement = Arrangement.spacedBy(16.dp), contentPadding = PaddingValues(bottom = 24.dp)) {
            if (phone) item { Navigation(Modifier.fillMaxWidth()) }
            if (loading) item { WorkspaceLoadingLine(Modifier.fillMaxWidth()) }
            if (error.isNotBlank()) item { Text(if (lost) "Нет доступа" else "Не удалось загрузить данные", color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("workflow-error")) }
            if (data != null && !lost) {
                val current = data!!
                item { Column(verticalArrangement = Arrangement.spacedBy(12.dp), modifier = Modifier.widthIn(max = AffairsLayout.formMaxWidth)) {
                    UntranslatedText(copy.getString(if (current.getJSONObject("config").getBoolean("enabled")) "enabled" else "disabled"),
                        Modifier.testTag("workflow-summary"), style = MaterialTheme.typography.titleMedium)
                    UntranslatedText(copy.getString("hint"), style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                    if (offline) UntranslatedText(drafts.getString("cached"), Modifier.testTag("workflow-offline"), color = MaterialTheme.colorScheme.secondary)
                    EditorActions()
                } }
                if (form != null && !form.getBoolean("disableOnly")) item {
                    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp), verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        UntranslatedText(copy.getString("enable"), Modifier.weight(1f), style = MaterialTheme.typography.bodyLarge)
                        Switch(form.getJSONObject("draft").getBoolean("enabled"), { enabled ->
                            val next = JSONObject(form.toString()); next.getJSONObject("draft").put("enabled", enabled); editor.change(next)
                        }, enabled = writable, modifier = Modifier.testTag("workflow-enabled"))
                    }
                }
                when (section) {
                    "statuses" -> {
                        val definition = form?.getJSONObject("draft") ?: current.getJSONObject("config")
                        val statuses = WorkflowLifecycle.rows(current.getJSONObject("context").getJSONArray("statuses"))
                        val rules = WorkflowLifecycle.rows(definition.getJSONArray("statuses"))
                        items(statuses.size, key = { statuses[it].getString("id") }) { index ->
                            val status = statuses[index]; val id = status.getString("id")
                            val rule = rules.find { it.getString("statusId") == id }
                            WorkflowStatus(current, status, rule, writable && form?.getBoolean("disableOnly") == false, copy, number) { updated ->
                                val next = JSONObject(form!!.toString()); val nextRules = WorkflowLifecycle.rows(next.getJSONObject("draft").getJSONArray("statuses"))
                                next.getJSONObject("draft").put("statuses", JSONArray(nextRules.map { if (it.getString("statusId") == id) updated else it })); editor.change(next)
                            }
                        }
                        rules.filter { rule -> statuses.none { it.getString("id") == rule.getString("statusId") } }.forEach { removed -> item {
                            Column { Text("Недоступно", color = MaterialTheme.colorScheme.error); if (writable) OutlinedButton({
                                val next = JSONObject(form!!.toString()); val id = removed.getString("statusId")
                                next.getJSONObject("draft").put("statuses", JSONArray(rules.filterNot { it.getString("statusId") == id }))
                                next.getJSONObject("draft").put("transitions", JSONArray(WorkflowLifecycle.rows(next.getJSONObject("draft").getJSONArray("transitions")).filterNot { it.optString("fromStatusId") == id || it.getString("toStatusId") == id }))
                                editor.change(next)
                            }) { Text("Удалить") } }
                        } }
                        item { UntranslatedText(copy.getString("safety"), style = MaterialTheme.typography.bodySmall) }
                    }
                    "transitions" -> item { WorkflowTransitions(current, form?.getJSONObject("draft") ?: current.getJSONObject("config"), source,
                        { source = it }, writable && form?.getBoolean("disableOnly") == false, copy) { edges ->
                        val next = JSONObject(form!!.toString()); next.getJSONObject("draft").put("transitions", edges); editor.change(next)
                    } }
                    "history" -> {
                        val versions = history?.let { WorkflowLifecycle.rows(it.getJSONArray("versions")) }.orEmpty()
                        items(versions.size, key = { versions[it].getLong("revision") }) { index ->
                            val version = versions[index]
                            AffairsDisclosure(copy.getString("revision") + " " + number.format(version.getLong("revision")) + " · " + copy.getString(if (version.getBoolean("enabled")) "enabled" else "disabled"), Modifier.widthIn(max = AffairsLayout.formMaxWidth).testTag("workflow-history-${version.getLong("revision")}")) {
                                UntranslatedText(DateTimeFormatter.ofLocalizedDateTime(FormatStyle.MEDIUM).withLocale(Locale.forLanguageTag(language)).withZone(ZoneId.systemDefault()).format(Instant.parse(version.getString("createdAt"))))
                                WorkflowLifecycle.rows(version.getJSONArray("statuses")).forEach { rule ->
                                    val title = WorkflowLifecycle.rows(current.getJSONObject("context").getJSONArray("statuses")).find { it.getString("id") == rule.getString("statusId") }?.getString("title") ?: genesisTranslate("Недоступно")
                                    UntranslatedText(title, style = MaterialTheme.typography.titleSmall)
                                    UntranslatedText(copy.getString("limit") + ": " + if (rule.isNull("wipLimit")) copy.getString("noLimit") else number.format(rule.getLong("wipLimit")))
                                    val fields = workflowFields(current, copy).toMap()
                                    val unavailableField = genesisTranslate("Недоступно")
                                    UntranslatedText(copy.getString("required") + ": " + (0 until rule.getJSONArray("requiredFields").length()).joinToString { fields[rule.getJSONArray("requiredFields").getString(it)] ?: unavailableField }.ifBlank { "—" })
                                }
                                WorkflowTransitions(current, version, "", {}, false, copy, {})
                            }
                        }
                        if (history != null && versions.isEmpty()) item { UntranslatedText(genesisTranslate("История") + ": " + number.format(0), Modifier.testTag("workflow-history-empty")) }
                        if (history == null || !history!!.isNull("nextCursor")) item { Button(::moreHistory, Modifier.heightIn(min = 48.dp).testTag("workflow-history-more"), enabled = !offline && !historyBusy) { UntranslatedText(copy.getString(if (history == null) "load" else "more")) } }
                        if (historyBusy) item { WorkspaceLoadingLine(Modifier.fillMaxWidth()) }
                    }
                }
            }
        }
    }
    Dialog(onDismissRequest = ::leave, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        GenesisModalFrame(::leave) {
                Column(Modifier.testTag("shared-workflow-screen")) {
                    AffairsDialogHeader(copy.getString("heading"), if (lost) "" else data?.getJSONObject("context")?.getJSONObject("project")?.getString("title").orEmpty(),
                        onClose = ::leave, onBack = ::leave, enabled = !editor.busy,
                        closeTag = "workflow-close", backTag = "workflow-back", actions = {
                            AffairsIconButton("Обновить", AffairsAction.REFRESH, { refresh++; generation++; history = null },
                                Modifier.testTag("workflow-refresh"), !editor.busy && !loading)
                        })
                    HorizontalDivider()
                    Column(Modifier.weight(1f, fill = false).fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Navigation(Modifier.fillMaxWidth())
                        Content(Modifier.fillMaxWidth().weight(1f, fill = false), false)
                    }
                    if (editor.active && editor.phase == "editing") {
                        HorizontalDivider()
                        Row(Modifier.fillMaxWidth().padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            TextButton({ scope.launch { editor.discard() } }, Modifier.weight(1f).heightIn(min = 48.dp).testTag("workflow-discard"), enabled = !editor.busy) { UntranslatedText(copy.getString("cancel")) }
                            Button({ scope.launch { editor.submit() } }, Modifier.weight(1f).heightIn(min = 48.dp).testTag("workflow-save"), enabled = writable && !stale) { Text("Сохранить") }
                        }
                    }
                }
        }
    }
}

@Composable private fun workflowFields(data: JSONObject, copy: JSONObject): List<Pair<String, String>> = listOf(
    "description" to copy.getString("description"), "assigneeId" to genesisTranslate("Исполнитель"), "dueDate" to copy.getString("dueDate"),
    "startDate" to copy.getString("startDate"), "categoryId" to copy.getString("category"), "labels" to genesisTranslate("Метки"),
    "storyPoints" to sharedPlanningCopy().getString("points"), "estimateHours" to sharedPlanningCopy().getString("hours")) +
    WorkflowLifecycle.rows(data.getJSONObject("context").getJSONArray("customFieldDefinitions")).map { "custom:${it.getString("id")}" to (it.getString("title") + if (it.getBoolean("archived")) " · " + genesisTranslate("Недоступно") else "") }

@Composable private fun WorkflowCheck(label: String, checked: Boolean, enabled: Boolean, tag: String, onChange: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag).toggleable(value = checked, enabled = enabled, role = Role.Checkbox, onValueChange = onChange), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        Checkbox(checked, null, enabled = enabled); UntranslatedText(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable private fun WorkflowStatus(data: JSONObject, status: JSONObject, rule: JSONObject?, editable: Boolean, copy: JSONObject, number: NumberFormat, change: (JSONObject) -> Unit) {
    val id = status.getString("id"); val count = data.getJSONObject("counts").optLong(id)
    val limit = rule?.get("wipLimit").takeUnless { it == JSONObject.NULL }
    val fields = workflowFields(data, copy)
    AffairsDisclosure(status.getString("title") + " · " + number.format(count) + if (limit != null) " / $limit" else "", Modifier.widthIn(max = AffairsLayout.formMaxWidth).testTag("workflow-status-$id"), titleIsUserContent = true) {
        if (rule == null) UntranslatedText(copy.getString("disabled"))
        else {
            if (editable && (!status.getBoolean("isDone") || limit != null)) OutlinedTextField(if (limit == null) "" else limit.toString(), {
                if (it.length <= 32) change(JSONObject(rule.toString()).put("wipLimit", it))
            }, Modifier.fillMaxWidth().testTag("workflow-limit-$id"), label = { UntranslatedText(copy.getString("limit")) },
                placeholder = { UntranslatedText(copy.getString("noLimit")) }, supportingText = { UntranslatedText(copy.getString("noLimit") + " · " + genesisTranslate("Задачи") + ": " + number.format(count)) }, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number), singleLine = true)
            else UntranslatedText(copy.getString("limit") + ": " + (limit?.toString() ?: copy.getString("noLimit")))
            UntranslatedText(copy.getString("required"), style = MaterialTheme.typography.titleSmall)
            val required = (0 until rule.getJSONArray("requiredFields").length()).map { rule.getJSONArray("requiredFields").getString(it) }
            val options = fields + required.filter { key -> fields.none { it.first == key } }.map { it to genesisTranslate("Недоступно") }
            options.forEach { (key, label) ->
                if (editable || key in required) WorkflowCheck(label, key in required, editable, "workflow-field-$id-$key") { checked ->
                    change(JSONObject(rule.toString()).put("requiredFields", JSONArray(if (checked) required + key else required - key)))
                }
            }
            if (!editable && required.isEmpty()) UntranslatedText("—")
        }
    }
}

@Composable private fun WorkflowTransitions(data: JSONObject, definition: JSONObject, source: String, onSource: (String) -> Unit, editable: Boolean, copy: JSONObject, change: (JSONArray) -> Unit) {
    val currentStatuses = WorkflowLifecycle.rows(data.getJSONObject("context").getJSONArray("statuses"))
    val edges = WorkflowLifecycle.rows(definition.getJSONArray("transitions"))
    val referenced = (WorkflowLifecycle.rows(definition.getJSONArray("statuses")).map { it.getString("statusId") } +
        edges.flatMap { listOfNotNull(it.getString("toStatusId"), it.optString("fromStatusId").takeUnless { id -> id.isBlank() || id == "null" }) }).distinct()
    val unavailable = genesisTranslate("Недоступно")
    val statuses = currentStatuses + referenced.filter { id -> currentStatuses.none { it.getString("id") == id } }
        .map { JSONObject().put("id", it).put("title", unavailable) }
    var expanded by remember { mutableStateOf(false) }; var viewing by remember(definition.getLongOrZero()) { mutableStateOf("") }
    val from = if (editable) source else viewing
    val label = if (from.isEmpty()) copy.getString("entry") else statuses.find { it.getString("id") == from }?.getString("title") ?: genesisTranslate("Недоступно")
    Column(Modifier.widthIn(max = AffairsLayout.formMaxWidth).fillMaxWidth().testTag("workflow-transitions"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        UntranslatedText(copy.getString("accessHint"), style = MaterialTheme.typography.bodySmall)
        Box { OutlinedButton({ expanded = true }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("workflow-source")) { UntranslatedText(label, Modifier.weight(1f)); AffairsActionIcon(AffairsAction.EXPAND) }
            DropdownMenu(expanded, { expanded = false }) {
                (listOf("" to copy.getString("entry")) + statuses.map { it.getString("id") to it.getString("title") }).forEach { (id, title) ->
                    DropdownMenuItem(text = { UntranslatedText(title) }, modifier = Modifier.testTag("workflow-source-${id.ifEmpty { "entry" }}"), onClick = { if (editable) onSource(id) else viewing = id; expanded = false })
                }
            }
        }
        statuses.filter { it.getString("id") != from }.forEach { target ->
            val to = target.getString("id"); val edge = edges.find { (it.isNull("fromStatusId") && from.isEmpty() || it.optString("fromStatusId") == from) && it.getString("toStatusId") == to }
            AffairsDisclosure(target.getString("title"), Modifier.testTag("workflow-target-$to"), titleIsUserContent = true) {
                WorkflowCheck(copy.getString("transitions"), edge != null, editable, "workflow-edge-$to") { selected ->
                    change(JSONArray(if (selected) edges + JSONObject().put("fromStatusId", from.ifEmpty { null } ?: JSONObject.NULL).put("toStatusId", to).put("roles", JSONArray(WorkflowLifecycle.roles)) else edges.filterNot { it === edge }))
                }
                if (edge != null) {
                    UntranslatedText(copy.getString("roles"), style = MaterialTheme.typography.titleSmall)
                    val roles = (0 until edge.getJSONArray("roles").length()).map { edge.getJSONArray("roles").getString(it) }
                    WorkflowLifecycle.roles.forEach { role -> WorkflowCheck(genesisTranslate(sharedRoleLabel(role, false)), role in roles, editable, "workflow-role-$to-$role") { checked ->
                        change(JSONArray(edges.map { if (it === edge) JSONObject(it.toString()).put("roles", JSONArray(if (checked) roles + role else roles - role)) else it }))
                    } }
                }
            }
        }
    }
}
private fun JSONObject.getLongOrZero() = optLong("revision", 0)
