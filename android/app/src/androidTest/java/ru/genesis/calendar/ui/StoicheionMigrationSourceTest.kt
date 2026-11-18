package ru.genesis.calendar.ui

import androidx.room.withTransaction
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
import java.time.LocalDate
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Actual isolated Room, AndroidKeyStore, protected SQLite capture and packaged
 * shared validator. Legacy response is synthetic; signed PHP transport has its
 * own independent contract test. No user device or product migration is used. */
@RunWith(AndroidJUnit4::class)
class StoicheionMigrationSourceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="stoicheion-source-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val current=AtomicBoolean(true);val reads=AtomicInteger();val opens=AtomicInteger()
        val oldKey=E2eeKeys.freshSecret();val oldEncoded=Base64.getEncoder().encodeToString(oldKey)
        val fresh=E2eeKeys.freshSecret();val newEncoded=E2eeEnvelope.encode(fresh);val root=E2eeEnvelope.importRoot(fresh).also{fresh.fill(0)}
        val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage;val vault:UnlockedE2eeVault
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        private val cipher=LocalCipher();var mounted:JSONObject?=null;var onOpen:suspend ()->Unit={}
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
            .put("workspace",JSONObject.NULL).put("draws",JSONArray()).put("spreadCards",JSONArray()).put("timelineSessions",JSONArray()).put("timelineWindows",JSONArray())
            .put("legacyKey",JSONObject().put("keyMode","account").put("key",oldEncoded))
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner)
            storage=E2eeSqliteStorage(app,allowCreate=true)
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-fresh-root",device.signing.private,mapOf("synthetic-fresh-root" to root)){device.signing.public})
        }
        fun check(){check(current.get()&&app.workspaceScope==account){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        private fun document():JSONObject{
            val value=JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee/stoicheion-content-v1.json").bufferedReader().use{it.readText()})
            assertTrue(value.getBoolean("synthetic"));return value.getJSONObject("document")
        }
        suspend fun seed(conflict:Boolean=false){
            val now="2026-10-22T09:00:00Z";val base=document();val server=JSONObject(base.toString())
            if(conflict){server.getJSONArray("works").getJSONObject(0).getJSONObject("snapshot").put("reflection","Server private reflection")
                val local=JSONObject(base.toString());local.getJSONArray("works").getJSONObject(0).getJSONObject("snapshot").put("reflection","Unsent private reflection")
                mounted=JSONObject().put("current",JSONObject().put("document",local).put("base",base).put("revision",1)).put("draws",JSONArray()).put("timeline",JSONObject.NULL)}
            val old=WorkspaceCipher.encrypt(server.toString().toByteArray(),oldKey,"genesis-mindmap-v1:$owner:stoicheion-workspace:v1".toByteArray())
            response.put("workspace",JSONObject().put("iv",old.iv).put("ciphertext",old.ciphertext).put("revision",1).put("updatedAt",now))
            val days=JSONObject();repeat(40){index->val day=LocalDate.of(2026,9,1).plusDays(index.toLong()).toString()
                days.put(day,JSONObject().put("daily",JSONObject().put("seed",index+1).put("attempts",2).put("firstAt",1792659600000L).put("rerollDeadline",1792659600000L)
                    .put("unlimited",true).put("serverRerollAllowed",true).put("cardRevision",0)))}
            val plain=JSONObject().put("days",days).toString()
            app.database.withTransaction{app.database.dao().putDocument(DocumentRecord(account,"stoicheion-draws",cipher.encrypt(plain,"$account/stoicheion-draws"),1))}
        }
        private val engine=NativeStoicheionSourceRuntime(app)
        val source by lazy{E2eeNativeStoicheionSource(owner,scope,captureRows={app.database.withTransaction{
            check();E2eeStoicheionRows(app.database.dao().backupDocuments(account).filter{it.kind.startsWith("stoicheion-")},emptyList(),0,null,mounted)
        }},decrypt={row->check();cipher.decrypt(row.encrypted,"$account/${row.kind}")},assertCurrent=::check,
            legacyStoicheion={context->check();val saved=vault.read("local-snapshot","stoicheion-source")?:error("E2EE_SNAPSHOT_REQUIRED")
                try{assertEquals(owner,JSONObject(saved.bytes.toString(Charsets.UTF_8)).getString("ownerId"))}finally{saved.bytes.fill(0)}
                assertEquals(lease.migrationId,context.migrationId);reads.incrementAndGet();JSONObject(response.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                    val wire=local.toString()+remote.toString();assertFalse(wire.contains(oldEncoded));assertFalse(wire.contains(newEncoded))
                    return engine.reconcile(local,previous,context,remote,assertCurrent){envelope,purpose->opens.incrementAndGet();onOpen();openLegacy(envelope,purpose)}
                }
            })}
        suspend fun run():E2eePathReconciliation=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{
            val snapshot=source.captureLocal();assertEquals(0,reads.get())
            try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","stoicheion-source",snapshot,null)))}finally{snapshot.fill(0)}
            val record=requireNotNull(storage.get(UnlockedE2eeVault.recordKey(vault.requireOpen(),"local-snapshot","stoicheion-source")))
            val wire=record.envelope.toJson().toString();assertFalse(wire.contains(oldEncoded));assertFalse(wire.contains("Unsent private reflection"));assertFalse(wire.contains(newEncoded))
            val saved=requireNotNull(vault.read("local-snapshot","stoicheion-source"));try{source.reconcile(saved.bytes,emptyList(),lease)}finally{saved.bytes.fill(0)}
        }
        suspend fun originals()=app.database.dao().backupDocuments(account).filter{it.kind.startsWith("stoicheion-")}.associate{it.kind to it.encrypted}
        override fun close(){current.set(false);vault.lock();storage.close();oldKey.fill(0);app.activateAccount(null)}
    }
    @Test fun nativeDrawHistoryAndPrivatePracticesOpenWithNewRootAfterTheOldKeyIsCleared()=runBlocking{
        val f=Rig();try{
            f.seed();val before=f.originals();val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(1,f.opens.get())
            val history=JSONObject(result.content.single{it.objectId=="personal-stoicheion-draw-history-v1"}.bytes.toString(Charsets.UTF_8))
            assertEquals(40,history.getJSONObject("device").getJSONObject("native").getJSONArray("draws").length());assertFalse(history.toString().contains("unlimited"));assertFalse(history.toString().contains("serverRerollAllowed"))
            for(row in result.content){f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            f.oldKey.fill(0);val opened=requireNotNull(f.vault.read("stoicheion","personal-stoicheion-workspace-v1"))
            try{assertEquals("A synthetic private reflection",JSONObject(opened.bytes.toString(Charsets.UTF_8)).getJSONObject("document").getJSONArray("works").getJSONObject(0).getJSONObject("snapshot").getString("reflection"))}finally{opened.bytes.fill(0)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun aGenuinePracticeConflictRetainsTheProtectedCaptureAndOriginalRoomBytes()=runBlocking{
        val f=Rig();try{f.seed(conflict=true);val before=f.originals()
            try{withTimeout(90000){f.run()};fail("Expected conflict review")}catch(error:IllegalStateException){assertEquals("E2EE_STOICHEION_CONFLICT_REVIEW_REQUIRED",error.message)}
            assertEquals(before,f.originals());assertNotNull(f.vault.read("local-snapshot","stoicheion-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
    @Test fun actualAccountDeactivationDuringOpeningInvalidatesTheIsolatedEngine()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.onOpen={f.current.set(false);f.app.activateAccount(null)}
            try{withTimeout(90000){f.run()};fail("Expected account binding failure")}catch(error:IllegalStateException){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
}
