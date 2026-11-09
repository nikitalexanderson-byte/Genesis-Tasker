package ru.genesis.calendar.data

import androidx.room.withTransaction
import java.time.LocalDate
import java.time.LocalTime
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.flow.map
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.domain.CalendarMode

data class GoogleTaskList(val id: String, val title: String, val accountId: String? = null,
    val accountEmail: String = "", val isDefault: Boolean = false) {
    fun json() = JSONObject().put("id", id).put("title", title)
        .put("accountId", accountId ?: JSONObject.NULL).put("accountEmail", accountEmail).put("isDefault", isDefault)
    companion object {
        fun from(value: JSONObject): GoogleTaskList {
            val id = value.getString("id")
            val title = value.getString("title")
            require(id.isNotBlank() && id.length <= 500 && title.isNotBlank() && title.length <= 300)
            return GoogleTaskList(id, title, value.optString("accountId").takeUnless {
                value.isNull("accountId") || it.isBlank() }, value.optString("accountEmail"), value.optBoolean("isDefault"))
        }
    }
}

/** Google list metadata is encrypted on the phone; its IDs match the site's task lists. */
class TaskListsRepository(private val app: GenesisApplication, private val accountScope: String = app.workspaceScope) {
    private val cipher = LocalCipher()
    private val kind = "task-lists"
    val lists = app.database.dao().observeDocument(accountScope, kind).map { row ->
        if (row == null) emptyList() else decode(cipher.decrypt(row.encrypted, "$accountScope/$kind"))
    }.flowOn(Dispatchers.IO)

    suspend fun rememberCreated(list: GoogleTaskList) = app.database.withTransaction {
        require(app.workspaceScope == accountScope) { "Аккаунт изменился. Откройте форму заново." }
        val row = app.database.dao().document(accountScope, kind)
        val previous = row?.let { decode(cipher.decrypt(it.encrypted, "$accountScope/$kind")) }.orEmpty()
        store(app.database, accountScope, previous.filterNot { it.id == list.id && it.accountId == list.accountId } + list,
            (row?.revision ?: 0) + 1)
    }
    suspend fun rememberRemoved(list: GoogleTaskList) = app.database.withTransaction {
        require(app.workspaceScope == accountScope) { "Аккаунт изменился. Откройте форму заново." }
        val row = app.database.dao().document(accountScope, kind) ?: return@withTransaction
        val previous = decode(cipher.decrypt(row.encrypted, "$accountScope/$kind"))
        store(app.database, accountScope, previous.filterNot { it.id == list.id && it.accountId == list.accountId },
            row.revision + 1)
    }

    companion object {
        private const val kind = "task-lists"
        private fun decode(raw: String): List<GoogleTaskList> = JSONArray(raw).let { rows ->
            (0 until rows.length()).map { GoogleTaskList.from(rows.getJSONObject(it)) }
        }
        private suspend fun store(db: GenesisDatabase, scope: String, lists: List<GoogleTaskList>, revision: Long) {
            val raw = JSONArray().apply { lists.forEach { put(it.json()) } }.toString()
            db.dao().putDocument(DocumentRecord(scope, kind, LocalCipher().encrypt(raw, "$scope/$kind"), revision))
        }
        /** Deferred, incomplete or malformed pulls never erase the phone's known lists. */
        internal suspend fun cacheBootstrap(db: GenesisDatabase, scope: String, payload: JSONObject) {
            require(scope.matches(Regex("account-[a-f0-9]{32}")))
            if (payload.optJSONObject("user")?.optString("authProvider") != "google") return
            if(payload.optBoolean("tasksDeferred")) return
            val rows = payload.optJSONArray("taskLists") ?: return
            val incoming = (0 until rows.length()).mapNotNull { index ->
                runCatching { GoogleTaskList.from(rows.getJSONObject(index)) }.getOrNull()
            }.distinctBy { it.accountId to it.id }
            val partial = incoming.size != rows.length() || payload.optString("syncWarning").let { it.isNotBlank() && it != "null" }
            db.withTransaction {
                val cached = db.dao().document(scope, kind)
                val previous = cached?.let { decode(LocalCipher().decrypt(it.encrypted, "$scope/$kind")) }.orEmpty()
                val next = if(partial) previous.filterNot { old -> incoming.any { it.id == old.id && it.accountId == old.accountId } } + incoming else incoming
                store(db, scope, next, (cached?.revision ?: 0) + 1)
            }
        }
    }
}

internal fun LocalTask.taskListId(): String? = JSONObject(sourceFieldsJson).let { source ->
    source.optString("googleTaskListId").takeUnless { source.isNull("googleTaskListId") || it.isBlank() }
}

internal fun LocalTask.belongsToList(list: GoogleTaskList): Boolean =
    taskListId() == list.id && (list.accountId == null ||
        JSONObject(sourceFieldsJson).optString("googleAccountId") == list.accountId)

/** Explicit task placement wins; otherwise follow the list's workspace link. */
internal fun personalTaskProjectId(task: LocalTask, structure: WorkspaceStructure): String? {
    if (task.projectId == "__genesis_inbox__") return null
    val id = task.projectId
        ?: structure.taskListLinks.firstOrNull { it.taskListId == task.taskListId() }?.projectId
    return id?.takeIf { candidate -> structure.projects.any { it.id == candidate } }
}

internal fun taskListsForTasks(lists: List<GoogleTaskList>, tasks: List<LocalTask>): List<GoogleTaskList> =
    (lists + tasks.mapNotNull { task -> runCatching {
        val raw = JSONObject(task.sourceFieldsJson)
        val id = task.taskListId() ?: return@runCatching null
        GoogleTaskList(id, raw.optString("googleTaskListTitle").ifBlank { "Google Tasks" },
            raw.optString("googleAccountId").takeUnless { raw.isNull("googleAccountId") || it.isBlank() }, raw.optString("googleAccountEmail"))
    }.getOrNull() }).distinctBy { it.accountId to it.id }

/** Only lists a person created are offered when placing a new task. */
internal fun userTaskLists(lists: List<GoogleTaskList>): List<GoogleTaskList> = lists.filterNot { list ->
    list.isDefault || (list.accountId != null && list.title.trim().lowercase() in
        setOf("мои задачи", "my tasks", "привычки genesis"))
}

/** Route new list tasks to that list's account, retaining the website's field meanings. */
internal fun listTaskFields(list: GoogleTaskList, mode: CalendarMode) = JSONObject()
    .put("googleTaskListId", list.id).put("googleTaskListTitle", list.title)
    .put("googleAccountId", list.accountId ?: JSONObject.NULL).put("googleAccountEmail", list.accountEmail)
    .put("syncAccountIds", JSONArray(list.accountId?.let(::listOf).orEmpty()))
    .put("googleTaskId", JSONObject.NULL).put("googleEventId", JSONObject.NULL).put("googleLinks", JSONObject())
    .put("createdIn", "genesis").put("syncToGoogle", true).put("calendarMode", mode.wireValue)
    .put("tags", JSONArray()).put("dependsOnIds", JSONArray()).put("googleReadOnly", false)

internal data class TaskListDraftOptions(val notes: String = "", val time: String = "",
    val reminderMinutes: Int = 0)

internal suspend fun saveListDraftTasks(app: GenesisApplication, list: GoogleTaskList, projectId: String?,
    date: String, mode: CalendarMode, rows: List<Pair<String, String>>,
    options: TaskListDraftOptions = TaskListDraftOptions()) {
    LocalDate.parse(date)
    require(options.notes.length <= 8_192)
    require(options.time.isBlank() || runCatching { LocalTime.parse(options.time) }.isSuccess)
    require(options.reminderMinutes in 0..40_320 && (options.reminderMinutes == 0 || options.time.isNotBlank()))
    val ownerScope = app.workspaceScope
    val structureRepository = WorkspaceStructureRepository(app)
    val repository = app.repository
    structureRepository.linkTaskList(list.id, projectId)
    rows.filter { it.second.isNotBlank() }.forEach { (id, title) ->
        // Stable draft IDs make a retry after a partial local save safe.
        require(app.workspaceScope == ownerScope) { "Аккаунт изменился. Откройте форму заново." }
        if(repository.get(id) == null) repository.save(LocalTask(id = id, title = title.trim(),
            description = options.notes.trim(), date = date, time = options.time,
            projectId = projectId, sourceFieldsJson = listTaskFields(list, mode).toString(),
            reminders = if(options.reminderMinutes>0)
                listOf(TaskReminder.relative(options.reminderMinutes)) else emptyList()))
    }
}
