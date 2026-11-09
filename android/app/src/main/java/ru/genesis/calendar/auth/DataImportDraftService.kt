package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import java.io.InputStream
import java.util.UUID

internal interface DataImportAccess {
    fun check()
    fun hasTaskQueue(project: String): Boolean
    fun preview(selection: JSONObject, content: String): JSONObject
    fun apply(selection: JSONObject, content: String, operation: String, fingerprint: String): JSONObject
    fun imports(space: String, cursor: String?): JSONObject
    fun undo(import: String): JSONObject
    fun history(project: String, cursor: String?): JSONObject
}

/** No source bytes enter the command journal. Every replay resolves and verifies the same frozen reference. */
internal class DataImportDraftService(private val journal: PlanningJournal, private val undoJournal: DataImportUndoJournal,
    private val sources: DataImportSources, private val account: String, private val space: String, private val access: DataImportAccess) {
    private fun <T> checked(action: () -> T): T { access.check(); return action().also { access.check() } }
    private fun selection(project: String, input: JSONObject): JSONObject = DataImportProtocol.selection(input).also {
        require(it.getString("spaceId") == space && listOf("projectId", "parentProjectId").all { key -> it.isNull(key) || it.getString(key) == project }) { "DATA_DESTINATION_INVALID" }
    }
    private fun edit(project: String, input: JSONObject): JSONObject = DataImportProtocol.edit(input).also { selection(project, it.getJSONObject("selection")) }
    fun load(project: String) = checked { journal.load(account, project)?.also { edit(project, it.getJSONObject("edit")) } }
    fun copies(project: String) = checked { journal.copies(account, project).onEach { edit(project, it.getJSONObject("edit")) } }
    fun save(project: String, stamp: String?, value: JSONObject) = checked { journal.save(account, project, stamp, edit(project, value)) }
    fun saveCopy(project: String, id: String, stamp: String?, value: JSONObject) = checked { journal.saveCopy(account, project, id, stamp, edit(project, value)) }
    fun useCopy(project: String, id: String, copyStamp: String, stamp: String?) = checked {
        val selected = copies(project).first { it.getString("id") == id }; edit(project, selected.getJSONObject("edit"))
        journal.useCopy(account, project, id, copyStamp, stamp)
    }
    private fun prune(project: String) {
        val keep = (listOfNotNull(load(project)?.getJSONObject("edit")) + copies(project).map { it.getJSONObject("edit") })
            .map { it.getJSONObject("source").getString("id") }.toSet()
        checked { sources.prune(account, space, project, keep, access::check) }
    }
    private fun archive(project: String, value: JSONObject) {
        val edit = value.getJSONObject("edit")
        if (copies(project).none { PlanningLifecycle.canonical(it.getJSONObject("edit")) == PlanningLifecycle.canonical(edit) })
            checked { journal.saveCopy(account, project, UUID.randomUUID().toString(), null, edit) }
    }
    fun removeCopy(project: String, id: String, stamp: String) { checked { journal.removeCopy(account, project, id, stamp) }; prune(project) }
    fun remove(project: String, stamp: String) {
        val old = current(project, stamp)
        require(old.getString("phase") in setOf("editing", "rejected", "received") || old.getString("phase") == "pending" && old.getInt("attempts") == 0) { "PLANNING_DRAFT_PENDING" }
        archive(project, old); checked { journal.remove(account, project, stamp) }; prune(project)
    }
    private fun current(project: String, stamp: String): JSONObject = requireNotNull(load(project)).also {
        require(it.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
    }
    private fun content(project: String, edit: JSONObject) = checked { sources.read(account, space, project, edit.getJSONObject("source"), access::check) }
    fun headers(project: String, stamp: String, delimiter: String): List<String> = DataImportCsv.headers(content(project, current(project, stamp).getJSONObject("edit")), delimiter)
    fun choose(project: String, stamp: String?, name: String, open: () -> InputStream, input: JSONObject): JSONObject {
        val record = load(project); require(record?.getString("stamp") == stamp) { "PLANNING_DRAFT_CHANGED" }
        require(record == null || record.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val selected = selection(project, input)
        record?.let { archive(project, it) }
        val reference = checked { sources.store(account, space, project, name, open, access::check) }
        // A failed journal write retains the encrypted blob; it must not invalidate a possibly committed reference.
        return save(project, stamp, JSONObject().put("kind", "data-import").put("source", reference).put("selection", selected).put("review", JSONObject.NULL)).also { prune(project) }
    }
    private fun preview(project: String, edit: JSONObject) = checked { DataImportProtocol.preview(access.preview(edit.getJSONObject("selection"), content(project, edit))) }
    fun inspect(project: String, stamp: String): JSONObject {
        val old = current(project, stamp)
        require(old.getString("phase") in setOf("editing", "rejected") || old.getString("phase") == "pending" && old.getInt("attempts") == 0) { "PLANNING_DRAFT_PENDING" }
        val preview = preview(project, old.getJSONObject("edit"))
        return checked { JSONObject().put("record", journal.rebase(account, project, stamp, preview)).put("preview", preview) }
    }
    fun prepare(project: String, stamp: String): JSONObject {
        val old = current(project, stamp); require(old.getString("phase") == "editing") { "PLANNING_DRAFT_PENDING" }
        val preview = preview(project, old.getJSONObject("edit")); val queued = checked { access.hasTaskQueue(project) }
        return checked { journal.prepare(account, project, stamp, preview, queued) }
    }
    fun send(project: String, stamp: String): JSONObject {
        val old = current(project, stamp); if (old.getString("phase") == "received") return old
        require(old.getString("phase") == "pending") { "PLANNING_DRAFT_PENDING" }
        require(!checked { access.hasTaskQueue(project) }) { "DATA_LOCAL_QUEUE" }
        val body = JSONObject(old.getString("command")).getJSONObject("body")
        val frozen = JSONObject().put("source", body.getJSONObject("source"))
        val content = content(project, frozen)
        val attempted = checked { journal.beginAttempt(account, project, stamp) }
        try {
            val response = checked { access.apply(body.getJSONObject("selection"), content, body.getString("requestId"), body.getJSONObject("review").getString("fingerprint")) }
            return checked { journal.succeeded(account, project, attempted.getString("stamp"), response) }
        } catch (cancelled: CancellationException) { throw cancelled }
        catch (failure: Exception) {
            access.check()
            val code = when (failure) { is AuthApiError -> failure.code; is AuthFailure -> sharedFailureCode(failure); else -> "PROTOCOL" }
            journal.failed(account, project, attempted.getString("stamp"), code); throw failure
        }
    }
    fun pendingUndos() = checked { undoJournal.pending(account, space) }
    fun undoOutcomes() = checked { undoJournal.outcomes(account, space) }
    fun imports(cursor: String?): JSONObject = checked { access.imports(space, cursor) }.let { response ->
        val rows = response.getJSONArray("imports"); require(rows.length() <= 50)
        val next = response.opt("nextCursor").takeUnless { it == JSONObject.NULL }; require(next == null || next is String && PlanningLifecycle.id(next))
        JSONObject().put("imports", JSONArray((0 until rows.length()).map { DataImportProtocol.receipt(rows.getJSONObject(it), space) }))
            .put("nextCursor", next ?: JSONObject.NULL)
    }
    fun undo(receipt: JSONObject): JSONObject {
        val prepared = checked { undoJournal.prepare(account, space, receipt) }; val id = prepared.getString("importId")
        try {
            val response = checked { access.undo(id) }
            checked { undoJournal.succeeded(account, space, id, response) }; return response
        } catch (failure: AuthApiError) {
            if (failure.code == "DATA_UNDO_CONFLICT" || failure.code == "DATA_IMPORT_REMOVED") checked { undoJournal.rejected(account, space, id) }
            throw failure
        }
    }
    fun history(project: String, cursor: String?) = checked { access.history(project, cursor) }
}
