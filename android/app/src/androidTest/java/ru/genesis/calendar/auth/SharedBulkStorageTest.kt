package ru.genesis.calendar.auth

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import java.util.UUID

class SharedBulkStorageTest {
    @Test fun coldBulkJournalKeepsFrozenRequestAndRejectsAnotherAccountProjectOrPurpose() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Separate QA installation required", context.packageName in setOf("ru.genesis.calendar.c5qa.debug", "ru.genesis.calendar.ghttps.debug"))
        val actor = "bulk-storage-${UUID.randomUUID()}"; val project = "synthetic-project"
        val key = "bulk-v1:${actor.length}:$actor:${project.length}:$project"
        val other = "other-project"; val otherKey = "bulk-v1:${actor.length}:$actor:${other.length}:$other"
        val prefs = context.getSharedPreferences("genesis.shared.bulk.v1", Context.MODE_PRIVATE)
        fun journal() = PlanningJournal(PlanningDraftStore(context, "bulk"), contract = SharedBulkJournalContract)
        try {
            val selection = JSONObject().put("mode", "page").put("items", JSONArray().put(JSONObject().put("id", "synthetic-task").put("projectId", project).put("revision", 3)))
            val edit = JSONObject().put("projectId", project).put("selection", selection).put("action", JSONObject().put("kind", "due").put("mode", "shift").put("days", -7))
            val saved = journal().save(actor, project, null, edit)
            val fresh = JSONObject().put("total", 1).put("projects", JSONArray().put(JSONObject().put("id", project).put("spaceId", "space").put("title", "Synthetic private title")
                .put("taskCount", 1).put("statuses", JSONArray()))).put("hasMore", false).put("nextCursor", JSONObject.NULL)
            val prepared = journal().prepare(actor, project, saved.getString("stamp"), fresh, false)
            val attempted = journal().beginAttempt(actor, project, prepared.getString("stamp"))
            val encrypted = requireNotNull(prefs.getString(key, null))
            assertFalse(encrypted.contains("synthetic-task")); assertFalse(encrypted.contains("requestId")); assertFalse(encrypted.contains("shift"))
            val restored = journal().load(actor, project)!!; assertEquals(attempted.toString(), restored.toString())
            assertEquals(prepared.getString("command"), restored.getString("command")); assertEquals(1, restored.getInt("attempts"))
            assertNull(journal().load("another-actor", project)); assertNull(journal().load(actor, other))
            prefs.edit().putString(otherKey, encrypted).commit()
            assertTrue(runCatching { journal().load(actor, other) }.isFailure)
            assertEquals(encrypted, prefs.getString(otherKey, null)); assertEquals(restored.toString(), journal().load(actor, project)!!.toString())
            assertTrue(runCatching { journal().remove(actor, project, restored.getString("stamp")) }.isFailure)
            assertNull(PlanningJournal(PlanningDraftStore(context, "planning")).load(actor, project))
        } finally { prefs.edit().remove(key).remove(otherKey).commit() }
    }
}
