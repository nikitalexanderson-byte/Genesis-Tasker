package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID
import kotlinx.coroutines.CancellationException

internal const val IMPORT_SPACE = "11111111-1111-4111-8111-111111111111"
internal const val IMPORT_PROJECT = "22222222-2222-4222-8222-222222222222"
internal fun importSelection() = JSONObject().put("format", "json").put("spaceId", IMPORT_SPACE).put("projectId", JSONObject.NULL).put("parentProjectId", JSONObject.NULL)
    .put("parse", JSONObject().put("title", "Import").put("openTitle", "Open").put("doneTitle", "Done").put("calendarMode", "lunar")
        .put("calendarContext", JSONObject().put("version", 2).put("timeZone", "America/New_York").put("gregorianYearStart", "march"))
        .put("delimiter", ",").put("dateFormat", "iso").put("columns", JSONObject()).put("customColumns", JSONArray()).put("doneStatusKeys", JSONArray()))
    .put("memberMap", JSONObject()).put("statusMap", JSONObject()).put("labelMap", JSONObject()).put("fieldMap", JSONObject()).put("optionMap", JSONObject()).put("fieldDefaults", JSONObject())
internal fun importPreview(fingerprint: String = "a".repeat(64), canApply: Boolean = true) = JSONObject().put("previewVersion", 1).put("sampleLimit", 100)
    .put("fingerprint", fingerprint).put("canApply", canApply).put("projectCount", 1).put("taskCount", 1)
    .put("sourceCounts", JSONObject().put("projects", 1).put("tasks", 1).put("comments", 0).put("history", 0).put("attachments", 0).put("series", 0).put("templates", 0))
    .put("data", JSONObject().put("format", "genesis.shared-data").put("version", 1).put("calendarMode", "lunar")
        .put("calendarContext", importSelection().getJSONObject("parse").getJSONObject("calendarContext"))
        .put("projects", JSONArray().put(JSONObject().put("key", "root").put("title", "Root").put("parentKey", JSONObject.NULL).put("statuses", JSONArray()
            .put(JSONObject().put("key", "open").put("title", "Open").put("isDone", false)).put(JSONObject().put("key", "done").put("title", "Done").put("isDone", true)))))
        .put("tasks", JSONArray().put(JSONObject().put("key", "task").put("title", "Portable").put("projectKey", "root").put("dueDate", JSONObject.NULL)))
        .put("members", JSONArray()).put("fields", JSONArray()).put("labels", JSONArray()))
    .put("blockers", if (canApply) JSONArray() else JSONArray().put(JSONObject().put("code", "DATA_APPLY_BLOCKED").put("field", "")))
    .put("notices", JSONArray()).put("memberMap", JSONObject()).put("statusMap", JSONObject().put("open", "open").put("done", "done")).put("labelMap", JSONObject()).put("fieldMap", JSONObject()).put("optionMap", JSONObject()).put("issueTitles", JSONObject())
    .put("destinationFields", JSONArray()).put("destinationMembers", JSONArray()).put("destinationStatuses", JSONArray()).put("destinationLabels", JSONArray())
internal fun importReceipt(operation: String) = JSONObject().put("importId", "33333333-3333-4333-8333-333333333333").put("rootProjectId", IMPORT_PROJECT)
    .put("spaceId", IMPORT_SPACE).put("operationId", operation).put("projectCount", 1).put("taskCount", 1).put("state", "active").put("canUndo", true).put("duplicate", false).put("notices", JSONArray())

class DataImportDraftServiceTest {
    private class Memory : PlanningJournalStorage {
        val values = mutableMapOf<String, String>(); var fail = false
        override fun <T> locked(block: () -> T): T = synchronized(this, block)
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) { check(!fail) { "PLANNING_DRAFT_STORAGE" }; values[key] = value }
        override fun remove(key: String) { check(!fail); values.remove(key) }
    }
    private class Sources : DataImportSources {
        val values = mutableMapOf<String, String>(); var broken = false
        override fun store(account: String, space: String, project: String, name: String, open: () -> InputStream, current: () -> Unit): JSONObject {
            current(); val content = open().use { it.readBytes().toString(Charsets.UTF_8) }; val id = UUID.randomUUID().toString(); values[id] = content
            return JSONObject().put("id", id).put("name", name).put("bytes", content.toByteArray().size)
                .put("sha256", MessageDigest.getInstance("SHA-256").digest(content.toByteArray()).joinToString("") { "%02x".format(it) })
        }
        override fun read(account: String, space: String, project: String, reference: JSONObject, current: () -> Unit): String {
            current(); check(!broken) { "DATA_SOURCE_INVALID" }; return values.getValue(reference.getString("id"))
        }
    }
    private class Access : DataImportAccess {
        var alive = true; var queued = false; var preview = importPreview(); var lose = false; var reject: String? = null; var closeOnReply = false
        val requests = mutableListOf<String>(); val server = mutableMapOf<String, JSONObject>(); var undoCalls = 0; var loseUndo = false; var undoConflict = false
        override fun check() { if (!alive) throw CancellationException() }
        override fun hasTaskQueue(project: String) = queued
        override fun preview(selection: JSONObject, content: String) = preview
        override fun apply(selection: JSONObject, content: String, operation: String, fingerprint: String): JSONObject {
            requests += JSONObject().put("selection", selection).put("content", content).put("operation", operation).put("fingerprint", fingerprint).toString()
            reject?.let { throw AuthApiError(it) }
            val receipt = server.getOrPut(operation) { importReceipt(operation) }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            if (closeOnReply) alive = false
            return receipt
        }
        override fun imports(space: String, cursor: String?) = JSONObject().put("imports", JSONArray(server.values.toList())).put("nextCursor", JSONObject.NULL)
        override fun undo(import: String): JSONObject {
            undoCalls++; if (undoConflict) throw AuthApiError("DATA_UNDO_CONFLICT")
            if (loseUndo) { loseUndo = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            return JSONObject().put("importId", import).put("state", "undone")
        }
        override fun history(project: String, cursor: String?) = JSONObject().put("records", JSONArray()).put("nextCursor", JSONObject.NULL)
    }
    private val memory = Memory(); private val sources = Sources(); private val access = Access()
    private fun service() = DataImportDraftService(PlanningJournal(memory, contract = DataImportJournalContract), DataImportUndoJournal(memory), sources, "account", IMPORT_SPACE, access)
    private fun choose() = service().choose(IMPORT_PROJECT, null, "portable.json", { "private-source-bytes-😀".byteInputStream() }, importSelection())
    private fun prepared(): JSONObject {
        val chosen = choose(); val inspected = service().inspect(IMPORT_PROJECT, chosen.getString("stamp")).getJSONObject("record")
        return service().prepare(IMPORT_PROJECT, inspected.getString("stamp"))
    }
    @Test fun aRestartedServiceReplaysTheSameFrozenSourceAndOperationAfterALostReply() {
        val pending = prepared(); access.lose = true
        assertThrows(AuthFailure::class.java) { service().send(IMPORT_PROJECT, pending.getString("stamp")) }
        val restored = service().load(IMPORT_PROJECT)!!; assertEquals("pending", restored.getString("phase")); assertEquals(1, restored.getInt("attempts"))
        assertFalse(memory.values.values.any { it.contains("private-source-bytes") })
        val received = service().send(IMPORT_PROJECT, restored.getString("stamp"))
        assertEquals("received", received.getString("phase")); assertEquals(1, access.server.size); assertEquals(access.requests[0], access.requests[1])
    }
    @Test fun aChangedDestinationCannotReuseAnAcceptedPreview() {
        val chosen = choose(); val inspected = service().inspect(IMPORT_PROJECT, chosen.getString("stamp")).getJSONObject("record")
        access.preview = importPreview("b".repeat(64))
        assertThrows(IllegalArgumentException::class.java) { service().prepare(IMPORT_PROJECT, inspected.getString("stamp")) }
        assertEquals("editing", service().load(IMPORT_PROJECT)!!.getString("phase")); assertTrue(access.requests.isEmpty())
    }
    @Test fun aPendingTaskQueueBlocksBeforeAnyAttemptOrNetworkWrite() {
        val pending = prepared(); access.queued = true
        assertThrows(IllegalArgumentException::class.java) { service().send(IMPORT_PROJECT, pending.getString("stamp")) }
        assertEquals(0, service().load(IMPORT_PROJECT)!!.getInt("attempts")); assertTrue(access.requests.isEmpty())
    }
    @Test fun aBrokenSourceBlocksBeforeTheDurableAttemptMarker() {
        val pending = prepared(); sources.broken = true
        assertThrows(IllegalStateException::class.java) { service().send(IMPORT_PROJECT, pending.getString("stamp")) }
        assertEquals(0, service().load(IMPORT_PROJECT)!!.getInt("attempts")); assertTrue(access.requests.isEmpty())
    }
    @Test fun theFirstDefinitiveRejectionCanBeReviewedButAnUncertainReplayStaysFrozen() {
        val pending = prepared(); access.reject = "DATA_PREVIEW_CHANGED"
        assertThrows(AuthApiError::class.java) { service().send(IMPORT_PROJECT, pending.getString("stamp")) }
        val rejected = service().load(IMPORT_PROJECT)!!; assertEquals("rejected", rejected.getString("phase"))
        val edited = service().inspect(IMPORT_PROJECT, rejected.getString("stamp")).getJSONObject("record")
        val next = service().prepare(IMPORT_PROJECT, edited.getString("stamp")); access.reject = null; access.lose = true
        assertThrows(AuthFailure::class.java) { service().send(IMPORT_PROJECT, next.getString("stamp")) }
        access.reject = "DATA_PREVIEW_CHANGED"; val uncertain = service().load(IMPORT_PROJECT)!!
        assertThrows(AuthApiError::class.java) { service().send(IMPORT_PROJECT, uncertain.getString("stamp")) }
        val replay = service().load(IMPORT_PROJECT)!!; assertEquals("pending", replay.getString("phase"))
        assertThrows(IllegalArgumentException::class.java) { service().remove(IMPORT_PROJECT, replay.getString("stamp")) }
    }
    @Test fun accountClosureDropsTheReplyAndPreservesThePendingIdentity() {
        val pending = prepared(); access.closeOnReply = true
        assertThrows(CancellationException::class.java) { service().send(IMPORT_PROJECT, pending.getString("stamp")) }
        access.alive = true; val restored = service().load(IMPORT_PROJECT)!!
        assertEquals("pending", restored.getString("phase")); assertEquals(pending.getString("command"), restored.getString("command")); assertTrue(restored.isNull("receipt"))
    }
    @Test fun storageFailurePreventsTheHttpsWrite() {
        val pending = prepared(); memory.fail = true
        assertThrows(IllegalStateException::class.java) { service().send(IMPORT_PROJECT, pending.getString("stamp")) }; assertTrue(access.requests.isEmpty())
        memory.fail = false; assertEquals(0, service().load(IMPORT_PROJECT)!!.getInt("attempts"))
    }
    @Test fun aStalePickerCannotReplaceTheCurrentEncryptedSource() {
        val original = choose(); var opened = false
        assertThrows(IllegalArgumentException::class.java) { service().choose(IMPORT_PROJECT, null, "stale.csv", { opened = true; "x".byteInputStream() }, importSelection()) }
        assertFalse(opened); assertEquals(original.toString(), service().load(IMPORT_PROJECT)!!.toString())
    }
    @Test fun savedCopiesPreserveTheirSourceWithoutReplacingAnUncertainCommand() {
        val pending = prepared(); val copy = service().saveCopy(IMPORT_PROJECT, UUID.randomUUID().toString(), null, pending.getJSONObject("edit"))
        assertEquals(pending.getJSONObject("edit").getJSONObject("source").toString(), copy.getJSONObject("edit").getJSONObject("source").toString())
        assertThrows(IllegalArgumentException::class.java) { service().useCopy(IMPORT_PROJECT, copy.getString("id"), copy.getString("stamp"), pending.getString("stamp")) }
        assertEquals(pending.getString("command"), service().load(IMPORT_PROJECT)!!.getString("command"))
    }
    @Test fun undoIdentitySurvivesALostReplyAndTheNextServiceCanFinishIt() {
        val receipt = importReceipt(UUID.randomUUID().toString()); access.loseUndo = true
        assertThrows(AuthFailure::class.java) { service().undo(receipt) }; assertEquals(receipt.getString("importId"), service().pendingUndos().single().getString("importId"))
        service().undo(service().pendingUndos().single()); assertTrue(service().pendingUndos().isEmpty()); assertEquals(2, access.undoCalls)
    }
    @Test fun anUndoConflictPreservesSubsequentWorkAndClearsOnlyTheRejectedIntent() {
        access.undoConflict = true
        assertThrows(AuthApiError::class.java) { service().undo(importReceipt(UUID.randomUUID().toString())) }
        assertTrue(service().pendingUndos().isEmpty())
    }
    @Test fun typedMappingsKeepZeroFalseNullAndTabDelimiterWithoutMutatingTheCaller() {
        val selection = importSelection(); selection.getJSONObject("parse").put("delimiter", "\t")
        selection.getJSONObject("fieldDefaults").put(IMPORT_PROJECT, false).put(IMPORT_SPACE, 0)
        selection.getJSONObject("memberMap").put("former", JSONObject.NULL)
        selection.getJSONObject("optionMap").put("source-field", JSONArray())
        val before = selection.toString(); val frozen = DataImportProtocol.selection(selection)
        assertEquals(before, selection.toString()); assertFalse(frozen.getJSONObject("fieldDefaults").getBoolean(IMPORT_PROJECT))
        assertEquals(0, frozen.getJSONObject("fieldDefaults").getInt(IMPORT_SPACE)); assertTrue(frozen.getJSONObject("memberMap").isNull("former"))
        assertTrue(frozen.getJSONObject("optionMap").get("source-field") is JSONObject)
    }
}
