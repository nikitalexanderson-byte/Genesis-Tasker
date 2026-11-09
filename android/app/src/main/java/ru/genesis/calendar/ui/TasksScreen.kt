package ru.genesis.calendar.ui

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.rememberLazyGridState
import androidx.compose.foundation.lazy.grid.GridItemSpan
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import ru.genesis.calendar.ui.Dialog
import androidx.compose.ui.window.DialogProperties
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.data.*

@Composable internal fun TasksScreen(tasks: List<LocalTask>, lists: List<GoogleTaskList>,
    structure: WorkspaceStructure, use24: Boolean, confirmed: Boolean,
    onCreateTask: (GoogleTaskList?) -> Unit, onCreateList: () -> Unit,
    onComplete: (LocalTask) -> Unit, onOpen: (String) -> Unit,
    onUpdateList: suspend (GoogleTaskList,String) -> Unit = { _,_ -> },
    onDeleteList: suspend (GoogleTaskList) -> Unit = {},
    sharedController: AuthController? = null, sharedListRefreshKey: Int = 0,
    onOpenSharedProjects: () -> Unit = {},
    menuSwipeState: MenuSwipeState? = null, voiceRequest: NativeVoiceAction? = null,
    onVoiceRequestConsumed: () -> Unit = {}, hiddenSubmenus: Set<String> = emptySet(),
    showSharedLists: Boolean = true, showSubmenu: Boolean = true, initialListId: String? = null,
    onInitialListConsumed: () -> Unit = {}) {
    var localSection by rememberSaveable { mutableStateOf("tasks") }
    val section = (menuSwipeState?.tasks ?: localSection).takeIf { "tasks.$it" !in hiddenSubmenus }
        ?: if ("tasks.tasks" !in hiddenSubmenus) "tasks" else "lists"
    var expanded by rememberSaveable { mutableStateOf<String?>(null) }
    val knownLists = remember(lists, tasks) { taskListsForTasks(lists,tasks).filterNot { list ->
        list.accountId != null && (list.isDefault || list.title == "Привычки GENESIS")
    } }
    val gridState = rememberLazyGridState()
    LaunchedEffect(initialListId, knownLists, section) {
        if (initialListId == null || section != "lists") return@LaunchedEffect
        val index = knownLists.indexOfFirst { it.id == initialListId }
        if (index >= 0) {
            val list = knownLists[index]
            expanded = "${list.accountId}/${list.id}"
            gridState.scrollToItem(index + 2)
            onInitialListConsumed()
        }
    }
    var sharedLists by remember { mutableStateOf(emptyList<JSONObject>()) }
    var sharedListError by remember { mutableStateOf<String?>(null) }
    var expandedSharedListId by remember { mutableStateOf("") }
    var sharedSnapshot by remember { mutableStateOf<JSONObject?>(null) }
    LaunchedEffect(sharedController, section, sharedListRefreshKey) {
        if (!showSharedLists || sharedController == null || section != "lists") return@LaunchedEffect
        runCatching { sharedController.sharedTaskLists().getJSONArray("lists") }.onSuccess { rows ->
            sharedLists = (0 until rows.length()).map { rows.getJSONObject(it) }
            sharedListError = null
        }.onFailure { sharedListError = it.message ?: "Не удалось загрузить общие списки." }
    }
    LaunchedEffect(sharedController, expandedSharedListId) {
        val row = sharedLists.firstOrNull { it.optString("id") == expandedSharedListId }
        if (sharedController == null || row == null) { sharedSnapshot = null; return@LaunchedEffect }
        runCatching { sharedController.sharedProject(row.getString("projectId")) }
            .onSuccess { sharedSnapshot = it }
            .onFailure { sharedListError = it.message ?: "Не удалось открыть общий список." }
    }
    val english = LocalGenesisLanguage.current == "en"
    val total = tasks.size
    val active = tasks.count { !it.done }
    var taskFilter by rememberSaveable { mutableStateOf("all") }
    var search by rememberSaveable { mutableStateOf("") }
    var searchOpen by rememberSaveable { mutableStateOf(false) }
    val visibleTasks = remember(tasks, taskFilter, search) {
        tasks.filter { task ->
            (taskFilter == "all" || task.done == (taskFilter == "done")) &&
                (search.isBlank() || task.title.contains(search.trim(), ignoreCase = true) ||
                    task.project.contains(search.trim(), ignoreCase = true))
        }
    }
    Column(Modifier.fillMaxSize()) {
        val submenuItems = listOf(SubmenuItem("tasks", "Задачи"), SubmenuItem("lists", "Списки задач"))
            .filter { "tasks.${it.id}" !in hiddenSubmenus }
        if (showSubmenu && !LocalFixedSubmenu.current && submenuItems.size > 1) ConnectedSubmenu(submenuItems,
            section, { localSection = it; menuSwipeState?.tasks = it })
        LazyVerticalGrid(columns = GridCells.Adaptive(360.dp), state = gridState, modifier = Modifier.weight(1f).testTag("tasks-screen"), contentPadding = PaddingValues(16.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item(span = { GridItemSpan(maxLineSpan) }) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    GenesisPageHeader(if (section == "lists") {
                        if (english) "Task lists" else "Списки задач"
                    } else if (english) "Tasks" else "Задачи",
                        if (section == "lists") {
                            if (english) "Organize tasks by list" else "Организуйте задачи по спискам"
                        } else taskSummaryCopy(total, active, knownLists.size, LocalGenesisLanguage.current), "✦",
                        icon = if (section == "lists") GenesisPageIcon.TASK_LISTS else GenesisPageIcon.TASKS)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (section == "tasks") Row(Modifier.weight(1f).horizontalScroll(rememberScrollState()),
                            horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            listOf("all" to "Все", "open" to "В работе", "done" to "Готово").forEach { (id, label) ->
                                FilterChip(selected = taskFilter == id, onClick = { taskFilter = id },
                                    modifier = Modifier.heightIn(min = 48.dp).testTag("tasks-filter-$id"),
                                    label = { Text(label) })
                            }
                        } else Text(if (english) "${knownLists.size} personal lists" else "Личные списки: ${knownLists.size}",
                            Modifier.weight(1f).testTag("tasks-summary"), style = MaterialTheme.typography.labelLarge)
                        if (section == "tasks") AffairsIconButton("Поиск задач", AffairsAction.SEARCH,
                            { searchOpen = !searchOpen; if (!searchOpen) search = "" }, selected = searchOpen)
                    }
                    if (section == "tasks" && searchOpen) AffairsSearchField(search, { search = it.take(200) },
                        "Поиск задач", Modifier.fillMaxWidth().testTag("tasks-search"))
                    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                        Button(onClick = if (section == "lists") onCreateList else ({ onCreateTask(null) }),
                            shape = RoundedCornerShape(10.dp),
                            modifier = Modifier.heightIn(min = 48.dp).testTag("create-task")) {
                            AffairsActionIcon(AffairsAction.ADD)
                            Spacer(Modifier.width(8.dp))
                            Text(if (section == "lists") "Создать список" else "Добавить задачу")
                        }
                    }
                }
            }
            if(section == "tasks") {
                if(tasks.isEmpty()) item { Text(if(!confirmed) "Ожидаем загрузки задач аккаунта." else "Задач пока нет. Создайте первую запись.") }
                if (tasks.isNotEmpty() && visibleTasks.isEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    Text("Задач не найдено. Измените поиск или выберите другой фильтр.",
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
                items(visibleTasks, key = { it.id }) { task -> NativeTaskCard(task,use24,structure,onComplete,onOpen) }
            } else {
                if (knownLists.isNotEmpty()) item(span = { GridItemSpan(maxLineSpan) }) {
                    Text("Личные списки задач", style = MaterialTheme.typography.titleMedium,
                        modifier = Modifier.padding(top = 8.dp))
                }
                items(knownLists, key = { "${it.accountId}/${it.id}" }) { list ->
                    PersonalTaskListCard(list, tasks.filter { it.belongsToList(list) }, structure, use24,
                        onCreateTask = { onCreateTask(it) }, onComplete = onComplete, onOpen = onOpen,
                        onUpdateList = onUpdateList, onDeleteList = onDeleteList,
                        initialExpanded = expanded == "${list.accountId}/${list.id}",
                        voiceRequest = voiceRequest, onVoiceRequestConsumed = onVoiceRequestConsumed)
                }
                if (showSharedLists && sharedController != null) item(span = { GridItemSpan(maxLineSpan) }) {
                    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text(if (english) "Team task lists" else "Общие списки задач",
                            style = MaterialTheme.typography.titleMedium)
                        Text(if (english) "Saved in GENESIS and visible to project members."
                            else "Хранятся в GENESIS и доступны участникам проекта.",
                            style = MaterialTheme.typography.bodySmall)
                        sharedListError?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                    }
                }
                if (showSharedLists && sharedController != null) items(sharedLists, key = { "shared:${it.getString("id")}" }) { list ->
                    val listId = list.getString("id")
                    Card(Modifier.fillMaxWidth(), shape = RoundedCornerShape(10.dp),
                        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant)) {
                        Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                                    Text(list.optString("title"), style = MaterialTheme.typography.titleMedium)
                                    Text("${list.optString("spaceTitle")} / ${list.optString("projectTitle")} · ${list.optInt("taskCount")}",
                                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                }
                                AffairsIconButton(if (expandedSharedListId == listId) "Свернуть список" else "Открыть список",
                                    if (expandedSharedListId == listId) AffairsAction.COLLAPSE else AffairsAction.EXPAND,
                                    { expandedSharedListId = if (expandedSharedListId == listId) "" else listId })
                            }
                            if (expandedSharedListId == listId && sharedSnapshot?.optJSONObject("project")
                                    ?.optString("id") == list.optString("projectId")) {
                                val rows = sharedSnapshot!!.getJSONArray("tasks")
                                val matching = (0 until rows.length()).map { rows.getJSONObject(it) }
                                    .filter { it.optString("statusId") == listId }
                                if (matching.isEmpty()) Text("Список пока пуст.")
                                matching.forEach { task -> Text(task.optString("title")) }
                                TextButton(onClick = onOpenSharedProjects, modifier = Modifier.heightIn(min = 48.dp)) { Text("Открыть проект") }
                            }
                        }
                    }
                }
                if(knownLists.isEmpty() && sharedLists.isEmpty()) item { Text("Списков пока нет. Создайте список и добавьте в него задачи.") }
            }
        }
    }
}

@Composable internal fun NativeTaskCard(task: LocalTask, use24: Boolean, structure: WorkspaceStructure,
    onComplete: (LocalTask) -> Unit, onOpen: (String) -> Unit) {
    val metadata = listOfNotNull(
        listOf(task.date, timeLabel(task.time,use24)).filter { it.isNotBlank() }.joinToString(" · ").takeIf { it.isNotBlank() },
        task.priority.takeIf { it > 0 }?.let { "${genesisTranslate("Приоритет")} $it" },
        if (task.recurrence.enabled) genesisTranslate("Повторяется") else null) + listOfNotNull(task.projectId?.let { id ->
        structure.projects.firstOrNull { it.id == id }?.title ?: task.project.ifBlank { genesisTranslate("Проект") } })
    AffairsTaskRow(task.title, task.done, { onOpen(task.id) }, Modifier.testTag("task-${task.id}"),
        metadata = metadata, unreadComments = personalUnreadComments(task), onComplete = { onComplete(task) },
        titleContent = { TaskTitle(task, Modifier.testTag("task-title-${task.id}"), style = MaterialTheme.typography.titleSmall,
            completedColor = if (LocalEveningTheme.current) MaterialTheme.colorScheme.onSurfaceVariant else completedTaskInk) })
}

@Composable internal fun TaskListEditor(structure: WorkspaceStructure, accounts: AccountSettings?, prefs: UiPreferences,
    canCreate: Boolean, sharedCanCreate: Boolean = canCreate, initialTitle: String = "", onDismiss: () -> Unit,
    onCreate: suspend (String,String) -> GoogleTaskList,
    onSaveTasks: suspend (GoogleTaskList,String?,String,List<Pair<String,String>>,TaskListDraftOptions) -> Unit,
    sharedController: AuthController? = null) {
    var title by rememberSaveable(initialTitle) { mutableStateOf(initialTitle) }
    var projectId by rememberSaveable { mutableStateOf<String?>(null) }
    val connected = accounts?.accounts.orEmpty().filter { it.tasksConnected }
    val localList = accounts?.authProvider != "google"
    val yandex = accounts?.authProvider == "yandex"
    var accountId by rememberSaveable { mutableStateOf(connected.firstOrNull { it.id in accounts?.routing?.defaultAccountIds.orEmpty() }?.id ?: connected.firstOrNull()?.id.orEmpty()) }
    var date by rememberSaveable { mutableStateOf(java.time.LocalDate.now().toString()) }
    var formCalendarMode by rememberSaveable { mutableStateOf(prefs.input) }
    var rowsText by rememberSaveable { mutableStateOf("") }
    var notes by rememberSaveable { mutableStateOf("") }
    var taskTime by rememberSaveable { mutableStateOf("") }
    var reminderMinutes by rememberSaveable { mutableIntStateOf(0) }
    var rowIds by rememberSaveable { mutableStateOf(listOf<String>()) }
    var createdJson by rememberSaveable { mutableStateOf<String?>(null) }
    val created = createdJson?.let { GoogleTaskList.from(JSONObject(it)) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var sharedScope by rememberSaveable { mutableStateOf(false) }
    var sharedSpaces by remember { mutableStateOf(emptyList<JSONObject>()) }
    var sharedProjects by remember { mutableStateOf(emptyList<JSONObject>()) }
    var sharedSpaceId by rememberSaveable { mutableStateOf("") }
    var sharedProjectId by rememberSaveable { mutableStateOf("") }
    var sharedRequestId by rememberSaveable { mutableStateOf(UUID.randomUUID().toString()) }
    var createdSharedStatusJson by rememberSaveable { mutableStateOf<String?>(null) }
    var savedSharedRows by rememberSaveable { mutableIntStateOf(0) }
    val scope = rememberCoroutineScope()
    LaunchedEffect(sharedController, sharedScope) {
        if (!sharedScope || sharedController == null) return@LaunchedEffect
        runCatching { sharedController.sharedSpaces().getJSONArray("spaces") }.onSuccess { rows ->
            sharedSpaces = (0 until rows.length()).map { rows.getJSONObject(it) }
            if (sharedSpaces.none { it.optString("id") == sharedSpaceId })
                sharedSpaceId = sharedSpaces.firstOrNull()?.optString("id").orEmpty()
        }.onFailure { error = it.message ?: "Не удалось загрузить пространства." }
    }
    LaunchedEffect(sharedController, sharedScope, sharedSpaceId) {
        if (!sharedScope || sharedController == null || sharedSpaceId.isBlank()) return@LaunchedEffect
        runCatching { sharedController.sharedProjects(sharedSpaceId).getJSONArray("projects") }.onSuccess { rows ->
            sharedProjects = (0 until rows.length()).map { rows.getJSONObject(it) }
                .filter { it.optInt("isInbox") == 0 && it.optString("role") in setOf("owner", "manager", "member") }
            if (sharedProjects.none { it.optString("id") == sharedProjectId })
                sharedProjectId = sharedProjects.firstOrNull()?.optString("id").orEmpty()
        }.onFailure { error = it.message ?: "Не удалось загрузить проекты." }
    }
    Dialog({ if(!busy) onDismiss() }, properties=DialogProperties(usePlatformDefaultWidth=false)) {
        Surface(Modifier.widthIn(max = 840.dp).fillMaxWidth().padding(12.dp),shape=AffairsLayout.shape) {
            Column(Modifier.padding(16.dp).imePadding()) {
                EditorDialogHeader("Новый список задач", "close-task-list-editor", { if(!busy) onDismiss() })
                Column(Modifier.weight(1f,fill=false).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(10.dp)) {
                    if (sharedController != null) EditorSection("Доступ к списку задач") {
                        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            FilterChip(selected = !sharedScope, onClick = { sharedScope = false },
                                enabled = !busy && created == null && createdSharedStatusJson == null,
                                label = { Text("Личный список") }, modifier = Modifier.testTag("personal-list-scope"))
                            FilterChip(selected = sharedScope, onClick = { sharedScope = true },
                                enabled = !busy && created == null && createdSharedStatusJson == null,
                                label = { Text("Общий список") }, modifier = Modifier.testTag("shared-list-scope"))
                        }
                    }
                    Text(if (sharedScope) "Общий список хранится на сервере GENESIS и виден участникам выбранного проекта."
                        else if (yandex) "Список хранится в зашифрованном пространстве GENESIS; задачи отображаются в Яндекс.Календаре."
                        else "Список хранится в Google Tasks и доступен на сайте и смартфоне.",style=MaterialTheme.typography.bodySmall)
                    EditorSection("Список задач") {
                        OutlinedTextField(title,{title=it; sharedRequestId=UUID.randomUUID().toString()},label={Text("Название списка")},
                            enabled=!busy && created==null && createdSharedStatusJson==null,
                            singleLine=true,modifier=Modifier.fillMaxWidth().testTag("task-list-title"))
                    }
                    if((if (sharedScope) !sharedCanCreate else !canCreate) || !sharedScope && !localList && connected.isEmpty()) Text(
                        if (sharedScope) "Для создания общего списка требуется подключение к GENESIS."
                        else "Войдите в аккаунт и подключите календарь в настройках.",
                        color=MaterialTheme.colorScheme.error)
                    else if (!sharedScope && !localList) EditorSection("Аккаунт для размещения",Modifier.testTag("task-list-account-section")) {
                        connected.forEach { account ->
                        Row(Modifier.fillMaxWidth(),verticalAlignment=Alignment.CenterVertically) {
                            RadioButton(accountId==account.id,{accountId=account.id},enabled=!busy && created==null)
                            Text(account.email,style=MaterialTheme.typography.bodyMedium)
                        }
                        }
                    }
                    if (sharedScope) {
                        EditorSection("Общее пространство") {
                            if (sharedSpaces.isEmpty()) Text("Нет доступного общего пространства.")
                            sharedSpaces.forEach { space -> FilterChip(selected = sharedSpaceId == space.optString("id"),
                                onClick = { sharedRequestId=UUID.randomUUID().toString();
                                    sharedSpaceId = space.getString("id"); sharedProjectId = "" },
                                enabled = !busy && createdSharedStatusJson == null,
                                label = { Text(space.optString("title")) }) }
                        }
                        EditorSection("Общий проект") {
                            if (sharedProjects.isEmpty()) Text("Нет проекта, в котором вы можете создать список.")
                            sharedProjects.forEach { project -> FilterChip(selected = sharedProjectId == project.optString("id"),
                                onClick = { if (createdSharedStatusJson == null) {
                                    sharedRequestId=UUID.randomUUID().toString(); sharedProjectId = project.getString("id")
                                } },
                                enabled = !busy && createdSharedStatusJson == null,
                                label = { Text(project.optString("title")) }) }
                        }
                    } else ProjectHierarchyPicker(structure.projects,projectId) { if(!busy && created==null) projectId=it }
                    EditorSection("Задачи списка") {
                    Text("Задачи списка · по одной в строке",style=MaterialTheme.typography.titleSmall)
                    OutlinedTextField(rowsText,{rowsText=it},enabled=!busy && created==null && createdSharedStatusJson==null,
                        label={Text("Задачи списка")},minLines=3,
                        modifier=Modifier.fillMaxWidth().testTag("task-list-drafts"))
                    Text(if (sharedScope) "Задачи будут храниться вместе со списком на сервере GENESIS."
                        else "В Google Tasks список хранит название; заметки и дата сохраняются в задачах. Время и напоминание применяются GENESIS и подключённым календарём.",
                        style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    EditorSection("Дата задач") {
                    EditorCalendarModePicker(formCalendarMode, { formCalendarMode=it },
                        enabled=!busy && created==null, tag="task-list-form-calendar")
                    Text("Дата задач · ${calendarModeLabel(formCalendarMode)}")
                    AuthorDatePicker(date,formCalendarMode) { if(!busy && created==null) date=it }
                    }
                    if (!sharedScope) EditorSection("Дополнительные настройки задач") {
                    Text("Дополнительные поля для новых задач",style=MaterialTheme.typography.titleSmall)
                    OutlinedTextField(notes,{notes=it.take(8192)},enabled=!busy&&created==null,
                        label={Text("Заметка к задачам · Google Tasks")},minLines=2,
                        modifier=Modifier.fillMaxWidth().testTag("task-list-notes"))
                    Text("Время задач · GENESIS / Google Calendar",style=MaterialTheme.typography.labelLarge)
                    AuthorTimePicker(taskTime,prefs.use24) { if(!busy&&created==null) taskTime=it }
                    if(taskTime.isNotBlank()) {
                        Text("Напомнить до начала",style=MaterialTheme.typography.labelLarge)
                        Row(horizontalArrangement=Arrangement.spacedBy(6.dp)) {
                            listOf(0,10,30,60).forEach { minutes ->
                                FilterChip(reminderMinutes==minutes,{reminderMinutes=minutes},
                                    enabled=!busy&&created==null,label={Text(if(minutes==0)"Нет" else "$minutes мин")})
                            }
                        }
                    }
                    }
                    error?.let { Text(it,color=MaterialTheme.colorScheme.error) }
                    Button(enabled=(if (sharedScope) sharedCanCreate else canCreate) &&
                        (if (sharedScope) sharedProjectId.isNotBlank() else localList || connected.any { it.id==accountId })
                        && title.trim().length in 1..(if (sharedScope) 80 else 300) && !busy,
                        modifier=Modifier.fillMaxWidth().testTag("save-task-list"),onClick={
                            val rows=rowsText.lines().map(String::trim).filter(String::isNotBlank)
                            if(rows.size>100 || rows.any { it.length>500 }) { error="Добавьте до 100 задач, до 500 символов каждая."; return@Button }
                    if(rows.any { it.length > if (sharedScope) 160 else 500 }) {
                        error = if (sharedScope) "Название общей задачи должно быть не длиннее 160 символов."
                            else "Название задачи слишком длинное."
                        return@Button
                    }
                    if(rowIds.size<rows.size) rowIds=rowIds + List(rows.size-rowIds.size) { UUID.randomUUID().toString() }
                            busy=true; error=null
                            scope.launch {
                                try {
                                    if (sharedScope) {
                                        val controller = requireNotNull(sharedController)
                                        val statusId = createdSharedStatusJson?.let { JSONObject(it).getString("id") }
                                            ?: controller.createSharedStatus(sharedProjectId, title.trim(), false,
                                                sharedRequestId).getJSONObject("status").also {
                                                    createdSharedStatusJson = it.toString()
                                                }.getString("id")
                                        rows.drop(savedSharedRows).forEach { taskTitle ->
                                            controller.createSharedTask(sharedProjectId, JSONObject()
                                                .put("title", taskTitle).put("statusId", statusId)
                                                .put("dueDate", date))
                                            savedSharedRows++
                                        }
                                    } else {
                                        val list=created ?: onCreate(title.trim(),accountId).also { createdJson=it.json().toString() }
                                        onSaveTasks(list,projectId,date,rows.mapIndexed { index,text -> rowIds[index] to text },
                                            TaskListDraftOptions(notes,taskTime,if(taskTime.isBlank())0 else reminderMinutes))
                                    }
                                    onDismiss()
                                } catch(e:CancellationException) { throw e }
                                catch(e:IllegalArgumentException) { error=e.message ?: "Проверьте данные списка." }
                                catch(_:Exception) { error=if(createdJson==null && createdSharedStatusJson==null)
                                    "Не удалось создать список. Проверьте подключение и повторите попытку."
                                    else "Список создан. Не удалось сохранить все задачи; повторите сохранение." }
                                finally { busy=false }
                            }
                        }) { Text(if(busy) "Сохраняем…" else if(created==null && createdSharedStatusJson==null)
                            "Создать список" else "Сохранить задачи") }
                }
            }
        }
    }
}
