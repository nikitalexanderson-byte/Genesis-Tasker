package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.os.SystemClock
import android.util.Base64
import android.util.Base64OutputStream
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/** Real JCA/encrypted SQLite, owned generated old-wrapper fixtures only. No
 * authenticated custody, product adapter, backend IO or activation is claimed. */
class E2eeLegacySnapshotStreamDeviceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(app.noBackupFilesDir,"legacy-snapshot-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=directory}
        val rawRoot=E2eeKeys.freshSecret();val root=E2eeEnvelope.importRoot(rawRoot);val keys=E2eeKeys.generateDeviceKeys();val live=AtomicBoolean(true)
        val actor=UnlockedE2eeVault.LocalIdentity("legacy-actor","device:legacy-reader","legacy-device")
        val scope=UnlockedE2eeVault.Scope(actor.ownerId,actor.scopeId,actor.deviceId,1,1,1,"local-root",keys.signing.private,mapOf("local-root" to root)){if(it==actor.deviceId)keys.signing.public else null}
        var storage=E2eeSqliteStorage(context,true);var vault=UnlockedE2eeVault(storage,scope)
        val inventory=E2eePrivatePaths.load(app);val paths=inventory.required("project").map{it.id};val target=E2eeSourceStage.Target("content-owner","project:legacy-reader","project")
        init{check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))}
        fun options(reference:E2eeLegacySnapshotStream.Reference,vault:E2eeSourceReadVault=this.vault)=E2eeLegacySnapshotStream.Options(vault,target,paths,reference,inventory){check(live.get()){"E2EE_ACCOUNT_CHANGED"}}
        fun cold(){vault.lock();storage.close();storage=E2eeSqliteStorage(context);vault=UnlockedE2eeVault(storage,scope)}
        inner class Parts(private val migrationId:String):OutputStream() {
            private val buffer=ByteArray(E2eeFiles.CHUNK_BYTES);private val digest=MessageDigest.getInstance("SHA-256");private var used=0;private var parts=0;private var total=0
            private fun store(){val bytes=buffer.copyOf(used);try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","$migrationId:source:${parts++}",bytes,null)))}finally{bytes.fill(0);buffer.fill(0);used=0}}
            override fun write(value:Int){val byte=byteArrayOf(value.toByte());try{write(byte,0,1)}finally{byte.fill(0)}}
            override fun write(bytes:ByteArray,offset:Int,length:Int){digest.update(bytes,offset,length);total+=length;var at=offset;while(at<offset+length){val count=minOf(buffer.size-used,offset+length-at);bytes.copyInto(buffer,used,at,at+count);used+=count;at+=count;if(used==buffer.size)store()}}
            fun text(value:String){val bytes=value.toByteArray();try{write(bytes)}finally{bytes.fill(0)}}
            fun finish():E2eeLegacySnapshotStream.Reference {if(used>0)store();val hash=digest.digest();try{return E2eeLegacySnapshotStream.Reference(migrationId,total,parts,E2eeEnvelope.encode(hash))}finally{hash.fill(0);buffer.fill(0)}}
        }
        fun source(firstSize:Int):E2eeLegacySnapshotStream.Reference {
            val sink=Parts(UUID.randomUUID().toString());sink.text("{\"protocol\":1,\"ownerId\":\"content-owner\",\"scopeId\":\"project:legacy-reader\",\"paths\":[")
            val block=ByteArray(65535);try{for((index,path)in paths.withIndex()){
                if(index>0)sink.text(",");sink.text("{\"id\":${JSONObject.quote(path)},\"bytes\":\"");val size=if(index==0)firstSize else 3
                Base64OutputStream(sink,Base64.URL_SAFE or Base64.NO_WRAP or Base64.NO_PADDING or Base64.NO_CLOSE).use{encoded->var at=0;while(at<size){val count=minOf(block.size,size-at);for(offset in 0 until count)block[offset]=((at+offset)*31+index*17).toByte();encoded.write(block,0,count);block.fill(0);at+=count}}
                sink.text("\"}")
            };sink.text("]}");return sink.finish()}finally{block.fill(0)}
        }
        override fun close(){live.set(false);vault.lock();storage.close();rawRoot.fill(0);check(directory.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&directory.name.startsWith("legacy-snapshot-synthetic-"));check(directory.deleteRecursively())}
    }
    private fun save(name:String,value:JSONObject){val app=InstrumentationRegistry.getInstrumentation().targetContext;val folder=requireNotNull(app.getExternalFilesDir(null));File(folder,name).outputStream().use{it.write(value.toString().toByteArray());it.fd.sync()}}
    private fun refuses(body:()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Invalid old wrapper accepted")}
    @Test fun coldSqliteOriginalWrapperAndAllDecodedPathsKeepCompleteIndependentDigests(){
        Rig().use{f->val start=SystemClock.elapsedRealtime();val size=9*1024*1024+7;val reference=f.source(size);f.cold();val before=f.storage.list("").toSet();val opened=E2eeLegacySnapshotStream.open(f.options(reference));assertEquals(reference,opened.reference);val hashes=JSONArray();val sizes=JSONArray();val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
            try{for((index,path)in f.paths.withIndex()){val source=opened.openPath(path);val hash=MessageDigest.getInstance("SHA-256");var total=0;while(true){val count=source.read(buffer);if(count<0)break;assertTrue(count<=E2eeFiles.CHUNK_BYTES);for(offset in 0 until count)assertEquals(((total+offset)*31+index*17).toByte(),buffer[offset]);hash.update(buffer,0,count);total+=count;buffer.fill(0)};source.assertComplete();source.close();assertEquals(if(index==0)size else 3,total);sizes.put(total);val digest=hash.digest();try{hashes.put(E2eeEnvelope.encode(digest))}finally{digest.fill(0)}}}finally{buffer.fill(0);opened.close()}
            assertEquals(before,f.storage.list("").toSet());save("legacy-snapshot336-large-proof.json",JSONObject().put("synthetic",true).put("componentOnly",true).put("coldSqlite",true).put("snapshotSize",reference.snapshotSize).put("snapshotParts",reference.snapshotParts).put("snapshotHash",reference.snapshotHash).put("sizes",sizes).put("sha256",hashes).put("elapsedMs",SystemClock.elapsedRealtime()-start).put("maxHeap",Runtime.getRuntime().maxMemory()))
        }
    }
    @Test fun publicKeyOnlyVectorAndClosedOrRetiredReadersNeverRestoreOriginalSigningAuthority(){
        Rig().use{f->val reference=f.source(3);val raw=mutableListOf<ByteArray>();val tracked=object:E2eeSourceReadVault by f.vault {override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened?=f.vault.read(domain,objectId)?.also{raw+=it.bytes}}
            val opened=E2eeLegacySnapshotStream.open(f.options(reference,tracked));val source=opened.openPath(f.paths[0]);val bytes=ByteArray(3);assertEquals(3,source.read(bytes));refuses{opened.openPath(f.paths[1])};refuses{source.assertComplete()};opened.close();assertTrue(raw.all{part->part.all{it==0.toByte()}});refuses{source.read(bytes)};bytes.fill(0)
            val sequential=E2eeLegacySnapshotStream.open(f.options(reference));val prior=sequential.openPath(f.paths[0]);assertEquals(3,prior.read(bytes));assertEquals(-1,prior.read(bytes));prior.assertComplete();val next=sequential.openPath(f.paths[1]);assertEquals(3,next.read(bytes));prior.close();assertEquals(-1,next.read(bytes));next.assertComplete();next.close();sequential.close();bytes.fill(0)
            val retiring=E2eeLegacySnapshotStream.open(f.options(reference));val pending=retiring.openPath(f.paths[0]);f.live.set(false);refuses{pending.read(bytes)};retiring.close();f.live.set(true)
            refuses{E2eeLegacySnapshotStream.open(f.options(reference.copy(snapshotHash=E2eeEnvelope.encode(ByteArray(32)))))}
            val records=JSONArray();for(key in f.storage.list("")){val record=requireNotNull(f.storage.get(key));records.put(JSONObject().put("key",key).put("serial",record.serial).put("envelope",record.envelope.toJson()))}
            save("legacy-snapshot336-native-vector.json",JSONObject().put("synthetic",true).put("warning","PUBLIC TEST KEYS; DO NOT USE FOR USER DATA").put("producer","Android/JCA API${Build.VERSION.SDK_INT}")
                .put("actor",JSONObject().put("ownerId",f.actor.ownerId).put("scopeId",f.actor.scopeId).put("deviceId",f.actor.deviceId)).put("localKeyId","local-root").put("localRootKey",E2eeEnvelope.encode(f.rawRoot)).put("publicKeySpki",E2eeKeys.publicKeys(f.keys).getString("signingKey"))
                .put("target",JSONObject().put("ownerId",f.target.ownerId).put("scopeId",f.target.scopeId).put("kind",f.target.kind)).put("paths",JSONArray(f.paths))
                .put("reference",JSONObject().put("migrationId",reference.migrationId).put("snapshotSize",reference.snapshotSize).put("snapshotParts",reference.snapshotParts).put("snapshotHash",reference.snapshotHash)).put("records",records))
        }
    }
}
