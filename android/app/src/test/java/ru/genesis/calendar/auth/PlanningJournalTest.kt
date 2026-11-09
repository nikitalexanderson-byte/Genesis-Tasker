package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

internal class MemoryPlanningStorage : PlanningJournalStorage {
    val records = mutableMapOf<String, String>()
    var fail = false
    var failingKey: String? = null
    override fun <T> locked(block: () -> T): T = synchronized(this, block)
    override fun read(key: String) = records[key]
    override fun write(key: String, value: String) { check(!fail && key != failingKey); records[key] = value }
    override fun remove(key: String) { check(!fail); records.remove(key) }
}

class PlanningJournalTest {
    private val storage = MemoryPlanningStorage()
    private val journal = PlanningJournal(storage)
    private val account = "account-one"
    private val project = "project"
    private val fingerprint = "a".repeat(64)
    private fun settings() = JSONObject().put("kind", "settings").put("enabled", true).put("estimateUnit", "hours").put("expectedRevision", 3)
    private fun sprint(id: String, state: String, revision: Int = 4) = JSONObject().put("id", id).put("projectId", project).put("state", state).put("revision", revision)
    private fun fresh() = JSONObject().put("config", JSONObject().put("enabled", true).put("estimateUnit", "points").put("revision", 3))
        .put("context", JSONObject().put("permissions", JSONObject().put("manageProjects", true).put("organizeTasks", true).put("editTasks", true)))
        .put("sprints", JSONArray().put(sprint("active", "active")).put(sprint("next", "planning")).put(sprint("closed", "completed")))
        .put("fingerprint", fingerprint)
    private fun editor(mode: String = "sacred", yearStart: String = "march") = JSONObject().put("kind", "sprint").put("sprintId", JSONObject.NULL).put("expectedRevision", 0)
        .put("draft", JSONObject().put("title", "Договориться о следующем этапе").put("goal", "Сохранить мой ввод")
            .put("startDate", "2026-10-24").put("endDate", "2026-10-26").put("calendarMode", mode)
            .put("calendarContext", JSONObject().put("version", 2).put("timeZone", "Europe/Berlin").put("gregorianYearStart", yearStart)))
    private fun tasks(count: Int = 131) = (0 until count).map { JSONObject().put("id", "task-$it").put("projectId", project).put("revision", 2) }
    private fun completion(rows: List<JSONObject> = tasks()): JSONObject = JSONObject().put("kind", "transition").put("action", "complete")
        .put("sprintId", "active").put("expectedRevision", 4).put("fingerprint", fingerprint)
        .put("tasks", JSONArray(rows.map { JSONObject().put("id", it.getString("id")).put("revision", it.getInt("revision")) }))
        .put("choices", JSONObject().apply { rows.forEach { put(it.getString("id"), if (it.getString("id") == "task-0") "next" else "backlog") } })
    private fun rejected(block: () -> Unit) { assertTrue(runCatching(block).isFailure) }
    private fun saved(edit: JSONObject = settings()) = journal.save(account, project, null, edit)
    private fun pending(edit: JSONObject = settings(), remaining: List<JSONObject>? = null): JSONObject {
        val record = saved(edit)
        return journal.prepare(account, project, record.getString("stamp"), fresh(), false, remaining, "original-request")
    }
    @Test fun coldReopenRestoresInputAndCasNeverOverwritesAnotherEditor() {
        val a = saved(editor()); val other = PlanningJournal(storage)
        val reopened = other.load(account, project)!!
        assertEquals(PlanningLifecycle.canonical(a), PlanningLifecycle.canonical(reopened))
        val edited = JSONObject(reopened.getJSONObject("edit").toString()).apply { getJSONObject("draft").put("goal", "Другая вкладка") }
        val b = other.save(account, project, a.getString("stamp"), edited)
        rejected { journal.save(account, project, a.getString("stamp"), editor()) }
        rejected { journal.remove(account, project, a.getString("stamp")) }
        assertEquals("Другая вкладка", journal.load(account, project)!!.getJSONObject("edit").getJSONObject("draft").getString("goal"))
        assertNotEquals(a.getString("stamp"), b.getString("stamp"))
        assertNull(journal.load("account-two", project)); assertNull(journal.load(account, "another-project"))
        rejected { journal.save(account, "another-project", b.getString("stamp"), editor()) }
    }
    @Test fun choosingAConflictCopyExplicitlyKeepsBothVersionsAcrossColdReopen() {
        val initial = saved(editor())
        val remote = editor().apply { getJSONObject("draft").put("goal", "Другое окно") }
        val current = journal.save(account, project, initial.getString("stamp"), remote)
        val local = journal.saveCopy(account, project, java.util.UUID.randomUUID().toString(), null, editor())
        assertEquals("Другое окно", journal.load(account, project)!!.getJSONObject("edit").getJSONObject("draft").getString("goal"))
        rejected { journal.useCopy(account, project, local.getString("id"), local.getString("stamp"), initial.getString("stamp")) }
        val chosen = journal.useCopy(account, project, local.getString("id"), local.getString("stamp"), current.getString("stamp"))
        val reopened = PlanningJournal(storage)
        assertEquals("Сохранить мой ввод", chosen.getJSONObject("edit").getJSONObject("draft").getString("goal"))
        assertEquals(setOf("Другое окно", "Сохранить мой ввод"), reopened.copies(account, project).map { it.getJSONObject("edit").getJSONObject("draft").getString("goal") }.toSet())
        assertEquals(chosen.getString("stamp"), reopened.load(account, project)!!.getString("stamp"))
        assertTrue(reopened.copies("another-account", project).isEmpty()); assertTrue(reopened.copies(account, "another-project").isEmpty())
    }
    @Test fun conflictCopyCannotReplaceAnUncertainCommandOrBypassItsOwnCas() {
        val pending = pending()
        val id = java.util.UUID.randomUUID().toString()
        val copy = journal.saveCopy(account, project, id, null, editor())
        rejected { journal.useCopy(account, project, id, copy.getString("stamp"), pending.getString("stamp")) }
        val updated = journal.saveCopy(account, project, id, copy.getString("stamp"), editor("lunar"))
        rejected { journal.saveCopy(account, project, id, copy.getString("stamp"), editor()) }
        rejected { journal.removeCopy(account, project, id, copy.getString("stamp")) }
        assertEquals(pending.getString("command"), journal.load(account, project)!!.getString("command"))
        assertEquals("lunar", journal.copies(account, project).single().getJSONObject("edit").getJSONObject("draft").getString("calendarMode"))
        journal.removeCopy(account, project, id, updated.getString("stamp")); assertTrue(journal.copies(account, project).isEmpty())
    }
    @Test fun failedSelectionPreservesTheActiveInputAndAllSavedCopies() {
        val current = saved(editor())
        val copy = journal.saveCopy(account, project, java.util.UUID.randomUUID().toString(), null, settings())
        storage.failingKey = "planning-v1:${account.length}:$account:${project.length}:$project"
        rejected { journal.useCopy(account, project, copy.getString("id"), copy.getString("stamp"), current.getString("stamp")) }
        assertEquals(current.getString("stamp"), journal.load(account, project)!!.getString("stamp"))
        assertEquals(2, journal.copies(account, project).size)
        storage.failingKey = null
        journal.useCopy(account, project, copy.getString("id"), copy.getString("stamp"), current.getString("stamp"))
        assertEquals(2, journal.copies(account, project).size)
    }
    @Test fun reachingTheCopyLimitNeverEvictsInputOrChangesTheActiveDraft() {
        val current = saved(editor())
        repeat(PlanningJournal.MAX_COPIES) { journal.saveCopy(account, project, java.util.UUID.randomUUID().toString(), null, settings()) }
        rejected { journal.saveCopy(account, project, java.util.UUID.randomUUID().toString(), null, editor()) }
        val copy = journal.copies(account, project).first()
        rejected { journal.useCopy(account, project, copy.getString("id"), copy.getString("stamp"), current.getString("stamp")) }
        assertEquals(PlanningJournal.MAX_COPIES, journal.copies(account, project).size)
        assertEquals(current.getString("stamp"), journal.load(account, project)!!.getString("stamp"))
        journal.removeCopy(account, project, copy.getString("id"), copy.getString("stamp"))
        journal.saveCopy(account, project, java.util.UUID.randomUUID().toString(), null, editor())
        assertEquals(PlanningJournal.MAX_COPIES, journal.copies(account, project).size)
    }
    @Test fun storageFailureStopsPreparationAndAttemptWithoutLosingThePreviousRecord() {
        val a = saved(); storage.fail = true
        rejected { journal.prepare(account, project, a.getString("stamp"), fresh(), false) }
        assertEquals("editing", journal.load(account, project)!!.getString("phase"))
        storage.fail = false
        val p = journal.prepare(account, project, a.getString("stamp"), fresh(), false)
        storage.fail = true
        rejected { journal.beginAttempt(account, project, p.getString("stamp")) }
        assertEquals(0, journal.load(account, project)!!.getInt("attempts"))
        storage.fail = false
        val attempted = journal.beginAttempt(account, project, p.getString("stamp")); storage.fail = true
        rejected { journal.succeeded(account, project, attempted.getString("stamp"), JSONObject().put("config", JSONObject().put("enabled", true).put("estimateUnit", "hours").put("revision", 4))) }
        assertEquals("pending", journal.load(account, project)!!.getString("phase"))
        assertEquals(p.getString("command"), journal.load(account, project)!!.getString("command"))
    }
    @Test fun unknownReplyAndRejectedReplayKeepExactlyTheOriginalCommandAndUuid() {
        val p = pending(); val first = journal.beginAttempt(account, project, p.getString("stamp"))
        val unknown = journal.failed(account, project, first.getString("stamp"), "NETWORK")
        val reopened = PlanningJournal(storage).load(account, project)!!
        assertEquals(unknown.getString("stamp"), reopened.getString("stamp"))
        val second = journal.beginAttempt(account, project, reopened.getString("stamp"))
        val conflict = journal.failed(account, project, second.getString("stamp"), "PLANNING_CONFLICT")
        assertEquals("pending", conflict.getString("phase")); assertEquals(2, conflict.getInt("attempts"))
        assertEquals(p.getString("command"), conflict.getString("command"))
        rejected { journal.save(account, project, conflict.getString("stamp"), settings()) }
        rejected { journal.rebase(account, project, conflict.getString("stamp"), fresh()) }
        rejected { journal.remove(account, project, conflict.getString("stamp")) }
    }
    @Test fun onlyTheFirstDefinitiveRejectionAllowsAnExplicitRebase() {
        val p = pending(); val attempt = journal.beginAttempt(account, project, p.getString("stamp"))
        val rejected = journal.failed(account, project, attempt.getString("stamp"), "PLANNING_CONFLICT")
        assertEquals("rejected", rejected.getString("phase"))
        val current = fresh().apply { getJSONObject("config").put("revision", 7) }
        val next = journal.rebase(account, project, rejected.getString("stamp"), current)
        assertEquals("editing", next.getString("phase")); assertTrue(next.isNull("command"))
        assertEquals("hours", next.getJSONObject("edit").getString("estimateUnit"))
        assertEquals(7, next.getJSONObject("edit").getInt("expectedRevision"))
        val prepared = journal.prepare(account, project, next.getString("stamp"), current, false, requestId = "explicit-new-command")
        assertNotEquals(p.getString("command"), prepared.getString("command"))
    }
    @Test fun receivedResultIsDurableAndStoresOnlyTheValidatedReceipt() {
        val p = pending(); val a = journal.beginAttempt(account, project, p.getString("stamp"))
        val response = JSONObject().put("config", JSONObject().put("enabled", true).put("estimateUnit", "hours").put("revision", 4))
            .put("unrelatedEnvelope", "do not persist")
        val done = journal.succeeded(account, project, a.getString("stamp"), response)
        assertEquals("received", PlanningJournal(storage).load(account, project)!!.getString("phase"))
        assertEquals(setOf("config"), done.getJSONObject("receipt").keys().asSequence().toSet())
        assertFalse(storage.records.values.single().contains("unrelatedEnvelope"))
        rejected { journal.beginAttempt(account, project, done.getString("stamp")) }
        journal.remove(account, project, done.getString("stamp")); assertNull(journal.load(account, project))
    }
    @Test fun malformedSuccessCannotEraseAnUncertainCommand() {
        val p = pending(); val a = journal.beginAttempt(account, project, p.getString("stamp"))
        rejected { journal.succeeded(account, project, a.getString("stamp"), JSONObject().put("config", JSONObject().put("enabled", false).put("estimateUnit", "hours").put("revision", 4))) }
        assertEquals(a.getString("command"), journal.load(account, project)!!.getString("command"))
        assertEquals("pending", journal.load(account, project)!!.getString("phase"))
    }
    @Test fun completionNeedsAll131CurrentRevisionsAndExplicitDestinations() {
        val rows = tasks(); val edit = completion(rows)
        PlanningLifecycle.verify(edit, fresh(), project, false, rows)
        rejected { PlanningLifecycle.verify(edit, fresh(), project, false, rows.take(100)) }
        rejected { PlanningLifecycle.verify(edit, fresh(), project, false, rows.dropLast(1) + JSONObject(rows.last().toString()).put("revision", 3)) }
        for (target in listOf("", "active", "closed", "unknown")) {
            val bad = JSONObject(edit.toString()).apply { getJSONObject("choices").put("task-130", target) }
            rejected { PlanningLifecycle.verify(bad, fresh(), project, false, rows) }
        }
        val record = pending(edit, rows)
        val body = JSONObject(record.getString("command")).getJSONObject("body")
        assertEquals(131, body.getJSONArray("outcomes").length())
        assertEquals("next", body.getJSONArray("outcomes").getJSONObject(0).getString("destinationSprintId"))
        assertTrue(body.getJSONArray("outcomes").getJSONObject(130).isNull("destinationSprintId"))
        assertEquals(setOf("action", "fingerprint", "outcomes", "requestId", "expectedRevision"), body.keys().asSequence().toSet())
    }
    @Test fun explicitCompletionRefreshKeepsOnlyUnchangedReferencesAndLiveDestinations() {
        val old = completion(tasks(4)); val rows = tasks(5).drop(1).map { JSONObject(it.toString()) }
        rows[0].put("revision", 3)
        old.getJSONObject("choices").put("task-2", "next")
        val current = fresh().apply { getJSONArray("sprints").getJSONObject(1).put("state", "completed"); put("fingerprint", "b".repeat(64)) }
        val rebased = PlanningLifecycle.rebase(old, current, project, rows)
        assertEquals(setOf("task-3"), rebased.getJSONObject("choices").keys().asSequence().toSet())
        assertEquals("backlog", rebased.getJSONObject("choices").getString("task-3"))
        assertEquals(4, rebased.getJSONArray("tasks").length())
        assertEquals("b".repeat(64), rebased.getString("fingerprint"))
    }
    @Test fun currentPermissionsConfigTaskQueueAndFingerprintGateNewCommands() {
        val edit = completion(tasks(1)); val rows = tasks(1)
        for (current in listOf(fresh().put("offlineCache", true), fresh().apply { getJSONObject("context").getJSONObject("permissions").put("organizeTasks", false) },
                fresh().put("fingerprint", "b".repeat(64)), fresh().apply { getJSONObject("config").put("enabled", false) })) {
            rejected { PlanningLifecycle.verify(edit, current, project, false, rows) }
        }
        rejected { PlanningLifecycle.verify(edit, fresh(), project, true, rows) }
        rejected { PlanningLifecycle.verify(settings().put("enabled", false), fresh(), project, false) }
        rejected { PlanningLifecycle.verify(settings(), fresh().apply { getJSONObject("context").getJSONObject("permissions").put("manageProjects", false) }, project, false) }
    }
    @Test fun savedDatesAndIndependentCalendarContextSurviveEveryFormRecovery() {
        for ((mode, year) in listOf("profane" to "january", "profane" to "march", "sacred" to "march", "lunar" to "january")) {
            val data = editor(mode, year); val record = saved(data)
            val restored = PlanningJournal(storage).load(account, project)!!.getJSONObject("edit")
            PlanningLifecycle.verify(restored, fresh(), project, false)
            assertEquals(PlanningLifecycle.canonical(data), PlanningLifecycle.canonical(restored))
            journal.remove(account, project, record.getString("stamp"))
        }
    }
    @Test fun corruptMetadataAndCommandsArePreservedAndNeverTreatedAsMissing() {
        val p = pending(); val key = storage.records.keys.single(); val intact = storage.records.getValue(key)
        for (mutation in listOf<(JSONObject) -> Unit>(
            { it.put("accountId", "account-two") }, { it.put("projectId", "another-project") },
            { it.put("phase", "editing") }, { it.put("unexpected", true) },
            { it.put("command", JSONObject(it.getString("command")).apply { getJSONObject("body").put("enabled", false) }.toString()) }
        )) {
            val bad = JSONObject(intact).apply(mutation).toString(); storage.records[key] = bad
            rejected { journal.load(account, project) }; rejected { journal.save(account, project, null, settings()) }
            assertEquals(bad, storage.records[key])
        }
        storage.records[key] = intact
        assertEquals(p.getString("command"), journal.load(account, project)!!.getString("command"))
    }
}
