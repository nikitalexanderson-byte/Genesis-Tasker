package ru.genesis.calendar

import androidx.room.Room
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import java.util.Base64
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.CloudWorkspaceSync
import ru.genesis.calendar.auth.CloudWorkspaceTransport
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.auth.WorkspacePatch
import ru.genesis.calendar.data.*
import ru.genesis.calendar.security.WorkspaceCipher

@RunWith(AndroidJUnit4::class)
class CloudWorkspaceSyncTest {
    @Test fun protocolEightRulesRemainLocalUntilTheServerExplicitlySupportsThem() = protocolUpgrade(8)

    @Test fun timerPreferencesRemainLocalUntilProtocolNineAndRoundTripIntact() = protocolUpgrade(9)

    private fun protocolUpgrade(required: Int) = runBlocking {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val source=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().context.assets.open("web-interval-sync.json")
            .bufferedReader().use { JSONObject(it.readText()) }
        val local=JSONObject(source.toString())
        local.getJSONArray("habits").getJSONObject(0).put("autoDeletePolicy",JSONObject().put("version",1)
            .put("id","31400000-0000-4000-8000-000000000001").put("count",3).put("unit","days").put("points","keep").put("startOn","2026-11-01"))
        val preferences=JSONObject().put("modes",org.json.JSONArray().put("pomodoro"))
            .put("workMinutes",40).put("breakMinutes",8).put("progress","time-only")
        if(required==9) local.getJSONArray("habits").getJSONObject(0).put("timerPreferences",preferences)
        val workspace=HabitDocument.decode(CloudAccountImporter.habitsDocument(local),2)
        val scope=CloudAccountSnapshot.scopeFor("synthetic-server-capability-314")
        val key=ByteArray(32) { (it+3).toByte() };val cipher=LocalCipher()
        val db=Room.inMemoryDatabaseBuilder(context,GenesisDatabase::class.java).build()
        try {
            db.dao().putDocument(DocumentRecord(scope,"cloud-base",cipher.encrypt(source.toString(),"$scope/cloud-base"),1))
            val encrypted=DocumentRecord(scope,"habits",cipher.encrypt(HabitDocument.encode(workspace),"$scope/habits"),2)
            db.dao().putDocument(encrypted);db.dao().putOutbox(OutboxRecord(scope,"habits",2,"preview-before-server-deploy"))
            val pending=db.dao().outbox(scope);var supported=required-1;var writes=0
            val transport=object:CloudWorkspaceTransport {
                override fun get():JSONObject {
                    val payload=WorkspaceCipher.encrypt(source.toString().toByteArray(),key)
                    val server=JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(key))
                        .put("envelope",JSONObject().put("version",1).put("ciphertext",payload.ciphertext).put("iv",payload.iv))
                    if(supported>=8) server.put("supportedWriterProtocol",supported)
                    return JSONObject().put("workspace",server)
                }
                override fun put(body:JSONObject):JSONObject {
                    writes++;assertEquals(required,body.getInt("writerProtocol"));assertEquals(required,body.getInt("minimumWriterProtocol"))
                    if(required==9) {
                        val plain=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"),body.getString("iv")),key)
                        val uploaded=try { JSONObject(plain.toString(Charsets.UTF_8)) } finally { plain.fill(0) }
                        assertEquals(preferences.toString(),uploaded.getJSONArray("habits").getJSONObject(0).getJSONObject("timerPreferences").toString())
                    }
                    return JSONObject().put("workspace",JSONObject().put("version",2))
                }
            }
            val error=assertThrows(IllegalArgumentException::class.java) { runBlocking { CloudWorkspaceSync(db,transport).flush(scope) } }
            assertEquals("WORKSPACE_UPGRADE_REQUIRED",error.message);assertEquals(0,writes)
            assertEquals(encrypted,db.dao().document(scope,"habits"));assertEquals(pending,db.dao().outbox(scope))
            supported=required;assertEquals(1,CloudWorkspaceSync(db,transport).flush(scope));assertEquals(1,writes);assertTrue(db.dao().outbox(scope).isEmpty())
        } finally { key.fill(0);db.close() }
    }
    @Test fun intervalHabitFromWebRoundTripsThroughNativeOutbox() = intervalRoundTrip(false)

    @Test fun independentDailyRecalculationDoesNotBlockIntervalMarks() = intervalRoundTrip(true)

    @Test fun actualNativeGoalAndQuestRecalculationRoundTripsWebIntervals() = intervalRoundTrip(false, true)

    private fun intervalRoundTrip(concurrentRecalculation: Boolean, nativeRecalculation: Boolean = false) = runBlocking {
        val context=ApplicationProvider.getApplicationContext<android.content.Context>()
        val source=androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().context.assets
            .open("web-interval-sync.json").bufferedReader().use { JSONObject(it.readText()) }
        val scope=CloudAccountSnapshot.scopeFor("synthetic-interval-sync-$concurrentRecalculation")
        val key=ByteArray(32) { (it+11).toByte() }
        val cipher=LocalCipher()
        val version=1_000_000_513L
        val db=Room.inMemoryDatabaseBuilder(context,GenesisDatabase::class.java).build()
        try {
            val workspace=HabitDocument.decode(CloudAccountImporter.habitsDocument(source),version)
            val date=java.time.LocalDate.parse("2026-10-19")
            val engine=ru.genesis.calendar.domain.habits.HabitEngine(ru.genesis.calendar.domain.GenesisCalendar(java.time.ZoneId.of("Europe/Moscow")))
            var local=workspace.copy(completions=engine.updateIntervalCompletion(workspace.completions,
                workspace.habits.first(),date,date,"12:30",true))
            if(nativeRecalculation) local=ru.genesis.calendar.data.reconcileHabitWorkspace(local,date,"Europe/Moscow","2026-10-19T12:00:00Z")
            val remote=JSONObject(source.toString())
            if(concurrentRecalculation) {
                local=local.copy(progress=local.progress.copy(updatedAt="2026-10-19T12:00:00Z"),
                    goals=local.goals.map { if(it.date==date) it.copy(updatedAt="2026-10-19T12:00:00Z") else it })
                remote.getJSONObject("userProgress").put("updatedAt","2026-10-19T12:00:01Z")
                val goals=remote.getJSONArray("dailyGoalRecords")
                for(index in 0 until goals.length()) if(goals.getJSONObject(index).getString("date")==date.toString())
                    goals.getJSONObject(index).put("updatedAt","2026-10-19T12:00:01Z")
            }
            db.dao().putDocument(DocumentRecord(scope,"cloud-base",cipher.encrypt(source.toString(),"$scope/cloud-base"),version))
            db.dao().putDocument(DocumentRecord(scope,"habits",cipher.encrypt(HabitDocument.encode(local),"$scope/habits"),version+1))
            db.dao().putOutbox(OutboxRecord(scope,"habits",version+1,"synthetic-interval-operation"))
            var uploaded:JSONObject?=null
            val transport=object:CloudWorkspaceTransport {
                override fun get():JSONObject {
                    val envelope=WorkspaceCipher.encrypt(remote.toString().toByteArray(),key)
                    return JSONObject().put("workspace",JSONObject().put("keyMode","account")
                        .put("key",Base64.getEncoder().encodeToString(key)).put("envelope",JSONObject()
                            .put("version",version).put("ciphertext",envelope.ciphertext).put("iv",envelope.iv)))
                }
                override fun put(body:JSONObject):JSONObject {
                    assertEquals(version,body.getLong("expectedVersion"))
                    val bytes=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"),body.getString("iv")),key)
                    uploaded=try { JSONObject(bytes.toString(Charsets.UTF_8)) } finally { bytes.fill(0) }
                    return JSONObject().put("workspace",JSONObject().put("version",version+1))
                }
            }
            assertEquals(1,CloudWorkspaceSync(db,transport).flush(scope))
            assertTrue(db.dao().outbox(scope).isEmpty())
            val confirmed=HabitDocument.decode(CloudAccountImporter.habitsDocument(requireNotNull(uploaded)),version+1)
            assertEquals(listOf("11:00","12:30"),confirmed.completions.first { it.habitId==workspace.habits.first().id&&it.date==date }.completedTimes)
            if(!nativeRecalculation) assertEquals(workspace.rewards,confirmed.rewards)
            assertEquals(confirmed.rewards.size,confirmed.rewards.map { it.idempotencyKey }.distinct().size)
            assertEquals(workspace.habits.size,confirmed.habits.size)
            assertTrue(uploaded!!.getJSONObject("unknownWebSection").getBoolean("keep"))
        } finally { key.fill(0);db.close() }
    }

    @Test fun olderEncryptedWorkspaceCanSyncAnAndroidEdit() = runBlocking {
      for (schema in listOf(0, 15)) {
        val scope = CloudAccountSnapshot.scopeFor("synthetic-legacy-sync-$schema")
        val key = ByteArray(32) { (it + 9).toByte() }
        val cipher = LocalCipher()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val remote = (if (schema == 0) JSONObject().put("projects", org.json.JSONArray())
                .put("categories", org.json.JSONArray())
                else WorkspacePatch.emptyDocument().put("trackerSchemaVersion", schema))
                .put("unknownWebSection", JSONObject().put("preserved", true))
            val base = ru.genesis.calendar.auth.CloudWorkspaceMigration.normalize(remote)
            val structure = WorkspaceStructureCodec.encode(WorkspaceStructure(projects = listOf(
                GenesisProject("p1", null, "work", "Phone project", "", emptyList(), "active", 0))))
            db.dao().putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(base.toString(), "$scope/cloud-base"), 4))
            db.dao().putDocument(DocumentRecord(scope, "structure", cipher.encrypt(structure, "$scope/structure"), 5))
            db.dao().putOutbox(OutboxRecord(scope, "workspace-structure", 5, "legacy-edit"))
            val transport = object : CloudWorkspaceTransport {
                override fun get(): JSONObject {
                    val envelope = WorkspaceCipher.encrypt(remote.toString().toByteArray(), key)
                    return JSONObject().put("workspace", JSONObject().put("keyMode", "account")
                        .put("key", Base64.getEncoder().encodeToString(key))
                        .put("envelope", JSONObject().put("version", 4)
                            .put("ciphertext", envelope.ciphertext).put("iv", envelope.iv)))
                }
                override fun put(body: JSONObject): JSONObject {
                    assertEquals(4L, body.getLong("expectedVersion"))
                    val plain = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"), body.getString("iv")), key)
                    val saved = JSONObject(plain.toString(Charsets.UTF_8))
                    plain.fill(0)
                    assertEquals(16, saved.getInt("trackerSchemaVersion"))
                    assertEquals("Phone project", saved.getJSONArray("projects").getJSONObject(0).getString("title"))
                    assertTrue(saved.getJSONObject("unknownWebSection").getBoolean("preserved"))
                    return JSONObject().put("workspace", JSONObject().put("version", 5))
                }
            }
            assertEquals(1, CloudWorkspaceSync(db, transport).flush(scope))
            assertTrue(db.dao().outbox(scope).isEmpty())
        } finally { db.close() }
      }
    }

    @Test fun encryptsCasPatchWithoutLosingWebOnlySections() = runBlocking {
        val scope = CloudAccountSnapshot.scopeFor("synthetic-workspace-account")
        val key = ByteArray(32) { (it + 1).toByte() }
        val cipher = LocalCipher()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val base = WorkspacePatch.emptyDocument().put("webOnly", JSONObject().put("preserve", true))
            val original = WorkspaceCipher.encrypt(base.toString().toByteArray(), key)
            val project = GenesisProject("p1", null, "work", "Native project", "", emptyList(), "active", 0)
            val structure = WorkspaceStructureCodec.encode(WorkspaceStructure(projects = listOf(project)))
            db.dao().putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(base.toString(), "$scope/cloud-base"), 5))
            db.dao().putDocument(DocumentRecord(scope, "structure", cipher.encrypt(structure, "$scope/structure"), 6))
            db.dao().putOutbox(OutboxRecord(scope, "workspace-structure", 6, "op-structure"))
            var received: JSONObject? = null
            val transport = object : CloudWorkspaceTransport {
                override fun get(): JSONObject = JSONObject().put("workspace", JSONObject()
                    .put("keyMode", "account").put("key", Base64.getEncoder().encodeToString(key))
                    .put("envelope", JSONObject().put("ciphertext", original.ciphertext)
                        .put("iv", original.iv).put("version", 5)))
                override fun put(body: JSONObject): JSONObject {
                    assertEquals(5, body.getLong("expectedVersion"))
                    assertFalse(body.has("metrics"))
                    val bytes = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"),
                        body.getString("iv")), key)
                    received = JSONObject(bytes.toString(Charsets.UTF_8))
                    bytes.fill(0)
                    return JSONObject().put("workspace", JSONObject().put("version", 6))
                }
            }
            assertEquals(1, CloudWorkspaceSync(db, transport).flush(scope))
            assertTrue(db.dao().outbox(scope).isEmpty())
            assertTrue(received!!.getJSONObject("webOnly").getBoolean("preserve"))
            assertEquals("Native project", received!!.getJSONArray("projects").getJSONObject(0).getString("title"))
            assertEquals(6L, db.dao().document(scope, "cloud-base")?.revision)
        } finally { db.close() }
    }

    @Test fun retriesCasConflictAndPreservesUnrelatedRemoteChange() = runBlocking {
        val scope = CloudAccountSnapshot.scopeFor("synthetic-cas-retry")
        val key = ByteArray(32) { (it + 3).toByte() }
        val cipher = LocalCipher()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val base = WorkspacePatch.emptyDocument().put("webOnly", "before")
            val structure = WorkspaceStructureCodec.encode(WorkspaceStructure(projects = listOf(
                GenesisProject("p1", null, "work", "Android edit", "", emptyList(), "active", 0))))
            db.dao().putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(base.toString(), "$scope/cloud-base"), 1))
            db.dao().putDocument(DocumentRecord(scope, "structure", cipher.encrypt(structure, "$scope/structure"), 2))
            db.dao().putOutbox(OutboxRecord(scope, "workspace-structure", 2, "op-retry"))
            var version = 1L
            var remote = base
            var writes = 0
            val transport = object : CloudWorkspaceTransport {
                override fun get(): JSONObject {
                    val envelope = WorkspaceCipher.encrypt(remote.toString().toByteArray(), key)
                    return JSONObject().put("workspace", JSONObject().put("keyMode", "account")
                        .put("key", Base64.getEncoder().encodeToString(key))
                        .put("envelope", JSONObject().put("ciphertext", envelope.ciphertext)
                            .put("iv", envelope.iv).put("version", version)))
                }
                override fun put(body: JSONObject): JSONObject {
                    writes++
                    if (writes == 1) {
                        remote = JSONObject(base.toString()).put("webOnly", "web concurrent edit")
                        version++
                        throw AuthFailure(AuthFailure.Kind.CONFLICT)
                    }
                    assertEquals(version, body.getLong("expectedVersion"))
                    val plain = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"),
                        body.getString("iv")), key)
                    remote = JSONObject(plain.toString(Charsets.UTF_8))
                    plain.fill(0)
                    version++
                    return JSONObject().put("workspace", JSONObject().put("version", version))
                }
            }
            assertEquals(1, CloudWorkspaceSync(db, transport).flush(scope))
            assertEquals(2, writes)
            assertEquals("web concurrent edit", remote.getString("webOnly"))
            assertEquals("Android edit", remote.getJSONArray("projects").getJSONObject(0).getString("title"))
            assertTrue(db.dao().outbox(scope).isEmpty())
            assertEquals(version, db.dao().document(scope, "cloud-base")?.revision)
        } finally { db.close() }
    }

    @Test fun sameFieldConflictRetainsEncryptedLocalDraftAndOutbox() = runBlocking {
        val scope = CloudAccountSnapshot.scopeFor("synthetic-same-field-conflict")
        val key = ByteArray(32) { (it + 4).toByte() }
        val cipher = LocalCipher()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val base = WorkspacePatch.emptyDocument().put("projects", org.json.JSONArray().put(
                JSONObject().put("id", "p1").put("title", "Original")))
            val remote = JSONObject(base.toString()).put("projects", org.json.JSONArray().put(
                JSONObject().put("id", "p1").put("title", "Web edit")))
            val structure = WorkspaceStructureCodec.encode(WorkspaceStructure(projects = listOf(
                GenesisProject("p1", null, "work", "Android edit", "", emptyList(), "active", 0))))
            db.dao().putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(base.toString(), "$scope/cloud-base"), 1))
            db.dao().putDocument(DocumentRecord(scope, "structure", cipher.encrypt(structure, "$scope/structure"), 2))
            db.dao().putOutbox(OutboxRecord(scope, "workspace-structure", 2, "op-conflict"))
            var confirmed: JSONObject? = null
            val transport = object : CloudWorkspaceTransport {
                override fun get(): JSONObject {
                    val envelope = WorkspaceCipher.encrypt(remote.toString().toByteArray(), key)
                    return JSONObject().put("workspace", JSONObject().put("keyMode", "account")
                        .put("key", Base64.getEncoder().encodeToString(key))
                        .put("envelope", JSONObject().put("ciphertext", envelope.ciphertext)
                            .put("iv", envelope.iv).put("version", 2)))
                }
                override fun put(body: JSONObject): JSONObject {
                    assertEquals(2, body.getInt("expectedVersion"))
                    val plain = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"),
                        body.getString("iv")), key)
                    confirmed = JSONObject(plain.toString(Charsets.UTF_8))
                    plain.fill(0)
                    return JSONObject().put("workspace", JSONObject().put("version", 3))
                }
            }
            val conflict = assertThrows(WorkspacePatch.Conflict::class.java) {
                runBlocking { CloudWorkspaceSync(db, transport).flush(scope) }
            }
            assertEquals(1, db.dao().outbox(scope).size)
            val encrypted = requireNotNull(db.dao().document(scope, "structure"))
            assertFalse(encrypted.encrypted.contains("Android edit"))
            assertEquals("Android edit", WorkspaceStructureCodec.decode(cipher.decrypt(encrypted.encrypted,
                "$scope/structure")).projects.single().title)
            val outbox = db.dao().outbox(scope)
            assertEquals("\"Android edit\"", conflict.preview!!.fields.single().localJson)
            assertEquals("\"Web edit\"", conflict.preview!!.fields.single().remoteJson)
            // A newer website edit invalidates the exact comparison. No local or remote writes.
            remote.getJSONArray("projects").getJSONObject(0).put("title", "New website edit")
            remote.put("unknownWebSection", JSONObject().put("preserved", true))
            val refreshed = assertThrows(WorkspacePatch.Conflict::class.java) {
                runBlocking { CloudWorkspaceSync(db, transport).flush(scope,
                    WorkspacePatch.ConflictPolicy.KEEP_LOCAL, conflict.preview!!.fingerprint) }
            }
            assertNull(confirmed)
            assertEquals(encrypted, db.dao().document(scope, "structure"))
            assertEquals(outbox, db.dao().outbox(scope))
            assertNotEquals(conflict.preview!!.fingerprint, refreshed.preview!!.fingerprint)
            // An unreviewed choice cannot bypass this guard either.
            assertThrows(WorkspacePatch.Conflict::class.java) {
                runBlocking { CloudWorkspaceSync(db, transport).flush(scope, WorkspacePatch.ConflictPolicy.KEEP_LOCAL) }
            }
            assertEquals(1, CloudWorkspaceSync(db, transport).flush(scope,
                WorkspacePatch.ConflictPolicy.KEEP_LOCAL, refreshed.preview!!.fingerprint))
            assertEquals("Android edit", confirmed!!.getJSONArray("projects").getJSONObject(0).getString("title"))
            assertTrue(confirmed!!.getJSONObject("unknownWebSection").getBoolean("preserved"))
            assertTrue(db.dao().outbox(scope).isEmpty())
            assertEquals(0, CloudWorkspaceSync(db, transport).flush(scope,
                WorkspacePatch.ConflictPolicy.KEEP_LOCAL, refreshed.preview!!.fingerprint))
        } finally { db.close() }
    }

    @Test fun keepRemoteConflictRefreshesLocalCopyWithoutOverwritingChosenField() = runBlocking {
        val scope = CloudAccountSnapshot.scopeFor("synthetic-keep-remote")
        val key = ByteArray(32) { (it + 7).toByte() }
        val cipher = LocalCipher()
        val db = Room.inMemoryDatabaseBuilder(ApplicationProvider.getApplicationContext(), GenesisDatabase::class.java).build()
        try {
            val base = WorkspacePatch.emptyDocument().put("projects", org.json.JSONArray().put(
                JSONObject().put("id", "p1").put("title", "Original")))
            val remote = JSONObject(base.toString()).put("projects", org.json.JSONArray().put(
                JSONObject().put("id", "p1").put("title", "Website choice")))
            val structure = WorkspaceStructureCodec.encode(WorkspaceStructure(projects = listOf(
                GenesisProject("p1", null, "work", "Phone choice", "", emptyList(), "active", 0))))
            db.dao().putDocument(DocumentRecord(scope, "cloud-base", cipher.encrypt(base.toString(), "$scope/cloud-base"), 1))
            db.dao().putDocument(DocumentRecord(scope, "structure", cipher.encrypt(structure, "$scope/structure"), 2))
            db.dao().putOutbox(OutboxRecord(scope, "workspace-structure", 2, "op-keep-remote"))
            val transport = object : CloudWorkspaceTransport {
                override fun get(): JSONObject {
                    val envelope = WorkspaceCipher.encrypt(remote.toString().toByteArray(), key)
                    return JSONObject().put("workspace", JSONObject().put("keyMode", "account")
                        .put("key", Base64.getEncoder().encodeToString(key))
                        .put("envelope", JSONObject().put("ciphertext", envelope.ciphertext)
                            .put("iv", envelope.iv).put("version", 2)))
                }
                override fun put(body: JSONObject): JSONObject {
                    val plain = WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(body.getString("ciphertext"),
                        body.getString("iv")), key)
                    val merged = JSONObject(plain.toString(Charsets.UTF_8))
                    plain.fill(0)
                    assertEquals("Website choice", merged.getJSONArray("projects").getJSONObject(0).getString("title"))
                    return JSONObject().put("workspace", JSONObject().put("version", 3))
                }
            }
            val conflict = assertThrows(WorkspacePatch.Conflict::class.java) {
                runBlocking { CloudWorkspaceSync(db, transport).flush(scope) }
            }
            assertEquals(1, CloudWorkspaceSync(db, transport).flush(scope,
                WorkspacePatch.ConflictPolicy.KEEP_REMOTE, conflict.preview!!.fingerprint))
            assertTrue(db.dao().outbox(scope).isEmpty())
            val saved = requireNotNull(db.dao().document(scope, "structure"))
            assertEquals("Website choice", WorkspaceStructureCodec.decode(cipher.decrypt(saved.encrypted,
                "$scope/structure")).projects.single().title)
            assertEquals(3L, db.dao().document(scope, "cloud-base")?.revision)
        } finally { db.close() }
    }
}
