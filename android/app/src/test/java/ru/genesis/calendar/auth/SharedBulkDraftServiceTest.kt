package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedBulkDraftServiceTest {
    private val storage = MemoryPlanningStorage()
    private var queued = false; private var current = true; private var lose = false; private var malformed = false; private var switchOnSend = false
    private var rejection: String? = null; private var scopeCalls = 0
    private val sent = mutableListOf<String>(); private val operations = mutableMapOf<String, JSONObject>()
    private val access = object : SharedBulkAccess {
        override fun check() { if (!current) throw CancellationException() }
        override fun hasTaskQueue() = queued
        override fun scope(selection: JSONObject): JSONObject { scopeCalls++; return bulkScopeFixture() }
        override fun preview(body: JSONObject): JSONObject {
            sent += body.toString(); rejection?.let { throw AuthApiError(it) }
            val response = operations.getOrPut(body.getString("requestId")) { bulkReportFixture().put("action", body.getJSONObject("action")) }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            if (switchOnSend) current = false
            return JSONObject(response.toString()).apply { if (malformed) put("action", JSONObject().put("kind", "archive")) }
        }
    }
    private fun service(actor: String = "actor") = SharedBulkDraftService(PlanningJournal(storage, contract = SharedBulkJournalContract), actor, access)
    private fun draft() = service().save("project", null, bulkEditFixture())
    private fun prepared(): JSONObject { val row = draft(); return service().prepare("project", row.getString("stamp")) }
    @Test fun lostPreviewReplaysExactRequestAcrossRestartAndStoresNoAclNames() {
        val row = prepared(); lose = true
        assertThrows(AuthFailure::class.java) { service().send("project", row.getString("stamp")) }
        val pending = service().load("project")!!; queued = true
        val accepted = service().send("project", pending.getString("stamp"))
        assertEquals("received", accepted.getString("phase")); assertEquals(1, operations.size); assertEquals(2, sent.size); assertEquals(sent[0], sent[1])
        assertEquals(1, scopeCalls); assertFalse(storage.records.values.any { it.contains("Private") }); assertEquals(1, accepted.getJSONObject("receipt").length())
    }
    @Test fun malformedSuccessRemainsFrozenAndCannotBeSilentlyRemoved() {
        val source = prepared(); malformed = true
        assertThrows(Exception::class.java) { service().send("project", source.getString("stamp")) }
        val pending = service().load("project")!!; assertEquals("pending", pending.getString("phase")); assertEquals(source.getString("command"), pending.getString("command"))
        assertThrows(Exception::class.java) { service().remove("project", pending.getString("stamp")) }
        malformed = false; assertEquals("received", service().send("project", pending.getString("stamp")).getString("phase"))
        assertEquals(sent[0], sent[1]); assertEquals(1, operations.size)
    }
    @Test fun firstDefinitiveRejectionAllowsReselectionButRejectedReplayStaysUnknown() {
        val source = prepared(); rejection = "SHARED_TASK_CONFLICT"
        runCatching { service().send("project", source.getString("stamp")) }
        val rejected = service().load("project")!!; assertEquals("rejected", rejected.getString("phase"))
        service().remove("project", rejected.getString("stamp")); rejection = null
        val next = prepared(); lose = true; runCatching { service().send("project", next.getString("stamp")) }
        val unknown = service().load("project")!!; rejection = "SHARED_TASK_CONFLICT"; runCatching { service().send("project", unknown.getString("stamp")) }
        val kept = service().load("project")!!; assertEquals("pending", kept.getString("phase")); assertEquals(2, kept.getInt("attempts"))
        assertThrows(Exception::class.java) { service().remove("project", kept.getString("stamp")) }
    }
    @Test fun existingTaskQueueStopsNewPrepareAndFirstAttemptWithoutDeletingTheDraft() {
        val draft = draft(); queued = true
        assertEquals("BULK_LOCAL_QUEUE", assertThrows(IllegalArgumentException::class.java) { service().prepare("project", draft.getString("stamp")) }.message)
        assertEquals(0, scopeCalls); assertTrue(sent.isEmpty()); assertEquals(draft.toString(), service().load("project")!!.toString())
        queued = false; val prepared = service().prepare("project", draft.getString("stamp")); queued = true
        assertThrows(Exception::class.java) { service().send("project", prepared.getString("stamp")) }; assertTrue(sent.isEmpty())
    }
    @Test fun staleWriterAndOtherActorCannotReplaceFrozenSelection() {
        val saved = draft(); val next = service().save("project", saved.getString("stamp"), bulkEditFixture())
        assertThrows(Exception::class.java) { service().prepare("project", saved.getString("stamp")) }
        assertNull(service("other").load("project")); assertNull(service().load("other-project"))
        val prepared = service().prepare("project", next.getString("stamp"))
        assertThrows(Exception::class.java) { service().save("project", prepared.getString("stamp"), bulkEditFixture()) }; assertTrue(sent.isEmpty())
    }
    @Test fun durableAttemptFailurePreventsHttpsAndLateActorSwitchCannotAcknowledge() {
        val prepared = prepared(); storage.fail = true
        assertThrows(Exception::class.java) { service().send("project", prepared.getString("stamp")) }; assertTrue(sent.isEmpty())
        storage.fail = false; switchOnSend = true
        assertThrows(CancellationException::class.java) { service().send("project", prepared.getString("stamp")) }
        current = true; val pending = service().load("project")!!; assertEquals("pending", pending.getString("phase")); assertEquals(1, pending.getInt("attempts"))
    }
}
