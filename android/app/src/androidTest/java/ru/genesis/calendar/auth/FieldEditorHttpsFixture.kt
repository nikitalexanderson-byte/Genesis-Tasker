package ru.genesis.calendar.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject

/** Real native PUT, preview and Android Keystore storage against the isolated PHP fixture. */
internal class FieldEditorHttpsFixture : AutoCloseable {
    val base = TemplateHttpsFixture()
    val actor get() = base.actor; val space get() = base.space; val project get() = base.project
    var loseReply = false; var forbidden = false; var previewDelay = 0L
    val bodies = mutableListOf<String>()
    private val journal by lazy { PlanningJournal(PlanningDraftStore(base.app, "field-editor"), contract = CustomFieldEditorJournalContract) }
    private var opened = false
    fun open() { base.open(); opened = true }
    fun snapshot(): JSONObject {
        if (forbidden) throw AuthApiError("SHARED_SPACE_FORBIDDEN")
        return base.client.sharedProject(base.generation, project)
    }
    fun service() = SharedFieldEditorService(journal, actor, object : SharedFieldEditorAccess {
        override fun check() { check(base.client.currentGeneration() == base.generation) }
        override fun context(space: String, project: String): JSONObject {
            if (forbidden) throw AuthApiError("SHARED_SPACE_FORBIDDEN")
            return base.client.sharedFieldEditorContext(base.generation, space, project)
        }
        override fun fields(space: String, project: String) = base.client.sharedFieldDefinitions(base.generation, space, project, true)
        override fun preview(space: String, project: String, request: JSONObject): JSONObject {
            if (previewDelay > 0) Thread.sleep(previewDelay)
            return base.client.previewSharedFieldDefinition(base.generation, space, project, request)
        }
        override fun hasTaskQueue() = false
        override fun send(space: String, payload: JSONObject): JSONObject {
            bodies += payload.toString()
            val response = base.client.saveSharedFieldDefinition(base.generation, space, payload)
            if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            return response
        }
    })
    val gateway = object : SharedWorkspaceGateway by base.gateway {
        private suspend fun <T> io(work: () -> T) = withContext(Dispatchers.IO) { work() }
        override suspend fun sharedProject(projectId: String) = io { snapshot() }
        override suspend fun sharedFieldDefinitions(space: String, project: String, archived: Boolean) = io { base.client.sharedFieldDefinitions(base.generation, space, project, archived) }
        override suspend fun sharedFieldHistory(space: String, id: String) = io { base.client.sharedFieldHistory(base.generation, space, id) }
        override suspend fun sharedFieldEditor(project: String) = io { service().load(project) }
        override suspend fun saveSharedFieldEditor(project: String, stamp: String?, edit: JSONObject) = io { service().save(project, stamp, edit) }
        override suspend fun previewSharedFieldEditor(project: String, stamp: String) = io { service().preview(project, stamp) }
        override suspend fun prepareSharedFieldEditor(project: String, stamp: String) = io { service().prepare(project, stamp) }
        override suspend fun sendSharedFieldEditor(project: String, stamp: String) = io { service().send(project, stamp) }
        override suspend fun rebaseSharedFieldEditor(project: String, stamp: String) = io { service().rebase(project, stamp) }
        override suspend fun removeSharedFieldEditor(project: String, stamp: String) = io { service().remove(project, stamp) }
        override suspend fun sharedFieldEditorCopies(project: String) = io { service().copies(project) }
        override suspend fun saveSharedFieldEditorCopy(project: String, id: String, stamp: String?, edit: JSONObject) = io { service().saveCopy(project, id, stamp, edit) }
        override suspend fun useSharedFieldEditorCopy(project: String, id: String, copyStamp: String, stamp: String?) = io { service().useCopy(project, id, copyStamp, stamp) }
        override suspend fun removeSharedFieldEditorCopy(project: String, id: String, stamp: String) = io { service().removeCopy(project, id, stamp) }
    }
    override fun close() {
        if (!opened) { base.close(); return }
        try {
            forbidden = false
            journal.load(actor, project)?.takeIf { it.getString("phase") in setOf("editing", "rejected", "received") || it.getInt("attempts") == 0 }
                ?.let { journal.remove(actor, project, it.getString("stamp")) }
        } finally { base.close() }
    }
}
