package ru.genesis.calendar.data

import androidx.room.Room
import androidx.room.withTransaction
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.security.*
import java.security.KeyStore
import java.util.Base64
import java.util.UUID

/** Real Room + AndroidKeyStore data-source acceptance. Only a fresh per-test key
 * alias and a unique synthetic QA database are created/deleted. */
@RunWith(AndroidJUnit4::class)
class E2eeWorkspaceRoomSourceTest {
    @Test fun actualRoomCaptureIsPortableAndInvalidatedLegacyKeysNeverCreateAnEmptyReplacement() = runBlocking {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val id=UUID.randomUUID().toString();val name="qa-e2ee-workspace-$id.db";val alias="genesis.e2ee.qa.$id"
        val store=KeyStore.getInstance("AndroidKeyStore").apply { load(null) };assertFalse(store.containsAlias(alias))
        val room=Room.databaseBuilder(context,GenesisDatabase::class.java,name).build()
        val owner="synthetic-room-source";val scope=CloudAccountSnapshot.scopeFor(owner);val remote="personal:$owner";val cipher=LocalCipher(alias)
        val old=WorkspacePatch.emptyDocument();val local=JSONObject().put("projects",JSONArray().put(JSONObject().put("id","offline-project").put("title","Synthetic private offline project")))
            .put("categories",JSONArray()).put("taskListLinks",JSONArray()).put("taskLists",JSONArray())
        try {
            val base=DocumentRecord(scope,"cloud-base",cipher.encrypt(old.toString(),"$scope/cloud-base"),1)
            val structure=DocumentRecord(scope,"structure",cipher.encrypt(local.toString(),"$scope/structure"),2)
            room.dao().putDocument(base);room.dao().putDocument(structure);room.dao().putOutbox(OutboxRecord(scope,"workspace-structure",2,"original-operation"))
            var calls=0;var captured=false
            val raw=E2eeKeys.freshSecret();val envelope=WorkspaceCipher.encrypt(old.toString().toByteArray(),raw)
            val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",remote).put("migrationId","migration").put("fence",1)
                .put("sourceHash",E2eeEnvelope.encode(ByteArray(32))).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
                .put("projects",JSONArray()).put("categories",JSONArray()).put("workspace",JSONObject().put("keyMode","account").put("key",Base64.getEncoder().encodeToString(raw))
                    .put("envelope",JSONObject().put("ciphertext",envelope.ciphertext).put("iv",envelope.iv).put("version",1).put("minimumWriterProtocol",9)))
            val source=E2eeNativeWorkspaceSource(owner,remote,captureRows={ room.withTransaction { E2eeWorkspaceRows(room.dao().backupDocuments(scope),room.dao().outbox(scope)) } },
                decrypt={ row -> cipher.decrypt(row.encrypted,"$scope/${row.kind}") },assertCurrent={},legacyWorkspace={ check(captured);calls++;JSONObject(response.toString()) })
            val snapshot=source.captureLocal();captured=true;assertEquals(0,calls)
            val result=source.reconcile(snapshot,emptyList(),E2eeMigrationSourceContext(owner,remote,"migration",1,E2eeEnvelope.encode(ByteArray(32)),1))
            val document=JSONObject(result.content[0].bytes.toString(Charsets.UTF_8));assertEquals("offline-project",document.getJSONArray("projects").getJSONObject(0).getString("id"))
            assertEquals(base,room.dao().document(scope,"cloud-base"));assertEquals(structure,room.dao().document(scope,"structure"));assertEquals(1,room.dao().outbox(scope).size)
            assertFalse(result.content.any { it.bytes.toString(Charsets.UTF_8).contains(alias) || it.bytes.toString(Charsets.UTF_8).contains(Base64.getEncoder().encodeToString(raw)) })
            store.deleteEntry(alias);assertFalse(store.containsAlias(alias));val beforeCalls=calls
            try { source.captureLocal();fail("Invalidated legacy key became an empty workspace") }
            catch(error: IllegalStateException) { assertTrue(error.message?.contains("Local encryption key is unavailable") == true) }
            assertEquals(beforeCalls,calls);assertFalse(store.containsAlias(alias));assertEquals(structure,room.dao().document(scope,"structure"));assertEquals(1,room.dao().outbox(scope).size)
            // The already captured portable content survives loss of the old
            // Keystore key; source rows/outbox are still left untouched.
            assertTrue(snapshot.toString(Charsets.UTF_8).contains("Synthetic private offline project"));snapshot.fill(0);raw.fill(0)
        } finally {
            room.close();check(alias.startsWith("genesis.e2ee.qa."));if(store.containsAlias(alias))store.deleteEntry(alias)
            check(name.startsWith("qa-e2ee-workspace-"));context.deleteDatabase(name)
        }
    }
}
