package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

private fun fieldCopy(raw: JSONObject) = JSONObject(raw.toString())
private fun fieldSource(type: String = "number") = JSONObject().put("id", "field-one").put("spaceId", "space").put("projectId", "project")
    .put("title", "Моё поле 🌿").put("type", type).put("options", JSONArray()).put("position", 0).put("required", false)
    .put("showCard", true).put("showList", false).put("archived", false).put("revision", 3).put("predecessorId", JSONObject.NULL)
private fun fieldContext(role: String = "owner") = JSONObject().put("space", JSONObject().put("id", "space").put("role", role))
    .put("project", JSONObject().put("id", "project").put("spaceId", "space").put("role", "manager").put("permissions", JSONObject().put("manageProjects", true)))
private fun fieldReview(edit: JSONObject, count: Int = 0, fingerprint: String = "a".repeat(64)): JSONObject {
    val request = CustomFieldEditorProtocol.request(edit)
    val field = fieldCopy(request).apply { remove("expectedRevision"); put("spaceId", edit.getString("spaceId")) }
    return JSONObject().put("field", field).put("fingerprint", fingerprint).put("valueCount", count)
        .put("previousRevision", request.getInt("expectedRevision")).put("preservesPreviousValues", true)
        .put("replaceType", edit.optJSONObject("base")?.getString("type")?.let { it != request.getString("type") && count > 0 } ?: false)
}
private fun fieldEdit(source: JSONObject? = fieldSource()): JSONObject = CustomFieldEditorProtocol.newEdit("space", "project", source).apply {
    getJSONObject("draft").put("title", "  Мой\nввод 🌿  ")
}
private fun fieldReceipt(command: JSONObject): JSONObject {
    val body = command.getJSONObject("body"); val review = body.getJSONObject("review"); val replaces = review.getBoolean("replaceType")
    val field = fieldCopy(review.getJSONObject("field")).put("revision", if (replaces) 1 else review.getInt("previousRevision") + 1)
        .put("predecessorId", if (replaces) command.getString("sprintId") else body.get("predecessorId"))
    if (replaces) field.put("id", "successor")
    return JSONObject().put("field", field).put("previousFieldId", if (replaces) command.getString("sprintId") else JSONObject.NULL)
}

class CustomFieldEditorProtocolTest {
    @Test fun incompleteInputIsRecoverableAndOnlyTheServerNormalizesReviewedNames() {
        val partial = fieldEdit(null).put("positionInput", "-").apply { getJSONObject("draft").put("title", "") }
        assertEquals("-", CustomFieldEditorProtocol.edit(partial).getString("positionInput"))
        assertThrows(Exception::class.java) { CustomFieldEditorProtocol.request(partial) }
        val edit = fieldEdit(); val review = fieldReview(edit).apply { getJSONObject("field").put("title", "Мой ввод 🌿") }
        val reviewed = CustomFieldEditorProtocol.reviewed(edit, review)
        val command = CustomFieldEditorProtocol.command(reviewed, UUID.randomUUID().toString())
        assertEquals("  Мой\nввод 🌿  ", command.getJSONObject("body").getJSONObject("payload").getString("title"))
        assertEquals("Мой ввод 🌿", CustomFieldEditorProtocol.receipt(command, fieldReceipt(command)).getJSONObject("field").getString("title"))
    }
    @Test fun aChangedFormCannotCarryItsOldReviewOrConfirmation() {
        val edit = fieldEdit().apply { getJSONObject("draft").put("type", "text") }
        val reviewed = CustomFieldEditorProtocol.reviewed(edit, fieldReview(edit, 2)).put("confirmReplacement", true)
        assertThrows(Exception::class.java) { CustomFieldEditorProtocol.command(fieldCopy(reviewed).apply { getJSONObject("draft").put("showCard", false) }, UUID.randomUUID().toString()) }
        val changed = CustomFieldEditorProtocol.changed(fieldCopy(reviewed).apply { getJSONObject("draft").put("showCard", false) })
        assertTrue(changed.isNull("review")); assertFalse(changed.getBoolean("confirmReplacement"))
    }
    @Test fun typeReplacementRequiresConsentAndAFullyAcknowledgedSuccessor() {
        val edit = fieldEdit().apply { getJSONObject("draft").put("type", "text") }
        val reviewed = CustomFieldEditorProtocol.reviewed(edit, fieldReview(edit, 1))
        assertThrows(Exception::class.java) { CustomFieldEditorProtocol.command(reviewed, UUID.randomUUID().toString()) }
        val command = CustomFieldEditorProtocol.command(reviewed.put("confirmReplacement", true), UUID.randomUUID().toString())
        val good = fieldReceipt(command); assertEquals("field-one", CustomFieldEditorProtocol.receipt(command, good).getString("previousFieldId"))
        for (bad in listOf(fieldCopy(good).put("previousFieldId", JSONObject.NULL), fieldCopy(good).apply { getJSONObject("field").put("id", "field-one") },
            fieldCopy(good).apply { getJSONObject("field").put("predecessorId", "other") }, fieldCopy(good).apply { getJSONObject("field").put("revision", 4) }))
            assertThrows(Exception::class.java) { CustomFieldEditorProtocol.receipt(command, bad) }
    }
    @Test fun everySettingOptionAndExistingPredecessorMustMatchTheReview() {
        val source = fieldSource("select").put("predecessorId", "older").put("options", JSONArray().put(JSONObject().put("id", "choice").put("title", "Прежний").put("archived", true)))
        val edit = fieldEdit(source); val command = CustomFieldEditorProtocol.command(CustomFieldEditorProtocol.reviewed(edit, fieldReview(edit)), UUID.randomUUID().toString())
        val good = fieldReceipt(command)
        for ((key, value) in listOf("title" to "changed", "type" to "multi", "projectId" to JSONObject.NULL, "position" to 1,
            "required" to true, "showCard" to false, "showList" to true, "archived" to true, "predecessorId" to JSONObject.NULL,
            "revision" to 3, "spaceId" to "other", "options" to JSONArray())) {
            val bad = fieldCopy(good).apply { getJSONObject("field").put(key, value) }
            assertThrows("Receipt $key", Exception::class.java) { CustomFieldEditorProtocol.receipt(command, bad) }
        }
        assertEquals("older", CustomFieldEditorProtocol.receipt(command, good).getJSONObject("field").getString("predecessorId"))
    }
    @Test fun historyRestoresIntoTheCurrentRevisionAndNeedsANewReview() {
        val old = fieldSource().put("revision", 1).put("title", "История").put("showList", true)
        val current = fieldEdit(); val restored = CustomFieldEditorProtocol.restore(current, old)
        assertEquals(3, CustomFieldEditorProtocol.request(restored).getInt("expectedRevision")); assertEquals("История", restored.getJSONObject("draft").getString("title"))
        assertTrue(restored.isNull("review"))
        assertThrows(Exception::class.java) { CustomFieldEditorProtocol.restore(current, fieldCopy(old).put("projectId", "former-project")) }
        assertThrows(Exception::class.java) { CustomFieldEditorProtocol.restore(current, fieldCopy(old).put("id", "other")) }
    }
    @Test fun roleScopeOfflineAndChangedImpactInvalidatePreparation() {
        val edit = fieldEdit(); val reviewed = CustomFieldEditorProtocol.reviewed(edit, fieldReview(edit))
        for (data in listOf(fieldContext("member"), fieldContext("guest"), fieldContext().put("offlineCache", true),
            fieldContext().apply { getJSONObject("project").put("id", "other") }, fieldContext().apply { getJSONObject("space").put("id", "other") },
            fieldContext().apply { getJSONObject("project").getJSONObject("permissions").put("read", false) })) {
            assertThrows(Exception::class.java) { CustomFieldEditorProtocol.verify(reviewed, data.put("preview", fieldReview(edit)), "project", false) }
        }
        assertThrows(Exception::class.java) { CustomFieldEditorProtocol.verify(reviewed, fieldContext().put("preview", fieldReview(edit, fingerprint = "b".repeat(64))), "project", false) }
        assertThrows(Exception::class.java) { CustomFieldEditorProtocol.verify(reviewed, fieldContext().put("preview", fieldReview(edit)), "project", true) }
        CustomFieldEditorProtocol.verify(reviewed, fieldContext("admin").put("preview", fieldReview(edit)), "project", false)
    }
}

class SharedFieldEditorServiceTest {
    private val storage = MemoryPlanningStorage()
    private var current = true; private var role = "owner"; private var queued = false; private var lose = false; private var cancelAfterSend = false
    private var badReceipt = false; private var fingerprint = "a".repeat(64); private var count = 0; private var reject: String? = null
    private var base = fieldSource(); private var previews = 0
    private val bodies = mutableListOf<String>(); private val receipts = mutableMapOf<String, JSONObject>()
    private val access = object : SharedFieldEditorAccess {
        override fun check() { if (!current) throw CancellationException() }
        override fun context(space: String, project: String) = fieldContext(role)
        override fun fields(space: String, project: String) = JSONObject().put("fields", JSONArray().put(base))
        override fun preview(space: String, project: String, request: JSONObject): JSONObject {
            previews++
            require(request.getInt("expectedRevision") == base.getInt("revision") || request.getInt("expectedRevision") == 0) { "CUSTOM_FIELD_CONFLICT" }
            val edit = fieldEdit(if (request.getInt("expectedRevision") == 0) null else base)
                .put("draft", fieldCopy(request).apply { remove("expectedRevision") }).put("positionInput", request.getInt("position").toString())
            return fieldReview(edit, count, fingerprint)
        }
        override fun hasTaskQueue() = queued
        override fun send(space: String, payload: JSONObject): JSONObject {
            assertEquals("pending", journal().load("owner", "project")!!.getString("phase"))
            assertTrue(journal().load("owner", "project")!!.getInt("attempts") > 0)
            bodies += payload.toString(); reject?.let { throw AuthApiError(it) }
            val receipt = receipts.getOrPut(payload.getString("operationId")) { fieldReceipt(JSONObject(journal().load("owner", "project")!!.getString("command"))) }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
            if (cancelAfterSend) current = false
            return fieldCopy(receipt).apply { if (badReceipt) getJSONObject("field").put("showList", true) }
        }
    }
    private fun journal() = PlanningJournal(storage, contract = CustomFieldEditorJournalContract)
    private fun service(account: String = "owner") = SharedFieldEditorService(journal(), account, access)
    private fun reviewed(edit: JSONObject = fieldEdit()): JSONObject {
        val saved = service().save("project", null, edit)
        return service().preview("project", saved.getString("stamp"))
    }
    private fun prepared(edit: JSONObject = fieldEdit()): JSONObject = reviewed(edit).let { service().prepare("project", it.getString("stamp")) }
    @Test fun lostReplyReopensTheSameCommandWithoutAnotherPreviewOrDuplicate() {
        val pending = prepared(fieldEdit(null)); lose = true
        assertThrows(AuthFailure::class.java) { service().send("project", pending.getString("stamp")) }
        val attempted = service().load("project")!!; val previewCount = previews; fingerprint = "b".repeat(64); base.put("revision", 4); queued = true
        assertThrows(Exception::class.java) { service().remove("project", attempted.getString("stamp")) }
        assertThrows(Exception::class.java) { service().save("project", attempted.getString("stamp"), fieldEdit()) }
        assertThrows(Exception::class.java) { service().rebase("project", attempted.getString("stamp")) }
        val received = service().send("project", attempted.getString("stamp"))
        assertEquals("received", received.getString("phase")); assertEquals(bodies[0], bodies[1]); assertEquals(1, receipts.size); assertEquals(previewCount, previews)
        assertEquals(received.toString(), service().load("project")!!.toString()); assertNull(service("another-account").load("project"))
    }
    @Test fun staleCasCannotReplaceAReviewAndUnsentImpactIsRechecked() {
        val review = reviewed(); val saved = service().save("project", review.getString("stamp"), review.getJSONObject("edit"))
        assertThrows(Exception::class.java) { service().prepare("project", review.getString("stamp")) }
        val pending = service().prepare("project", saved.getString("stamp")); fingerprint = "b".repeat(64)
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }
        assertTrue(bodies.isEmpty()); assertEquals(0, service().load("project")!!.getInt("attempts"))
    }
    @Test fun roleRevocationBlocksLocalDisclosurePreviewPreparationAndReplay() {
        val pending = prepared(); lose = true
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }
        val attempted = service().load("project")!!; val sends = bodies.size; role = "member"
        assertThrows(Exception::class.java) { service().load("project") }
        assertThrows(Exception::class.java) { service().send("project", attempted.getString("stamp")) }; assertEquals(sends, bodies.size)
        role = "admin"; assertEquals("received", service().send("project", attempted.getString("stamp")).getString("phase"))
    }
    @Test fun aProjectManagerWithoutASpaceRoleCannotReviewOrPrepare() {
        val review = reviewed(); role = "member"
        assertThrows(Exception::class.java) { service().preview("project", review.getString("stamp")) }
        assertThrows(Exception::class.java) { service().prepare("project", review.getString("stamp")) }
        // Local input can be retained after revocation, but cannot be disclosed again or prepared.
        service().save("project", review.getString("stamp"), review.getJSONObject("edit"))
        assertThrows(Exception::class.java) { service().load("project") }
        assertTrue(bodies.isEmpty())
    }
    @Test fun aCancelledEpochOrPartialReceiptKeepsTheAttemptRecoverable() {
        val pending = prepared(); cancelAfterSend = true
        assertThrows(CancellationException::class.java) { service().send("project", pending.getString("stamp")) }
        current = true; cancelAfterSend = false; badReceipt = true
        assertThrows(Exception::class.java) { service().send("project", service().load("project")!!.getString("stamp")) }
        val attempted = service().load("project")!!; assertEquals("pending", attempted.getString("phase")); assertTrue(attempted.isNull("receipt"))
        badReceipt = false; assertEquals("received", service().send("project", attempted.getString("stamp")).getString("phase")); assertEquals(1, bodies.toSet().size)
    }
    @Test fun aRejectedReplayCannotEraseAnEarlierUncertainOutcome() {
        val pending = prepared(); lose = true
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }
        reject = "CUSTOM_FIELD_CONFLICT"
        assertThrows(Exception::class.java) { service().send("project", service().load("project")!!.getString("stamp")) }
        val uncertain = service().load("project")!!; assertEquals("pending", uncertain.getString("phase")); assertEquals(2, uncertain.getInt("attempts"))
        assertThrows(Exception::class.java) { service().remove("project", uncertain.getString("stamp")) }
    }
    @Test fun explicitRebasePreservesInputAfterAFirstDefinitiveRejection() {
        val pending = prepared(); reject = "CUSTOM_FIELD_CONFLICT"
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }
        val rejected = service().load("project")!!; assertEquals("rejected", rejected.getString("phase"))
        base.put("revision", 4); val rebased = service().rebase("project", rejected.getString("stamp"))
        assertEquals("editing", rebased.getString("phase")); assertEquals("  Мой\nввод 🌿  ", rebased.getJSONObject("edit").getJSONObject("draft").getString("title"))
        assertEquals(4, CustomFieldEditorProtocol.request(rebased.getJSONObject("edit")).getInt("expectedRevision")); assertTrue(rebased.getJSONObject("edit").isNull("review"))
    }
    @Test fun storageFailureNeverStartsAnHttpsWrite() {
        val pending = prepared(); storage.fail = true
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }; assertTrue(bodies.isEmpty())
        storage.fail = false; assertEquals(0, service().load("project")!!.getInt("attempts"))
    }
    @Test fun copiesRetainThePreviousInputAndCannotReplaceAnAttemptedCommand() {
        val review = reviewed(); val other = fieldEdit(null).apply { getJSONObject("draft").put("title", "Другая версия") }
        val id = UUID.randomUUID().toString(); val savedCopy = service().saveCopy("project", id, null, other)
        val selected = service().useCopy("project", id, savedCopy.getString("stamp"), review.getString("stamp"))
        assertEquals("Другая версия", selected.getJSONObject("edit").getJSONObject("draft").getString("title")); assertEquals(2, service().copies("project").size)
        val preview = service().preview("project", selected.getString("stamp")); val pending = service().prepare("project", preview.getString("stamp")); lose = true
        assertThrows(Exception::class.java) { service().send("project", pending.getString("stamp")) }
        assertThrows(Exception::class.java) { service().useCopy("project", id, savedCopy.getString("stamp"), service().load("project")!!.getString("stamp")) }
        role = "guest"; assertThrows(Exception::class.java) { service().copies("project") }
    }
    @Test fun aLocalQueueBlocksPreviewAndTheJournalUsesItsOwnStorageNamespace() {
        val saved = service().save("project", null, fieldEdit()); queued = true
        assertThrows(Exception::class.java) { service().preview("project", saved.getString("stamp")) }; assertEquals(0, previews)
        assertNull(PlanningJournal(storage).load("owner", "project")); assertTrue(storage.records.keys.single().startsWith("field-definition-editor-v1:"))
    }
}
