package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject

internal interface SharedTemplateAccess {
    fun check()
    fun project(id: String): JSONObject
    fun source(space: String, id: String, language: String, deleted: Boolean): JSONObject
    fun preview(id: String, request: JSONObject): JSONObject
    fun hasTaskQueue(): Boolean
    fun send(command: JSONObject): JSONObject
}

/** One encrypted CAS command per open project. An uncertain save/apply can only replay its exact wire body. */
internal class SharedTemplateDraftService(private val journal: PlanningJournal, private val account: String, private val access: SharedTemplateAccess) {
    private fun <T> checked(block: () -> T): T { access.check(); return block().also { access.check() } }
    fun load(project: String): JSONObject? = checked { journal.load(account, SharedTemplateProtocol.id(project)) }
    fun save(project: String, stamp: String?, edit: JSONObject): JSONObject = checked {
        require(SharedTemplateProtocol.edit(edit).getString("projectId") == project) { "TEMPLATE_SCOPE_CHANGED" }
        journal.save(account, project, stamp, edit)
    }
    fun remove(project: String, stamp: String) = checked { journal.remove(account, SharedTemplateProtocol.id(project), stamp) }
    fun copies(project: String) = checked { journal.copies(account, SharedTemplateProtocol.id(project)) }
    fun saveCopy(project: String, id: String, stamp: String?, edit: JSONObject): JSONObject = checked {
        require(SharedTemplateProtocol.edit(edit).getString("projectId") == project) { "TEMPLATE_SCOPE_CHANGED" }
        journal.saveCopy(account, project, id, stamp, edit)
    }
    fun useCopy(project: String, id: String, copyStamp: String, stamp: String?) = checked { journal.useCopy(account, SharedTemplateProtocol.id(project), id, copyStamp, stamp) }
    fun removeCopy(project: String, id: String, stamp: String) = checked { journal.removeCopy(account, SharedTemplateProtocol.id(project), id, stamp) }
    private fun current(project: String, stamp: String) = requireNotNull(load(project)).also { require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" } }

    private fun fresh(project: String, edit: JSONObject): JSONObject {
        val result = JSONObject().put("project", checked { access.project(project) })
        val request = edit.getJSONObject("request")
        if (edit.getString("kind") == "template-save") {
            val library = request.getString("projectId")
            result.put("library", if (library == project) result.getJSONObject("project") else checked { access.project(library) })
            if (!edit.isNull("templateId")) result.put("source", checked { access.source(edit.getString("spaceId"), edit.getString("templateId"), "ru", true) })
        } else result.put("preview", checked { access.preview(edit.getString("templateId"), request) })
        return result
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        require(!checked { access.hasTaskQueue() }) { "TEMPLATE_LOCAL_QUEUE" }
        val data = fresh(project, record.getJSONObject("edit"))
        return checked { journal.prepare(account, project, stamp, data, access.hasTaskQueue()) }
    }
    fun send(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        val edit = record.getJSONObject("edit")
        if (record.getInt("attempts") == 0) {
            require(!checked { access.hasTaskQueue() }) { "TEMPLATE_LOCAL_QUEUE" }
            SharedTemplateProtocol.verify(edit, fresh(project, edit), project, checked { access.hasTaskQueue() })
        }
        // No new preview, revision or ID replaces an attempted command. The server checks current ACL on receipt replay.
        val attempted = checked { journal.beginAttempt(account, project, stamp) }
        try {
            val response = checked { access.send(JSONObject(attempted.getString("command"))) }
            return checked { journal.succeeded(account, project, attempted.getString("stamp"), response) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) {
                is AuthApiError -> failure.code
                is WorkflowFailure -> failure.code
                is CustomFieldFailure -> failure.code
                is AuthFailure -> sharedFailureCode(failure)
                else -> failure.message?.takeIf { it in SharedTemplateProtocol.errors || it in setOf("TEMPLATE_RECEIPT_INVALID", "PLANNING_DRAFT_STORAGE") } ?: "PROTOCOL"
            }
            journal.failed(account, project, attempted.getString("stamp"), code)
            throw failure
        }
    }
}
