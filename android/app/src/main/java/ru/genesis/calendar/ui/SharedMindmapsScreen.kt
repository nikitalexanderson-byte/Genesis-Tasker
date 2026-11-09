package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*

internal class SharedMindmapTaskRequest(val mapId: String, val nodeId: String, val title: String, val projectId: String)

/** Shared tasks stay in the shared gateway; LocalTask is only the map renderer's read model. */
@Composable
internal fun SharedMindmapsScreen(gateway: SharedWorkspaceGateway, space: String, preferredProject: String?, preferences: UiPreferences,
    onClose: () -> Unit, onTask: (String, String) -> Unit, onProject: (String) -> Unit, onConvert: (SharedMindmapTaskRequest) -> Unit) {
    val app = LocalContext.current.applicationContext as GenesisApplication
    val uid = LocalGenesisUserId.current
    val scope = rememberCoroutineScope()
    var ready by remember(gateway, uid, space) { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var retry by remember { mutableIntStateOf(0) }
    var currentSpace by remember { mutableStateOf<JSONObject?>(null) }
    var projects by remember { mutableStateOf(emptyList<JSONObject>()) }
    var authorizedMaps by remember(uid, space) { mutableStateOf(emptySet<String>()) }
    val dataExchangeAccess by rememberUpdatedState(LocalFeatureAccess.current)
    val cacheScope = remember(uid, space, app.workspaceScope) { SharedMindmapProtocol.scope(app.workspaceScope, space) }
    val repository = remember(gateway, uid, space, cacheScope) {
        MindmapRepository(app.database, cacheScope, SharedMindmapProtocol.uid(uid, space), SharedMindmapTransport(gateway, uid, space, onAccessLost = {
            ready = false; error = "Доступ к пространству изменился. Обновите общие дела."
        }, onAuthorizedMaps = { authorizedMaps = it }), dataExchangeAccess = { dataExchangeAccess })
    }
    val journal = remember(cacheScope) { SharedMindmapConversionJournal(app.database, cacheScope) }
    val records by repository.records.collectAsState()
    var journalRows by remember { mutableStateOf(emptyList<JSONObject>()) }
    var resolved by remember { mutableStateOf(emptyList<JSONObject>()) }
    var referenceIds by remember { mutableStateOf(emptySet<String>()) }
    var search by rememberSaveable(space) { mutableStateOf<String?>(null) }
    var searchRows by remember { mutableStateOf(emptyList<JSONObject>()) }
    var cursor by remember { mutableStateOf<String?>(null) }
    var searchBusy by remember { mutableStateOf(false) }
    var actionBusy by remember { mutableStateOf(false) }
    val attemptedReceipts = remember(space) { mutableSetOf<String>() }
    val readOnly = currentSpace?.let { if (it.has("permissions")) it.getJSONObject("permissions").optBoolean("editTasks")
        else it.optString("role") != "guest" } != true
    fun rows(page: JSONObject): List<JSONObject> {
        val source = page.getJSONArray("tasks"); require(source.length() <= 100 && page.opt("hasMore") is Boolean && page.optString("queryVersion").isNotBlank())
        return (0 until source.length()).map { source.getJSONObject(it).also { task ->
            require(projects.any { project -> project.optString("id") == task.optString("projectId") }) { "SHARED_PROJECT_FORBIDDEN" }
        } }
    }
    fun run(action: suspend () -> Unit) {
        if (actionBusy) return
        actionBusy = true; error = ""; message = ""
        scope.launch { try { action() } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: Exception) { if (sharedMindmapAccessLost(failure)) { ready = false; resolved = emptyList(); searchRows = emptyList() }
                error = "Изменение не выполнено. Проверьте доступ и повторите после подключения." }
            finally { actionBusy = false } }
    }
    suspend fun loadSearch(more: Boolean) {
        val query = search ?: return
        val page = gateway.sortedSharedTasks(JSONObject().put("spaceId", space).put("q", query), if (more) cursor else null, "title")
        val next = rows(page)
        if (search != query) return
        searchRows = if (more) (searchRows + next).distinctBy { it.getString("id") } else next
        cursor = page.optString("nextCursor").takeIf { page.getBoolean("hasMore") && it.isNotBlank() && it != "null" }
    }
    LaunchedEffect(gateway, uid, space, retry) {
        ready = false; error = ""; resolved = emptyList(); searchRows = emptyList()
        try {
            gateway.checkSharedMindmapAccount(uid)
            val spacesResponse = gateway.sharedSpaces(); require(!spacesResponse.optBoolean("offlineCache"))
            val spaces = spacesResponse.getJSONArray("spaces")
            currentSpace = (0 until spaces.length()).map { spaces.getJSONObject(it) }.firstOrNull { it.getString("id") == space }
                ?: throw IllegalStateException("SHARED_SPACE_FORBIDDEN")
            val projectResponse = gateway.sharedProjects(space); require(!projectResponse.optBoolean("offlineCache"))
            val accessible = projectResponse.getJSONArray("projects")
            projects = (0 until accessible.length()).map { accessible.getJSONObject(it) }
            repository.loadCached(); repository.refresh(); journalRows = journal.entries(); ready = true
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { if (sharedMindmapAccessLost(failure) || currentSpace == null) ready = false
            error = "Не удалось обновить общие карты. Проверьте подключение и доступ к пространству." }
    }
    LaunchedEffect(referenceIds, ready, retry) {
        if (!ready) return@LaunchedEffect
        if (referenceIds.isEmpty()) { resolved = emptyList(); return@LaunchedEffect }
        val result = mutableListOf<JSONObject>()
        try {
            referenceIds.toList().chunked(100).forEach { batch ->
                var next: String? = null
                do {
                    val page = gateway.sortedSharedTasks(JSONObject().put("spaceId", space).put("ids", JSONArray(batch)), next, "title")
                    val found = rows(page); require(found.all { it.getString("id") in batch }); result += found
                    require(result.size <= referenceIds.size)
                    next = page.optString("nextCursor").takeIf { page.getBoolean("hasMore") && it.isNotBlank() && it != "null" }
                } while (next != null)
            }
            resolved = result.distinctBy { it.getString("id") }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) { resolved = emptyList(); if (sharedMindmapAccessLost(failure)) ready = false
            error = "Не удалось разрешить связанные задачи. Недоступные названия скрыты." }
    }
    LaunchedEffect(search, ready) {
        if (search == null || !ready) return@LaunchedEffect
        searchRows = emptyList(); cursor = null; searchBusy = true
        try { delay(250); loadSearch(false) } catch (cancelled: CancellationException) { throw cancelled }
        catch (_: Exception) { error = "Поиск общих задач не завершён. Повторите после подключения." }
        finally { searchBusy = false }
    }
    LaunchedEffect(ready, journalRows.toString(), records) {
        if (!ready || readOnly) return@LaunchedEffect
        journalRows.filter { it.optString("taskId").isNotBlank() }.forEach { receipt ->
            val key = receipt.getString("mapId") + ":" + receipt.getString("nodeId") + ":" + receipt.getString("taskId")
            val record = records.firstOrNull { it.document.id == receipt.getString("mapId") } ?: return@forEach
            val node = record.document.nodes.firstOrNull { it.id == receipt.getString("nodeId") } ?: return@forEach
            if (!attemptedReceipts.add(key)) return@forEach
            try {
                when {
                    node.kind == "task" && node.refId == receipt.getString("taskId") -> if (record.unsynced) repository.retry(record.document.id)
                    node.kind == "idea" -> repository.save(record.document.copy(nodes = record.document.nodes.map {
                        if (it.id == node.id) it.copy(kind = "task", refId = receipt.getString("taskId"), text = "") else it
                    }))
                    else -> throw IllegalStateException("MAP_REVISION_CONFLICT")
                }
                journal.clear(record.document.id, node.id); journalRows = journal.entries()
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (_: Exception) { error = "Задача создана. Связь с картой сохранена в черновике; повторите синхронизацию карты." }
        }
    }
    if (!ready) {
        val hosted = WorkspaceScreenHeader("Общие майндмепы", "Общие дела", showThemeToggle = false,
            navigation = { WorkspaceHeaderButton(genesisTranslate("Назад"), "shared-mindmaps-back", onClick = onClose) {
                AffairsActionIcon(AffairsAction.BACK)
            } })
        Column(Modifier.fillMaxSize().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            if (!hosted) AffairsPageHeader("Общие майндмепы", "Общие дела", onBack = onClose)
            if (error.isBlank()) AffairsLoading(Modifier.weight(1f)) else {
                Text(error, color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { retry++ }) { Text("Обновить") }
            }
        }
        return
    }
    val allTasks = (resolved + searchRows).distinctBy { it.getString("id") }
    val mappedTasks = allTasks.map { task -> LocalTask(id = task.getString("id"), title = task.getString("title"), description = task.optString("description"),
        date = task.optString("dueDate").takeUnless { it == "null" }.orEmpty(), time = task.optString("startTime").takeUnless { it == "null" }.orEmpty(),
        priority = task.optInt("priority"), done = task.optString("completedAt").let { it.isNotBlank() && it != "null" }, projectId = task.getString("projectId"),
        project = projects.firstOrNull { it.getString("id") == task.getString("projectId") }?.optString("title").orEmpty(), sourceFieldsJson = task.toString()) }
    val mappedProjects = projects.filter { it.optInt("isInbox") == 0 }.mapIndexed { index, project -> GenesisProject(project.getString("id"),
        project.optString("parentId").takeIf { it.isNotBlank() && it != "null" }, null, project.getString("title"), project.optString("description"), emptyList(), "active", index) }
    Column(Modifier.fillMaxSize().testTag("shared-mindmaps-screen")) {
        if (error.isNotBlank()) Text(error, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.error)
        if (message.isNotBlank()) Text(message, Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.primary)
        journalRows.filter { it.optString("taskId").isBlank() }.forEach { entry ->
            TextButton(enabled = !readOnly && !actionBusy, onClick = { run {
                val fields = JSONObject(entry.getJSONObject("fields").toString()).put("mindmapSource", JSONObject().put("mapId", entry.getString("mapId")).put("nodeId", entry.getString("nodeId")))
                val task = gateway.createSharedTask(entry.getString("projectId"), fields).getJSONObject("task")
                if (!task.optBoolean("pending")) { journal.acknowledge(entry.getString("mapId"), entry.getString("nodeId"), task); journalRows = journal.entries() }
                else message = "Преобразование сохранено на устройстве и ожидает подключения."
            } }) { Text("Завершить преобразование мысли в задачу") }
        }
        Box(Modifier.weight(1f)) {
            MindmapsScreen(repository, mappedTasks, mappedProjects, null, onClose,
                onTask = { task, _ -> onTask(requireNotNull(task.projectId), task.id) }, onCreate = {},
                onComplete = { task, _ -> run {
                    val snapshot = gateway.sharedProject(requireNotNull(task.projectId)); val project = snapshot.getJSONObject("project")
                    require(sharedTaskCanEdit(project)) { "SHARED_PROJECT_FORBIDDEN" }
                    val current = gateway.sharedTask(project.getString("id"), task.id).getJSONObject("task")
                    if (!task.done && current.optBoolean("approvalRequired")) gateway.sharedTaskApprove(project.getString("id"), task.id)
                    else {
                        val source = snapshot.getJSONArray("statuses"); val status = (0 until source.length()).map { source.getJSONObject(it) }.firstOrNull { (it.optInt("isDone") == 1) != task.done }
                            ?: throw IllegalStateException("SHARED_STATUS_NOT_FOUND")
                        gateway.updateSharedTask(project.getString("id"), task.id, JSONObject().put("statusId", status.getString("id")).put("expectedRevision", current.getLong("revision")))
                    }
                    retry++
                } }, onProject = onProject, readOnly = readOnly, workspaceTitle = currentSpace?.optString("title").orEmpty(),
                taskCanEdit = { task -> projects.firstOrNull { it.optString("id") == task.projectId }?.let(::sharedTaskCanEdit) == true },
                onConvertIdea = { map, node, title ->
                    val destination = listOfNotNull(map.projectId, preferredProject).firstOrNull { id -> projects.any { it.getString("id") == id && sharedTaskCanEdit(it) } }
                        ?: projects.firstOrNull { sharedTaskCanEdit(it) }?.getString("id")
                    if (destination == null) error = "Нет проекта с правом создания задач."
                    else onConvert(SharedMindmapTaskRequest(map.id, node.id, title, destination))
                }, mapVisible = { map -> map.id in authorizedMaps || if (map.projectId == null) currentSpace?.optString("role") in setOf("owner", "admin")
                    else projects.any { it.optString("id") == map.projectId } },
                newMapProjectId = preferredProject?.takeIf { id -> mappedProjects.any { it.id == id } }
                    ?: projects.firstOrNull { sharedTaskCanEdit(it) && it.optInt("isInbox") == 0 }?.getString("id"),
                backLabel = "К общим делам", onTaskSearch = { search = it }, onResolveTaskIds = { referenceIds = it }, taskPickerFooter = {
                    if (searchBusy || actionBusy) WorkspaceLoadingLine(Modifier.fillMaxWidth())
                    if (cursor != null) OutlinedButton(onClick = { run { loadSearch(true) } }, enabled = !actionBusy) { Text("Загрузить ещё") }
                })
        }
    }
}
