package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.security.*
import java.util.Base64

/** Injected Room/local decrypt ports, genuine historical JCA AEAD. Domain merge
 * parity is tested separately using the actual packaged WebView reconciler. */
class E2eeNativeAuroraSourceTest {
    private val account=CloudAccountSnapshot.scopeFor("owner")
    private val lease=E2eeMigrationSourceContext("owner","personal:owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private inner class Rig {
        val key=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(key)
        var live=true;var keyAvailable=true;var captured=false;var reads=0;var generation=0L;var pendingGeneration:Long?=null
        val plain=mutableMapOf("aurora-account-key" to encoded);var rows=listOf(DocumentRecord(account,"aurora-account-key","retained-original-local-key-wrapper",1))
        var outbox=emptyList<OutboxRecord>();var mounted:JSONObject?=null
        val response=JSONObject().put("protocol",1).put("ownerId","owner").put("scopeId",lease.scopeId).put("migrationId",lease.migrationId).put("fence",lease.fence)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
            .put("workspace",JSONObject.NULL).put("results",JSONArray()).put("legacyKey",JSONObject().put("keyMode","account").put("key",encoded))
        var engine:suspend (JSONObject,JSONObject,suspend (JSONObject,String)->Any)->E2eePathReconciliation={local,remote,open->
            assertFalse(local.toString().contains(encoded));assertFalse(remote.toString().contains(encoded))
            val entry=local.getJSONArray("entries").getJSONObject(0);val pending=JSONObject(entry.getString("value"))
            val document=open(pending.getJSONObject("envelope"),"aurora-workspace:v1") as JSONObject
            E2eePathReconciliation(true,listOf(E2eeMigrationContent("aurora","personal-aurora-workspace-v1",document.toString().toByteArray())))
        }
        val source by lazy { E2eeNativeAuroraSource("owner",lease.scopeId,
            captureRows={E2eeAuroraRows(rows,outbox,generation,pendingGeneration,mounted)},decrypt={row->check(keyAvailable){"KEYSTORE_INVALIDATED"};requireNotNull(plain[row.kind])},
            assertCurrent={check(live){"E2EE_ACCOUNT_CHANGED"}},legacyAurora={context->assertTrue(captured);assertEquals(lease.sourceHash,context.sourceHash);reads++;JSONObject(response.toString())},
            reconciler=object:E2eeAuroraReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation {
                    assertEquals(lease.scopeId,context.scopeId);assertCurrent();return engine(local,remote,openLegacy)
                }
            }) }
        fun pending(note:String,writer:String="11111111-1111-4111-8111-111111111111",sequence:Int=1){
            val kind="aurora-pending:writer:$writer:$sequence:pending";val document=JSONObject().put("version",1).put("note",note)
            val cipher=WorkspaceCipher.encrypt(document.toString().toByteArray(),key,"genesis-mindmap-v1:owner:aurora-workspace:v1".toByteArray())
            plain[kind]=JSONObject().put("envelope",JSONObject().put("iv",cipher.iv).put("ciphertext",cipher.ciphertext).put("expectedRevision",0)).put("base",JSONObject()).toString()
            rows=rows+DocumentRecord(account,kind,"original-room-ciphertext-$sequence",sequence.toLong())
        }
        suspend fun capture()=source.captureLocal().also{captured=true}
        suspend fun run(previous:List<ByteArray> = emptyList())=source.reconcile(capture(),previous,lease)
    }
    private suspend fun rejects(code:String,action:suspend ()->Unit){
        try{action();fail("Expected $code")}catch(error:Exception){assertTrue("Unexpected redacted failure class: ${error.javaClass.simpleName}",error.message?.contains(code)==true)}
    }
    @Test fun capturePreservesEveryOriginalAndTheEngineReceivesDocumentsWithoutKeys()=runBlocking {
        val f=Rig();f.pending("first");f.pending("second",sequence=2);val before=f.rows.toList();val captured=f.capture()
        assertEquals(0,f.reads);val snapshot=JSONObject(captured.toString(Charsets.UTF_8));assertEquals(3,snapshot.getJSONArray("documents").length())
        assertTrue(captured.toString(Charsets.UTF_8).contains("original-room-ciphertext-1"));assertTrue(captured.toString(Charsets.UTF_8).contains(f.encoded))
        val result=f.source.reconcile(captured,emptyList(),lease);assertTrue(result.complete);assertEquals(1,f.reads);assertEquals(before,f.rows)
        assertEquals("first",JSONObject(result.content.single().bytes.toString(Charsets.UTF_8)).getString("note"))
    }
    @Test fun previousAttemptsUnknownQueuesAndFormatsBlockBeforeLegacyReads()=runBlocking {
        val f=Rig();f.pending("previous");val previous=f.capture();f.plain[f.rows.last().kind]="changed bytes"
        rejects("HISTORY_REVIEW_REQUIRED"){f.run(listOf(previous))};assertEquals(0,f.reads)
        val queue=Rig();queue.outbox=listOf(OutboxRecord(account,"aurora-unknown",1,"operation"));val retained=queue.capture()
        assertTrue(retained.toString(Charsets.UTF_8).contains("operation"));rejects("QUEUE_REVIEW_REQUIRED"){queue.source.reconcile(retained,emptyList(),lease)};assertEquals(0,queue.reads)
        val future=Rig();future.rows+=DocumentRecord(account,"aurora-future-format","unchanged ciphertext",1);future.plain["aurora-future-format"]="retained future bytes"
        val raw=future.capture();rejects("FORMAT_UNSUPPORTED"){future.source.reconcile(raw,emptyList(),lease)};assertEquals(0,future.reads)
    }
    @Test fun ownerEpochAndKeystoreFailuresNeverCreateReplacementContent()=runBlocking {
        val locked=Rig();locked.keyAvailable=false;rejects("KEYSTORE_INVALIDATED"){locked.capture()};assertEquals(0,locked.reads)
        val generation=Rig();generation.pendingGeneration=1;rejects("GENERATION_REVIEW_REQUIRED"){generation.run()};assertEquals(0,generation.reads)
        for(field in listOf("ownerId","scopeId","migrationId","sourceHash")){val f=Rig();f.response.put(field,"foreign");rejects("SCOPE_BINDING_MISMATCH"){f.run()}}
        val stale=Rig();stale.response.put("legacyGeneration",1);rejects("GENERATION_REVIEW_REQUIRED"){stale.run()}
    }
    @Test fun lateAccountChangeWipesUnacceptedResultBytesAndPreservesSources()=runBlocking {
        val f=Rig();f.pending("retained");val returned=byteArrayOf(1,2,3);val before=f.rows.toList()
        f.engine={_,_,_->f.live=false;E2eePathReconciliation(true,listOf(E2eeMigrationContent("aurora","personal-aurora-workspace-v1",returned)))}
        rejects("ACCOUNT_CHANGED"){f.run()};assertArrayEquals(ByteArray(3),returned);assertEquals(before,f.rows)
    }
    @Test fun aMissingHistoricalKeyCorruptCipherOrWrongPurposeCannotProduceAnEmptyDocument()=runBlocking {
        val missing=Rig();missing.pending("retained");missing.rows=missing.rows.filter{it.kind!="aurora-account-key"};missing.response.getJSONObject("legacyKey").put("keyMode","client").put("key",JSONObject.NULL)
        rejects("LEGACY_KEY_UNAVAILABLE"){missing.run()}
        val tampered=Rig();tampered.pending("retained");tampered.response.getJSONObject("legacyKey").put("key",Base64.getEncoder().encodeToString(ByteArray(32){11}));tampered.rows=tampered.rows.filter{it.kind!="aurora-account-key"}
        rejects("LEGACY_AURORA_CORRUPT"){tampered.run()}
        val purpose=Rig();purpose.engine={_,_,open->open(JSONObject(),"workspace");error("Unexpected acceptance")};rejects("SOURCE_INVALID"){purpose.run()}
    }
}
