package ru.genesis.calendar.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.util.UUID

internal class SavedViewHttpsFixture : AutoCloseable {
    val base = TemplateHttpsFixture()
    private val storage by lazy { PlanningDraftStore(base.app, "saved-views") }
    private val journal by lazy { PlanningJournal(storage, contract = SavedViewJournalContract) }
    var loseReply = false
    var readFailure = ""
    val commands = mutableListOf<String>()
    fun open() { base.open(); storage.clear() }
    fun definition(title: String = "B5 Android • Свои условия") = JSONObject().put("version", 1).put("title", title)
        .put("filter", JSONObject().put("spaceId", base.space).put("projectIds", org.json.JSONArray().put(base.project)))
        .put("sort", "priority").put("relative", "none").put("calendarMode", "lunar")
        .put("calendarContext", JSONObject().put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "march"))
    fun edit(title: String = "B5 Android • Свои условия", shared: Boolean = false): JSONObject = SavedViewProtocol.newEdit(definition(title))
        .put("spaceId", base.space).put("visibility", if (shared) "shared" else "personal")
    fun service() = SavedViewDraftService(journal, base.actor, object : SavedViewAccess {
        override fun check() { check(base.client.isCurrent(base.generation)) }
        override fun view(id: String) = base.client.sharedSavedView(base.generation, id)
        override fun preview(definition: JSONObject) { base.client.querySharedTasks(base.generation, JSONObject().put("viewDefinition", definition), null) }
        override fun send(command: JSONObject): JSONObject {
            commands += command.toString()
            return base.client.sendSharedSavedView(base.generation, command).also { if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) } }
        }
    })
    fun save(edit: JSONObject): JSONObject {
        val service = service(); val local = service.save(null, edit); val pending = service.prepare(local.getString("stamp"))
        val received = service.send(pending.getString("stamp")); service.remove(received.getString("stamp"))
        return received.getJSONObject("receipt").getJSONObject("view")
    }
    fun query(filter: JSONObject, cursor: String? = null) = base.client.querySharedTasks(base.generation, filter, cursor)
    val gateway = object : SharedWorkspaceGateway by base.gateway {
        private suspend fun <T> io(work: () -> T) = withContext(Dispatchers.IO) { work() }
        override suspend fun sharedSavedViews(cursor: String?) = io { try { base.client.sharedSavedViews(base.generation, cursor) } catch (failure: Exception) { readFailure = failure.message.orEmpty(); throw failure } }
        override suspend fun sharedSavedView(id: String) = io { base.client.sharedSavedView(base.generation, id) }
        override suspend fun sharedSavedViewFields(space: String) = io { base.client.sharedSavedViewFields(base.generation, space) }
        override suspend fun sharedSpaces() = io { base.client.sharedSpaces(base.generation) }
        override suspend fun sharedProjects(spaceId: String) = io { base.client.sharedProjects(base.generation, spaceId) }
        override suspend fun archivedSharedProjects(spaceId: String) = io { base.client.archivedSharedProjects(base.generation, spaceId) }
        override suspend fun sharedSpaceUi(spaceId: String) = io { base.client.sharedSpaceUi(base.generation, spaceId) }
        override suspend fun saveSharedSpaceUi(spaceId: String, expandedIds: List<String>) = io { base.client.saveSharedSpaceUi(base.generation, spaceId, expandedIds) }
        override suspend fun sharedInvitations() = io { base.client.sharedInvitations(base.generation) }
        override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = io { base.client.querySharedTasks(base.generation, filter, cursor) }
        override suspend fun sharedTask(projectId: String, taskId: String) = io { base.client.sharedTask(base.generation, projectId, taskId) }
        override suspend fun sharedComments(projectId: String, taskId: String) = io { base.client.sharedComments(base.generation, projectId, taskId) }
        override suspend fun sharedGoogleSettings(projectId: String) = io { base.client.sharedGoogleSettings(base.generation, projectId) }
        override suspend fun readSharedTaskUpdates(projectId: String, taskId: String, commentIds: List<String>) = io { base.client.readSharedTaskUpdates(base.generation, projectId, taskId, commentIds) }
        override suspend fun queuedSharedTasks(projectId: String): List<JSONObject> = emptyList() // Isolated fixture has no task writer/outbox.
        override suspend fun flushSharedOfflineTasks() = 0
        override suspend fun sortedSharedTasks(filter: JSONObject, cursor: String?, sort: String) = io { base.client.querySharedTasks(base.generation, filter, cursor, sort) }
        override suspend fun sharedBulkOptions(kind: String, filter: JSONObject, cursor: String?) = io { base.client.sharedBulkOptions(base.generation, kind, filter, cursor) }
        override suspend fun sharedSavedViewDraft() = io { service().load() }
        override suspend fun saveSharedSavedViewDraft(stamp: String?, edit: JSONObject) = io { service().save(stamp, edit) }
        override suspend fun prepareSharedSavedViewDraft(stamp: String) = io { service().prepare(stamp) }
        override suspend fun sendSharedSavedViewDraft(stamp: String) = io { service().send(stamp) }
        override suspend fun rebaseSharedSavedViewDraft(stamp: String) = io { service().rebase(stamp) }
        override suspend fun removeSharedSavedViewDraft(stamp: String) = io { service().remove(stamp) }
    }
    override fun close() { try { storage.clear() } finally { base.close() } }
}
