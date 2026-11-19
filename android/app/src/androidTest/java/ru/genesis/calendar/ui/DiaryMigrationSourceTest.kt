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

/** Actual chunked Room cache, Keystore, packaged shared engine and protected
 * local migration parts. No real accounts/providers or user-device installation. */
@RunWith(AndroidJUnit4::class)
class DiaryMigrationSourceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="diary-source-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val alias="genesis.qa.diary-source.${UUID.randomUUID()}";val cipher=LocalCipher(alias);val current=AtomicBoolean(true)
        val oldKey=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(oldKey);val reads=AtomicInteger();val opens=AtomicInteger();val epoch:Long
        val fresh=E2eeKeys.freshSecret();val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage;val vault:UnlockedE2eeVault
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        val store:DiaryRoomStore;var onOpen:suspend ()->Unit={}
        val root:JSONObject
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",lease.sourceHash).put("directoryRevision",1)
            .put("notes",JSONArray()).put("deletions",JSONArray()).put("settings",JSONArray()).put("dreams",JSONArray()).put("dreamSettings",JSONArray()).put("adviceReferences",JSONArray())
            .put("legacyKey",JSONObject().put("keyMode","account").put("key",encoded))
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner);epoch=app.workspaceEpoch;store=DiaryRoomStore(app.database,account)
            storage=E2eeSqliteStorage(app,allowCreate=true)
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-root",device.signing.private,mapOf("synthetic-root" to E2eeEnvelope.importRoot(fresh))){device.signing.public});fresh.fill(0)
            root=JSONObject().put("version",1).put("owner",owner).put("hasCache",true).put("settings",JSONObject().put("syncEnabled",true).put("revision",2).put("deviceLocalOnly",false))
                .put("dreamSettings",JSONObject().put("todayMode","morning").put("revision",1)).put("deleted",JSONArray()).put("records",JSONArray()).put("drafts",JSONArray())
        }
        fun check(){check(current.get()&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        fun note(id:String,body:String)=JSONObject().put("version",1).put("id",id).put("title","Synthetic private title").put("body",body).put("color","sage")
            .put("customColor","#c0ffee").put("createdAt","2026-11-19T09:00:00Z").put("updatedAt","2026-11-19T09:00:00Z").put("archived",false).put("pinned",false).put("reaction",JSONObject.NULL)
        fun row(note:JSONObject,local:Boolean)=JSONObject().put("note",note).put("revision",if(local)0 else 1).put("draftKey",JSONObject.NULL)
            .put("pending",JSONObject.NULL).put("pendingNote",JSONObject.NULL).put("localOnly",local).put("uploadId",if(local)"uncertain-copy" else JSONObject.NULL)
        suspend fun writeRoot(raw:String=root.toString()){store.write(cipher.encrypt(raw,"$account/diary-v1:$owner"))}
        suspend fun seed(){
            root.getJSONArray("records").put(row(note("device-only","Synthetic device-only diary canary"),true))
            val draft=note("unsent","Synthetic unsent diary canary");val sealed=WorkspaceCipher.encrypt(draft.toString().toByteArray(),oldKey,"genesis-mindmap-v1:$owner:diary-note:v1:unsent".toByteArray())
            root.getJSONArray("drafts").put(row(draft,false).put("revision",0).put("draftKey","draft:old:unsent").put("pending",JSONObject().put("schemaVersion",1).put("expectedRevision",0).put("iv",sealed.iv).put("ciphertext",sealed.ciphertext)).put("pendingNote",draft))
            writeRoot();app.database.dao().putDocument(DocumentRecord(account,"aurora-account-key",cipher.encrypt(encoded,"$account/aurora/$owner/account-key"),1))
            val server=note("server-dream","Synthetic cloud diary canary").put("dream",JSONObject().put("day","2026-11-18").put("timeZone","UTC").put("lucid",true))
            val remote=WorkspaceCipher.encrypt(server.toString().toByteArray(),oldKey,"genesis-mindmap-v1:$owner:diary-note:v1:server-dream".toByteArray())
            response.getJSONArray("notes").put(JSONObject().put("id","server-dream").put("revision",2).put("schema_version",1).put("iv",remote.iv).put("ciphertext",remote.ciphertext).put("payload_hash","a".repeat(64)).put("updated_at","2026-11-19T09:00:00Z"))
            response.getJSONArray("dreams").put(JSONObject().put("note_id","server-dream").put("dream_day","2026-11-18").put("time_zone","UTC"))
        }
        private val engine=NativeDiarySourceRuntime(app)
        val source by lazy{E2eeNativeDiarySource(owner,scope,captureRows={app.database.withTransaction{
            check();E2eeDiaryRows(app.database.dao().backupDocuments(account).filter{it.kind.startsWith("diary-v1")||it.kind=="aurora-account-key"},0,null,
                JSONObject().put("records",JSONArray()).put("editors",JSONArray().put(JSONObject().put("source","blank-editor").put("revision",0).put("note",note("blank","")))))
        }},decryptCache={check();cipher.decrypt(it,"$account/diary-v1:$owner")},decryptAccountKey={check();cipher.decrypt(it.encrypted,"$account/aurora/$owner/account-key")},assertCurrent=::check,
            legacyDiary={assertNotNull(vault.read("local-snapshot","diary-source")?.also{it.bytes.fill(0)});assertEquals(lease.migrationId,it.migrationId);reads.incrementAndGet();JSONObject(response.toString())},
            reconciler=object:E2eePersonalSourceReconciler{override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                assertFalse((local.toString()+remote.toString()).contains(encoded));return engine.reconcile(local,previous,context,remote,assertCurrent){packet,purpose->opens.incrementAndGet();onOpen();openLegacy(packet,purpose)}
            }})}
        suspend fun run():E2eePathReconciliation=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{
            val raw=source.captureLocal();assertEquals(0,reads.get());try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","diary-source",raw,null)))}finally{raw.fill(0)}
            val saved=requireNotNull(vault.read("local-snapshot","diary-source"));try{source.reconcile(saved.bytes,emptyList(),lease)}finally{saved.bytes.fill(0)}
        }
        suspend fun originals()=app.database.dao().backupDocuments(account).associate{it.kind to it.encrypted}
        fun eraseAlias(){KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}}
        override fun close(){current.set(false);vault.lock();storage.close();oldKey.fill(0);eraseAlias();app.activateAccount(null)}
    }
    @Test fun actualChunkedDiaryDraftAndDreamSurviveNewEncryptionWithPrivatePlacementAndNoLegacyKey()=runBlocking{
        val f=Rig();try{
            f.seed();val before=f.originals();assertTrue(before.keys.any{it.startsWith("diary-v1/")});val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(2,f.opens.get())
            assertFalse(result.content.any{it.bytes.toString(Charsets.UTF_8).contains("Synthetic device-only diary canary")||it.bytes.toString(Charsets.UTF_8).contains("Synthetic unsent diary canary")})
            for(row in result.content){assertEquals("diary",row.domain);assertFalse(row.bytes.toString(Charsets.UTF_8).contains(f.encoded));f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            val plan=E2eeMigrationLocal.plan(f.lease.migrationId,result.localContent)
            try{f.vault.write(plan.writes)}finally{plan.writes.forEach{it.bytes.fill(0)};result.localContent.forEach{it.bytes.fill(0)}}
            val entries=E2eeMigrationLocal.validate(plan.entries,f.lease.migrationId,setOf("diary"));f.oldKey.fill(0);f.eraseAlias()
            val local=entries.single{it.objectId=="personal-diary-local-history-v1"};val restored=E2eeMigrationLocal.open(f.vault,local)
            try{val value=JSONObject(restored.bytes.toString(Charsets.UTF_8));assertEquals("Synthetic unsent diary canary",value.getJSONArray("drafts").getJSONObject(0).getJSONObject("note").getString("body"))
                assertTrue(value.getJSONArray("drafts").length()>=2);assertEquals("uncertain-copy",value.getJSONArray("history").getJSONObject(0).getString("uploadId"))}finally{restored.bytes.fill(0)}
            val index=requireNotNull(f.vault.read("diary","personal-diary-index-v1"));val id=try{JSONObject(index.bytes.toString(Charsets.UTF_8)).getJSONArray("records").getJSONObject(0).getString("objectId")}finally{index.bytes.fill(0)}
            val cloud=requireNotNull(f.vault.read("diary",id));try{assertEquals("Synthetic cloud diary canary",JSONObject(cloud.bytes.toString(Charsets.UTF_8)).getJSONObject("selected").getJSONObject("note").getString("body"))}finally{cloud.bytes.fill(0)}
            assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun duplicateNativePlaintextIsRetainedAndRejectedBySharedStrictParser()=runBlocking{
        val f=Rig();try{f.seed();f.writeRoot(f.root.toString().replace("\"hasCache\":true","\"hasCache\":true,\"hasC\\u0061che\":false"));val before=f.originals()
            try{withTimeout(90000){f.run()};fail("Expected duplicate JSON refusal")}catch(error:IllegalStateException){assertEquals("E2EE_DIARY_SOURCE_INVALID",error.message)}
            assertEquals(before,f.originals());assertNotNull(f.vault.read("local-snapshot","diary-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
    @Test fun lostKeystoreStopsBeforeNetworkWithoutCreatingAReplacementOverExistingChunks()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.eraseAlias();assertTrue(runCatching{f.run()}.isFailure);assertEquals(0,f.reads.get());assertEquals(before,f.originals());assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(f.alias))}finally{f.close()}
    }
    @Test fun incompleteDanglingChunksAreNeverSilentlyOmitted()=runBlocking{
        val f=Rig();try{f.seed();f.app.database.dao().putDocument(DocumentRecord(f.account,"diary-v1/11111111-1111-4111-8111-111111111111/1","retained",1));val before=f.originals()
            try{f.run();fail("Expected retained source refusal")}catch(error:IllegalStateException){assertEquals("E2EE_DIARY_NATIVE_HISTORY_REVIEW_REQUIRED",error.message)};assertEquals(0,f.reads.get());assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun switchingAwayAndBackCancelsRealLegacyOpeningWithoutDroppingAnyChunk()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.onOpen={f.app.activateAccount(null);f.app.activateAccount(f.owner)}
            try{withTimeout(90000){f.run()};fail("Expected owner epoch cancellation")}catch(error:IllegalStateException){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)};assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun repositoryOwnerPermitDrainsAnEncryptedDraftBeforeMigrationAndDeniesItsLaterCleanup()=runBlocking{
        val f=Rig();try{f.seed();val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();var hold=false
            val store=object:DiaryStore{override suspend fun read()=f.store.read();override suspend fun write(ciphertext:String){if(hold){entered.complete(Unit);release.await()};f.store.write(ciphertext)}}
            val gateway=object:DiaryGateway{override fun check()=f.check();override suspend fun <T> withLegacyOperation(operation:suspend ()->T):T=NativeLegacyOperationPermit.run(f.app.database,f.account,::check,operation)
                override suspend fun workspace():JSONObject=error("No legacy HTTP");override suspend fun request(path:String,body:JSONObject?):JSONObject=error("No legacy HTTP")}
            val cache=object:DiaryCacheCipher{override fun encrypt(plaintext:String)=f.cipher.encrypt(plaintext,"${f.account}/diary-v1:${f.owner}");override fun decrypt(ciphertext:String)=f.cipher.decrypt(ciphertext,"${f.account}/diary-v1:${f.owner}")}
            val repository=DiaryRepository(f.owner,gateway,store,cache);repository.loadCached();hold=true
            val editing=async(Dispatchers.IO){repository.keepDraft(DiaryNote.parse(f.note("new-draft","Synthetic final unsent before fence")))};entered.await()
            val capture=CompletableDeferred<String>();val migration=async(Dispatchers.IO){NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{capture.complete(requireNotNull(f.store.read()))}}
            assertNull(withTimeoutOrNull(150){capture.await()});release.complete(Unit);val draft=editing.await();migration.await()
            assertTrue(cache.decrypt(capture.await()).contains("Synthetic final unsent before fence"));val before=f.originals()
            try{repository.discardDraft(requireNotNull(draft.draftKey));fail("Expected legacy write denial")}catch(error:AuthApiError){assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",error.message)};assertEquals(before,f.originals())
        }finally{f.close()}
    }
}
