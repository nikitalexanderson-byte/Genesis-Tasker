package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.platform.LocalContext
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import org.json.JSONObject
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.text.NumberFormat
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences

/** One project uses the existing task collection and encrypted task mutation outbox. */
@Composable internal fun SharedPlanningScreen(controller: SharedWorkspaceGateway, project: JSONObject,
    members: List<JSONObject>, onClose: () -> Unit, onTask: (String) -> Unit, onChanged: () -> Unit) {
    val projectId = project.getString("id")
    val copy = sharedPlanningCopy()
    val language = LocalGenesisLanguage.current
    val context = LocalContext.current
    fun t(source: String) = translateGenesisText(context, source, language)
    val number = remember(language) { NumberFormat.getNumberInstance(Locale.forLanguageTag(language)).apply { maximumFractionDigits = 2 } }
    val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    val scope = rememberCoroutineScope()
    var bucket by rememberSaveable(projectId) { mutableStateOf("backlog") }
    var data by remember(projectId) { mutableStateOf<JSONObject?>(null) }
    var page by remember(projectId, bucket) { mutableStateOf<JSONObject?>(null) }
    var error by remember(projectId, bucket) { mutableStateOf("") }
    var busy by remember(projectId) { mutableStateOf(false) }
    var loading by remember(projectId, bucket) { mutableStateOf(true) }
    var reload by remember { mutableIntStateOf(0) }
    var queue by remember(projectId) { mutableStateOf(emptyList<JSONObject>()) }
    var selected by remember(projectId, bucket) { mutableStateOf<JSONObject?>(null) }
    var needsRebase by remember(projectId, bucket) { mutableStateOf(false) }
    var destination by rememberSaveable(projectId, bucket) { mutableStateOf("") }
    var notice by remember(projectId) { mutableStateOf("") }
    var accessLost by remember(projectId) { mutableStateOf(false) }
    var reportSprint by remember(projectId, LocalGenesisUserId.current) { mutableStateOf<String?>(null) }
    val accountKey = LocalGenesisUserId.current
    val currentChanged by rememberUpdatedState(onChanged)
    val editor = remember(controller, projectId, accountKey) { SharedPlanningEditorState(controller, projectId,
        onLost = { accessLost = true; data = null; page = null; selected = null }, onSaved = { receipt ->
            receipt.optJSONObject("sprint")?.let { bucket = if (it.optString("state") == "completed") "backlog" else it.getString("id") }
            selected = null; notice = ""; reload++; currentChanged()
        }, onRefreshed = { fresh -> data = validatePlanning(projectId, fresh) }) }
    val authorPreferences by produceState<UiPreferences?>(null, accountKey) {
        val application = context.applicationContext as? GenesisApplication
        value = if (application != null) LocalPreferences(context, application.workspaceScope).values.first() else UiPreferences()
    }
    LaunchedEffect(projectId, data != null, accessLost) {
        if (accessLost) editor.hide() else if (data != null) editor.load()
    }
    LaunchedEffect(editor.inputVersion) {
        delay(150)
        if (editor.editable && !editor.saved) editor.persist()
    }
    fun leave(action: () -> Unit) {
        if (editor.busy) return
        if (!editor.active || editor.phase != "editing" || editor.saved) action()
        else scope.launch { if (editor.persist()) action() }
    }
    val currentBucket by rememberUpdatedState(bucket)
    val currentData by rememberUpdatedState(data)
    val selectedBucket = planningRows(data?.optJSONArray("sprints")).find { it.optString("id") == bucket }
    val readOnly = data?.optBoolean("offlineCache") == true || page?.optBoolean("offlineCache") == true
    val planningEnabled = data?.optJSONObject("config")?.optBoolean("enabled") == true
    val permissions = data?.optJSONObject("context")?.optJSONObject("permissions")
    val canAssign = data?.optJSONObject("config")?.optBoolean("enabled") == true && !readOnly && !editor.busy && !editor.pending &&
        permissions?.optBoolean("editTasks") == true && permissions.optBoolean("organizeTasks") && selectedBucket?.optString("state") != "completed"

    LaunchedEffect(projectId, bucket, reload, lifecycle.isAtLeast(Lifecycle.State.STARTED)) {
        if (!lifecycle.isAtLeast(Lifecycle.State.STARTED)) return@LaunchedEffect
        loading = page == null
        while (isActive) {
            if (!busy && !editor.busy) try {
                val fresh = validatePlanning(projectId, controller.sharedPlanning(projectId))
                val next = controller.querySharedTasks(planningTaskFilter(projectId, bucket))
                currentCoroutineContext().ensureActive()
                val first = mergePlanningPage(projectId, null, next, false)
                // Keep already loaded pages only while the backend confirms the same collection.
                page = page?.takeIf { it.optString("queryVersion") == first.optString("queryVersion") }
                    ?.let { old -> JSONObject(first.toString()).put("tasks", old.getJSONArray("tasks"))
                        .put("nextCursor", old.opt("nextCursor") ?: JSONObject.NULL) } ?: first
                data = fresh; queue = controller.queuedSharedTasks(projectId); error = ""; accessLost = false
                if (bucket != "backlog" && planningRows(fresh.getJSONArray("sprints")).none { it.getString("id") == bucket }) bucket = "backlog"
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                error = if (planningAccessLost(failure)) t("Нет доступа") else t("Не удалось загрузить данные")
                if (planningAccessLost(failure)) { accessLost = true; data = null; page = null; selected = null }
            } finally { loading = false }
            delay(5000)
        }
    }
    fun more() {
        val previous = page ?: return
        val cursor = previous.optString("nextCursor").takeUnless { it.isBlank() || it == "null" } ?: return
        if (busy) return
        val targetBucket = bucket
        busy = true
        scope.launch {
            try {
                val next = controller.querySharedTasks(planningTaskFilter(projectId, targetBucket), cursor)
                if (currentBucket == targetBucket) {
                    require(page?.optString("queryVersion") == previous.optString("queryVersion")) { "SHARED_QUERY_CHANGED" }
                    page = mergePlanningPage(projectId, previous, next, true)
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                if (currentBucket == targetBucket) {
                    error = if (failure.message == "SHARED_QUERY_CHANGED") copy.getString("conflict") else t("Не удалось загрузить данные")
                    if (planningAccessLost(failure)) { accessLost = true; data = null; page = null; selected = null }
                }
            } finally { busy = false }
        }
    }
    fun assign() {
        val task = selected ?: return
        if (currentData == null) return
        if (busy || !canAssign) return
        val targetBucket = bucket
        busy = true; error = ""; notice = ""
        scope.launch {
            try {
                // Recheck the current permission/sprint snapshot before creating a command.
                val fresh = validatePlanning(projectId, controller.sharedPlanning(projectId))
                data = fresh
                val freshTask = controller.sharedTask(projectId, task.getString("id"))
                require(!freshTask.optBoolean("offlineCache")) { "PLANNING_PERMISSION_CHANGED" }
                require(freshTask.getJSONObject("task").getInt("revision") == task.getInt("revision")) { "SHARED_QUERY_CHANGED" }
                val pending = controller.queuedSharedTasks(projectId).any { it.optString("taskId") == task.getString("id") }
                val patch = planningAssignment(fresh, projectId, task, destination.takeUnless { it == "backlog" }, pending)
                currentCoroutineContext().ensureActive()
                require(currentBucket == targetBucket) { "PLANNING_PERMISSION_CHANGED" }
                val result = controller.updateSharedTask(projectId, task.getString("id"), patch).getJSONObject("task")
                queue = controller.queuedSharedTasks(projectId)
                notice = if (result.optBoolean("pending")) t("Изменение сохранено на устройстве и синхронизируется после подключения.") else copy.getString("saved")
                selected = null; busy = false; reload++; onChanged()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                val conflict = failure.message == "SHARED_QUERY_CHANGED" || failure is AuthFailure && failure.kind == AuthFailure.Kind.CONFLICT
                if (conflict) needsRebase = true
                error = copy.getString(when (if (conflict) "SHARED_QUERY_CHANGED" else failure.message) {
                    "SHARED_QUERY_CHANGED" -> "conflict"
                    "PLANNING_PERMISSION_CHANGED" -> "movePermissionChanged"
                    "PLANNING_TASK_DESTINATION" -> "taskDraftDestination"
                    "PLANNING_TASK_UNAVAILABLE" -> "taskDraftUnavailable"
                    "SPRINT_COMPLETED" -> "closed"
                    else -> "error"
                })
                if (planningAccessLost(failure)) { accessLost = true; data = null; page = null; selected = null; error = t("Нет доступа") }
            } finally { busy = false }
        }
    }
    fun refreshPlanning() {
        if (busy) return
        val task = selected
        if (task == null) { reload++; return }
        val targetBucket = bucket
        busy = true
        scope.launch {
            try {
                val fresh = validatePlanning(projectId, controller.sharedPlanning(projectId))
                val result = controller.sharedTask(projectId, task.getString("id"))
                require(!fresh.optBoolean("offlineCache") && !result.optBoolean("offlineCache")) { "PLANNING_PERMISSION_CHANGED" }
                currentCoroutineContext().ensureActive()
                if (currentBucket == targetBucket) {
                    data = fresh; selected = result.getJSONObject("task"); needsRebase = false; error = ""; accessLost = false; busy = false; reload++
                }
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) {
                error = if (planningAccessLost(failure)) t("Нет доступа") else copy.getString("conflict")
                if (planningAccessLost(failure)) { accessLost = true; data = null; page = null; selected = null }
            } finally { busy = false }
        }
    }
    @Composable fun Navigation(modifier: Modifier) {
        Column(modifier, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            var expanded by remember { mutableStateOf(false) }
            Box {
                OutlinedButton(onClick = { expanded = true }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("planning-bucket")) {
                    UntranslatedText(selectedBucket?.optString("title") ?: copy.getString("backlog"), Modifier.weight(1f))
                    AffairsActionIcon(AffairsAction.EXPAND)
                }
                DropdownMenu(expanded, { expanded = false }) {
                    DropdownMenuItem(text = { UntranslatedText(copy.getString("backlog")) },
                        modifier = Modifier.testTag("planning-select-backlog"), onClick = { bucket = "backlog"; selected = null; expanded = false })
                    planningRows(data?.optJSONArray("sprints")).forEach { sprint ->
                        DropdownMenuItem(text = { Column {
                            UntranslatedText(sprint.getString("title"))
                            UntranslatedText(copy.getString(when (sprint.getString("state")) { "active" -> "active"; "completed" -> "completed"; else -> "planned" }), style = MaterialTheme.typography.bodySmall)
                        } }, modifier = Modifier.testTag("planning-select-${sprint.getString("id")}"),
                            onClick = { bucket = sprint.getString("id"); selected = null; expanded = false })
                    }
                }
            }
            selectedBucket?.let { sprint ->
                Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    UntranslatedText(copy.getString(when (sprint.getString("state")) { "active" -> "active"; "completed" -> "completed"; else -> "planned" }), Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
                    AffairsIconButton(sharedWorkflowCopy("sprint-report-translations.json").getString("heading"), AffairsAction.REPORT,
                        { reportSprint = sprint.getString("id") }, Modifier.testTag("planning-sprint-report"), !busy && !editor.busy && !accessLost)
                }
                Text(planningPeriod(sprint, language), style = MaterialTheme.typography.bodyMedium)
                if (sprint.optString("goal").isNotBlank()) UntranslatedText(sprint.getString("goal"))
            }
            data?.optJSONObject("totals")?.optJSONObject(bucket)?.let { totals -> SharedPlanningTotals(totals, copy, number) }
            data?.optJSONObject("byAssignee")?.optJSONObject(bucket)?.takeIf { it.length() > 0 }?.let { groups ->
                AffairsDisclosure(copy.getString("byAssignee")) {
                    groups.keys().forEach { id ->
                        Column(Modifier.testTag("planning-assignee-$id"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            UntranslatedText(members.find { it.optString("userId") == id }?.optString("displayName") ?: t(if (id == "unassigned") "Не назначен" else "Недоступно"), style = MaterialTheme.typography.titleSmall)
                            SharedPlanningTotals(groups.getJSONObject(id), copy, number)
                        }
                    }
                }
            }
        }
    }
    @Composable fun TaskList(modifier: Modifier, compact: Boolean) {
        val listState = rememberLazyListState()
        LaunchedEffect(editor.notice) { if (editor.notice) { withFrameNanos { }; listState.scrollToItem(0) } }
        LazyColumn(modifier.testTag("planning-tasks"), state = listState, verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (compact && !editor.active && planningEnabled) item { Navigation(Modifier.fillMaxWidth().padding(bottom = 8.dp)) }
            data?.takeUnless { accessLost }?.let { fresh -> item {
                SharedPlanningEditor(editor, fresh, selectedBucket, projectId, authorPreferences, readOnly, scope)
            } }
            if (loading) item { WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("planning-loading")) }
            if (readOnly) item { Text("Нет связи: показана последняя защищённая копия команды.") }
            if (data?.optJSONObject("config")?.optBoolean("enabled") == false && !editor.active) item {
                UntranslatedText(copy.getString("disabled"), style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            if (error.isNotBlank()) item { Column(Modifier.testTag("planning-error")) {
                UntranslatedText(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = ::refreshPlanning, enabled = !busy) { Text("Обновить") }
            } }
            if (notice.isNotBlank()) item { UntranslatedText(notice, Modifier.testTag("planning-notice")) }
            if (editor.completion && editor.phase == "editing" && data != null) {
                items(editor.tasks, key = { "completion-" + it.getString("id") }) { task ->
                    SharedPlanningCompletionRow(editor, requireNotNull(data), task) { leave { onTask(task.getString("id")) } }
                }
                item { SharedPlanningCompletionSubmit(editor, requireNotNull(data), projectId, readOnly, scope) }
            }
            if (!editor.active && planningEnabled) {
            items(planningRows(page?.optJSONArray("tasks")), key = { it.getString("id") }) { task ->
                val pending = queue.any { it.optString("taskId") == task.getString("id") }
                val completed = task.optString("completedAt").let { it.isNotBlank() && it != "null" }
                val metadata = listOf("storyPoints" to "points", "estimateHours" to "hours").map { (key, unit) ->
                        copy.getString(unit) + ": " + if (task.isNull(key)) copy.getString("unestimated") else number.format(task.getDouble(key))
                    } + listOfNotNull(if (completed) t("Завершено") else null, if (pending) t("Ожидает синхронизации") else null)
                AffairsTaskRow(task.getString("title"), completed, { leave { onTask(task.getString("id")) } },
                    Modifier.testTag("planning-task-${task.getString("id")}"), metadata = metadata, enabled = !busy,
                    actions = if (canAssign) ({
                        AffairsIconButton(copy.getString("assignTo"), AffairsAction.MOVE, {
                            selected = task; needsRebase = false; destination = task.optString("sprintId").takeUnless { it.isBlank() || it == "null" } ?: "backlog"
                        }, Modifier.testTag("planning-move-${task.getString("id")}"), enabled = !busy && !pending)
                    }) else null, extra = {
                    if (selected?.optString("id") == task.getString("id")) {
                        Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        val stale = needsRebase || selected?.optInt("revision") != task.optInt("revision")
                        if (stale) UntranslatedText(copy.getString("conflict"), Modifier.testTag("planning-selection-conflict"))
                        var targets by remember { mutableStateOf(false) }
                        Box {
                            OutlinedButton({ targets = true }, enabled = !busy, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("planning-destination")) {
                                UntranslatedText(planningRows(data?.optJSONArray("sprints")).find { it.optString("id") == destination }?.optString("title") ?: copy.getString("backlog"), Modifier.weight(1f))
                                AffairsActionIcon(AffairsAction.EXPAND)
                            }
                            DropdownMenu(targets, { targets = false }) {
                                DropdownMenuItem(text = { UntranslatedText(copy.getString("backlog")) }, onClick = { destination = "backlog"; targets = false })
                                planningRows(data?.optJSONArray("sprints")).filter { it.optString("state") != "completed" }.forEach { sprint ->
                                    DropdownMenuItem(text = { UntranslatedText(sprint.getString("title")) }, modifier = Modifier.testTag("planning-destination-${sprint.getString("id")}"),
                                        onClick = { destination = sprint.getString("id"); targets = false })
                                }
                            }
                        }
                        Row {
                            TextButton(::assign, enabled = !busy && !stale && runCatching { planningAssignment(requireNotNull(data), projectId, task, destination.takeUnless { it == "backlog" }, pending) }.isSuccess,
                                modifier = Modifier.testTag("planning-assign")) { Text("Сохранить") }
                            TextButton({ selected = null }, enabled = !busy) { Text("Отмена") }
                        }
                        }
                    }
                })
            }
            if (!loading && error.isBlank() && page != null && planningRows(page?.optJSONArray("tasks")).isEmpty()) item { Text("Здесь пока нет задач", Modifier.testTag("planning-empty")) }
            item {
                page?.let { UntranslatedText(t("Показано: {loaded} из {total}").replace("{loaded}", number.format(planningRows(it.optJSONArray("tasks")).size)).replace("{total}", number.format(it.optInt("total")))) }
                if (page?.optString("nextCursor")?.let { it.isNotBlank() && it != "null" } == true) TextButton(::more, enabled = !busy, modifier = Modifier.testTag("planning-more")) { Text("Показать ещё") }
            }
            }
        }
    }
    Dialog(onDismissRequest = { leave(onClose) }, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        GenesisModalFrame({ leave(onClose) }) {
            Column(Modifier.fillMaxWidth().testTag("shared-planning-screen")) {
                AffairsDialogHeader(copy.getString("heading"), if (accessLost) "" else project.getString("title"),
                    onClose = { leave(onClose) }, onBack = { leave(onClose) }, enabled = !editor.busy, closeTag = "planning-close", actions = {
                        AffairsIconButton("Обновить", AffairsAction.REFRESH, ::refreshPlanning,
                            Modifier.testTag("planning-refresh"), enabled = !busy && !editor.busy)
                    })
                HorizontalDivider()
                BoxWithConstraints(Modifier.weight(1f, fill = false).fillMaxWidth().padding(12.dp)) {
                    if (maxWidth >= 720.dp && !editor.active && planningEnabled) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        Navigation(Modifier.width(248.dp).verticalScroll(rememberScrollState()))
                        TaskList(Modifier.weight(1f), false)
                    } else TaskList(Modifier.fillMaxWidth(), true)
                }
            }
        }
    }
    if (!accessLost) reportSprint?.let { id ->
        SharedSprintReportScreen(controller, projectId, id, data?.optJSONObject("config")?.optString("estimateUnit") ?: "points",
            onClose = { reportSprint = null }, onLost = { accessLost = true; data = null; page = null; selected = null; error = t("Нет доступа"); editor.hide(); reportSprint = null })
    }
}

@Composable private fun SharedPlanningTotals(totals: JSONObject, copy: JSONObject, number: NumberFormat) {
    Column(Modifier.fillMaxWidth().testTag("planning-totals"), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        UntranslatedText(copy.getString("count") + ": " + number.format(totals.getInt("count")), style = MaterialTheme.typography.titleSmall)
        for (unit in listOf("points", "hours")) {
            val values = totals.getJSONObject(unit)
            UntranslatedText(copy.getString(unit) + ": " + number.format(values.getDouble("value")) + " · " + copy.getString("unestimated") + ": " + number.format(values.getInt("unestimated")), style = MaterialTheme.typography.bodyMedium)
        }
    }
}

internal fun planningPeriod(sprint: JSONObject, language: String): String {
    val context = sprint.getJSONObject("calendarContext")
    val calendar = GenesisCalendar(ZoneId.of(context.getString("timeZone")), context.getInt("version"), context.getString("gregorianYearStart"))
    val mode = CalendarMode.fromWire(sprint.getString("calendarMode"))
    fun label(raw: String): String {
        val date = LocalDate.parse(raw)
        val civil = date.format(DateTimeFormatter.ofLocalizedDate(FormatStyle.MEDIUM).withLocale(Locale.forLanguageTag(language)))
        return if (mode == CalendarMode.PROFANE) civil else calendar.formatDate(date, mode) + " · " + civil
    }
    return label(sprint.getString("startDate")) + " — " + label(sprint.getString("endDate"))
}
