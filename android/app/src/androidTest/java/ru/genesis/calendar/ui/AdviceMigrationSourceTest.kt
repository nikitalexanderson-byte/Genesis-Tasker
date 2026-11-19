package ru.genesis.calendar.ui

import android.content.Context
import android.net.Uri
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
import ru.genesis.calendar.reminders.AdviceReminderScheduler
import ru.genesis.calendar.security.*
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Actual Room/Keystore producers and packaged isolated engine. Signed legacy
 * reply and public-byte port are synthetic; native pinned-reader/HTTP policy
 * and real public editions have their separate JVM/Chromium acceptance. */
@RunWith(AndroidJUnit4::class)
class AdviceMigrationSourceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="advice-source-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val current=AtomicBoolean(true);val reads=AtomicInteger();val publicReads=AtomicInteger()
        val alias="genesis.qa.advice-source.${UUID.randomUUID()}";val cipher=LocalCipher(alias)
        val preferences=AdvicePreferences().toJson().toString();val profile=sha("$owner\u0000en\u0000$preferences")
        val legacy=app.getSharedPreferences("daily_advice_day_v1",Context.MODE_PRIVATE)
        val legacyKeys=setOf(profile,"$profile:seen:$ID");var unknown=0
        val fresh=E2eeKeys.freshSecret();val newEncoded=E2eeEnvelope.encode(fresh);val root=E2eeEnvelope.importRoot(fresh).also{fresh.fill(0)}
        val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage;val vault:UnlockedE2eeVault;val epoch:Long
        val store=AdviceSnapshotStore(app,cipher);val cache:DailyAdviceCache
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        var onPublic:suspend ()->Unit={}
        private val files=linkedMapOf<String,ByteArray>();private val manifest=JSONObject().put("protocol",1).put("catalogues",JSONArray())
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
            .put("preferencesJson","{}").put("collectionsJson","[\"aurora\"]").put("notificationsJson","{}").put("psychopompiaJson","{}").put("philosophersPerDay",1)
            .put("days",JSONArray()).put("entries",JSONArray()).put("extraEntries",JSONArray()).put("metrics",JSONObject.NULL)
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner);epoch=app.workspaceEpoch
            cache=DailyAdviceCache(app,owner,"en",preferences,cipher)
            storage=E2eeSqliteStorage(app,allowCreate=true)
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-fresh-root",device.signing.private,mapOf("synthetic-fresh-root" to root)){device.signing.public})
            for(language in adviceMigrationLanguages){
                val text=JSONObject().put(ID,JSONObject().put("title","Public Advice").put("body","Synthetic public edition $language"));val bytes=text.toString().toByteArray()
                val hash=sha(bytes);val path="advice-catalogues/v1/daily/native-advice-qa-v1/$language.$hash.json";files[path]=bytes
                manifest.getJSONArray("catalogues").put(JSONObject().put("kind","daily").put("version","native-advice-qa-v1").put("language",language).put("bytes",bytes.size).put("sha256",hash).put("path",path))
            }
            files["advice-catalogues/v1/manifest.json"]=manifest.toString().toByteArray()
        }
        fun check(){check(current.get()&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        fun value(day:String=DAY,body:String="Current native Advice body"):JSONObject {
            val card=JSONObject().put("id",ID).put("dayKey",day).put("language","en").put("title","Synthetic Advice").put("body",body)
                .put("categories",JSONArray().put("hermetica")).put("sources",JSONArray()).put("dismissed",false).put("sequence",1).put("collection","aurora")
            return JSONObject().put("dayKey",day).put("state","ready").put("advice",card).put("history",JSONArray().put(JSONObject(card.toString())))
                .put("sequence",1).put("dailyLimit",9).put("remaining",8).put("canNext",true)
        }
        suspend fun seed(){
            val old=JSONObject().put("deviceDay","2026-11-18").put("response",value("2026-11-18","Previous native Advice body")).toString()
            assertTrue(legacy.edit().putString(profile,old).putString("$profile:seen:$ID","2026-11-18").commit())
            cache.today(DAY){value()};cache.recordOnce(DAY,ID){}
            store.cache(account,value());store.notificationTarget(account,DAY,DailyAdviceProtocol.parse(value()).advice);store.markDelivered(account,DAY)
            for(day in listOf("2026-11-18",DAY)){
                val entry=JSONObject().put("id",ID).put("collection","aurora").put("categories",JSONArray().put("hermetica")).put("language","ru")
                    .put("title","Synthetic base").put("body","Synthetic original server body").put("sources",JSONArray()).put("contentVersion","native-advice-qa-v1")
                response.getJSONArray("days").put(JSONObject().put("dayKey",day).put("adviceId",ID).put("entryJson",entry.toString()).put("createdAt",day+"T09:00:00Z")
                    .put("viewedAt",day+"T09:00:00Z").put("dismissedAt",JSONObject.NULL).put("selectionJson","{}"))
            }
        }
        private val engine by lazy{NativeAdviceSourceRuntime(app){path,assertCurrent->
            check();assertCurrent();onPublic();check();publicReads.incrementAndGet();check(!path.contains(ID)&&!path.contains(owner));requireNotNull(files[path]){"E2EE_ADVICE_CATALOGUE_UNAVAILABLE"}.copyOf()
        }}
        val source by lazy{E2eeNativeAdviceSource(owner,scope,captureRows={app.database.withTransaction{
            check();E2eeAdviceRows(app.database.dao().backupDocuments(account).filter{it.kind.startsWith("advice-")},emptyList(),0,null,listOf(preferences),
                JSONObject().put("preferences",JSONObject.NULL).put("mounted",JSONObject().put("language","en").put("result",value()).put("selection",ID)))
        }},decrypt={row->check();val kind=if(row.kind.startsWith("advice-cache-history-v2:"))"advice-cache-v2" else row.kind;cipher.decrypt(row.encrypted,"$account/$kind")},
            captureLegacy={known->check();val entries=legacyKeys.associateWith{key->check(key.substringBefore(":seen:") in known);requireNotNull(legacy.getString(key,null))};E2eeAdviceLegacyRows(entries,unknown)},assertCurrent=::check,
            legacyAdvice={context->check();val saved=requireNotNull(vault.read("local-snapshot","advice-source"));try{assertEquals(owner,JSONObject(saved.bytes.toString(Charsets.UTF_8)).getString("ownerId"))}finally{saved.bytes.fill(0)}
                assertEquals(lease.migrationId,context.migrationId);reads.incrementAndGet();JSONObject(response.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                    assertFalse((local.toString()+remote.toString()).contains(newEncoded));return engine.reconcile(local,previous,context,remote,assertCurrent,openLegacy)
                }
            })}
        suspend fun run():E2eePathReconciliation=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{
            val raw=source.captureLocal();try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","advice-source",raw,null)))}finally{raw.fill(0)}
            val saved=requireNotNull(vault.read("local-snapshot","advice-source"));try{source.reconcile(saved.bytes,emptyList(),lease)}finally{saved.bytes.fill(0)}
        }
        suspend fun originals()=app.database.dao().backupDocuments(account).associate{it.kind to it.encrypted}
        fun eraseOldAlias(){KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}}
        override fun close(){current.set(false);vault.lock();storage.close();legacy.edit().remove(profile).remove("$profile:seen:$ID").commit();app.activateAccount(null)}
        companion object{const val DAY="2026-11-19";const val ID="advice-0123456789abcdef01234567";fun sha(value:String)=sha(value.toByteArray());fun sha(value:ByteArray)=MessageDigest.getInstance("SHA-256").digest(value).joinToString(""){"%02x".format(it)}}
    }
    @Test fun actualRoomCacheSnapshotsAndProvenLegacyCopiesOpenUnderNewRootAfterOldAliasIsRemoved()=runBlocking{
        val f=Rig();try{
            f.seed();val before=f.originals();val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(15,f.publicReads.get());assertEquals(6,result.content.size)
            for(row in result.content){assertEquals("workspace",row.domain);assertFalse(row.objectId.contains(Rig.DAY));assertFalse(row.objectId.contains(Rig.ID));f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            f.eraseOldAlias();val history=requireNotNull(f.vault.read("workspace","personal-advice-local-history-v1"))
            try{val value=JSONObject(history.bytes.toString(Charsets.UTF_8));assertTrue(value.getJSONArray("rendered").toString().contains("Previous native Advice body"));assertFalse(value.toString().contains("canNext"));assertFalse(value.toString().contains("dailyLimit"))}finally{history.bytes.fill(0)}
            val metadata=requireNotNull(f.vault.read("workspace","personal-advice-native-metadata-v1"));try{val value=JSONObject(metadata.bytes.toString(Charsets.UTF_8));assertEquals(1,value.getJSONArray("indexes").length());assertEquals(Rig.DAY,value.getJSONArray("indexes").getJSONObject(0).getJSONArray("delivered").getString(0))}finally{metadata.bytes.fill(0)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun unknownLegacyProvenanceKeepsProtectedSnapshotAndStopsBeforeSignedOrPublicIO()=runBlocking{
        val f=Rig();try{f.seed();f.unknown=1;val before=f.originals();try{f.run();fail("Expected provenance review")}catch(error:IllegalStateException){assertEquals("E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED",error.message)}
            assertEquals(0,f.reads.get());assertEquals(0,f.publicReads.get());assertEquals(before,f.originals());assertNotNull(f.vault.read("local-snapshot","advice-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
    @Test fun aCorruptActualCiphertextNeverBecomesAnEmptyNativeSource()=runBlocking{
        val f=Rig();try{f.seed();val old=requireNotNull(f.app.database.dao().document(f.account,"advice-cache-v2"));f.app.database.dao().putDocument(old.copy(encrypted=old.encrypted+"?"));val before=f.originals()
            assertTrue(runCatching{f.run()}.isFailure);assertEquals(0,f.reads.get());assertEquals(0,f.publicReads.get());assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun accountDeactivationDuringPublicOpeningCancelsTheActualIsolatedEngine()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.onPublic={f.current.set(false);f.app.activateAccount(null)}
            try{withTimeout(90000){f.run()};fail("Expected account cancellation")}catch(error:IllegalStateException){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun persistentFenceDeniesAllOldSnapshotOperationsAndSchedulerFallbackBeforeKeyAccess()=runBlocking{
        val f=Rig();try{f.seed();NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{};val before=f.originals();f.eraseOldAlias()
            val actions=listOf<suspend ()->Unit>({f.store.saved(f.account,Rig.ID,Rig.DAY,"aurora")},{f.store.latest(f.account,Rig.DAY,"en")},{f.store.delivered(f.account,Rig.DAY)},
                {f.store.notificationTarget(f.account,Rig.DAY,null)},{f.store.cache(f.account,f.value())},{f.store.markDelivered(f.account,Rig.DAY)},{f.store.invalidate(f.account,Rig.ID,Rig.DAY,"aurora")})
            for(action in actions)try{action();fail("Fenced legacy cache access")}catch(error:AuthApiError){assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",error.code)}
            val registry=f.app.getSharedPreferences("genesis.advice.alarms.v1",Context.MODE_PRIVATE);val alarm=Uri.Builder().scheme("genesis").authority("advice-reminder").appendPath(f.account).appendPath(Rig.DAY).appendPath("09:00").appendPath("UTC").build()
            assertTrue(registry.edit().putString("scheduled",alarm.toString()).commit());AdviceReminderScheduler.restore(f.app);assertFalse(AdviceReminderScheduler.deliver(f.app,alarm));assertEquals(alarm.toString(),registry.getString("scheduled",null));assertEquals(before,f.originals())
            assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(f.alias))
        }finally{f.close()}
    }
    @Test fun completeAdviceOperationDrainsItsLateCacheCommitBeforePreparingWithoutLockInversion():Unit=runBlocking{
        val f=Rig();try{f.seed();val started=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val preparing=CompletableDeferred<Unit>()
            coroutineScope{
                val operation=async{legacyAdviceOperation(f.app,f.account){started.complete(Unit);release.await();f.store.cache(f.account,f.value(body="Late protected cache commit"))}}
                started.await();val fence=async{NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{
                    val row=requireNotNull(f.app.database.dao().document(f.account,"advice-snapshot-v1-${Rig.DAY}-aurora-${Rig.ID}"));assertTrue(f.cipher.decrypt(row.encrypted,"${f.account}/${row.kind}").contains("Late protected cache commit"));preparing.complete(Unit)
                }}
                assertNull(withTimeoutOrNull(150){preparing.await()});release.complete(Unit);withTimeout(10000){operation.await();fence.await()}
            }
            assertTrue(preparing.isCompleted)
        }finally{f.close()}
    }
    @Test fun leavingAndReturningToTheSameOwnerCannotReviveAnOldOperationOrCacheInstance()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();val started=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
            coroutineScope{val pending=async{runCatching{legacyAdviceOperation(f.app,f.account){started.complete(Unit);release.await();f.store.latest(f.account,Rig.DAY,"en")}}};started.await()
                f.app.activateAccount("foreign-${UUID.randomUUID()}");f.app.activateAccount(f.owner);release.complete(Unit);assertEquals("E2EE_ACCOUNT_CHANGED",pending.await().exceptionOrNull()?.message)}
            try{f.cache.today(Rig.DAY){error("No network")};fail("Stale cache survived owner epoch")}catch(error:IllegalStateException){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)};assertEquals(before,f.originals())
        }finally{f.close()}
    }
}
