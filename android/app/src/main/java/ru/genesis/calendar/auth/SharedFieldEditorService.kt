package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal interface SharedFieldEditorAccess {
    fun check()
    fun context(space: String, project: String): JSONObject
    fun fields(space: String, project: String): JSONObject
    fun preview(space: String, project: String, request: JSONObject): JSONObject
    fun hasTaskQueue(): Boolean
    fun send(space: String, payload: JSONObject): JSONObject
}

/** A fresh space role guards reads/reviews/writes; an uncertain PUT retains its exact persisted payload. */
internal class SharedFieldEditorService(private val journal: PlanningJournal, private val account: String, private val access: SharedFieldEditorAccess) {
    private fun <T> checked(work: () -> T): T { access.check(); return work().also { access.check() } }
    private fun context(project: String, edit: JSONObject): JSONObject = checked {
        access.context(edit.getString("spaceId"), project).also { CustomFieldEditorProtocol.authorize(edit.getString("spaceId"), project, it) }
    }
    private fun scoped(project: String, edit: JSONObject): JSONObject = CustomFieldEditorProtocol.edit(edit).also {
        require(it.getString("projectId") == project) { "CUSTOM_FIELD_SCOPE_CHANGED" }
    }
    fun load(project: String): JSONObject? = checked {
        journal.load(account, CustomFieldProtocol.id(project))?.also { context(project, it.getJSONObject("edit")) }
    }
    fun save(project: String, stamp: String?, edit: JSONObject) = checked {
        // Own input remains durable when connectivity disappears. Reading it back requires a fresh role.
        journal.save(account, project, stamp, scoped(project, edit))
    }
    fun remove(project: String, stamp: String) = checked { journal.remove(account, CustomFieldProtocol.id(project), stamp) }
    fun copies(project: String): List<JSONObject> = checked {
        journal.copies(account, CustomFieldProtocol.id(project)).also { rows -> rows.forEach { context(project, scoped(project, it.getJSONObject("edit"))) } }
    }
    fun saveCopy(project: String, id: String, stamp: String?, edit: JSONObject) = checked {
        journal.saveCopy(account, project, id, stamp, scoped(project, edit))
    }
    fun useCopy(project: String, id: String, copyStamp: String, stamp: String?) = checked {
        val selected = journal.copies(account, CustomFieldProtocol.id(project)).find { it.getString("id") == id && it.getString("stamp") == copyStamp }
        requireNotNull(selected) { "PLANNING_DRAFT_CHANGED" }; context(project, scoped(project, selected.getJSONObject("edit")))
        journal.useCopy(account, project, id, copyStamp, stamp)
    }
    fun removeCopy(project: String, id: String, stamp: String) = checked { journal.removeCopy(account, CustomFieldProtocol.id(project), id, stamp) }
    private fun current(project: String, stamp: String): JSONObject = checked {
        requireNotNull(journal.load(account, CustomFieldProtocol.id(project))).also { require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" } }
    }
    private fun fresh(project: String, edit: JSONObject): JSONObject {
        val data = context(project, edit)
        require(!checked { access.hasTaskQueue() }) { "CUSTOM_FIELD_LOCAL_QUEUE" }
        return data.put("preview", checked { access.preview(edit.getString("spaceId"), project, CustomFieldEditorProtocol.request(edit)) })
    }
    fun preview(project: String, stamp: String): JSONObject {
        val record = current(project, stamp); require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val edit = record.getJSONObject("edit"); val data = fresh(project, edit)
        return checked { journal.save(account, project, stamp, CustomFieldEditorProtocol.reviewed(edit, data.getJSONObject("preview"))) }
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val record = current(project, stamp); require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val data = fresh(project, record.getJSONObject("edit"))
        return checked { journal.prepare(account, project, stamp, data, access.hasTaskQueue()) }
    }
    fun rebase(project: String, stamp: String): JSONObject {
        val record = current(project, stamp); val edit = record.getJSONObject("edit"); val data = context(project, edit)
        data.put("fields", checked { access.fields(edit.getString("spaceId"), project) }.getJSONArray("fields"))
        return checked { journal.rebase(account, project, stamp, data) }
    }
    fun send(project: String, stamp: String): JSONObject {
        val record = current(project, stamp); val edit = record.getJSONObject("edit")
        context(project, edit)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        if (record.getInt("attempts") == 0)
            CustomFieldEditorProtocol.verify(edit, fresh(project, edit), project, checked { access.hasTaskQueue() })
        // Every attempted replay skips preview/revision replacement: the server rechecks ACL before receipt lookup.
        val attempted = checked { journal.beginAttempt(account, project, stamp) }
        try {
            val command = JSONObject(attempted.getString("command")); val body = command.getJSONObject("body")
            val response = checked { access.send(body.getString("spaceId"), body.getJSONObject("payload")) }
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
