package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject

/** Blocking adapter; production invokes it on Dispatchers.IO with a captured account generation. */
internal interface PlanningDraftAccess {
    fun check()
    fun planning(projectId: String): JSONObject
    fun tasks(filter: JSONObject, cursor: String?): JSONObject
    fun hasTaskQueue(projectId: String): Boolean
    fun send(projectId: String, command: JSONObject): JSONObject
}

internal class PlanningDraftService(private val journal: PlanningJournal, private val account: String,
    private val access: PlanningDraftAccess) {
    fun load(project: String): JSONObject? { access.check(); return journal.load(account, project).also { access.check() } }
    fun save(project: String, stamp: String?, edit: JSONObject): JSONObject {
        access.check(); return journal.save(account, project, stamp, edit).also { access.check() }
    }
    fun remove(project: String, stamp: String) { access.check(); journal.remove(account, project, stamp); access.check() }
    fun copies(project: String): List<JSONObject> { access.check(); return journal.copies(account, project).also { access.check() } }
    fun saveCopy(project: String, id: String, stamp: String?, edit: JSONObject): JSONObject {
        access.check(); return journal.saveCopy(account, project, id, stamp, edit).also { access.check() }
    }
    fun useCopy(project: String, id: String, copyStamp: String, stamp: String?): JSONObject {
        access.check(); return journal.useCopy(account, project, id, copyStamp, stamp).also { access.check() }
    }
    fun removeCopy(project: String, id: String, stamp: String) { access.check(); journal.removeCopy(account, project, id, stamp); access.check() }
    private fun current(project: String, stamp: String): JSONObject = requireNotNull(load(project)).also {
        require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
    }
    private fun fresh(project: String): JSONObject {
        access.check(); val data = access.planning(project); access.check()
        require(!data.optBoolean("offlineCache")) { "PLANNING_PERMISSION_CHANGED" }
        return data
    }
    private fun remaining(project: String, sprintId: String): List<JSONObject> {
        val filter = JSONObject().put("projectIds", JSONArray().put(project)).put("sprintId", sprintId).put("completion", "open")
        val result = mutableListOf<JSONObject>(); val cursors = mutableSetOf<String>()
        var cursor: String? = null; var version: String? = null; var total: Int? = null
        do {
            access.check(); val page = access.tasks(filter, cursor); access.check()
            require(!page.optBoolean("offlineCache") && page.getInt("total") in 0..PlanningLifecycle.MAX_TASKS) { "PLANNING_CONFLICT" }
            val nextVersion = page.getString("queryVersion")
            require(nextVersion.isNotBlank() && (version == null || version == nextVersion) && (total == null || total == page.getInt("total"))) { "PLANNING_CONFLICT" }
            version = nextVersion; total = page.getInt("total")
            val rows = PlanningLifecycle.rows(page.getJSONArray("tasks"))
            require(rows.size <= 100 && rows.all { it.getString("projectId") == project && it.getString("sprintId") == sprintId && !it.optBoolean("offlineCache") }) { "PLANNING_CONFLICT" }
            rows.forEach { PlanningLifecycle.referenceForTask(it, project) }
            result.addAll(rows)
            require(result.size <= total) { "PLANNING_CONFLICT" }
            cursor = page.optString("nextCursor").takeUnless { it.isBlank() || it == "null" }
            if (cursor != null) require(rows.isNotEmpty() && cursors.add(cursor) && cursors.size <= PlanningLifecycle.MAX_TASKS) { "PLANNING_CONFLICT" }
        } while (cursor != null)
        require(result.size == total && result.map { it.getString("id") }.toSet().size == total) { "PLANNING_CONFLICT" }
        return result
    }
    private fun remainingFor(project: String, edit: JSONObject): List<JSONObject>? =
        if (edit.getString("kind") == "transition" && edit.getString("action") == "complete") remaining(project, edit.getString("sprintId")) else null
    private fun checkedRead(project: String, edit: JSONObject): Pair<JSONObject, List<JSONObject>?> {
        val before = fresh(project); PlanningLifecycle.requirePermission(edit, before, project)
        val rows = remainingFor(project, edit)
        val after = if (rows != null) fresh(project) else before
        PlanningLifecycle.requirePermission(edit, after, project)
        require(rows == null || before.getString("fingerprint") == after.getString("fingerprint")) { "PLANNING_CONFLICT" }
        return after to rows
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val (data, rows) = checkedRead(project, record.getJSONObject("edit")); access.check()
        val queued = access.hasTaskQueue(project); access.check()
        return journal.prepare(account, project, stamp, data, queued, rows).also { access.check() }
    }
    fun rebase(project: String, stamp: String): JSONObject {
        val record = current(project, stamp); val (data, rows) = checkedRead(project, record.getJSONObject("edit"))
        access.check()
        val updated = journal.rebase(account, project, stamp, data, rows); access.check()
        return JSONObject().put("record", updated).put("tasks", rows?.let(::JSONArray) ?: JSONObject.NULL).put("planning", data)
    }
    fun completion(project: String, sprintId: String, stamp: String?): JSONObject {
        val old = load(project)
        require(old?.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
        if (old != null) require(old.getString("phase") == "editing" && old.getJSONObject("edit").getString("kind") == "transition" &&
            old.getJSONObject("edit").getString("action") == "complete" && old.getJSONObject("edit").getString("sprintId") == sprintId) { "PLANNING_DRAFT_PENDING" }
        val before = fresh(project)
        val sprint = PlanningLifecycle.rows(before.getJSONArray("sprints")).find { it.getString("id") == sprintId }
        require(sprint != null && sprint.getString("state") == "active") { "SPRINT_STATE_INVALID" }
        val edit = JSONObject().put("kind", "transition").put("action", "complete").put("sprintId", sprintId)
            .put("expectedRevision", sprint!!.getInt("revision")).put("fingerprint", before.getString("fingerprint"))
            .put("tasks", JSONArray()).put("choices", JSONObject())
        PlanningLifecycle.requirePermission(edit, before, project)
        require(before.getJSONObject("config").getBoolean("enabled")) { "PLANNING_DISABLED" }
        val rows = remaining(project, sprintId); val after = fresh(project)
        require(before.getString("fingerprint") == after.getString("fingerprint")) { "PLANNING_CONFLICT" }
        PlanningLifecycle.requirePermission(edit, after, project)
        val source = old?.getJSONObject("edit") ?: edit
        val rebased = PlanningLifecycle.rebase(source, after, project, rows)
        access.check(); val record = journal.save(account, project, stamp, rebased); access.check()
        return JSONObject().put("record", record).put("tasks", JSONArray(rows)).put("planning", after)
    }
    fun send(project: String, stamp: String): JSONObject {
        val old = current(project, stamp)
        if (old.getString("phase") == "received") return old
        require(old.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        // A replay may retrieve a receipt after revisions, enabled state or sprint state changed.
        PlanningLifecycle.requirePermission(old.getJSONObject("edit"), fresh(project), project)
        require(!access.hasTaskQueue(project)) { "PLANNING_LOCAL_QUEUE" }; access.check()
        val attempted = journal.beginAttempt(account, project, stamp); access.check()
        val command = JSONObject(attempted.getString("command"))
        try {
            val response = access.send(project, command); access.check()
            return journal.succeeded(account, project, attempted.getString("stamp"), response).also { access.check() }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) {
                is AuthApiError -> failure.code
                is AuthFailure -> failure.kind.name
                else -> if (failure.message == "PLANNING_DRAFT_STORAGE") "PLANNING_DRAFT_STORAGE" else "PROTOCOL"
            }
            journal.failed(account, project, attempted.getString("stamp"), code)
            throw failure
        }
    }
}
