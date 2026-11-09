package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch
import kotlinx.coroutines.CoroutineScope
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.PlanningLifecycle
import ru.genesis.calendar.auth.DataExportProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarContext
import ru.genesis.calendar.domain.CalendarMode
import java.time.LocalDate
import java.time.ZoneId

@Composable private fun planningDraftCopy(): JSONObject {
    val context = LocalContext.current; val language = LocalGenesisLanguage.current
    val all = remember(context) { context.assets.open("originals/i18n/workflow-draft-translations.json").bufferedReader(Charsets.UTF_8).use { JSONObject(it.readText()) } }
    return remember(all, language) { all.optJSONObject(language) ?: all.getJSONObject("ru") }
}

internal fun newPlanningSprint(preferences: UiPreferences): JSONObject {
    val from = LocalDate.now()
    return JSONObject().put("kind", "sprint").put("sprintId", JSONObject.NULL).put("expectedRevision", 0)
        .put("draft", JSONObject().put("title", "").put("goal", "").put("startDate", from.toString()).put("endDate", from.plusDays(13).toString())
            .put("calendarMode", preferences.input.wireValue).put("calendarContext", JSONObject().put("version", 2)
                .put("timeZone", DataExportProtocol.timeZone(ZoneId.systemDefault().id)?.id ?: "UTC")
                .put("gregorianYearStart", if (preferences.gregorianYearStartsInMarch) "march" else "january")))
}
private fun sprintEdit(sprint: JSONObject) = JSONObject().put("kind", "sprint").put("sprintId", sprint.getString("id"))
    .put("expectedRevision", sprint.getInt("revision")).put("draft", JSONObject().apply {
        for (key in listOf("title", "goal", "startDate", "endDate", "calendarMode", "calendarContext")) put(key, sprint.get(key))
    })
private fun startEdit(sprint: JSONObject, data: JSONObject) = JSONObject().put("kind", "transition").put("action", "start")
    .put("sprintId", sprint.getString("id")).put("expectedRevision", sprint.getInt("revision")).put("fingerprint", data.getString("fingerprint"))
    .put("tasks", JSONArray()).put("choices", JSONObject())

/** One inline form uses the main list's scrolling and the existing calendar picker. */
@OptIn(ExperimentalLayoutApi::class)
@Composable internal fun SharedPlanningEditor(state: SharedPlanningEditorState, data: JSONObject, selected: JSONObject?,
    projectId: String, preferences: UiPreferences?, readOnly: Boolean, scope: CoroutineScope) {
    val copy = sharedPlanningCopy(); val draftCopy = planningDraftCopy()
    val rights = data.getJSONObject("context").getJSONObject("permissions")
    val manage = rights.optBoolean("manageProjects"); val organize = rights.optBoolean("organizeTasks")
    val available = !readOnly && !state.busy && state.ready && !state.lost
    val kind = (state.edit ?: state.record?.optJSONObject("edit"))?.optString("kind")
    val permitted = if (kind == "settings") manage else organize
    val enabled = data.getJSONObject("config").getBoolean("enabled")
    val sprints = planningRows(data.getJSONArray("sprints")); val noActive = sprints.none { it.getString("state") == "active" }
    val controls = available && state.record == null && !state.active
    val authorModes = LocalEnabledCalendars.current
    val sacredEnabled = LocalSacredFeaturesEnabled.current
    val form = state.edit
    val canSubmit = available && permitted && state.active && !state.conflicted && state.phase == "editing" && form != null &&
        (!state.completion || state.tasksVerified) && runCatching { PlanningLifecycle.verify(form, data, projectId, false, if (state.completion) state.tasks else null) }.isSuccess
    Column(Modifier.widthIn(max = AffairsLayout.formMaxWidth).fillMaxWidth().testTag("planning-lifecycle"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if ((manage || organize) && !state.active && state.record == null) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (manage) OutlinedButton({
                scope.launch { state.start(JSONObject().put("kind", "settings").put("expectedRevision", data.getJSONObject("config").getInt("revision"))
                    .put("enabled", enabled).put("estimateUnit", data.getJSONObject("config").getString("estimateUnit"))) }
            }, Modifier.heightIn(min = 48.dp).testTag("planning-settings"), enabled = controls) {
                AffairsActionIcon(AffairsAction.SETTINGS); Spacer(Modifier.width(8.dp)); Text("Настройки")
            }
            if (organize && enabled) {
                Button({
                    val pref = preferences ?: return@Button
                    val mode = if (!sacredEnabled) CalendarMode.PROFANE else pref.input.takeIf { it in authorModes } ?: authorModes.firstOrNull() ?: CalendarMode.PROFANE
                    scope.launch { state.start(newPlanningSprint(pref.copy(input = mode))) }
                }, Modifier.heightIn(min = 48.dp).testTag("planning-new-sprint"), enabled = controls && preferences != null) {
                    AffairsActionIcon(AffairsAction.ADD); Spacer(Modifier.width(8.dp)); UntranslatedText(copy.getString("newSprint"))
                }
                if (selected != null && selected.optString("state") != "completed") AffairsIconButton("Редактировать", AffairsAction.EDIT,
                    { scope.launch { state.start(sprintEdit(selected)) } }, Modifier.testTag("planning-edit-sprint"), controls && enabled && selected.has("revision"))
                if (selected?.optString("state") == "planning") Button({ scope.launch { state.start(startEdit(selected, data)); state.submit() } },
                    Modifier.heightIn(min = 48.dp).testTag("planning-start-sprint"), enabled = controls && enabled && noActive && selected.has("revision") && data.has("fingerprint")) {
                    UntranslatedText(copy.getString("startSprint"))
                }
                if (selected?.optString("state") == "active") Button({ scope.launch { state.complete(selected.getString("id")) } },
                    Modifier.heightIn(min = 48.dp).testTag("planning-complete-sprint"), enabled = controls && enabled) {
                    UntranslatedText(copy.getString("finishSprint"))
                }
            }
        }
        if (!noActive && selected?.optString("state") == "planning") UntranslatedText(copy.getString("activeExists"), style = MaterialTheme.typography.bodySmall)
        if (state.notice) UntranslatedText(copy.getString("saved"), Modifier.testTag("planning-lifecycle-saved"))
        if (state.error.isNotBlank()) {
            val message = when (state.error) {
                "PLANNING_DRAFT_INVALID", "PLANNING_DRAFT_SCOPE" -> copy.getString("deviceInvalid")
                "PLANNING_DRAFT_CHANGED" -> draftCopy.getString("changed")
                "PLANNING_DRAFT_LIMIT" -> draftCopy.getString("limit")
                "PLANNING_DRAFT_STORAGE" -> draftCopy.getString("error")
                "PLANNING_LOCAL_QUEUE" -> copy.getString("localQueue")
                "PLANNING_CONFLICT", "CONFLICT", "SHARED_QUERY_CHANGED" -> copy.getString("conflict")
                "PLANNING_ACTIVE_SPRINT" -> copy.getString("activeExists")
                "SPRINT_COMPLETED" -> copy.getString("closed")
                "SPRINT_DATES_INVALID" -> copy.getString("datesInvalid")
                "SPRINT_CONTEXT_INVALID" -> copy.getString("contextInvalid")
                "SPRINT_STATE_INVALID" -> copy.getString("stateInvalid")
                "SPRINT_OUTCOMES_REQUIRED" -> copy.getString("outcomesRequired")
                else -> copy.getString("error")
            }
            UntranslatedText(message, Modifier.testTag("planning-lifecycle-error"), color = MaterialTheme.colorScheme.error)
            if (!state.ready) TextButton({ scope.launch { state.load() } }, enabled = !state.busy) { Text("Обновить") }
            if (state.active && state.phase == "editing" && state.error == "PLANNING_DRAFT_STORAGE") TextButton({ scope.launch { state.persist() } }, enabled = !state.busy) { Text("Повторить") }
            if (state.error == "PLANNING_DRAFT_CHANGED") TextButton({ scope.launch { state.versions() } }, enabled = !state.busy,
                modifier = Modifier.testTag("planning-list-versions")) { UntranslatedText(copy.getString("draftVersions")) }
        }
        if ((!state.active || state.error == "PLANNING_DRAFT_LIMIT") && state.copies.isNotEmpty()) {
            Text(copy.getString("draftVersions"), style = MaterialTheme.typography.titleSmall)
            UntranslatedText(copy.getString("draftVersionsHint"), style = MaterialTheme.typography.bodySmall)
            state.copies.forEach { version ->
                val edit = version.getJSONObject("edit")
                val allowed = if (edit.getString("kind") == "settings") manage else organize
                val title = if (edit.getString("kind") == "sprint") edit.getJSONObject("draft").getString("title").ifBlank { copy.getString("newSprint") }
                    else if (edit.getString("kind") == "settings") genesisTranslate("Настройки") else copy.getString(if (edit.getString("action") == "start") "startSprint" else "finishSprint")
                Row(Modifier.fillMaxWidth().testTag("planning-version-${version.getString("id")}"), verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Column(Modifier.weight(1f)) {
                        UntranslatedText(title, style = MaterialTheme.typography.bodyLarge)
                        if (edit.getString("kind") == "sprint" && edit.getJSONObject("draft").optString("goal").isNotBlank())
                            UntranslatedText(edit.getJSONObject("draft").getString("goal"), maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                        UntranslatedText(java.text.DateFormat.getDateTimeInstance(java.text.DateFormat.SHORT, java.text.DateFormat.SHORT,
                            java.util.Locale.forLanguageTag(LocalGenesisLanguage.current)).format(java.util.Date(version.getLong("savedAt"))), style = MaterialTheme.typography.bodySmall)
                    }
                    AffairsIconButton(copy.getString("useDraftVersion"), AffairsAction.EDIT, { scope.launch { state.useCopy(version) } },
                        Modifier.testTag("planning-use-version-${version.getString("id")}"), enabled = allowed && !state.active && !state.busy && state.phase !in setOf("pending", "received"))
                    AffairsIconButton(draftCopy.getString("discard"), AffairsAction.DELETE, { scope.launch { state.removeCopy(version) } },
                        Modifier.testTag("planning-remove-version-${version.getString("id")}"), enabled = !state.busy)
                }
            }
        }
        if (state.record != null && !state.active) {
            UntranslatedText(draftCopy.getString("heading"), style = MaterialTheme.typography.titleSmall)
            val storedEdit = state.record!!.getJSONObject("edit")
            if (permitted && storedEdit.getString("kind") == "sprint") {
                UntranslatedText(storedEdit.getJSONObject("draft").getString("title"), style = MaterialTheme.typography.bodyLarge)
                UntranslatedText(storedEdit.getJSONObject("draft").getString("goal"), maxLines = 2, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
            }
            if (permitted || state.phase == "received") TextButton(state::restore, enabled = !state.busy, modifier = Modifier.testTag("planning-restore-draft")) {
                UntranslatedText(draftCopy.getString("restore"))
            } else Text("Нет доступа")
            if (!state.pending) TextButton({ scope.launch { state.discard() } }, enabled = !state.busy, modifier = Modifier.testTag("planning-discard-draft")) {
                UntranslatedText(draftCopy.getString("discard"))
            }
        }
        if (state.active && (!permitted && state.phase != "received")) Text("Нет доступа")
        else if (state.active) {
            if (state.conflicted && state.saved) UntranslatedText(copy.getString("draftConflictSaved"), Modifier.testTag("planning-conflict-copy-saved"))
            if (state.phase == "pending") {
                UntranslatedText(draftCopy.getString("pending"), Modifier.testTag("planning-pending-command"))
                Button({ scope.launch { state.retry() } }, Modifier.heightIn(min = 48.dp).testTag("planning-retry-command"), enabled = available && permitted) { Text("Повторить") }
                if (state.record?.optInt("attempts") == 0) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton({ scope.launch { state.rebase() } }, enabled = available && permitted, modifier = Modifier.testTag("planning-rebase-unsent")) { Text("Обновить") }
                    TextButton({ scope.launch { state.discard() } }, enabled = !state.busy, modifier = Modifier.testTag("planning-cancel-unsent")) { Text("Отмена") }
                }
            } else if (state.phase == "received") {
                UntranslatedText(copy.getString("saved"))
                Button({ scope.launch { state.retry() } }, Modifier.heightIn(min = 48.dp).testTag("planning-acknowledge"), enabled = !state.busy) { Text("Готово") }
            } else {
                if (readOnly) UntranslatedText(copy.getString("deviceCached"))
                if (state.phase == "rejected") UntranslatedText(copy.getString("conflict"))
                val editable = state.editable && permitted
                when (form?.optString("kind")) {
                    "settings" -> {
                        Text("Настройки", style = MaterialTheme.typography.titleMedium)
                        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                            UntranslatedText(copy.getString("enable"), Modifier.weight(1f))
                            Switch(form.getBoolean("enabled"), { state.changeSetting("enabled", it) },
                                enabled = editable && (noActive || !form.getBoolean("enabled")), modifier = Modifier.testTag("planning-enabled"))
                        }
                        if (!noActive) UntranslatedText(copy.getString("activeExists"), style = MaterialTheme.typography.bodySmall)
                        UntranslatedText(copy.getString("unit"), style = MaterialTheme.typography.titleSmall)
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            for (unit in listOf("points", "hours")) FilterChip(form.getString("estimateUnit") == unit,
                                { state.changeSetting("estimateUnit", unit) }, enabled = editable,
                                modifier = Modifier.heightIn(min = 48.dp).testTag("planning-unit-$unit"), label = { UntranslatedText(copy.getString(unit)) })
                        }
                        UntranslatedText(copy.getString("independent"), style = MaterialTheme.typography.bodySmall)
                    }
                    "sprint" -> SharedSprintForm(form, editable, state::changeSprintField)
                    "transition" -> {
                        if (form.getString("action") == "complete") {
                            UntranslatedText(copy.getString("remaining") + ": " + form.getJSONArray("tasks").length(), style = MaterialTheme.typography.titleMedium)
                            UntranslatedText(copy.getString("chooseOutcome"))
                            if (!state.tasksVerified) UntranslatedText(copy.getString("deviceTasksHidden"))
                            if (state.tasksVerified && form.getJSONArray("tasks").length() > 0) PlanningTarget(copy.getString("chooseAll"), "", sprints, form.getString("sprintId"), editable,
                                Modifier.testTag("planning-all-destinations")) { target ->
                                state.chooseOutcome(target)
                            }
                        } else UntranslatedText(copy.getString("startSprint"), style = MaterialTheme.typography.titleMedium)
                    }
                }
                if (state.saved) UntranslatedText(draftCopy.getString("saved"), Modifier.testTag("planning-device-saved"), style = MaterialTheme.typography.bodySmall)
                else UntranslatedText(draftCopy.getString("saving"), style = MaterialTheme.typography.bodySmall)
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    TextButton({ scope.launch { state.discard() } }, enabled = !state.busy,
                        modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("planning-cancel-editor")) { Text("Отмена") }
                    if (!state.completion || state.phase != "editing") Button({ scope.launch { state.submit() } },
                        Modifier.weight(1f).heightIn(min = 48.dp).testTag("planning-save-lifecycle"), enabled = canSubmit) {
                        if (form?.optString("kind") == "transition") UntranslatedText(copy.getString("startSprint")) else Text("Сохранить")
                    }
                }
                if (state.record != null && (state.phase == "rejected" || state.error.isNotBlank()))
                    TextButton({ scope.launch { state.rebase() } }, enabled = available && permitted && !state.conflicted,
                        modifier = Modifier.heightIn(min = 48.dp).testTag("planning-rebase-draft")) { UntranslatedText(copy.getString("refreshDraft")) }
            }
        }
        if (state.busy) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("planning-lifecycle-busy"))
    }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable private fun SharedSprintForm(edit: JSONObject, enabled: Boolean, onChange: (String, Any) -> Unit) {
    val copy = sharedPlanningCopy(); val draft = edit.getJSONObject("draft")
    fun field(key: String, value: Any) { onChange(key, value) }
    Text(if (edit.isNull("sprintId")) copy.getString("newSprint") else genesisTranslate("Редактировать"), style = MaterialTheme.typography.titleMedium)
    OutlinedTextField(draft.getString("title"), { if (it.codePointCount(0, it.length) <= 160) field("title", it) },
        label = { Text("Название") }, modifier = Modifier.fillMaxWidth().testTag("planning-sprint-title"), enabled = enabled,
        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next), singleLine = false, maxLines = 3)
    OutlinedTextField(draft.getString("goal"), { if (it.codePointCount(0, it.length) <= 5000) field("goal", it) },
        label = { UntranslatedText(copy.getString("goal")) }, modifier = Modifier.fillMaxWidth().testTag("planning-sprint-goal"), enabled = enabled, minLines = 2, maxLines = 6)
    Text("Календарь ввода", style = MaterialTheme.typography.titleSmall)
    val modes = if (LocalSacredFeaturesEnabled.current) LocalEnabledCalendars.current else setOf(CalendarMode.PROFANE)
    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        for (mode in CalendarMode.entries.filter { it in modes }) FilterChip(draft.getString("calendarMode") == mode.wireValue,
            { field("calendarMode", mode.wireValue) }, enabled = enabled, modifier = Modifier.heightIn(min = 48.dp).testTag("planning-input-${mode.wireValue}"),
            label = { Text(when (mode) { CalendarMode.PROFANE -> "Григорианский"; CalendarMode.SACRED -> "Сакральный"; CalendarMode.LUNAR -> "Лунный" }) })
    }
    val saved = draft.getJSONObject("calendarContext")
    val context = CalendarContext(saved.getInt("version"), saved.getString("timeZone"), saved.getString("gregorianYearStart"))
    val mode = CalendarMode.fromWire(draft.getString("calendarMode"))
    for ((key, tag) in listOf("startDate" to "planning-start-date", "endDate" to "planning-end-date")) {
        UntranslatedText(copy.getString(key), style = MaterialTheme.typography.titleSmall)
        val raw = draft.getString(key)
        val parsed = runCatching { LocalDate.parse(raw) }.getOrNull()
        if (parsed == null) UntranslatedText(copy.getString("datesInvalid"), color = MaterialTheme.colorScheme.error)
        Box(Modifier.testTag(tag)) { AuthorDatePicker((parsed ?: LocalDate.now()).toString(), mode, calculationContext = context, enabled = enabled) { field(key, it) } }
    }
}

@Composable private fun PlanningTarget(label: String, selected: String, sprints: List<JSONObject>, source: String,
    enabled: Boolean, modifier: Modifier = Modifier, onChange: (String) -> Unit) {
    val copy = sharedPlanningCopy(); var open by remember { mutableStateOf(false) }
    val title = when (selected) { "backlog" -> copy.getString("backlog"); "" -> label; else -> sprints.find { it.getString("id") == selected }?.getString("title") ?: label }
    Box(modifier.fillMaxWidth()) {
        OutlinedButton({ open = true }, enabled = enabled, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
            UntranslatedText(title, Modifier.weight(1f)); AffairsActionIcon(AffairsAction.EXPAND)
        }
        DropdownMenu(open, { open = false }) {
            DropdownMenuItem(text = { UntranslatedText(copy.getString("backlog")) }, modifier = Modifier.testTag("planning-outcome-backlog"), onClick = { onChange("backlog"); open = false })
            sprints.filter { it.getString("id") != source && it.getString("state") != "completed" }.forEach { sprint ->
                DropdownMenuItem(text = { UntranslatedText(sprint.getString("title")) }, modifier = Modifier.testTag("planning-outcome-${sprint.getString("id")}"),
                    onClick = { onChange(sprint.getString("id")); open = false })
            }
        }
    }
}

@Composable internal fun SharedPlanningCompletionRow(state: SharedPlanningEditorState, data: JSONObject, task: JSONObject, onOpen: () -> Unit) {
    val edit = state.edit ?: return; val copy = sharedPlanningCopy(); val id = task.getString("id")
    AffairsTaskRow(task.getString("title"), false, onOpen, Modifier.testTag("planning-outcome-task-$id"), extra = {
        PlanningTarget(copy.getString("assignTo"), edit.getJSONObject("choices").optString(id), planningRows(data.getJSONArray("sprints")), edit.getString("sprintId"),
            state.editable && data.getJSONObject("context").getJSONObject("permissions").optBoolean("organizeTasks"), Modifier.padding(8.dp).testTag("planning-outcome-choice-$id")) {
            state.chooseOutcome(it, id)
        }
    })
}

@Composable internal fun SharedPlanningCompletionSubmit(state: SharedPlanningEditorState, data: JSONObject, projectId: String, readOnly: Boolean, scope: CoroutineScope) {
    val copy = sharedPlanningCopy(); val edit = state.edit ?: return
    val canSubmit = !readOnly && state.editable && !state.conflicted && state.tasksVerified &&
        runCatching { PlanningLifecycle.verify(edit, data, projectId, false, state.tasks) }.isSuccess
    Button({ scope.launch { state.submit() } }, Modifier.widthIn(max = AffairsLayout.formMaxWidth).fillMaxWidth().heightIn(min = 48.dp).testTag("planning-finish-completion"), enabled = canSubmit) {
        UntranslatedText(copy.getString("finishSprint"))
    }
}
