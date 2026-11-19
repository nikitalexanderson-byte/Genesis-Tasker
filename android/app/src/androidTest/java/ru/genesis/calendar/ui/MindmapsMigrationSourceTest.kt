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

/** Synthetic real Room, Keystore, packaged shared validator and new-root local
 * storage. No personal accounts, provider operations or release installation. */
@RunWith(AndroidJUnit4::class)
class MindmapsMigrationSourceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="mindmaps-source-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val alias="genesis.qa.mindmaps-source.${UUID.randomUUID()}";val cipher=LocalCipher(alias);val current=AtomicBoolean(true)
        val oldKey=E2eeKeys.freshSecret();val encoded=Base64.getEncoder().encodeToString(oldKey);val reads=AtomicInteger();val opens=AtomicInteger();val epoch:Long
        val fresh=E2eeKeys.freshSecret();val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage;val vault:UnlockedE2eeVault
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",lease.sourceHash).put("directoryRevision",1)
            .put("maps",JSONArray()).put("versions",JSONArray()).put("receipts",JSONArray()).put("deletions",JSONArray()).put("legacyKey",JSONObject().put("keyMode","account").put("key",encoded))
        val png="iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j2coAAAAASUVORK5CYII="
        val root=JSONArray();var onOpen:suspend ()->Unit={}
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner);epoch=app.workspaceEpoch;storage=E2eeSqliteStorage(app,allowCreate=true)
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-root",device.signing.private,mapOf("synthetic-root" to E2eeEnvelope.importRoot(fresh))){device.signing.public});fresh.fill(0)
        }
        fun check(){check(current.get()&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        fun map(id:String,title:String)=JSONObject().put("schemaVersion",1).put("id",id).put("title",title).put("description","").put("projectId",JSONObject.NULL).put("pinned",false).put("archived",false)
            .put("nodes",JSONArray().put(JSONObject().put("id","root").put("parentId",JSONObject.NULL).put("kind","idea").put("text",title).put("note","Original private note").put("tags",JSONArray())
                .put("presentation",JSONObject().put("image",JSONObject().put("data","data:image/png;base64,$png").put("alt","Original embedded picture").put("fit","contain"))))).put("links",JSONArray())
        suspend fun writeRoot(raw:String=root.toString()){app.database.dao().putDocument(DocumentRecord(account,"mindmaps",cipher.encrypt(raw,"$account/mindmaps"),1))}
        suspend fun seed(){
            val original=map("native-draft","Synthetic native unsent original");val sealed=WorkspaceCipher.encrypt(original.toString().toByteArray(),oldKey,"genesis-mindmap-v1:$owner:map:native-draft".toByteArray())
            root.put(JSONObject().put("document",map("native-draft","Synthetic later native private edit")).put("revision",0).put("dirty",true).put("pendingDocument",original)
                .put("pending",JSONObject().put("schemaVersion",2).put("expectedRevision",0).put("operationId","old-native-write").put("iv",sealed.iv).put("ciphertext",sealed.ciphertext)))
            writeRoot();app.database.dao().putDocument(DocumentRecord(account,"aurora-account-key",cipher.encrypt(encoded,"$account/aurora/$owner/account-key"),1))
            app.database.dao().putDocument(DocumentRecord(account,"mindmap-view:native-draft",cipher.encrypt("{ \"mode\":\"map\", \"zoom\":1.5, \"viewport\":{\"left\":17,\"top\":42} }","$account/mindmap-view:native-draft"),1))
            app.database.dao().putDocument(DocumentRecord(account,"mindmap-conversion",cipher.encrypt("{ \"title\":\"Synthetic unsent native conversion\", \"futureField\":true }","$account/mindmap-conversion"),0))
            val server=map("server-map","Synthetic acknowledged map");fun sealedRow(revision:Int,title:String):JSONObject{
                val value=map("server-map",title);val packet=WorkspaceCipher.encrypt(value.toString().toByteArray(),oldKey,"genesis-mindmap-v1:$owner:map:server-map".toByteArray())
                return JSONObject().put("map_id","server-map").put("revision",revision).put("schema_version",2).put("iv",packet.iv).put("ciphertext",packet.ciphertext).put("updated_at","2026-11-19T10:00:00Z")
            }
            val head=sealedRow(30,server.getString("title"));head.remove("map_id");head.put("id","server-map");response.getJSONArray("maps").put(head)
            for(revision in 1..25)response.getJSONArray("versions").put(sealedRow(revision,"Synthetic historical map $revision"))
            response.getJSONArray("receipts").put(JSONObject().put("map_id","server-map").put("operation_id","uncertain-server-write").put("payload_hash","a".repeat(64)).put("revision",29))
        }
        fun largeServerHistory(){
            val body="x".repeat(12000)
            fun row(revision:Int,title:String):JSONObject{
                val value=map("server-map",title);val nodes=value.getJSONArray("nodes")
                for(index in 0 until 54)nodes.put(JSONObject().put("id","node-$index").put("parentId","root").put("kind","idea").put("text","Synthetic child $index").put("note",body))
                check(value.toString().toByteArray().size<2000000)
                val packet=WorkspaceCipher.encrypt(value.toString().toByteArray(),oldKey,"genesis-mindmap-v1:$owner:map:server-map".toByteArray())
                return JSONObject().put("map_id","server-map").put("revision",revision).put("schema_version",2).put("iv",packet.iv).put("ciphertext",packet.ciphertext).put("updated_at","2026-11-19T10:00:00Z")
            }
            val versions=JSONArray();var cipherBytes=0
            for(revision in 1..25){val version=row(revision,"Synthetic large version $revision");cipherBytes+=version.getString("ciphertext").length;versions.put(version)}
            check(cipherBytes>16*1024*1024&&cipherBytes<40000000)
            val head=row(30,"Synthetic large acknowledged map");head.remove("map_id");head.put("id","server-map")
            response.put("maps",JSONArray().put(head)).put("versions",versions)
        }
        private val engine=NativeMindmapsSourceRuntime(app)
        val source get()=E2eeNativeMindmapsSource(owner,scope,captureRows={app.database.withTransaction{check();E2eeMindmapsRows(app.database.dao().backupDocuments(account).filter{it.kind.startsWith("mindmap")||it.kind=="aurora-account-key"},0,null,
            JSONObject().put("records",JSONArray()).put("editors",JSONArray().put(JSONObject().put("source","new-dialog").put("document",JSONObject.NULL).put("revision",0).put("state",JSONObject().put("title","Synthetic unfinished new map")))))
        }},decrypt={row->check();cipher.decrypt(row.encrypted,if(row.kind=="aurora-account-key")"$account/aurora/$owner/account-key" else "$account/${row.kind}")},assertCurrent=::check,
            legacyMindmaps={assertNotNull(vault.read("local-snapshot","mindmaps-source")?.also{it.bytes.fill(0)});reads.incrementAndGet();JSONObject(response.toString())},
            reconciler=object:E2eePersonalSourceReconciler{override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                assertFalse((local.toString()+remote.toString()).contains(encoded));return engine.reconcile(local,previous,context,remote,assertCurrent){packet,purpose->opens.incrementAndGet();onOpen();openLegacy(packet,purpose)}
            }})
        suspend fun run():E2eePathReconciliation=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{
            val raw=source.captureLocal();assertEquals(0,reads.get());try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","mindmaps-source",raw,null)))}finally{raw.fill(0)}
            val captured=requireNotNull(vault.read("local-snapshot","mindmaps-source"));try{source.reconcile(captured.bytes,emptyList(),lease)}finally{captured.bytes.fill(0)}
        }
        suspend fun originals()=app.database.dao().backupDocuments(account).associate{it.kind to it.encrypted}
        fun eraseAlias(){KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}}
        override fun close(){current.set(false);vault.lock();storage.close();oldKey.fill(0);eraseAlias();app.activateAccount(null)}
    }
    @Test fun actualMapsHistoryImagesRequestsViewsAndBlankEditorsSurviveNewEncryptionWithoutAnyLegacyKey()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(27,f.opens.get())
            assertEquals(1,result.content.count{it.domain=="attachment"});assertFalse(result.content.filter{it.domain=="mindmap"}.any{it.bytes.toString(Charsets.UTF_8).contains("Synthetic later native private edit")||it.bytes.toString(Charsets.UTF_8).contains("Synthetic unsent native conversion")})
            for(row in result.content){assertFalse(row.bytes.toString(Charsets.UTF_8).contains(f.encoded));f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            val plan=E2eeMigrationLocal.plan(f.lease.migrationId,result.localContent);try{f.vault.write(plan.writes)}finally{plan.writes.forEach{it.bytes.fill(0)};result.localContent.forEach{it.bytes.fill(0)}}
            val entries=E2eeMigrationLocal.validate(plan.entries,f.lease.migrationId,setOf("mindmap","attachment"));f.oldKey.fill(0);f.eraseAlias()
            val local=E2eeMigrationLocal.open(f.vault,entries.single{it.objectId=="personal-mindmap-local-work-v1"});try{val value=JSONObject(local.bytes.toString(Charsets.UTF_8));assertEquals("Synthetic later native private edit",value.getJSONArray("drafts").getJSONObject(0).getJSONObject("document").getString("title"))
                assertEquals("Synthetic native unsent original",value.getJSONArray("drafts").getJSONObject(0).getJSONObject("pendingDocument").getString("title"));assertEquals(1.5,value.getJSONArray("views").getJSONObject(0).getJSONObject("value").getDouble("zoom"),0.0)
                assertEquals("Synthetic unsent native conversion",value.getJSONArray("conversions").getJSONObject(0).getJSONObject("value").getString("title"));assertEquals("Synthetic unfinished new map",value.getJSONArray("editors").getJSONObject(0).getJSONObject("state").getString("title"))
            }finally{local.bytes.fill(0)}
            val index=requireNotNull(f.vault.read("mindmap","personal-mindmap-index-v1"));val id=try{val value=JSONObject(index.bytes.toString(Charsets.UTF_8));assertEquals(25,value.getJSONArray("versions").length());value.getJSONArray("records").getJSONObject(0).getString("objectId")}finally{index.bytes.fill(0)}
            val cloud=requireNotNull(f.vault.read("mindmap",id));val image=try{val value=JSONObject(cloud.bytes.toString(Charsets.UTF_8)).getJSONObject("selected").getJSONObject("document");assertEquals("Synthetic acknowledged map",value.getString("title"));value.getJSONArray("nodes").getJSONObject(0).getJSONObject("presentation").getJSONObject("image").getJSONObject("dataRef").getString("objectId")}finally{cloud.bytes.fill(0)}
            val file=requireNotNull(f.vault.read("attachment",image));try{assertArrayEquals(Base64.getDecoder().decode(f.png),file.bytes)}finally{file.bytes.fill(0)};assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun duplicateNativeJsonIsRetainedAndRefusedByTheActualSharedParser()=runBlocking{
        val f=Rig();try{f.seed();f.writeRoot(f.root.toString().replace("\"dirty\":true","\"dirty\":true,\"d\\u0069rty\":false"));val before=f.originals()
            try{withTimeout(90000){f.run()};fail("Expected duplicate refusal")}catch(error:IllegalStateException){assertEquals("E2EE_MINDMAPS_SOURCE_INVALID",error.message)}
            assertEquals(before,f.originals());assertNotNull(f.vault.read("local-snapshot","mindmaps-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
    @Test fun historyAboveTheOldSixteenMiBBridgeCapStreamsCompletelyAndStillOpensWithOnlyTheNewRoot()=runBlocking{
        val f=Rig();try{f.seed();f.largeServerHistory();val before=f.originals();val result=withTimeout(120000){f.run()}
            val size=result.content.sumOf{it.bytes.size.toLong()};assertTrue(size>16L*1024*1024);assertTrue(result.complete);assertEquals(1,f.reads.get())
            for(row in result.content){f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            result.localContent.forEach{it.bytes.fill(0)};f.oldKey.fill(0);f.eraseAlias()
            val index=requireNotNull(f.vault.read("mindmap","personal-mindmap-index-v1"));val versionId=try{val versions=JSONObject(index.bytes.toString(Charsets.UTF_8)).getJSONArray("versions");assertEquals(25,versions.length());versions.getJSONObject(24).getString("objectId")}finally{index.bytes.fill(0)}
            val last=requireNotNull(f.vault.read("mindmap",versionId));try{val value=JSONObject(last.bytes.toString(Charsets.UTF_8)).getJSONObject("document");assertEquals("Synthetic large version 25",value.getString("title"));assertEquals("x".repeat(12000),value.getJSONArray("nodes").getJSONObject(54).getString("note"))}finally{last.bytes.fill(0)}
            assertEquals(before,f.originals());println("SYNTHETIC_MINDMAP_STREAM decodedBytes=$size heapLimit=${Runtime.getRuntime().maxMemory()}")
        }finally{f.close()}
    }
    @Test fun lostKeystoreAndUnknownRetainedDocumentsStopBeforeAnySourceRequest()=runBlocking{
        val lost=Rig();try{lost.seed();val before=lost.originals();lost.eraseAlias();assertTrue(runCatching{lost.run()}.isFailure);assertEquals(0,lost.reads.get());assertEquals(before,lost.originals());assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(lost.alias))}finally{lost.close()}
        val unknown=Rig();try{unknown.seed();unknown.app.database.dao().putDocument(DocumentRecord(unknown.account,"mindmap-private-future","retain",1));val before=unknown.originals()
            try{unknown.run();fail("Expected unknown source refusal")}catch(error:IllegalStateException){assertEquals("E2EE_MINDMAPS_FORMAT_UNSUPPORTED",error.message)};assertEquals(0,unknown.reads.get());assertEquals(before,unknown.originals())
        }finally{unknown.close()}
    }
    @Test fun aFreshSourceCompletesFromTheProtectedSnapshotAfterLosingKeystoreWithoutAnyServerOldKey()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.response.getJSONObject("legacyKey").put("keyMode","client").put("key",JSONObject.NULL)
            val result=NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{
                val raw=f.source.captureLocal();assertEquals(0,f.reads.get())
                try{f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","mindmaps-source",raw,null)))}finally{raw.fill(0)}
                f.eraseAlias();f.oldKey.fill(0)
                val saved=requireNotNull(f.vault.read("local-snapshot","mindmaps-source"))
                try{withTimeout(90000){f.source.reconcile(saved.bytes,emptyList(),f.lease)}}finally{saved.bytes.fill(0)}
            }
            assertTrue(result.complete);assertEquals(27,f.opens.get());assertEquals(1,f.reads.get())
            for(row in result.content+result.localContent)assertFalse(row.bytes.toString(Charsets.UTF_8).contains(f.encoded))
            for(row in result.content){f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            result.localContent.forEach{it.bytes.fill(0)}
            val index=requireNotNull(f.vault.read("mindmap","personal-mindmap-index-v1"));val recordId=try{val value=JSONObject(index.bytes.toString(Charsets.UTF_8));assertEquals(25,value.getJSONArray("versions").length());value.getJSONArray("records").getJSONObject(0).getString("objectId")}finally{index.bytes.fill(0)}
            val head=requireNotNull(f.vault.read("mindmap",recordId));try{assertEquals("Synthetic acknowledged map",JSONObject(head.bytes.toString(Charsets.UTF_8)).getJSONObject("selected").getJSONObject("document").getString("title"))}finally{head.bytes.fill(0)}
            assertEquals(before,f.originals());assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(f.alias))
        }finally{f.close()}
    }
    @Test fun switchingAwayAndBackCancelsActualLegacyOpeningWithoutDroppingTheOldSource()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.onOpen={f.app.activateAccount(null);f.app.activateAccount(f.owner)}
            try{withTimeout(90000){f.run()};fail("Expected owner epoch cancellation")}catch(error:IllegalStateException){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)};assertEquals(before,f.originals())
        }finally{f.close()}
    }
    @Test fun ownerPermitDrainsTheFinalDurableMapDraftBeforeMigrationAndBlocksLaterViewWrites()=runBlocking{
        val f=Rig();try{f.seed();val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
            // This case uses the actual repository field cipher. Only this
            // unique synthetic account row is re-seeded; never erase/re-key the
            // QA app's default alias or touch another account's rows.
            val repositoryCipher=LocalCipher();f.app.database.dao().putDocument(DocumentRecord(f.account,"mindmaps",repositoryCipher.encrypt(f.root.toString(),"${f.account}/mindmaps"),1))
            val transport=object:MindmapTransport{override fun check()=f.check();override suspend fun <T> withLegacyOperation(operation:suspend ()->T):T=NativeLegacyOperationPermit.run(f.app.database,f.account,::check,operation)
                override suspend fun workspace():JSONObject{entered.complete(Unit);release.await();error("SYNTHETIC_OFFLINE")};override suspend fun request(path:String,body:JSONObject?):JSONObject=error("No provider IO")}
            val repository=MindmapRepository(f.app.database,f.account,f.owner,transport);repository.loadCached()
            val edit=async(Dispatchers.IO){runCatching{repository.save(repository.records.value.single().document.copy(title="Synthetic final durable map edit"))}};entered.await()
            val captured=CompletableDeferred<String>();val migration=async(Dispatchers.IO){NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{captured.complete(requireNotNull(f.app.database.dao().document(f.account,"mindmaps")).encrypted)}}
            assertNull(withTimeoutOrNull(150){captured.await()});release.complete(Unit);assertTrue(edit.await().isFailure);migration.await();assertTrue(repositoryCipher.decrypt(captured.await(),"${f.account}/mindmaps").contains("Synthetic final durable map edit"))
            val before=f.originals();try{repository.saveView("native-draft",JSONObject().put("zoom",2));fail("Expected old view write denial")}catch(error:AuthApiError){assertEquals("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN",error.message)};assertEquals(before,f.originals())
        }finally{f.close()}
    }
}
