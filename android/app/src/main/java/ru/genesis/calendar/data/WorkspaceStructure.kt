package ru.genesis.calendar.data

import androidx.room.withTransaction
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.flowOn
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication

/** These field names and default category IDs match app/cloud-sync.ts and GenesisCalendar.tsx. */
data class GenesisCategory(val id: String, val name: String, val color: String, val position: Int)
data class GenesisProject(val id: String, val parentId: String?, val categoryId: String?,
    val title: String, val description: String, val tags: List<String>, val status: String, val position: Int)
data class TaskListProjectLink(val taskListId: String, val projectId: String?)
data class WorkspaceStructure(val projects: List<GenesisProject> = emptyList(),
    val categories: List<GenesisCategory> = defaultCategories, val taskListLinks: List<TaskListProjectLink> = emptyList(),
    val revision: Long = 0, val taskLists: List<GoogleTaskList> = emptyList()) {
    companion object {
        val defaultCategories = listOf(
            GenesisCategory("personal", "Личное", "#a5543f", 0),
            GenesisCategory("work", "Работа", "#2d6c68", 1),
            GenesisCategory("health", "Тело и здоровье", "#b18b48", 2),
        )
    }
}

/** Structure fragment only: never PUT this fragment over the full encrypted cloud document. */
object WorkspaceStructureCodec {
    private fun JSONObject.nullable(name: String): String? = if (isNull(name)) null else getString(name)
    private fun JSONArray.strings() = (0 until length()).map { getString(it) }
    fun decode(raw: String, revision: Long = 0): WorkspaceStructure {
        val root = JSONObject(raw)
        val projects = root.getJSONArray("projects").let { rows -> (0 until rows.length()).map { index ->
            val item = rows.getJSONObject(index)
            GenesisProject(item.getString("id"), item.nullable("parentId"), item.nullable("categoryId"),
                item.getString("title"), item.getString("description"), item.getJSONArray("tags").strings(),
                item.getString("status"), item.getInt("position"))
        } }
        val categories = root.getJSONArray("categories").let { rows -> (0 until rows.length()).map { index ->
            val item = rows.getJSONObject(index)
            GenesisCategory(item.getString("id"), item.getString("name"), item.getString("color"), item.getInt("position"))
        } }
        val links = root.getJSONArray("taskListLinks").let { rows -> (0 until rows.length()).map { index ->
            val item = rows.getJSONObject(index)
            TaskListProjectLink(item.getString("taskListId"), item.nullable("projectId"))
        } }
        val taskLists = root.optJSONArray("taskLists")?.let { rows -> (0 until rows.length()).map {
            GoogleTaskList.from(rows.getJSONObject(it))
        } } ?: emptyList()
        return WorkspaceStructure(projects, categories, links, revision, taskLists).also(::validate)
    }

    fun encode(value: WorkspaceStructure): String {
        validate(value)
        val projects = JSONArray().apply { value.projects.forEach { item -> put(JSONObject()
            .put("id", item.id).put("parentId", item.parentId ?: JSONObject.NULL)
            .put("categoryId", item.categoryId ?: JSONObject.NULL).put("title", item.title)
            .put("description", item.description).put("tags", JSONArray(item.tags))
            .put("status", item.status).put("position", item.position)) } }
        val categories = JSONArray().apply { value.categories.forEach { item -> put(JSONObject()
            .put("id", item.id).put("name", item.name).put("color", item.color).put("position", item.position)) } }
        val links = JSONArray().apply { value.taskListLinks.forEach { item -> put(JSONObject()
            .put("taskListId", item.taskListId).put("projectId", item.projectId ?: JSONObject.NULL)) } }
        return JSONObject().put("projects", projects).put("categories", categories)
            .put("taskListLinks", links)
            .put("taskLists", JSONArray().apply { value.taskLists.forEach { put(it.json()) } }).toString()
    }

    /** Staging helper for a future authenticated CAS merge. Keeps every unrelated cloud section intact. */
    fun mergeIntoDecryptedWorkspace(cloudPlaintext: String, structure: WorkspaceStructure): String {
        val cloud = JSONObject(cloudPlaintext)
        val fragment = JSONObject(encode(structure))
        cloud.put("projects", fragment.getJSONArray("projects"))
            .put("categories", fragment.getJSONArray("categories"))
            .put("taskListLinks", fragment.getJSONArray("taskListLinks"))
            .put("taskLists", fragment.getJSONArray("taskLists"))
        return cloud.toString()
    }

    fun validate(value: WorkspaceStructure) {
        val projects = value.projects.associateBy { it.id }
        val categories = value.categories.associateBy { it.id }
        require(projects.size == value.projects.size && categories.size == value.categories.size) { "Повторяющиеся идентификаторы структуры." }
        value.categories.forEach {
            require(it.id.isNotBlank() && it.name.isNotBlank() && it.name.length <= 120 && it.position >= 0)
            require(Regex("#[0-9a-fA-F]{6}").matches(it.color))
        }
        value.projects.forEach { project ->
            require(project.id.isNotBlank() && project.title.isNotBlank() && project.title.length <= 500 &&
                project.description.length <= 5000 && project.position >= 0 && project.status in setOf("active", "completed", "archived"))
            require(project.tags.size <= 10 && project.tags.all { it.isNotBlank() && it.length <= 80 })
            require(project.categoryId == null || project.categoryId in categories)
            require(project.parentId == null || project.parentId in projects)
            val visited = mutableSetOf(project.id)
            var parent = project.parentId
            while (parent != null) {
                require(visited.add(parent)) { "Цикл во вложенности проектов." }
                parent = projects.getValue(parent).parentId
            }
        }
        require(value.taskListLinks.distinctBy { it.taskListId }.size == value.taskListLinks.size)
        require(value.taskLists.distinctBy { it.id }.size == value.taskLists.size)
        value.taskListLinks.forEach { require(it.taskListId.isNotBlank() && (it.projectId == null || it.projectId in projects)) }
    }

    fun ordered(value: WorkspaceStructure): List<Pair<GenesisProject, Int>> {
        val byParent = value.projects.groupBy { it.parentId }
        fun children(parent: String?, depth: Int): List<Pair<GenesisProject, Int>> = byParent[parent].orEmpty()
            .sortedWith(compareBy<GenesisProject> { it.position }.thenBy { it.title })
            .flatMap { listOf(it to depth) + children(it.id, depth + 1) }
        return children(null, 0)
    }

    fun projectSubtreeIds(projects: List<GenesisProject>, rootId: String): Set<String> {
        if (projects.none { it.id == rootId }) return emptySet()
        val removed = mutableSetOf(rootId)
        var changed = true
        while (changed) {
            changed = false
            projects.forEach { project ->
                if (project.parentId in removed && removed.add(project.id)) changed = true
            }
        }
        return removed
    }
}

class WorkspaceStructureRepository(private val app: GenesisApplication) {
    private val dao = app.database.dao()
    private val cipher = LocalCipher()
    private val scope = app.workspaceScope
    private val mutation=ru.genesis.calendar.auth.NativeBackupMutationGuard(scope)
    private val kind = "structure"
    val workspace = dao.observeDocument(scope, kind).map { record ->
        if (record == null) WorkspaceStructure() else WorkspaceStructureCodec.decode(
            cipher.decrypt(record.encrypted, "$scope/$kind"), record.revision)
    }.flowOn(Dispatchers.IO)

    private suspend fun mutate(expectedRevision: Long?, change: (WorkspaceStructure) -> WorkspaceStructure) = app.database.withTransaction {
        mutation.check()
        val record = dao.document(scope, kind)
        val current = if (record == null) WorkspaceStructure() else WorkspaceStructureCodec.decode(
            cipher.decrypt(record.encrypted, "$scope/$kind"), record.revision)
        require(expectedRevision == null || current.revision == expectedRevision) {
            "Структура проектов изменилась. Откройте форму заново."
        }
        val next = change(current).copy(revision = current.revision + 1)
        app.requireQuotaGrowth("personal-projects",current.projects.size,next.projects.size,scope)
        dao.putDocument(DocumentRecord(scope, kind, cipher.encrypt(WorkspaceStructureCodec.encode(next), "$scope/$kind"), next.revision))
        dao.putOutbox(OutboxRecord(scope, "workspace-structure", next.revision, UUID.randomUUID().toString()))
    }

    suspend fun saveProject(project: GenesisProject, expectedRevision: Long? = null) = mutate(expectedRevision) { current ->
        val existing = current.projects.any { it.id == project.id }
        current.copy(projects = if (existing) current.projects.map { if (it.id == project.id) project else it }
            else current.projects + project)
    }

    suspend fun linkTaskList(taskListId: String, projectId: String?) = mutate(null) { current ->
        require(projectId == null || current.projects.any { it.id == projectId }) { "Проект не найден. Выберите его заново." }
        current.copy(taskListLinks = current.taskListLinks.filterNot { it.taskListId == taskListId } +
            TaskListProjectLink(taskListId, projectId))
    }

    suspend fun saveTaskList(list: GoogleTaskList) = mutate(null) { current ->
        current.copy(taskLists = current.taskLists.filterNot { it.id == list.id } + list)
    }

    suspend fun removeTaskList(listId: String) = mutate(null) { current ->
        current.copy(taskLists = current.taskLists.filterNot { it.id == listId },
            taskListLinks = current.taskListLinks.filterNot { it.taskListId == listId })
    }

    suspend fun deleteProject(projectId: String, expectedRevision: Long? = null) = mutate(expectedRevision) { current ->
        val removed = WorkspaceStructureCodec.projectSubtreeIds(current.projects, projectId)
        require(removed.isNotEmpty()) { "Проект больше не существует." }
        current.copy(
            projects = current.projects.filterNot { it.id in removed },
            taskListLinks = current.taskListLinks.map { link ->
                if (link.projectId in removed) link.copy(projectId = null) else link
            },
        )
    }

    /** A confirmed server import removes the private tree and its tasks as one local commit. */
    suspend fun removeImportedProjectTree(rootId: String, expectedRevision: Long,
        expectedProjectIds: Set<String>, expectedTasks: Map<String, Long>) = app.scheduler.withMutation {
        val reminders = mutableListOf<ReminderRecord>()
        app.database.withTransaction {
            mutation.check()
            val document = dao.document(scope, kind) ?: throw IllegalArgumentException("Проект больше не существует.")
            val current = WorkspaceStructureCodec.decode(
                cipher.decrypt(document.encrypted, "$scope/$kind"), document.revision)
            val removed = WorkspaceStructureCodec.projectSubtreeIds(current.projects, rootId)
            require(current.revision == expectedRevision && removed.isNotEmpty() &&
                removed == expectedProjectIds && current.taskListLinks.none { it.projectId in removed }) {
                "Личный проект изменился во время переноса. Общая копия создана; личный оригинал сохранён."
            }
            val related = dao.accountTasks(scope).filter { row ->
                val task = JSONObject(cipher.decrypt(row.encrypted, "$scope/${row.id}"))
                !task.isNull("projectId") && task.optString("projectId") in removed
            }
            require(related.map { it.id }.toSet() == expectedTasks.keys &&
                related.all { expectedTasks[it.id] == it.revision }) {
                "Задачи изменились во время переноса. Общая копия создана; личные записи сохранены."
            }
            related.forEach { row ->
                reminders += dao.taskReminders(scope, row.id)
                dao.putTask(row.copy(deleted = true, revision = row.revision + 1))
                dao.cancelReminders(scope, row.id)
                dao.putOutbox(OutboxRecord(scope, row.id, row.revision + 1, UUID.randomUUID().toString()))
            }
            val next = current.copy(projects = current.projects.filterNot { it.id in removed },
                revision = current.revision + 1)
            dao.putDocument(DocumentRecord(scope, kind,
                cipher.encrypt(WorkspaceStructureCodec.encode(next), "$scope/$kind"), next.revision))
            dao.putOutbox(OutboxRecord(scope, "workspace-structure", next.revision, UUID.randomUUID().toString()))
        }
        reminders.forEach(app.scheduler::cancel)
        app.scheduler.scheduleUpcomingLocked(scope)
    }

    suspend fun saveCategory(category: GenesisCategory, expectedRevision: Long? = null) = mutate(expectedRevision) { current ->
        val existing = current.categories.any { it.id == category.id }
        current.copy(categories = if (existing) current.categories.map { if (it.id == category.id) category else it }
            else current.categories + category)
    }

    suspend fun deleteCategory(categoryId: String, expectedRevision: Long? = null) = mutate(expectedRevision) { current ->
        require(current.categories.any { it.id == categoryId }) { "Категория больше не существует." }
        current.copy(
            categories = current.categories.filterNot { it.id == categoryId },
            projects = current.projects.map { project ->
                if (project.categoryId == categoryId) project.copy(categoryId = null) else project
            },
        )
    }
}
