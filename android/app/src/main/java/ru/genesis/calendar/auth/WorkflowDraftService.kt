package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal interface WorkflowDraftAccess {
    fun check()
    fun workflow(project: String): JSONObject
    fun hasTaskQueue(project: String): Boolean
    fun send(project: String, body: JSONObject): JSONObject
}

/** Commands are prepared against fresh ACL/catalogs. Replays keep the original serialized body. */
internal class WorkflowDraftService(private val journal: PlanningJournal, private val account: String, private val access: WorkflowDraftAccess) {
    private fun <T> checked(action: () -> T): T { access.check(); return action().also { access.check() } }
    fun load(project: String) = checked { journal.load(account, project) }
    fun copies(project: String) = checked { journal.copies(account, project) }
    fun save(project: String, stamp: String?, edit: JSONObject) = checked { journal.save(account, project, stamp, edit) }
    fun remove(project: String, stamp: String) = checked { journal.remove(account, project, stamp) }
    fun saveCopy(project: String, id: String, stamp: String?, edit: JSONObject) = checked { journal.saveCopy(account, project, id, stamp, edit) }
    fun useCopy(project: String, id: String, copyStamp: String, stamp: String?) = checked { journal.useCopy(account, project, id, copyStamp, stamp) }
    fun removeCopy(project: String, id: String, stamp: String) = checked { journal.removeCopy(account, project, id, stamp) }
    private fun current(project: String, stamp: String): JSONObject = requireNotNull(load(project)).also {
        require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
    }
    private fun fresh(project: String): JSONObject = checked { WorkflowLifecycle.snapshot(project, access.workflow(project)) }.also {
        WorkflowLifecycle.requirePermission(it, project)
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val data = fresh(project); val queued = checked { access.hasTaskQueue(project) }
        return checked { journal.prepare(account, project, stamp, data, queued) }
    }
    fun rebase(project: String, stamp: String): JSONObject {
        current(project, stamp)
        val data = fresh(project)
        return checked { JSONObject().put("record", journal.rebase(account, project, stamp, data)).put("workflow", data) }
    }
    fun send(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        fresh(project) // Current manage permission is required even to retrieve an earlier receipt.
        require(!checked { access.hasTaskQueue(project) }) { "WORKFLOW_LOCAL_QUEUE" }
        val attempted = checked { journal.beginAttempt(account, project, stamp) }
        val body = JSONObject(attempted.getString("command")).getJSONObject("body")
        try {
            val response = checked { access.send(project, body) }
            return checked { journal.succeeded(account, project, attempted.getString("stamp"), response) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) {
                is AuthApiError -> failure.code
                is AuthFailure -> sharedFailureCode(failure)
                else -> if (failure.message == "PLANNING_DRAFT_STORAGE") "PLANNING_DRAFT_STORAGE" else "PROTOCOL"
            }
            journal.failed(account, project, attempted.getString("stamp"), code)
            throw failure
        }
    }
}
