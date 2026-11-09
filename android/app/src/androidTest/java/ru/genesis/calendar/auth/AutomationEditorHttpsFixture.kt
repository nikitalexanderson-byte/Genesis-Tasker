package ru.genesis.calendar.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** The C2 writer uses the same isolated TLS/PHP/Keystore boundary as C1, with its own purpose. */
internal class AutomationEditorHttpsFixture : AutoCloseable {
    val base = TemplateHttpsFixture()
    val actor get() = base.actor
    val project get() = base.project
    val space get() = base.space
    var loseReply = false; var forbidden = false; var writable = true
    var emptyTemplateCatalog = false
    var editorSends = 0; var templateSends = 0; var previews = 0
    var managementSends = 0; var loseManagementReply = false
    val sent = mutableListOf<String>()
    private var opened = false
    private val journal by lazy { PlanningJournal(PlanningDraftStore(base.app, "automation-editor"), contract = SharedAutomationEditorJournalContract) }
    private val managementJournal by lazy { PlanningJournal(PlanningDraftStore(base.app, "automations"), contract = SharedAutomationJournalContract) }
    fun open() { base.open(); opened = true }
    fun labels(): JSONArray {
        val rows = JSONArray(); var cursor: String? = null
        repeat(100) {
            val page = base.client.sharedBulkOptions(base.generation, "labels", JSONObject().put("projectIds", JSONArray().put(project)), cursor)
            val options = page.getJSONArray("options"); for (index in 0 until options.length()) rows.put(options.getJSONObject(index))
            if (!page.getBoolean("hasMore")) return rows
            val after = page.getString("nextCursor"); check(after != cursor); cursor = after
        }
        error("AUTOMATION_SIZE_LIMIT")
    }
    fun snapshot(): JSONObject {
        if (forbidden) throw AuthApiError("SHARED_PROJECT_FORBIDDEN")
        return base.client.sharedProject(base.generation, project).apply { if (!writable) getJSONObject("project").getJSONObject("permissions").put("editTasks", false) }
    }
    fun service() = SharedAutomationEditorService(journal, actor, object : SharedAutomationEditorAccess {
        override fun check() { check(base.client.currentGeneration() == base.generation) }
        override fun project(project: String) = snapshot()
        override fun labels(project: String) = this@AutomationEditorHttpsFixture.labels()
        override fun template(space: String, template: String, language: String) = base.source(template, language)
        override fun rule(project: String, rule: String) = base.client.sharedAutomation(base.generation, project, rule).getJSONObject("rule")
        override fun hasTaskQueue() = false
        override fun send(project: String, rule: String?, payload: JSONObject): JSONObject {
            if (forbidden || !writable) throw AuthApiError("SHARED_PROJECT_FORBIDDEN")
            editorSends++; sent += payload.toString()
            val response = base.client.saveSharedAutomation(base.generation, project, rule, payload)
            if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            return response
        }
        override fun preview(project: String, definition: JSONObject, owner: String, task: String?): JSONObject {
            previews++; return base.client.previewSharedAutomation(base.generation, project, definition, owner, task)
        }
    })
    fun management() = SharedAutomationDraftService(managementJournal, actor, object : SharedAutomationAccess {
        override fun check() { check(base.client.currentGeneration() == base.generation) }
        override fun rule(project: String, rule: String) = base.client.sharedAutomation(base.generation, project, rule)
        override fun send(project: String, rule: String, run: String?, body: JSONObject): JSONObject {
            managementSends++
            val response = base.client.sharedAutomationCommand(base.generation, project, rule, run, body)
            if (loseManagementReply) { loseManagementReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            return response
        }
    })
    val gateway = object : SharedWorkspaceGateway by base.gateway {
        private suspend fun <T> io(block: () -> T): T = withContext(Dispatchers.IO) { block() }
        override suspend fun sharedProject(projectId: String) = io { snapshot() }
        override suspend fun sharedAutomation(projectId: String, ruleId: String) = io { base.client.sharedAutomation(base.generation, projectId, ruleId) }
        override suspend fun sharedAutomations(projectId: String, deleted: Boolean, cursor: String?) = io { base.client.sharedAutomations(base.generation, projectId, deleted, cursor) }
        override suspend fun sharedAutomationRuns(projectId: String, ruleId: String, cursor: String?) = io { base.client.sharedAutomationRuns(base.generation, projectId, ruleId, cursor) }
        override suspend fun sharedAutomationTemplate(templateId: String, language: String) = io { base.client.sharedAutomationTemplate(base.generation, templateId, language) }
        override suspend fun sharedAutomationDraft(projectId: String) = io { management().load(projectId) }
        override suspend fun saveSharedAutomationDraft(projectId: String, stamp: String?, edit: JSONObject) = io { management().save(projectId, stamp, edit) }
        override suspend fun prepareSharedAutomationDraft(projectId: String, stamp: String) = io { management().prepare(projectId, stamp) }
        override suspend fun sendSharedAutomationDraft(projectId: String, stamp: String) = io { management().send(projectId, stamp) }
        override suspend fun removeSharedAutomationDraft(projectId: String, stamp: String) = io { management().remove(projectId, stamp) }
        override suspend fun sharedTemplates(space: String, language: String, deleted: Boolean, cursor: String?) = io {
            base.client.sharedTemplates(base.generation, space, language, deleted, cursor).apply {
                // The real empty workspace still has built-in templates. Inject the valid empty-read state explicitly.
                if (emptyTemplateCatalog) put("templates", org.json.JSONArray()).put("systemTemplates", org.json.JSONArray()).put("hasMore", false).put("nextCursor", JSONObject.NULL)
            }
        }
        override suspend fun sharedBulkOptions(kind: String, filter: JSONObject, cursor: String?) = io { base.client.sharedBulkOptions(base.generation, kind, filter, cursor) }
        override suspend fun querySharedTasks(filter: JSONObject, cursor: String?) = io { base.client.querySharedTasks(base.generation, filter, cursor) }
        override suspend fun sharedAutomationEditor(project: String) = io { service().load(project) }
        override suspend fun saveSharedAutomationEditor(project: String, stamp: String?, edit: JSONObject) = io { service().save(project, stamp, edit) }
        override suspend fun prepareSharedAutomationEditor(project: String, stamp: String) = io { service().prepare(project, stamp) }
        override suspend fun sendSharedAutomationEditor(project: String, stamp: String) = io { service().send(project, stamp) }
        override suspend fun previewSharedAutomationEditor(project: String, stamp: String, task: String?) = io { service().preview(project, stamp, task) }
        override suspend fun removeSharedAutomationEditor(project: String, stamp: String) = io { service().remove(project, stamp) }
        override suspend fun sharedAutomationEditorCopies(project: String) = io { service().copies(project) }
        override suspend fun saveSharedAutomationEditorCopy(project: String, id: String, stamp: String?, edit: JSONObject) = io { service().saveCopy(project, id, stamp, edit) }
        override suspend fun useSharedAutomationEditorCopy(project: String, id: String, copyStamp: String, stamp: String?) = io { service().useCopy(project, id, copyStamp, stamp) }
        override suspend fun removeSharedAutomationEditorCopy(project: String, id: String, stamp: String) = io { service().removeCopy(project, id, stamp) }
        override suspend fun sendSharedTemplateDraft(project: String, stamp: String): JSONObject { templateSends++; error("C2_MUST_NOT_APPLY_TEMPLATE") }
    }
    override fun close() {
        if (!opened) { base.close(); return }
        try {
            service().load(project)?.takeIf { it.getString("phase") in setOf("editing", "received", "rejected") || it.getInt("attempts") == 0 }?.let { service().remove(project, it.getString("stamp")) }
            management().load(project)?.takeIf { it.getString("phase") in setOf("editing", "received", "rejected") || it.getInt("attempts") == 0 }?.let { management().remove(project, it.getString("stamp")) }
        } finally { base.close() }
    }
}
