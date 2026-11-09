package ru.genesis.calendar.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** Uses the same synthetic HTTPS account and Android Keystore as the shipping writer. */
internal class QueryBulkHttpsFixture : AutoCloseable {
    val views = SavedViewHttpsFixture()
    val base get() = views.base
    private val commandStorage by lazy { PlanningDraftStore(base.app, "bulk") }
    private val inputStorage by lazy { PlanningDraftStore(base.app, "bulk-input") }
    var loseReply = false
    var queued = false
    var projectReads = 0
    val sent = mutableListOf<String>()
    lateinit var second: String
    val tasks = mutableListOf<JSONObject>()
    fun open(count: Int = 4) {
        views.open(); commandStorage.clear(); inputStorage.clear()
        second = base.client.createSharedProject(base.generation, base.space, JSONObject().put("title", "Публикации команды").put("layout", "list")).getJSONObject("project").getString("id")
        val statuses = listOf(base.project, second).associateWith { base.client.sharedProject(base.generation, it).getJSONArray("statuses").getJSONObject(0).getString("id") }
        repeat(count) { index -> val project = if (index % 2 == 0) base.project else second
            tasks += base.client.createSharedTask(base.generation, project, JSONObject().put("title", "Согласовать следующий этап • ${index + 1}")
                .put("statusId", statuses.getValue(project)).put("priority", index % 4).put("dueDate", "2026-10-22")).getJSONObject("task")
        }
    }
    fun origin(title: String = "Задачи двух проектов") = JSONObject().put("filter", JSONObject().put("projectIds", JSONArray().put(base.project).put(second)))
        .put("sort", "priority").put("title", title)
    fun calendar() = JSONObject().put("mode", "lunar").put("version", 2).put("timeZone", "Europe/Moscow").put("gregorianYearStart", "march")
    fun service() = SharedBulkDraftService(PlanningJournal(commandStorage, contract = SharedBulkJournalContract), base.actor, object : SharedBulkAccess {
        override fun check() { check(base.client.isCurrent(base.generation)) }
        override fun hasTaskQueue() = queued
        override fun scope(selection: JSONObject): JSONObject {
            val pages = SharedBulkScopePages()
            do { val page = base.client.sharedBulkScope(base.generation, selection, pages.cursor) } while (!pages.add(page))
            return pages.result()
        }
        override fun preview(body: JSONObject): JSONObject {
            sent += body.toString()
            return base.client.sharedBulkPreview(base.generation, body).also { if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) } }
        }
    }, PlanningJournal(inputStorage, contract = SharedBulkInputContract))
    val gateway = object : SharedWorkspaceGateway by views.gateway {
        private suspend fun <T> io(action: () -> T): T = withContext(Dispatchers.IO) { action() }
        override val supportsSharedBulkInput = true
        override fun captureSharedBulkInputWriter() = SharedBulkInputWriter { context, stamp, input -> saveSharedBulkInput(context, stamp, input) }
        override suspend fun sharedProject(projectId: String): JSONObject { projectReads++; return io { base.client.sharedProject(base.generation, projectId) } }
        override suspend fun sharedBulkDraft(projectId: String) = io { service().load(projectId) }
        override suspend fun saveSharedBulkDraft(projectId: String, stamp: String?, edit: JSONObject) = io { service().save(projectId, stamp, edit) }
        override suspend fun prepareSharedBulkDraft(projectId: String, stamp: String) = io { service().prepare(projectId, stamp) }
        override suspend fun sendSharedBulkDraft(projectId: String, stamp: String) = io { service().send(projectId, stamp) }
        override suspend fun removeSharedBulkDraft(projectId: String, stamp: String) = io { service().remove(projectId, stamp) }
        override suspend fun sharedBulkInput(context: String) = io { service().loadInput(context) }
        override suspend fun saveSharedBulkInput(context: String, stamp: String?, input: JSONObject) = io { service().saveInput(context, stamp, input) }
        override suspend fun removeSharedBulkInput(context: String, stamp: String) = io { service().removeInput(context, stamp) }
        override suspend fun sharedBulkScope(selection: JSONObject, cursor: String?) = io { base.client.sharedBulkScope(base.generation, selection, cursor) }
        override suspend fun sharedBulkReport(id: String, after: Long) = io { base.client.sharedBulkReport(base.generation, id, after) }
        override suspend fun sharedBulkHistory(cursor: String?) = io { base.client.sharedBulkHistory(base.generation, cursor) }
        override suspend fun sharedBulkCommand(id: String, command: String, after: Long) = io {
            require(command != "confirm" || !queued) { "BULK_LOCAL_QUEUE" }
            base.client.sharedBulkCommand(base.generation, id, command, after)
        }
    }
    fun finish(id: String): JSONObject {
        var report = base.client.sharedBulkCommand(base.generation, id, "confirm", 0)
        repeat(25) { if (report.getString("state") != "running") return report; report = base.client.sharedBulkCommand(base.generation, id, "advance", 0) }
        error("Synthetic bulk operation did not converge")
    }
    override fun close() { try { commandStorage.clear(); inputStorage.clear() } finally { views.close() } }
}
