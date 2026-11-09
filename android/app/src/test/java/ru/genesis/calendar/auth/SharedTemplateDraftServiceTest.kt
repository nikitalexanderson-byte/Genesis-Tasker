package ru.genesis.calendar.auth

import kotlinx.coroutines.CancellationException
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

private class TemplateAccessFixture : SharedTemplateAccess {
    var current = true
    var queued = false
    var canWrite = true
    var loseReply = false
    var changeAccountAfterSend = false
    var malformedReceipt = false
    var rejection: String? = null
    var fingerprint = "a".repeat(64)
    var sent = 0
    var previews = 0
    val wire = mutableListOf<String>()
    val receipts = mutableMapOf<String, JSONObject>()
    override fun check() { if (!current) throw CancellationException("Account generation changed") }
    override fun project(id: String) = JSONObject().put("id", id).put("spaceId", templateSpace).put("permissions", JSONObject().put("editTasks", canWrite))
    override fun source(space: String, id: String, language: String, deleted: Boolean) = JSONObject().put("id", id).put("revision", 1).put("canEdit", canWrite)
    override fun preview(id: String, request: JSONObject): JSONObject {
        previews++
        val source = templateStarters().getJSONObject(1)
        return JSONObject().put("templateId", id).put("fingerprint", fingerprint).put("revision", 1).put("canApply", canWrite)
            .put("options", SharedTemplateProtocol.options(request)).put("calendarMode", "profane").put("calendarContext", source.getJSONObject("manifest").getJSONObject("calendarContext"))
            .put("kind", "task").put("projects", source.getJSONObject("manifest").getJSONArray("projects")).put("tasks", source.getJSONObject("manifest").getJSONArray("tasks"))
            .apply { for (key in listOf("members", "statuses", "categories", "fields", "sourceFields", "newFields", "notices")) put(key, JSONArray()) }
            .put("blockers", if (canWrite) JSONArray() else JSONArray().put(JSONObject().put("code", "TEMPLATE_FIELD_CREATE_FORBIDDEN")))
    }
    override fun hasTaskQueue() = queued
    override fun send(command: JSONObject): JSONObject {
        check(); sent++; wire.add(command.toString()); rejection?.let { throw AuthApiError(it) }
        val request = command.getJSONObject("body").getJSONObject("request"); val operation = request.getString("operationId")
        val receipt = receipts.getOrPut(operation) {
            if (command.getString("kind") == "template-save") JSONObject().put("id", if (command.isNull("sprintId")) templateId else command.getString("sprintId"))
                .put("revision", if (command.isNull("sprintId")) 1 else request.getInt("expectedRevision") + 1).put("deleted", request.optBoolean("deleted"))
            else {
                val tasks = JSONObject(); repeat(3) { tasks.put("task-$it", UUID.nameUUIDFromBytes("$operation:$it".toByteArray()).toString()) }
                JSONObject().put("operationId", operation).put("templateId", command.getString("sprintId")).put("rootProjectId", templateProject).put("rootTaskId", tasks.getString("task-0"))
                    .put("projectCount", 0).put("taskCount", 3).put("projectIds", JSONObject().put("project", templateProject)).put("taskIds", tasks).put("notices", JSONArray())
            }
        }
        if (changeAccountAfterSend) current = false
        if (loseReply) { loseReply = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }
        return JSONObject(receipt.toString()).also { if (malformedReceipt) it.put("revision", 999).put("taskCount", 99) }
    }
}

class SharedTemplateDraftServiceTest {
    private val storage = MemoryPlanningStorage()
    private val access = TemplateAccessFixture()
    private fun journal() = PlanningJournal(storage, contract = SharedTemplateJournalContract)
    private fun service(account: String = "account-one") = SharedTemplateDraftService(journal(), account, access)
    private fun rejected(block: () -> Unit) { assertTrue(runCatching(block).isFailure) }
    private fun applyEdit() = SharedTemplateProtocol.newEdit(templateSpace, templateProject, "template-apply", "system:publication", templateOptions().put("projectId", templateProject))
        .put("review", access.fingerprint)
    private fun prepared(edit: JSONObject = templateSave()): JSONObject {
        val saved = service().save(templateProject, null, edit)
        return service().prepare(templateProject, saved.getString("stamp"))
    }

    @Test fun committedSaveAndApplyWithLostRepliesReopenAndReplayTheExactCommandOnlyOnce() {
        for (kind in listOf("save", "apply")) {
            val initial = prepared(if (kind == "save") templateSave() else applyEdit()); access.loseReply = true
            rejected { service().send(templateProject, initial.getString("stamp")) }
            val reopened = service().load(templateProject)!!
            assertEquals("pending", reopened.getString("phase")); assertEquals(1, reopened.getInt("attempts"))
            val oldPreviewCount = access.previews
            access.fingerprint = "b".repeat(64); access.canWrite = false; access.queued = true
            val received = service().send(templateProject, reopened.getString("stamp"))
            assertEquals("received", received.getString("phase")); assertEquals(initial.getString("command"), received.getString("command"))
            assertEquals(access.wire[access.wire.lastIndex - 1], access.wire.last()); assertEquals(oldPreviewCount, access.previews)
            val sends = access.sent; assertEquals("received", service().send(templateProject, received.getString("stamp")).getString("phase")); assertEquals(sends, access.sent)
            service().remove(templateProject, received.getString("stamp")); access.canWrite = true; access.queued = false
        }
        assertEquals(2, access.receipts.size)
    }

    @Test fun taskQueuePermissionsAndChangedPreviewStopUnattemptedWritesAndKeepOwnInput() {
        val saved = service().save(templateProject, null, templateSave())
        access.queued = true; rejected { service().prepare(templateProject, saved.getString("stamp")) }
        access.queued = false; access.canWrite = false; rejected { service().prepare(templateProject, saved.getString("stamp")) }
        assertEquals("editing", service().load(templateProject)!!.getString("phase")); assertEquals(0, access.sent)
        service().remove(templateProject, saved.getString("stamp")); access.canWrite = true
        val pending = prepared(applyEdit()); access.fingerprint = "c".repeat(64)
        rejected { service().send(templateProject, pending.getString("stamp")) }
        assertEquals(0, service().load(templateProject)!!.getInt("attempts")); assertEquals(0, access.sent)
    }

    @Test fun attemptedCommandsCannotBeEditedRebasedRemovedOrReplacedByCopies() {
        val pending = prepared(); access.loseReply = true; rejected { service().send(templateProject, pending.getString("stamp")) }
        val uncertain = service().load(templateProject)!!; val stamp = uncertain.getString("stamp")
        rejected { service().save(templateProject, stamp, templateSave()) }; rejected { service().remove(templateProject, stamp) }
        rejected { journal().rebase("account-one", templateProject, stamp, JSONObject()) }
        val copy = service().saveCopy(templateProject, UUID.randomUUID().toString(), null, templateSave())
        rejected { service().useCopy(templateProject, copy.getString("id"), copy.getString("stamp"), stamp) }
        assertEquals(uncertain.getString("command"), service().load(templateProject)!!.getString("command")); assertEquals(1, service().copies(templateProject).size)
    }

    @Test fun accountProjectAndJournalNamespacesRemainIsolatedAndCasKeepsBothEditors() {
        val initial = service().save(templateProject, null, templateSave())
        val changed = templateSave().apply { getJSONObject("request").put("title", "Other window") }
        val current = service().save(templateProject, initial.getString("stamp"), changed)
        rejected { service().save(templateProject, initial.getString("stamp"), templateSave()) }
        assertEquals(current.getString("stamp"), service().load(templateProject)!!.getString("stamp"))
        assertNull(service("account-two").load(templateProject)); assertNull(PlanningJournal(storage).load("account-one", templateProject))
        assertNull(service().load("10000000-0000-4000-8000-000000000099"))
        rejected { service().save("10000000-0000-4000-8000-000000000099", null, templateSave()) }
    }

    @Test fun firstDefinitiveFailureAllowsExplicitCopyButARejectedReplayStaysAmbiguous() {
        val pending = prepared(); access.rejection = "TEMPLATE_CONFLICT"
        rejected { service().send(templateProject, pending.getString("stamp")) }
        val rejected = service().load(templateProject)!!; assertEquals("rejected", rejected.getString("phase"))
        service().remove(templateProject, rejected.getString("stamp")); access.rejection = null
        val next = prepared(); access.loseReply = true; rejected { service().send(templateProject, next.getString("stamp")) }
        access.rejection = "TEMPLATE_CONFLICT"
        rejected { service().send(templateProject, service().load(templateProject)!!.getString("stamp")) }
        val replay = service().load(templateProject)!!; assertEquals("pending", replay.getString("phase")); assertEquals(2, replay.getInt("attempts"))
        rejected { service().remove(templateProject, replay.getString("stamp")) }
    }

    @Test fun storageFailurePrecedesNetworkAndMalformedReceiptNeverBecomesSuccess() {
        val pending = prepared(); storage.fail = true
        rejected { service().send(templateProject, pending.getString("stamp")) }; assertEquals(0, access.sent)
        storage.fail = false; access.malformedReceipt = true
        rejected { service().send(templateProject, pending.getString("stamp")) }
        assertEquals("pending", service().load(templateProject)!!.getString("phase")); assertEquals(1, access.receipts.size)
        access.malformedReceipt = false
        assertEquals("received", service().send(templateProject, service().load(templateProject)!!.getString("stamp")).getString("phase")); assertEquals(1, access.receipts.size)
    }

    @Test fun aLateResponseAfterAccountChangeLeavesAnAttemptedReceiptRecoverableForItsOriginalAccount() {
        val pending = prepared(); access.changeAccountAfterSend = true
        assertThrows(CancellationException::class.java) { service().send(templateProject, pending.getString("stamp")) }
        access.current = true; access.changeAccountAfterSend = false
        val reopened = service().load(templateProject)!!; assertEquals("pending", reopened.getString("phase")); assertEquals(1, reopened.getInt("attempts"))
        assertNull(service("account-two").load(templateProject))
        assertEquals("received", service().send(templateProject, reopened.getString("stamp")).getString("phase")); assertEquals(1, access.receipts.size)
    }
}
