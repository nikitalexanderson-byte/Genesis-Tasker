package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.SecretKey

class E2eeOriginalLegacySourceTest {
    private class Memory:E2eeRecordStorage {
        val rows=mutableMapOf<String,E2eeLocalRecord>();var writes=0;var reads=0;var beforeGet:(()->Unit)?=null
        override fun get(key:String):E2eeLocalRecord? {reads++;beforeGet?.invoke();return rows[key]}
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){requireOpen();for(row in changes)check(rows[row.key]?.serial==row.expected){"E2EE_LOCAL_CONFLICT"};for(row in changes)if(row.value==null)rows.remove(row.key)else rows[row.key]=row.value;writes++}
    }
    private val inventory by lazy{val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}.map{File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile};E2eePrivatePaths(JSONObject(file.readText()))}
    private inner class Rig {
        val storage=Memory();val original=E2eeOriginalSource.Identity("original-actor","device:original-legacy","original-device",1,1,1)
        val target=E2eeSourceStage.Target("content-owner","project:original-legacy","project");val paths=inventory.required("project").map{it.id};val values=paths.mapIndexed{index,_->ByteArray(if(index==0)E2eeFiles.CHUNK_BYTES+7 else 3){(it*31+index*17).toByte()}}
        val live=AtomicBoolean(true);val reference:E2eeLegacySnapshotStream.Reference;val root:SecretKey;val signer:PublicKey;val active:UnlockedE2eeVault
        init{
            val keys=E2eeKeys.generateDeviceKeys();val raw=E2eeKeys.freshSecret();val secret=E2eeKeys.freshSecret();val saved=E2eeKeys.protectBundle(original.ownerId,"synthetic-old-root-only",secret,raw);val producedRoot=E2eeEnvelope.importRoot(raw);raw.fill(0)
            val old=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(original.ownerId,original.scopeId,original.deviceId,1,1,1,"old-local-root",keys.signing.private,mapOf("old-local-root" to producedRoot)){if(it==original.deviceId)keys.signing.public else null})
            val rows=JSONArray();for(index in paths.indices)rows.put(JSONObject().put("id",paths[index]).put("bytes",E2eeEnvelope.encode(values[index])))
            val bytes=JSONObject().put("protocol",1).put("ownerId",target.ownerId).put("scopeId",target.scopeId).put("paths",rows).toString().toByteArray();val migrationId=UUID.randomUUID().toString()
            reference=E2eeLegacySnapshotStream.Reference(migrationId,bytes.size,(bytes.size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES,E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)))
            try{for(index in 0 until reference.snapshotParts){val part=bytes.copyOfRange(index*E2eeFiles.CHUNK_BYTES,minOf(bytes.size,(index+1)*E2eeFiles.CHUNK_BYTES));try{old.write(listOf(UnlockedE2eeVault.Write("local-snapshot","$migrationId:source:$index",part,null)))}finally{part.fill(0)}}}finally{bytes.fill(0);old.lock()}
            val recovered=E2eeKeys.openBundle(original.ownerId,"synthetic-old-root-only",secret,saved);secret.fill(0);root=try{E2eeEnvelope.importRoot(recovered)}finally{recovered.fill(0)}
            signer=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(keys.signing.public.encoded))
            val activeKeys=E2eeKeys.generateDeviceKeys();val activeRoot=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
            active=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(original.ownerId,"device:new","new-device",1,1,1,"new-local-root",activeKeys.signing.private,mapOf("new-local-root" to activeRoot)){if(it=="new-device")activeKeys.signing.public else null})
            active.write(listOf(UnlockedE2eeVault.Write("draft","new-device-work",byteArrayOf(9,8,7),null)))
        }
        val guard:()->Unit={check(live.get()){"E2EE_ACCOUNT_CHANGED"}}
        fun open(identity:E2eeOriginalSource.Identity=original,roots:Map<String,SecretKey> =mapOf("old-local-root" to root),signer:PublicKey=this.signer,target:E2eeSourceStage.Target=this.target,
            paths:List<String> =this.paths,reference:E2eeLegacySnapshotStream.Reference=this.reference)=E2eeOriginalSource.openLegacy(storage,identity,roots,signer,target,paths,reference,inventory,guard)
    }
    private fun refuses(body:()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Invalid original legacy authority accepted")}
    @Test fun independentRootAndPublicSignerReadOldContentWithoutChangingTheNewDevice(){
        val f=Rig();val before=f.storage.rows.toMap();val writes=f.storage.writes;val identity=f.active.localIdentity();val handle=f.open();assertEquals(f.reference,handle.reference);assertEquals(f.paths,handle.paths)
        for(index in f.paths.indices){val reader=handle.openPath(f.paths[index]);assertArrayEquals(f.values[index],reader.readBytes());reader.assertComplete();reader.close()};handle.close();assertEquals(writes,f.storage.writes);for((key,row)in before)assertSame(row,f.storage.rows[key]);assertEquals(identity,f.active.localIdentity());refuses{handle.openPath(f.paths[0])};f.active.lock()
    }
    @Test fun foreignOriginalActorGenerationEpochRootSignerTargetAndHashNeverBecomeEmptyRecovery(){
        val f=Rig();for(identity in listOf(f.original.copy(ownerId="foreign"),f.original.copy(scopeId="device:foreign"),f.original.copy(deviceId="new-device"),f.original.copy(generation=2),f.original.copy(cryptoEpoch=0)))refuses{f.open(identity=identity)}
        refuses{f.open(roots=emptyMap())};val wrong=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}};refuses{f.open(roots=mapOf("old-local-root" to wrong))};refuses{f.open(signer=E2eeKeys.generateDeviceKeys().signing.public)}
        refuses{f.open(target=f.target.copy(scopeId="project:foreign"))};refuses{f.open(reference=f.reference.copy(snapshotHash=E2eeEnvelope.encode(ByteArray(32))))}
    }
    @Test fun referenceAndFullPathPreflightHappenBeforeAnyOriginalBodyLookup(){
        val f=Rig();for(reference in listOf(f.reference.copy(snapshotSize=0),f.reference.copy(snapshotParts=Int.MAX_VALUE),f.reference.copy(snapshotSize=Int.MAX_VALUE))){val count=f.storage.reads;refuses{f.open(reference=reference)};assertEquals(count,f.storage.reads)}
        val count=f.storage.reads;refuses{f.open(paths=f.paths.drop(1))};assertEquals(count,f.storage.reads)
    }
    @Test fun stageAndLegacyReadPurposesCannotAccessEachOthersNamespacesOrOtherDomains(){
        val f=Rig();val legacy=E2eeOriginalSource.Vault(f.storage,f.original,mapOf("old-local-root" to f.root),f.signer,f.guard,f.reference);val stage=E2eeOriginalSource.Vault(f.storage,f.original,mapOf("old-local-root" to f.root),f.signer,f.guard)
        val count=f.storage.reads;for(id in listOf("source-stage:anything","${UUID.randomUUID()}:source:0","${f.reference.migrationId}:source:999"))refuses{legacy.read("local-snapshot",id)}
        refuses{legacy.read("outbox","${f.reference.migrationId}:source:0")};refuses{stage.read("outbox","source-stage-catalog:anything")};refuses{stage.read("local-snapshot","${f.reference.migrationId}:source:0")};refuses{legacy.listLocal("local-snapshot","source-stage:")};refuses{stage.listLocal("local-snapshot","${f.reference.migrationId}:source:")};assertEquals(count,f.storage.reads);legacy.close();stage.close()
    }
    @Test fun keyMapAndRequiredPathsAreCapturedBeforeTheFirstStorageRead(){
        val f=Rig();val roots=mutableMapOf("old-local-root" to f.root);val paths=f.paths.toMutableList();f.storage.beforeGet={roots.clear();paths.clear()};val handle=f.open(roots=roots,paths=paths);val source=handle.openPath(f.paths[0]);assertArrayEquals(f.values[0],source.readBytes());source.assertComplete();source.close();handle.close()
    }
    @Test fun closingDuringOriginalStorageReadRevokesItsContinuationAndPreservesEveryRow(){
        for(actor in listOf(false,true)){val f=Rig();val handle=f.open();val entered=CountDownLatch(1);val release=CountDownLatch(1);f.storage.beforeGet={entered.countDown();check(release.await(5,TimeUnit.SECONDS))};val source=handle.openPath(f.paths[0]);val out=ByteArray(3);val before=f.storage.rows.toMap();val pool=Executors.newSingleThreadExecutor()
            try{val pending=pool.submit<Boolean>{try{source.read(out);false}catch(error:Exception){error.message.orEmpty().startsWith("E2EE_")}};assertTrue(entered.await(5,TimeUnit.SECONDS));if(actor)f.live.set(false)else handle.close();release.countDown();assertTrue(pending.get(5,TimeUnit.SECONDS));assertTrue(out.all{it==0.toByte()});for((key,row)in before)assertSame(row,f.storage.rows[key])}finally{release.countDown();pool.shutdownNow();handle.close()}
        }
    }
}
