package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.json.JSONArray

internal interface SharedAutomationEditorAccess {
    fun check()
    fun project(project: String): JSONObject
    fun labels(project: String): JSONArray
    fun template(space: String, template: String, language: String): JSONObject
    fun rule(project: String, rule: String): JSONObject
    fun hasTaskQueue(): Boolean
    fun send(project: String, rule: String?, payload: JSONObject): JSONObject
    fun preview(project: String, definition: JSONObject, owner: String, task: String?): JSONObject
}

/** Independent editor purpose: existing automation-management commands never contain or acquire form data. */
internal class SharedAutomationEditorService(private val journal: PlanningJournal, private val account: String,
    private val access: SharedAutomationEditorAccess) {
    private fun <T> checked(action: () -> T): T { access.check(); return action().also { access.check() } }
    fun load(project: String): JSONObject? = checked { journal.load(account, SharedAutomationProtocol.id(project)) }
    fun save(project: String, stamp: String?, edit: JSONObject) = checked {
        require(SharedAutomationEditorProtocol.edit(edit).getString("projectId") == project) { "AUTOMATION_SCOPE_CHANGED" }
        journal.save(account, project, stamp, edit)
    }
    fun remove(project: String, stamp: String) = checked { journal.remove(account, SharedAutomationProtocol.id(project), stamp) }
    fun copies(project: String) = checked { journal.copies(account, SharedAutomationProtocol.id(project)) }
    fun saveCopy(project: String, id: String, stamp: String?, edit: JSONObject) = checked {
        require(SharedAutomationEditorProtocol.edit(edit).getString("projectId") == project) { "AUTOMATION_SCOPE_CHANGED" }
        journal.saveCopy(account, project, id, stamp, edit)
    }
    fun useCopy(project: String, id: String, copyStamp: String, stamp: String?) = checked { journal.useCopy(account, project, id, copyStamp, stamp) }
    fun removeCopy(project: String, id: String, stamp: String) = checked { journal.removeCopy(account, project, id, stamp) }
    private fun current(project: String, stamp: String) = requireNotNull(load(project)).also {
        require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
    }
    private fun fresh(project: String, edit: JSONObject): JSONObject {
        val data = checked { access.project(project) }.let(SharedAutomationEditorProtocol::copy).put("actorId", account)
        data.put("labels", checked { access.labels(project) })
        val sources = JSONArray()
        SharedAutomationEditorProtocol.rows(edit.getJSONObject("definition").getJSONArray("actions"))
            .filter { it.opt("type") == "createTemplate" && it.optString("templateId").isNotEmpty() }
            .distinctBy { it.getString("templateId") }.forEach { action ->
                sources.put(checked { access.template(edit.getString("spaceId"), action.getString("templateId"), action.getJSONObject("options").optString("language", "ru")) })
            }
        data.put("templates", sources)
        if (!edit.isNull("ruleId")) data.put("rule", checked { access.rule(project, edit.getString("ruleId")) })
        return data
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        require(!checked { access.hasTaskQueue() }) { "AUTOMATION_LOCAL_QUEUE" }
        val data = fresh(project, record.getJSONObject("edit"))
        return checked { journal.prepare(account, project, stamp, data, access.hasTaskQueue()) }
    }
    fun send(project: String, stamp: String): JSONObject {
        val record = current(project, stamp)
        if (record.getString("phase") == "received") return record
        require(record.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        if (record.getInt("attempts") == 0) {
            val edit = record.getJSONObject("edit")
            SharedAutomationEditorProtocol.verify(edit, fresh(project, edit), project, checked { access.hasTaskQueue() })
        }
        // BeginAttempt persists the frozen operation/body before every send; a replay never prepares another command.
        val attempted = checked { journal.beginAttempt(account, project, stamp) }
        try {
            val command = JSONObject(attempted.getString("command")); val body = command.getJSONObject("body")
            val rule = command.optString("sprintId").takeUnless { it == "null" || it.isBlank() }
            val response = checked { access.send(project, rule, body.getJSONObject("payload")) }
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
    /** No journal command, task/job/notification mutation or C1 apply occurs on this route. */
    fun preview(project: String, stamp: String, task: String?): JSONObject {
        val record = current(project, stamp)
        require(record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val edit = record.getJSONObject("edit"); val data = fresh(project, edit); val projectData = data.getJSONObject("project")
        require(projectData.optString("id") == project && projectData.optString("spaceId") == edit.getString("spaceId")) { "AUTOMATION_SCOPE_CHANGED" }
        require(projectData.getJSONObject("permissions").optBoolean("editTasks")) { "SHARED_PROJECT_FORBIDDEN" }
        require(!checked { access.hasTaskQueue() }) { "AUTOMATION_LOCAL_QUEUE" }
        val definition = SharedAutomationEditorProtocol.definition(edit)
        SharedAutomationEditorProtocol.validateCatalog(edit, data)
        val trigger = definition.getJSONObject("trigger")
        val projectOnly = trigger.getString("type") == "schedule" && trigger.getString("target") == "project"
        if (!projectOnly) require(task != null) { "AUTOMATION_TASK_REQUIRED" }
        task?.let(SharedAutomationProtocol::id)
        val selected = if (projectOnly) null else task
        return SharedAutomationProtocol.preview(checked { access.preview(project, definition, edit.getString("ownerId"), selected) }, edit.getString("ownerId"), selected)
    }
}
