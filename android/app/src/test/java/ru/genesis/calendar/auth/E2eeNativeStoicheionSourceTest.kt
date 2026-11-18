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

class E2eeNativeStoicheionSourceTest {
    private val account=CloudAccountSnapshot.scopeFor("owner")
    private val lease=E2eeMigrationSourceContext("owner","personal:owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private inner class Rig {
        val key=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(key)
        var live=true;var keyAvailable=true;var captured=false;var reads=0;var generation=0L;var pendingGeneration:Long?=null
        val document=JSONObject().put("privateReflection","synthetic private history")
        val envelope=WorkspaceCipher.encrypt(document.toString().toByteArray(),key,"genesis-mindmap-v1:owner:stoicheion-workspace:v1".toByteArray())
        val plain=mutableMapOf("aurora-account-key" to encoded,"stoicheion-draws" to "{\"days\":{}}")
        var rows=listOf(DocumentRecord(account,"aurora-account-key","original-local-key-wrapper",1),DocumentRecord(account,"stoicheion-draws","original-encrypted-draws",1))
        var outbox=emptyList<OutboxRecord>();var mounted:JSONObject?=null
        val response=JSONObject().put("protocol",1).put("ownerId","owner").put("scopeId",lease.scopeId).put("migrationId",lease.migrationId).put("fence",lease.fence)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
            .put("workspace",JSONObject().put("iv",envelope.iv).put("ciphertext",envelope.ciphertext).put("revision",1).put("updatedAt","2026-11-19T09:00:00Z"))
            .put("draws",JSONArray()).put("spreadCards",JSONArray()).put("timelineSessions",JSONArray()).put("timelineWindows",JSONArray())
            .put("legacyKey",JSONObject().put("keyMode","account").put("key",encoded))
        var engine:suspend (JSONObject,JSONObject,suspend (JSONObject,String)->Any)->E2eePathReconciliation={local,remote,open->
            assertFalse(local.toString().contains(encoded));assertFalse(remote.toString().contains(encoded))
            assertEquals(0,local.getJSONObject("memory").getJSONObject("nativeDraws").getJSONObject("days").length())
            val value=open(remote.getJSONObject("workspace"),"stoicheion-workspace:v1") as JSONObject
            E2eePathReconciliation(true,listOf(E2eeMigrationContent("stoicheion","personal-stoicheion-workspace-v1",value.toString().toByteArray())))
        }
        val source by lazy{E2eeNativeStoicheionSource("owner",lease.scopeId,captureRows={E2eeStoicheionRows(rows,outbox,generation,pendingGeneration,mounted)},
            decrypt={row->check(keyAvailable){"KEYSTORE_INVALIDATED"};requireNotNull(plain[row.kind])},assertCurrent={check(live){"E2EE_ACCOUNT_CHANGED"}},
            legacyStoicheion={assertTrue(captured);assertEquals(lease.sourceHash,it.sourceHash);reads++;JSONObject(response.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{assertCurrent();return engine(local,remote,openLegacy)}
            })}
        suspend fun capture()=source.captureLocal().also{captured=true}
        suspend fun run(previous:List<ByteArray> = emptyList())=source.reconcile(capture(),previous,lease)
    }
    private suspend fun rejects(code:String,action:suspend ()->Unit){
        try{action();fail("Expected $code")}catch(error:Exception){assertTrue("Unexpected redacted failure class: ${error.javaClass.simpleName}",error.message?.contains(code)==true)}
    }
    @Test fun originalsAreCapturedBeforeIOAndOnlyKeylessContentReachesTheSharedEngine()=runBlocking{
        val f=Rig();val before=f.rows.toList();val snapshot=f.capture();assertEquals(0,f.reads)
        assertTrue(snapshot.toString(Charsets.UTF_8).contains("original-encrypted-draws"));assertTrue(snapshot.toString(Charsets.UTF_8).contains(f.encoded))
        val result=f.source.reconcile(snapshot,emptyList(),lease);assertTrue(result.complete);assertEquals(1,f.reads);assertEquals(before,f.rows)
        assertEquals("synthetic private history",JSONObject(result.content.single().bytes.toString(Charsets.UTF_8)).getString("privateReflection"))
        assertEquals(f.encoded,f.response.getJSONObject("legacyKey").getString("key"))
    }
    @Test fun changedAttemptsUnknownKindsAndQueuesCannotBeCalledEmptySources()=runBlocking{
        val f=Rig();val old=f.capture();f.plain["stoicheion-draws"]="{\"days\":{},\"unknown\":true}";rejects("HISTORY_REVIEW_REQUIRED"){f.run(listOf(old))};assertEquals(0,f.reads)
        val future=Rig();future.rows+=DocumentRecord(account,"stoicheion-future","original-future-bytes",1);future.plain["stoicheion-future"]="retained";val protected=future.capture()
        rejects("FORMAT_UNSUPPORTED"){future.source.reconcile(protected,emptyList(),lease)};assertEquals(0,future.reads)
        val queue=Rig();queue.outbox=listOf(OutboxRecord(account,"stoicheion-unknown",1,"retained-operation"));val captured=queue.capture()
        assertTrue(captured.toString(Charsets.UTF_8).contains("retained-operation"));rejects("QUEUE_REVIEW_REQUIRED"){queue.source.reconcile(captured,emptyList(),lease)};assertEquals(0,queue.reads)
    }
    @Test fun missingKeystoreAndWrongGenerationsNeverCreateReplacementData()=runBlocking{
        val missing=Rig();missing.keyAvailable=false;rejects("KEYSTORE_INVALIDATED"){missing.capture()};assertEquals(0,missing.reads)
        val pending=Rig();pending.pendingGeneration=1;rejects("GENERATION_REVIEW_REQUIRED"){pending.run()};assertEquals(0,pending.reads)
        val remote=Rig();remote.response.put("legacyGeneration",1);rejects("GENERATION_REVIEW_REQUIRED"){remote.run()}
        for(field in listOf("ownerId","scopeId","migrationId","sourceHash")){val f=Rig();f.response.put(field,"foreign");rejects("SCOPE_BINDING_MISMATCH"){f.run()}}
    }
    @Test fun missingHistoricalKeyCorruptEnvelopeAndWrongPurposeBlockCompletion()=runBlocking{
        val missing=Rig();missing.rows=missing.rows.filter{it.kind!="aurora-account-key"};missing.response.getJSONObject("legacyKey").put("keyMode","client").put("key",JSONObject.NULL)
        rejects("LEGACY_KEY_UNAVAILABLE"){missing.run()}
        val corrupt=Rig();corrupt.rows=corrupt.rows.filter{it.kind!="aurora-account-key"};corrupt.response.getJSONObject("legacyKey").put("key",Base64.getEncoder().encodeToString(ByteArray(32){11}))
        rejects("LEGACY_STOICHEION_CORRUPT"){corrupt.run()}
        val purpose=Rig();purpose.engine={_,_,open->open(JSONObject(),"workspace");error("Unexpected acceptance")};rejects("SOURCE_INVALID"){purpose.run()}
    }
    @Test fun closingWhileTheEngineRunsWipesUnacceptedBytesAndKeepsOriginalRows()=runBlocking{
        val f=Rig();val returned=byteArrayOf(1,2,3);val before=f.rows.toList();f.engine={_,_,_->f.live=false;E2eePathReconciliation(true,listOf(E2eeMigrationContent("stoicheion","personal-stoicheion-workspace-v1",returned)))}
        rejects("ACCOUNT_CHANGED"){f.run()};assertArrayEquals(ByteArray(3),returned);assertEquals(before,f.rows)
    }
}
