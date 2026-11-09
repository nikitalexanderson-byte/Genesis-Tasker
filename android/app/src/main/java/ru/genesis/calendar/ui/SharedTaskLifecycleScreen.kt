package ru.genesis.calendar.ui

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.*

@Composable
internal fun SharedTaskLifecycleScreen(gateway: SharedTaskLifecycleGateway, space: String, projects: List<JSONObject>,
    onClose: () -> Unit, onChanged: suspend () -> Unit, onOpen: (String, String) -> Unit,
    onWorkflow: (String) -> Unit = {}, page: String = "archive") {
    val tab = page
    var search by rememberSaveable(space) { mutableStateOf("") }
    var rows by remember(space) { mutableStateOf(emptyList<JSONObject>()) }
    var cursor by remember(space) { mutableStateOf<String?>(null) }
    var loaded by remember(space) { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf<Pair<String, JSONObject>?>(null) }
    var retention by rememberSaveable { mutableStateOf("30") }
    val scope = rememberCoroutineScope()
    val identity = remember(space) { SharedTaskCommandIdentity() }
    BackHandler(enabled = confirmation == null && !busy, onBack = onClose)
    suspend fun load(more: Boolean = false) {
        val target = tab; val query = search
        val response = if (target == "trash") gateway.sharedTaskTrash(space)
            else gateway.sharedTaskArchive(space, query, if (more) cursor else null)
        val next = if (target == "trash") SharedTaskLifecycleProtocol.rows(response) else {
            val source = response.getJSONArray("tasks")
            require(response.opt("hasMore") is Boolean && response.getInt("total") >= source.length())
            (0 until source.length()).map { source.getJSONObject(it).also(SharedTaskLifecycleProtocol::task) }
        }
        if (tab != target || search != query) return
        rows = if (more) (rows + next).distinctBy { it.getString("id") } else next
        cursor = response.optString("nextCursor").takeIf { target == "archive" && response.optBoolean("hasMore") && it.isNotBlank() && it != "null" }
        loaded = true
    }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        busy = true; error = ""
        scope.launch { try { action() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = sharedTaskLifecycleError(failure.message) }
            finally { busy = false } }
    }
    LaunchedEffect(space, tab, search) {
        loaded = false; rows = emptyList(); cursor = null; error = ""
        try { load() } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { error = sharedTaskLifecycleError(failure.message) }
    }
    val title = if (tab == "trash") "Корзина" else "Архив задач"
    val headerInShell = WorkspaceScreenHeader(title, "Общие дела", navigation = {
        WorkspaceHeaderButton("Назад", "lifecycle-back", enabled = !busy, onClick = onClose) { AffairsActionIcon(AffairsAction.BACK) }
    })
    Column(Modifier.fillMaxSize().padding(AffairsLayout.gutter).testTag("shared-task-lifecycle"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!headerInShell) AffairsPageHeader(title, "Общие дела", onBack = onClose)
        if (tab == "archive") Row(Modifier.fillMaxWidth().height(IntrinsicSize.Min), verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            AffairsSearchField(search, { search = it.take(200) }, "Поиск задач",
                Modifier.weight(1f).testTag("lifecycle-search"), labelAsPlaceholder = true)
            AffairsIconButton("Обновить", AffairsAction.REFRESH, { run { load() } }, enabled = !busy,
                modifier = Modifier.fillMaxHeight().testTag("lifecycle-refresh"))
        }
        Text(if (tab == "trash") "Удалённые задачи и проекты можно восстановить до окончания срока хранения. Максимальный срок — 30 дней."
            else "Архив скрывает задачу и её подзадачи из активных списков. Завершение и сроки не меняются.",
            style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("lifecycle-error"))
        if (!loaded && error.isBlank()) WorkspaceLoadingLine(Modifier.fillMaxWidth())
        LazyColumn(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (loaded && rows.isEmpty()) item { Text(if (tab == "trash") "Корзина пуста." else "Архив задач пуст.") }
            items(rows, key = { (it.optString("kind") + ":" + it.getString("id")) }) { item ->
                Surface(shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        UntranslatedText(item.getString("title"), style = MaterialTheme.typography.titleMedium)
                        if (tab == "trash") {
                            Text((if (item.getString("kind") == "task") "Задача" else "Проект") + " · " + item.getString("expiresAt"), style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(enabled = !busy && item.getBoolean("canRestore"), onClick = { run {
                                    val id = identity.forBody(JSONObject().put("action", "restore").put("item", item))
                                    gateway.sharedTrashRestore(space, item.getString("kind"), item.getString("id"), SharedTaskLifecycleProtocol.restore(item, id)); load(); onChanged()
                                } }) { Text("Восстановить") }
                                if (item.getBoolean("canRestore")) AffairsIconButton("Изменить срок хранения", AffairsAction.SETTINGS,
                                    { retention = item.getInt("retentionDays").toString(); confirmation = "retention" to item }, enabled = !busy, outlined = false)
                                if (item.optBoolean("canPurge") && item.getString("kind") == "task") AffairsIconButton("Удалить навсегда", AffairsAction.DELETE,
                                    { confirmation = "purge" to item }, enabled = !busy, contentColor = MaterialTheme.colorScheme.error, outlined = false)
                            }
                            if (item.optBoolean("canManageWorkflow") && item.optString("projectId").isNotBlank()) TextButton(onClick = { onWorkflow(item.getString("projectId")) }) { Text("Проверить состояние проекта") }
                        } else {
                            UntranslatedText(item.optString("projectTitle"), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            item.optString("description").takeIf { it.isNotBlank() }?.let { UntranslatedText(it, style = MaterialTheme.typography.bodyMedium) }
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                TextButton(onClick = { onOpen(item.getString("projectId"), item.getString("id")) }, enabled = !busy) { Text("Открыть") }
                                if (projects.any { it.optString("id") == item.optString("projectId") && it.optBoolean("canOrganizeTasks") }) {
                                    TextButton(enabled = !busy, onClick = { run {
                                        val id = identity.forBody(JSONObject().put("action", "unarchive").put("task", item))
                                        gateway.sharedTaskArchiveCommand(item.getString("projectId"), item.getString("id"), SharedTaskLifecycleProtocol.archive(item, false, id)); load(); onChanged()
                                    } }) { Text("Восстановить") }
                                    AffairsIconButton("В корзину", AffairsAction.DELETE, { retention = "30"; confirmation = "trash" to item }, enabled = !busy)
                                }
                            }
                        }
                    }
                }
            }
            if (cursor != null) item { OutlinedButton(onClick = { run { load(true) } }, enabled = !busy, modifier = Modifier.fillMaxWidth()) { Text("Загрузить ещё") } }
        }
    }
    confirmation?.let { (kind, item) ->
        val days = retention.toIntOrNull()
        AlertDialog(onDismissRequest = { if (!busy) confirmation = null }, title = { Text(when (kind) { "purge" -> "Удалить навсегда?"; "retention" -> "Срок хранения"; else -> "Переместить в корзину?" }) },
            text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                UntranslatedText(item.getString("title"))
                Text(if (kind == "purge") "Задача, её подзадачи, комментарии и вложения будут удалены навсегда. Это действие нельзя отменить."
                    else "Подзадачи перемещаются вместе с родителем. Ранее удалённые подзадачи сохраняют свой срок хранения.")
                if (kind != "purge") OutlinedTextField(retention, { retention = it.take(2) }, label = { Text("Срок хранения, дней: 1–30") }, isError = days == null || days !in 1..30, singleLine = true)
            } }, confirmButton = { TextButton(enabled = !busy && (kind == "purge" || (days != null && days in 1..30)), onClick = { run {
                val id = identity.forBody(JSONObject().put("action", kind).put("item", item).put("days", days))
                when (kind) {
                    "purge" -> gateway.sharedTrashPurge(space, item.getString("id"), SharedTaskLifecycleProtocol.purge(item, id, true))
                    "retention" -> gateway.sharedTrashRestore(space, item.getString("kind"), item.getString("id"), SharedTaskLifecycleProtocol.restore(item, id, days!!))
                    else -> gateway.sharedTaskTrashCommand(item.getString("projectId"), item.getString("id"), SharedTaskLifecycleProtocol.trash(item, days!!, id))
                }
                confirmation = null; load(); onChanged()
            } }) { Text(if (kind == "purge") "Удалить навсегда" else "Подтвердить") } },
            dismissButton = { TextButton(onClick = { confirmation = null }, enabled = !busy) { Text("Отмена") } })
    }
}

@Composable
internal fun SharedTaskLifecycleActionDialog(gateway: SharedTaskLifecycleGateway, action: String, task: JSONObject,
    onClose: () -> Unit, onChanged: suspend () -> Unit) {
    var retention by rememberSaveable(task.getString("id")) { mutableStateOf("30") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()
    val identity = remember { SharedTaskCommandIdentity() }
    val days = retention.toIntOrNull()
    AlertDialog(onDismissRequest = { if (!busy) onClose() }, title = { Text(if (action == "archive") "Архивировать задачу?" else "Переместить в корзину?") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            UntranslatedText(task.getString("title"))
            Text(if (action == "archive") "Задача и её подзадачи исчезнут из активных списков. Завершение и сроки не изменятся."
                else "Подзадачи перемещаются вместе с родителем. До окончания срока хранения их можно восстановить. Затем они будут удалены автоматически.")
            if (action != "archive") OutlinedTextField(retention, { retention = it.take(2) }, singleLine = true,
                label = { Text("Срок хранения, дней: 1–30") }, isError = days == null || days !in 1..30)
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
        } }, confirmButton = { TextButton(enabled = !busy && (action == "archive" || (days != null && days in 1..30)), onClick = {
            busy = true; error = ""
            scope.launch { try {
                val request = identity.forBody(JSONObject().put("action", action).put("task", task).put("days", days))
                if (action == "archive") gateway.sharedTaskArchiveCommand(task.getString("projectId"), task.getString("id"), SharedTaskLifecycleProtocol.archive(task, true, request))
                else gateway.sharedTaskTrashCommand(task.getString("projectId"), task.getString("id"), SharedTaskLifecycleProtocol.trash(task, days!!, request))
                onChanged(); onClose()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { error = sharedTaskLifecycleError(failure.message) } finally { busy = false } }
        }) { Text(if (action == "archive") "В архив" else "В корзину") } },
        dismissButton = { TextButton(enabled = !busy, onClick = onClose) { Text("Отмена") } })
}

internal fun sharedTaskLifecycleError(code: String?): String = when (code) {
    "RESTORE_PARENT_FIRST" -> "Сначала восстановите родительскую задачу или проект."
    "SHARED_TASK_CONFLICT", "SHARED_TRASH_CONFLICT", "TRASH_CONFLICT" -> "Объект изменился. Обновите список и повторите действие."
    "SHARED_PROJECT_FORBIDDEN", "AUTH_REQUIRED", "SHARED_PROJECT_NOT_FOUND" -> "Доступ изменился. Обновите список."
    else -> "Действие не выполнено. Обновите данные и повторите после подключения."
}
