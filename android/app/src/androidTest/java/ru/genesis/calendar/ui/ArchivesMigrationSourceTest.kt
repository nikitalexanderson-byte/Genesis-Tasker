package ru.genesis.calendar.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
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
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.UUID

/** Real legacy Keystore inputs, retained native form/file inventory, packaged
 * isolated reconciliation, new-key SQLite and cold readback. Remote rows are
 * synthetic; this does not claim provider delivery or the complete account UX. */
@RunWith(AndroidJUnit4::class)
class ArchivesMigrationSourceTest {
    private val app get()=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private inner class Rig:AutoCloseable {
        val owner="archive-source-${UUID.randomUUID()}";val scope="personal:$owner";val account=CloudAccountSnapshot.scopeFor(owner)
        val memory=BackupMigrationInventory{maximum->nativeBackupFormSpool(app,maximum)}
        val cipher=LocalCipher();var live=true;var reads=0
        val oldRaw=E2eeKeys.freshSecret();val oldKey=Base64.getEncoder().encodeToString(oldRaw).also{oldRaw.fill(0)}
        val file=byteArrayOf(0,-1,0xc3.toByte(),0x28,7)
        val lease=E2eeMigrationSourceContext(owner,scope,"archive-attempt-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        val remote=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",lease.fence)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",lease.sourceHash).put("directoryRevision",1)
            .put("encoding","utf8-json-rows-v1").put("stages",JSONArray()).put("safety",JSONArray()).put("receipts",JSONArray())
            .put("legacyKey",JSONObject().put("keyMode","empty").put("key",JSONObject.NULL))
        val input:JSONObject
        init {
            check(BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug");app.activateAccount(owner)
            fun state(note:String)=JSONObject().put("format","native-protected-state-v1").put("scope",account).put("capturedAt","2026-11-23T04:00:00Z")
                .put("preferences",JSONObject().put("enabled",false).put("zero",0))
                .put("documents",JSONArray().put(JSONObject().put("kind","structure").put("encrypted",cipher.encrypt(JSONObject().put("private",note).toString(),"$account/structure")).put("revision",3))
                    .put(JSONObject().put("kind","aurora-account-key").put("encrypted",cipher.encrypt(oldKey,"$account/aurora/$owner/account-key")).put("revision",1)))
                .put("tasks",JSONArray().put(JSONObject().put("id","retained-deleted-task").put("revision",9).put("deleted",true)
                    .put("encrypted",cipher.encrypt("{\"title\":\"ARCHIVE TOMBSTONE\"}","$account/retained-deleted-task"))))
                .put("outbox",JSONArray().put(JSONObject().put("entityId","retained-deleted-task").put("revision",9).put("operationId","uncertain-original-operation").put("state","pending")))
            val safetyKind="backup-safety:2026-11-23T04:00:00Z:${UUID.randomUUID()}"
            val safetyCipher=cipher.encrypt(state("ARCHIVE SAVED ORIGINAL").toString(),"$account/$safetyKind")
            val safety=JSONArray().put(JSONObject().put("scope",account).put("kind",safetyKind).put("encrypted",JSONObject().put("chunks",1).put("length",safetyCipher.length).toString()).put("revision",1))
                .put(JSONObject().put("scope",account).put("kind","$safetyKind/chunk/0").put("encrypted",safetyCipher).put("revision",1))
            val view=memory.open(owner,app.workspaceEpoch)
            val selected=BackupImportFile(file,"retained-input.genesisbackup","application/octet-stream",null,null)
            val descriptor=try{val candidate=selected.migrationCopy();memory.retainFile(view,candidate);JSONObject(candidate.descriptor)}finally{selected.clear()}
            val state=JSONObject().put("payload",JSONObject.NULL).put("plan",JSONObject.NULL)
                .put("key","PRIVATE INDEPENDENT INPUT").put("confirmed",true).put("note","ARCHIVE RETAINED DRAFT")
            val fields=JSONArray();for(name in state.keys()){
                val id=UUID.randomUUID().toString();val value=state.get(name)
                val raw=if(value is String)JSONObject.quote(value)else value.toString()
                memory.appendValue(view,name,id,0,true,raw);fields.put(JSONObject().put("name",name).put("id",id))
            }
            val form=JSONObject().put("protocol",2).put("fields",fields)
                .put("settled",true).put("file",JSONObject().put("id",descriptor.getString("id")).put("name","retained-input.genesisbackup").put("type","application/octet-stream").put("size",file.size).put("lastModified",0))
            memory.publishManifest(view,form.toString());memory.detach(view)
            val forms=ByteArrayOutputStream().use{sink->memory.source(owner,app.workspaceEpoch).writeTo(sink);JSONObject(sink.toString("UTF-8"))}
            input=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("capturedAt","2026-11-23T04:00:00Z").put("platform","android").put("inventoryVersion",1)
                .put("generation",0).put("pendingGeneration",JSONObject.NULL).put("history",JSONObject.NULL).put("protectedState",state("ARCHIVE CURRENT ORIGINAL").toString()).put("safety",safety).put("forms",forms)
        }
        fun current(){check(live&&app.workspaceScope==account){"E2EE_ACCOUNT_CHANGED"}}
        fun source()=E2eeNativeArchivesSource(owner,scope,{current();input.toString().toByteArray()},::current,{actual->current();assertEquals(lease,actual);reads++;JSONObject(remote.toString())},NativeArchivesSourceRuntime(app))
        override fun close(){live=false;memory.clear();file.fill(0);app.activateAccount(null)}
    }
    @Test fun realArchiveAdapterRetainsSafetyFormsFilesAndTombstonesUnderIndependentEncryption()=runBlocking {
        Rig().use{f->
            val source=f.source();val capture=source.captureLocal();val before=capture.copyOf();assertEquals(0,f.reads)
            val result=withTimeout(90000){source.reconcile(capture,emptyList(),f.lease)}
            try{
                assertTrue(result.complete);assertArrayEquals(before,capture);assertEquals(1,f.reads);assertTrue(result.localContent.isEmpty())
                val text=result.content.joinToString("\n"){it.bytes.toString(Charsets.UTF_8)}
                for(canary in listOf("ARCHIVE CURRENT ORIGINAL","ARCHIVE SAVED ORIGINAL","ARCHIVE TOMBSTONE","ARCHIVE RETAINED DRAFT",E2eeEnvelope.encode(f.file)))assertTrue(canary,text.contains(canary))
                assertFalse(text.contains(f.oldKey));assertFalse(text.contains("PRIVATE INDEPENDENT INPUT"));assertTrue(text.contains("history-only"))
                val bytes=E2eeKeys.freshSecret();val root=E2eeEnvelope.importRoot(bytes);bytes.fill(0);val keys=E2eeKeys.generateDeviceKeys();val storage=E2eeSqliteStorage(app,allowCreate=true)
                val binding=UnlockedE2eeVault.Scope(f.owner,f.scope,"archive-synthetic-device",2,1,1,"archive-new-root",keys.signing.private,mapOf("archive-new-root" to root)){keys.signing.public}
                val first=UnlockedE2eeVault(storage,binding)
                try{
                    first.write(result.content.map{UnlockedE2eeVault.Write(it.domain,it.objectId,it.bytes,null)});first.lock()
                    val cold=UnlockedE2eeVault(storage,binding)
                    try{for(row in result.content){val read=requireNotNull(cold.read(row.domain,row.objectId));try{assertArrayEquals(row.bytes,read.bytes)}finally{read.bytes.fill(0)}}}finally{cold.lock()}
                }finally{first.lock();storage.close()}
            }finally{(result.content+result.localContent).forEach{it.bytes.fill(0)};capture.fill(0);before.fill(0)}
        }
    }
    @Test fun archiveCorruptionAndRetirementPreserveExactCaptureAndDoNotReturnACompletePlan()=runBlocking {
        Rig().use{f->
            val source=f.source();val capture=source.captureLocal();val changed=JSONObject(capture.toString(Charsets.UTF_8))
            val original=changed.getJSONObject("original");original.put("protectedState",original.getString("protectedState").replace("\"zero\":0","\"zero\":1,\"zero\":0"))
            val corrupt=changed.toString().toByteArray();val before=corrupt.copyOf()
            try{
                try{withTimeout(90000){source.reconcile(corrupt,emptyList(),f.lease)};fail("Ambiguous original accepted")}catch(error:Exception){assertTrue(error.message.orEmpty(),error.message.orEmpty().contains("E2EE_"))}
                assertArrayEquals(before,corrupt);val reads=f.reads;f.live=false
                try{source.reconcile(capture,emptyList(),f.lease);fail("Retired source accepted")}catch(error:Exception){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)}
                assertEquals(reads,f.reads)
            }finally{capture.fill(0);corrupt.fill(0);before.fill(0)}
        }
    }
}
