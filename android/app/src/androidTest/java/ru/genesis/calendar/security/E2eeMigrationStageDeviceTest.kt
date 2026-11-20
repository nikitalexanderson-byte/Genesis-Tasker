package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import java.io.File
import java.io.OutputStream
import java.security.KeyStore
import java.security.MessageDigest
import java.util.UUID
import javax.crypto.SecretKey

/** Actual SQLite/JCA local source publication. A separate no-auth synthetic
 * LocalCipher bundle is test custody, not product presence/enrollment/recovery. */
class E2eeMigrationStageDeviceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val files=File(app.noBackupFilesDir,"migration-stage-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=files}
        val alias="genesis.qa.migration-stage.${UUID.randomUUID()}";val cipher=LocalCipher(alias);val saved=File(files,"synthetic-key.bundle")
        val target=E2eeSourceStage.Target("content-owner","project:staged-publication","project")
        val owner="device-actor";val device="staged-device";val scope="device:staged-publication"
        val expectedBundleHash:String;var storage=E2eeSqliteStorage(context,true);lateinit var vault:UnlockedE2eeVault
        lateinit var keys:E2eeKeys.DeviceKeys;lateinit var root:SecretKey;val directory:E2eeDirectory.Verified
        var live=true;var pointerFailure:String?=null;var transportCalls=0;var produced=0;var raceCatalogue=false
        val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        private val port=object:E2eeRecordStorage {
            override fun get(key:String)=storage.get(key)
            override fun list(prefix:String)=storage.list(prefix)
            override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){
                val pointer=changes.any{it.value?.envelope?.context?.toJson()?.getString("objectId")?.startsWith("migration:")==true}
                val failure=if(pointer)pointerFailure else null
                if(failure=="before"){pointerFailure=null;error("E2EE_LOCAL_CONFLICT")}
                storage.commit(changes,requireOpen)
                if(failure=="after"){pointerFailure=null;error("SYNTHETIC_POINTER_DEATH")}
            }
        }
        init {
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))
            val generated=E2eeKeys.generateDeviceKeys();val local=E2eeKeys.freshSecret();val remote=E2eeKeys.freshSecret()
            try{
                val bundle=JSONObject().put("local",E2eeEnvelope.encode(local)).put("target",E2eeEnvelope.encode(remote)).put("keys",E2eeKeys.exportPrivateKeys(generated))
                expectedBundleHash=digest(E2eeCommands.canonical(bundle))
                saved.outputStream().use{it.write(cipher.encrypt(bundle.toString(),"synthetic-stage-key-v1").toByteArray());it.fd.sync()}
                val recovery=E2eeKeys.createRecoveryKit(target.ownerId)
                try{
                    val public=E2eeKeys.publicKeys(generated);val command=JSONObject().put("protocol",1).put("ownerId",target.ownerId).put("scopeId",target.scopeId).put("deviceId",device)
                        .put("action","bootstrap").put("expectedRevision",0).put("checkpointHash","genesis").put("securityEpoch",1).put("operationId","bootstrap")
                        .put("payload",JSONObject().put("kind",target.kind).put("resourceId","staged-publication").put("keyId","target-one").put("generation",1)
                            .put("recoveryKit",recovery.kit).put("deviceKeys",public)
                            .put("deviceCapsule",E2eeKeys.sealRoot(remote,public.getString("receivingKey"),E2eeKeys.RootRecipient(target.ownerId,target.scopeId,1,"target-one",device)))
                            .put("recoveryCapsule",E2eeKeys.sealRoot(remote,recovery.kit.getJSONObject("authority").getString("receivingKey"),E2eeKeys.RootRecipient(target.ownerId,target.scopeId,1,"target-one","recovery"))))
                    command.getJSONObject("payload").put("selfProof",E2eeCommands.sign(command,generated.signing.private).get("signature"))
                    directory=E2eeDirectory.verify(target.ownerId,target.scopeId,recovery.kit.getJSONObject("authority"),JSONArray().put(E2eeCommands.sign(command,recovery.keys.signing.private)))
                }finally{recovery.secret.fill(0)}
            }finally{local.fill(0);remote.fill(0)}
            reopen()
        }
        private fun digest(bytes:ByteArray):String=try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}
        private fun bundle():JSONObject=JSONObject(cipher.decrypt(saved.readText(),"synthetic-stage-key-v1")).also{check(digest(E2eeCommands.canonical(it))==expectedBundleHash)}
        private fun reopen(){
            val bundle=bundle();keys=E2eeKeys.importDeviceKeys(bundle.getJSONObject("keys"));val local=E2eeEnvelope.decode(bundle.getString("local"),32);val remote=E2eeEnvelope.decode(bundle.getString("target"),32)
            try{root=E2eeEnvelope.importRoot(remote);vault=UnlockedE2eeVault(port,UnlockedE2eeVault.Scope(owner,scope,device,1,1,1,"independent-local-root",keys.signing.private,
                mapOf("independent-local-root" to E2eeEnvelope.importRoot(local))){if(it==device)keys.signing.public else null})}finally{local.fill(0);remote.fill(0)}
        }
        fun cold(){vault.lock();storage.close();storage=E2eeSqliteStorage(context);reopen()}
        fun sources(producer:(suspend(String,OutputStream)->Unit)?=null):E2eeMigrationSources {
            val registry=E2eeMigrationSources(target.ownerId,target.scopeId,target.kind,E2eePrivatePaths.load(context))
            for(path in registry.requiredCoverage)registry.registerStream(object:E2eePrivatePathStreamAdapter{
                override val id=path
                override suspend fun captureLocal(output:OutputStream){produced++;yield();if(producer!=null)producer(id,output)else output.write("original:$id".toByteArray());yield()}
            })
            return registry
        }
        fun migration(sources:E2eeMigrationSources)=E2eeMigration(vault,directory,device,keys.signing.private,keys.signing.public,root,object:E2eeMigrationTransport{
            override suspend fun sourceHash():String{transportCalls++;error("FORBIDDEN_TRANSPORT")}
            override suspend fun command(packet:JSONObject):JSONObject{transportCalls++;error("FORBIDDEN_TRANSPORT")}
            override suspend fun readAll():List<E2eeEnvelope.Envelope>{transportCalls++;error("FORBIDDEN_TRANSPORT")}
        },sources,{current();bundle();current()},object:E2eeMigrationFence{override suspend fun<T> withFence(operation:suspend()->T):T=operation()},{error("NO_RECOVERY_ACTIVATION")})
        fun options()=E2eeStagedMigrationOptions(E2eeSourceStage.Capacity(80L*1024*1024,512),current,{request->
            current();check(files.usableSpace>2L*E2eeFiles.CHUNK_BYTES+2L*request.metadataBytes){"SYNTHETIC_NO_SPACE"}
            if(raceCatalogue){val known=E2eeSourceStage.inspect(vault,target,current)
                if(known.size==1&&known.single().complete){raceCatalogue=false;val paths=E2eePrivatePaths.load(context).required(target.kind).map{it.id}
                    E2eeSourceStage.create(E2eeSourceStage.Options(vault,target,paths,E2eeSourceStage.Capacity(80L*1024*1024,512),current,current,{}))}
            }
        })
        fun state():JSONObject {
            val id="migration:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(target.scopeId.toByteArray()))
            val row=requireNotNull(vault.read("local-snapshot",id));return try{JSONObject(row.bytes.toString(Charsets.UTF_8))}finally{row.bytes.fill(0)}
        }
        override fun close(){
            live=false;vault.lock();storage.close();check(alias.startsWith("genesis.qa.migration-stage."));KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
            check(files.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&files.name.startsWith("migration-stage-synthetic-"));check(files.deleteRecursively())
        }
    }
    private suspend fun refuses(code:String,work:suspend()->Unit){try{work()}catch(error:Exception){assertEquals(code,error.message);return};fail("Forbidden staged operation accepted")}
    @Test fun seventyMiBFullRegistryPublishesAndColdReadsWithoutAggregateOrNetwork()=runBlocking {
        val start=SystemClock.elapsedRealtime();Rig().use{f->
            val size=70L*1024*1024+7;val primary=E2eePrivatePaths.load(f.context).required("project").first().id
            val sourceHash=MessageDigest.getInstance("SHA-256");val sources=f.sources{path,out->
                if(path==primary){val buffer=ByteArray(65536);var at=0L
                    try{while(at<size){val count=minOf(buffer.size.toLong(),size-at).toInt();for(index in 0 until count)buffer[index]=((at+index)*31).toByte();out.write(buffer,0,count);sourceHash.update(buffer,0,count);at+=count;if(at%(4*1024*1024)==0L)yield()}}
                    finally{buffer.fill(0)}
                }else out.write("original:$path".toByteArray())
            }
            f.migration(sources).prepareStaged(sources.stagedCapture(),f.options());assertEquals(6,f.produced);assertEquals(0,f.transportCalls)
            val original=E2eeEnvelope.encode(sourceHash.digest());f.cold();val state=f.state();assertEquals(3,state.getInt("protocol"));assertFalse(state.has("snapshotParts"))
            val source=state.getJSONObject("source");assertEquals("device-actor",source.getJSONObject("actor").getString("ownerId"));assertEquals("content-owner",source.getJSONObject("target").getString("ownerId"))
            val reference=source.getJSONObject("reference");val opened=E2eeSourceStage.open(f.vault,f.target,E2eeSourceStage.Reference(reference.getString("stageId"),reference.getString("manifestHash")),f.current)
            assertEquals(sources.requiredCoverage,opened.paths);val digest=MessageDigest.getInstance("SHA-256");val buffer=ByteArray(65536);var count=0L
            try{opened.openPath(primary).use{reader->while(true){val read=reader.read(buffer);if(read<0)break;digest.update(buffer,0,read);count+=read;buffer.fill(0,0,read)};reader.assertComplete()}}
            finally{buffer.fill(0)}
            assertEquals(size,count);assertEquals(original,E2eeEnvelope.encode(digest.digest()))
            for(path in opened.paths.drop(1))opened.openPath(path).use{assertEquals("original:$path",it.readBytes().toString(Charsets.UTF_8));it.assertComplete()}
            refuses("E2EE_STREAMED_PLANNER_REQUIRED"){f.migration(sources).run()};assertEquals(0,f.transportCalls)
            val report=JSONObject().put("synthetic",true).put("sourceOnly",true).put("bytes",size).put("primary",primary).put("paths",JSONArray(opened.paths))
                .put("sha256",original).put("manifestHash",reference.get("manifestHash")).put("transportCalls",f.transportCalls).put("maxHeap",Runtime.getRuntime().maxMemory()).put("elapsedMs",SystemClock.elapsedRealtime()-start)
            File(requireNotNull(f.app.getExternalFilesDir(null)),"migration-stage336-large-proof.json").writeText(report.toString(2))
        }
    }
    @Test fun lateProducerFailureRetainsIncompleteHistoryAndBlocksReplacement()=runBlocking {
        Rig().use{f->val sources=f.sources{_,out->out.write(ByteArray(E2eeFiles.CHUNK_BYTES){47});error("SYNTHETIC_LATE_TAG")}
            refuses("SYNTHETIC_LATE_TAG"){f.migration(sources).prepareStaged(sources.stagedCapture(),f.options())};assertNull(f.migration(sources).status());f.cold()
            val kept=E2eeSourceStage.inspect(f.vault,f.target,f.current);assertEquals(1,kept.size);assertFalse(kept.single().complete);f.produced=0
            val replacement=f.sources();refuses("E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED"){f.migration(replacement).prepareStaged(replacement.stagedCapture(),f.options())}
            assertEquals(0,f.produced);assertEquals(kept,E2eeSourceStage.inspect(f.vault,f.target,f.current));assertEquals(0,f.transportCalls)
        }
    }
    @Test fun failedPointerCasRetainsCompleteOrphanInNextPublishedHistory()=runBlocking {
        Rig().use{f->val sources=f.sources();f.pointerFailure="before"
            refuses("E2EE_LOCAL_CONFLICT"){f.migration(sources).prepareStaged(sources.stagedCapture(),f.options())};assertNull(f.migration(sources).status());f.cold()
            val orphan=E2eeSourceStage.inspect(f.vault,f.target,f.current).single();assertTrue(orphan.complete)
            f.migration(sources).prepareStaged(sources.stagedCapture(),f.options());val history=f.state().getJSONObject("source").getJSONArray("history")
            assertEquals(1,history.length());assertEquals(orphan.id,history.getJSONObject(0).getString("stageId"));assertEquals(0,f.transportCalls)
        }
    }
    @Test fun acceptedPointerWithLostReturnRemainsReadableAndCannotStartAnotherAttempt()=runBlocking {
        Rig().use{f->val sources=f.sources();f.pointerFailure="after"
            refuses("SYNTHETIC_POINTER_DEATH"){f.migration(sources).prepareStaged(sources.stagedCapture(),f.options())};f.cold();assertEquals("source-stage-v1",requireNotNull(f.migration(sources).status()).sourceFormat)
            val before=f.produced;refuses("E2EE_MIGRATION_ALREADY_PREPARED"){f.migration(sources).prepareStaged(sources.stagedCapture(),f.options())}
            assertEquals(before,f.produced);assertEquals(1,E2eeSourceStage.inspect(f.vault,f.target,f.current).size);assertEquals(0,f.transportCalls)
        }
    }
    @Test fun catalogueChangeDuringPublicationIsFencedByTheSameSqliteTransaction()=runBlocking {
        Rig().use{f->val sources=f.sources();f.raceCatalogue=true
            refuses("E2EE_LOCAL_CONFLICT"){f.migration(sources).prepareStaged(sources.stagedCapture(),f.options())};assertFalse(f.raceCatalogue);assertNull(f.migration(sources).status());f.cold()
            val retained=E2eeSourceStage.inspect(f.vault,f.target,f.current);assertEquals(2,retained.size);assertTrue(retained[0].complete);assertFalse(retained[1].complete)
            val before=f.produced;refuses("E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED"){f.migration(sources).prepareStaged(sources.stagedCapture(),f.options())}
            assertEquals(before,f.produced);assertEquals(retained,E2eeSourceStage.inspect(f.vault,f.target,f.current));assertEquals(0,f.transportCalls)
        }
    }
}
