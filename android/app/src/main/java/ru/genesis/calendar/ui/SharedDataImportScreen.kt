package ru.genesis.calendar.ui

import android.net.Uri
import android.provider.OpenableColumns
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.*
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.FlowPreview
import kotlinx.coroutines.flow.debounce
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.collect
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.DataExportProtocol
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import java.io.IOException
import java.io.InputStream
import java.time.ZoneId

internal data class DataImportPickedSource(val name: String, val open: () -> InputStream)
internal typealias DataImportPicker = ((DataImportPickedSource?) -> Unit) -> Unit

@Composable internal fun SharedDataImportScreen(controller: SharedWorkspaceGateway, spaceId: String, projectId: String,
    projectTitle: String, canWrite: Boolean, canCreate: Boolean, onClose: () -> Unit, onChanged: () -> Unit,
    onOpenProject: (String) -> Unit, picker: DataImportPicker? = null) {
    key(LocalGenesisUserId.current, spaceId, projectId) {
        val context = LocalContext.current
        val preferences by produceState<UiPreferences?>(null) {
            val app = context.applicationContext as? GenesisApplication
            value = if (app != null) LocalPreferences(context, app.workspaceScope).values.first() else UiPreferences()
        }
        val settings = preferences
        if (settings == null) Dialog(onClose) { Surface { Column(Modifier.padding(16.dp)) { EditorDialogHeader("Загрузка…", "loading-close", onClose); WorkspaceLoadingIndicator() } } }
        else DataImportContent(controller, spaceId, projectId, projectTitle, canWrite, canCreate, settings, onClose, onChanged, onOpenProject, picker)
    }
}

@OptIn(FlowPreview::class)
@Composable private fun DataImportContent(controller: SharedWorkspaceGateway, space: String, project: String, title: String,
    canWrite: Boolean, canCreate: Boolean, preferences: UiPreferences, onClose: () -> Unit, onChanged: () -> Unit,
    onOpenProject: (String) -> Unit, picker: DataImportPicker?) {
    val context = LocalContext.current; val scope = rememberCoroutineScope(); val account = LocalGenesisUserId.current
    val calendars = if (LocalSacredFeaturesEnabled.current) LocalEnabledCalendars.current else setOf(CalendarMode.PROFANE)
    val mode = preferences.input.takeIf { it in calendars } ?: calendars.firstOrNull() ?: CalendarMode.PROFANE
    val zone = DataExportProtocol.timeZone(ZoneId.systemDefault().id)?.id ?: "UTC"
    val importTitle = genesisTranslate("Импорт"); val openTitle = genesisTranslate("К выполнению"); val doneTitle = genesisTranslate("Готово")
    val state = remember(controller, account, space, project) { DataImportState(controller, account, space, project,
        importInitialSelection(space, project.takeIf { !canCreate }, importTitle, openTitle, doneTitle, mode.wireValue, zone, preferences.gregorianYearStartsInMarch)) }
    DisposableEffect(state) { onDispose { state.close() } }
    var historyOpen by rememberSaveable { mutableStateOf(false) }
    var pendingPicker by rememberSaveable { mutableStateOf<String?>(null) }
    var closeWarning by remember { mutableStateOf(false) }
    var undoCandidate by remember { mutableStateOf<JSONObject?>(null) }
    var clearWarning by remember { mutableStateOf(false) }
    val locked = state.busy || pendingPicker != null
    fun close() { if (state.dirty) closeWarning = true else { state.close(); onClose() } }
    fun picked(value: DataImportPickedSource?) {
        val parameters = pendingPicker ?: return
        if (value == null) { pendingPicker = null; return }
        scope.launch { try { state.choose(parameters, value.name, value.open) } finally { pendingPicker = null } }
    }
    val nativePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri: Uri? ->
        if (uri == null) picked(null) else {
            val parameters = pendingPicker
            scope.launch {
                try {
                    val name = withContext(Dispatchers.IO) {
                        context.contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
                            if (cursor.moveToFirst()) cursor.getString(0) else null
                        } ?: "import"
                    }
                    if (parameters != null) state.choose(parameters, name) { context.contentResolver.openInputStream(uri) ?: throw IOException() }
                } catch (cancelled: CancellationException) { throw cancelled }
                catch (_: Exception) { state.pickerFailed() }
                finally { pendingPicker = null }
            }
        }
    }
    fun chooseFile() { scope.launch {
        val parameters = state.pickerParameters() ?: return@launch
        pendingPicker = parameters
        try { if (picker == null) nativePicker.launch(arrayOf("*/*")) else picker(::picked) }
        catch (_: Exception) { pendingPicker = null; state.pickerFailed() }
    } }
    LaunchedEffect(state) { state.load() }
    LaunchedEffect(state, historyOpen, state.loaded) { if (historyOpen && state.loaded && !state.historyLoaded) state.refreshHistory() }
    LaunchedEffect(state) { snapshotFlow { state.revision }.drop(1).debounce(500).collect { if (state.dirty && state.phase == "editing") state.save() } }
    LaunchedEffect(state.receipt?.optString("importId"), state.receipt?.optString("state")) { if (state.receipt != null) onChanged() }
    Dialog(onDismissRequest = ::close, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        BoxWithConstraints(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
            Surface(Modifier.widthIn(max = AffairsLayout.formMaxWidth).fillMaxWidth().padding(16.dp).heightIn(max = maxHeight * .94f).imePadding(), shape = AffairsLayout.shape) {
                Column(Modifier.testTag("data-import-screen")) {
                    AffairsDialogHeader(if (historyOpen) "История импорта" else "Импорт данных", title, ::close,
                        closeTag = "import-close", titleTag = "import-heading") {
                        AffairsIconButton(if (historyOpen) "Импорт данных" else "История импорта", if (historyOpen) AffairsAction.IMPORT else AffairsAction.HISTORY,
                            { historyOpen = !historyOpen }, Modifier.testTag("import-history-toggle"), enabled = !locked)
                    }
                    HorizontalDivider()
                    Column(Modifier.weight(1f, fill = false).fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 16.dp).testTag("import-content"),
                        verticalArrangement = Arrangement.spacedBy(16.dp)) {
                        if (!state.loaded) WorkspaceLoadingText()
                        else if (historyOpen) ImportHistory(state, { undoCandidate = it }, onOpenProject = { id -> state.close(); onClose(); onOpenProject(id) })
                        else {
                            ImportMainForm(state, canWrite, canCreate, calendars, !locked, ::chooseFile)
                            state.preview?.let { preview -> ImportPreview(preview, state.previewCurrent, !locked) }
                            state.receipt?.let { receipt -> ImportReceipt(receipt, !locked, { undoCandidate = receipt }, { state.close(); onClose(); onOpenProject(receipt.getString("rootProjectId")) }) }
                            if (state.record != null) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                                AffairsIconButton("Сохранить версию", AffairsAction.ADD, { scope.launch { state.saveCopy() } }, enabled = !locked)
                                if (state.phase != "pending" || state.record?.optInt("attempts") == 0) AffairsIconButton("Новый импорт", AffairsAction.DELETE,
                                    { clearWarning = true }, Modifier.testTag("import-clear"), enabled = !locked)
                            }
                            if (state.copies.isNotEmpty()) ImportCopies(state, !locked)
                        }
                        Spacer(Modifier.height(8.dp))
                    }
                    HorizontalDivider()
                    Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (locked) { WorkspaceLoadingLine(Modifier.fillMaxWidth()); Text(if (pendingPicker != null) "Выберите файл." else "Выполнение…", Modifier.testTag("import-working"), style = MaterialTheme.typography.bodyMedium) }
                        if (state.error.isNotBlank()) Text(importErrorText(state.error), Modifier.testTag("import-error").semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                        if (state.message.isNotBlank()) Text(state.message, Modifier.testTag("import-message").semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.bodyMedium)
                        if (!historyOpen && state.previewCurrent && state.preview?.optBoolean("canApply") == false) {
                            state.preview?.getJSONArray("blockers")?.optJSONObject(0)?.let { issue -> Text(importIssueText(issue.getString("code")),
                                Modifier.testTag("import-blocked").semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium) }
                        }
                        if (!historyOpen && state.phase == "pending") Text("Результат отправки пока не подтверждён. Повторите ту же команду.", Modifier.testTag("import-pending"), style = MaterialTheme.typography.bodyMedium)
                        if (!historyOpen && state.receipt != null) {
                            Text(if (state.receipt?.optString("state") == "undone") "Импорт отменён." else "Импорт применён. Проверьте отчёт о переносе.", Modifier.testTag("import-received").semantics { liveRegion = LiveRegionMode.Polite }, style = MaterialTheme.typography.titleSmall)
                            ImportCounts(requireNotNull(state.receipt))
                        }
                        if (historyOpen) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                            AffairsIconButton("Обновить", AffairsAction.REFRESH, { scope.launch { state.refreshHistory() } }, Modifier.testTag("import-history-refresh"), enabled = !locked)
                        } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            val action = when { !state.loaded -> "Повторить"; state.error == "PLANNING_DRAFT_CHANGED" -> "Сохранить версию"; state.phase == "pending" -> "Повторить отправку"; state.phase == "received" -> "Новый импорт"; state.previewCurrent && state.preview?.optBoolean("canApply") == true -> "Применить импорт"; else -> "Обновить предпросмотр" }
                            Button({ scope.launch { when {
                                !state.loaded -> state.load()
                                state.error == "PLANNING_DRAFT_CHANGED" -> { state.saveCopy(); if (state.error.isEmpty()) state.load() }
                                state.phase == "pending" -> state.retry()
                                state.phase == "received" -> state.clear()
                                state.previewCurrent && state.preview?.optBoolean("canApply") == true -> state.apply()
                                else -> state.inspect()
                            } } }, enabled = !locked && (!state.loaded || state.record != null) && (canWrite || canCreate || state.phase in setOf("pending", "received") || !state.loaded),
                                modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("import-primary")) { Text(action) }
                            if (state.record != null && state.phase in setOf("editing", "rejected")) AffairsIconButton("Обновить предпросмотр", AffairsAction.REFRESH,
                                { scope.launch { state.inspect() } }, Modifier.testTag("import-inspect"), enabled = !locked)
                        }
                    }
                }
            }
        }
    }
    if (undoCandidate != null) AlertDialog(onDismissRequest = { undoCandidate = null }, title = { Text("Отменить импорт") },
        text = { Text("Отменить импорт? Проверка не позволит удалить последующие изменения.") },
        confirmButton = { TextButton({ val receipt = undoCandidate; undoCandidate = null; if (receipt != null) scope.launch { state.undo(receipt) } }) { Text("Подтвердить отмену") } },
        dismissButton = { TextButton({ undoCandidate = null }) { Text("Отмена") } })
    if (clearWarning) AlertDialog(onDismissRequest = { clearWarning = false }, title = { Text("Новый импорт") }, text = { Text("Текущие настройки сохранятся в отдельной версии.") },
        confirmButton = { TextButton({ clearWarning = false; scope.launch { state.clear() } }) { Text("Продолжить") } }, dismissButton = { TextButton({ clearWarning = false }) { Text("Отмена") } })
    if (closeWarning) AlertDialog(onDismissRequest = { closeWarning = false }, title = { Text("Есть несохранённые изменения.") }, text = { Text("Закрыть без сохранения?") },
        confirmButton = { TextButton({ state.close(); onClose() }) { Text("Закрыть") } }, dismissButton = { TextButton({ closeWarning = false }) { Text("Продолжить редактирование") } })
}

internal fun importInitialSelection(space: String, project: String?, title: String, openTitle: String, doneTitle: String,
    mode: String, zone: String, march: Boolean) = JSONObject().put("format", "json").put("spaceId", space).put("projectId", project ?: JSONObject.NULL).put("parentProjectId", JSONObject.NULL)
    .put("parse", JSONObject().put("title", title).put("openTitle", openTitle).put("doneTitle", doneTitle).put("calendarMode", mode)
        .put("calendarContext", JSONObject().put("version", 2).put("timeZone", zone).put("gregorianYearStart", if (march) "march" else "january"))
        .put("delimiter", ",").put("dateFormat", "iso").put("columns", JSONObject()).put("customColumns", JSONArray()).put("doneStatusKeys", JSONArray()))
    .put("memberMap", JSONObject()).put("statusMap", JSONObject()).put("labelMap", JSONObject()).put("fieldMap", JSONObject()).put("optionMap", JSONObject()).put("fieldDefaults", JSONObject())
