package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class SharedAutomationDraftServiceTest {
    private val storage = MemoryPlanningStorage()
    private var current = true; private var lose = false; private var malformed = false; private var switchOnSend = false
    private var rejection: String? = null; private var fresh = automationRuleFixture()
    private val sent = mutableListOf<String>(); private val receipts = mutableMapOf<String, JSONObject>()
    private val access = object : SharedAutomationAccess {
        override fun check() { if (!current) throw CancellationException() }
        override fun rule(project: String, rule: String) = JSONObject().put("rule", JSONObject(fresh.toString()))
        override fun send(project: String, rule: String, run: String?, body: JSONObject): JSONObject {
            sent += body.toString(); rejection?.let { throw AuthApiError(it) }
            val receipt = receipts.getOrPut(body.getString("operationId")) {
                if (run != null) JSONObject().put("id", run).put("state", "pending").put("retryCount", 1)
                else JSONObject().put("rule", JSONObject(fresh.toString()).put("revision", 4).apply {
                    for (key in listOf("enabled", "deleted")) if (body.has(key)) put(key, body.getBoolean(key))
                })
            }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            if (switchOnSend) current = false
            return JSONObject(receipt.toString()).apply { if (malformed) getJSONObject("rule").put("projectId", "wrong-project") }
        }
    }
    private fun service(actor: String = "actor") = SharedAutomationDraftService(PlanningJournal(storage, contract = SharedAutomationJournalContract), actor, access)
    private fun prepared(edit: JSONObject = automationEditFixture()): JSONObject {
        val saved = service().save("project", null, edit); return service().prepare("project", saved.getString("stamp"))
    }
    @Test fun lostReplyReplaysOneOperationAfterRestartAndStoresOnlyTheMinimalReceipt() {
        val row = prepared(); lose = true; assertThrows(AuthFailure::class.java) { service().send("project", row.getString("stamp")) }
        val saved = service().load("project")!!; val received = service().send("project", saved.getString("stamp"))
        assertEquals("received", received.getString("phase")); assertEquals(sent[0], sent[1]); assertEquals(1, receipts.size)
        assertEquals("received", service().load("project")!!.getString("phase"))
        val serialized = storage.records.values.joinToString(); assertFalse(serialized.contains("Личное правило")); assertFalse(serialized.contains("definition"))
        assertEquals(setOf("ruleId", "revision", "enabled", "deleted"), received.getJSONObject("receipt").keys().asSequence().toSet())
    }
    @Test fun accountAndCasIsolationCannotReplaceAPendingCommand() {
        val saved = service().save("project", null, automationEditFixture()); assertNull(service("other").load("project"))
        assertThrows(Exception::class.java) { service().prepare("project", "stale-stamp") }
        val pending = service().prepare("project", saved.getString("stamp"))
        assertThrows(Exception::class.java) { service().save("project", pending.getString("stamp"), automationEditFixture("deleted")) }
        assertTrue(sent.isEmpty())
    }
    @Test fun revokedManagementOrChangedRevisionPreventsPreparation() {
        val saved = service().save("project", null, automationEditFixture()); fresh.put("canManage", false)
        assertThrows(Exception::class.java) { service().prepare("project", saved.getString("stamp")) }
        fresh.put("canManage", true).put("revision", 4)
        assertThrows(Exception::class.java) { service().prepare("project", saved.getString("stamp")) }; assertTrue(sent.isEmpty())
    }
    @Test fun malformedReceiptCannotReleaseTheOriginalPendingIdentity() {
        val pending = prepared(); malformed = true
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }
        val saved = service().load("project")!!; assertEquals("pending", saved.getString("phase")); assertTrue(saved.isNull("receipt"))
        malformed = false; assertEquals("received", service().send("project", saved.getString("stamp")).getString("phase")); assertEquals(1, receipts.size)
    }
    @Test fun cancelledAccountCannotWriteAReceiptIntoAnotherSession() {
        val pending = prepared(); switchOnSend = true
        assertThrows(CancellationException::class.java) { service().send("project", pending.getString("stamp")) }
        current = true; assertEquals("pending", service().load("project")!!.getString("phase")); assertNull(service("other").load("project"))
    }
    @Test fun aFailedDurableAttemptNeverReachesTheNetwork() {
        val pending = prepared(); storage.fail = true
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }; assertTrue(sent.isEmpty())
    }
    @Test fun restoringARuleAlwaysKeepsItPausedAndReceiptsSurviveReload() {
        fresh.put("deleted", true).put("enabled", false)
        val edit = automationEditFixture("deleted").put("value", false); val pending = prepared(edit)
        val result = service().send("project", pending.getString("stamp")); val body = JSONObject(sent.single())
        assertFalse(body.getBoolean("deleted")); assertFalse(body.getBoolean("enabled")); assertFalse(body.has("requestId"))
        assertFalse(service().load("project")!!.getJSONObject("receipt").getBoolean("enabled")); service().remove("project", result.getString("stamp")); assertNull(service().load("project"))
    }
    @Test fun retryReplaysOneReceiptAndAFirstDefinitiveConflictDoesNotBecomeANewCommand() {
        val pending = prepared(automationEditFixture("retry")); lose = true
        assertThrows(AuthFailure::class.java) { service().send("project", pending.getString("stamp")) }
        val result = service().send("project", service().load("project")!!.getString("stamp"))
        assertEquals(1, result.getJSONObject("receipt").getInt("retryCount")); assertEquals(1, receipts.size)
        assertEquals("received", service().load("project")!!.getString("phase")); service().remove("project", result.getString("stamp"))
        val next = prepared(); rejection = "AUTOMATION_CONFLICT"; assertThrows(AuthApiError::class.java) { service().send("project", next.getString("stamp")) }
        assertEquals("rejected", service().load("project")!!.getString("phase"))
    }
    @Test fun aDefinitiveTemplateOrRecurrenceRefusalCanBeReviewedWithoutLosingAnAmbiguousReplay() {
        for (code in listOf("TEMPLATE_UNAVAILABLE", "TEMPLATE_FIELD_MAPPING_INVALID", "SERIES_INVALID", "INVALID_ASSIGNEE")) {
            fresh.put("enabled", false); val pending = prepared(automationEditFixture().put("value", true)); rejection = code
            assertTrue(SharedAutomationProtocol.errorCode(code)); assertThrows(AuthApiError::class.java) { service().send("project", pending.getString("stamp")) }
            val rejected = service().load("project")!!; assertEquals("rejected", rejected.getString("phase")); service().remove("project", rejected.getString("stamp")); rejection = null
        }
    }
}
