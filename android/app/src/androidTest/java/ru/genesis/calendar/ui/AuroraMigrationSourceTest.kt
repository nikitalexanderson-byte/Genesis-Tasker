package ru.genesis.calendar.ui

import ru.genesis.calendar.data.withTransaction
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
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Actual Room/Keystore, new-root SQLite vault, JCA and bundled network-disabled
 * WebView reconciler. No user account, provider IO or production cutover. */
@RunWith(AndroidJUnit4::class)
class AuroraMigrationSourceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="aurora-source-${UUID.randomUUID()}"
        val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val current=AtomicBoolean(true);val reads=AtomicInteger();val opens=AtomicInteger()
        val oldKey=E2eeKeys.freshSecret();val oldEncoded=Base64.getEncoder().encodeToString(oldKey)
        val fresh=E2eeKeys.freshSecret();val newEncoded=E2eeEnvelope.encode(fresh);val root=E2eeEnvelope.importRoot(fresh).also{fresh.fill(0)}
        val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage
        val vault:UnlockedE2eeVault
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        private val localCipher=LocalCipher()
        var onOpen:suspend ()->Unit={}
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
            .put("workspace",JSONObject.NULL).put("results",JSONArray()).put("legacyKey",JSONObject().put("keyMode","account").put("key",oldEncoded))
        init {
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner)
            storage=E2eeSqliteStorage(app,allowCreate=true)
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-fresh-root",device.signing.private,mapOf("synthetic-fresh-root" to root)){device.signing.public})
        }
        fun check(){check(current.get()&&app.workspaceScope==account){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        private fun document(note:String,count:Int):JSONObject {
            val fixture=JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("backup-journal-aurora-v1.json").bufferedReader().use{it.readText()})
            assertTrue(fixture.getBoolean("synthetic"));val value=fixture.getJSONObject("document").put("ownerId",owner)
            val template=value.getJSONArray("sessions").getJSONObject(0);val sessions=JSONArray()
            repeat(count){index->val session=JSONObject(template.toString()).put("ownerId",owner).put("id","synthetic-session-$index").put("observationNote",note)
                session.getJSONObject("context").put("situationId","synthetic-session-$index");sessions.put(session)}
            return value.put("sessions",sessions)
        }
        suspend fun seed(conflict:Boolean=false,count:Int=1){
            val gateway=object:AuroraGateway{
                override fun check()=this@Rig.check()
                override suspend fun workspace()=JSONObject().put("workspace",JSONObject().put("keyMode","account").put("key",oldEncoded))
                override suspend fun request(method:String,path:String,body:JSONObject?)=error("Synthetic editor IO disabled")
                override suspend fun billing(method:String,path:String,body:JSONObject?)=error("Synthetic billing disabled")
            }
            val store=AuroraNativeStore(app,owner,account,gateway)
            try{
                val base=JSONObject().put("version",1).put("ownerId",owner).put("sessions",JSONArray()).put("removed",JSONArray())
                for((index,note) in listOf("Older synthetic private draft","Current synthetic private draft").withIndex()){
                    val value=document(note,count);val sealed=store.seal(value,"aurora-workspace:v1").put("expectedRevision",0)
                    store.setItem("genesis-aurora-workspace-v1:$owner:pending:writer:11111111-1111-4111-8111-111111111111:${index+1}:pending",
                        JSONObject().put("envelope",sealed).put("base",store.seal(base,"aurora-workspace-base:v1")).toString())
                }
                if(conflict)store.setItem("genesis-aurora-workspace-v1:$owner:pending:writer:22222222-2222-4222-8222-222222222222:1:pending",
                    JSONObject().put("envelope",store.seal(document("Independent conflicting branch",count),"aurora-workspace:v1").put("expectedRevision",0))
                        .put("base",store.seal(base,"aurora-workspace-base:v1")).toString())
            }finally{store.close()}
        }
        private val engine=NativeAuroraSourceRuntime(app)
        val source by lazy{E2eeNativeAuroraSource(owner,scope,captureRows={app.database.withTransaction{
            check();E2eeAuroraRows(app.database.dao().backupDocuments(account).filter{it.kind.startsWith("aurora-")},emptyList(),0,null,null)
        }},decrypt={row->check();val kind=if(row.kind=="aurora-account-key")"account-key" else row.kind
            localCipher.decrypt(row.encrypted,"$account/aurora/$owner/$kind")},assertCurrent=::check,
            legacyAurora={context->
                check();val captured=vault.read("local-snapshot","aurora-source")?:error("E2EE_SNAPSHOT_REQUIRED")
                try{assertEquals(owner,JSONObject(captured.bytes.toString(Charsets.UTF_8)).getString("ownerId"))}finally{captured.bytes.fill(0)}
                assertEquals(lease.migrationId,context.migrationId);reads.incrementAndGet();JSONObject(response.toString())
            },reconciler=object:E2eeAuroraReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation {
                    val wire=local.toString()+remote.toString();assertFalse(wire.contains(oldEncoded));assertFalse(wire.contains(newEncoded))
                    return engine.reconcile(local,previous,context,remote,assertCurrent){envelope,purpose->opens.incrementAndGet();onOpen();openLegacy(envelope,purpose)}
                }
            })}
        suspend fun run():E2eePathReconciliation=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{
            val snapshot=source.captureLocal();assertEquals(0,reads.get())
            try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","aurora-source",snapshot,null)))}finally{snapshot.fill(0)}
            val record=requireNotNull(storage.get(UnlockedE2eeVault.recordKey(vault.requireOpen(),"local-snapshot","aurora-source")))
            val wire=record.envelope.toJson().toString();assertFalse(wire.contains(oldEncoded));assertFalse(wire.contains("Current synthetic private draft"));assertFalse(wire.contains(newEncoded))
            val saved=requireNotNull(vault.read("local-snapshot","aurora-source"))
            try{source.reconcile(saved.bytes,emptyList(),lease)}finally{saved.bytes.fill(0)}
        }
        suspend fun originals()=app.database.dao().backupDocuments(account).filter{it.kind.startsWith("aurora-")}.associate{it.kind to it.encrypted}
        override fun close(){current.set(false);vault.lock();storage.close();oldKey.fill(0);app.activateAccount(null)}
    }
    @Test fun realSourceMigratesChunkedJournalsWithoutExposingKeysAndNewRootReadsAfterLegacyKeyIsCleared()=runBlocking {
        val f=Rig()
        try{
            f.seed(count=40);val before=f.originals();val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(1,f.reads.get());assertTrue(f.opens.get()>=4)
            val current=result.content.single{it.objectId=="personal-aurora-workspace-v1"};val document=JSONObject(current.bytes.toString(Charsets.UTF_8)).getJSONObject("document")
            assertEquals(40,document.getJSONArray("sessions").length());assertEquals("Current synthetic private draft",document.getJSONArray("sessions").getJSONObject(0).getString("observationNote"))
            val history=JSONObject(result.content.single{it.objectId=="personal-aurora-local-history-v1"}.bytes.toString(Charsets.UTF_8));assertEquals(2,history.getJSONArray("snapshots").length())
            for(row in result.content){f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            f.oldKey.fill(0);val opened=requireNotNull(f.vault.read("aurora","personal-aurora-workspace-v1"))
            try{assertEquals(40,JSONObject(opened.bytes.toString(Charsets.UTF_8)).getJSONObject("document").getJSONArray("sessions").length())}finally{opened.bytes.fill(0)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun genuineConflictingNativeWritersBlockCompletionAndRetainEveryCiphertext()=runBlocking {
        val f=Rig()
        try{f.seed(conflict=true);val before=f.originals()
            try{withTimeout(90000){f.run()};fail("Expected explicit conflict review")}catch(error:IllegalStateException){assertEquals("E2EE_AURORA_CONFLICT_REVIEW_REQUIRED",error.message)}
            assertEquals(before,f.originals());assertNotNull(f.vault.read("local-snapshot","aurora-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
    @Test fun nativeAccountChangeDuringLegacyOpeningStopsTheBundledEngineWithoutDiscardingSources()=runBlocking {
        val f=Rig()
        try{f.seed();val before=f.originals();f.onOpen={f.current.set(false);f.app.activateAccount(null)}
            try{withTimeout(90000){f.run()};fail("Expected account binding failure")}catch(error:IllegalStateException){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
}
