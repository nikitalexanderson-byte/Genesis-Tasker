package ru.genesis.calendar.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.security.*
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Real QA Room/Keystore, network-disabled packaged source and new-root local
 * encryption. All content and authorities are synthetic. No release install. */
@RunWith(AndroidJUnit4::class)
class PhysisMigrationSourceTest {
    private class Rig(val independent:Boolean=false):AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="physis-source-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val alias="genesis.qa.physis-source.${UUID.randomUUID()}";val cipher=LocalCipher(alias);val current=AtomicBoolean(true);val epoch:Long
        val oldKey=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(oldKey);val recordKey=E2eeKeys.freshSecret();val recoveryKey=E2eeKeys.freshSecret()
        val recovery="PHY1-"+Base64.getUrlEncoder().withoutPadding().encodeToString(recoveryKey)
        val reads=AtomicInteger();val opens=AtomicInteger();val fresh=E2eeKeys.freshSecret();val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage;val vault:UnlockedE2eeVault
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        val recordId=UUID.randomUUID().toString();val deletedId=UUID.randomUUID().toString();val prunedId=UUID.randomUUID().toString()
        val canary="Synthetic original private Physis 🌿";var provideRecovery=true;var onOpen:suspend ()->Unit={}
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",lease.sourceHash).put("directoryRevision",1)
            .put("owners",JSONArray()).put("records",JSONArray()).put("usedIds",JSONArray()).put("receipts",JSONArray()).put("legacyKey",JSONObject().put("keyMode","client").put("key",JSONObject.NULL))
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner);epoch=app.workspaceEpoch;storage=E2eeSqliteStorage(app,allowCreate=true)
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-root",device.signing.private,mapOf("synthetic-root" to E2eeEnvelope.importRoot(fresh))){device.signing.public});fresh.fill(0)
        }
        fun check(){check(current.get()&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        private fun packet(raw:ByteArray,key:ByteArray,aad:String)=WorkspaceCipher.encrypt(raw,key,aad.toByteArray()).let{JSONObject().put("iv",it.iv).put("ciphertext",it.ciphertext)}
        fun record(id:String=recordId,note:String=canary)=JSONObject().put("id",id).put("schemaVersion",1).put("kind","settings").put("source","manual")
            .put("createdAt","2026-11-19T15:00:00Z").put("updatedAt","2026-11-19T15:00:00Z").put("privateOptional",JSONObject().put("note",note).put("empty",JSONArray()))
            .put("data",JSONObject().put("calendarMode","sacred").put("inputCalendarMode","profane").put("timeZone","UTC").put("weightUnit","kg").put("distanceUnit","km")
                .put("energyUnit","kcal").put("glucoseUnit","mmol/L").put("restSeconds",90).put("reminders",false).put("foodRules",JSONArray()).put("enabledMetrics",JSONArray()).put("overviewBlocks",JSONArray()))
        fun envelope(id:String,plain:String)=packet(plain.toByteArray(),recordKey,"genesis:physis:v1:$owner:$id:1:7").put("version",1).put("schemaVersion",1).put("keyVersion",7)
        suspend fun seed(count:Int=1,large:Boolean=false){
            app.database.dao().putDocument(DocumentRecord(account,"aurora-account-key",cipher.encrypt(encoded,"$account/aurora/$owner/account-key"),1))
            val original=if(independent)JSONObject().put("version",1).put("keyVersion",7)
                .put("password",JSONObject().put("salt",Base64.getEncoder().encodeToString(ByteArray(16){3})).put("iterations",600000)
                    .put("iv",Base64.getEncoder().encodeToString(ByteArray(12){4})).put("ciphertext",Base64.getEncoder().encodeToString(ByteArray(48){5})))
                .put("recovery",packet(recordKey,recoveryKey,"genesis:physis:v1:$owner:vault:recovery:1:7"))
                else {
                    // Android JSONObject.quote may escape '/', unlike the old
                    // WebCrypto JSON.stringify(base64) format. Base64 contains
                    // no quotes/backslashes; its exact quoted form is 46 bytes.
                    val plain=("\""+Base64.getEncoder().encodeToString(recordKey)+"\"").toByteArray()
                    try{check(plain.size==46);JSONObject().put("version",2).put("keyVersion",7).put("account",packet(plain,oldKey,"genesis-mindmap-v1:$owner:physis-vault:v2:7"))}finally{plain.fill(0)}
                }
            for(index in 0 until count){val id=if(index==0)recordId else UUID.randomUUID().toString();val value=record(id,if(large)"x".repeat(220000)else canary)
                response.getJSONArray("records").put(JSONObject().put("id",id).put("revision",3).put("sequence",index+3).put("updated_at","2026-11-19T15:00:00Z").put("deleted_at",JSONObject.NULL).put("envelope_json",envelope(id,value.toString()).toString()))
                response.getJSONArray("usedIds").put(JSONObject().put("id",id))
            }
            response.getJSONArray("records").put(JSONObject().put("id",deletedId).put("revision",2).put("sequence",count+3).put("updated_at","2026-11-19T15:00:00Z").put("deleted_at","2026-11-19T15:00:00Z").put("envelope_json",JSONObject.NULL))
            response.getJSONArray("usedIds").put(JSONObject().put("id",deletedId)).put(JSONObject().put("id",prunedId))
            response.getJSONArray("owners").put(JSONObject().put("current_cursor",count+3).put("min_cursor",1).put("vault_json",original.toString()).put("vault_revision",3).put("key_version",7))
        }
        private val engine=NativePhysisSourceRuntime(app)
        val source get()=E2eeNativePhysisSource(owner,scope,captureRows={app.database.withTransaction{check();E2eePhysisRows(app.database.dao().backupDocuments(account).filter{it.kind.startsWith("physis")||it.kind=="aurora-account-key"},0,null)}},
            decrypt={row->check();cipher.decrypt(row.encrypted,"$account/aurora/$owner/account-key")},assertCurrent=::check,
            legacyPhysis={assertNotNull(vault.read("local-snapshot","physis-source")?.also{it.bytes.fill(0)});reads.incrementAndGet();JSONObject(response.toString())},
            reconciler=object:E2eePersonalSourceReconciler{override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                assertFalse((local.toString()+remote.toString()).contains(encoded));return engine.reconcile(local,previous,context,remote,assertCurrent){packet,purpose->opens.incrementAndGet();onOpen();openLegacy(packet,purpose)}
            }},independentUnlock={if(provideRecovery)E2eePhysisCredential("recovery",recovery.toCharArray())else null})
        suspend fun capture(){val raw=source.captureLocal();assertEquals(0,reads.get());try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","physis-source",raw,null)))}finally{raw.fill(0)}}
        suspend fun reconcile():E2eePathReconciliation{val saved=requireNotNull(vault.read("local-snapshot","physis-source"));try{return source.reconcile(saved.bytes,emptyList(),lease)}finally{saved.bytes.fill(0)}}
        suspend fun run():E2eePathReconciliation=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{capture();reconcile()}
        suspend fun originals()=app.database.dao().backupDocuments(account).associate{it.kind to it.encrypted}
        fun eraseAlias(){KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}}
        override fun close(){current.set(false);vault.lock();storage.close();oldKey.fill(0);recordKey.fill(0);recoveryKey.fill(0);eraseAlias();app.activateAccount(null)}
    }
    private suspend fun rejected(code:String,operation:suspend ()->Unit){try{operation();fail("Expected $code")}catch(error:IllegalStateException){assertEquals(code,error.message)}}
    @Test fun coldNativeSourceKeepsServerRecordsAndDeletionsAfterNewEncryptionAndOldKeystoreLoss()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(2,f.opens.get())
            for(row in result.content){assertFalse(row.bytes.toString(Charsets.UTF_8).contains(f.encoded));f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            val plan=E2eeMigrationLocal.plan(f.lease.migrationId,result.localContent);try{f.vault.write(plan.writes)}finally{plan.writes.forEach{it.bytes.fill(0)};result.localContent.forEach{it.bytes.fill(0)}}
            f.oldKey.fill(0);f.recordKey.fill(0);f.eraseAlias()
            val index=requireNotNull(f.vault.read("physis","personal-physis-index-v1"));val objectId=try{val rows=JSONObject(index.bytes.toString(Charsets.UTF_8)).getJSONArray("records");assertEquals(3,rows.length());
                (0 until rows.length()).map{rows.getJSONObject(it)}.single{it.get("id")==f.recordId}.getString("objectId")}finally{index.bytes.fill(0)}
            val cloud=requireNotNull(f.vault.read("physis",objectId));try{assertEquals(f.canary,JSONObject(cloud.bytes.toString(Charsets.UTF_8)).getJSONObject("record").getJSONObject("privateOptional").getString("note"))}finally{cloud.bytes.fill(0)}
            val entries=E2eeMigrationLocal.validate(plan.entries,f.lease.migrationId,setOf("physis"));val history=E2eeMigrationLocal.open(f.vault,entries.single{it.objectId=="personal-physis-local-history-v1"})
            try{assertFalse(history.bytes.toString(Charsets.UTF_8).contains(f.encoded));assertEquals("history-only",JSONObject(history.bytes.toString(Charsets.UTF_8)).getString("execution"))}finally{history.bytes.fill(0)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun protectedCaptureCanResumeAfterAliasLossWithoutServerKeyAndWithoutRecreatingTheAlias()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();val result=NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{f.capture();f.eraseAlias();f.oldKey.fill(0);withTimeout(90000){f.reconcile()}}
            assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(2,f.opens.get());assertEquals(before,f.originals());assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(f.alias))
            (result.content+result.localContent).forEach{it.bytes.fill(0)}
        }finally{f.close()}
    }
    @Test fun independentVaultNeedsItsOwnNativeRecoveryAndNeverFallsBackToTheAccountKey()=runBlocking{
        val locked=Rig(true);try{locked.seed();locked.provideRecovery=false;val before=locked.originals();rejected("E2EE_PHYSIS_UNLOCK_REQUIRED"){withTimeout(90000){locked.run()}};assertEquals(before,locked.originals())}finally{locked.close()}
        val opened=Rig(true);try{opened.seed();val result=withTimeout(90000){opened.run()};assertTrue(result.complete);assertEquals(2,opened.opens.get());(result.content+result.localContent).forEach{it.bytes.fill(0)}}finally{opened.close()}
    }
    @Test fun duplicateRawVaultEnvelopeAndPlaintextFailThePackagedStrictParserWithoutMutatingSource()=runBlocking{
        for(kind in listOf("vault","envelope","plain")){val f=Rig();try{f.seed();when(kind){
            "vault"->{val row=f.response.getJSONArray("owners").getJSONObject(0);row.put("vault_json",row.getString("vault_json").replace("\"version\":2","\"version\":2,\"versi\\u006fn\":2"))}
            "envelope"->{val row=f.response.getJSONArray("records").getJSONObject(0);row.put("envelope_json",row.getString("envelope_json").replace("\"schemaVersion\":1","\"schemaVersion\":1,\"schemaVersion\":1"))}
            else->{val plain=f.record().toString().replace("\"schemaVersion\":1","\"schemaVersion\":1,\"schemaVersion\":1");f.response.getJSONArray("records").getJSONObject(0).put("envelope_json",f.envelope(f.recordId,plain).toString())}
        };val before=f.originals();rejected("E2EE_PHYSIS_SOURCE_INVALID"){withTimeout(90000){f.run()}};assertEquals(before,f.originals());if(kind=="vault")assertEquals(0,f.opens.get())
        }finally{f.close()}}
    }
    @Test fun localRecoveryHistoryAboveSixteenMiBStreamsInPartsAndOpensWithOnlyTheNewRoot()=runBlocking{
        val f=Rig();try{f.seed(40,true);val before=f.originals();val result=withTimeout(120000){f.run()};assertTrue(result.complete)
            val history=result.localContent.single{it.objectId=="personal-physis-local-history-v1"};assertTrue(history.bytes.size>16*1024*1024)
            val plan=E2eeMigrationLocal.plan(f.lease.migrationId,result.localContent);try{f.vault.write(plan.writes)}finally{plan.writes.forEach{it.bytes.fill(0)};(result.content+result.localContent).forEach{it.bytes.fill(0)}}
            f.oldKey.fill(0);f.recordKey.fill(0);f.eraseAlias();val entries=E2eeMigrationLocal.validate(plan.entries,f.lease.migrationId,setOf("physis"));val read=E2eeMigrationLocal.open(f.vault,entries.single{it.objectId=="personal-physis-local-history-v1"})
            try{assertEquals(42,JSONObject(read.bytes.toString(Charsets.UTF_8)).getJSONArray("variants").length())}finally{read.bytes.fill(0)};assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun unavailableKeystoreUnknownLocalDataAndAccountSwitchNeverDiscardTheSource()=runBlocking{
        val lost=Rig();try{lost.seed();val before=lost.originals();lost.eraseAlias();assertTrue(runCatching{lost.run()}.isFailure);assertEquals(0,lost.reads.get());assertEquals(before,lost.originals())}finally{lost.close()}
        val unknown=Rig();try{unknown.seed();unknown.app.database.dao().putDocument(DocumentRecord(unknown.account,"physis-future","retain",1));val before=unknown.originals();rejected("E2EE_PHYSIS_FORMAT_UNSUPPORTED"){unknown.run()};assertEquals(0,unknown.reads.get());assertEquals(before,unknown.originals())}finally{unknown.close()}
        val switched=Rig();try{switched.seed();val before=switched.originals();switched.onOpen={switched.current.set(false)};rejected("E2EE_ACCOUNT_CHANGED"){withTimeout(90000){switched.run()}};assertEquals(before,switched.originals())}finally{switched.close()}
    }
}
