package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import ru.genesis.calendar.ui.automationUiProject
import ru.genesis.calendar.ui.automationUiRule
import java.util.UUID

class SharedAutomationStorageTest {
    @Test fun encryptedColdAutomationCommandKeepsItsIdentityAndRejectsOtherPurposesAndAad() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Separate QA installation required", ru.genesis.calendar.BuildConfig.DEBUG &&
            context.packageName in setOf("ru.genesis.calendar.c5qa.debug", "ru.genesis.calendar.ghttps.debug"))
        val actor = "automation-storage-${UUID.randomUUID()}"; val project = automationUiProject; val other = "other-project"
        val key = "automations-v1:${actor.length}:$actor:${project.length}:$project"; val otherKey = "automations-v1:${actor.length}:$actor:${other.length}:$other"
        val prefs = context.getSharedPreferences("genesis.shared.automations.v1", Context.MODE_PRIVATE)
        fun journal() = PlanningJournal(PlanningDraftStore(context, "automations"), contract = SharedAutomationJournalContract)
        try {
            val edit = JSONObject().put("projectId", project).put("ruleId", "auto-rule-0").put("revision", 3).put("kind", "enabled").put("value", false)
            val saved = journal().save(actor, project, null, edit)
            val pending = journal().prepare(actor, project, saved.getString("stamp"), JSONObject().put("rule", automationUiRule()), false)
            val attempted = journal().beginAttempt(actor, project, pending.getString("stamp")); val encrypted = requireNotNull(prefs.getString(key, null))
            assertFalse(encrypted.contains("operationId")); assertFalse(encrypted.contains("auto-rule-0")); assertFalse(encrypted.contains("expectedRevision"))
            assertEquals(attempted.toString(), journal().load(actor, project)!!.toString()); assertNull(journal().load("other-actor", project))
            prefs.edit().putString(otherKey, encrypted).commit(); assertTrue(runCatching { journal().load(actor, other) }.isFailure)
            assertNull(PlanningJournal(PlanningDraftStore(context, "bulk"), contract = SharedBulkJournalContract).load(actor, project))
            assertTrue(runCatching { journal().remove(actor, project, attempted.getString("stamp")) }.isFailure)
            val received = journal().succeeded(actor, project, attempted.getString("stamp"), JSONObject().put("rule", automationUiRule().put("enabled", false).put("revision", 4)))
            assertEquals(received.toString(), journal().load(actor, project)!!.toString()); assertFalse(received.getJSONObject("receipt").has("title"))
        } finally { prefs.edit().remove(key).remove(otherKey).commit() }
    }
}
