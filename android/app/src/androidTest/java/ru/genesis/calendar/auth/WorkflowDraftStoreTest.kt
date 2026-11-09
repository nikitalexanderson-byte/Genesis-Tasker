package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

@RunWith(AndroidJUnit4::class)
class WorkflowDraftStoreTest {
    private fun context() = InstrumentationRegistry.getInstrumentation().targetContext.also {
        check(BuildConfig.DEBUG && it.packageName in setOf("ru.genesis.calendar.g1qa.debug", "ru.genesis.calendar.v313.debug"))
    }
    private fun key(account: String, project: String, purpose: String = "workflow") = "$purpose-v1:${account.length}:$account:${project.length}:$project"
    private fun fresh() = WorkflowLifecycle.snapshot("project", JSONObject()
        .put("config", JSONObject().put("enabled", false).put("revision", 0).put("statuses", JSONArray()).put("transitions", JSONArray()))
        .put("counts", JSONArray()).put("context", JSONObject()
            .put("project", JSONObject().put("id", "project").put("title", "QA workflow").put("role", "owner")
                .put("permissions", JSONObject().put("manageProjects", true)))
            .put("statuses", JSONArray().put(JSONObject().put("id", "open").put("title", "Open").put("isDone", 0).put("revision", 1))
                .put(JSONObject().put("id", "done").put("title", "Done").put("isDone", 1).put("revision", 1)))
            .put("customFieldDefinitions", JSONArray())))
    private fun edit() = WorkflowLifecycle.newEdit(fresh())
    private fun journal(context: Context) = PlanningJournal(PlanningDraftStore(context, "workflow"), contract = WorkflowJournalContract)

    @Test fun ciphertextCannotMoveBetweenAccountsProjectsOrPlanningPurpose() {
        val context = context(); val prefs = context.getSharedPreferences("genesis.shared.workflow.v1", 0)
        val planningPrefs = context.getSharedPreferences("genesis.shared.planning.v1", 0)
        val account = "qa-workflow-${UUID.randomUUID()}"; val other = "qa-workflow-${UUID.randomUUID()}"
        val first = key(account, "project"); val second = key(account, "second"); val foreign = key(other, "project")
        val planningKey = key(account, "project", "planning")
        try {
            val workflow = journal(context)
            workflow.save(account, "project", null, edit())
            val planning = PlanningJournal(PlanningDraftStore(context))
            planning.save(account, "project", null, JSONObject().put("kind", "settings").put("enabled", true).put("estimateUnit", "hours").put("expectedRevision", 1))
            val originalPlanning = planningPrefs.getString(planningKey, null)!!
            val encrypted = prefs.getString(first, null)!!
            assertFalse(encrypted.contains("expectedRevision"))
            assertEquals("workflow", JSONObject(LocalCipher().decrypt(encrypted, first)).getJSONObject("edit").getString("kind"))
            assertEquals("workflow", journal(context).load(account, "project")!!.getJSONObject("edit").getString("kind"))
            assertTrue(prefs.edit().putString(second, encrypted).putString(foreign, encrypted).commit())
            assertTrue(runCatching { workflow.load(account, "second") }.isFailure)
            assertTrue(runCatching { workflow.load(other, "project") }.isFailure)
            assertEquals(encrypted, prefs.getString(second, null))
            assertTrue(planningPrefs.edit().putString(planningKey, encrypted).commit())
            assertTrue(runCatching { planning.load(account, "project") }.isFailure)
            assertEquals(encrypted, planningPrefs.getString(planningKey, null))
            assertTrue(planningPrefs.edit().putString(planningKey, originalPlanning).commit())
            assertEquals("hours", planning.load(account, "project")!!.getJSONObject("edit").getString("estimateUnit"))
        } finally {
            assertTrue(prefs.edit().remove(first).remove(second).remove(foreign).commit())
            assertTrue(planningPrefs.edit().remove(planningKey).commit())
        }
    }

    @Test fun twoWorkflowEditorsHaveOneDurableCasWinner() {
        val context = context(); val prefs = context.getSharedPreferences("genesis.shared.workflow.v1", 0)
        val account = "qa-workflow-${UUID.randomUUID()}"; val recordKey = key(account, "project")
        try {
            val first = journal(context); val second = journal(context)
            val stamp = first.save(account, "project", null, edit()).getString("stamp")
            val gate = CountDownLatch(1); val finished = CountDownLatch(2); val successes = AtomicInteger(); val failures = AtomicInteger()
            for ((editor, limit) in listOf(first to "0", second to "7")) Thread {
                try {
                    gate.await()
                    val own = edit().apply { getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).put("wipLimit", limit) }
                    editor.save(account, "project", stamp, own); successes.incrementAndGet()
                } catch (_: Exception) { failures.incrementAndGet() } finally { finished.countDown() }
            }.start()
            gate.countDown(); assertTrue(finished.await(10, TimeUnit.SECONDS))
            assertEquals(1, successes.get()); assertEquals(1, failures.get())
            assertNotEquals(stamp, journal(context).load(account, "project")!!.getString("stamp"))
        } finally { assertTrue(prefs.edit().remove(recordKey).commit()) }
    }

    @Test fun encryptedConflictCopiesCannotBeTransplantedToAnotherAccount() {
        val context = context(); val prefs = context.getSharedPreferences("genesis.shared.workflow.v1", 0)
        val account = "qa-workflow-${UUID.randomUUID()}"; val other = "qa-workflow-${UUID.randomUUID()}"
        val first = "copies:" + key(account, "project"); val second = "copies:" + key(other, "project")
        try {
            val saved = journal(context).saveCopy(account, "project", UUID.randomUUID().toString(), null, edit())
            val encrypted = prefs.getString(first, null)!!
            assertFalse(encrypted.contains(saved.getString("id")))
            assertEquals(saved.getString("stamp"), journal(context).copies(account, "project").single().getString("stamp"))
            assertTrue(prefs.edit().putString(second, encrypted).commit())
            assertTrue(runCatching { journal(context).copies(other, "project") }.isFailure)
            assertTrue(runCatching { journal(context).saveCopy(other, "project", UUID.randomUUID().toString(), null, edit()) }.isFailure)
            assertEquals(encrypted, prefs.getString(second, null))
        } finally { assertTrue(prefs.edit().remove(first).remove(second).commit()) }
    }

    /** Invoked in two separate app processes, retaining only this random QA account's record. */
    @Test fun processRestartRestoresTheSameAttemptedWorkflowCommand() {
        val args = InstrumentationRegistry.getArguments(); val phase = args.getString("workflowJournalPhase")
        assumeTrue(phase in setOf("write", "read"))
        val account = requireNotNull(args.getString("workflowJournalAccount"))
        check(Regex("qa-workflow-[a-f0-9-]{36}").matches(account))
        val originalRequest = UUID.nameUUIDFromBytes(account.toByteArray(Charsets.UTF_8)).toString()
        val context = context(); val prefs = context.getSharedPreferences("genesis.shared.workflow.v1", 0)
        val recordKey = key(account, "project"); val workflow = journal(context)
        if (phase == "write") {
            check(!prefs.contains(recordKey))
            val saved = workflow.save(account, "project", null, edit())
            val prepared = workflow.prepare(account, "project", saved.getString("stamp"), fresh(), false, requestId = originalRequest)
            workflow.beginAttempt(account, "project", prepared.getString("stamp"))
            workflow.saveCopy(account, "project", UUID.randomUUID().toString(), null, WorkflowLifecycle.newEdit(fresh(), true))
            assertFalse(prefs.getString(recordKey, null)!!.contains(originalRequest))
        } else try {
            val restored = workflow.load(account, "project")!!
            assertEquals("pending", restored.getString("phase")); assertEquals(1, restored.getInt("attempts"))
            assertTrue(workflow.copies(account, "project").single().getJSONObject("edit").getBoolean("disableOnly"))
            val command = restored.getString("command")
            assertEquals(originalRequest, JSONObject(command).getJSONObject("body").getString("requestId"))
            val replay = workflow.beginAttempt(account, "project", restored.getString("stamp"))
            assertEquals(command, replay.getString("command")); assertEquals(2, replay.getInt("attempts"))
            assertTrue(runCatching { workflow.remove(account, "project", replay.getString("stamp")) }.isFailure)
        } finally { assertTrue(prefs.edit().remove(recordKey).remove("copies:$recordKey").commit()) }
    }
}
