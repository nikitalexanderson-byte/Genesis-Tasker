package ru.genesis.calendar.auth

import java.util.Base64
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.CloudAccountImporter
import ru.genesis.calendar.data.HabitDocument
import ru.genesis.calendar.data.TrackersDocument
import ru.genesis.calendar.data.WorkspaceStructureCodec
import ru.genesis.calendar.security.WorkspaceCipher

class CloudAccountSnapshotTest {
    @Test fun keepsSpecificGoogleQuotaIssueWithoutBlockingAccountData() {
        val source = payload(null).put("syncWarning", "Исчерпана суточная квота проекта GENESIS для Google Tasks.")
        val snapshot = CloudAccountSnapshot.fromBootstrap(source)
        assertTrue(snapshot.googleSyncWarning)
        assertTrue(requireNotNull(snapshot.googleSyncIssue).contains("суточная квота"))
        assertEquals(1, snapshot.tasks.size)
    }
    private val key = ByteArray(32) { (it + 7).toByte() }

    private fun payload(document: JSONObject?, warning: Boolean = false): JSONObject {
        val workspace = JSONObject().put("keyMode", if (document == null) "new" else "account")
            .put("key", if (document == null) JSONObject.NULL else Base64.getEncoder().encodeToString(key))
        workspace.put("envelope", if (document == null) JSONObject.NULL else {
            val encrypted = WorkspaceCipher.encrypt(document.toString().toByteArray(), key)
            JSONObject().put("ciphertext", encrypted.ciphertext).put("iv", encrypted.iv).put("version", 3)
        })
        return JSONObject().put("user", JSONObject().put("uid", "user-1")
            .put("email", "account@example.test").put("displayName", "Test"))
            .put("workspace", workspace).put("tasks", JSONArray().put(JSONObject()
                .put("id", "google-1").put("title", "Existing task").put("dueDate", "2026-09-25")
                .put("webOnly", "retained")))
            .put("syncWarning", if (warning) "Google temporarily unavailable" else JSONObject.NULL)
    }

    private fun document(): JSONObject = JSONObject().put("trackerSchemaVersion", 16)
        .put("projects", JSONArray()).put("categories", JSONArray()).put("taskListLinks", JSONArray())
        .put("habits", JSONArray()).put("habitCompletions", JSONArray())
        .put("sleepPlans", JSONArray()).put("sleepEntries", JSONArray()).put("moodEntries", JSONArray())
        .put("dailyGoalRecords", JSONArray()).put("rewardTransactions", JSONArray())
        .put("userProgress", JSONObject()).put("unknownWebSection", JSONObject().put("keep", true))

    @Test fun decryptsAccountDocumentAndKeepsUnknownFields() {
        val snapshot = CloudAccountSnapshot.fromBootstrap(payload(document()))
        assertEquals(3, snapshot.version)
        assertEquals(40, snapshot.scope.length)
        assertTrue(snapshot.scope.startsWith("account-"))
        assertTrue(snapshot.document!!.getJSONObject("unknownWebSection").getBoolean("keep"))
        assertEquals("retained", snapshot.tasks.single().getString("webOnly"))
        val native = CloudAccountSnapshot.nativeTaskJson(snapshot.tasks.single())
        assertEquals("retained", native.getString("webOnly"))
        assertEquals(5, native.getInt("priority"))
        assertFalse(snapshot.googleSyncWarning)
    }

    @Test fun scopeIsStableButDistinctFromLocalAndOtherAccounts() {
        val first = CloudAccountSnapshot.scopeFor("user-1")
        assertEquals(first, CloudAccountSnapshot.scopeFor("user-1"))
        assertNotEquals(first, CloudAccountSnapshot.scopeFor("user-2"))
        assertNotEquals("internal-validation-v1", first)
    }

    @Test fun untitledGoogleCalendarEventDoesNotHideOtherAccountTasks() {
        val response = payload(null)
        response.getJSONArray("tasks").put(JSONObject().put("id", "untitled-google-event")
            .put("title", "").put("dueDate", "2026-09-25").put("googleEventId", "event-1"))
        val snapshot = CloudAccountSnapshot.fromBootstrap(response)
        assertEquals(2, snapshot.tasks.size)
        val event = CloudAccountSnapshot.nativeTaskJson(snapshot.tasks.last())
        assertEquals("Без названия", event.getString("title"))
        assertEquals("event-1", event.getString("googleEventId"))
        assertEquals("", response.getJSONArray("tasks").getJSONObject(1).getString("title"))
    }

    @Test fun missingAndNullGoogleFieldsUseNativeDisplayDefaultsWithoutChangingTheResponse() {
        for (title in listOf(null, JSONObject.NULL, "  ")) {
            val source = JSONObject().put("id", "google-event").put("title", title)
                .put("dueDate", JSONObject.NULL).put("time", JSONObject.NULL).put("zoneId", JSONObject.NULL)
            val normalized = CloudAccountSnapshot.nativeTaskJson(source)
            assertEquals("Без названия", normalized.getString("title"))
            assertEquals("", normalized.getString("dueDate"))
            assertEquals("", normalized.getString("time"))
            assertEquals(java.time.ZoneId.systemDefault().id, normalized.getString("zoneId"))
            assertTrue(source.isNull("dueDate"))
        }
    }

    @Test fun unreadableRowsAreReportedInsteadOfAbortingAccountSnapshot() {
        val response = payload(null)
        response.getJSONArray("tasks").put(JSONObject.NULL).put("invalid row")
        val snapshot = CloudAccountSnapshot.fromBootstrap(response)
        assertEquals(1, snapshot.tasks.size)
        assertEquals(2, snapshot.unreadableTaskCount)
        assertEquals("google-1", snapshot.tasks.single().getString("id"))
    }

    @Test fun warningAndMissingEnvelopeNeverInventRemoteDocument() {
        val snapshot = CloudAccountSnapshot.fromBootstrap(payload(null, warning = true))
        assertNull(snapshot.document)
        assertEquals(0, snapshot.version)
        assertTrue(snapshot.googleSyncWarning)
        val bad = payload(document())
        bad.getJSONObject("workspace").put("key", Base64.getEncoder().encodeToString(ByteArray(32)))
        assertThrows(Exception::class.java) { CloudAccountSnapshot.fromBootstrap(bad) }
    }

    @Test fun migratesLegacyWebWorkspaceBeforeNativeImport() {
        val legacy = JSONObject().put("trackerSchemaVersion", 3)
            .put("habits", JSONArray().put(JSONObject().put("id", "legacy-habit")
                .put("title", "Legacy rhythm").put("createdDate", "2026-09-01")
                .put("schedule", JSONObject().put("startDate", "2026-09-01")
                    .put("calendarMode", "profane").put("cadence", "daily"))
                .put("reminder", JSONObject().put("enabled", false))))
            .put("habitCompletions", JSONArray().put(JSONObject().put("id", "legacy-completion")
                .put("habitId", "legacy-habit").put("date", "2026-09-02").put("completed", true)))

        val snapshot = CloudAccountSnapshot.fromBootstrap(payload(legacy))
        val migrated = requireNotNull(snapshot.document)

        assertEquals(16, migrated.getInt("trackerSchemaVersion"))
        assertEquals(10, migrated.getJSONArray("habitCompletions").getJSONObject(0).getInt("xpAwarded"))
        assertEquals(10, migrated.getJSONObject("userProgress").getInt("lifetimeXp"))
        WorkspaceStructureCodec.decode(CloudAccountImporter.structureDocument(migrated))
        val habits = HabitDocument.decode(CloudAccountImporter.habitsDocument(migrated), snapshot.version)
        TrackersDocument.decode(CloudAccountImporter.trackersDocument(migrated), snapshot.version)
        assertEquals("legacy-habit", habits.habits.single().id)
        assertEquals("classic", habits.habits.single().schedule.recurrence.mode)
    }
}
