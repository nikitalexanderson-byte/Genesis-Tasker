package ru.genesis.calendar.ui

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.DialogWindowProvider
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import java.text.NumberFormat
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

@Composable internal fun SharedProjectAccessScreen(gateway: SharedWorkspaceGateway, space: String, onClose: () -> Unit, onLost: () -> Unit, onSaved: () -> Unit) {
    key(gateway, LocalGenesisUserId.current, space) { ProjectAccessContent(gateway, space, onClose, onLost, onSaved) }
}

@Composable private fun ProjectAccessContent(gateway: SharedWorkspaceGateway, space: String, onClose: () -> Unit, onLost: () -> Unit, onSaved: () -> Unit) {
    val scope = rememberCoroutineScope(); val context = LocalContext.current
    val drafts = sharedWorkflowCopy("workflow-draft-translations.json"); val planning = sharedPlanningCopy()
    val lifecycle = LocalLifecycleOwner.current.lifecycle.currentStateAsState().value
    var directory by remember { mutableStateOf<JSONObject?>(null) }; var directoryBusy by remember { mutableStateOf(false) }; var directoryError by remember { mutableStateOf("") }
    var user by rememberSaveable { mutableStateOf("") }; var editing by remember { mutableStateOf(true) }; var discard by remember { mutableStateOf(false) }
    val lost by rememberUpdatedState(onLost); val saved by rememberUpdatedState(onSaved)
    val editor = if (user.isBlank()) null else remember(gateway, space, user) { ProjectAccessEditorState(gateway, space, user,
        { directory = null; directoryError = "UNAUTHORIZED"; lost() }, { saved() }) }
    val currentEditor by rememberUpdatedState(editor)
    suspend fun loadDirectory() {
        if (directoryBusy) return
        directoryBusy = true; directoryError = ""
        try {
            val next = gateway.sharedProjectAccessMembers(space)
            directory = next
            val members = importRows(next.getJSONArray("members"))
            if (user.isBlank()) user = (members.firstOrNull { it.getString("role") in setOf("member", "guest") } ?: members.firstOrNull())?.getString("userId") ?: ""
            else if (members.none { it.getString("userId") == user }) { directory = null; directoryError = "UNAUTHORIZED"; lost() }
        } catch (reason: Exception) {
            if (reason is CancellationException) { directory = null; throw reason }
            directory = null; currentEditor?.offline()
            directoryError = when (reason) { is AuthFailure -> sharedFailureCode(reason); is AuthApiError -> reason.code; else -> reason.message ?: "INVALID_PROJECT_ACCESS" }
            if (directoryError in setOf("UNAUTHORIZED", "NOT_DEPLOYED", "PROJECT_ACCESS_PERMISSION_CHANGED")) lost()
        } finally { directoryBusy = false }
    }
    fun leave() { if (editor?.busy == true) return; scope.launch { if (editor == null || editor.saved || editor.persist()) onClose() } }
    DisposableEffect(editor) { onDispose { editor?.close() } }
    LaunchedEffect(editor) { editor?.load() }
    LaunchedEffect(editor?.inputVersion) { delay(150); if (editor?.editable == true && !editor.saved) editor.persist() }
    LaunchedEffect(editor?.preview) { editing = editor?.preview == null }
    LaunchedEffect(lifecycle.isAtLeast(Lifecycle.State.STARTED)) {
        if (!lifecycle.isAtLeast(Lifecycle.State.STARTED)) return@LaunchedEffect
        loadDirectory()
        if (currentEditor?.ready == true) currentEditor?.refresh()
        while (isActive) { delay(30000); loadDirectory(); currentEditor?.refresh() }
    }
    DisposableEffect(context) {
        val manager = context.getSystemService(Context.CONNECTIVITY_SERVICE) as? ConnectivityManager
        val callback = object : ConnectivityManager.NetworkCallback() { override fun onLost(network: Network) {
            if (manager?.activeNetwork == null) scope.launch { directory = null; directoryError = "NETWORK"; currentEditor?.offline() }
        } }
        val registered = runCatching { manager?.registerDefaultNetworkCallback(callback); manager != null }.getOrDefault(false)
        onDispose { if (registered) runCatching { manager?.unregisterNetworkCallback(callback) }; Unit }
    }
    Dialog(onDismissRequest = ::leave, properties = DialogProperties(usePlatformDefaultWidth = false, decorFitsSystemWindows = false)) {
        val window = (LocalView.current.parent as? DialogWindowProvider)?.window; val evening = LocalEveningTheme.current
        SideEffect { window?.let { WindowInsetsControllerCompat(it, it.decorView).apply { isAppearanceLightStatusBars = !evening; isAppearanceLightNavigationBars = !evening } } }
        GenesisModalFrame(::leave) {
            Column(Modifier.fillMaxWidth().padding(16.dp).testTag("shared-project-access"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                AffairsPageHeader("Доступ к проектам", directory?.getJSONObject("space")?.getString("title").orEmpty(), contextIsUserContent = true, contextMaxLines = 2, actions = {
                    AffairsIconButton("Обновить список проектов", AffairsAction.REFRESH, { scope.launch { loadDirectory(); if (editor?.ready == true) editor.refresh() else editor?.load() } },
                        Modifier.testTag("access-refresh"), !directoryBusy && editor?.busy != true)
                    AffairsIconButton("Закрыть", AffairsAction.CLOSE, ::leave, Modifier.testTag("access-close"), editor?.busy != true)
                })
                BoxWithConstraints(Modifier.weight(1f, fill = false).fillMaxWidth()) {
                    val wide = maxWidth >= 900.dp
                    @Composable fun Status() {
                        if (directoryError.isNotBlank()) {
                            Text(projectAccessError(directoryError), Modifier.testTag("access-directory-error"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                            if (directoryError !in setOf("UNAUTHORIZED", "NOT_DEPLOYED", "PROJECT_ACCESS_PERMISSION_CHANGED")) OutlinedButton({ scope.launch {
                                loadDirectory(); if (editor?.ready == true) editor.refresh() else editor?.load()
                            } }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("access-reconnect"), enabled = !directoryBusy && editor?.busy != true) { Text("Повторить") }
                        }
                        if (directoryError.isBlank() && editor?.error?.isNotBlank() == true) Text(projectAccessError(editor.error), Modifier.testTag("access-error").semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
                        if (editor?.notice == true) Text("Доступ к проектам сохранён.", Modifier.testTag("access-saved").semantics { liveRegion = LiveRegionMode.Polite }, color = MaterialTheme.colorScheme.primary)
                    }
                    @Composable fun Editor() {
                        val members = directory?.let { importRows(it.getJSONArray("members")) }.orEmpty()
                        if (members.isNotEmpty()) ImportChoice("Участник", user, members.map { it.getString("userId") to it.getString("displayName") }, !directoryBusy && editor?.busy != true,
                            "access-member") { selected -> if (selected != user) scope.launch { if (editor == null || editor.saved || editor.persist()) user = selected } }
                        Status()
                        if (editor != null && directory != null) {
                            if (!editor.restrictedMember && editor.data != null) Text("Ограничения по проектам доступны для участников и гостей.", style = MaterialTheme.typography.bodyMedium)
                            if (editor.record != null && !editor.active) Button({ editor.restore() }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("access-restore"), enabled = !editor.busy) { UntranslatedText(drafts.getString("restore")) }
                            if (editor.active && editor.data != null && editor.restrictedMember) ProjectAccessFields(editor)
                            if (editor.conflicted || editor.active && editor.copies.isNotEmpty()) OutlinedButton({ scope.launch { editor.versions() } }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("access-versions"), enabled = !editor.busy) { UntranslatedText(planning.getString("draftVersions")) }
                            if ((!editor.active || editor.conflicted) && editor.copies.isNotEmpty()) ProjectAccessCopies(editor)
                            if (editor.phase == "rejected") OutlinedButton({ scope.launch { editor.rebase() } }, Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("access-rebase"), enabled = editor.controls) { Text("Обновить предпросмотр") }
                            if (editor.phase in setOf("pending", "received")) UntranslatedText(sharedWorkflowCopy("workflow-draft-translations.json").getString("pending"), Modifier.testTag("access-pending"), style = MaterialTheme.typography.bodyMedium)
                        }
                    }
                    val showPreview = !editing && editor?.preview != null
                    if (wide && showPreview) Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(24.dp)) {
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).testTag("access-rules-scroll"), verticalArrangement = Arrangement.spacedBy(16.dp)) { Editor() }
                        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).testTag("access-preview-scroll"), verticalArrangement = Arrangement.spacedBy(16.dp)) { ProjectAccessPreview(editor) { editing = true } }
                    } else key(showPreview) {
                        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).testTag("access-content"), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                            if (showPreview) {
                                val member = directory?.let { importRows(it.getJSONArray("members")) }?.find { it.getString("userId") == user }
                                member?.let { UntranslatedText(it.getString("displayName"), style = MaterialTheme.typography.titleSmall) }
                                Status(); ProjectAccessPreview(editor) { editing = true }
                            } else Editor()
                            Spacer(Modifier.height(8.dp))
                        }
                    }
                }
                if (directoryBusy || editor?.busy == true) WorkspaceLoadingLine(Modifier.fillMaxWidth().testTag("access-loading"))
                if (editor != null && editor.ready && directory != null && (editor.restrictedMember || editor.phase in setOf("pending", "received"))) Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    when {
                        editor.phase in setOf("pending", "received") -> Button({ scope.launch { editor.retry() } }, Modifier.weight(1f).heightIn(min = 48.dp).testTag("access-retry"), enabled = editor.ready && !editor.busy && !editor.lost) { Text("Повторить") }
                        editor.preview != null && !editing -> Button({ scope.launch { editor.apply() } }, Modifier.weight(1f).heightIn(min = 48.dp).testTag("access-apply"),
                            enabled = editor.editable && editor.saved && editor.preview!!.getJSONArray("blockers").length() == 0) { Text("Применить доступ") }
                        else -> OutlinedButton({ scope.launch { editor.review() } }, Modifier.weight(1f).heightIn(min = 48.dp).testTag("access-review"),
                            enabled = editor.editable && (editor.edit?.getJSONObject("draft")?.getBoolean("allProjects") == true || importRows(editor.edit?.getJSONObject("draft")?.getJSONArray("grants")).all { grant -> importRows(editor.data?.getJSONArray("projects")).any { it.getString("id") == grant.getString("projectId") } })) { Text("Предпросмотр изменений") }
                    }
                    if (editor.record != null && !(editor.phase == "pending" && editor.record!!.getInt("attempts") > 0)) AffairsIconButton(drafts.getString("discard"), AffairsAction.DELETE,
                        { discard = true }, Modifier.testTag("access-discard"), !editor.busy)
                }
            }
        }
    }
    if (discard && editor != null) AlertDialog({ discard = false }, title = { UntranslatedText(drafts.getString("discard") + "?") },
        confirmButton = { TextButton({ discard = false; scope.launch { editor.discard() } }) { Text("Удалить") } }, dismissButton = { TextButton({ discard = false }) { Text("Отмена") } })
}

@Composable private fun ProjectAccessCopies(editor: ProjectAccessEditorState) {
    val scope = rememberCoroutineScope(); val planning = sharedPlanningCopy(); val drafts = sharedWorkflowCopy("workflow-draft-translations.json")
    val language = LocalGenesisLanguage.current; val number = remember(language) { NumberFormat.getIntegerInstance(Locale.forLanguageTag(language)) }
    val date = remember(language) { DateTimeFormatter.ofLocalizedDateTime(FormatStyle.SHORT).withLocale(Locale.forLanguageTag(language)).withZone(ZoneId.systemDefault()) }
    AffairsDisclosure(planning.getString("draftVersions"), Modifier.testTag("access-copy-list")) {
        UntranslatedText(planning.getString("draftVersionsHint"), style = MaterialTheme.typography.bodySmall)
        editor.copies.forEach { value -> Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            val draft = value.getJSONObject("edit").getJSONObject("draft"); val grants = importRows(draft.getJSONArray("grants"))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                UntranslatedText(if (draft.getBoolean("allProjects")) genesisTranslate("Все проекты пространства, включая будущие") else genesisTranslate("Проекты") + ": " + number.format(grants.size), style = MaterialTheme.typography.bodyMedium)
                if (!draft.getBoolean("allProjects")) {
                    val labels = listOf("member" to "Редактирование", "commenter" to "Комментарии", "viewer" to "Просмотр", "none" to "Нет доступа")
                    val counts = labels.mapNotNull { (role, title) -> grants.count { it.getString("role") == role }.takeIf { it > 0 }?.let { genesisTranslate(title) + ": " + number.format(it) } }
                    UntranslatedText(counts.joinToString(" · "), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                UntranslatedText(date.format(Instant.ofEpochMilli(value.getLong("savedAt"))), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
            AffairsIconButton(planning.getString("useDraftVersion"), AffairsAction.EDIT, { scope.launch { editor.useCopy(value) } }, Modifier.testTag("access-use-${value.getString("id")}"), editor.controls && !editor.active && editor.phase !in setOf("pending", "received"))
            AffairsIconButton(drafts.getString("discard"), AffairsAction.DELETE, { scope.launch { editor.removeCopy(value) } }, Modifier.testTag("access-remove-${value.getString("id")}"), !editor.busy)
        } }
    }
}

@Composable internal fun projectAccessError(code: String): String = when (code) {
    "PROJECT_ACCESS_CONFLICT" -> "Права или структура проектов изменились. Обновите предпросмотр; ваш выбор сохранён."
    "PROJECT_ACCESS_REVIEW_REQUIRED" -> "Права или структура проектов изменились. Обновите предпросмотр; ваш выбор сохранён."
    "PROJECT_ACCESS_OPERATION_REUSED" -> "Эта операция уже использована. Обновите предпросмотр и повторите."
    "LAST_OWNER" -> "Сначала передайте владение проектом другому участнику."
    "PROJECT_ACCESS_MANAGER_UNRESTRICTED" -> "Ограничения по проектам доступны для участников и гостей."
    "UNAUTHORIZED", "NOT_DEPLOYED", "PROJECT_ACCESS_PERMISSION_CHANGED" -> "Нет доступа к изменению этих прав. Обновите данные."
    "PLANNING_DRAFT_CHANGED" -> sharedPlanningCopy().getString("draftVersionsHint")
    "PLANNING_DRAFT_STORAGE" -> sharedWorkflowCopy("workflow-draft-translations.json").getString("error")
    "PLANNING_DRAFT_INVALID", "PLANNING_DRAFT_SCOPE" -> sharedPlanningCopy().getString("deviceInvalid")
    "PLANNING_DRAFT_LIMIT" -> sharedWorkflowCopy("workflow-draft-translations.json").getString("limit")
    "PROJECT_ACCESS_LOCAL_QUEUE" -> sharedPlanningCopy().getString("localQueue")
    else -> "Не удалось загрузить или сохранить права. Проверьте соединение и повторите."
}
