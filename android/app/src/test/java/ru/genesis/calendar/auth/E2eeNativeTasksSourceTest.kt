package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.data.TaskRecord
import ru.genesis.calendar.security.*
import java.util.Base64

class E2eeNativeTasksSourceTest {
    private val account=CloudAccountSnapshot.scopeFor("owner")
    private val lease=E2eeMigrationSourceContext("owner","personal:owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private inner class Rig {
        val key=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(key)
        var live=true;var keyAvailable=true;var captured=false;var reads=0;var generation=0L;var pendingGeneration:Long?=null
        val plain=mutableMapOf("task-one" to "{\"id\":\"task-one\",\"title\":\"Synthetic pending task\",\"done\":false}")
        var rows=listOf(TaskRecord(account,"task-one","original-encrypted-task",4,false))
        var documents=listOf(DocumentRecord(account,"aurora-account-key","original-key-wrapper",1))
        var outbox=listOf(OutboxRecord(account,"task-one",4,"original-operation"));var mounted:JSONObject?=null
        val response=JSONObject().put("protocol",1).put("ownerId","owner").put("scopeId",lease.scopeId).put("migrationId",lease.migrationId).put("fence",7)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
            .put("tasks",JSONArray()).put("deletions",JSONArray()).put("links",JSONArray()).put("recovered",JSONArray()).put("recoveredDeletions",JSONArray())
            .put("creations",JSONArray()).put("creationTargets",JSONArray()).put("legacyKey",JSONObject().put("keyMode","account").put("key",encoded))
        var engine:suspend (JSONObject,JSONObject,suspend (JSONObject,String)->Any)->E2eePathReconciliation={local,remote,_->
            assertFalse(local.toString().contains(encoded));assertFalse(remote.toString().contains(encoded));assertFalse(local.toString().contains("original-operation"))
            assertEquals("original-operation",outbox.single().operationId)
            val entries=local.getJSONArray("entries");val cache=(0 until entries.length()).map{entries.getJSONObject(it)}.single{it.getString("key")=="genesis-calendar-v2:owner"}
            assertEquals(plain["task-one"],cache.getString("value").removePrefix("{\"tasks\":[").removeSuffix("]}"))
            E2eePathReconciliation(true,listOf(E2eeMigrationContent("workspace","personal-task-index-v1","{}".toByteArray())))
        }
        val source by lazy{E2eeNativeTasksSource("owner",lease.scopeId,captureRows={E2eeTasksRows(rows,outbox,documents,generation,pendingGeneration,mounted)},
            decryptTask={row->check(keyAvailable){"KEYSTORE_INVALIDATED"};requireNotNull(plain[row.id])},decryptDocument={check(keyAvailable){"KEYSTORE_INVALIDATED"};encoded},assertCurrent={check(live){"E2EE_ACCOUNT_CHANGED"}},
            legacyTasks={assertTrue(captured);assertEquals(lease,it);reads++;JSONObject(response.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{assertCurrent();return engine(local,remote,openLegacy)}
            })}
        suspend fun capture()=source.captureLocal().also{captured=true}
        suspend fun run(previous:List<ByteArray> = emptyList())=source.reconcile(capture(),previous,lease)
    }
    private suspend fun rejects(code:String,action:suspend ()->Unit){try{action();fail("Expected $code")}catch(error:Exception){assertTrue("Unexpected redacted failure class: ${error.javaClass.simpleName}",error.message?.contains(code)==true)}}
    @Test fun sourceRetainsExactTasksDeletedRowsAndOutboxBeforeIOWithoutExportingKeysToEngine()=runBlocking{
        val f=Rig();f.rows=f.rows.map{it.copy(deleted=true)};val before=f.rows.toList();val snapshot=f.capture();assertEquals(0,f.reads)
        assertTrue(snapshot.toString(Charsets.UTF_8).contains("original-encrypted-task"));assertTrue(snapshot.toString(Charsets.UTF_8).contains("original-operation"))
        val result=f.source.reconcile(snapshot,emptyList(),lease);assertTrue(result.complete);assertEquals(before,f.rows);assertEquals(1,f.reads)
        val history=JSONObject(result.content.last().bytes.toString(Charsets.UTF_8));assertTrue(history.getJSONArray("tasks").getJSONObject(0).getBoolean("deleted"))
        assertEquals("original-operation",history.getJSONArray("retainedOperations").getJSONObject(0).getString("operationId"));assertEquals("history-only",history.getString("execution"))
        assertFalse(result.content.any{it.bytes.toString(Charsets.UTF_8).contains(f.encoded)})
    }
    @Test fun orphanOrStaleOutboxAndChangedProtectedAttemptsBlockBeforeIO()=runBlocking{
        for(operation in listOf(OutboxRecord(account,"missing-task",1,"orphan"),OutboxRecord(account,"task-one",3,"old-revision"))){val f=Rig();f.outbox=listOf(operation);val saved=f.capture();assertTrue(saved.toString(Charsets.UTF_8).contains(operation.operationId));rejects("QUEUE_REVIEW_REQUIRED"){f.source.reconcile(saved,emptyList(),lease)};assertEquals(0,f.reads)}
        val changed=Rig();val old=changed.capture();changed.plain["task-one"]="{\"id\":\"task-one\",\"title\":\"Changed unsent edit\",\"done\":false}";rejects("HISTORY_REVIEW_REQUIRED"){changed.run(listOf(old))};assertEquals(0,changed.reads)
    }
    @Test fun missingLocalKeysMalformedRowsAndWrongGenerationNeverBecomeEmptySources()=runBlocking{
        val missing=Rig();missing.keyAvailable=false;rejects("KEYSTORE_INVALIDATED"){missing.capture()};assertEquals(0,missing.reads)
        val wrong=Rig();wrong.rows=wrong.rows.map{it.copy(scope=CloudAccountSnapshot.scopeFor("foreign"))};rejects("SCOPE_BINDING_MISMATCH"){wrong.capture()}
        val id=Rig();id.plain["task-one"]="{\"id\":\"foreign\",\"title\":\"Original private\"}";rejects("SOURCE_INVALID"){id.run()};assertEquals(0,id.reads)
        val pending=Rig();pending.pendingGeneration=1;rejects("GENERATION_REVIEW_REQUIRED"){pending.run()};assertEquals(0,pending.reads)
        val remote=Rig();remote.response.put("legacyGeneration",1);rejects("GENERATION_REVIEW_REQUIRED"){remote.run()}
        for(field in listOf("ownerId","scopeId","migrationId","sourceHash")){val f=Rig();f.response.put(field,"foreign");rejects("SCOPE_BINDING_MISMATCH"){f.run()}}
    }
    private fun recovered(f:Rig):Pair<String,WorkspaceCipher.Envelope>{
        val id="restored-"+"a".repeat(32);val purpose="recovered-task:v1:$id"
        val value="{\"id\":\"$id\",\"title\":\"Exact recovered bytes\",\"restoredFrom\":{}}"
        val envelope=WorkspaceCipher.encrypt(value.toByteArray(),f.key,"genesis-mindmap-v1:owner:$purpose".toByteArray())
        f.response.getJSONArray("recovered").put(JSONObject().put("id",id).put("revision",4).put("iv",envelope.iv).put("ciphertext",envelope.ciphertext).put("updated_at","2026-11-19T09:00:00Z"))
        return purpose to envelope
    }
    @Test fun onlyExactCapturedRecoveredCiphertextAndOwnerAADMayUseOldNativeKeys()=runBlocking{
        val f=Rig();val (purpose,envelope)=recovered(f)
        f.engine={_,remote,open->val plain=open(JSONObject().put("iv",envelope.iv).put("ciphertext",envelope.ciphertext),purpose) as String;assertTrue(plain.contains("Exact recovered bytes"));assertTrue(remote.getJSONObject("legacyKey").isNull("key"));E2eePathReconciliation(true,emptyList())}
        assertTrue(f.run().complete)
        val unknown=Rig();unknown.engine={_,_,open->open(JSONObject(),"workspace");error("Unexpected acceptance")};rejects("INVALID_KEY_BUNDLE"){unknown.run()}
        val changed=Rig();val (known,original)=recovered(changed);changed.engine={_,_,open->open(JSONObject().put("iv",original.iv).put("ciphertext","altered"),known);error("Unexpected acceptance")};rejects("SOURCE_INVALID"){changed.run()}
    }
    @Test fun missingAndCorruptHistoricalKeysCannotDecryptOrCreateReplacementRecovery()=runBlocking{
        val missing=Rig();val (purpose,envelope)=recovered(missing);missing.documents=emptyList();missing.response.getJSONObject("legacyKey").put("keyMode","client").put("key",JSONObject.NULL)
        missing.engine={_,_,open->open(JSONObject().put("iv",envelope.iv).put("ciphertext",envelope.ciphertext),purpose);error("Unexpected acceptance")};rejects("LEGACY_KEY_UNAVAILABLE"){missing.run()}
        val corrupt=Rig();val (corruptPurpose,sealed)=recovered(corrupt);corrupt.documents=emptyList();corrupt.response.getJSONObject("legacyKey").put("key",Base64.getEncoder().encodeToString(ByteArray(32){11}))
        corrupt.engine={_,_,open->open(JSONObject().put("iv",sealed.iv).put("ciphertext",sealed.ciphertext),corruptPurpose);error("Unexpected acceptance")};rejects("LEGACY_TASK_CORRUPT"){corrupt.run()}
    }
    @Test fun lateAccountChangeWipesReturnedContentAndPreservesEveryOriginalRow()=runBlocking{
        val f=Rig();val output=byteArrayOf(1,2,3);val before=f.rows.toList();f.engine={_,_,_->f.live=false;E2eePathReconciliation(true,listOf(E2eeMigrationContent("workspace","personal-task-index-v1",output)))}
        rejects("ACCOUNT_CHANGED"){f.run()};assertArrayEquals(ByteArray(3),output);assertEquals(before,f.rows)
    }
}
