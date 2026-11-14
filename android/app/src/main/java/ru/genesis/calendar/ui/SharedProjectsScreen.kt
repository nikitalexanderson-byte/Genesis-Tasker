package ru.genesis.calendar.ui

import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.border
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.gestures.scrollBy
import androidx.compose.foundation.lazy.items
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.ScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.selection.toggleable
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.Saver
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.currentStateAsState
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.SharedWorkspaceGateway
import ru.genesis.calendar.auth.CustomFieldFailure
import ru.genesis.calendar.auth.CustomFieldProtocol
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.SacredCatalog
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale
import kotlin.math.roundToInt

private fun JSONArray.rows(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }

internal fun sharedRoleLabel(role: String, en: Boolean): String = when (role) {
    "owner" -> if (en) "Owner" else "Владелец"
    "manager" -> if (en) "Manager" else "Менеджер"
    "member" -> if (en) "Member" else "Участник"
    "commenter" -> if (en) "Commenter" else "Комментатор"
    "viewer" -> if (en) "Viewer" else "Читатель"
    "admin" -> if (en) "Admin" else "Администратор"
    "guest" -> if (en) "Guest" else "Гость"
    else -> role
}

private fun sharedStatusLabel(title: String, en: Boolean): String = if (!en) title else when (title) {
    "К выполнению" -> "To do"
    "В работе" -> "In progress"
    "Готово" -> "Done"
    else -> title
}

@Composable
internal fun SharedProjectsScreen(controller: SharedWorkspaceGateway, language: String,
    destination: SharedInvitationDestination? = null, preferences: UiPreferences = UiPreferences(),
    onPrivateMessages: ((String) -> Unit)? = null, onProjectChat: ((String) -> Unit)? = null,
    teamActivity: (@Composable () -> Unit)? = null) {
    // Keep Compose's optional-argument mask out of the large workspace method.
    // R8 9.4.14 emits an invalid >255 register reference for that mask in release DEX.
    SharedProjectsContent(controller, language, destination, preferences, onPrivateMessages, onProjectChat, teamActivity)
}

@Composable
private fun SharedProjectsContent(controller: SharedWorkspaceGateway, language: String,
    destination: SharedInvitationDestination?, preferences: UiPreferences, onPrivateMessages: ((String) -> Unit)?,
    onProjectChat: ((String) -> Unit)?, teamActivity: (@Composable () -> Unit)?) {
    val en = language == "en"
    val canExchangeData = LocalFeatureAccess.current.allows("data-export")
    val scope = rememberCoroutineScope()
    val lifecycleState by LocalLifecycleOwner.current.lifecycle.currentStateAsState()
    val pageActive = LocalNavigationPageContext.current?.active != false && lifecycleState.isAtLeast(Lifecycle.State.STARTED)
    var spaces by remember { mutableStateOf(emptyList<JSONObject>()) }
    var ownedProjectQuota by remember { mutableStateOf<JSONObject?>(null) }
    var projectRows by remember { mutableStateOf(emptyList<JSONObject>()) }
    val projectMoves = remember(controller) { mutableStateMapOf<String, JSONObject>() }
    val projects = projectRows.map { actual ->
        projectMoves[actual.optString("id")]?.takeIf { actual.optInt("revision") <= it.optInt("revision") } ?: actual
    }
    var archivedProjects by remember { mutableStateOf(emptyList<JSONObject>()) }
    var snapshot by remember { mutableStateOf<JSONObject?>(null) }
    var googleSettings by remember { mutableStateOf<JSONObject?>(null) }
    var googleMessage by remember { mutableStateOf("") }
    val (taskSort,setTaskSort)=rememberTaskListSort("shared")
    var spaceId by rememberSaveable { mutableStateOf(destination?.spaceId.orEmpty()) }
    var expandedIds by remember { mutableStateOf(emptySet<String>()) }
    var uiReadySpace by remember { mutableStateOf("") }
    val expansionWrites = remember { Mutex() }
    var invitations by remember { mutableStateOf(emptyList<JSONObject>()) }
    var loadingInvitations by remember { mutableStateOf(false) }
    var createKind by remember { mutableStateOf("project") }
    var parentBoardId by remember { mutableStateOf("") }
    var parentProjectSnapshot by remember { mutableStateOf<JSONObject?>(null) }
    var managementPage by remember { mutableStateOf("project") }
    var boardDraft by remember { mutableStateOf<JSONObject?>(null) }
    var boardColor by remember { mutableStateOf("#2d6c68") }
    var boardImage by remember { mutableStateOf("") }
    var pendingImageBoard by remember { mutableStateOf<Pair<String, String>?>(null) }
    var boardDone by remember { mutableStateOf(false) }
    var projectId by rememberSaveable { mutableStateOf("") }
    var projectTrail by rememberSaveable { mutableStateOf(emptyList<String>()) }
    var taskId by rememberSaveable { mutableStateOf("") }
    var taskEditing by rememberSaveable(projectId, taskId) { mutableStateOf(false) }
    val taskExtensions = rememberSaveable(controller, saver = SharedTaskExtensionsUiState.saver) { SharedTaskExtensionsUiState() }
    taskExtensions.account = LocalGenesisUserId.current
    var actionsOpen by remember { mutableStateOf(false) }
    var projectMenu by remember(projectId) { mutableStateOf<SharedProjectMenu?>(null) }
    var planningOpen by rememberSaveable(projectId) { mutableStateOf(false) }
    var workflowProject by rememberSaveable { mutableStateOf("") }
    var dataExportOpen by rememberSaveable(spaceId, projectId) { mutableStateOf(false) }
    var dataImportOpen by rememberSaveable(spaceId, projectId) { mutableStateOf(false) }
    var teamReportOpen by rememberSaveable(spaceId, projectId) { mutableStateOf(false) }
    var projectAccessOpen by rememberSaveable(spaceId) { mutableStateOf(false) }
    var templatesOpen by rememberSaveable(spaceId, projectId) { mutableStateOf(false) }
    var templatesCaptureId by rememberSaveable(spaceId, projectId) { mutableStateOf("") }
    var templatesCaptureTask by remember(spaceId, projectId) { mutableStateOf<JSONObject?>(null) }
    var templateAccessLost by remember(spaceId) { mutableStateOf(false) }
    val templateCopy = sharedTemplateCopy()
    var bulkOpen by rememberSaveable { mutableStateOf(false) }
    var bulkProjectId by rememberSaveable { mutableStateOf("") }
    var bulkFilter by rememberSaveable { mutableStateOf("{}") }
    var bulkSort by rememberSaveable { mutableStateOf("position") }
    var workflowRepairProjects by remember(spaceId) { mutableStateOf(emptyList<JSONObject>()) }
    val workflowCopy = sharedWorkflowCopy()
    val customFailureMessages = sharedCustomFieldFailureMessages()
    var showArchived by rememberSaveable { mutableStateOf(false) }
    LaunchedEffect(spaceId, showArchived) {
        workflowRepairProjects = emptyList()
        if (spaceId.isNotBlank() && showArchived) try {
            workflowRepairProjects = controller.sharedWorkflowRepairProjects(spaceId).getJSONArray("projects").rows()
        } catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_: Exception) { /* Existing archive entries remain usable when trash is offline. */ }
    }
    var filtersOpen by rememberSaveable { mutableStateOf(false) }
    var statusFilter by rememberSaveable(projectId) { mutableStateOf("") }
    var completionFilter by rememberSaveable(projectId) { mutableStateOf("any") }
    var assigneeFilter by rememberSaveable(projectId) { mutableStateOf("") }
    var priorityFilter by rememberSaveable(projectId) { mutableIntStateOf(-1) }
    var discardTaskDraft by remember { mutableStateOf(false) }
    var viewOverride by remember { mutableStateOf<String?>(null) }
    val calendarEngine = remember { GenesisCalendar() }
    val enabledCalendars = LocalEnabledCalendars.current
    val context = LocalContext.current
    val calendarMode = preferences.display.takeIf { it in enabledCalendars }
        ?: enabledCalendars.firstOrNull() ?: CalendarMode.PROFANE
    var calendarAnchor by remember { mutableStateOf(LocalDate.now()) }
    var calendarDay by remember { mutableStateOf(LocalDate.now()) }
    var showUndated by remember { mutableStateOf(true) }
    val listContext = rememberSharedTaskListContext(controller, projectId, preferences)
    var taskPage by listContext.reader.pageState
    val optimisticMoves = remember(controller) { mutableStateMapOf<String,JSONObject>() }
    var retryMove by remember { mutableStateOf<Triple<JSONObject,String,String>?>(null) }
    var taskSearch by rememberSaveable(projectId) { mutableStateOf("") }
    var openedTask by remember { mutableStateOf<JSONObject?>(null) }
    var editTaskDetails by rememberSaveable(stateSaver = Saver<JSONObject, String>(
        save = { it.toString() }, restore = { JSONObject(it) })) { mutableStateOf(JSONObject()) }
    var draftTaskKey by rememberSaveable { mutableStateOf("") }
    var createModal by rememberSaveable { mutableStateOf<String?>(null) }
    // Project loading briefly clears projectId during recreation; keep the open form's scope stable.
    var createCustomProjectId by rememberSaveable { mutableStateOf("") }
    val createCustom = rememberSharedTaskCustomCreation(createCustomProjectId, preferences)
    var showManagement by remember { mutableStateOf(false) }
    var spaceTitle by rememberSaveable { mutableStateOf("") }
    var projectTitle by rememberSaveable { mutableStateOf("") }
    var projectDescription by rememberSaveable { mutableStateOf("") }
    var parentId by rememberSaveable { mutableStateOf("") }
    var editTitle by remember { mutableStateOf("") }
    var editDescription by remember { mutableStateOf("") }
    var editParentId by remember { mutableStateOf("") }
    var memberToRemove by remember { mutableStateOf<String?>(null) }
    var projectToArchive by remember { mutableStateOf<String?>(null) }
    var newStatusTitle by rememberSaveable { mutableStateOf("") }
    var newStatusDone by rememberSaveable { mutableStateOf(false) }
    var newStatusColor by rememberSaveable { mutableStateOf("#2d6c68") }
    var newTaskEntryType by rememberSaveable { mutableStateOf("task") }
    val boardRequestId = rememberSaveable(projectId, newStatusTitle, newStatusDone, newStatusColor) { java.util.UUID.randomUUID().toString() }
    var editingStatusId by remember { mutableStateOf("") }
    var statusTitleDraft by remember { mutableStateOf("") }
    var statusDestinations by remember { mutableStateOf(emptyMap<String, String>()) }
    var statusToDelete by remember { mutableStateOf<JSONObject?>(null) }
    var newCategoryTitle by rememberSaveable { mutableStateOf("") }
    var newCategoryColor by rememberSaveable { mutableStateOf("#2d6c68") }
    var editingCategoryId by remember { mutableStateOf("") }
    var categoryTitleDraft by remember { mutableStateOf("") }
    var categoryColorDraft by remember { mutableStateOf("#2d6c68") }
    var categoryToDelete by remember { mutableStateOf<JSONObject?>(null) }
    var newTaskCategoryId by rememberSaveable { mutableStateOf("") }
    var newTaskStatusId by rememberSaveable { mutableStateOf("") }
    var newTaskAssigneeId by rememberSaveable { mutableStateOf("") }
    var newTaskDescription by rememberSaveable { mutableStateOf("") }
    var newTaskDueDate by rememberSaveable { mutableStateOf("") }
    var editTaskCategoryId by rememberSaveable { mutableStateOf("") }
    var taskTitle by rememberSaveable { mutableStateOf("") }
    var inviteEmail by rememberSaveable { mutableStateOf("") }
    var inviteRole by rememberSaveable { mutableStateOf("member") }
    var commentBody by rememberSaveable { mutableStateOf("") }
    var editTaskTitle by rememberSaveable { mutableStateOf("") }
    var editTaskDescription by rememberSaveable { mutableStateOf("") }
    var editTaskDueDate by rememberSaveable { mutableStateOf("") }
    var editTaskRevision by rememberSaveable { mutableIntStateOf(0) }
    var message by remember { mutableStateOf("") }
    var messageIsError by remember { mutableStateOf(true) }
    var offlineSnapshot by remember { mutableStateOf(false) }
    var pendingTasks by remember { mutableStateOf(emptyList<JSONObject>()) }
    var failedDraft by remember { mutableStateOf<JSONObject?>(null) }
    var busy by remember { mutableStateOf(false) }

    suspend fun refreshSpaces() {
        val response = controller.sharedSpaces()
        ownedProjectQuota = response.optJSONObject("ownedProjectQuota")
        offlineSnapshot = response.optBoolean("offlineCache")
        val rows = response.getJSONArray("spaces").rows()
        spaces = rows
        if (rows.none { it.getString("id") == spaceId }) spaceId = ""
    }
    suspend fun refreshProjects(id: String) {
        val response = controller.sharedProjects(id)
        val archivedResponse = controller.archivedSharedProjects(id)
        offlineSnapshot = response.optBoolean("offlineCache") || archivedResponse.optBoolean("offlineCache")
        if (spaceId != id) return
        val rows = response.getJSONArray("projects").rows()
        val archived = archivedResponse.getJSONArray("projects").rows()
        if (archivedProjects.map { it.toString() } != archived.map { it.toString() }) archivedProjects = archived
        if (projects.map { it.toString() } != rows.map { it.toString() }) projectRows = rows
        if (rows.none { it.getString("id") == projectId }) projectId = ""
    }
    suspend fun refreshProject(id: String) {
        val result = try { controller.sharedProject(id) }
        catch (failure: Exception) { if (failure is kotlinx.coroutines.CancellationException) throw failure;
            if (projectId == id && sharedTemplateAccessDenied(failure)) {
                if (templatesOpen) templateAccessLost = true
                templatesOpen = false; templatesCaptureId = ""; snapshot = null
                openedTask = null; taskPage = null; taskId = ""; projectId = ""
                projectRows = projectRows.filterNot { it.optString("id") == id }
            }
            throw failure
        }
        offlineSnapshot = result.optBoolean("offlineCache")
        if (projectId != id) return
        if (snapshot?.toString() != result.toString()) snapshot = result
        if (taskId.isNotBlank()) {
            val currentId = taskId
            try { val found = (if (taskExtensions.archivedTaskId == currentId) controller.sharedSprintSourceTask(id, currentId, true)
                else controller.sharedTask(id, currentId)).getJSONObject("task"); if (taskId == currentId) openedTask = found }
            catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "TASK_NOT_FOUND"; openedTask = null }
        }
    }
    fun persistExpansion(ids: Set<String>) {
        if (spaceId.isBlank() || uiReadySpace != spaceId) return
        val targetSpace = spaceId
        val next = ids.toList().takeLast(100)
        expandedIds = next.toSet()
        scope.launch {
            try { expansionWrites.withLock { controller.saveSharedSpaceUi(targetSpace, next) } }
            catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; if (spaceId == targetSpace) message = error.message ?: "Не удалось сохранить вид пространства." }
        }
    }
    fun selectProject(id: String) {
        templateAccessLost = false
        if (projectId.isNotBlank() && projectId != id) projectTrail = projectTrail + projectId
        persistExpansion(expandedIds + id)
        taskId = ""; projectId = id
        snapshot = null; viewOverride = null
    }
    fun openBoard(status: JSONObject) {
        boardDraft = status
        statusTitleDraft = status.optString("title")
        boardColor = status.optString("color", "#2d6c68")
        boardImage = status.optString("imageUrl")
        boardDone = status.optInt("isDone") == 1
    }
    fun run(action: suspend () -> Unit) {
        if (busy) return
        templateAccessLost = false
        busy = true; message = ""; messageIsError = false
        scope.launch {
            try { action() } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; messageIsError = true; message =
                customFailureMessages[(error as? CustomFieldFailure)?.code ?: error.message]?.takeIf { it.isNotBlank() } ?:
                sharedTaskDetailsFailure(error.message) ?:
                workflowMessage((error as? ru.genesis.calendar.auth.WorkflowFailure)?.code.orEmpty(), workflowCopy) ?: when (error.message) {
                "INVITEE_ACCOUNT_UNSUPPORTED" -> if (en) "This account cannot use shared projects." else "Этот аккаунт не может использовать общие проекты."
                "INVITEE_ACCOUNT_NOT_FOUND" -> if (en) "No GENESIS account was found for this email." else "Аккаунт GENESIS с такой почтой не найден."
                "SUBSCRIPTION_QUOTA_shared-projects" -> if (en) "The workspace owner's project allowance is exhausted. Subprojects do not use this allowance."
                    else "Лимит проектов владельца пространства исчерпан. Подпроекты не используют этот лимит."
                "FEATURE_SUBSCRIPTION_REQUIRED" -> if (en) "This feature is not included in the current plan." else "Эта функция недоступна в текущем тарифе."
                else -> error.message ?: "Ошибка сервера"
            } }
            finally { busy = false }
        }
    }
    LaunchedEffect(createModal, parentId, spaceId) {
        parentProjectSnapshot = null
        if (createModal == "project" && parentId.isNotBlank()) try {
            val parent = controller.sharedProject(parentId)
            parentProjectSnapshot = parent
            if (parent.optJSONArray("statuses")?.rows()?.none { it.optString("id") == parentBoardId } == true) parentBoardId = ""
        } catch (cause: kotlinx.coroutines.CancellationException) { throw cause }
        catch (cause: Exception) { if (cause is kotlinx.coroutines.CancellationException) throw cause; message = cause.message ?: "Не удалось открыть родительский проект." }
    }
    LaunchedEffect(createModal) {
        if (createModal == "task") { message = ""; messageIsError = false }
        if (createModal in setOf("space", "project")) {
            try { refreshSpaces() }
            catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Не удалось обновить лимит проектов." }
        }
        if (createModal == "join") {
            loadingInvitations = true
            try { invitations = controller.sharedInvitations().getJSONArray("invitations").rows() }
            catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Не удалось загрузить приглашения." }
            finally { loadingInvitations = false }
        }
    }
    LaunchedEffect(pageActive) {
        if (!pageActive) return@LaunchedEffect
        try { refreshSpaces() } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Ошибка сервера" }
    }
    LaunchedEffect(spaceId, pageActive) {
        if (!pageActive) return@LaunchedEffect
        val targetSpace = spaceId
        val restoredProjectId = projectId
        uiReadySpace = ""; expandedIds = emptySet(); projectId = ""; snapshot = null
        if (targetSpace.isNotBlank()) try {
            refreshProjects(targetSpace)
            val state = controller.sharedSpaceUi(targetSpace)
            if (spaceId == targetSpace) {
                val ids = state.optJSONArray("expandedIds") ?: JSONArray()
                expandedIds = (0 until ids.length()).map(ids::getString).toSet()
                uiReadySpace = targetSpace
                projectId = destination?.takeIf { it.spaceId == targetSpace && projectRows.any { project -> project.optString("id") == it.projectId } }?.projectId
                    ?: restoredProjectId.takeIf { id -> projectRows.any { it.optString("id") == id } }.orEmpty()
                if (projectId == destination?.projectId) taskId = destination.taskId
            }
        } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Ошибка сервера" }
        else { projectRows = emptyList(); archivedProjects = emptyList() }
    }
    LaunchedEffect(projectId, pageActive) {
        if (!pageActive) return@LaunchedEffect
        if (projectId.isBlank()) { snapshot = null; return@LaunchedEffect }
        while (isActive) {
            try {
                controller.flushSharedOfflineTasks()
                pendingTasks = controller.queuedSharedTasks(projectId)
                refreshProject(projectId)
                if (spaceId.isNotBlank()) refreshProjects(spaceId)
            } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Ошибка сервера" }
            delay(5_000)
        }
    }

    val project = snapshot?.getJSONObject("project")
    val statuses = snapshot?.getJSONArray("statuses")?.rows().orEmpty()
    val categories = snapshot?.optJSONArray("categories")?.rows().orEmpty()
    LaunchedEffect(taskPage, pendingTasks) {
        taskPage?.optJSONArray("tasks")?.rows()?.forEach { actual ->
            val id = actual.optString("id")
            val preview = optimisticMoves[id]
            if (preview != null && actual.optInt("revision") > preview.optInt("revision") &&
                !actual.optBoolean("pending") && !sharedTaskHasPending(id, pendingTasks)) optimisticMoves.remove(id)
        }
    }
    val tasks = taskPage?.optJSONArray("tasks")?.rows().orEmpty().map {
        optimisticMoves[it.optString("id")] ?: it
    }.filter { it.optString("projectId") == projectId }
    val inboxProject = projects.firstOrNull { it.optInt("isInbox") == 1 }
    val (spaceInboxLayout,setSpaceInboxLayout)=rememberSharedChaosLayout("space:$spaceId")
    val (projectInboxLayout,setProjectInboxLayout)=rememberSharedChaosLayout("project:$projectId")
    var inlineInboxSnapshot by remember(controller,spaceId) {mutableStateOf<JSONObject?>(null)}
    var inlineInboxFailure by remember(controller,spaceId) {mutableStateOf("")}
    var inlineInboxRetry by remember {mutableIntStateOf(0)}
    val inlineInboxReader=rememberSharedTaskListReader(controller)
    val inboxId=inboxProject?.optString("id").orEmpty()
    val inlineInboxActive=pageActive&&projectId.isBlank()&&inboxId.isNotBlank()&&!spaceInboxLayout.hidden
    LaunchedEffect(controller,inboxId,inlineInboxActive,inlineInboxRetry) {
        inlineInboxSnapshot=null;inlineInboxFailure=""
        if(inlineInboxActive) try {inlineInboxSnapshot=controller.sharedProject(inboxId)}
        catch(cancelled:kotlinx.coroutines.CancellationException) {throw cancelled}
        catch(failure:Exception) {inlineInboxFailure=failure.message ?: "Не удалось загрузить хаос-бокс."}
    }
    ObserveSharedTaskList(inlineInboxReader,JSONObject().put("projectIds",JSONArray(listOf(inboxId))),"position",inboxId,
        inlineInboxActive,inlineInboxActive&&inlineInboxSnapshot!=null) {inlineInboxSnapshot=null}
    // An inbox is an inline container. Only its task editor/creation form may occupy the detail route.
    LaunchedEffect(project?.optInt("isInbox"),taskId,createModal) {
        if(project?.optInt("isInbox")==1&&taskId.isBlank()&&createModal==null) {projectId="";snapshot=null}
    }

    val members = snapshot?.getJSONArray("members")?.rows().orEmpty()
    val role = project?.optString("role") ?: ""
    val canWrite = role in setOf("owner", "manager", "member")
    val selectedTask = openedTask?.takeIf { it.optString("id") == taskId && it.optString("projectId") == projectId } ?: tasks.firstOrNull { it.optString("id") == taskId }
    val taskArchived = selectedTask?.optString("archivedAt")?.let { it.isNotBlank() && it != "null" } == true
    val canEditTask = sharedTaskCanEdit(project) && !taskArchived
    val planningEnabled = project?.optJSONObject("planning")?.optBoolean("enabled") == true
    val taskPending = sharedTaskHasPending(taskId, pendingTasks)
    val canOrganize = project?.optBoolean("canOrganizeTasks") == true
    val canComment = role in setOf("owner", "manager", "member", "commenter") && !taskArchived
    val canInvite = role in setOf("owner", "manager")
    if (templatesOpen && project != null && spaceId.isNotBlank() && projectId.isNotBlank()) key(spaceId, projectId) {
        SharedTemplatesScreen(controller, spaceId, projectId, project.optString("title"), projects, members, preferences,
            sharedTaskCanEdit(project), project.optJSONObject("permissions")?.optBoolean("createProjects") == true,
            captureTask = selectedTask?.takeIf { it.optString("id") == templatesCaptureId }
                ?: tasks.firstOrNull { it.optString("id") == templatesCaptureId }
                ?: templatesCaptureTask?.takeIf { it.optString("id") == templatesCaptureId },
            onClose = { templatesOpen = false; templatesCaptureId = "" },
            onChanged = { run { refreshProjects(spaceId); refreshProject(projectId) } },
            onOpen = { targetProject, targetTask ->
                templatesOpen = false; templatesCaptureId = ""; selectProject(targetProject); taskId = targetTask.orEmpty()
                run { refreshProjects(spaceId); refreshProject(targetProject) }
            })
    }
    if (planningOpen && project != null && project.optInt("isInbox") == 0) key(projectId) {
        SharedPlanningScreen(controller, project, members, onClose = { planningOpen = false },
            onTask = { id -> planningOpen = false; taskId = id }, onChanged = { run { refreshProject(projectId) } })
    }
    if (workflowProject.isNotBlank()) SharedWorkflowScreen(controller, workflowProject,
        onClose = { workflowProject = "" }, onChanged = { if (projectId == workflowProject) run { refreshProject(projectId) } })
    if (dataExportOpen && spaceId.isNotBlank()) SharedDataExportScreen(controller, spaceId, projectId,
        project?.optString("title").orEmpty(), onClose = { dataExportOpen = false })
    if (dataImportOpen && project != null && spaceId.isNotBlank() && projectId.isNotBlank()) SharedDataImportScreen(controller, spaceId, projectId,
        project.optString("title"), canEditTask, project.optJSONObject("permissions")?.optBoolean("createProjects") == true,
        onClose = { dataImportOpen = false }, onChanged = { run { refreshProjects(spaceId); if (projectId.isNotBlank()) refreshProject(projectId) } },
        onOpenProject = { id -> projectId = id; taskId = ""; run { refreshProjects(spaceId); refreshProject(id) } })
    val estimateDraft = selectedTask?.takeIf { draftTaskKey == "$projectId:$taskId" }?.let { sharedTaskEstimates(it, editTaskDetails) }
    val customDraft = selectedTask?.takeIf { draftTaskKey == "$projectId:$taskId" }?.let {
        bindSharedTaskCustom(it, editTaskDetails, snapshot, preferences)
    }
    val newCustomBinding = if (createModal == "task" && snapshot != null) bindSharedTaskCustom(createCustom.source, createCustom.details, snapshot, preferences) else null
    val activeView = viewOverride ?: project?.optString("layout") ?: "list"
    val taskFilter = JSONObject().put("projectIds", JSONArray().put(projectId)).put("q", taskSearch)
    if (statusFilter.isNotBlank()) taskFilter.put("statusIds", JSONArray().put(statusFilter))
    if (completionFilter != "any") taskFilter.put("completion", completionFilter)
    if (assigneeFilter.isNotBlank()) taskFilter.put("assigneeIds", JSONArray().put(assigneeFilter))
    if (priorityFilter >= 0) taskFilter.put("priority", JSONArray().put(priorityFilter))
    if (activeView == "calendar") taskFilter.put("dueFrom", calendarDay.toString()).put("dueTo", calendarDay.toString())
    if (listContext.query.count > 0) taskFilter.put("customFields", listContext.query.criteria)
    listContext.bind(snapshot, taskFilter, taskSort)
    val teamReportNoAccess = genesisTranslate("Нет доступа")
    if (bulkOpen && bulkProjectId.isNotBlank()) SharedBulkScreen(controller, bulkProjectId, JSONObject(bulkFilter), bulkSort, preferences,
        onClose = { bulkOpen = false }, onLost = {
            bulkOpen = false; snapshot = null; taskPage = null; openedTask = null; taskId = ""; projectId = ""
            message = teamReportNoAccess; run { refreshProjects(spaceId) }
        }, onChanged = { run { if (projectId.isNotBlank()) refreshProject(projectId) } }, onTask = { targetProject, targetTask ->
            run {
                val target = controller.sharedProject(targetProject).getJSONObject("project")
                bulkOpen = false
                val destinationSpace = target.getString("spaceId")
                if (destinationSpace != spaceId) { spaceId = destinationSpace; refreshProjects(destinationSpace) }
                selectProject(targetProject); taskId = targetTask
            }
        })
    val automationDestination = rememberSharedAutomationNavigation(controller, preferences, spaceId, projectId, spaces, onLost = {
            snapshot = null; taskPage = null; openedTask = null; taskId = ""; projectId = ""
            message = teamReportNoAccess; run { refreshProjects(spaceId) }
        }, onChanged = { run { if (projectId.isNotBlank()) refreshProject(projectId) } }, onTask = { targetProject, targetTask ->
            run {
                val target = controller.sharedProject(targetProject).getJSONObject("project")
                val destination = target.getString("spaceId")
                if (destination != spaceId) { spaceId = destination; refreshProjects(destination) }
                selectProject(targetProject); taskId = targetTask
            }
        })
    if (projectAccessOpen && spaceId.isNotBlank()) SharedProjectAccessScreen(controller, spaceId, onClose = { projectAccessOpen = false }, onLost = {
        projectAccessOpen = false; snapshot = null; taskPage = null; openedTask = null; taskId = ""; projectId = ""
        message = teamReportNoAccess; run { refreshProjects(spaceId) }
    }, onSaved = { run { refreshProjects(spaceId); if (projectId.isNotBlank()) refreshProject(projectId) } })
    if (teamReportOpen && project != null && spaceId.isNotBlank() && projectId.isNotBlank()) SharedTeamReportScreen(controller, spaceId, projectId,
        project.optString("title"), taskFilter, calendarMode, statuses, onClose = { teamReportOpen = false }, onLost = {
            teamReportOpen = false; snapshot = null; taskPage = null; openedTask = null; taskId = ""; projectId = ""
            message = teamReportNoAccess; run { refreshProjects(spaceId) }
        })
    ObserveSharedTaskListContext(listContext, controller, taskFilter, pageActive, project?.optString("id") == projectId,
        activeView, calendarMode, calendarAnchor) {
        snapshot = null; taskPage = null; openedTask = null; taskId = ""; projectId = ""
        message = teamReportNoAccess; run { refreshProjects(spaceId) }
    }
    val undatedReader = rememberSharedTaskListReader(controller)
    val undatedFilter = JSONObject(taskFilter.toString()).apply { remove("dueFrom"); remove("dueTo"); put("undated", true) }
    ObserveSharedTaskList(undatedReader, undatedFilter, listContext.sort, projectId, pageActive && activeView == "calendar",
        project?.optString("id") == projectId, {})
    val calendarDropBounds = remember { mutableStateMapOf<String, Rect>() }
    var draggingTask by remember { mutableStateOf<JSONObject?>(null) }
    var draggingContainer by remember { mutableStateOf<JSONObject?>(null) }
    var dragProjectTargets by remember { mutableStateOf(false) }
    var draggingAt by remember { mutableStateOf<Offset?>(null) }
    var rootPosition by remember { mutableStateOf(Offset.Zero) }
    val dropBounds = remember { mutableStateMapOf<String, Rect>() }
    val boardScroll = rememberLazyListState()
    var boardViewport by remember { mutableStateOf(Rect.Zero) }
    val latestDragPosition by rememberUpdatedState(draggingAt)
    val dragDensity = androidx.compose.ui.platform.LocalDensity.current.density
    val boardEdge = 72f * dragDensity
    fun moveTaskTo(task: JSONObject, destinationProjectId: String, destinationStatusId: String = "") {
        val sourceProjectId=task.optString("projectId",projectId)
        val sourceSnapshot=if(sourceProjectId==projectId) snapshot else inlineInboxSnapshot
        if (sourceSnapshot?.optJSONObject("project")?.optBoolean("canOrganizeTasks")!=true || destinationProjectId.isBlank() || busy) return
        val movingId = task.getString("id")
        optimisticMoves[movingId] = JSONObject(task.toString()).put("projectId",destinationProjectId)
            .put("statusId",destinationStatusId).put("pending",true)
        run {
          var confirmed = false
          try {
            val destination = if (destinationProjectId == sourceProjectId) sourceSnapshot
                else controller.sharedProject(destinationProjectId)
            require(destination?.optJSONObject("project")?.optInt("isInbox") != 1) {"Выберите проект"}
            val statusId = destinationStatusId
            val moved = controller.moveSharedTask(sourceProjectId, task.getString("id"), JSONObject()
                .put("destinationProjectId", destinationProjectId).put("statusId", statusId)
                .put("expectedRevision", task.getInt("revision"))
                .put("position", if (destinationProjectId == projectId)
                    tasks.count { it.optString("statusId") == statusId }
                    else destination?.optJSONArray("tasks")?.rows()?.count { it.optString("statusId") == statusId } ?: 0))
            pendingTasks = controller.queuedSharedTasks(sourceProjectId)
            if (sourceProjectId!=projectId) inlineInboxReader.refresh()
            if (moved.getJSONObject("task").optBoolean("pending")) {
                message = if (en) "Move saved on this device. It will sync when connected."
                    else "Перенос сохранён на устройстве и синхронизируется после подключения."
                return@run
            }
            confirmed = true
            optimisticMoves[movingId] = sharedMovedTaskProjection(task, moved.getJSONObject("task"), destinationProjectId, statusId)
            refreshProjects(spaceId)
            if(sourceProjectId==projectId) {projectId = destinationProjectId;refreshProject(destinationProjectId)}
            else inlineInboxReader.refresh()
            if(projectId == destinationProjectId) listContext.reader.refresh()
            optimisticMoves.remove(movingId)
            retryMove = null
          } catch (cancelled:kotlinx.coroutines.CancellationException) {throw cancelled}
          catch (failure:Exception) {
            if (!confirmed) {
                optimisticMoves.remove(movingId)
                retryMove = Triple(JSONObject(task.toString()),destinationProjectId,destinationStatusId)
            }
            throw failure
          }
        }
    }
    fun moveTaskStatus(task: JSONObject, destination: String) {
        if (!canOrganize || task.optString("statusId") == destination) return
        moveTaskTo(task, projectId, destination)
    }
    fun finishDrag() {
        val task = draggingTask
        val container = draggingContainer
        val position = draggingAt
        val destination = if (position != null) dropBounds.entries
            .filter { it.value.contains(position) }.minByOrNull { it.value.width * it.value.height }?.key else null
        val dateTarget = if (activeView == "calendar" && position != null)
            calendarDropBounds.entries.firstOrNull { it.value.contains(position) }?.key else null
        draggingTask = null; draggingContainer = null; draggingAt = null; dragProjectTargets = false
        if(container != null && destination != null) {
            val parent = if(destination.startsWith("project:")) destination.removePrefix("project:") else projectId
            val board = if(destination.startsWith("board:")) destination.removePrefix("board:") else ""
            var cursor=parent
            val visited=mutableSetOf<String>()
            while(cursor.isNotBlank() && visited.add(cursor) && cursor != container.optString("id")) {
                cursor=projects.firstOrNull { it.optString("id")==cursor }?.optString("parentId").orEmpty()
            }
            if(parent.isNotBlank() && cursor != container.optString("id") && container.optString("role") in setOf("owner","manager") && !busy) {
                val id = container.getString("id")
                projectMoves[id] = JSONObject(container.toString()).put("parentId", parent).put("boardStatusId", board)
                run {
                    var confirmed = false
                    try {
                        val changed = controller.updateSharedProject(id,JSONObject()
                            .put("title",container.optString("title")).put("description",container.optString("description"))
                            .put("layout",container.optString("layout","list")).put("parentId",parent)
                            .put("boardStatusId",board).put("expectedRevision",container.getInt("revision")))
                        confirmed = true
                        projectMoves[id] = changed.optJSONObject("project") ?: projectMoves.getValue(id)
                        refreshProjects(spaceId)
                        projectMoves.remove(id)
                        if(projectId.isNotBlank()) refreshProject(projectId)
                    } catch(cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                    catch(failure: Exception) { if(!confirmed) projectMoves.remove(id); throw failure }
                }
            }
        }
        if (task != null && dateTarget != null && canEditTask && !task.optBoolean("pending") &&
            task.optString("projectId") == projectId && !sharedTaskHasPending(task.optString("id"), pendingTasks)) run {
            val id = task.getString("id")
            val changed = controller.updateSharedTask(projectId, id, JSONObject().put("dueDate", dateTarget)
                .put("expectedRevision", task.getInt("revision"))).getJSONObject("task")
            require(changed.optString("id") == id && changed.optString("projectId") == projectId)
            pendingTasks = controller.queuedSharedTasks(projectId)
            calendarDay = LocalDate.parse(dateTarget)
            undatedReader.refresh(); refreshProject(projectId)
            if (changed.optBoolean("pending")) message = "Изменение сохранено на устройстве и синхронизируется после подключения."
        }
        if (task != null && destination != null) {
            if (destination.startsWith("status:") || destination.startsWith("board:"))
                moveTaskStatus(task, destination.substringAfter(":"))
            if (destination.startsWith("project:")) moveTaskTo(task, destination.removePrefix("project:"))
        }
    }
    val containerInteraction: @Composable (JSONObject) -> Modifier = { item ->
        val id=item.getString("id")
        val target="project:$id"
        var origin by remember(id) { mutableStateOf(Offset.Zero) }
        val hovered=draggingAt?.let { dropBounds[target]?.contains(it) } == true && draggingContainer?.optString("id") != id
        DisposableEffect(id) { onDispose { dropBounds.remove(target) } }
        Modifier.onGloballyPositioned { origin=it.boundsInWindow().topLeft;dropBounds[target]=it.boundsInWindow() }
            .then(if(hovered) Modifier.border(2.dp,MaterialTheme.colorScheme.primary,AffairsLayout.shape) else Modifier)
            .workspaceDragSource(id, enabled = !busy && item.optString("role") in setOf("owner","manager"),
                onStart={ draggingTask=null;draggingContainer=item;draggingAt=origin+it },
                onMove={ amount -> draggingAt=(draggingAt?:Offset.Zero)+amount },
                onFinish={ cancelled -> if(cancelled) {draggingContainer=null;draggingAt=null} else finishDrag() })
    }
    val categoryColors = listOf("#2d6c68", "#a5543f", "#b18b48", "#665c88", "#54718a")
    val scrollPositions = remember { mutableMapOf<String, ScrollState>() }
    val pageKey = if (taskId.isNotBlank()) "task:$projectId:$taskId" else if (projectId.isNotBlank())
        "project:$projectId" else "space:$spaceId"
    val pageScroll = scrollPositions.getOrPut(pageKey) { ScrollState(0) }
    var listViewport by remember { mutableStateOf(Rect.Zero) }
    DisposableEffect(activeView, projectId) { onDispose { dropBounds.clear() } }
    LaunchedEffect(draggingTask?.optString("id"), draggingContainer?.optString("id"), activeView, pageScroll, dragDensity) {
        if (draggingTask == null && draggingContainer == null) return@LaunchedEffect
        val verticalMotion = WorkspaceDragScrollMotion(2400f * dragDensity)
        val horizontalMotion = WorkspaceDragScrollMotion(2400f * dragDensity)
        val boardAxis = WorkspaceBoardDragAxis()
        while (isActive) {
            val frame = withFrameNanos { it }
            val point = latestDragPosition
            val horizontal = point != null && draggingTask != null && activeView == "board" &&
                boardAxis.preferHorizontal(point.x, point.y, boardViewport.left, boardViewport.top,
                    boardViewport.right, boardViewport.bottom, boardEdge)
            val horizontalVelocity = if (horizontal && point != null)
                workspaceDragScrollVelocity(point.x, boardViewport.left, boardViewport.right,
                    boardEdge, 720f * dragDensity) else 0f
            val verticalVelocity = if (!horizontal && point != null && point.x in listViewport.left..listViewport.right) {
                // A card can start in the upper page edge while still on its board.
                // Reveal projects only after the finger deliberately leaves that row.
                val insideTaskBoard = draggingTask != null && activeView == "board" &&
                    boardViewport.width > 0f && boardViewport.height > 0f &&
                    point.y in boardViewport.top..boardViewport.bottom
                if (point.y < listViewport.top + boardEdge && !insideTaskBoard) dragProjectTargets = true
                workspaceDragScrollVelocity(point.y, listViewport.top, listViewport.bottom,
                    boardEdge, 720f * dragDensity)
            } else 0f
            val horizontalDistance = horizontalMotion.step(frame, horizontalVelocity)
            val verticalDistance = verticalMotion.step(frame, verticalVelocity)
            if (horizontalDistance != 0f) boardScroll.scrollBy(horizontalDistance)
            if (verticalDistance != 0f) pageScroll.scrollBy(verticalDistance)
        }
    }
    val taskFieldsChanged = selectedTask != null && draftTaskKey == "$projectId:$taskId" && (
        editTaskTitle != selectedTask.optString("title") ||
        editTaskDescription != selectedTask.optString("description") ||
        editTaskDueDate != selectedTask.optString("dueDate").takeUnless { it == "null" }.orEmpty() ||
        editTaskCategoryId != selectedTask.optString("categoryId").takeUnless { it == "null" }.orEmpty() ||
        sharedTaskDetailsChanged(selectedTask, editTaskDetails, customDraft?.fields.orEmpty()))
    val coreTaskDraftChanged = taskFieldsChanged || canComment && commentBody.isNotBlank()
    taskExtensions.coreDraftDirty = taskFieldsChanged
    val taskDraftChanged = coreTaskDraftChanged || taskExtensions.filesDirty || taskExtensions.seriesDirty
    fun navigateBack() {
        if (busy) return
        actionsOpen = false; projectMenu = null
        when {
            taskId.isNotBlank() -> if (taskDraftChanged) discardTaskDraft = true else { draftTaskKey = ""; taskId = ""; openedTask = null }
            projectId.isNotBlank() -> {
                projectId = projectTrail.lastOrNull().orEmpty(); projectTrail = projectTrail.dropLast(1)
                snapshot = null; viewOverride = null
            }
            else -> { spaceId = ""; projectTrail = emptyList() }
        }
    }
    BackHandler(enabled = pageActive && (taskId.isNotBlank() || projectId.isNotBlank() || spaceId.isNotBlank()) &&
        !taskExtensions.lifecycleOpen && !taskExtensions.mindmapsOpen && createModal == null && !showManagement && boardDraft == null && !filtersOpen && !discardTaskDraft && !teamReportOpen && !projectAccessOpen && automationDestination.fields.value.isBlank() && !bulkOpen && automationDestination.value.isBlank()) { navigateBack() }
    if (discardTaskDraft) AlertDialog(onDismissRequest = { discardTaskDraft = false },
        title = { Text("Несохранённые изменения") },
        text = { Text("Вернуться без сохранения изменений?") },
        confirmButton = { TextButton(onClick = { run {
            ru.genesis.calendar.auth.SharedTaskFilesDraftStore(context, taskExtensions.account, projectId, taskId).clear()
            discardTaskDraft = false; draftTaskKey = ""; commentBody = ""; taskId = ""; openedTask = null
            taskExtensions.filesDirty = false; taskExtensions.seriesDirty = false; taskExtensions.archivedTaskId = ""
        } }) {
            Text("Не сохранять") } },
        dismissButton = { TextButton(onClick = { discardTaskDraft = false }) { Text("Продолжить редактирование") } })
    LaunchedEffect(projectId, pageActive) {
        if (!pageActive) return@LaunchedEffect
        googleSettings = null; googleMessage = ""
        if (projectId.isBlank()) return@LaunchedEffect
        try { googleSettings = controller.sharedGoogleSettings(projectId).getJSONObject("settings") }
        catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; googleMessage = error.message ?: "Ошибка Google" }
        while (isActive) {
            delay(30_000)
            val settings = googleSettings
            if (settings?.optBoolean("tasksEnabled") == true || settings?.optBoolean("calendarEnabled") == true) {
                try { controller.syncSharedGoogle(projectId) }
                catch (cancel: kotlinx.coroutines.CancellationException) { throw cancel }
                catch (_: Exception) { /* The explicit update button reports failures. */ }
            }
        }
    }
    LaunchedEffect(projectId, taskId, pageActive) {
        if (!pageActive) return@LaunchedEffect
        if (taskId.isBlank()) { openedTask = null; return@LaunchedEffect }
        val targetProject = projectId; val targetTask = taskId
        val current = try { (if (taskExtensions.archivedTaskId == targetTask) controller.sharedSprintSourceTask(targetProject, targetTask, true)
            else controller.sharedTask(targetProject, targetTask)).getJSONObject("task") }
            catch(error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "TASK_NOT_FOUND"; return@LaunchedEffect }
        if (projectId != targetProject || taskId != targetTask) return@LaunchedEffect
        openedTask = current
        if (draftTaskKey != "$projectId:$taskId") {
            editTaskDetails = sharedTaskDetailDraft(current, preferences)
            editTaskTitle = current.optString("title")
            editTaskDescription = current.optString("description")
            editTaskDueDate = current.optString("dueDate").takeUnless { it == "null" }.orEmpty()
            editTaskCategoryId = current.optString("categoryId").takeUnless { it == "null" }.orEmpty()
            editTaskRevision = current.optInt("revision")
            commentBody = ""; draftTaskKey = "$projectId:$taskId"
        }
    }
    LaunchedEffect(projectId, project?.optInt("revision")) {
        editTitle = project?.optString("title") ?: ""
        editDescription = project?.optString("description") ?: ""
        editParentId = project?.optString("parentId")?.takeUnless { it == "null" } ?: ""
    }
    if (memberToRemove != null) AlertDialog(
        onDismissRequest = { memberToRemove = null },
        title = { Text(if (en) "Remove participant?" else "Удалить участника?") },
        confirmButton = { TextButton(onClick = {
            val target = memberToRemove ?: return@TextButton
            memberToRemove = null
            run { controller.removeSharedMember(projectId, target); refreshProject(projectId) }
        }) { Text(if (en) "Remove" else "Удалить") } },
        dismissButton = { TextButton(onClick = { memberToRemove = null }) { Text(if (en) "Cancel" else "Отмена") } },
    )
    if (projectToArchive != null) AlertDialog(
        onDismissRequest = { projectToArchive = null },
        title = { Text(if (en) "Archive project?" else "Архивировать проект?") },
        text = { Text(if (en) "Tasks will be kept and the project can be restored."
            else "Задачи сохранятся, проект можно восстановить.") },
        confirmButton = { TextButton(onClick = {
            val target = projectToArchive ?: return@TextButton
            projectToArchive = null
            run { controller.setSharedProjectArchived(target, true); snapshot = null; refreshProjects(spaceId) }
        }) { Text(if (en) "Archive" else "В архив") } },
        dismissButton = { TextButton(onClick = { projectToArchive = null }) { Text(if (en) "Cancel" else "Отмена") } },
    )
    if (statusToDelete != null) {
        val source = statusToDelete!!
        val destinations = statuses.filter { it.optString("id") != source.optString("id") }
        val destinationId = statusDestinations[source.optString("id")]
            ?.takeIf { chosen -> destinations.any { it.optString("id") == chosen } }
            ?: destinations.firstOrNull()?.optString("id").orEmpty()
        AlertDialog(onDismissRequest = { statusToDelete = null },
            title = { Text(if (en) "Delete status?" else "Удалить статус?") },
            text = { Text(if (en) "Tasks will move to the selected status."
                else "Задачи перейдут в выбранный статус.") },
            confirmButton = { TextButton(onClick = {
                val current = statusToDelete ?: return@TextButton
                statusToDelete = null
                run { controller.deleteSharedStatus(projectId, current.getString("id"),
                    destinationId, current.getInt("revision")); refreshProject(projectId) }
            }, enabled = destinationId.isNotBlank()) { Text(if (en) "Delete" else "Удалить") } },
            dismissButton = { TextButton(onClick = { statusToDelete = null }) { Text(if (en) "Cancel" else "Отмена") } })
    }
    if (categoryToDelete != null) AlertDialog(
        onDismissRequest = { categoryToDelete = null },
        title = { Text(if (en) "Delete category?" else "Удалить категорию?") },
        text = { Text(if (en) "Tasks will remain without a category."
            else "Задачи останутся без категории.") },
        confirmButton = { TextButton(onClick = {
            val category = categoryToDelete ?: return@TextButton
            categoryToDelete = null
            run {
                controller.deleteSharedCategory(projectId, category.getString("id"), category.getInt("revision"))
                if (newTaskCategoryId == category.getString("id")) newTaskCategoryId = ""
                if (editTaskCategoryId == category.getString("id")) editTaskCategoryId = ""
                refreshProject(projectId)
            }
        }) { Text(if (en) "Delete" else "Удалить") } },
        dismissButton = { TextButton(onClick = { categoryToDelete = null }) { Text(if (en) "Cancel" else "Отмена") } },
    )
    if (createModal != null) {
        val modal = createModal!!
        val validDate = newTaskDueDate.isBlank() || runCatching { LocalDate.parse(newTaskDueDate) }.isSuccess
        AlertDialog(onDismissRequest = { if (!busy) {
            createModal = null
            if (taskExtensions.conversionMap.isNotBlank()) {
                taskExtensions.mindmapsOpen = true; taskExtensions.conversionMap = ""; taskExtensions.conversionNode = ""
            }
        } },
            title = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(when (modal) {
                "join" -> if (en) "Workspace invitations" else "Приглашения в пространства"
                "space" -> if (en) "New workspace" else "Новое пространство"
                "project" -> if (createKind == "task-list") "Новый список задач" else if (en) "New shared project" else "Новый общий проект"
                "task" -> when (newTaskEntryType) { "event" -> "Новое событие"; "meeting" -> "Новая встреча"; else -> if (en) "New team task" else "Новая задача команды" }
                "status" -> if (en) "New board" else "Новая доска"
                "category" -> if (en) "New category" else "Новая категория"
                else -> if (en) "Invite a participant" else "Пригласить участника"
            })
                if (modal == "task") UntranslatedText(
                    listOfNotNull(spaces.firstOrNull { it.optString("id") == spaceId }?.optString("title")?.takeIf { it.isNotBlank() },
                        project?.optString("title")?.takeIf { it.isNotBlank() }).joinToString(" / "),
                    modifier = Modifier.testTag("shared-create-destination"),
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (modal == "task" && messageIsError && message.isNotBlank()) Row(Modifier.fillMaxWidth(),
                    verticalAlignment = androidx.compose.ui.Alignment.Top) {
                    Text(message, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium,
                        modifier = Modifier.weight(1f).testTag("shared-create-error"))
                    AffairsIconButton("Обновить", AffairsAction.REFRESH, { run { refreshProject(projectId) } },
                        Modifier.testTag("shared-create-refresh"), enabled = !busy)
                }
            } },
            text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                when (modal) {
                    "join" -> {
                        teamActivity?.invoke()
                        if (loadingInvitations) AffairsLoading()
                        else if (invitations.isEmpty()) Text(if (en) "No invitations yet." else "Приглашений пока нет.")
                        invitations.forEach { invitation ->
                            Text(invitation.optString("spaceTitle"), style = MaterialTheme.typography.titleMedium)
                            Text(invitation.optString("inviterName"), style = MaterialTheme.typography.bodySmall)
                            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Button(onClick = { run {
                                    val joined = controller.acceptSharedInvitation(invitation.getString("id"))
                                    refreshSpaces(); spaceId = joined.optString("spaceId"); createModal = null
                                } }, enabled = !busy) { Text(if (en) "Join" else "Присоединиться") }
                                OutlinedButton(onClick = { run {
                                    controller.rejectSharedInvitation(invitation.getString("id"))
                                    invitations = controller.sharedInvitations().getJSONArray("invitations").rows()
                                } }, enabled = !busy) { Text(if (en) "Decline" else "Отклонить") }
                            }
                        }
                    }
                    "space" -> {
                        OutlinedTextField(spaceTitle, { spaceTitle = it },
                            label = { Text(if (en) "Workspace name" else "Название пространства") }, modifier = Modifier.fillMaxWidth())
                        SharedProjectQuotaDescription(ownedProjectQuota, en)
                    }
                    "project" -> {
                        OutlinedTextField(projectTitle, { projectTitle = it },
                            label = { Text(if (createKind == "task-list") "Название списка" else if (en) "Project name" else "Название проекта") }, modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(projectDescription, { projectDescription = it },
                            label = { Text(if (en) "Description" else "Описание") }, modifier = Modifier.fillMaxWidth())
                        Text(if (en) "Parent project" else "Родительский проект", style = MaterialTheme.typography.titleSmall)
                        SharedProjectQuotaDescription(spaces.firstOrNull { it.optString("id") == spaceId }?.optJSONObject("projectQuota"), en)
                        FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
                            verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(selected = parentId.isBlank(), onClick = { parentId = ""; parentBoardId = "" }, label = { Text(if (en) "Top level" else "Верхний уровень") })
                            projects.filter { it.optInt("isInbox") == 0 }.forEach { item ->
                                FilterChip(selected = parentId == item.optString("id"), onClick = { parentId = item.optString("id"); parentBoardId = "" },
                                    label = { Text(item.optString("title")) })
                            }
                        }
                        if (parentProjectSnapshot != null) {
                            Text(if (en) "Parent board" else "Доска родительского проекта", style = MaterialTheme.typography.titleSmall)
                            FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp),
                                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                parentProjectSnapshot?.optJSONArray("statuses")?.rows().orEmpty().forEach { board ->
                                    FilterChip(parentBoardId == board.optString("id"), onClick = { parentBoardId = board.optString("id") },
                                        label = { Text(sharedStatusLabel(board.optString("title"), en)) })
                                }
                            }
                        }
                    }
                    "task" -> {
                        OutlinedTextField(taskTitle, { taskTitle = it },
                            label = { Text(if (en) "Name" else "Название") }, enabled = !busy,
                            modifier = Modifier.fillMaxWidth().testTag("shared-new-task-title"))
                        if (project == null) AffairsLoading()
                        else if (!canEditTask) Text("Нет доступа", color = MaterialTheme.colorScheme.error)
                        newCustomBinding?.let { custom -> SharedTaskCustomFields(createCustom.source, createCustom.details, createCustom.presentation(custom), preferences, true,
                            busy || !canEditTask || project?.optString("archivedAt")?.let { it.isNotBlank() && it != "null" } == true,
                            { createCustom.change(it) }, { run { refreshProject(projectId) } }) }
                        OutlinedTextField(newTaskDescription, { newTaskDescription = it },
                            label = { Text(if (en) "Description" else "Описание") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                        Text(if (en) "Due date" else "Срок", style = MaterialTheme.typography.titleSmall)
                        if (newTaskDueDate.isBlank()) TextButton(onClick = { newTaskDueDate = LocalDate.now().toString() }) {
                            Text(if (en) "Set due date" else "Установить срок")
                        } else {
                            AuthorDatePicker(newTaskDueDate, preferences.input) { newTaskDueDate = it }
                            TextButton(onClick = { newTaskDueDate = "" }) { Text(if (en) "Clear" else "Убрать срок") }
                        }
                        Text(if (en) "Board" else "Доска", style = MaterialTheme.typography.titleSmall)
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            FilterChip(selected = newTaskStatusId.isBlank(), onClick = { newTaskStatusId = "" }, label = { Text("Хаос-бокс проекта") })
                            statuses.forEach { status -> FilterChip(
                                selected = newTaskStatusId == status.optString("id"),
                                onClick = { newTaskStatusId = status.optString("id") },
                                label = { Text(sharedStatusLabel(status.optString("title"), en)) }) }
                        }
                        AffairsDisclosure("Дополнительные параметры задачи") {
                        Text(if (en) "Category" else "Категория", style = MaterialTheme.typography.titleSmall)
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            (listOf<JSONObject?>(null) + categories).forEach { category ->
                                val id = category?.optString("id") ?: ""
                                FilterChip(selected = newTaskCategoryId == id, onClick = { newTaskCategoryId = id },
                                    label = { Text(category?.optString("title") ?: if (en) "No category" else "Без категории") })
                            }
                        }
                        Text(if (en) "Assigned to" else "Исполнитель", style = MaterialTheme.typography.titleSmall)
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            (listOf<JSONObject?>(null) + members).forEach { member ->
                                val id = member?.optString("userId") ?: ""
                                FilterChip(selected = newTaskAssigneeId == id, onClick = { newTaskAssigneeId = id },
                                    label = { Text(member?.optString("displayName") ?: if (en) "Unassigned" else "Не назначен") })
                            }
                        }
                        }
                    }
                    "status" -> {
                        OutlinedTextField(newStatusTitle, { newStatusTitle = it },
                            label = { Text(if (en) "Board name" else "Название доски") }, modifier = Modifier.fillMaxWidth())
                        Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            Checkbox(checked = newStatusDone, onCheckedChange = { newStatusDone = it })
                            Text(if (en) "Tasks here are completed" else "Задачи в этой доске завершены")
                        }
                        CategoryColorPicker(newStatusColor) { newStatusColor = it }
                    }
                    "category" -> {
                        OutlinedTextField(newCategoryTitle, { newCategoryTitle = it },
                            label = { Text(if (en) "Category name" else "Название категории") }, modifier = Modifier.fillMaxWidth())
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            categoryColors.forEach { color -> FilterChip(selected = newCategoryColor == color,
                                onClick = { newCategoryColor = color }, label = { Text("●", color = Color(android.graphics.Color.parseColor(color))) }) }
                        }
                    }
                    "invite" -> {
                        Text(if (en) "The invitation appears in GENESIS. Email notifications will be added later." else "Приглашение появится в GENESIS. Email-оповещения добавим позже.", style = MaterialTheme.typography.bodySmall)
                        OutlinedTextField(inviteEmail, { inviteEmail = it }, label = { Text("Gmail") }, modifier = Modifier.fillMaxWidth())
                        Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            listOf("member", "viewer").forEach { value ->
                                FilterChip(selected = inviteRole == value, onClick = { inviteRole = value },
                                    label = { Text(sharedRoleLabel(value, en)) })
                            }
                        }
                    }
                }
            } },
            confirmButton = { if (modal != "join") Button(onClick = { run {
                when (modal) {
                    "space" -> {
                        val created = controller.createSharedSpace(spaceTitle.trim()).getJSONObject("space")
                        spaceTitle = ""; refreshSpaces(); spaceId = created.getString("id")
                    }
                    "project" -> {
                        val created = controller.createSharedProject(spaceId, projectTitle.trim(), projectDescription.trim(),
                            "list", parentId.ifBlank { null },
                            createKind, parentBoardId.ifBlank { null }).getJSONObject("project")
                        projectTitle = ""; projectDescription = ""; parentId = ""; parentBoardId = ""
                        refreshSpaces(); refreshProjects(spaceId); projectId = created.getString("id"); persistExpansion(expandedIds + projectId)
                    }
                    "task" -> {
                        check(canEditTask && newCustomBinding?.valid == true) { "CUSTOM_FIELD_UNAVAILABLE" }
                        val fields = createCustom.fields(requireNotNull(newCustomBinding)).put("title", taskTitle.trim())
                            .put("description", newTaskDescription.trim()).put("entryType", newTaskEntryType)
                            .put("dueDate", newTaskDueDate.ifBlank { null } ?: JSONObject.NULL)
                            .put("statusId", newTaskStatusId)
                            .put("categoryId", newTaskCategoryId.ifBlank { null } ?: JSONObject.NULL)
                            .put("assigneeId", newTaskAssigneeId.ifBlank { null } ?: JSONObject.NULL)
                        val conversionJournal = if (taskExtensions.conversionMap.isNotBlank()) {
                            fields.put("mindmapSource", JSONObject().put("mapId", taskExtensions.conversionMap).put("nodeId", taskExtensions.conversionNode))
                            val application = context.applicationContext as ru.genesis.calendar.GenesisApplication
                            ru.genesis.calendar.data.SharedMindmapConversionJournal(application.database,
                                ru.genesis.calendar.auth.SharedMindmapProtocol.scope(application.workspaceScope, spaceId)).also {
                                it.intent(taskExtensions.conversionMap, taskExtensions.conversionNode, projectId, fields)
                            }
                        } else null
                        val created = controller.createSharedTask(projectId, fields)
                        if (conversionJournal != null && !created.getJSONObject("task").optBoolean("pending")) {
                            conversionJournal.acknowledge(taskExtensions.conversionMap, taskExtensions.conversionNode, created.getJSONObject("task"))
                        }
                        if (conversionJournal != null) {
                            taskExtensions.mindmapsOpen = true; taskExtensions.conversionMap = ""; taskExtensions.conversionNode = ""
                        }
                        createCustom.reset(preferences)
                        taskTitle = ""; newTaskDescription = ""; newTaskDueDate = ""
                        newTaskStatusId = ""; newTaskCategoryId = ""; newTaskAssigneeId = ""
                        pendingTasks = controller.queuedSharedTasks(projectId)
                        if (created.getJSONObject("task").optBoolean("pending")) {
                            message = if (en) "Task saved on this device and waiting for the connection."
                                else "Задача сохранена на устройстве и ожидает подключения к сети."
                        } else refreshProject(projectId)
                    }
                    "status" -> {
                        controller.createSharedBoard(projectId, newStatusTitle.trim(), newStatusDone, newStatusColor, boardRequestId)
                        newStatusTitle = ""; newStatusDone = false; newStatusColor = "#2d6c68"; refreshProject(projectId)
                    }
                    "category" -> {
                        controller.createSharedCategory(projectId, newCategoryTitle.trim(), newCategoryColor)
                        newCategoryTitle = ""; refreshProject(projectId)
                    }
                    "invite" -> {
                        controller.inviteSharedSpaceMember(spaceId, inviteEmail.trim(), if (inviteRole == "viewer") "guest" else "member")
                        inviteEmail = ""
                        message = if (en) "The invitation is now in the recipient's account." else "Приглашение появилось в личном кабинете получателя."
                    }
                }
                createModal = null
            } }, modifier = Modifier.heightIn(min = 48.dp).testTag("shared-create-confirm"), enabled = !busy && when (modal) {
                "space" -> spaceTitle.isNotBlank() && sharedRootProjectSlotAvailable(ownedProjectQuota)
                "project" -> projectTitle.isNotBlank() && (parentId.isNotBlank() ||
                    sharedRootProjectSlotAvailable(spaces.firstOrNull { it.optString("id") == spaceId }?.optJSONObject("projectQuota")))
                "task" -> canEditTask && taskTitle.isNotBlank() && statuses.isNotEmpty() && validDate && newCustomBinding?.valid == true &&
                    project?.optString("archivedAt")?.let { it.isNotBlank() && it != "null" } != true
                "status" -> newStatusTitle.isNotBlank() && statuses.size < 30 && validCategoryColor(newStatusColor)
                "category" -> newCategoryTitle.isNotBlank() && categories.size < 50
                else -> inviteEmail.trim().lowercase(Locale.ROOT).let { it.endsWith("@gmail.com") || it.endsWith("@googlemail.com") }
            }) { Text(when (modal) {
                "task" -> "Добавить задачу"
                "project" -> if (createKind == "task-list") "Создать список задач" else "Создать проект"
                "space" -> "Создать пространство"
                "invite" -> "Пригласить"
                "status" -> "Создать доску"
                else -> "Создать категорию"
            }) } },
            dismissButton = { TextButton(onClick = {
                createModal = null
                if (taskExtensions.conversionMap.isNotBlank()) {
                    taskExtensions.mindmapsOpen = true; taskExtensions.conversionMap = ""; taskExtensions.conversionNode = ""
                }
            }, enabled = !busy) {
                Text(if (en) "Cancel" else "Отмена")
            } })
    }
    failedDraft?.let { draft -> AlertDialog(onDismissRequest = { if (!busy) failedDraft = null },
        title = { Text(if (en) "Saved team draft" else "Сохранённый черновик команды") },
        text = { Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text(if (en) "This change could not be sent. Your draft is kept on this device."
                else "Изменение не удалось отправить. Черновик сохранён на устройстве.")
            UntranslatedText(customFailureMessages[draft.optString("error")]?.takeIf { it.isNotBlank() }
                ?: workflowMessage(draft.optString("error"), workflowCopy) ?: draft.optString("error"), style = MaterialTheme.typography.bodySmall)
            if (messageIsError && message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.error)
            SelectionContainer { UntranslatedText(draft.optJSONObject("body")?.toString(2).orEmpty(),
                Modifier.heightIn(max = 240.dp).verticalScroll(rememberScrollState())) }
        } },
        confirmButton = { DialogActionRow(
            DialogIconAction("Повторить", AffairsAction.REFRESH, { run {
                controller.retryFailedSharedMutation(draft.getString("requestId"))
                pendingTasks = controller.queuedSharedTasks(projectId)
                failedDraft = null
                refreshProject(projectId)
            } }, enabled = !busy, modifier = Modifier.testTag("shared-pending-retry")),
            DialogIconAction("Удалить локальный черновик", AffairsAction.DELETE, { run {
                controller.discardFailedSharedMutation(draft.getString("requestId"))
                pendingTasks = controller.queuedSharedTasks(projectId)
                failedDraft = null
            } }, enabled = !busy, destructive = true),
            DialogIconAction("Закрыть", AffairsAction.BACK, { failedDraft = null }, enabled = !busy)
        ) }) }
    val chooseBoardImage = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        val target = pendingImageBoard
        pendingImageBoard = null
        if (uri != null && target != null) scope.launch {
            try {
                val selectedImage = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
                    val mime = context.contentResolver.getType(uri).orEmpty()
                    require(mime in setOf("image/png", "image/jpeg", "image/webp")) { "Выберите PNG, JPG или WebP." }
                    val bytes = context.contentResolver.openInputStream(uri)?.use { input ->
                        val out = java.io.ByteArrayOutputStream()
                        val buffer = ByteArray(8192)
                        while (true) {
                            val count = input.read(buffer)
                            if (count < 0) break
                            require(out.size() + count <= 500_000) { "Изображение должно быть не больше 500 КБ." }
                            out.write(buffer, 0, count)
                        }
                        out.toByteArray()
                    } ?: throw IllegalArgumentException("Не удалось прочитать изображение.")
                    val value = "data:$mime;base64," + android.util.Base64.encodeToString(bytes, android.util.Base64.NO_WRAP)
                    require(genesisImageBitmap(value, 600) != null) { "Не удалось открыть изображение." }
                    value
                }
                if (projectId == target.first && boardDraft?.optString("id") == target.second) boardImage = selectedImage
            } catch (error: Exception) { if (error is kotlinx.coroutines.CancellationException) throw error; message = error.message ?: "Не удалось загрузить изображение." }
        }
    }
    boardDraft?.let { board ->
        val onlyDone = board.optInt("isDone") == 1 && statuses.count { it.optInt("isDone") == 1 } == 1
        AlertDialog(onDismissRequest = { if (!busy) boardDraft = null },
            title = { Text(if (en) "Board settings" else "Настройки доски") },
            text = { Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(statusTitleDraft, { statusTitleDraft = it }, label = { Text(if (en) "Name" else "Название") }, modifier = Modifier.fillMaxWidth().testTag("shared-board-title-input"))
                Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Checkbox(boardDone, onCheckedChange = { boardDone = it }, enabled = !onlyDone || !boardDone)
                    Text(if (en) "Completed tasks" else "Завершённые задачи")
                }
                Text(if (en) "Color" else "Цвет", style = MaterialTheme.typography.titleSmall)
                CategoryColorPicker(boardColor) { boardColor = it }
                OutlinedTextField(boardImage.takeUnless { it.startsWith("data:") }.orEmpty(), { boardImage = it },
                    label = { Text(if (en) "Image URL (HTTPS)" else "Ссылка на изображение (HTTPS)") }, modifier = Modifier.fillMaxWidth())
                OutlinedButton(onClick = {
                    pendingImageBoard = projectId to board.getString("id")
                    chooseBoardImage.launch("image/*")
                }, enabled = !busy) {
                    Text(if (en) "Upload image" else "Загрузить изображение")
                }
                Text(if (en) "PNG, JPG or WebP · up to 500 KB" else "PNG, JPG или WebP · до 500 КБ", style = MaterialTheme.typography.bodySmall)
                SharedBoardImage(boardImage)
                if (boardImage.isNotBlank()) TextButton(onClick = { boardImage = "" }) { Text(if (en) "Remove image" else "Убрать изображение") }
                if (message.isNotBlank()) Text(message, color = MaterialTheme.colorScheme.error)
                if (statuses.size > 1 && !onlyDone) {
                    Text(if (en) "Move contents to" else "Перенести содержимое в", style = MaterialTheme.typography.titleSmall)
                    val destinations = statuses.filter { it.getString("id") != board.getString("id") }
                    val destination = statusDestinations[board.getString("id")] ?: destinations.first().getString("id")
                    Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        destinations.forEach { target -> FilterChip(destination == target.getString("id"),
                            onClick = { statusDestinations = statusDestinations + (board.getString("id") to target.getString("id")) },
                            label = { Text(target.getString("title")) }) }
                    }
                    TextButton(onClick = { boardDraft = null; statusToDelete = board }, enabled = !busy) { Text(if (en) "Delete board" else "Удалить доску") }
                }
            } },
            confirmButton = { TextButton(onClick = { run {
                controller.updateSharedBoard(projectId, board.getString("id"), JSONObject()
                    .put("title", statusTitleDraft.trim()).put("color", boardColor).put("imageUrl", boardImage.trim())
                    .put("isDone", boardDone).put("expectedRevision", board.getInt("revision")))
                boardDraft = null; refreshProject(projectId)
            } }, enabled = !busy && statusTitleDraft.isNotBlank() && validCategoryColor(boardColor) && (boardImage.isBlank() || boardImage.startsWith("https://") || boardImage.startsWith("data:image/"))) {
                Text(if (en) "Save" else "Сохранить")
            } },
            dismissButton = { TextButton(onClick = { boardDraft = null }, enabled = !busy) { Text(if (en) "Cancel" else "Отмена") } })
    }

    val googleCopySettings: @Composable () -> Unit = {
            SharedBlock(if (en) "My Google copies" else "Мои копии в Google") {
                Text(if (en) "Only you can enable copies in your Google account. The team task stays in GENESIS."
                    else "Только вы можете включить копии в своём Google-аккаунте. Общая задача остаётся в GENESIS.",
                    style = MaterialTheme.typography.bodySmall)
                Text(if (en) "Copies include the project name and each task's title, due date and status. Descriptions and member details stay in GENESIS."
                    else "В копию попадают название проекта, название, срок и статус задачи. Описание и сведения об участниках остаются в GENESIS.",
                    style = MaterialTheme.typography.bodySmall)
                val google = googleSettings
                if (google == null) WorkspaceLoadingText(if (en) "Loading Google options…" else "Загружаем настройки Google…")
                else {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(if (en) "Copy to my Google Tasks" else "Копировать в мои Google Tasks", modifier = Modifier.weight(1f))
                        Switch(checked = google.optBoolean("tasksEnabled"),
                            enabled = !busy && (google.optBoolean("tasksAvailable") || google.optBoolean("tasksEnabled")),
                            onCheckedChange = { enabled -> run {
                                val settings = controller.updateSharedGoogleSettings(projectId, enabled,
                                    google.optBoolean("calendarEnabled")).getJSONObject("settings")
                                googleSettings = settings
                                if (enabled) controller.syncSharedGoogle(projectId)
                                googleMessage = if (enabled) {
                                    if (en) "Google Tasks copies updated" else "Копии Google Tasks обновлены"
                                } else if (en) "Sync is off. Existing Google copies remain in your account."
                                else "Синхронизация выключена. Созданные копии остаются в вашем Google-аккаунте."
                            } }, modifier = Modifier.testTag("shared-google-tasks-toggle"))
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(if (en) "Show in my Google Calendar" else "Показывать в моём Google Calendar", modifier = Modifier.weight(1f))
                        Switch(checked = google.optBoolean("calendarEnabled"),
                            enabled = !busy && (google.optBoolean("calendarAvailable") || google.optBoolean("calendarEnabled")),
                            onCheckedChange = { enabled -> run {
                                val settings = controller.updateSharedGoogleSettings(projectId,
                                    google.optBoolean("tasksEnabled"), enabled).getJSONObject("settings")
                                googleSettings = settings
                                if (enabled) controller.syncSharedGoogle(projectId)
                                googleMessage = if (enabled) {
                                    if (en) "Google Calendar copies updated" else "Копии Google Calendar обновлены"
                                } else if (en) "Sync is off. Existing Google copies remain in your account."
                                else "Синхронизация выключена. Созданные копии остаются в вашем Google-аккаунте."
                            } }, modifier = Modifier.testTag("shared-google-calendar-toggle"))
                    }
                    if (!google.optBoolean("tasksAvailable") || !google.optBoolean("calendarAvailable"))
                        Text(if (en) "Connect the corresponding Google service in account settings to enable its copy."
                            else "Для включения копии подключите соответствующий сервис Google в настройках аккаунта.",
                            style = MaterialTheme.typography.bodySmall)
                    if (google.optBoolean("tasksEnabled") || google.optBoolean("calendarEnabled"))
                        TextButton(onClick = { run {
                            val result = controller.syncSharedGoogle(projectId)
                            googleMessage = if (en) "Google copies updated: ${result.optInt("synced")}."
                                else "Копии Google обновлены: ${result.optInt("synced")}."
                        } }, enabled = !busy) { Text(if (en) "Update copies now" else "Обновить копии сейчас") }
                }
                if (googleMessage.isNotBlank()) Text(googleMessage, style = MaterialTheme.typography.bodySmall)
            }
    }

    if (showManagement && project != null) SharedManagementDialog(
        title = if (managementPage == "project") (if (en) "Project settings" else "Настройки проекта") else (if (en) "Team" else "Команда"),
        onClose = { showManagement = false }, enabled = !busy) {
            if (managementPage == "project") {
            AffairsDisclosure("Проверка выполненных задач") { SharedTaskReviewSettingsPanel(controller, projectId, busy) }
            if (canInvite && project.optInt("isInbox") == 0) {
                Text(if (en) "Project settings" else "Настройки проекта", style = MaterialTheme.typography.titleMedium)
                OutlinedTextField(editTitle, { editTitle = it }, label = { Text(if (en) "Name" else "Название") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(editDescription, { editDescription = it }, label = { Text(if (en) "Description" else "Описание") }, modifier = Modifier.fillMaxWidth())
                Text(if (en) "Parent project" else "Родительский проект", style = MaterialTheme.typography.titleSmall)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    FilterChip(selected = editParentId.isBlank(), onClick = { editParentId = "" }, label = { Text(if (en) "Top level" else "Верхний уровень") })
                    projects.filter { it.optInt("isInbox") == 0 && it.getString("id") != projectId }.forEach { item ->
                        FilterChip(selected = editParentId == item.getString("id"), onClick = { editParentId = item.getString("id") },
                            label = { Text(item.getString("title")) })
                    }
                }
                Button(onClick = { run {
                    controller.updateSharedProject(projectId, JSONObject()
                        .put("title", editTitle.trim()).put("description", editDescription.trim())
                        .put("layout", project.optString("layout", "list"))
                        .put("parentId", editParentId.ifBlank { null } ?: JSONObject.NULL)
                        .put("expectedRevision", project.getInt("revision")))
                    refreshProjects(spaceId); refreshProject(projectId)
                } }, enabled = !busy && editTitle.isNotBlank()) { Text(if (en) "Save project" else "Сохранить проект") }
                if (role == "owner") TextButton(onClick = { projectToArchive = projectId }, enabled = !busy) {
                    Text(if (en) "Archive project" else "Архивировать проект")
                }
            }
            if (canInvite) {
                Text(if (en) "Project categories" else "Категории проекта", style = MaterialTheme.typography.titleMedium)
                categories.forEach { category -> ElevatedCard(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(8.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text("●", color = runCatching { Color(android.graphics.Color.parseColor(category.optString("color"))) }
                                .getOrDefault(MaterialTheme.colorScheme.secondary))
                            Text(category.optString("title"))
                        }
                        if (editingCategoryId == category.optString("id")) {
                            OutlinedTextField(categoryTitleDraft, { categoryTitleDraft = it },
                                label = { Text(if (en) "Category name" else "Название категории") }, modifier = Modifier.fillMaxWidth())
                            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                                categoryColors.forEach { color -> FilterChip(selected = categoryColorDraft == color,
                                    onClick = { categoryColorDraft = color }, label = {
                                        Text("●", color = Color(android.graphics.Color.parseColor(color)))
                                    }) }
                            }
                            Button(onClick = { run {
                                controller.updateSharedCategory(projectId, category.getString("id"),
                                    categoryTitleDraft.trim(), categoryColorDraft, category.getInt("revision"))
                                editingCategoryId = ""; refreshProject(projectId)
                            } }, enabled = !busy && categoryTitleDraft.isNotBlank()) { Text(if (en) "Save category" else "Сохранить категорию") }
                        } else TextButton(onClick = {
                            editingCategoryId = category.getString("id")
                            categoryTitleDraft = category.optString("title")
                            categoryColorDraft = category.optString("color")
                        }) { Text(if (en) "Edit" else "Редактировать") }
                        TextButton(onClick = { categoryToDelete = category }, enabled = !busy) {
                            Text(if (en) "Delete category" else "Удалить категорию")
                        }
                    }
                } }
                Button(onClick = { createModal = "category" }, enabled = !busy && categories.size < 50) {
                    Text(if (en) "Create category" else "Создать категорию")
                }
            }
            googleCopySettings()
            } else {

            members.forEach { member ->
                Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceContainerLow) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    UntranslatedText(member.optString("displayName"), style = MaterialTheme.typography.titleMedium)
                    if (project.optString("spaceRole") == "owner") {
                        SharedMemberRoleField(if (en) "Workspace access" else "Доступ к пространству", member.optString("spaceRole"),
                            listOf("owner", "admin", "member", "guest"), en, !busy, "shared-member-space-${member.getString("userId")}") { value -> run {
                            controller.changeSharedSpaceRole(spaceId, member.getString("userId"), value)
                            refreshProject(projectId); refreshProjects(spaceId)
                        } }
                    } else {
                        Text(if (en) "Workspace access" else "Доступ к пространству", style = MaterialTheme.typography.labelMedium)
                        Text(sharedRoleLabel(member.optString("spaceRole"), en))
                    }
                    if (project.optString("spaceRole") == "owner" &&
                        member.optString("spaceRole") !in setOf("owner", "admin")) {
                        Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).toggleable(member.optBoolean("canOrganizeTasks"),
                            enabled = !busy, role = Role.Checkbox, onValueChange = { enabled -> run {
                                    controller.changeSharedSpaceRole(spaceId, member.getString("userId"),
                                        member.optString("spaceRole"), enabled)
                                    refreshProject(projectId)
                                } }), verticalAlignment = Alignment.CenterVertically) {
                            Checkbox(checked = member.optBoolean("canOrganizeTasks"), enabled = !busy, onCheckedChange = null)
                            Text(if (en) "Can organize tasks" else "Может распределять задачи", Modifier.weight(1f))
                        }
                    }
                    if (role == "owner" && project.optInt("isInbox") == 0) {
                        SharedMemberRoleField(if (en) "Project role" else "Роль в проекте", member.optString("role"),
                            listOf("owner", "manager", "member", "commenter", "viewer"), en, !busy,
                            "shared-member-project-${member.getString("userId")}") { value -> run {
                            controller.changeSharedMemberRole(projectId, member.getString("userId"), value)
                            refreshProject(projectId)
                        } }
                        TextButton(onClick = { memberToRemove = member.getString("userId") },
                            enabled = !busy && !(member.optString("role") == "owner" && members.count { it.optString("role") == "owner" } == 1)) {
                            Text(if (en) "Remove participant" else "Удалить участника", color = MaterialTheme.colorScheme.error)
                        }
                    } else Text(sharedRoleLabel(member.optString("role"), en))
                } }
            }

            if (spaces.firstOrNull { it.optString("id") == spaceId }?.optString("role") in setOf("owner", "admin")) {
                Button(onClick = { showManagement = false; createModal = "invite" }, enabled = !busy) {
                    Text(if (en) "Invite with Gmail" else "Пригласить по Gmail")
                }
            }

            }
        }
    if (filtersOpen) key(projectId) {
        SharedTaskListFilterDialog(statusFilter, completionFilter, assigneeFilter, priorityFilter, statuses, members,
            listContext.query, listContext.catalog.fields, { filtersOpen = false }) { status, completion, assignee, priority ->
            statusFilter = status; completionFilter = completion; assigneeFilter = assignee; priorityFilter = priority; filtersOpen = false
        }
    }
    val currentSpace = spaces.firstOrNull { it.optString("id") == spaceId }
    val spaceCanCreate = currentSpace?.optString("role") in setOf("owner", "admin", "member")
    val filterCount = listOf(statusFilter.isNotBlank(), completionFilter != "any",
        assigneeFilter.isNotBlank(), priorityFilter >= 0).count { it } + listContext.query.count
    val dateValid = editTaskDueDate.isBlank() || runCatching { LocalDate.parse(editTaskDueDate) }.isSuccess
    val saveTask: () -> Unit = { run {
        val current = requireNotNull(selectedTask)
        check(canEditTask && !taskPending && !taskArchived && taskFieldsChanged && estimateDraft?.valid != false &&
            customDraft?.valid == true && sharedTaskCoreResolved(editTaskDetails) && sharedTaskChecklistsValid(editTaskDetails) && (estimateDraft?.dirty != true || planningEnabled) && current.optInt("revision") == editTaskRevision)
        val fields = sharedTaskDetailChanges(current, editTaskDetails, planningEnabled, customDraft.fields)
            .put("title", editTaskTitle.trim()).put("description", editTaskDescription.trim())
            .put("dueDate", editTaskDueDate.ifBlank { null } ?: JSONObject.NULL)
            .put("categoryId", editTaskCategoryId.ifBlank { null } ?: JSONObject.NULL)
            .put("expectedRevision", editTaskRevision)
        val changed = controller.updateSharedTask(projectId, taskId, fields).getJSONObject("task")
        pendingTasks = controller.queuedSharedTasks(projectId)
        if (changed.optBoolean("pending")) {
            openedTask = sharedPendingTask(current, changed, fields)
            message = if (en) "Change saved on this device. It will sync when connected."
                else "Изменение сохранено на устройстве и синхронизируется после подключения."
        } else {
            require(changed.optString("id") == taskId && changed.optString("projectId") == projectId) { "PLANNING_TASK_ACK_INVALID" }
            val inputCalendar = editTaskDetails.optJSONObject(SHARED_CUSTOM_CALENDAR_KEY)
            editTaskRevision = changed.getInt("revision"); editTaskDetails = sharedTaskDetailDraft(changed, preferences)
                .apply { if (inputCalendar != null) put(SHARED_CUSTOM_CALENDAR_KEY, inputCalendar) }
            editTaskTitle = changed.optString("title"); editTaskDescription = changed.optString("description")
            editTaskDueDate = changed.optString("dueDate").takeUnless { it == "null" }.orEmpty()
            editTaskCategoryId = changed.optString("categoryId").takeUnless { it == "null" }.orEmpty()
            openedTask = changed
            refreshProject(projectId); message = if (en) "Task saved." else "Задача сохранена."
            taskEditing = false
        }
    } }
    val openRelatedTask: (String, String) -> Unit = { targetProject, targetTask ->
        if (!busy && !taskDraftChanged && !taskPending) {
            if (targetProject != projectId) selectProject(targetProject)
            taskId = targetTask; draftTaskKey = ""; openedTask = null
        }
    }
    if (taskExtensions.mindmapsOpen && createModal == null) {
        SharedMindmapsScreen(controller, spaceId, projectId.ifBlank { null }, preferences,
            onClose = { taskExtensions.mindmapsOpen = false },
            onTask = { targetProject, targetTask -> taskExtensions.mindmapsOpen = false; openRelatedTask(targetProject, targetTask) },
            onProject = { targetProject -> taskExtensions.mindmapsOpen = false; selectProject(targetProject) },
            onConvert = { request ->
                if (projectId != request.projectId) selectProject(request.projectId)
                taskExtensions.conversionMap = request.mapId; taskExtensions.conversionNode = request.nodeId
                newTaskEntryType = "task"; taskTitle = request.title; newTaskDescription = ""; newTaskDueDate = ""; newTaskStatusId = ""
                newTaskCategoryId = ""; newTaskAssigneeId = ""; createCustomProjectId = request.projectId; createModal = "task"
            })
        return
    }
    if (taskExtensions.lifecycleOpen) {
        SharedTaskLifecycleScreen(controller, spaceId, projects + archivedProjects, onClose = { taskExtensions.lifecycleOpen = false },
            onChanged = { refreshProjects(spaceId); if (projectId.isNotBlank()) refreshProject(projectId) },
            onOpen = { targetProject, targetTask ->
                taskExtensions.lifecycleOpen = false
                if (projectId != targetProject) selectProject(targetProject)
                taskExtensions.archivedTaskId = targetTask; taskId = targetTask; draftTaskKey = ""; openedTask = null
            }, onWorkflow = { workflowProject = it; taskExtensions.lifecycleOpen = false }, page = taskExtensions.lifecyclePage)
        return
    }
    taskExtensions.lifecycleAction?.let { (action, current) ->
        SharedTaskLifecycleActionDialog(controller, action, current, onClose = { taskExtensions.lifecycleAction = null }, onChanged = {
            refreshProjects(spaceId)
            if (taskId == current.optString("id")) { taskId = ""; draftTaskKey = ""; openedTask = null; taskExtensions.archivedTaskId = "" }
            if (projectId.isNotBlank()) refreshProject(projectId)
        })
    }
    val spacesHeaderInShell = LocalWorkspaceHeader.current != null
    val projectToolbar = project != null && project.optInt("isInbox") == 0 && taskId.isBlank()
    val spaceToolbar = spaceId.isNotBlank() && projectId.isBlank() && taskId.isBlank()
    fun closeActions() { actionsOpen = false; projectMenu = null }
    val savedViewsItem: @Composable () -> Unit = {
        DropdownMenuItem(text = { Text("Сохранённые представления") },
            leadingIcon = { GenesisLucideIcon("bookmark") },
            modifier = Modifier.testTag("shared-saved-views-open"), onClick = { closeActions(); automationDestination.views.value = true })
    }
    val actionItems: @Composable ColumnScope.(SharedProjectMenu?) -> Unit = { menu ->
        fun shows(group: SharedProjectMenu) = menu == null || menu == group

        if (spaceId.isNotBlank() && projectId.isBlank() && shows(SharedProjectMenu.TEAM)) DropdownMenuItem(text = { Text("Общие майндмепы") },
            leadingIcon = { AffairsActionIcon(AffairsAction.MINDMAP) },
            onClick = { closeActions(); taskExtensions.mindmapsOpen = true }, modifier = Modifier.testTag("shared-mindmaps-open"))
        if (spaceId.isNotBlank() && onPrivateMessages != null && shows(SharedProjectMenu.TEAM)) DropdownMenuItem(text = { Text("Личные сообщения") },
            leadingIcon = { AffairsActionIcon(AffairsAction.LINK) },
            onClick = { closeActions(); onPrivateMessages(spaceId) }, modifier = Modifier.testTag("shared-messages-open"))
        if (projectId.isNotBlank() && project?.optString("kind", "project") == "project" && onProjectChat != null && shows(SharedProjectMenu.TEAM)) DropdownMenuItem(text = { Text(messengerText("project")) },
            leadingIcon = { GenesisLucideIcon("message-circle") }, onClick = { closeActions(); onProjectChat(projectId) }, modifier = Modifier.testTag("shared-project-chat-open"))
        if (projectId.isNotBlank() && project?.optString("spaceRole") in setOf("owner", "admin") && shows(SharedProjectMenu.SETTINGS)) DropdownMenuItem(text = { Text("Пользовательские поля") },
                modifier = Modifier.testTag("shared-fields-open"), leadingIcon = { GenesisLucideIcon("file-text") },
                onClick = { closeActions(); automationDestination.fields.value = projectId })
        if (spaceId.isNotBlank() && shows(SharedProjectMenu.SETTINGS)) {
            DropdownMenuItem(text = { Text("Архив") }, leadingIcon = { AffairsActionIcon(AffairsAction.ARCHIVE) },
                onClick = { closeActions(); taskExtensions.lifecyclePage = "archive"; taskExtensions.lifecycleOpen = true }, modifier = Modifier.testTag("shared-archive-open"))
            DropdownMenuItem(text = { Text("Корзина") }, leadingIcon = { AffairsActionIcon(AffairsAction.DELETE) },
                onClick = { closeActions(); taskExtensions.lifecyclePage = "trash"; taskExtensions.lifecycleOpen = true }, modifier = Modifier.testTag("shared-trash-open"))
        }
        if (spaceId.isNotBlank() && projectId.isBlank() && shows(SharedProjectMenu.SETTINGS)) {
                DropdownMenuItem(text = { Text("Архив проектов") }, leadingIcon = { GenesisLucideIcon("archive") }, onClick = {
                    closeActions(); showArchived = !showArchived })
        }
        if (spaceId.isNotBlank() && shows(if (projectId.isBlank()) SharedProjectMenu.SETTINGS else SharedProjectMenu.WORK)) savedViewsItem()
        if (spaceId.isNotBlank() && shows(SharedProjectMenu.SETTINGS)) DropdownMenuItem(text = { Text("Экспорт данных") }, leadingIcon = { GenesisLucideIcon("download") },
            modifier = Modifier.testTag("shared-export-open"), enabled = canExchangeData, onClick = { closeActions(); dataExportOpen = true })
        if (projectId.isNotBlank()) {
            if (shows(SharedProjectMenu.WORK)) DropdownMenuItem(text = { Text("Шаблоны") }, modifier = Modifier.testTag("shared-templates-open"),
                leadingIcon = { AffairsActionIcon(AffairsAction.TEMPLATE) }, onClick = { closeActions(); templatesCaptureId = ""; templatesOpen = true })
            if (shows(SharedProjectMenu.WORK)) DropdownMenuItem(text = { Text("Массовые действия") }, enabled = listContext.valid, modifier = Modifier.testTag("shared-bulk-open"),
                leadingIcon = { GenesisLucideIcon("list-checks") }, onClick = {
                    closeActions(); bulkProjectId = projectId; bulkFilter = taskFilter.toString(); bulkSort = listContext.sort; bulkOpen = true
                })
            if (shows(SharedProjectMenu.WORK)) DropdownMenuItem(text = { Text("Автоматизации") }, modifier = Modifier.testTag("shared-automations-open"),
                leadingIcon = { AffairsActionIcon(AffairsAction.AUTOMATION) }, onClick = {
                    closeActions(); automationDestination.value = projectId
                })
            if (shows(SharedProjectMenu.SETTINGS)) DropdownMenuItem(text = { Text("Импорт данных") }, modifier = Modifier.testTag("shared-import-open"),
                leadingIcon = { AffairsActionIcon(AffairsAction.IMPORT) }, enabled = canExchangeData,
                onClick = { closeActions(); dataImportOpen = true })
            if (shows(SharedProjectMenu.TEAM)) DropdownMenuItem(text = { Text("Отчёт по совместной работе") }, modifier = Modifier.testTag("shared-team-report-open"),
                leadingIcon = { AffairsActionIcon(AffairsAction.REPORT) }, onClick = { closeActions(); teamReportOpen = true })
            if (project?.optString("spaceRole") == "owner" && shows(SharedProjectMenu.TEAM)) DropdownMenuItem(text = { Text("Доступ к проектам") }, modifier = Modifier.testTag("shared-project-access-open"),
                leadingIcon = { GenesisLucideIcon("key-round") }, onClick = { closeActions(); projectAccessOpen = true })
            if (project?.optInt("isInbox") == 0 && shows(SharedProjectMenu.WORK)) DropdownMenuItem(
                text = { UntranslatedText(sharedPlanningCopy().getString("heading")) },
                modifier = Modifier.testTag("shared-planning-open"),
                leadingIcon = { AffairsActionIcon(AffairsAction.CALENDAR) },
                onClick = { closeActions(); planningOpen = true })
            if (project?.optInt("isInbox") == 0 && shows(SharedProjectMenu.WORK)) DropdownMenuItem(
                text = { UntranslatedText(workflowCopy.getString("heading")) },
                modifier = Modifier.testTag("shared-workflow-open"),
                leadingIcon = { GenesisLucideIcon("git-branch") },
                onClick = { closeActions(); workflowProject = projectId })
            if (shows(SharedProjectMenu.SETTINGS)) DropdownMenuItem(text = { Text("Настройки проекта") }, leadingIcon = { AffairsActionIcon(AffairsAction.SETTINGS) }, onClick = {
                closeActions(); managementPage = "project"; showManagement = true })
            if (shows(SharedProjectMenu.TEAM)) DropdownMenuItem(text = { Text("Участники и роли") }, leadingIcon = { GenesisLucideIcon("users-round") }, onClick = {
                closeActions(); managementPage = "team"; showManagement = true })
        } else {
            if (spaceId.isBlank()) {
                DropdownMenuItem(text = { Text("Создать пространство") }, leadingIcon = { GenesisLucideIcon("folder-plus") }, enabled = !busy,
                    onClick = { closeActions(); createModal = "space" })
                DropdownMenuItem(text = { Text("Присоединиться к пространству") }, leadingIcon = { GenesisLucideIcon("link") }, enabled = !busy,
                    modifier = Modifier.testTag("shared-join-space"),
                    onClick = { closeActions(); createModal = "join" })
                if (shows(SharedProjectMenu.WORK)) savedViewsItem()
            }
            if (spaceId.isNotBlank()) {
                if (currentSpace?.optString("role") in setOf("owner", "admin") && shows(SharedProjectMenu.TEAM))
                    DropdownMenuItem(text = { Text("Пригласить через Gmail") }, leadingIcon = { GenesisLucideIcon("send") }, enabled = !busy,
                        modifier = Modifier.testTag("shared-invite-space"),
                        onClick = { closeActions(); createModal = "invite" })

            }
        }
    }
    val headerActions: @Composable (Boolean) -> Unit = { inShell ->
        if (taskId.isBlank() && projectToolbar) {
            SharedProjectMenu.entries.forEach { menu -> Box {
                AffairsIconButton(menu.title, menu.action, { projectMenu = menu }, Modifier.testTag(menu.tag))
                DropdownMenu(projectMenu == menu, { closeActions() }) { actionItems(menu) }
            } }
        } else if (spaceToolbar) {
            listOf(SharedProjectMenu.TEAM, SharedProjectMenu.SETTINGS).forEach { menu -> Box {
                AffairsIconButton(if (menu == SharedProjectMenu.TEAM) "Команда" else "Данные и архивы",
                    if (menu == SharedProjectMenu.TEAM) AffairsAction.TEAM else AffairsAction.ARCHIVE,
                    { projectMenu = menu }, Modifier.testTag(if (menu == SharedProjectMenu.TEAM) "shared-space-team" else "shared-space-data"))
                DropdownMenu(projectMenu == menu, { closeActions() }) { actionItems(menu) }
            } }
        } else if (taskId.isBlank()) Box {
            if (inShell && spacesHeaderInShell) WorkspaceHeaderButton(genesisTranslate("Дополнительные действия"),
                "shared-actions", onClick = { actionsOpen = true }) { GenesisLucideIcon("ellipsis") }
            else AffairsIconButton("Дополнительные действия", AffairsAction.MORE, { actionsOpen = true },
                Modifier.testTag("shared-actions"))
            DropdownMenu(actionsOpen, { closeActions() }) { actionItems(null) }
        }
    }
    val sharedHeaderTitle=when {
        taskId.isNotBlank()->if(en)"Task" else "Задача"
        projectId.isNotBlank()->project?.optString("title").orEmpty()
        spaceId.isNotBlank()->currentSpace?.optString("title").orEmpty()
        else->if(en)"Shared affairs" else "Общие дела"
    }
    val sharedHeaderSubtitle=when {
        taskId.isNotBlank()->project?.optString("title").orEmpty()
        projectId.isNotBlank()->currentSpace?.optString("title").orEmpty()+" · "+genesisTranslate(sharedRoleLabel(role,en))
        spaceId.isNotBlank()->if(en)"Shared affairs" else "Общие дела"
        else->if(en)"Workspaces and projects" else "Пространства и проекты"
    }
    val headerInShell = WorkspaceScreenHeader(sharedHeaderTitle,sharedHeaderSubtitle,
        navigation={if(spaceId.isNotBlank()) WorkspaceHeaderButton(genesisTranslate("Назад"),"shared-back",enabled=!busy,onClick={navigateBack()}) {AffairsActionIcon(AffairsAction.BACK)}},
        singleLine=spaceId.isNotBlank(),titleIsUserContent=taskId.isBlank()&&spaceId.isNotBlank(), showThemeToggle=spaceId.isBlank()) {
        if (!projectToolbar && !spaceToolbar) headerActions(true)
    }

    WorkspaceDragHost(Modifier.fillMaxSize().onGloballyPositioned {
        rootPosition = it.boundsInWindow().topLeft
        listViewport = it.boundsInWindow()
    }) {
    Column(Modifier.fillMaxSize().imePadding()) {
    Column(Modifier.weight(1f).fillMaxWidth().verticalScroll(pageScroll).padding(AffairsLayout.gutter).padding(bottom=if(projectId.isNotBlank()&&taskId.isBlank())112.dp else 0.dp)
        .testTag("shared-projects-screen"), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        if (!headerInShell) AffairsPageHeader(
            title = when {
                taskId.isNotBlank() -> if (en) "Task" else "Задача"
                projectId.isNotBlank() -> project?.optString("title").orEmpty()
                spaceId.isNotBlank() -> currentSpace?.optString("title").orEmpty()
                else -> if (en) "Shared affairs" else "Общие дела"
            },
            context = when {
                taskId.isNotBlank() -> project?.optString("title").orEmpty()
                projectId.isNotBlank() -> currentSpace?.optString("title").orEmpty() + " · " + genesisTranslate(sharedRoleLabel(role, en))
                spaceId.isNotBlank() -> if (en) "Projects" else "Проекты"
                else -> if (en) "Workspaces and projects" else "Пространства и проекты"
            }, icon = GenesisPageIcon.PROJECTS_SHARED,
            onBack = if (spaceId.isNotBlank()) ({ navigateBack() }) else null, backEnabled = !busy,
            titleIsUserContent = taskId.isBlank() && spaceId.isNotBlank(), contextIsUserContent = projectId.isNotBlank(),
            actions = { if (!projectToolbar && !spaceToolbar) headerActions(false) })
        if (offlineSnapshot) Text(if (en) "Offline: showing the last protected team snapshot."
            else "Нет связи: показана последняя защищённая копия команды.",
            modifier = Modifier.fillMaxWidth().testTag("shared-offline-status"),
            color = MaterialTheme.colorScheme.secondary)
        if (pendingTasks.isNotEmpty()) Surface(Modifier.fillMaxWidth().testTag("shared-pending-tasks"),
            shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surfaceVariant) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (en) "Waiting to send · ${pendingTasks.size}" else "Ожидают отправки · ${pendingTasks.size}",
                    style = MaterialTheme.typography.titleSmall)
                pendingTasks.forEach { item -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(item.optString("title") + if (item.optString("error").isBlank()) "" else
                        if (en) " · Needs attention" else " · Нужна проверка", Modifier.weight(1f))
                    if (item.optString("error").isNotBlank()) TextButton(onClick = { failedDraft = item }) { Text("Подробнее") }
                } }
            }
        }
        if (message.isNotBlank() && taskId.isBlank()) {
            if (templateAccessLost) UntranslatedText(templateIssueMessage("TEMPLATE_PERMISSION_CHANGED", templateCopy),
                modifier = Modifier.testTag("shared-feedback"), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            else Text(message, modifier = Modifier.testTag("shared-feedback"),
                color = if (messageIsError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
            retryMove?.let { (task,target,status) -> TextButton(onClick={moveTaskTo(task,target,status)},enabled=!busy) {Text("Повторить")} }
        }
        if (projectId.isBlank()) {
            if (spaceId.isBlank()) {
                if (spaces.isEmpty()) {
                    Text("В этом разделе пока нет проектов.", style = MaterialTheme.typography.bodyMedium)
                    Button(onClick = { createModal = "space" }, enabled = !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("shared-create-space")) {
                        Text("Создать пространство")
                    }
                    OutlinedButton(onClick = { createModal = "join" }, enabled = !busy,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("shared-join-space-empty")) {
                        Text("Присоединиться к пространству")
                    }
                }
                spaces.forEach { item ->
                    OutlinedCard(onClick = { spaceId = item.getString("id"); projectTrail = emptyList(); showArchived = false },
                        modifier = Modifier.fillMaxWidth().testTag("shared-space-${item.optString("id")}"),
                        shape = AffairsLayout.shape) {
                        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                            GenesisVectorIcon(GenesisPageIcon.PROJECTS_SHARED, Modifier.size(24.dp), MaterialTheme.colorScheme.primary)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                UntranslatedText(item.getString("title"), style = MaterialTheme.typography.titleMedium)
                                Text(sharedRoleLabel(item.optString("role"), en), style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            AffairsActionIcon(AffairsAction.NEXT)
                        }
                    }
                }
            } else {
                Row(Modifier.fillMaxWidth().testTag("shared-space-actions"),
                    horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                if (spaceCanCreate) Button(onClick = {
                    createKind = "project"; parentId = ""; parentBoardId = ""; createModal = "project"
                }, enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("shared-create-project"),
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)) {
                    Text("Создать общий проект", style = MaterialTheme.typography.labelLarge)
                }
                else Spacer(Modifier.weight(1f))
                headerActions(false)
                }
                val inboxLists=projects.filter {it.optString("kind")=="task-list"&&it.optString("parentId").let {parent->parent.isBlank()||parent=="null"||parent==inboxId}}
                if (showArchived) {
                    Text("Архив проектов", style = MaterialTheme.typography.titleMedium)
                    archivedProjects.forEach { item -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                        Text(item.optString("title"), modifier = Modifier.weight(1f))
                        AffairsIconButton(workflowCopy.getString("heading"), AffairsAction.SETTINGS,
                            { workflowProject = item.getString("id") }, Modifier.testTag("shared-workflow-archive-${item.getString("id")}"))
                        if (item.optString("role") == "owner") TextButton(onClick = { run {
                            controller.setSharedProjectArchived(item.getString("id"), false)
                            refreshProjects(spaceId); selectProject(item.getString("id"))
                        } }, enabled = !busy) { Text("Восстановить") }
                    } }
                    if (workflowRepairProjects.isNotEmpty()) {
                        Text("Корзина", style = MaterialTheme.typography.titleMedium)
                        workflowRepairProjects.forEach { item -> Row(verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                            UntranslatedText(item.getString("title"), Modifier.weight(1f))
                            AffairsIconButton(workflowCopy.getString("heading"), AffairsAction.SETTINGS,
                                { workflowProject = item.getString("id") }, Modifier.testTag("shared-workflow-trash-${item.getString("id")}"))
                        } }
                    }
                } else {
                    SharedProjectTree(projects.filterNot {it in inboxLists}, expandedIds, projectId, ::selectProject,
                        onToggle = { id -> persistExpansion(if (id in expandedIds) expandedIds - id else expandedIds + id) },
                        interaction = containerInteraction)
                    if (uiReadySpace == spaceId && projects.none { it.optInt("isInbox") == 0 })
                        Text("В этом разделе пока нет проектов.", style = MaterialTheme.typography.bodyMedium)
                }
                if (uiReadySpace != spaceId) AffairsLoading()
            }
        }
        if (projectId.isNotBlank() && dragProjectTargets && (draggingTask != null || draggingContainer != null)) {
            SharedProjectTree(projects,projects.map { it.getString("id") }.toSet(),projectId,::selectProject,{},interaction=containerInteraction)
        }
        if (projectId.isNotBlank() && project == null) AffairsLoading()
        if (project != null) {
            if (taskId.isBlank() && project.optInt("isInbox")==0) {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                val buttonCount = 5 + (if (canWrite) 1 else 0) + (if (canEditTask && statuses.isNotEmpty() || canWrite) 1 else 0)
                val buttonGap = 6.dp
                val buttonWidth = with(LocalDensity.current) {
                    kotlin.math.floor((maxWidth.toPx() - buttonGap.toPx() * (buttonCount - 1)) / buttonCount).toDp()
                }
                CompositionLocalProvider(LocalAffairsControlWidth provides buttonWidth,
                    LocalMinimumInteractiveComponentSize provides 0.dp) {
                Row(Modifier.fillMaxWidth().testTag("shared-create-actions"),
                    horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                    SharedMindmapButton { taskExtensions.mindmapsOpen = true }
                    SharedWorkspaceViewChoice(activeView, { viewOverride = it }, compact = true)
                    SharedWorkspaceCreateMenu(!busy, canEditTask && statuses.isNotEmpty(), canWrite,
                        onTask = { kind ->
                            newTaskEntryType = kind; newTaskStatusId = ""
                            newTaskCategoryId = ""; newTaskAssigneeId = ""; createCustomProjectId = projectId; createModal = "task"
                        }, onContainer = { kind ->
                            createKind = kind; parentId = projectId; parentBoardId = ""; createModal = "project"
                        })
                    if (canWrite) AffairsIconButton("Создать доску", AffairsAction.CREATE_BOARD, { createModal = "status" },
                        Modifier.testTag("shared-create-board"), enabled = !busy && statuses.size < 30)
                    headerActions(false)
                }
                }
                }

                SharedTaskListQueryStatus(listContext.reader, listContext.valid)
                SharedTaskFieldCriteria(listContext.query.criteria, listContext.catalog.fields, listContext.query.calendar) { listContext.query.remove(it) }
                if (filterCount > 0 || taskSearch.isNotBlank()) Row(Modifier.fillMaxWidth(),
                    verticalAlignment = androidx.compose.ui.Alignment.CenterVertically) {
                    Text(taskPage?.optInt("total")?.toString().orEmpty(), Modifier.weight(1f), style = MaterialTheme.typography.labelLarge)
                    AffairsIconButton("Сбросить фильтры", AffairsAction.UNDO, { statusFilter = ""; completionFilter = "any"; assigneeFilter = "";
                        priorityFilter = -1; taskSearch = ""; listContext.query.reset() }, Modifier.testTag("shared-reset-filters"))
                }
                if (filterCount > 0) FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (statusFilter.isNotBlank()) InputChip(true, { statusFilter = "" }, label = {
                        Text(statuses.firstOrNull { it.optString("id") == statusFilter }?.optString("title") ?: "Статус") })
                    if (completionFilter != "any") InputChip(true, { completionFilter = "any" }, label = {
                        Text(if (completionFilter == "open") "Незавершённые" else "Завершённые") })
                    if (assigneeFilter.isNotBlank()) InputChip(true, { assigneeFilter = "" }, label = {
                        Text(when (assigneeFilter) { "me" -> "Назначено мне"; "unassigned" -> "Без исполнителя"
                            else -> members.firstOrNull { it.optString("userId") == assigneeFilter }?.optString("displayName") ?: "Исполнитель" }) })
                    if (priorityFilter >= 0) InputChip(true, { priorityFilter = -1 }, label = {
                        Text(listOf("Без приоритета", "Низкий приоритет", "Средний приоритет", "Высокий приоритет")[priorityFilter]) })
                }
                if (taskPage == null && listContext.valid && listContext.reader.error.isBlank()) AffairsLoading()
                else if (activeView != "calendar" && taskPage != null && tasks.isEmpty()) Text("По вашему запросу ничего не найдено.", style = MaterialTheme.typography.bodyMedium)
                val children = projects.filter { it.optString("parentId") == projectId }
                val boardIds = statuses.map { it.getString("id") }.toSet()
                val unassigned = tasks.filter { it.optString("statusId") !in boardIds }
                val unassignedChildren = children.filter { it.optString("boardStatusId") !in boardIds }
                val renderTask: @Composable (JSONObject) -> Unit = { task ->
                    SharedTaskCard(task, statuses, canOrganize, busy, en, calendarMode,
                    onArchive = { taskExtensions.lifecycleAction = "archive" to task }, onTrash = { taskExtensions.lifecycleAction = "trash" to task },
                    customFields = listContext.catalog.fields, customCalendar = SharedCustomCalendar.initial(preferences).copy(mode = calendarMode),
                        category = categories.firstOrNull { it.optString("id") == task.optString("categoryId") },
                        completedBy = members.firstOrNull { it.optString("userId") == task.optString("completedBy") }?.optString("displayName"),
                    assignedTo = members.firstOrNull { it.optString("userId") == task.optString("assigneeId") }?.optString("displayName"),
                        onOpen = { taskId = task.getString("id") },
                        onTemplate = { templatesCaptureId = task.getString("id"); templatesCaptureTask = JSONObject(task.toString()); templatesOpen = true },
                        onMove = { destination -> moveTaskStatus(task, destination) },
                    onDragStart = { position -> draggingTask = task; draggingAt = position },
                    onDragMove = { amount -> draggingAt = (draggingAt ?: Offset.Zero) + amount },
                    onDragEnd = { finishDrag() },
                    onDragCancel = { draggingTask = null; draggingAt = null }, compact=activeView != "board")
                }
                val renderChild: @Composable (JSONObject) -> Unit = { child ->
                    OutlinedButton(onClick = { selectProject(child.getString("id")) }, modifier = Modifier.fillMaxWidth().then(containerInteraction(child))
                        .testTag("shared-list-child-${child.optString("id")}")) {
                        AffairsActionIcon(if (child.optString("kind") == "task-list") AffairsAction.TASK_LIST else AffairsAction.PROJECT)
                        Spacer(Modifier.width(8.dp)); UntranslatedText(child.optString("title"), Modifier.weight(1f))
                    }
                }
                val projectInbox: @Composable () -> Unit = {
                    SharedChaosBox(unassigned.size, unassignedChildren.size, projectInboxLayout, setProjectInboxLayout,
                        Modifier.onGloballyPositioned { dropBounds["board:"] = it.boundsInWindow() }) {
                        if (unassigned.isEmpty() && unassignedChildren.isEmpty()) Text("Задач без списка пока нет.", style = MaterialTheme.typography.bodyMedium)
                        unassignedChildren.forEach { renderChild(it) }
                        unassigned.forEach { renderTask(it) }
                    }
                }
            if (activeView == "gantt") key(projectId) {
                SharedGanttView(tasks.map { task -> if (sharedTaskHasPending(task.optString("id"), pendingTasks))
                    JSONObject(task.toString()).put("pending", true) else task }, statuses,
                    calendarMode, preferences.input, preferences.use24, canEditTask, busy,
                    onOpen = { task -> taskId = task.getString("id") },
                    onSchedule = { task, changes ->
                        val ownerProject = task.getString("projectId")
                        val ownerTask = task.getString("id")
                        check(ownerProject == projectId && canEditTask && !busy &&
                            !sharedTaskHasPending(ownerTask, pendingTasks) && !task.optBoolean("pending"))
                        val patch = JSONObject(changes.toString()).put("expectedRevision", task.getInt("revision"))
                        val changed = controller.updateSharedTask(ownerProject, ownerTask, patch).getJSONObject("task")
                        require(changed.optString("id") == ownerTask && changed.optString("projectId") == ownerProject)
                        if (projectId == ownerProject) {
                            pendingTasks = controller.queuedSharedTasks(ownerProject)
                            val updated = if (changed.optBoolean("pending")) sharedPendingTask(task, changed, patch) else changed
                            taskPage = taskPage?.let { page -> JSONObject(page.toString()).put("tasks",
                                JSONArray(page.optJSONArray("tasks")?.rows().orEmpty().map {
                                    if (it.optString("id") == ownerTask) updated else it
                                })) }
                            if (!changed.optBoolean("pending")) scope.launch { listContext.reader.refresh() }
                            else {
                                messageIsError = false
                                message = if (en) "Change saved on this device. It will sync when connected."
                                    else "Изменение сохранено на устройстве и синхронизируется после подключения."
                            }
                        }
                        if (changed.optBoolean("pending")) sharedPendingTask(task, changed, patch) else changed
                    }, gateway = controller, baseFilter = taskFilter, bounds = taskPage?.optJSONObject("bounds"),
                        onDragScroll = { pageScroll.dispatchRawDelta(it) })
            } else if (activeView == "calendar") {
                val locale = if (en) Locale.US else Locale.forLanguageTag("ru-RU")
                val range = calendarEngine.monthRange(calendarAnchor, calendarMode)
                val periodTitle = when (calendarMode) {
                    CalendarMode.PROFANE -> range.start.format(DateTimeFormatter.ofPattern("LLLL yyyy", locale))
                    CalendarMode.SACRED -> calendarEngine.sacredDate(range.start).let {
                        "${SacredCatalog.months[it.monthIndex].name} · ${it.sacredYear}–${it.sacredYear + 1}"
                    }
                    CalendarMode.LUNAR -> calendarEngine.lunarDate(range.start).let {
                        "${it.month.name} · ${it.year.sacredYear}–${it.year.sacredYear + 1}"
                    }
                }
                Surface(Modifier.fillMaxWidth(), shape = AffairsLayout.shape, color = MaterialTheme.colorScheme.surface) {
                    Row(Modifier.fillMaxWidth().padding(4.dp), verticalAlignment = Alignment.CenterVertically) {
                        AffairsIconButton("Предыдущий месяц", AffairsAction.BACK, { calendarAnchor = range.start.minusDays(1); calendarDay = calendarAnchor }, outlined = false)
                        Text(periodTitle, Modifier.weight(1f).testTag("shared-calendar-period").semantics { stateDescription = calendarMode.wireValue },
                            style = MaterialTheme.typography.titleMedium)
                        AffairsIconButton("Следующий месяц", AffairsAction.NEXT, { calendarAnchor = range.end.plusDays(1); calendarDay = calendarAnchor }, outlined = false)
                    }
                }
                SharedProjectCalendarGrid(calendarEngine, calendarAnchor, calendarMode, calendarDay, preferences.weekStartsOnSunday,
                    listContext.calendarCounts, { calendarDay = it }, calendarDropBounds, draggingAt,
                    tasks = listContext.calendarTasks, onTask = { taskId = it.getString("id") }, canEdit = canEditTask && !busy,
                    onTaskDragStart = { task, point -> draggingTask = task; draggingAt = point },
                    onTaskDragMove = { draggingAt = draggingAt?.plus(it) }, onTaskDragEnd = { finishDrag() },
                    onTaskDragCancel = { draggingTask = null; draggingAt = null })
                listContext.calendarReader?.let { reader ->
                    if (reader.pageState.value?.optBoolean("hasMore") == true) TextButton(enabled = !reader.busy,
                        onClick = { run { reader.more() } }, modifier = Modifier.testTag("shared-calendar-more")) { Text("Показать ещё") }
                    if (reader.error.isNotBlank()) TextButton(onClick = { run { reader.refresh() } }) { Text("Повторить") }
                }
                Text(calendarEngine.formatDate(calendarDay, calendarMode),
                    style = MaterialTheme.typography.titleMedium)
                val due = tasks.filter { it.optString("dueDate") == calendarDay.toString() }
                if (due.isEmpty()) Text(if (en) "No team tasks due this day." else "На этот день нет общих задач со сроком.",
                    style = MaterialTheme.typography.bodySmall)
                due.forEach { task -> SharedTaskCard(task, statuses, canOrganize, busy, en, calendarMode,
                    onArchive = { taskExtensions.lifecycleAction = "archive" to task }, onTrash = { taskExtensions.lifecycleAction = "trash" to task },
                    customFields = listContext.catalog.fields, customCalendar = SharedCustomCalendar.initial(preferences).copy(mode = calendarMode),
                    category = categories.firstOrNull { it.optString("id") == task.optString("categoryId") },
                    completedBy = members.firstOrNull { it.optString("userId") == task.optString("completedBy") }?.optString("displayName"),
                    assignedTo = members.firstOrNull { it.optString("userId") == task.optString("assigneeId") }?.optString("displayName"),
                    onOpen = { taskId = task.getString("id") },
                        onTemplate = { templatesCaptureId = task.getString("id"); templatesCaptureTask = JSONObject(task.toString()); templatesOpen = true },
                    onMove = { destination -> moveTaskStatus(task, destination) },
                    onDragStart = { position -> draggingTask = task; draggingAt = position },
                    onDragMove = { amount -> draggingAt = (draggingAt ?: Offset.Zero) + amount },
                    onDragEnd = { finishDrag() },
                    onDragCancel = { draggingTask = null; draggingAt = null }) }
                Surface(Modifier.fillMaxWidth().testTag("shared-calendar-undated"), shape = AffairsLayout.shape,
                    color = MaterialTheme.colorScheme.surfaceContainerLow) {
                    Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        TextButton(onClick = { showUndated = !showUndated }, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                            Text("Без срока", Modifier.weight(1f)); Text((undatedReader.pageState.value?.optInt("total") ?: 0).toString())
                            AffairsActionIcon(if (showUndated) AffairsAction.COLLAPSE else AffairsAction.EXPAND)
                        }
                        if (showUndated) {
                            if (canEditTask) Text("Удерживайте карточку и перенесите на день календаря.", style = MaterialTheme.typography.bodySmall)
                            if (undatedReader.error.isNotBlank()) {
                                Text("Не удалось загрузить задачи.", color = MaterialTheme.colorScheme.error)
                                TextButton(onClick = { run { undatedReader.refresh() } }) { Text("Повторить") }
                            } else if (undatedReader.pageState.value == null) AffairsLoading()
                            undatedReader.pageState.value?.optJSONArray("tasks")?.rows().orEmpty().forEach { task ->
                                SharedTaskCard(task, statuses, canOrganize, busy, en, calendarMode, null, null,
                                    onOpen = { taskId = task.getString("id") },
                        onTemplate = { templatesCaptureId = task.getString("id"); templatesCaptureTask = JSONObject(task.toString()); templatesOpen = true }, onMove = { destination -> moveTaskStatus(task, destination) },
                                    onDragStart = { point -> if (canEditTask && !sharedTaskHasPending(task.optString("id"), pendingTasks)) {
                                        draggingTask = task; draggingAt = point; dropBounds.clear()
                                    } }, onDragMove = { delta ->
                                        draggingAt = draggingAt?.plus(delta)
                                        // Follow the finger towards the grid while preserving every target's window coordinates.
                                        if (draggingAt != null && draggingAt!!.y < 220f) pageScroll.dispatchRawDelta(-20f)
                                    }, onDragEnd = { finishDrag() }, onDragCancel = { draggingTask = null; draggingAt = null }, compact = true)
                            }
                            if (undatedReader.pageState.value?.optBoolean("hasMore") == true) TextButton(enabled = !undatedReader.busy,
                                onClick = { run { undatedReader.more() } }) { Text("Показать ещё") }
                        }
                    }
                }
            } else if (activeView == "board") {
                if (!projectInboxLayout.atBottom) projectInbox()
                Text(if (en) "Swipe across the board to view all statuses."
                    else "Проведите по доске, чтобы увидеть все статусы.", style = MaterialTheme.typography.bodySmall)
                LazyRow(Modifier.fillMaxWidth().onGloballyPositioned { boardViewport = it.boundsInWindow() }.testTag("shared-boards"), state = boardScroll, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    items(statuses, key = { it.getString("id") }) { status ->
                        val boardKey = "board:${status.getString("id")}"
                        DisposableEffect(boardKey) { onDispose { dropBounds.remove(boardKey) } }
                        val hovered = draggingAt?.let { dropBounds[boardKey]?.contains(it) } == true
                        Column(Modifier.width(250.dp)
                        .onGloballyPositioned { dropBounds[boardKey] = it.boundsInWindow() }
                        .testTag("shared-board-${status.getString("id")}")
                        .background(runCatching { Color(android.graphics.Color.parseColor(status.optString("color"))) }
                            .getOrDefault(MaterialTheme.colorScheme.primary).copy(alpha = if (hovered) .32f else .12f), AffairsLayout.shape)
                        .padding(12.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        SharedStatusHeader(status, en, canInvite, canWrite, busy,
                            onSettings = { openBoard(status) },
                            onRename = { title ->
                                controller.updateSharedBoard(projectId, status.getString("id"), JSONObject().put("title", title)
                                    .put("expectedRevision", status.getInt("revision")))
                                refreshProject(projectId)
                            }, onCreateTask = { kind ->
                                newTaskEntryType = kind; newTaskStatusId = status.getString("id")
                                newTaskCategoryId = ""; newTaskAssigneeId = ""; createCustomProjectId = projectId; createModal = "task"
                            },
                            onCreateList = { createKind = "task-list"; parentId = projectId; parentBoardId = status.getString("id"); createModal = "project" },
                            onCreateProject = { createKind = "project"; parentId = projectId; parentBoardId = status.getString("id"); createModal = "project" })
                        SharedBoardImage(status.optString("imageUrl"))
                        projects.filter { it.optString("parentId") == projectId && (it.optString("boardStatusId") == status.optString("id") ||
                            false) }.forEach { child ->
                            OutlinedButton(onClick = { selectProject(child.getString("id")) }, modifier = Modifier.fillMaxWidth()) {
                                Text(child.optString("title"), modifier = Modifier.fillMaxWidth())
                            }
                            if (child.optString("role") in setOf("owner", "manager")) SharedContainerBoardMenu(child, statuses, en, busy) { destination -> run {
                                controller.updateSharedProject(child.getString("id"), JSONObject().put("title", child.optString("title"))
                                    .put("description", child.optString("description")).put("layout", child.optString("layout"))
                                    .put("parentId", projectId).put("boardStatusId", destination).put("expectedRevision", child.getInt("revision")))
                                refreshProjects(spaceId)
                            } }
                        }
                        tasks.filter { it.optString("statusId") == status.getString("id") }.forEach { task -> key(task.getString("id")) {
                            SharedTaskCard(task, statuses, canOrganize, busy, en, calendarMode,
                    onArchive = { taskExtensions.lifecycleAction = "archive" to task }, onTrash = { taskExtensions.lifecycleAction = "trash" to task },
                    customFields = listContext.catalog.fields, customCalendar = SharedCustomCalendar.initial(preferences).copy(mode = calendarMode),
                                category = categories.firstOrNull { it.optString("id") == task.optString("categoryId") },
                                completedBy = members.firstOrNull { it.optString("userId") == task.optString("completedBy") }?.optString("displayName"),
                    assignedTo = members.firstOrNull { it.optString("userId") == task.optString("assigneeId") }?.optString("displayName"),
                                onOpen = { taskId = task.getString("id") },
                        onTemplate = { templatesCaptureId = task.getString("id"); templatesCaptureTask = JSONObject(task.toString()); templatesOpen = true },
                                onMove = { destination -> moveTaskStatus(task, destination) },
                    onDragStart = { position -> draggingTask = task; draggingAt = position },
                    onDragMove = { amount -> draggingAt = (draggingAt ?: Offset.Zero) + amount },
                    onDragEnd = { finishDrag() },
                    onDragCancel = { draggingTask = null; draggingAt = null })
                        } }
                    } }
                }
                if (projectInboxLayout.atBottom) projectInbox()
            } else {
                if (!projectInboxLayout.atBottom) projectInbox()
                statuses.forEachIndexed { index, status ->
                    val boardTasks = tasks.filter { it.optString("statusId") == status.getString("id") }
                    val boardChildren = children.filter { it.optString("boardStatusId") == status.getString("id") }
                    val targetKey = "board:${status.getString("id")}"
                    val hovered = draggingAt?.let { dropBounds[targetKey]?.contains(it) } == true
                    DisposableEffect(targetKey) { onDispose { dropBounds.remove(targetKey) } }
                    Surface(Modifier.fillMaxWidth().onGloballyPositioned { dropBounds[targetKey] = it.boundsInWindow() }
                        .testTag("shared-list-board-${status.getString("id")}"), shape = AffairsLayout.shape,
                        border = if (hovered) BorderStroke(2.dp, MaterialTheme.colorScheme.primary) else null,
                        color = if (hovered) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surface) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            SharedStatusHeader(status, en, canInvite, canWrite, busy,
                                onSettings = { openBoard(status) },
                            onRename = { title ->
                                controller.updateSharedBoard(projectId, status.getString("id"), JSONObject().put("title", title)
                                    .put("expectedRevision", status.getInt("revision")))
                                refreshProject(projectId)
                            }, onCreateTask = { kind ->
                                newTaskEntryType = kind; newTaskStatusId = status.getString("id")
                                newTaskCategoryId = ""; newTaskAssigneeId = ""; createCustomProjectId = projectId; createModal = "task"
                            },
                                onCreateList = { createKind = "task-list"; parentId = projectId; parentBoardId = status.getString("id"); createModal = "project" },
                                onCreateProject = { createKind = "project"; parentId = projectId; parentBoardId = status.getString("id"); createModal = "project" })
                            SharedBoardImage(status.optString("imageUrl"))
                            boardChildren.forEach { renderChild(it) }
                            boardTasks.forEach { renderTask(it) }
                            if (boardTasks.isEmpty() && boardChildren.isEmpty()) Text("Задач пока нет.", style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (projectInboxLayout.atBottom) projectInbox()
            }
            taskPage?.let { page ->
                Text(genesisTranslate("Показано: {loaded} из {total}").replace("{loaded}", tasks.size.toString()).replace("{total}", page.optInt("total").toString()))
                if (page.optBoolean("hasMore")) TextButton(enabled = !busy && !listContext.reader.busy, onClick = { run { listContext.reader.more() } },
                    modifier = Modifier.heightIn(min = 48.dp).testTag("shared-task-more")) { Text("Показать ещё") }
            }
            }
            if (taskId.isNotBlank() && (selectedTask == null || draftTaskKey != "$projectId:$taskId")) AffairsLoading()
            if (selectedTask != null && draftTaskKey == "$projectId:$taskId") SharedTaskDialog(
                selectedTask.getString("title"), taskEditing, canEditTask, busy, { taskEditing = true }, { navigateBack() }, footer = {
                    if (taskEditing && canEditTask) AffairsSaveBar(saveTask,
                        enabled = taskFieldsChanged && !taskPending && !taskArchived && estimateDraft?.valid != false && customDraft?.valid == true && sharedTaskCoreResolved(editTaskDetails) && sharedTaskChecklistsValid(editTaskDetails) &&
                            (estimateDraft?.dirty != true || planningEnabled) && editTaskTitle.isNotBlank() && dateValid && selectedTask.optInt("revision") == editTaskRevision,
                        busy = busy)
                }) {
                if (message.isNotBlank()) Text(message, modifier = Modifier.testTag("shared-feedback"),
                    color = if (messageIsError) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary)
                SharedTaskCardBody {
                    if (selectedTask.optString("seriesId").let { it.isNotBlank() && it != "null" }) {
                        Text(genesisTranslate("Серия общих задач"), style = MaterialTheme.typography.titleSmall)
                        Text(genesisTranslate("Изменения задачи относятся к этому повтору. Настройки серии действуют только на ещё не созданные задачи."), style = MaterialTheme.typography.bodySmall)
                    }
                    if (canEditTask && taskEditing) {
                        OutlinedTextField(editTaskTitle, { editTaskTitle = it },
                            label = { Text(if (en) "Name" else "Название") }, enabled = !busy, isError = editTaskTitle.isBlank(),
                            supportingText = if (editTaskTitle.isBlank()) ({ Text("Введите название задачи.") }) else null,
                            modifier = Modifier.fillMaxWidth().testTag("shared-task-title-input"))
                        OutlinedTextField(editTaskDescription, { editTaskDescription = it },
                            label = { Text(if (en) "Description" else "Описание") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
                        SharedTaskEstimates(selectedTask, editTaskDetails, planningEnabled, canEditTask,
                            busy || taskPending || taskArchived, { editTaskDetails = it })
                        customDraft?.let { custom -> SharedTaskCustomFields(selectedTask, editTaskDetails, custom, preferences, true,
                            busy || taskPending || taskArchived, { editTaskDetails = it }, { run { refreshProject(projectId) } }) }
                        Text(if (en) "Due date" else "Срок", style = MaterialTheme.typography.titleSmall)
                        if (editTaskDueDate.isBlank()) TextButton(onClick = { editTaskDueDate = LocalDate.now().toString() }) {
                            Text(if (en) "Set due date" else "Установить срок")
                        } else {
                            AuthorDatePicker(editTaskDueDate, calendarMode) { editTaskDueDate = it }
                            TextButton(onClick = { editTaskDueDate = "" }) { Text(if (en) "Clear" else "Убрать срок") }
                        }
                        SharedTaskPeopleAndDetails(categories,members,editTaskCategoryId,selectedTask.opt("assigneeId") as? String,
                            busy||taskPending,{editTaskCategoryId=it},{id->run {
                                val changed=controller.updateSharedTask(projectId,taskId,JSONObject().put("assigneeId",id?:JSONObject.NULL)
                                    .put("expectedRevision",selectedTask.getInt("revision"))).getJSONObject("task")
                                pendingTasks=controller.queuedSharedTasks(projectId)
                                if(changed.optBoolean("pending"))message="Изменение сохранено на устройстве и синхронизируется после подключения."
                                else refreshProject(projectId)
                            }}) {
                        SharedTaskExtendedDetails(controller,selectedTask,editTaskDetails,members,statuses,preferences,calendarMode,
                            busy||taskPending,false,!taskDraftChanged&&!taskPending,{editTaskDetails=it},openRelatedTask,::run,
                            {message="Изменение сохранено на устройстве и синхронизируется после подключения."}) { current,replaceDetails ->
                            if(projectId==current.getString("projectId")&&taskId==current.getString("id")) {
                                openedTask=current
                                if(replaceDetails){editTaskRevision=current.getInt("revision");editTaskDetails=sharedTaskDetailDraft(current,preferences)}
                                pendingTasks=controller.queuedSharedTasks(projectId);refreshProject(projectId)
                            }
                        }
                        }
                        if (selectedTask.optInt("revision") != editTaskRevision) {
                            Text(if (en) "Changed elsewhere. Your draft is kept." else "Изменено другим участником. Черновик сохранён.",
                                color = MaterialTheme.colorScheme.error)
                            TextButton(onClick = {
                                val rebased = rebaseSharedTaskEditor(selectedTask, editTaskDetails,
                                    sharedTaskEditorFields(editTaskTitle, editTaskDescription, editTaskDueDate, editTaskCategoryId),
                                    customDraft?.fields.orEmpty())
                                editTaskDetails = rebased.details
                                editTaskTitle = rebased.fields.optString("title")
                                editTaskDescription = rebased.fields.optString("description")
                                editTaskDueDate = rebased.fields.optString("dueDate").takeUnless { it == "null" }.orEmpty()
                                editTaskCategoryId = rebased.fields.optString("categoryId").takeUnless { it == "null" }.orEmpty()
                                editTaskRevision = selectedTask.optInt("revision")
                            }) { Text(if (en) "Reload fields" else "Обновить поля") }
                        }
                        if (!sharedTaskCoreResolved(editTaskDetails)) SharedTaskCoreConflict(editTaskDetails, !busy && !taskPending &&
                            selectedTask.optInt("revision") == editTaskRevision) { keepLocal ->
                            val resolved = resolveSharedTaskEditor(editTaskDetails,
                                sharedTaskEditorFields(editTaskTitle, editTaskDescription, editTaskDueDate, editTaskCategoryId), keepLocal, selectedTask)
                            editTaskDetails = resolved.details
                            editTaskTitle = resolved.fields.optString("title")
                            editTaskDescription = resolved.fields.optString("description")
                            editTaskDueDate = resolved.fields.optString("dueDate").takeUnless { it == "null" }.orEmpty()
                            editTaskCategoryId = resolved.fields.optString("categoryId").takeUnless { it == "null" }.orEmpty()
                        }
                    } else {
                        SharedTaskReadSummary(selectedTask, members, statuses, calendarMode)
                        Text("Описание", style = MaterialTheme.typography.titleSmall)
                        if (selectedTask.optString("description").isNotBlank()) UntranslatedText(selectedTask.getString("description"))
                        SharedTaskEstimates(selectedTask, editTaskDetails, planningEnabled, false,
                            busy || taskPending || taskArchived, { editTaskDetails = it })
                        customDraft?.let { custom -> SharedTaskCustomFields(selectedTask, editTaskDetails, custom, preferences, false,
                            busy || taskPending || taskArchived, {}, { run { refreshProject(projectId) } }) }
                        SharedTaskExtendedDetails(controller,selectedTask,sharedTaskDetailDraft(selectedTask),members,statuses,preferences,calendarMode,
                            busy,true,!taskDraftChanged,{},openRelatedTask,::run,{}) { _,_-> }
                    }
                    SharedTaskExtensionPanels(controller, selectedTask, project!!, members, preferences, taskExtensions,
                        disabled = busy || taskPending || coreTaskDraftChanged,
                        onAcknowledged = { current ->
                            if (current.optString("id") == taskId && current.optString("projectId") == projectId) {
                                openedTask = current
                                if (!taskExtensions.coreDraftDirty) {
                                    editTaskRevision = current.getInt("revision"); editTaskDetails = sharedTaskDetailDraft(current, preferences)
                                    editTaskTitle = current.optString("title"); editTaskDescription = current.optString("description")
                                    editTaskDueDate = current.optString("dueDate").takeUnless { it == "null" }.orEmpty()
                                    editTaskCategoryId = current.optString("categoryId").takeUnless { it == "null" }.orEmpty()
                                }
                                run { pendingTasks = controller.queuedSharedTasks(projectId); refreshProject(projectId) }
                            }
                        }, onRefresh = {
                            refreshProject(projectId)
                            openedTask?.takeIf { !taskExtensions.coreDraftDirty && it.optString("id") == taskId }?.let { current ->
                                editTaskRevision = current.getInt("revision"); editTaskDetails = sharedTaskDetailDraft(current, preferences)
                                editTaskTitle = current.optString("title"); editTaskDescription = current.optString("description")
                                editTaskDueDate = current.optString("dueDate").takeUnless { it == "null" }.orEmpty()
                                editTaskCategoryId = current.optString("categoryId").takeUnless { it == "null" }.orEmpty()
                            }
                        }, onOpen = openRelatedTask, readOnly = !taskEditing)
                }
                Spacer(Modifier.height(20.dp))
                SharedTaskDiscussion(controller, projectId, taskId, pageActive, canComment, busy || taskPending,
                    commentBody, { commentBody = it }, actions = {
                        if (canOrganize) {
                            if (!taskArchived) AffairsIconButton("В архив", AffairsAction.ARCHIVE,
                                { taskExtensions.lifecycleAction = "archive" to selectedTask }, enabled = !busy && !taskPending && !taskDraftChanged, outlined = false)
                            AffairsIconButton("В корзину", AffairsAction.DELETE,
                                { taskExtensions.lifecycleAction = "trash" to selectedTask }, enabled = !busy && !taskPending && !taskDraftChanged, outlined = false,
                                contentColor = MaterialTheme.colorScheme.error)
                        }
                    })
            }
        }
    }
    }
    if(project!=null&&project.optInt("isInbox")==0&&taskId.isBlank()) WorkspaceSearchDock(taskSearch,{taskSearch=it},"Поиск задач","shared-task-search",
        Modifier.align(androidx.compose.ui.Alignment.BottomCenter),controls={
                SharedTaskFieldSort(taskSort,setTaskSort,listContext.query,listContext.catalog.fields,iconOnly=true)
                BadgedBox(badge={if(filterCount>0)Badge {Text(filterCount.toString())}}) {
                    AffairsIconButton("Фильтры",AffairsAction.FILTER,{filtersOpen=true},Modifier.testTag("shared-filters"))
                }

        })
    val drag = draggingTask ?: draggingContainer
    val dragPosition = draggingAt
    if (drag != null && dragPosition != null && dragPosition.x.isFinite() && dragPosition.y.isFinite()) {
        Surface(Modifier.offset {
            // Placement may run once after release, before recomposition removes the preview.
            val point = draggingAt?.takeIf { it.x.isFinite() && it.y.isFinite() } ?: dragPosition
            IntOffset((point.x - rootPosition.x - 70.dp.toPx()).roundToInt(),
                (point.y - rootPosition.y - 24.dp.toPx()).roundToInt())
        }.widthIn(max = 180.dp), color = MaterialTheme.colorScheme.primaryContainer,
            shape = MaterialTheme.shapes.small, shadowElevation = 12.dp) {
            Text(drag.optString("title"), Modifier.padding(8.dp), maxLines = 1)
        }
    }
    }
}

@Composable
private fun SharedWorkspaceViewChoice(value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, compact: Boolean = false) {
    var open by remember { mutableStateOf(false) }
    val choices = listOf("list" to "Список", "board" to "Доска", "calendar" to "Календарь", "gantt" to "Гант")
    fun icon(id: String) = when (id) {
        "board" -> AffairsAction.BOARD; "calendar" -> AffairsAction.CALENDAR
        "gantt" -> AffairsAction.GANTT; else -> AffairsAction.LIST
    }
    Box(modifier.testTag("shared-view-actions")) {
        if (compact) AffairsIconButton(choices.firstOrNull { it.first == value }?.second ?: "Список", icon(value),
            { open = true }, Modifier.testTag("shared-view-selector"))
        else OutlinedButton(onClick = { open = true }, shape = AffairsLayout.controlShape,
            modifier = Modifier.heightIn(min = 48.dp).testTag("shared-view-selector"), contentPadding = PaddingValues(horizontal = 10.dp, vertical = 8.dp)) {
            Text(choices.firstOrNull { it.first == value }?.second ?: "Список")
            Spacer(Modifier.width(8.dp))
            AffairsActionIcon(AffairsAction.EXPAND)
        }
        DropdownMenu(open, { open = false }) {
            choices.forEach { (id, label) ->
                DropdownMenuItem(text = { Text(if (id == "gantt") "Диаграмма Ганта" else label) },
                    leadingIcon = { AffairsActionIcon(icon(id)) },
                    trailingIcon = { if (id == value) RadioButton(selected = true, onClick = null) },
                    modifier = Modifier.testTag("shared-view-$id"), onClick = { open = false; onChange(id) })
            }
        }
    }
}

@Composable
private fun SharedWorkspaceCreateMenu(enabled: Boolean, canCreateTask: Boolean, canCreateContainer: Boolean,
    onTask: (String) -> Unit, onContainer: (String) -> Unit) {
    if (!canCreateTask && !canCreateContainer) return
    var open by remember { mutableStateOf(false) }
    Box {
        AffairsIconButton("Создать", AffairsAction.ADD, { open = true }, Modifier.testTag("shared-create-task"), enabled = enabled)
        DropdownMenu(open, { open = false }) {
            listOf("task" to "Создать задачу", "event" to "Создать событие", "task-list" to "Создать список задач",
                "meeting" to "Создать встречу", "project" to "Создать подпроект").forEach { (kind, label) ->
                val container = kind == "task-list" || kind == "project"
                DropdownMenuItem(text = { Text(label) }, enabled = enabled && if (container) canCreateContainer else canCreateTask,
                    leadingIcon = { if (kind == "event" || kind == "meeting") GenesisLucideIcon(if (kind == "event") "calendar-days" else "users-round")
                        else AffairsActionIcon(if (kind == "task-list") AffairsAction.TASK_LIST else if (kind == "project") AffairsAction.PROJECT else AffairsAction.CREATE_TASK) },
                    modifier = Modifier.testTag("shared-create-$kind-option"), onClick = { open = false
                        if (container) onContainer(kind) else onTask(kind)
                    })
            }
        }
    }
}

@Composable
private fun SharedBlock(title: String, content: @Composable ColumnScope.() -> Unit) {
    OutlinedCard(Modifier.fillMaxWidth()) {
        Column(Modifier.fillMaxWidth().padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text(title, style = MaterialTheme.typography.titleMedium)
            content()
        }
    }

}

@Composable
internal fun SharedTaskCard(task: JSONObject, statuses: List<JSONObject>, canOrganize: Boolean, busy: Boolean,
    en: Boolean, calendarMode: CalendarMode, category: JSONObject?, completedBy: String?,
    onOpen: () -> Unit, onMove: (String) -> Unit, assignedTo: String? = null,
    onDragStart: ((Offset) -> Unit)? = null, onDragMove: ((Offset) -> Unit)? = null,
    onDragEnd: (() -> Unit)? = null, onDragCancel: (() -> Unit)? = null,
    customFields: List<JSONObject> = emptyList(), customCalendar: SharedCustomCalendar = SharedCustomCalendar.initial(UiPreferences()).copy(mode = calendarMode),
    onArchive: (() -> Unit)? = null, onTrash: (() -> Unit)? = null, compact:Boolean=false, onTemplate: (() -> Unit)? = null) {
    var topLeft by remember { mutableStateOf(Offset.Zero) }
    var actionsOpen by remember { mutableStateOf(false) }
    val currentStatus = statuses.firstOrNull { it.optString("id") == task.optString("statusId") }
    val completed = currentStatus?.optInt("isDone") == 1 ||
        task.optString("completedAt").let { it.isNotBlank() && it != "null" }
    val toggleStatus = if (currentStatus == null) JSONObject().put("id", "chaos-${if (completed) "open" else "done"}:${task.getString("projectId")}")
        else statuses.firstOrNull { (it.optInt("isDone") == 1) != completed }
    val dueDate = task.optString("dueDate").takeUnless { it.isBlank() || it == "null" }
    val dueLabel = dueDate?.let { runCatching {
        GenesisCalendar().formatDate(LocalDate.parse(it), calendarMode)
    }.getOrDefault(it) }
    val priority = task.optInt("priority").takeIf { it in 1..3 }?.let {
        genesisTranslate(listOf("", "Низкий приоритет", "Средний приоритет", "Высокий приоритет")[it]) }
    val statusTitle = currentStatus?.optString("title")
    val statusLabel = statusTitle?.let {
        if (it in setOf("К выполнению", "В работе", "Готово")) genesisTranslate(sharedStatusLabel(it, en)) else it
    }
    val metadata = listOfNotNull(statusLabel.takeUnless {compact},
        dueLabel, assignedTo?.takeIf(String::isNotBlank), priority,
        completedBy?.takeIf { completed }?.let { genesisTranslate("Выполнил(а): ") + it })
    val currentDragStart by rememberUpdatedState(onDragStart)
    val currentDragMove by rememberUpdatedState(onDragMove)
    val currentDragEnd by rememberUpdatedState(onDragEnd)
    val currentDragCancel by rememberUpdatedState(onDragCancel)
    val dragModifier = if (canOrganize && !busy && onDragStart != null) Modifier
        .onGloballyPositioned { topLeft = it.boundsInWindow().topLeft }
        .workspaceDragSource(task.optString("id"),
            onStart = { currentDragStart?.invoke(topLeft + it) },
            onMove = { currentDragMove?.invoke(it) },
            onFinish = { if(it) currentDragCancel?.invoke() else currentDragEnd?.invoke() }) else Modifier
    AffairsTaskRow(task.getString("title"), completed, onOpen,
        modifier = Modifier.then(dragModifier).testTag("shared-task-${task.optString("id")}"),
        metadata = metadata, unreadComments = task.optInt("unreadCommentCount"), enabled = !busy,
        onComplete = if (canOrganize && toggleStatus != null) ({ onMove(toggleStatus.getString("id")) }) else null,
        actions = if (canOrganize) ({ Box {
            AffairsIconButton("Изменить статус", AffairsAction.MORE, { actionsOpen = true },
                Modifier.testTag("shared-task-actions-${task.optString("id")}"), enabled = !busy, outlined = false)
            DropdownMenu(actionsOpen, { actionsOpen = false }) {
                DropdownMenuItem(text = { Text("Хаос-бокс проекта") }, enabled = !busy && currentStatus != null,
                    onClick = { actionsOpen = false; onMove("") })
                statuses.forEach { status -> DropdownMenuItem(text = { Text(sharedStatusLabel(status.getString("title"), en)) },
                    enabled = !busy && task.optString("statusId") != status.optString("id"),
                    onClick = { actionsOpen = false; onMove(status.getString("id")) }) }
                if (onArchive != null || onTrash != null) HorizontalDivider()
                if (onTemplate != null) DropdownMenuItem(text = { Text("Сохранить как шаблон") }, leadingIcon = { AffairsActionIcon(AffairsAction.TEMPLATE) },
                    enabled = !busy && !task.optBoolean("pending"), onClick = { actionsOpen = false; onTemplate() })
                if (onArchive != null) DropdownMenuItem(text = { Text("В архив") }, leadingIcon = { AffairsActionIcon(AffairsAction.ARCHIVE) },
                    enabled = !busy && !task.optBoolean("pending"), onClick = { actionsOpen = false; onArchive() })
                if (onTrash != null) DropdownMenuItem(text = { Text("В корзину", color = MaterialTheme.colorScheme.error) }, leadingIcon = { AffairsActionIcon(AffairsAction.DELETE) },
                    enabled = !busy && !task.optBoolean("pending"), onClick = { actionsOpen = false; onTrash() })
            }
        } }) else null,
        extra = {
            if (!compact && category != null) Text(category.optString("title"), Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.secondary)
            if(!compact) SharedTaskListCustomValues(task, customFields, customCalendar)
        })
}

@Composable
private fun SharedStatusHeader(status: JSONObject, en: Boolean, canManage: Boolean, canCreate: Boolean,
    busy: Boolean, onSettings: () -> Unit, onRename: suspend (String) -> Unit, onCreateTask: (String) -> Unit,
    onCreateList: () -> Unit, onCreateProject: () -> Unit) {
    var open by remember { mutableStateOf(false) }
    var editing by remember(status.optString("id")) { mutableStateOf(false) }
    var title by remember(status.optString("id")) { mutableStateOf("") }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Column(Modifier.fillMaxWidth()) {
    if (editing) {
        OutlinedTextField(title, { title = it; failed = false }, label = { Text("Название доски") }, singleLine = true,
            enabled = !saving, modifier = Modifier.fillMaxWidth().testTag("shared-board-rename-${status.optString("id")}"))
        if (failed) Text("Не удалось сохранить название. Повторите попытку.", color = MaterialTheme.colorScheme.error)
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
            AffairsIconButton("Отмена", AffairsAction.CLOSE, { editing = false }, enabled = !saving)
            TextButton(onClick = { scope.launch {
                saving = true; failed = false
                try { onRename(title.trim()); editing = false }
                catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
                catch (_: Exception) { failed = true }
                finally { saving = false }
            } }, enabled = !saving && !busy && title.isNotBlank() && title.length <= 80) { Text("Сохранить") }
        }
    } else Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        if (canManage) TextButton(onClick = { title = status.getString("title"); editing = true; failed = false },
            enabled = !busy, modifier = Modifier.weight(1f).heightIn(min = 48.dp).testTag("shared-board-title-${status.optString("id")}"),
            contentPadding = PaddingValues(horizontal = 0.dp, vertical = 8.dp)) {
            UntranslatedText(sharedStatusLabel(status.getString("title"), en), Modifier.fillMaxWidth(), style = MaterialTheme.typography.titleMedium)
        } else Text(sharedStatusLabel(status.getString("title"), en), Modifier.weight(1f), style = MaterialTheme.typography.titleMedium)
        if (canManage || canCreate) Box {
            AffairsIconButton("Действия с доской", AffairsAction.SETTINGS, { open = true },
                Modifier.testTag("shared-status-actions-${status.optString("id")}"), enabled = !busy, outlined = false)
            DropdownMenu(open, { open = false }) {
                if (canManage) DropdownMenuItem(text = { Text("Настройки доски") }, leadingIcon = { AffairsActionIcon(AffairsAction.SETTINGS) },
                    modifier = Modifier.testTag("shared-board-settings-${status.optString("id")}"), onClick = { open = false; onSettings() })
                if (canCreate) {
                    listOf("task" to "Создать задачу", "task-list" to "Создать список задач", "event" to "Создать событие",
                        "meeting" to "Создать встречу", "project" to "Создать подпроект").forEach { (kind, label) ->
                        DropdownMenuItem(text = { Text(label) }, modifier = Modifier.testTag("shared-board-create-$kind-${status.optString("id")}"),
                            leadingIcon = { AffairsActionIcon(when (kind) { "task-list" -> AffairsAction.TASK_LIST; "project" -> AffairsAction.PROJECT
                                "event" -> AffairsAction.CALENDAR; "meeting" -> AffairsAction.TEAM; else -> AffairsAction.CREATE_TASK }) }, onClick = {
                                open = false
                                when (kind) { "task-list" -> onCreateList(); "project" -> onCreateProject(); else -> onCreateTask(kind) }
                            })
                    }
                }
            }
        }
    }
    }
}

@Composable
private fun SharedProjectTree(projects: List<JSONObject>, expanded: Set<String>, selected: String,
    onSelect: (String) -> Unit, onToggle: (String) -> Unit,
    parent: String? = null, ancestors: Set<String> = emptySet(),
    interaction: @Composable (JSONObject) -> Modifier = { Modifier }) {
    projects.filter { item -> item.optInt("isInbox") == 0 &&
        item.optString("parentId").takeUnless { it.isBlank() || it == "null" } == parent && item.optString("id") !in ancestors
    }.forEach { item ->
        val id = item.getString("id")
        val hasChildren = projects.any { it.optString("parentId") == id }
        OutlinedCard(onClick = { onSelect(id) }, modifier = Modifier.fillMaxWidth().then(interaction(item))
            .padding(start = (minOf(ancestors.size, 4) * 12).dp).testTag("shared-project-$id"),
            shape = AffairsLayout.shape) {
            Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
                verticalAlignment = androidx.compose.ui.Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GenesisVectorIcon(if (item.optString("kind") == "task-list") GenesisPageIcon.TASK_LISTS
                    else GenesisPageIcon.PROJECTS, Modifier.size(24.dp), MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    UntranslatedText(item.optString("title"), style = MaterialTheme.typography.titleMedium)
                    Text(if (item.optString("kind") == "task-list") "Список задач" else "Проект",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                if (hasChildren) AffairsIconButton(if (id in expanded) "Свернуть подпроекты" else "Показать подпроекты",
                    if (id in expanded) AffairsAction.COLLAPSE else AffairsAction.EXPAND, { onToggle(id) },
                    Modifier.testTag("shared-project-expand-$id"))
            }
        }
        if (id in expanded) SharedProjectTree(projects, expanded, selected, onSelect, onToggle, id, ancestors + id, interaction)
    }
}

@Composable
private fun SharedContainerBoardMenu(child: JSONObject, statuses: List<JSONObject>, en: Boolean,
    busy: Boolean, onMove: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Box {
        TextButton(onClick = { open = true }, enabled = !busy) { Text(if (en) "Move to board" else "Переместить на доску") }
        DropdownMenu(open, onDismissRequest = { open = false }) {
            statuses.forEach { status -> DropdownMenuItem(text = { Text(status.optString("title")) },
                onClick = { open = false; onMove(status.getString("id")) }) }
        }
    }
}

@Composable
private fun SharedBoardImage(url: String) {
    if (url.isBlank()) return
    val bitmap by produceState<android.graphics.Bitmap?>(null, url) {
        value = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
            runCatching { genesisImageBitmap(url, 600) }.getOrNull()
        }
    }
    bitmap?.let { androidx.compose.foundation.Image(it.asImageBitmap(), contentDescription = null,
        modifier = Modifier.fillMaxWidth().height(120.dp), contentScale = androidx.compose.ui.layout.ContentScale.Crop) }
}
