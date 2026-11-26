package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.security.*
import java.security.MessageDigest

class E2eeNativeAdviceSourceTest {
    private class Rig {
        val owner="synthetic-advice-owner";val scope="personal:$owner";val account=CloudAccountSnapshot.scopeFor(owner)
        val preferences=AdvicePreferences().toJson().toString();val hash=sha("$owner\u0000en\u0000$preferences")
        val container=JSONObject().put("protocol",2).put("ownerId",owner).put("profiles",JSONObject().put(hash,JSONObject().put("language","en").put("preferences",preferences)
            .put("current",JSONObject.NULL).put("seen",JSONObject()).put("legacyOriginal",JSONObject.NULL)))
        var documents=listOf(DocumentRecord(account,"advice-cache-v2","synthetic-exact-ciphertext",1));var pending:List<OutboxRecord> = emptyList()
        var pendingGeneration:Long?=null;var unknown=0;var live=true;var decryptFails=false;var signed=0;var captures=0;var engines=0;var captured=false
        var foreignLegacy=false;var known:Set<String> = emptySet()
        val lease=E2eeMigrationSourceContext(owner,scope,"migration",1,E2eeEnvelope.encode(ByteArray(32)),2)
        val remote=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1).put("sourceHash",lease.sourceHash).put("legacyGeneration",0)
        val source=E2eeNativeAdviceSource(owner,scope,captureRows={E2eeAdviceRows(documents,pending,0,pendingGeneration,listOf(preferences),null)},
            decrypt={if(decryptFails)error("SYNTHETIC_LOST_LOCAL_KEY");container.toString()},captureLegacy={keys->
                captures++;known=keys;E2eeAdviceLegacyRows(mapOf((if(foreignLegacy)"0".repeat(64) else hash)+":seen:advice-0123456789abcdef01234567" to "2026-11-19"),unknown)
            },assertCurrent={check(live){"E2EE_ACCOUNT_CHANGED"}},legacyAdvice={context->check(captured);assertEquals(lease,context);signed++;JSONObject(remote.toString())},
            reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,
                    openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                    engines++;assertCurrent();assertEquals(owner,local.getString("ownerId"));assertEquals("synthetic-exact-ciphertext",local.getJSONArray("documents").getJSONObject(0).getString("encrypted"))
                    try{openLegacy(JSONObject(),"not-a-key-service");fail("Advice cannot open any key")}catch(error:IllegalStateException){assertEquals("E2EE_KEY_BRIDGE_FORBIDDEN",error.message)}
                    return E2eePathReconciliation(true,listOf(E2eeMigrationContent("workspace","personal-advice-preferences-v1","{}".toByteArray())))
                }
            })
        suspend fun capture()=source.captureLocal().also{captured=true}
        companion object{fun sha(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray()).joinToString(""){"%02x".format(it)}}
    }
    private suspend fun reject(code:String,run:suspend ()->Unit){try{run();fail("Expected $code")}catch(error:IllegalStateException){assertEquals(code,error.message)}}
    @Test fun rawOwnerRowsAndOnlyReproducibleV1KeysAreCapturedBeforeSignedHistoryOrEngineIO()=runBlocking{
        val f=Rig();val raw=f.capture();val snapshot=JSONObject(raw.toString(Charsets.UTF_8));assertEquals(0,f.signed);assertEquals(0,f.engines);assertEquals(1,f.captures)
        assertEquals(14,snapshot.getJSONArray("knownProfiles").length());assertEquals(14,f.known.size);assertTrue(f.hash in f.known);assertEquals(1,snapshot.getJSONArray("legacy").length())
        assertTrue(f.source.reconcile(raw,emptyList(),f.lease).complete);assertEquals(1,f.signed);assertEquals(1,f.engines);assertEquals("synthetic-exact-ciphertext",f.documents.single().encrypted)
    }
    @Test fun unassignedLegacyPendingGenerationAndUnsentAdviceQueuesStopBeforePrivateRead()=runBlocking{
        for(mode in 0..2){val f=Rig();val code=when(mode){0->{f.unknown=1;"E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED"};1->{f.pendingGeneration=1;"E2EE_ADVICE_GENERATION_REVIEW_REQUIRED"};else->{f.pending=listOf(OutboxRecord(f.account,"advice-unsent",1,"original-operation"));"E2EE_ADVICE_QUEUE_REVIEW_REQUIRED"}}
            val raw=f.capture();reject(code){f.source.reconcile(raw,emptyList(),f.lease)};assertEquals(0,f.signed);assertEquals(0,f.engines);assertEquals("synthetic-exact-ciphertext",f.documents.single().encrypted)}
    }
    @Test fun wrongRoomScopeProfileOwnerAndForeignV1HashCannotBeCapturedAsThisOwner()=runBlocking{
        val scope=Rig();scope.documents=scope.documents.map{it.copy(scope="foreign-scope")};reject("E2EE_SCOPE_BINDING_MISMATCH"){scope.capture()};assertEquals(0,scope.captures)
        val owner=Rig();owner.container.put("ownerId","foreign");reject("E2EE_SCOPE_BINDING_MISMATCH"){owner.capture()};assertEquals(0,owner.captures)
        val legacy=Rig();legacy.foreignLegacy=true;reject("E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED"){legacy.capture()};assertEquals(0,legacy.signed)
    }
    @Test fun missingLocalKeyChangedProtectedAttemptAndAccountClosureKeepOriginalsAndNeverPublishEmptyHistory()=runBlocking{
        val lost=Rig();lost.decryptFails=true;reject("SYNTHETIC_LOST_LOCAL_KEY"){lost.capture()};assertEquals(0,lost.signed);assertEquals(0,lost.captures)
        val changed=Rig();val previous=changed.capture();changed.documents=changed.documents.map{it.copy(revision=2)};val current=changed.capture()
        reject("E2EE_ADVICE_HISTORY_REVIEW_REQUIRED"){changed.source.reconcile(current,listOf(previous),changed.lease)};assertEquals(0,changed.signed)
        val closed=Rig();val saved=closed.capture();closed.live=false;reject("E2EE_ACCOUNT_CHANGED"){closed.source.reconcile(saved,emptyList(),closed.lease)};assertEquals(0,closed.signed)
    }
    @Test fun signedOwnerLeaseAndGenerationRemainBoundBeforeCallingTheHeadlessEngine()=runBlocking{
        for(field in listOf("ownerId","scopeId","migrationId","fence","sourceHash","legacyGeneration")){
            val f=Rig();val raw=f.capture();if(field in setOf("fence","legacyGeneration"))f.remote.put(field,7)else f.remote.put(field,"foreign")
            reject(if(field=="legacyGeneration")"E2EE_ADVICE_GENERATION_REVIEW_REQUIRED" else "E2EE_SCOPE_BINDING_MISMATCH"){f.source.reconcile(raw,emptyList(),f.lease)};assertEquals(0,f.engines)
        }
    }
}
