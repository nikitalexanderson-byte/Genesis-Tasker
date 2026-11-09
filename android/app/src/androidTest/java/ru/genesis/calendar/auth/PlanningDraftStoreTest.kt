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
class PlanningDraftStoreTest {
    private fun context() = InstrumentationRegistry.getInstrumentation().targetContext.also {
        check(BuildConfig.DEBUG && it.packageName in setOf("ru.genesis.calendar.g1qa.debug", "ru.genesis.calendar.v313.debug"))
    }
    private fun preferences(context: Context) = context.getSharedPreferences("genesis.shared.planning.v1", Context.MODE_PRIVATE)
    private fun key(account: String, project: String) = "planning-v1:${account.length}:$account:${project.length}:$project"
    private fun edit() = JSONObject().put("kind", "settings").put("enabled", true).put("estimateUnit", "hours").put("expectedRevision", 1)
    private fun fresh() = JSONObject().put("config", JSONObject().put("enabled", true).put("estimateUnit", "points").put("revision", 1))
        .put("sprints", JSONArray()).put("fingerprint", "a".repeat(64))
        .put("context", JSONObject().put("permissions", JSONObject().put("manageProjects", true).put("organizeTasks", true)))
    @Test fun actualKeystoreEncryptionBindsEachRecordToItsAccountAndProject() {
        val context = context(); val prefs = preferences(context)
        val account = "qa-lifecycle-${UUID.randomUUID()}"; val firstKey = key(account, "first"); val secondKey = key(account, "second")
        try {
            val first = PlanningJournal(PlanningDraftStore(context)); val second = PlanningJournal(PlanningDraftStore(context))
            first.save(account, "first", null, edit()); first.save(account, "second", null, edit())
            val one = prefs.getString(firstKey, null)!!; val two = prefs.getString(secondKey, null)!!
            assertFalse(one.contains("estimateUnit")); assertFalse(one.contains("hours"))
            val decoded = LocalCipher().decrypt(one, firstKey)
            assertEquals("hours", JSONObject(decoded).getJSONObject("edit").getString("estimateUnit"))
            assertEquals("hours", second.load(account, "first")!!.getJSONObject("edit").getString("estimateUnit"))
            assertTrue(prefs.edit().putString(secondKey, one).commit())
            assertTrue(runCatching { second.load(account, "second") }.isFailure)
            assertTrue(runCatching { second.save(account, "second", null, edit()) }.isFailure)
            assertEquals(one, prefs.getString(secondKey, null))
            assertTrue(prefs.edit().putString(secondKey, two).commit())
        } finally { assertTrue(prefs.edit().remove(firstKey).remove(secondKey).commit()) }
    }
    @Test fun twoStoreInstancesHaveOneCommittedCasWinner() {
        val context = context(); val prefs = preferences(context); val account = "qa-lifecycle-${UUID.randomUUID()}"; val key = key(account, "cas")
        try {
            val first = PlanningJournal(PlanningDraftStore(context)); val second = PlanningJournal(PlanningDraftStore(context))
            val saved = first.save(account, "cas", null, edit()); val stamp = saved.getString("stamp")
            val gate = CountDownLatch(1); val finished = CountDownLatch(2); val successes = AtomicInteger(); val failures = AtomicInteger()
            for ((journal, enabled) in listOf(first to true, second to false)) Thread {
                try {
                    gate.await(); journal.save(account, "cas", stamp, edit().put("enabled", enabled)); successes.incrementAndGet()
                } catch (_: Exception) { failures.incrementAndGet() } finally { finished.countDown() }
            }.start()
            gate.countDown(); assertTrue(finished.await(10, TimeUnit.SECONDS))
            assertEquals(1, successes.get()); assertEquals(1, failures.get())
            assertNotEquals(stamp, first.load(account, "cas")!!.getString("stamp"))
        } finally { assertTrue(prefs.edit().remove(key).commit()) }
    }
    @Test fun conflictCopiesUseKeystoreAndCannotBeTransplantedToAnotherAccount() {
        val context = context(); val prefs = preferences(context); val account = "qa-lifecycle-${UUID.randomUUID()}"
        val other = "qa-lifecycle-${UUID.randomUUID()}"; val firstKey = "copies:" + key(account, "copies"); val secondKey = "copies:" + key(other, "copies")
        try {
            val journal = PlanningJournal(PlanningDraftStore(context))
            val saved = journal.saveCopy(account, "copies", UUID.randomUUID().toString(), null, edit())
            val encrypted = prefs.getString(firstKey, null)!!
            assertFalse(encrypted.contains("estimateUnit")); assertFalse(encrypted.contains(saved.getString("id")))
            assertEquals(saved.getString("stamp"), PlanningJournal(PlanningDraftStore(context)).copies(account, "copies").single().getString("stamp"))
            assertTrue(prefs.edit().putString(secondKey, encrypted).commit())
            assertTrue(runCatching { journal.copies(other, "copies") }.isFailure)
            assertTrue(runCatching { journal.saveCopy(other, "copies", UUID.randomUUID().toString(), null, edit()) }.isFailure)
            assertEquals(encrypted, prefs.getString(secondKey, null))
        } finally { assertTrue(prefs.edit().remove(firstKey).remove(secondKey).commit()) }
    }
    /** The runner invokes write/read in different app processes, retaining only this QA record. */
    @Test fun processRestartRestoresPendingCommand() {
        val args = InstrumentationRegistry.getArguments(); val phase = args.getString("planningJournalPhase")
        assumeTrue(phase in setOf("write", "read"))
        val account = requireNotNull(args.getString("planningJournalAccount"))
        check(Regex("qa-lifecycle-[a-f0-9-]{36}").matches(account))
        val context = context(); val prefs = preferences(context); val key = key(account, "restart")
        val journal = PlanningJournal(PlanningDraftStore(context))
        if (phase == "write") {
            check(!prefs.contains(key))
            val saved = journal.save(account, "restart", null, edit())
            val prepared = journal.prepare(account, "restart", saved.getString("stamp"), fresh(), false, requestId = "qa-original-request")
            journal.beginAttempt(account, "restart", prepared.getString("stamp"))
            journal.saveCopy(account, "restart", UUID.randomUUID().toString(), null, edit().put("enabled", false))
            assertTrue(prefs.contains(key)); assertFalse(prefs.getString(key, null)!!.contains("qa-original-request"))
        } else try {
            val restored = journal.load(account, "restart")!!
            assertFalse(journal.copies(account, "restart").single().getJSONObject("edit").getBoolean("enabled"))
            assertEquals("pending", restored.getString("phase")); assertEquals(1, restored.getInt("attempts"))
            val command = restored.getString("command")
            assertEquals("qa-original-request", JSONObject(command).getJSONObject("body").getString("requestId"))
            val replay = journal.beginAttempt(account, "restart", restored.getString("stamp"))
            assertEquals(command, replay.getString("command")); assertEquals(2, replay.getInt("attempts"))
            assertTrue(runCatching { journal.remove(account, "restart", replay.getString("stamp")) }.isFailure)
        } finally { assertTrue(prefs.edit().remove(key).remove("copies:$key").commit()) }
    }
}
