package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WorkspacePatchTest {
    @Test fun oldNativeMoodEditDoesNotEraseAbstinenceAndConcurrentWebEntries() {
        val old = base().put("addictionEntries", JSONArray().put(JSONObject().put("id", "e1").put("note", "Preserve")))
        val part = JSONObject().put("sleepPlans", JSONArray()).put("sleepEntries", JSONArray())
            .put("moodEntries", JSONArray().put(JSONObject().put("id", "m1").put("moodValue", 2)))
        val local = WorkspacePatch.localDocument(old, null, null, part)
        val remote = JSONObject(old.toString()).apply { getJSONArray("addictionEntries").put(JSONObject().put("id", "e2")) }
        val result = WorkspacePatch.apply(old, local, remote, setOf("trackers"), 4, stamp(), "android")
        assertEquals(2, result.document.getJSONArray("addictionEntries").length())
        assertEquals("Preserve", result.document.getJSONArray("addictionEntries").getJSONObject(0).getString("note"))
        assertEquals(1, result.document.getJSONArray("addictionTrackers").length())
    }

    @Test fun abstinenceEditsMergeUnrelatedWebChangesAndStopOnConflictingDayResults() {
        val old = base().put("addictionEntries", JSONArray().put(JSONObject().put("id", "e1")
            .put("cleanDay", false).put("note", "Old").put("cravingIntensity", 0)))
        val local = JSONObject(old.toString()).apply { getJSONArray("addictionEntries").getJSONObject(0).put("cleanDay", true) }
        val remote = JSONObject(old.toString()).apply { getJSONArray("addictionEntries").getJSONObject(0).put("note", "Web") }
        val result = WorkspacePatch.apply(old, local, remote, setOf("trackers"), 4, stamp(), "android").document
        assertTrue(result.getJSONArray("addictionEntries").getJSONObject(0).getBoolean("cleanDay"))
        assertEquals("Web", result.getJSONArray("addictionEntries").getJSONObject(0).getString("note"))
        local.getJSONArray("addictionEntries").getJSONObject(0).put("cravingIntensity", 4)
        remote.getJSONArray("addictionEntries").getJSONObject(0).put("cravingIntensity", 8)
        assertThrows(WorkspacePatch.Conflict::class.java) {
            WorkspacePatch.apply(old, local, remote, setOf("trackers"), 4, stamp(), "android")
        }
    }
    @Test fun derivedClocksMergeButConflictingGoalChoicesStillStop() {
        val clock="2026-10-19T10:00:00Z"
        val old=base().put("dailyGoalRecords",JSONArray().put(JSONObject().put("date","2026-10-19")
            .put("mode","rhythm").put("updatedAt",clock)))
        old.getJSONObject("userProgress").put("updatedAt",clock)
        val local=JSONObject(old.toString()).apply {
            getJSONArray("dailyGoalRecords").getJSONObject(0).put("updatedAt","2026-10-19T11:00:00Z")
            getJSONObject("userProgress").put("updatedAt","2026-10-19T11:00:00Z")
        }
        val remote=JSONObject(old.toString()).apply {
            getJSONArray("dailyGoalRecords").getJSONObject(0).put("updatedAt","2026-10-19T12:00:00Z")
            getJSONObject("userProgress").put("updatedAt","2026-10-19T12:00:00Z")
        }
        val merged=WorkspacePatch.apply(old,local,remote,setOf("habits"),2,stamp(),"native").document
        assertEquals("2026-10-19T12:00:00Z",merged.getJSONObject("userProgress").getString("updatedAt"))
        assertEquals("2026-10-19T12:00:00Z",merged.getJSONArray("dailyGoalRecords").getJSONObject(0).getString("updatedAt"))
        local.getJSONArray("dailyGoalRecords").getJSONObject(0).put("mode","easy")
        remote.getJSONArray("dailyGoalRecords").getJSONObject(0).put("mode","perfect")
        assertThrows(WorkspacePatch.Conflict::class.java) {
            WorkspacePatch.apply(old,local,remote,setOf("habits"),2,stamp(),"native")
        }
    }

    @Test fun concurrentHabitRuleEditsRetainBothImmutableHistories() {
        fun rule(id:String)=JSONObject().put("id",id).put("effectiveDate","2026-10-17").put("recordedAt","2026-10-16T10:00:00Z")
        val old=base().put("habits",JSONArray().put(JSONObject().put("id","habit").put("title","Water").put("ruleHistory",JSONArray())))
        val local=JSONObject(old.toString()).apply { getJSONArray("habits").getJSONObject(0).put("ruleHistory",JSONArray().put(rule("local"))) }
        val remote=JSONObject(old.toString()).apply { getJSONArray("habits").getJSONObject(0).put("ruleHistory",JSONArray().put(rule("remote"))) }
        val merged=WorkspacePatch.apply(old,local,remote,setOf("habits"),2,stamp(),"native")
        val history=merged.document.getJSONArray("habits").getJSONObject(0).getJSONArray("ruleHistory")
        assertEquals(listOf("local","remote"),(0 until history.length()).map { history.getJSONObject(it).getString("id") })
    }
    private fun base() = JSONObject().put("trackerSchemaVersion", 16)
        .put("projects", JSONArray().put(JSONObject().put("id", "p1").put("title", "Old")
            .put("webOnly", "do not lose")))
        .put("categories", JSONArray())
        .put("taskListLinks", JSONArray())
        .put("habits", JSONArray())
        .put("habitCompletions", JSONArray())
        .put("dailyGoalRecords", JSONArray())
        .put("quests", JSONArray())
        .put("achievementUnlocks", JSONArray())
        .put("rewardTransactions", JSONArray())
        .put("streakFreezeTransactions", JSONArray())
        .put("habitSettings", JSONObject().put("enabled", true).put("reportRange", "month"))
        .put("hiddenDefaultTemplates", JSONArray())
        .put("userProgress", JSONObject().put("lifetimeXp", 10).put("webOnly", true))
        .put("sleepPlans", JSONArray()).put("sleepEntries", JSONArray()).put("moodEntries", JSONArray())
        .put("addictionTrackers", JSONArray().put(JSONObject().put("id", "a1")))

    private fun stamp() = "2026-09-25T00:00:00Z"

    @Test fun mergesUnrelatedRemoteEditsAndPreservesUnrepresentedData() {
        val old = base()
        val local = JSONObject(old.toString())
        local.getJSONArray("projects").getJSONObject(0).put("title", "Native edit")
        val remote = JSONObject(old.toString())
        remote.getJSONArray("projects").getJSONObject(0).put("webOnly", "remote update")
        remote.getJSONArray("projects").put(JSONObject().put("id", "p2").put("title", "Web project"))
        remote.getJSONObject("userProgress").put("lifetimeXp", 20)
        val result = WorkspacePatch.apply(old, local, remote, setOf("workspace-structure"), 8, stamp(), "android-test")
        assertTrue(result.changed)
        assertEquals(2, result.document.getJSONArray("projects").length())
        assertEquals("Native edit", result.document.getJSONArray("projects").getJSONObject(0).getString("title"))
        assertEquals("remote update", result.document.getJSONArray("projects").getJSONObject(0).getString("webOnly"))
        assertEquals(20, result.document.getJSONObject("userProgress").getInt("lifetimeXp"))
        assertEquals(1, result.document.getJSONArray("addictionTrackers").length())
        val revision = result.document.getJSONObject("syncMetadata").getJSONObject("entities")
            .getJSONObject("projects").getJSONObject("p1")
        assertEquals(9, revision.getLong("version"))
    }

    @Test fun refusesToOverwriteSameFieldChangedOnWeb() {
        val old = base()
        val local = JSONObject(old.toString())
        local.getJSONArray("projects").getJSONObject(0).put("title", "Native edit")
        val remote = JSONObject(old.toString())
        remote.getJSONArray("projects").getJSONObject(0).put("title", "Web edit")
        assertThrows(WorkspacePatch.Conflict::class.java) {
            WorkspacePatch.apply(old, local, remote, setOf("workspace-structure"), 8, stamp(), "android-test")
        }
    }

    @Test fun explicitKeepLocalResolvesOnlyCollidingFields() {
        val old = base()
        val local = JSONObject(old.toString())
        local.getJSONArray("projects").getJSONObject(0).put("title", "Native choice")
        val remote = JSONObject(old.toString())
        remote.getJSONArray("projects").getJSONObject(0).put("title", "Web change")
            .put("webOnly", "New web detail")
        remote.getJSONArray("projects").put(JSONObject().put("id", "p2").put("title", "Web addition"))
        val result = WorkspacePatch.apply(old, local, remote, setOf("workspace-structure"),
            9, stamp(), "android-test", WorkspacePatch.ConflictPolicy.KEEP_LOCAL)
        assertTrue(result.changed)
        assertEquals("Native choice", result.document.getJSONArray("projects").getJSONObject(0).getString("title"))
        assertEquals("New web detail", result.document.getJSONArray("projects").getJSONObject(0).getString("webOnly"))
        assertEquals("Web addition", result.document.getJSONArray("projects").getJSONObject(1).getString("title"))
    }

    @Test fun explicitKeepRemoteResolvesOnlyCollidingFields() {
        val old = base()
        val local = JSONObject(old.toString())
        local.getJSONArray("projects").getJSONObject(0).put("title", "Native edit")
            .put("description", "Unrelated local detail")
        val remote = JSONObject(old.toString())
        remote.getJSONArray("projects").getJSONObject(0).put("title", "Web edit")
            .put("webOnly", "New web detail")
        val result = WorkspacePatch.apply(old, local, remote, setOf("workspace-structure"),
            9, stamp(), "android-test", WorkspacePatch.ConflictPolicy.KEEP_REMOTE)
        val project = result.document.getJSONArray("projects").getJSONObject(0)
        assertEquals("Web edit", project.getString("title"))
        assertEquals("Unrelated local detail", project.getString("description"))
        assertEquals("New web detail", project.getString("webOnly"))
    }

    @Test fun deletionCreatesWebCompatibleTombstoneWithoutTouchingOtherCollections() {
        val old = base()
        val local = JSONObject(old.toString()).put("projects", JSONArray())
        val result = WorkspacePatch.apply(old, local, old, setOf("workspace-structure"), 8, stamp(), "android-test")
        assertEquals(0, result.document.getJSONArray("projects").length())
        val tombstone = result.document.getJSONObject("syncMetadata").getJSONArray("tombstones").getJSONObject(0)
        assertEquals("projects", tombstone.getString("collection"))
        assertEquals("p1", tombstone.getString("id"))
        assertEquals(1, result.document.getJSONArray("addictionTrackers").length())
    }

    @Test fun mapsNativeHabitSettingsAndRetainsUneditedWebFields() {
        val old = base()
        val localHabit = JSONObject().put("habits", JSONArray()).put("completions", JSONArray())
            .put("goals", JSONArray()).put("rewards", JSONArray())
            .put("achievementUnlocks", JSONArray()).put("streakFreezeTransactions", JSONArray())
            .put("quests", JSONArray()).put("progress", JSONObject().put("lifetimeXp", 11))
            .put("settings", JSONObject().put("enabled", false).put("reportRange", "month"))
            .put("hiddenDefaultTemplates", JSONArray().put("daily-plan"))
        val local = WorkspacePatch.localDocument(old, null, localHabit, null)
        val result = WorkspacePatch.apply(old, local, old, setOf("habits"), 8, stamp(), "android-test")
        assertEquals(11, result.document.getJSONObject("userProgress").getInt("lifetimeXp"))
        assertTrue(result.document.getJSONObject("userProgress").getBoolean("webOnly"))
        assertFalse(result.document.getJSONObject("habitSettings").getBoolean("enabled"))
        assertEquals("month", result.document.getJSONObject("habitSettings").getString("reportRange"))
        assertEquals("daily-plan", result.document.getJSONArray("hiddenDefaultTemplates").getString(0))
    }
}
