package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal interface SharedBulkAccess {
    fun check()
    fun scope(selection: JSONObject): JSONObject
    fun preview(body: JSONObject): JSONObject
    fun hasTaskQueue(): Boolean
}

/** The frozen preview is durable before HTTPS. A replay never substitutes current task revisions. */
internal class SharedBulkDraftService(private val journal: PlanningJournal, private val account: String, private val access: SharedBulkAccess, private val inputJournal: PlanningJournal? = null) {
    private fun <T> checked(block: () -> T): T { access.check(); return block().also { access.check() } }
    fun load(project: String): JSONObject? = checked { journal.load(account, SharedBulkProtocol.id(project)) }
    fun save(project: String, stamp: String?, edit: JSONObject): JSONObject = checked {
        require(SharedBulkProtocol.context(SharedBulkProtocol.edit(edit)) == project) { "BULK_SCOPE_CHANGED" }
        journal.save(account, project, stamp, edit)
    }
    fun loadInput(project: String): JSONObject? = checked { requireNotNull(inputJournal).load(account, SharedBulkProtocol.id(project)) }
    fun saveInput(project: String, stamp: String?, input: JSONObject): JSONObject = checked {
        require(SharedBulkInputContract.validateEdit(input).getString("context") == project) { "BULK_SCOPE_CHANGED" }
        requireNotNull(inputJournal).save(account, project, stamp, input)
    }
    fun removeInput(project: String, stamp: String) = checked { requireNotNull(inputJournal).remove(account, SharedBulkProtocol.id(project), stamp) }
    fun remove(project: String, stamp: String) = checked { journal.remove(account, SharedBulkProtocol.id(project), stamp) }
    private fun current(project: String, stamp: String) = requireNotNull(load(project)).also {
        require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        require(!checked { access.hasTaskQueue() }) { "BULK_LOCAL_QUEUE" }
        val fresh = checked { access.scope(record.getJSONObject("edit").getJSONObject("selection")) }
        return checked { journal.prepare(account, project, stamp, fresh, access.hasTaskQueue()) }
    }
    fun send(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        // A replay only recovers a server preview; it cannot mutate tasks or be blocked by a newer local queue.
        if (record.getInt("attempts") == 0) require(!checked { access.hasTaskQueue() }) { "BULK_LOCAL_QUEUE" }
        val attempted = checked { journal.beginAttempt(account, project, stamp) }
        try {
            val body = JSONObject(attempted.getString("command")).getJSONObject("body")
            val report = checked { SharedBulkProtocol.report(access.preview(body)) }
            return checked { journal.succeeded(account, project, attempted.getString("stamp"), report) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) {
                is AuthApiError -> failure.code
                is CustomFieldFailure -> failure.code
                is AuthFailure -> sharedFailureCode(failure)
                else -> failure.message?.takeIf { SharedBulkProtocol.errorCode(it) || it in setOf("BULK_PROTOCOL", "BULK_RECEIPT_INVALID", "PLANNING_DRAFT_STORAGE") } ?: "PROTOCOL"
            }
            journal.failed(account, project, attempted.getString("stamp"), code)
            throw failure
        }
    }
}
