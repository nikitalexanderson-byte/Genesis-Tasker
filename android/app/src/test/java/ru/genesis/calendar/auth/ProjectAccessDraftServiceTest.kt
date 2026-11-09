package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class ProjectAccessDraftServiceTest {
    private val storage = MemoryPlanningStorage()
    private val state = accessFixture("state"); private val space = state.getString("spaceId"); private val user = state.getString("userId")
    private var fresh = accessFixture("preview"); private var queue = false; private var current = true; private var revoked = false
    private var lose = false; private var rejection: String? = null; private var switchOnSend = false; private var malformed = false
    private val sent = mutableListOf<String>(); private val receipts = mutableMapOf<String, JSONObject>()
    private val access = object : ProjectAccessDraftAccess {
        override fun check() { if (!current) throw CancellationException() }
        override fun state(space: String, user: String): JSONObject { if (revoked) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED); return JSONObject(state.toString()) }
        override fun preview(space: String, user: String, draft: JSONObject): JSONObject { if (revoked) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED); return JSONObject(fresh.toString()) }
        override fun hasTaskQueue() = queue
        override fun send(space: String, user: String, body: JSONObject): JSONObject {
            sent += body.toString(); rejection?.let { throw AuthApiError(it) }
            val value = receipts.getOrPut(body.getString("operationId")) { JSONObject().put("operationId", body.getString("operationId")).put("revision", state.getLong("revision") + 1)
                .put("changed", fresh.getJSONArray("changes").length()).put("allProjects", body.getBoolean("allProjects")).put("grants", body.getJSONArray("grants")) }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            if (switchOnSend) current = false
            return JSONObject(value.toString()).apply { if (malformed) put("revision", 500) }
        }
    }
    private fun service() = ProjectAccessDraftService(PlanningJournal(storage, contract = ProjectAccessJournalContract), "actor", access)
    private fun draft() = service().save(space, user, null, accessEdit())
    private fun prepared(): JSONObject { val source = draft(); val reviewed = service().preview(space, user, source.getString("stamp")).getJSONObject("record"); return service().prepare(space, user, reviewed.getString("stamp")) }
    @Test fun lostResponseReopensTheExactConfirmedCommandWithoutDuplicateGrantChanges() {
        val prepared = prepared(); lose = true
        assertThrows(AuthFailure::class.java) { service().send(space, user, prepared.getString("stamp")) }
        val restored = service().load(space, user)!!; assertEquals("pending", restored.getString("phase")); assertEquals(1, restored.getInt("attempts"))
        val accepted = service().send(space, user, restored.getString("stamp"))
        assertEquals("received", accepted.getString("phase")); assertEquals(2, sent.size); assertEquals(sent[0], sent[1]); assertEquals(1, receipts.size)
        assertEquals(prepared.getString("command"), restored.getString("command"))
    }
    @Test fun aMalformedSuccessReceiptKeepsTheUnknownCommandUntilAnExactReplayConfirmsIt() {
        val source = prepared(); malformed = true
        assertEquals("PROJECT_ACCESS_RECEIPT_INVALID", assertThrows(IllegalArgumentException::class.java) { service().send(space, user, source.getString("stamp")) }.message)
        val pending = service().load(space, user)!!; assertEquals("pending", pending.getString("phase")); assertEquals(1, pending.getInt("attempts"))
        assertThrows(IllegalArgumentException::class.java) { service().remove(space, user, pending.getString("stamp")) }
        malformed = false; val accepted = service().send(space, user, pending.getString("stamp"))
        assertEquals("received", accepted.getString("phase")); assertEquals(sent[0], sent[1]); assertEquals(1, receipts.size)
    }
    @Test fun freshChangesAndTaskQueueRequireANewVisiblePreviewWithoutLosingInput() {
        val source = draft(); val reviewed = service().preview(space, user, source.getString("stamp")).getJSONObject("record")
        fresh.put("fingerprint", "b".repeat(64))
        assertEquals("PROJECT_ACCESS_CONFLICT", assertThrows(IllegalArgumentException::class.java) { service().prepare(space, user, reviewed.getString("stamp")) }.message)
        assertEquals(reviewed.toString(), service().load(space, user)!!.toString())
        val next = service().preview(space, user, reviewed.getString("stamp")).getJSONObject("record")
        queue = true
        assertEquals("PROJECT_ACCESS_LOCAL_QUEUE", assertThrows(IllegalArgumentException::class.java) { service().prepare(space, user, next.getString("stamp")) }.message)
        assertTrue(sent.isEmpty())
    }
    @Test fun firstDefiniteRejectionAllowsRebaseButARejectedReplayKeepsTheUnknownCommand() {
        var source = prepared(); rejection = "PROJECT_ACCESS_CONFLICT"; runCatching { service().send(space, user, source.getString("stamp")) }
        source = service().load(space, user)!!; assertEquals("rejected", source.getString("phase"))
        source = service().rebase(space, user, source.getString("stamp")).getJSONObject("record"); assertTrue(source.getJSONObject("edit").isNull("review"))
        source = service().preview(space, user, source.getString("stamp")).getJSONObject("record"); source = service().prepare(space, user, source.getString("stamp"))
        rejection = null; lose = true; runCatching { service().send(space, user, source.getString("stamp")) }
        source = service().load(space, user)!!; rejection = "PROJECT_ACCESS_CONFLICT"; runCatching { service().send(space, user, source.getString("stamp")) }
        val pending = service().load(space, user)!!; assertEquals("pending", pending.getString("phase")); assertEquals(2, pending.getInt("attempts"))
        assertThrows(IllegalArgumentException::class.java) { service().remove(space, user, pending.getString("stamp")) }
        assertThrows(IllegalArgumentException::class.java) { service().rebase(space, user, pending.getString("stamp")) }
    }
    @Test fun revocationDiskFailureAndAccountSwitchNeverPublishOrReplaceThePendingResult() {
        val prepared = prepared(); revoked = true
        assertThrows(AuthFailure::class.java) { service().send(space, user, prepared.getString("stamp")) }; assertTrue(sent.isEmpty())
        revoked = false; storage.fail = true
        assertTrue(runCatching { service().send(space, user, prepared.getString("stamp")) }.isFailure); assertTrue(sent.isEmpty())
        storage.fail = false; switchOnSend = true
        assertTrue(runCatching { service().send(space, user, prepared.getString("stamp")) }.exceptionOrNull() is CancellationException)
        current = true; val pending = service().load(space, user)!!
        assertEquals("pending", pending.getString("phase")); assertEquals(1, pending.getInt("attempts"))
    }
    @Test fun concurrentEditorsKeepBothScopedVersionsAndCannotCrossSpaceOrMember() {
        val source = draft(); val nextEdit = JSONObject(source.getJSONObject("edit").toString()).put("review", JSONObject.NULL)
        nextEdit.getJSONObject("draft").getJSONArray("grants").getJSONObject(0).put("includeDescendants", true)
        val newer = service().save(space, user, source.getString("stamp"), nextEdit)
        assertThrows(IllegalArgumentException::class.java) { service().save(space, user, source.getString("stamp"), source.getJSONObject("edit")) }
        val copy = service().saveCopy(space, user, UUID.randomUUID().toString(), null, source.getJSONObject("edit"))
        service().useCopy(space, user, copy.getString("id"), copy.getString("stamp"), newer.getString("stamp"))
        assertEquals(2, service().copies(space, user).size)
        assertNull(service().load(UUID.randomUUID().toString(), user)); assertNull(service().load(space, "different-member"))
        assertThrows(IllegalArgumentException::class.java) { service().save(space, "other", null, accessEdit()) }
    }
}
