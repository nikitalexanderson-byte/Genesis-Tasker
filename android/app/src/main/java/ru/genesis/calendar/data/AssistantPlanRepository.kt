package ru.genesis.calendar.data

import kotlinx.coroutines.flow.first
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AssistantGateway
import ru.genesis.calendar.auth.LinkedGoogleAccount
import ru.genesis.calendar.domain.CalendarMode
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.util.Locale
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

/** Rejects ambiguous names, invalid dates and dangling references before any creation. */
internal object AssistantPlanProtocol {
    fun key(value: String) = value.trim().lowercase(Locale.ROOT)
    fun resolveList(row: JSONObject, lists: List<GoogleTaskList>, accounts: List<LinkedGoogleAccount>): GoogleTaskList? {
        val email = row.getString("accountEmail")
        val matches = lists.filter { key(it.title) == key(row.getString("title")) &&
            (email.isBlank() || key(it.accountEmail) == key(email) || accounts.any { account -> key(account.email) == key(email) && account.id == it.accountId }) }
        require(matches.size <= 1) { "Есть несколько списков с этим названием: ${row.getString("title")}" }
        return matches.singleOrNull()
    }
    fun rows(value: JSONObject, field: String, maximum: Int): List<JSONObject> = value.getJSONArray(field).let {
        require(it.length() <= maximum) { "Слишком большой план. Разделите команду." }
        (0 until it.length()).map(it::getJSONObject)
    }
    fun validate(plan: JSONObject, structure: WorkspaceStructure, lists: List<GoogleTaskList>, accounts: List<LinkedGoogleAccount>, today: LocalDate) {
        val projects = rows(plan, "projects", 20)
        val taskLists = rows(plan, "taskLists", 20)
        val tasks = rows(plan, "tasks", 100)
        fun title(row: JSONObject): String = row.getString("title").trim().also {
            require(it.isNotEmpty() && it.length <= 300) { "В плане есть запись без корректного названия." }
        }
        fun unique(values: List<String>) { require(values.map(::key).distinct().size == values.size) { "В плане есть неоднозначные названия. Уточните команду." } }
        unique(projects.map(::title)); unique(taskLists.map(::title))
        val projectNames = structure.projects.map { key(it.title) } + projects.map { key(title(it)) }
        fun project(name: String) { require(name.isBlank() || key(name) in projectNames) { "Проект не найден: $name" } }
        projects.forEach { row ->
            title(row); require(row.getString("description").length <= 5000)
            val category = row.getString("category")
            require(category.isBlank() || structure.categories.count { key(it.name) == key(category) } == 1) { "Категория не найдена: $category" }
            project(row.getString("parentProject"))
            require(row.getString("parentProject").isBlank() || structure.projects.count { key(it.title) == key(row.getString("parentProject")) } <= 1) { "Есть несколько проектов с этим названием: ${row.getString("parentProject")}" }
            val tags = row.getJSONArray("tags")
            require(tags.length() <= 10 && (0 until tags.length()).all { tags.getString(it).let { tag -> tag.isNotBlank() && tag.length <= 80 } })
        }
        val planned = projects.associateBy { key(title(it)) }
        projects.forEach { row ->
            val visited = mutableSetOf<String>(); var name = key(title(row))
            while (name in planned) {
                require(visited.add(name)) { "В плане есть цикл вложенности проектов." }
                name = key(planned.getValue(name).getString("parentProject"))
            }
        }
        fun unambiguousProject(name: String) {
            project(name)
            require(name.isBlank() || structure.projects.count { key(it.title) == key(name) } <= 1) { "Есть несколько проектов с этим названием: $name" }
        }
        taskLists.forEach { row ->
            title(row); unambiguousProject(row.getString("project"))
            val email = row.getString("accountEmail")
            require(email.isBlank() || accounts.count { key(it.email) == key(email) && it.tasksConnected } == 1) { "Подключите Google Tasks для аккаунта: $email" }
            require(email.isNotBlank() || accounts.count { it.tasksConnected } <= 1) { "Укажите аккаунт для списка в команде." }
            resolveList(row, lists, accounts)
        }
        val listNames = lists.map { key(it.title) } + taskLists.map { key(title(it)) }
        tasks.forEach { row ->
            title(row); require(row.getString("description").length <= 5000)
            val start = row.getString("startDate").ifBlank { today.toString() }.let(LocalDate::parse)
            val end = row.getString("dueDate").ifBlank { start.toString() }.let(LocalDate::parse)
            require(start >= today && end >= start && end.year <= 2100) { "Проверьте даты задач в плане." }
            row.getString("time").takeIf(String::isNotBlank)?.let(LocalTime::parse)
            require(row.getInt("priority") in 1..10 && row.getInt("reminderMinutes") in 0..40320)
            val tags = row.getJSONArray("tags")
            require(tags.length() <= 6 && (0 until tags.length()).all { tags.getString(it).let { tag -> tag.isNotBlank() && tag.length <= 80 } })
            unambiguousProject(row.getString("project"))
            val list = row.getString("taskList")
            require(list.isBlank() || key(list) in listNames) { "Список не найден: $list" }
            require(list.isBlank() || taskLists.any { key(it.getString("title")) == key(list) } || lists.count { key(it.title) == key(list) } <= 1) { "Уточните список задачи: $list" }
            if (list.isNotBlank() && taskLists.none { key(it.getString("title")) == key(list) }) {
                lists.singleOrNull { key(it.title) == key(list) }?.accountId?.let { id ->
                    require(accounts.any { it.id == id && it.tasksConnected }) { "Подключите Google Tasks в настройках." }
                }
            }
        }
    }
}

/** The reviewed plan and progress stay encrypted. Stable IDs make interrupted local writes resumable. */
internal class AssistantPlanRepository(private val app: GenesisApplication, private val owner: String,
    private val gateway: AssistantGateway, private val createList: suspend (String, String) -> GoogleTaskList) {
    private val scope = app.workspaceScope
    private val cipher = LocalCipher()
    private val mutex = locks.getOrPut("$scope/$owner") { Mutex() }
    private val kind = "assistant-plan-v1"
    private val taskRepository = app.repository
    private fun check() { gateway.check(); check(app.workspaceScope == scope) }
    private suspend fun persist(value: JSONObject?) {
        check()
        if (value == null) app.database.dao().deleteDocument(scope, kind)
        else app.database.dao().putDocument(DocumentRecord(scope, kind, cipher.encrypt(value.toString(), "$scope/$kind/$owner"), System.currentTimeMillis()))
        check()
    }
    private suspend fun readCurrent(): JSONObject? {
        check(); app.database.dao().document(scope, kind)?.let {
            return JSONObject(cipher.decrypt(it.encrypted, "$scope/$kind/$owner")).also { value -> require(value.getInt("schemaVersion") == 1) }
        }
        return null
    }
    suspend fun load(): JSONObject? = mutex.withLock { readCurrent() }
    suspend fun discard(id: String) = mutex.withLock {
        require(readCurrent()?.getString("id") == id) { "Запись изменилась. Проверьте созданные задачи." }
        persist(null)
    }
    suspend fun prepare(response: JSONObject, structure: WorkspaceStructure, lists: List<GoogleTaskList>, accounts: List<LinkedGoogleAccount>): JSONObject = mutex.withLock {
        check(); require(response.getString("provider") in setOf("gemini", "gigachat"))
        require(readCurrent() == null) { "Сначала завершите или отмените сохранённый план." }
        val reviewedToday = LocalDate.now()
        val cleanResponse = JSONObject(response.toString())
        val plan = cleanResponse.getJSONObject("plan")
        AssistantPlanProtocol.rows(plan, "tasks", 100).forEach { task ->
            val start = task.getString("startDate").ifBlank { reviewedToday.toString() }
            task.put("startDate", start).put("dueDate", task.getString("dueDate").ifBlank { start })
        }
        AssistantPlanProtocol.validate(plan, structure, lists, accounts, reviewedToday)
        JSONObject().put("schemaVersion", 1).put("id", UUID.randomUUID().toString()).put("response", cleanResponse).put("reviewedToday", reviewedToday.toString())
            .put("projectIds", JSONArray(AssistantPlanProtocol.rows(plan, "projects", 20).map { UUID.randomUUID().toString() }))
            .put("taskIds", JSONArray(AssistantPlanProtocol.rows(plan, "tasks", 100).map { UUID.randomUUID().toString() }))
            .put("lists", JSONObject()).put("pendingList", -1).put("projectsDone", 0).put("listsDone", 0).put("tasksDone", 0)
            .also { persist(it) }
    }
    suspend fun apply(journal: JSONObject, accounts: List<LinkedGoogleAccount>, mode: CalendarMode, onProgress: (JSONObject) -> Unit) = mutex.withLock {
        check()
        val state = requireNotNull(readCurrent()) { "Запись изменилась. Проверьте созданные задачи." }
        require(state.getString("id") == journal.getString("id")) { "Запись изменилась. Проверьте созданные задачи." }
        val plan = state.getJSONObject("response").getJSONObject("plan")
        val structureRepository = WorkspaceStructureRepository(app)
        var structure = structureRepository.workspace.first()
        var lists = TaskListsRepository(app, scope).lists.first()
        val reviewedToday = LocalDate.parse(state.getString("reviewedToday"))
        AssistantPlanProtocol.validate(plan, structure, lists, accounts, reviewedToday)
        val projects = AssistantPlanProtocol.rows(plan, "projects", 20)
        val plannedIds = projects.mapIndexed { index, row -> AssistantPlanProtocol.key(row.getString("title")) to state.getJSONArray("projectIds").getString(index) }.toMap()
        val allProjects = structure.projects.associateBy { AssistantPlanProtocol.key(it.title) }.toMutableMap()
        projects.forEachIndexed { index, row ->
            structure.projects.firstOrNull { it.id == state.getJSONArray("projectIds").getString(index) }?.let {
                allProjects[AssistantPlanProtocol.key(row.getString("title"))] = it
            }
        }
        suspend fun checkpoint() { persist(state); onProgress(JSONObject(state.toString())) }
        suspend fun createProject(index: Int) {
            check()
            val row = projects[index]; val name = AssistantPlanProtocol.key(row.getString("title"))
            if (name in allProjects) return
            require(index >= state.getInt("projectsDone")) { "Проект не найден: ${row.getString("title")}" }
            val parentName = AssistantPlanProtocol.key(row.getString("parentProject"))
            if (parentName.isNotBlank() && parentName !in allProjects) {
                createProject(projects.indexOfFirst { AssistantPlanProtocol.key(it.getString("title")) == parentName }.also { require(it >= 0) })
            }
            val id = plannedIds.getValue(name)
            val existing = structure.projects.firstOrNull { it.id == id }
            val tags = row.getJSONArray("tags").let { (0 until it.length()).map(it::getString) }
            val project = existing ?: GenesisProject(id, allProjects[parentName]?.id,
                structure.categories.firstOrNull { AssistantPlanProtocol.key(it.name) == AssistantPlanProtocol.key(row.getString("category")) }?.id,
                row.getString("title").trim(), row.getString("description"), tags, "active", structure.projects.size + index)
            if (existing == null) structureRepository.saveProject(project)
            allProjects[name] = project
        }
        for (index in state.getInt("projectsDone") until projects.size) { createProject(index); state.put("projectsDone", index + 1); checkpoint() }
        val listRows = AssistantPlanProtocol.rows(plan, "taskLists", 20)
        val known = state.getJSONObject("lists")
        for (index in state.getInt("listsDone") until listRows.size) {
            check(); val row = listRows[index]
            val title = row.getString("title").trim()
            var list = known.optJSONObject(index.toString())?.let(GoogleTaskList::from)
                ?: AssistantPlanProtocol.resolveList(row, lists, accounts)
            if (list == null) {
                require(state.getInt("pendingList") != index) { "Ответ создания списка не получен. Обновите данные и проверьте списки перед повтором; новый запрос не отправлен." }
                val email = row.getString("accountEmail")
                val account = accounts.firstOrNull { it.tasksConnected && (email.isBlank() || AssistantPlanProtocol.key(it.email) == AssistantPlanProtocol.key(email)) }
                require(account != null || accounts.none { it.provider == "google" }) { "Подключите Google Tasks в настройках." }
                state.put("pendingList", index); checkpoint()
                list = createList(title, account?.id.orEmpty()); check()
                lists = lists + list
            }
            known.put(index.toString(), list.json()); state.put("pendingList", -1); checkpoint()
            lists = lists.filterNot { it.id == list.id && it.accountId == list.accountId } + list
            if (row.getString("project").isNotBlank()) structureRepository.linkTaskList(list.id, allProjects[AssistantPlanProtocol.key(row.getString("project"))]?.id)
            state.put("listsDone", index + 1); checkpoint()
        }
        structure = structureRepository.workspace.first()
        val taskRows = AssistantPlanProtocol.rows(plan, "tasks", 100)
        for (index in state.getInt("tasksDone") until taskRows.size) {
            check(); val row = taskRows[index]; val id = state.getJSONArray("taskIds").getString(index)
            val existing = taskRepository.get(id)
            if (existing == null) {
                val projectName = row.getString("project")
                val project = allProjects[AssistantPlanProtocol.key(projectName)]
                require(projectName.isBlank() || project != null) { "Проект не найден: $projectName" }
                val listName = row.getString("taskList")
                val plannedListIndex = listRows.indexOfFirst { AssistantPlanProtocol.key(it.getString("title")) == AssistantPlanProtocol.key(listName) }
                val list = if (plannedListIndex >= 0) known.optJSONObject(plannedListIndex.toString())?.let(GoogleTaskList::from)
                    else lists.singleOrNull { AssistantPlanProtocol.key(it.title) == AssistantPlanProtocol.key(listName) }
                require(listName.isBlank() || list != null && lists.any { it.id == list.id && it.accountId == list.accountId }) { "Список не найден: $listName" }
                val start = row.getString("startDate").ifBlank { reviewedToday.toString() }
                val source = (list?.let { listTaskFields(it, mode) } ?: JSONObject())
                    .put("assistantPlanId", state.getString("id")).put("calendarMode", mode.wireValue)
                    .put("dueDate", start).put("endDate", row.getString("dueDate").ifBlank { start }).put("tags", row.getJSONArray("tags"))
                val projectId = project?.id ?: structure.taskListLinks.firstOrNull { it.taskListId == list?.id }?.projectId
                taskRepository.save(LocalTask(id = id, title = row.getString("title").trim(), description = row.getString("description"),
                    date = start, time = row.getString("time"), priority = row.getInt("priority"), zoneId = ZoneId.systemDefault().id,
                    projectId = projectId, sourceFieldsJson = source.toString(), reminders = if (row.getInt("reminderMinutes") > 0 && row.getString("time").isNotBlank()) listOf(TaskReminder.relative(row.getInt("reminderMinutes"))) else emptyList()))
            } else require(JSONObject(existing.sourceFieldsJson).optString("assistantPlanId") == state.getString("id")) { "Запись изменилась. Проверьте созданные задачи." }
            state.put("tasksDone", index + 1); checkpoint()
        }
        persist(null)
    }
    private companion object { val locks = ConcurrentHashMap<String, Mutex>() }
}
