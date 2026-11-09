package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal interface SharedAutomationAccess {
    fun check()
    fun rule(project: String, rule: String): JSONObject
    fun send(project: String, rule: String, run: String?, body: JSONObject): JSONObject
}

/** Exact operationId/body is durable before the request; only a verified minimal receipt is retained. */
internal class SharedAutomationDraftService(private val journal: PlanningJournal, private val account: String, private val access: SharedAutomationAccess) {
    private fun <T> checked(work: () -> T): T { access.check(); return work().also { access.check() } }
    fun load(project: String): JSONObject? = checked { journal.load(account, SharedAutomationProtocol.id(project)) }
    fun save(project: String, stamp: String?, edit: JSONObject): JSONObject = checked {
        require(SharedAutomationProtocol.edit(edit).getString("projectId") == project) { "AUTOMATION_SCOPE_CHANGED" }
        journal.save(account, project, stamp, edit)
    }
    fun remove(project: String, stamp: String) = checked { journal.remove(account, SharedAutomationProtocol.id(project), stamp) }
    private fun current(project: String, stamp: String) = requireNotNull(load(project)).also {
        require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val fresh = checked { access.rule(project, record.getJSONObject("edit").getString("ruleId")) }
        return checked { journal.prepare(account, project, stamp, fresh, false) }
    }
    fun send(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        val attempted = checked { journal.beginAttempt(account, project, stamp) }
        try {
            val command = JSONObject(attempted.getString("command")); val body = command.getJSONObject("body")
            val response = checked { access.send(project, command.getString("sprintId"), body.optString("runId").takeIf(String::isNotEmpty), body.getJSONObject("payload")) }
            return checked { journal.succeeded(account, project, attempted.getString("stamp"), response) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) {
                is AuthApiError -> failure.code
                is CustomFieldFailure -> failure.code
                is WorkflowFailure -> failure.code
                is AuthFailure -> sharedFailureCode(failure)
                else -> failure.message?.takeIf { Regex("[A-Z][A-Z0-9_]{0,99}").matches(it) } ?: "PROTOCOL"
            }
            journal.failed(account, project, attempted.getString("stamp"), code)
            throw failure
        }
    }
}
