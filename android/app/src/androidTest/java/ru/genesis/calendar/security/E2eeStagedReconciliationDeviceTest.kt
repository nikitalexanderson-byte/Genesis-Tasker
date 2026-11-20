package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

/** Real SQLite/JCA composition of inert synthetic sources, not product adapters,
 * a coordinator lease, enrollment, lost-key recovery or activation acceptance. */
class E2eeStagedReconciliationDeviceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(app.noBackupFilesDir,"staged-reconciliation-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=directory}
        val inventory=E2eePrivatePaths.load(app);val paths=inventory.required("project");val keys=E2eeKeys.generateDeviceKeys()
        private fun root()=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        val localRoot=root();val contentRoot=root();val scope=UnlockedE2eeVault.Scope("synthetic-actor","device:staged-reconciliation","staged-device",1,1,1,"local-root",keys.signing.private,mapOf("local-root" to localRoot)){if(it=="staged-device")keys.signing.public else null}
        var storage=E2eeSqliteStorage(context,true);var vault=UnlockedE2eeVault(storage,scope);var live=true;var complete=false
        val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"}}
        val target=E2eeSourceStage.Target("content-owner","project:streamed","project")
        val lease=E2eeMigrationSourceContext(target.ownerId,target.scopeId,"migration-streamed",1,E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest("synthetic complete history".toByteArray())),2)
        val base=E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId",target.ownerId).put("scopeId",target.scopeId)
            .put("domain","shared-project").put("objectId","plan-context").put("schemaVersion",1).put("dataGeneration",2).put("writerProtocol",9).put("cryptoEpoch",1).put("securityEpoch",1)
            .put("revision",1).put("keyId","content-root").put("deviceId",scope.deviceId).put("operationId",UUID.randomUUID().toString()))
        init{check(BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")}
        fun readOptions()=E2eeContentPlan.ReadOptions(vault,contentRoot,keys.signing.public,base,target,lease.migrationId,lease.sourceHash,paths.map{it.id},inventory,current)
        fun planOptions(admit:(E2eeContentPlan.Admission)->Unit={})=E2eeContentPlan.Options(readOptions(),keys.signing.private,E2eeContentPlan.Capacity(32L*1024*1024,256,64),admit,{}, {check(complete){"E2EE_SOURCE_INPUT_EOF_REQUIRED"}})
        fun protect(seed:Int,firstSize:Int):E2eeStagedHistory {
            val stage=E2eeSourceStage.create(E2eeSourceStage.Options(vault,target,paths.map{it.id},E2eeSourceStage.Capacity(16L*1024*1024,128),{},current,{}))
            for((index,path)in paths.withIndex())stage.capturePath(path.id){output->val block=ByteArray(65536){(seed+index).toByte()};try{val size=if(index==0)firstSize else 7;var at=0
                while(at<size){val take=minOf(block.size,size-at);output.write(block,0,take);at+=take}}finally{block.fill(0)}}
            val reference=stage.finish();val opened=E2eeSourceStage.open(vault,target,reference,current)
            return E2eeStagedHistory(reference.stageId,target,opened.paths){id->val reader=opened.openPath(id);E2eeStagedPathReader(reader){reader.assertComplete()}}
        }
        fun fingerprints():Map<String,String> {val rows=storage.list("");return rows.associateWith{key->val row=requireNotNull(storage.get(key));E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(row.envelope.toJson().toString().toByteArray()))}}
        fun assertOriginals(before:Map<String,String>){val after=fingerprints();for((key,hash)in before)assertEquals(hash,after[key])}
        fun cold(){vault.lock();storage.close();storage=E2eeSqliteStorage(context);vault=UnlockedE2eeVault(storage,scope)}
        override fun close(){live=false;vault.lock();storage.close();check(directory.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&directory.name.startsWith("staged-reconciliation-synthetic-"));check(directory.deleteRecursively())}
    }
    private class Joined(private val originals:List<E2eeReconciliationPathInput>):InputStream(){
        private var at=0;private var active:E2eeReconciliationPathInput.Reader?=null
        override fun read():Int {val one=ByteArray(1);return try{if(read(one,0,1)<0)-1 else one[0].toInt() and 255}finally{one.fill(0)}}
        override fun read(bytes:ByteArray,offset:Int,length:Int):Int {
            require(offset>=0&&length>=0&&offset<=bytes.size-length);if(length==0)return 0
            while(at<originals.size){val reader=active?:originals[at].open().also{active=it};val count=reader.input.read(bytes,offset,minOf(65536,length))
                if(count>=0)return count;reader.assertComplete();reader.close();active=null;at++};return -1
        }
        override fun close(){active?.close();active=null}
    }
    private fun register(f:Rig,firstSize:Int):E2eeMigrationSources {
        val registry=E2eeMigrationSources(f.target.ownerId,f.target.scopeId,f.target.kind,f.inventory)
        for((index,path)in f.paths.withIndex())registry.registerStagedReconciler(object:E2eeStagedPathReconciler{
            override val id=path.id
            override suspend fun reconcile(current:E2eeReconciliationPathInput,previous:List<E2eeReconciliationPathInput>,context:E2eeMigrationSourceContext,emit:suspend(E2eeContentPlan.Record)->Unit):Boolean {
                val size=if(index==0)firstSize else 7
                emit(E2eeContentPlan.Record(if(id.endsWith(".local-work"))"local" else "remote",path.domains.first(),id,2*size,Joined(listOf(current)+previous),"synthetic-$index","application/octet-stream"));return true
            }
        });return registry
    }
    @Test fun protectedHistoryReconcilesToAColdSqlitePlanAndAllOriginalRowsSurvive()=runBlocking {
        Rig().use{f->val started=SystemClock.elapsedRealtime();val size=2*1024*1024+17;val previous=f.protect(1,size);val current=f.protect(2,size);val originals=f.fingerprints();val writer=E2eeContentPlan.create(f.planOptions())
            val registry=register(f,size);val coverage=registry.reconcileStaged(E2eeStagedSourceInput(current,listOf(previous)),f.lease,{path,record->writer.append(path,record)},f.current)
            f.complete=true;val reference=writer.finish(coverage);f.cold();val opened=E2eeContentPlan.open(f.readOptions(),reference).manifest
            assertEquals(6,coverage.size);assertEquals(5,opened.getJSONArray("logical").length());assertEquals(1,opened.getJSONArray("local").length());f.assertOriginals(originals)
            val values=JSONArray();var total=0L
            for(name in listOf("logical","local")){val rows=opened.getJSONArray(name);for(index in 0 until rows.length()){val row=rows.getJSONObject(index);val identity=row.getString("objectId");val path=f.paths.indexOfFirst{it.id==identity};assertTrue(path>=0)
                val expected=MessageDigest.getInstance("SHA-256");val block=ByteArray(65536);val perSource=if(path==0)size else 7
                try{for(seed in listOf(2,1)){block.fill((seed+path).toByte());var at=0;while(at<perSource){val take=minOf(block.size,perSource-at);expected.update(block,0,take);at+=take}}}finally{block.fill(0)}
                assertEquals(E2eeEnvelope.encode(expected.digest()),row.getString("plaintextHash"));val bytes=E2eeCommands.integer(row.get("size"));assertEquals(2L*perSource,bytes);total+=bytes
                values.put(JSONObject().put("path",identity).put("placement",if(name=="local")"local" else "remote").put("size",bytes).put("plaintextHash",row.getString("plaintextHash")))}}
            val report=JSONObject().put("synthetic",true).put("api",android.os.Build.VERSION.SDK_INT).put("firstSourceBytes",size).put("totalBytes",total).put("originalRows",originals.size)
                .put("coverage",JSONArray(coverage.map{it.first})).put("values",values).put("elapsedMs",SystemClock.elapsedRealtime()-started)
            File(f.app.getExternalFilesDir(null),"staged-reconciliation336-report.json").outputStream().use{out->out.write(report.toString().toByteArray());out.fd.sync()}
        }
    }
    @Test fun lateOriginalAuthenticationAndQuotaFailuresKeepBothProtectedHistoriesAndNeverPublish()=runBlocking {
        for(mode in listOf("tag","quota"))Rig().use{f->val size=512*1024+17;val original=f.protect(1,size);val current=f.protect(2,size);val originals=f.fingerprints()
            val previous=if(mode=="tag")E2eeStagedHistory(original.id,original.target,original.paths){id->val raw=original.openPath(id)
                val input=object:InputStream(){override fun read():Int{val one=ByteArray(1);return try{if(read(one,0,1)<0)-1 else one[0].toInt() and 255}finally{one.fill(0)}}
                    override fun read(bytes:ByteArray,offset:Int,length:Int):Int{val count=raw.input.read(bytes,offset,length);if(count<0)error("E2EE_OLD_TAG_INVALID");return count};override fun close(){raw.input.close()}}
                E2eeStagedPathReader(input,raw.assertComplete)
            }else original
            var admits=0;val writer=E2eeContentPlan.create(f.planOptions{if(mode=="quota"&&++admits==4)error("E2EE_NO_SPACE")});val registry=register(f,size)
            val expected=if(mode=="tag")"E2EE_OLD_TAG_INVALID" else "E2EE_NO_SPACE"
            try{registry.reconcileStaged(E2eeStagedSourceInput(current,listOf(previous)),f.lease,{path,record->writer.append(path,record)},f.current);fail("Incomplete originals accepted")}catch(error:Exception){assertEquals(expected,error.message)}
            assertThrows(Exception::class.java){writer.finish(f.paths.map{it.id to true})};f.assertOriginals(originals);assertTrue(f.storage.list("").size>originals.size)
        }
    }
}
