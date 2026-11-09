package ru.genesis.calendar

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.CloudWorkspaceSync
import ru.genesis.calendar.auth.CloudWorkspaceTransport
import ru.genesis.calendar.data.*
import ru.genesis.calendar.security.WorkspaceCipher

@RunWith(AndroidJUnit4::class)
class CloudAccountImporterTest {
    private val key = ByteArray(32) { (it + 9).toByte() }

    private fun response(taskTitle: String, projectTitle: String, warning: Boolean = false): JSONObject {
        val habits = JSONObject(HabitDocument.encode(LocalHabitWorkspace()))
        val trackers = JSONObject(TrackersDocument.encode(LocalTrackersWorkspace()))
        val structure = JSONObject(WorkspaceStructureCodec.encode(WorkspaceStructure(projects = listOf(
            GenesisProject("project-1", null, "work", projectTitle, "", emptyList(), "active", 0)))))
        val doc = JSONObject().put("trackerSchemaVersion", 16)
            .put("projects", structure.getJSONArray("projects"))
            .put("categories", structure.getJSONArray("categories"))
            .put("taskListLinks", structure.getJSONArray("taskListLinks"))
            .put("habits", habits.getJSONArray("habits"))
            .put("habitCompletions", habits.getJSONArray("completions"))
            .put("dailyGoalRecords", habits.getJSONArray("goals"))
            .put("rewardTransactions", habits.getJSONArray("rewards"))
            .put("achievementUnlocks", habits.getJSONArray("achievementUnlocks"))
            .put("streakFreezeTransactions", habits.getJSONArray("streakFreezeTransactions"))
            .put("quests", habits.getJSONArray("quests"))
            .put("userProgress", habits.getJSONObject("progress"))
            .put("sleepPlans", trackers.getJSONArray("sleepPlans"))
            .put("sleepEntries", trackers.getJSONArray("sleepEntries"))
            .put("moodEntries", trackers.getJSONArray("moodEntries"))
            .put("unknownWebSection", JSONObject().put("preserved", true))
        val encrypted = WorkspaceCipher.encrypt(doc.toString().toByteArray(), key)
        return JSONObject().put("user", JSONObject().put("uid", "synthetic-account")
            .put("email", "fixture@example.test").put("displayName", "Fixture"))
            .put("workspace", JSONObject().put("keyMode", "account")
                .put("key", Base64.getEncoder().encodeToString(key))
                .put("envelope", JSONObject().put("ciphertext", encrypted.ciphertext)
                    .put("iv", encrypted.iv).put("version", 5)))
            .put("tasks", JSONArray().put(JSONObject().put("id", "google-1")
                .put("title", taskTitle).put("dueDate", "2026-09-25")
                .put("projectId", "project-1").put("done", false)
                .put("webOnly", "preserved")))
            .put("syncWarning", if (warning) "Google unavailable" else JSONObject.NULL)
    }

    @Test fun importsOnlyAccountScopeAndRetainsPendingLocalChanges() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        try {
            val snapshot = CloudAccountSnapshot.fromBootstrap(response("Existing task", "Existing project"))
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db).import(snapshot))
            val dao = db.dao()
            assertNull(dao.task("internal-validation-v1", "google-1"))
            val record = requireNotNull(dao.task(snapshot.scope, "google-1"))
            val task = LocalTask.from(record, LocalCipher().decrypt(record.encrypted, "${snapshot.scope}/google-1"))
            assertEquals("Existing task", task.title)
            assertEquals("preserved", JSONObject(task.sourceFieldsJson).getString("webOnly"))
            val structure = requireNotNull(dao.document(snapshot.scope, "structure"))
            assertTrue(LocalCipher().decrypt(structure.encrypted, "${snapshot.scope}/structure").contains("Existing project"))
            val base = requireNotNull(dao.document(snapshot.scope, "cloud-base"))
            assertTrue(LocalCipher().decrypt(base.encrypted, "${snapshot.scope}/cloud-base").contains("unknownWebSection"))
            dao.putOutbox(OutboxRecord(snapshot.scope, "google-1", 6, "pending"))
            val changed = CloudAccountSnapshot.fromBootstrap(response("Remote changed", "Remote project"))
            assertEquals(CloudAccountImporter.Result.PENDING_LOCAL_CHANGES, CloudAccountImporter(db).import(changed))
            assertEquals(record, dao.task(snapshot.scope, "google-1"))
        } finally { db.close() }
    }

    @Test fun googleWarningDoesNotEraseCachedTasks() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        try {
            val first = CloudAccountSnapshot.fromBootstrap(response("Existing task", "First project"))
            CloudAccountImporter(db).import(first)
            val warning = CloudAccountSnapshot.fromBootstrap(response("Incomplete task list", "Updated project", true))
            assertEquals(CloudAccountImporter.Result.IMPORTED_WITH_GOOGLE_WARNING, CloudAccountImporter(db).import(warning))
            val record = requireNotNull(db.dao().task(first.scope, "google-1"))
            assertEquals("Existing task", LocalTask.from(record,
                LocalCipher().decrypt(record.encrypted, "${first.scope}/google-1")).title)
        } finally { db.close() }
    }

    @Test fun firstSignInImportsNamedAndUntitledTasksIntoTheCalendarWithoutExistingCache() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val payload = response("Existing website task", "Project")
            payload.getJSONArray("tasks").put(JSONObject().put("id", "untitled-event")
                .put("title", "").put("dueDate", "2026-09-25").put("googleEventId", "event-1"))
            val snapshot = CloudAccountSnapshot.fromBootstrap(payload)
            assertTrue(db.dao().accountTasks(snapshot.scope).isEmpty())
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db).import(snapshot))
            val cipher = LocalCipher()
            val tasks = db.dao().accountTasks(snapshot.scope).map {
                LocalTask.from(it, cipher.decrypt(it.encrypted, "${snapshot.scope}/${it.id}"))
            }
            assertEquals(setOf("Existing website task", "Без названия"), tasks.map { it.title }.toSet())
            val date = java.time.LocalDate.parse("2026-09-25")
            assertEquals(2, TaskOccurrences.byDate(tasks, date, date)[date.toString()]?.size)
            assertTrue(db.dao().accountTasks(CloudAccountSnapshot.scopeFor("another-account")).isEmpty())
            assertTrue(db.dao().outbox(snapshot.scope).isEmpty())
        } finally { db.close() }
    }

    @Test fun malformedRowsDoNotBlockValidTasksOrEraseCachedTasksAndPendingChanges() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val initial = CloudAccountSnapshot.fromBootstrap(response("Cached task", "Project"))
            CloudAccountImporter(db).import(initial)
            val original = requireNotNull(db.dao().task(initial.scope, "google-1"))
            db.dao().putOutbox(OutboxRecord(initial.scope, original.id, original.revision, "pending-edit"))
            val remote = response("Unused", "Project").put("tasks", JSONArray()
                .put(JSONObject().put("id", "new-task").put("title", "New website task").put("dueDate", "2026-09-25"))
                .put(JSONObject().put("id", "bad-date").put("title", "Bad date").put("dueDate", "not-a-date"))
                .put(JSONObject().put("title", "Missing id").put("dueDate", "2026-09-25"))
                .put(JSONObject.NULL))
            val snapshot = CloudAccountSnapshot.fromBootstrap(remote)
            assertEquals(CloudAccountImporter.Result.IMPORTED_WITH_TASK_WARNING, CloudAccountImporter(db).import(snapshot))
            assertEquals(original, db.dao().task(initial.scope, "google-1"))
            assertNotNull(db.dao().task(initial.scope, "new-task"))
            assertEquals(2, db.dao().accountTasks(initial.scope).size)
            assertEquals(1, db.dao().outbox(initial.scope).size)
            // Even an entirely unreadable response is not an authoritative empty list.
            remote.put("tasks", JSONArray().put(JSONObject.NULL))
            assertEquals(CloudAccountImporter.Result.IMPORTED_WITH_TASK_WARNING,
                CloudAccountImporter(db).import(CloudAccountSnapshot.fromBootstrap(remote)))
            assertEquals(2, db.dao().accountTasks(initial.scope).size)
        } finally { db.close() }
    }

    @Test fun invalidReminderMetadataCannotRollBackOtherTasks() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val payload = response("Valid task", "Project")
            payload.getJSONArray("tasks").put(JSONObject().put("id", "invalid-reminder")
                .put("title", "Invalid reminder").put("dueDate", "2026-09-25").put("time", "not-a-time")
                .put("reminders", JSONArray().put(JSONObject().put("kind", "relative").put("minutes", 10))))
            val snapshot = CloudAccountSnapshot.fromBootstrap(payload)
            assertEquals(CloudAccountImporter.Result.IMPORTED_WITH_TASK_WARNING, CloudAccountImporter(db).import(snapshot))
            assertNotNull(db.dao().task(snapshot.scope, "google-1"))
            assertNull(db.dao().task(snapshot.scope, "invalid-reminder"))
            assertTrue(db.dao().outbox(snapshot.scope).isEmpty())
        } finally { db.close() }
    }

    @Test fun all39TasksIncludingThreeLongAccountIdentifiersAreImportedOnFirstSignIn() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val rows = JSONArray()
            repeat(39) { index ->
                val id = if (index < 3) "account-0123456789-" + "x".repeat(98) + index.toString().padStart(2, '0')
                    else "ordinary-task-$index"
                rows.put(JSONObject().put("id", id).put("title", "Fixture task $index")
                    .put("dueDate", "2026-09-28").put("done", index >= 7))
            }
            val snapshot = CloudAccountSnapshot.fromBootstrap(response("Unused", "Project").put("tasks", rows))
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db).import(snapshot))
            val records = db.dao().accountTasks(snapshot.scope)
            assertEquals(39, records.size)
            assertEquals(7, records.count { !it.done })
            assertEquals(3, records.count { it.id.length == 119 })
            assertTrue(db.dao().outbox(snapshot.scope).isEmpty())
        } finally { db.close() }
    }

    @Test fun redactedServerTaskShapesImportCompletelyWhenProvided() = runBlocking {
        org.junit.Assume.assumeTrue(androidx.test.platform.app.InstrumentationRegistry.getArguments()
            .getString("redactedTaskFixture") == "true")
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val fixture = JSONObject(java.io.File(context.getExternalFilesDir(null), "task-shape.json").readText())
        val db = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        try {
            val snapshot = CloudAccountSnapshot.fromBootstrap(response("Unused", "Project")
                .put("tasks", fixture.getJSONArray("tasks")))
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db).import(snapshot))
            assertEquals(fixture.getJSONObject("report").getInt("totalRows"), db.dao().accountTasks(snapshot.scope).size)
            assertTrue(db.dao().outbox(snapshot.scope).isEmpty())
        } finally { db.close() }
    }

    @Test fun importedWebRemindersAreScheduledAndRefreshedWithoutLocalOutbox() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        try {
            val first = response("Reminder task", "Project")
            first.getJSONArray("tasks").getJSONObject(0).put("time", "12:00")
                .put("zoneId", "UTC").put("reminders", JSONArray()
                    .put(JSONObject().put("kind", "relative").put("minutes", 10))
                    .put(JSONObject().put("kind", "relative").put("minutes", 60)))
            first.getJSONArray("tasks").put(JSONObject().put("id", "undated-google-task")
                .put("title", "Undated inbox task").put("dueDate", "")
                .put("reminders", JSONArray().put(JSONObject().put("kind", "relative").put("minutes", 30))))
            val snapshot = CloudAccountSnapshot.fromBootstrap(first)
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db).import(snapshot))
            val reminders = db.dao().taskReminders(snapshot.scope, "google-1")
            assertEquals(2, reminders.size)
            assertNotNull(db.dao().task(snapshot.scope, "undated-google-task"))
            assertTrue(db.dao().taskReminders(snapshot.scope, "undated-google-task").isEmpty())
            assertEquals(0, db.dao().outbox(snapshot.scope).size)
            val changed = response("Reminder task", "Project")
            assertEquals(CloudAccountImporter.Result.IMPORTED,
                CloudAccountImporter(db).import(CloudAccountSnapshot.fromBootstrap(changed)))
            assertTrue(db.dao().taskReminders(snapshot.scope, "google-1").isEmpty())
        } finally { db.close() }
    }

    @Test fun twoDevicesReceiveRemoteTasksWhileOneHasUnsentEdits() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val firstDevice = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        val secondDevice = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        try {
            val initial = CloudAccountSnapshot.fromBootstrap(response("Initial task", "Initial project"))
            CloudAccountImporter(firstDevice).import(initial)
            CloudAccountImporter(secondDevice).import(initial)
            val original = requireNotNull(firstDevice.dao().task(initial.scope, "google-1"))
            firstDevice.dao().putOutbox(OutboxRecord(initial.scope, "google-1", original.revision, "phone-edit"))
            val remote = response("Changed on another device", "Updated project")
            remote.getJSONArray("tasks").put(JSONObject().put("id", "google-2")
                .put("title", "New task from another device").put("dueDate", ""))
            val snapshot = CloudAccountSnapshot.fromBootstrap(remote)
            assertEquals(CloudAccountImporter.Result.PENDING_LOCAL_CHANGES, CloudAccountImporter(firstDevice).import(snapshot))
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(secondDevice).import(snapshot))
            assertEquals(original, firstDevice.dao().task(initial.scope, "google-1"))
            listOf(firstDevice, secondDevice).forEach { db ->
                assertNotNull(db.dao().task(initial.scope, "google-2"))
                val structure = requireNotNull(db.dao().document(initial.scope, "structure"))
                assertTrue(LocalCipher().decrypt(structure.encrypted, "${initial.scope}/structure").contains("Updated project"))
            }
            assertEquals(1, firstDevice.dao().outbox(initial.scope).size)
            assertTrue(secondDevice.dao().outbox(initial.scope).isEmpty())
        } finally { firstDevice.close(); secondDevice.close() }
    }

    @Test fun deferredGoogleLoadOpensAccountWithoutErasingTasksAndPartialLoadAddsNewRows() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        try {
            val initial = CloudAccountSnapshot.fromBootstrap(response("Cached task", "Project"))
            CloudAccountImporter(db).import(initial)
            val deferred = response("Unused", "Workspace available immediately")
                .put("tasks", JSONArray()).put("tasksDeferred", true)
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db)
                .import(CloudAccountSnapshot.fromBootstrap(deferred)))
            assertNotNull(db.dao().task(initial.scope, "google-1"))
            val partial = response("Unavailable", "Project", true)
            partial.put("tasks", JSONArray().put(JSONObject().put("id", "google-2")
                .put("title", "Available service task").put("dueDate", "")))
            assertEquals(CloudAccountImporter.Result.IMPORTED_WITH_GOOGLE_WARNING, CloudAccountImporter(db)
                .import(CloudAccountSnapshot.fromBootstrap(partial)))
            assertNotNull(db.dao().task(initial.scope, "google-1"))
            assertNotNull(db.dao().task(initial.scope, "google-2"))
        } finally { db.close() }
    }

    @Test fun webAccountWithIncompleteSleepRecordsImportsAndSyncsWithoutLosingData() = runBlocking {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val db = Room.inMemoryDatabaseBuilder(context, GenesisDatabase::class.java).build()
        try {
            val payload = response("Google task", "Cloud project")
            val envelope = payload.getJSONObject("workspace").getJSONObject("envelope")
            val document = JSONObject(WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(
                envelope.getString("ciphertext"), envelope.getString("iv")), key).toString(Charsets.UTF_8))
            fun sleep(id: String, bed: String, wake: String) = JSONObject()
                .put("id", id).put("createdAt", "2026-09-20T12:00:00Z").put("updatedAt", "2026-09-20T12:00:00Z")
                .put("version", 1).put("syncState", "synced").put("planId", "sleep-plan")
                .put("date", "2026-09-20").put("fellAsleepAt", bed).put("wokeAt", wake)
                .put("durationMinutes", 0).put("quality", 7).put("deviationMinutes", 0)
                .put("note", "Keep the web note").put("score", 0).put("webOnly", true)
            document.put("sleepEntries", JSONArray().put(sleep("quality-only", "", ""))
                .put(sleep("bed-only", "23:00", "")).put(sleep("wake-only", "", "07:00")))
            var remote = document
            var version = 1_000_000_199L
            fun workspace(): JSONObject {
                val encrypted = WorkspaceCipher.encrypt(remote.toString().toByteArray(), key)
                return JSONObject().put("keyMode", "account").put("key", Base64.getEncoder().encodeToString(key))
                    .put("envelope", JSONObject().put("ciphertext", encrypted.ciphertext)
                        .put("iv", encrypted.iv).put("version", version))
            }
            payload.put("workspace", workspace())
            val snapshot = CloudAccountSnapshot.fromBootstrap(payload)
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db).import(snapshot))
            val cipher = LocalCipher()
            val row = requireNotNull(db.dao().document(snapshot.scope, "trackers"))
            val loaded = TrackersDocument.decode(cipher.decrypt(row.encrypted, "${snapshot.scope}/trackers"), row.revision)
            assertEquals(3, loaded.sleepEntries.size)
            assertNull(loaded.sleepEntries.first().fellAsleepAt)
            assertEquals(7, loaded.sleepEntries.first().quality)
            assertNotNull(db.dao().task(snapshot.scope, "google-1"))
            assertTrue(db.dao().outbox(snapshot.scope).isEmpty())
            assertNull(db.dao().document(CloudAccountSnapshot.scopeFor("another-account"), "trackers"))

            val edited = loaded.copy(sleepEntries = loaded.sleepEntries.mapIndexed { i, value ->
                if (i == 0) value.copy(note = "Android note") else value
            })
            db.dao().putDocument(DocumentRecord(snapshot.scope, "trackers",
                cipher.encrypt(TrackersDocument.encode(edited), "${snapshot.scope}/trackers"), version + 1))
            db.dao().putOutbox(OutboxRecord(snapshot.scope, "trackers", version + 1, "edit-sleep-note"))
            val transport = object : CloudWorkspaceTransport {
                override fun get() = JSONObject().put("workspace", workspace())
                override fun put(body: JSONObject): JSONObject {
                    assertEquals(version, body.getLong("expectedVersion"))
                    remote = JSONObject(WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(
                        body.getString("ciphertext"), body.getString("iv")), key).toString(Charsets.UTF_8))
                    version++
                    return JSONObject().put("workspace", JSONObject().put("version", version))
                }
            }
            assertEquals(1, CloudWorkspaceSync(db, transport).flush(snapshot.scope))
            assertTrue(db.dao().outbox(snapshot.scope).isEmpty())
            assertEquals(3, remote.getJSONArray("sleepEntries").length())
            val saved = remote.getJSONArray("sleepEntries").getJSONObject(0)
            assertEquals("Android note", saved.getString("note"))
            assertEquals("", saved.getString("fellAsleepAt"))
            assertTrue(saved.getBoolean("webOnly"))
            assertTrue(remote.getJSONObject("unknownWebSection").getBoolean("preserved"))
            assertEquals(CloudAccountImporter.Result.IMPORTED, CloudAccountImporter(db)
                .import(CloudAccountSnapshot.fromBootstrap(payload.put("workspace", workspace()))))
        } finally { db.close() }
    }
    @Test fun acknowledgedDeletionSurvivesAnOlderCloudResponse() = runBlocking {
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val initial = CloudAccountSnapshot.fromBootstrap(response("Cached task", "Project"))
            val importer = CloudAccountImporter(db)
            importer.import(initial)
            val cached = requireNotNull(db.dao().task(initial.scope, "google-1"))
            db.dao().putTask(cached.copy(deleted = true))
            db.dao().deleteTaskReminders(initial.scope, "google-1")
            // DELETE has already been acknowledged, so there is no outbox entry.
            importer.import(initial)
            assertTrue(requireNotNull(db.dao().task(initial.scope, "google-1")).deleted)
            assertTrue(db.dao().reminders(initial.scope).none { it.taskId == "google-1" })
        } finally { db.close() }
    }

}
