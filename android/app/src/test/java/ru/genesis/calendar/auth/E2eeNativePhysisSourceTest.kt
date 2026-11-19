package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.security.*
import java.io.File

class E2eeNativePhysisSourceTest {
    private val fixture by lazy{val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}
        .map{File(it,"tests/fixtures/e2ee/physis-legacy.json")}.first{it.isFile};JSONObject(file.readText())}
    private val owner get()=fixture.getString("ownerId")
    private val account get()=CloudAccountSnapshot.scopeFor(owner)
    private val lease get()=E2eeMigrationSourceContext(owner,"personal:$owner","migration",7,E2eeEnvelope.encode(ByteArray(32)),2)
    private inner class Rig(val independent:Boolean=false) {
        val f=if(independent)fixture.getJSONArray("independent").getJSONObject(0)else fixture.getJSONObject("account")
        val encoded=fixture.getJSONObject("account").getString("oldKey");var live=true;var available=true;var pending:Long?=null;var reads=0;var captures=0
        var rows=listOf(DocumentRecord(account,"aurora-account-key","exact-old-wrapper",1))
        val remote=JSONObject().put("ownerId",owner).put("scopeId",lease.scopeId).put("migrationId",lease.migrationId).put("fence",7).put("sourceHash",lease.sourceHash)
            .put("legacyGeneration",0).put("owners",JSONArray().put(JSONObject().put("vault_json",f.getJSONObject("vault").toString())))
            .put("records",JSONArray().put(JSONObject().put("id",f.getString("id")).put("envelope_json",f.getJSONObject("envelope").toString())))
            .put("legacyKey",JSONObject().put("keyMode","client").put("key",JSONObject.NULL))
        var credential:E2eePhysisCredential?=null
        var engine:suspend (JSONObject,JSONObject,suspend (JSONObject,String)->Any)->E2eePathReconciliation={local,remote,_->
            assertFalse(local.toString().contains(encoded));assertTrue(remote.getJSONObject("legacyKey").isNull("key"));E2eePathReconciliation(true,emptyList())}
        val source get()=E2eeNativePhysisSource(owner,lease.scopeId,captureRows={captures++;E2eePhysisRows(rows,0,pending)},
            decrypt={check(available){"KEYSTORE_INVALIDATED"};encoded},assertCurrent={check(live){"E2EE_ACCOUNT_CHANGED"}},
            legacyPhysis={assertTrue(captures>0);reads++;JSONObject(remote.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                    assertCurrent();assertFalse((local.toString()+previous.toString()).contains(encoded));return engine(local,remote,openLegacy)
                }},independentUnlock={credential})
        suspend fun run():E2eePathReconciliation{val source=source;return source.reconcile(source.captureLocal(),emptyList(),lease)}
        fun packet(value:JSONObject)=JSONObject().put("iv",value.get("iv")).put("ciphertext",value.get("ciphertext"))
        suspend fun unlock(open:suspend (JSONObject,String)->Any){val vault=f.getJSONObject("vault");assertEquals(true,open(packet(vault.getJSONObject(if(independent)"password"else "account")),"physis-vault:${vault.getInt("version")}:${vault.getLong("keyVersion")}"))}
        suspend fun read(open:suspend (JSONObject,String)->Any)=open(packet(f.getJSONObject("envelope")),"physis-record:${f.getString("id")}:${f.getJSONObject("vault").getLong("keyVersion")}")
    }
    private suspend fun rejects(code:String,operation:suspend ()->Unit){try{operation();fail("Expected $code")}catch(error:Exception){assertTrue(error.message?.contains(code)==true)}}
    @Test fun nativeCaptureRetainsOldAuthorityOnlyInProtectedInputBeforeAnySourceRequest()=runBlocking {
        val f=Rig();val source=f.source;val raw=source.captureLocal();assertEquals(0,f.reads);assertTrue(raw.toString(Charsets.UTF_8).contains(f.encoded));assertEquals("exact-old-wrapper",JSONObject(raw.toString(Charsets.UTF_8)).getJSONArray("documents").getJSONObject(0).getString("encrypted"))
        assertTrue(source.reconcile(raw,emptyList(),lease).complete);assertEquals(1,f.reads)
    }
    @Test fun exactVaultAndRecordCapabilityCannotOpenForeignCiphertextOrRemainUsableAfterTheJob()=runBlocking {
        val f=Rig();var retained:(suspend (JSONObject,String)->Any)?=null
        f.engine={_,_,open->retained=open;rejects("UNLOCK_REQUIRED"){f.read(open)};f.unlock(open);assertEquals(f.f.getString("plaintext"),f.read(open))
            rejects("SOURCE_INVALID"){open(f.packet(f.f.getJSONObject("envelope")),"physis-record:00000000-0000-4000-8000-000000000000:3")}
            rejects("SOURCE_INVALID"){open(f.packet(f.f.getJSONObject("envelope")).put("iv","AAAAAAAAAAAAAAAA"),"physis-record:${f.f.getString("id")}:3")}
            E2eePathReconciliation(true,emptyList())}
        assertTrue(f.run().complete);rejects("CAPABILITY_CLOSED"){f.read(requireNotNull(retained))}
    }
    @Test fun originalIndependentRecoveryMustBeProvidedInNativeAndItsOwnedCopyIsWiped()=runBlocking {
        val f=Rig(true);f.engine={_,_,open->f.unlock(open);assertEquals(f.f.getString("plaintext"),f.read(open));E2eePathReconciliation(true,emptyList())}
        rejects("UNLOCK_REQUIRED"){f.run()};val borrowed=f.f.getString("recovery").toCharArray();val credential=E2eePhysisCredential("recovery",borrowed);f.credential=credential
        assertTrue(f.run().complete);assertTrue(credential.secret.all{it=='\u0000'});assertEquals(f.f.getString("recovery"),borrowed.concatToString());borrowed.fill('\u0000')
    }
    @Test fun retainedAuthoritySurvivesLaterKeystoreLossWithoutAnyServerKeyOrBridgeExport()=runBlocking {
        val f=Rig();val source=f.source;val captured=source.captureLocal();f.available=false
        f.engine={local,remote,open->assertFalse((local.toString()+remote.toString()).contains(f.encoded));f.unlock(open);assertEquals(f.f.getString("plaintext"),f.read(open));E2eePathReconciliation(true,emptyList())}
        assertTrue(f.source.reconcile(captured,listOf(captured),lease).complete);assertEquals(1,f.reads)
        val older=JSONObject(captured.toString(Charsets.UTF_8));older.getJSONArray("documents").getJSONObject(0).remove("plain")
        rejects("KEYSTORE_INVALIDATED"){f.source.reconcile(older.toString().toByteArray(),emptyList(),lease)}
    }
    @Test fun missingForeignUnknownOrChangedLocalAuthorityNeverBecomesAnEmptyPhysisSource()=runBlocking {
        val missing=Rig();missing.rows=emptyList();missing.engine={_,_,open->missing.unlock(open);error("Unexpected unlock")};rejects("UNLOCK_REQUIRED"){missing.run()}
        val unknown=Rig();unknown.rows=unknown.rows+DocumentRecord(account,"physis-future","retain",1);rejects("FORMAT_UNSUPPORTED"){unknown.run()};assertEquals(0,unknown.reads)
        val foreign=Rig();foreign.rows=foreign.rows.map{it.copy(scope=CloudAccountSnapshot.scopeFor("foreign"))};rejects("SCOPE_BINDING_MISMATCH"){foreign.run()};assertEquals(0,foreign.reads)
        val pending=Rig();pending.pending=1;rejects("GENERATION_REVIEW_REQUIRED"){pending.run()};assertEquals(0,pending.reads)
        val changed=Rig();val old=changed.source.captureLocal();changed.rows=emptyList();rejects("HISTORY_REVIEW_REQUIRED"){changed.source.reconcile(changed.source.captureLocal(),listOf(old),lease)};assertEquals(0,changed.reads)
    }
    @Test fun accountLossWipesBothOutputPlacementsAndClosesNativeReader()=runBlocking {
        val f=Rig();val remote=byteArrayOf(1,2);val local=byteArrayOf(3,4);var retained:(suspend (JSONObject,String)->Any)?=null
        f.engine={_,_,open->retained=open;f.unlock(open);f.live=false;E2eePathReconciliation(true,listOf(E2eeMigrationContent("physis","remote",remote)),listOf(E2eeMigrationContent("physis","local",local)))}
        rejects("ACCOUNT_CHANGED"){f.run()};assertArrayEquals(ByteArray(2),remote);assertArrayEquals(ByteArray(2),local);f.live=true;rejects("CAPABILITY_CLOSED"){f.read(requireNotNull(retained))}
    }
}
