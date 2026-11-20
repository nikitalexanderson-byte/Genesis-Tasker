package ru.genesis.calendar.security

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
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Actual coordinator/JCA/cold ciphertext SQLite. Synthetic registry producers,
 * no backend, authenticated recovery handoff, product coverage or activation. */
class E2eeMigrationHistoryDeviceTest {
    private class Rig(val firstSize:Int):AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val folder=File(app.noBackupFilesDir,"migration-history-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext()=this;override fun getNoBackupFilesDir()=folder}
        val owner="history-owner";val scopeId="project:history-native";val device="history-device";val keys=E2eeKeys.generateDeviceKeys()
        private fun newRoot():javax.crypto.SecretKey {val raw=E2eeKeys.freshSecret();return try{E2eeEnvelope.importRoot(raw)}finally{raw.fill(0)}}
        val root=newRoot();val localRoot=newRoot()
        val actor=UnlockedE2eeVault.Scope(owner,"device:history-native",device,1,1,1,"local-root",keys.signing.private,mapOf("local-root" to localRoot)){if(it==device)keys.signing.public else null}
        val inventory=E2eePrivatePaths.load(app);val paths=inventory.required("project").map{it.id};val target=E2eeSourceStage.Target(owner,scopeId,"project")
        val live=AtomicBoolean(true);var storage=E2eeSqliteStorage(context,true);var vault=UnlockedE2eeVault(storage,actor);var network=0
        val directory:E2eeDirectory.Verified
        val sources=E2eeMigrationSources(owner,scopeId,"project",inventory)
        init {
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))
            val recovery=E2eeKeys.createRecoveryKit(owner);val pub=E2eeKeys.publicKeys(keys)
            val recipient=E2eeKeys.RootRecipient(owner,scopeId,1,"project-root",device)
            val command=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scopeId).put("deviceId",device).put("action","bootstrap")
                .put("expectedRevision",0).put("checkpointHash","genesis").put("securityEpoch",1).put("operationId","bootstrap")
                .put("payload",JSONObject().put("kind","project").put("resourceId","history-native").put("keyId","project-root").put("generation",1)
                    .put("recoveryKit",recovery.kit).put("deviceKeys",pub)
                    .put("deviceCapsule",E2eeKeys.sealRoot(root.encoded,pub.getString("receivingKey"),recipient))
                    .put("recoveryCapsule",E2eeKeys.sealRoot(root.encoded,recovery.kit.getJSONObject("authority").getString("receivingKey"),E2eeKeys.RootRecipient(owner,scopeId,1,"project-root","recovery"))))
            command.getJSONObject("payload").put("selfProof",E2eeCommands.sign(command,keys.signing.private).getString("signature"))
            directory=E2eeDirectory.verify(owner,scopeId,recovery.kit.getJSONObject("authority"),JSONArray().put(E2eeCommands.sign(command,recovery.keys.signing.private)))
            recovery.secret.fill(0)
            for((index,path)in inventory.required("project").withIndex())sources.register(object:E2eePrivatePathAdapter {
                override val id=path.id
                override suspend fun captureLocal():ByteArray=ByteArray(if(index==0)firstSize else 3){at->(at*31+index*17).toByte()}
                override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_NO_AGGREGATE_RECONCILE")
            })
        }
        fun current(){check(live.get()){"E2EE_ACCOUNT_CHANGED"}}
        fun make()=E2eeMigration(vault,directory,device,keys.signing.private,keys.signing.public,root,object:E2eeMigrationTransport {
            override suspend fun sourceHash():String{network++;error("E2EE_UNEXPECTED_NETWORK")}
            override suspend fun command(packet:JSONObject):JSONObject{network++;error("E2EE_UNEXPECTED_NETWORK")}
            override suspend fun readAll():List<E2eeEnvelope.Envelope>{network++;error("E2EE_NO_AGGREGATE_READ")}
        },sources,::current,object:E2eeMigrationFence{override suspend fun <T> withFence(operation:suspend()->T):T{current();return operation()}},{error("E2EE_NO_PRODUCT_RECOVERY")})
        fun stageOptions()=E2eeStagedMigrationOptions(E2eeSourceStage.Capacity(16L*1024*1024,128),::current,{})
        fun historyOptions()=E2eeMigrationHistory.Options(E2eeMigrationHistory.Capacity(16L*1024*1024,256,4*1024*1024),::current,{})
        fun capture(seed:Int)=E2eeStagedMigrationCapture(target,paths){path,out->
            val index=paths.indexOf(path);val size=if(index==0)firstSize else 3;val buffer=ByteArray(65536)
            try{var at=0;while(at<size){val count=minOf(buffer.size,size-at);for(offset in 0 until count)buffer[offset]=((at+offset)*31+index*17+seed).toByte();out.write(buffer,0,count);buffer.fill(0);at+=count}}finally{buffer.fill(0)}
        }
        suspend fun prepare():String {
            make().prepare();make().cancel();val source=E2eeSourceStage.create(E2eeSourceStage.Options(vault,target,paths,stageOptions().capacity,::current,::current,{}))
            val orphan=capture(17);for(path in paths)source.captureSuspendPath(path){orphan.capturePath(path,it)};val ref=source.finish()
            make().prepareStaged(capture(31),stageOptions());make().cancel();make().restartStaged(capture(47),stageOptions());return ref.stageId
        }
        fun cold(){vault.lock();storage.close();storage=E2eeSqliteStorage(context);vault=UnlockedE2eeVault(storage,actor)}
        fun rowHash():String {
            val digest=MessageDigest.getInstance("SHA-256")
            for(key in storage.list("").sorted()){val row=requireNotNull(storage.get(key));val raw=JSONArray().put(key).put(row.serial).put(row.envelope.toJson()).toString().toByteArray();try{digest.update(raw)}finally{raw.fill(0)}}
            return E2eeEnvelope.encode(digest.digest())
        }
        override fun close(){live.set(false);vault.lock();storage.close();check(folder.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&folder.name.startsWith("migration-history-synthetic-"));check(folder.deleteRecursively())}
    }
    private fun save(value:JSONObject){val app=InstrumentationRegistry.getInstrumentation().targetContext;val folder=requireNotNull(app.getExternalFilesDir(null));File(folder,"migration-history336-proof.json").outputStream().use{it.write(value.toString().toByteArray());it.fd.sync()}}
    private suspend fun refuses(body:suspend()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Invalid source history accepted")}
    @Test fun coldActualCoordinatorReadsEveryMixedOriginalAndCompleteOrphanWithIndependentFullDigests()=runBlocking {
        Rig(1024*1024+7).use{f->val started=SystemClock.elapsedRealtime();val orphan=f.prepare();f.cold();val before=f.rowHash();val count=f.storage.list("").size
            val proof=JSONArray();var retained:E2eeStagedSourceInput?=null;var total=0L
            f.make().withStagedSourceHistory(f.inventory,f.historyOptions()){input->
                retained=input;val sources=listOf(input.current)+input.previous;assertEquals(4,sources.size);assertEquals("stage:$orphan",sources[2].id)
                val seeds=listOf(47,0,17,31);val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
                try{for((sourceIndex,source)in sources.withIndex()){
                    val hashes=JSONArray();val sizes=JSONArray()
                    for((pathIndex,path)in source.paths.withIndex()){
                        val reader=source.openPath(path);val digest=MessageDigest.getInstance("SHA-256");var size=0
                        reader.input.use{stream->while(true){val read=stream.read(buffer);if(read<0)break;assertTrue(read<=E2eeFiles.CHUNK_BYTES);for(offset in 0 until read)assertEquals(((size+offset)*31+pathIndex*17+seeds[sourceIndex]).toByte(),buffer[offset]);digest.update(buffer,0,read);size+=read;buffer.fill(0)};reader.assertComplete()}
                        assertEquals(if(pathIndex==0)f.firstSize else 3,size);hashes.put(E2eeEnvelope.encode(digest.digest()));sizes.put(size);total+=size
                    }
                    proof.put(JSONObject().put("sourceId",source.id).put("sha256",hashes).put("sizes",sizes))
                }}finally{buffer.fill(0)}
            }
            assertEquals(4194392L,total);assertEquals(before,f.rowHash());assertEquals(count,f.storage.list("").size);assertEquals(0,f.network)
            refuses{requireNotNull(retained).current.openPath(f.paths.first())};refuses{f.make().run()}
            save(JSONObject().put("synthetic",true).put("componentOnly",true).put("actualCoordinator",true).put("coldSqlite",true).put("rowsUnchanged",true)
                .put("networkCalls",f.network).put("retainedRows",count).put("decodedBytes",total).put("sources",proof).put("elapsedMs",SystemClock.elapsedRealtime()-started).put("maxHeap",Runtime.getRuntime().maxMemory()))
        }
    }
    @Test fun missedEofRetirementUnknownOriginalAndConsumerFailureKeepEveryStoredRow()=runBlocking {
        Rig(17).use{f->f.prepare();f.cold();val before=f.rowHash();var retained:E2eeStagedPathReader?=null
            refuses{f.make().withStagedSourceHistory(f.inventory,f.historyOptions()){}}
            refuses{f.make().withStagedSourceHistory(f.inventory,f.historyOptions()){input->val reader=input.current.openPath(f.paths.first());retained=reader;reader.input.read();error("E2EE_SYNTHETIC_CONSUMER_FAILURE")}}
            refuses{requireNotNull(retained).input.read()};assertEquals(before,f.rowHash())
            refuses{f.make().withStagedSourceHistory(f.inventory,f.historyOptions()){f.live.set(false)}};f.live.set(true);assertEquals(before,f.rowHash())
            val copyKey=f.storage.list("").first{it.contains(":cancel:")};val originalCopy=requireNotNull(f.storage.get(copyKey));val copyId=originalCopy.envelope.context.toJson().getString("objectId")
            val copyRaw=requireNotNull(f.vault.read("local-snapshot",copyId));val altered=JSONObject(copyRaw.bytes.toString(Charsets.UTF_8));copyRaw.bytes.fill(0)
            if(altered.getInt("protocol")==3)altered.getJSONObject("source").getJSONObject("reference").put("manifestHash","A".repeat(43))else altered.put("snapshotHash","A".repeat(43))
            f.storage.commit(listOf(E2eeStorageChange(copyKey,originalCopy.serial,null)),f::current);val changed=altered.toString().toByteArray()
            try{f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",copyId,changed,null)))}finally{changed.fill(0)}
            var invalidConsumer=false
            try{refuses{f.make().withStagedSourceHistory(f.inventory,f.historyOptions()){invalidConsumer=true}};assertFalse(invalidConsumer)}
            finally{f.storage.commit(listOf(E2eeStorageChange(copyKey,1,originalCopy)),f::current)}
            assertEquals(before,f.rowHash())
            f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","unresolved:source:0",byteArrayOf(1),null)));val unknown=f.rowHash();var called=false
            refuses{f.make().withStagedSourceHistory(f.inventory,f.historyOptions()){called=true}};assertFalse(called);assertEquals(unknown,f.rowHash());assertEquals(0,f.network)
        }
    }
}
