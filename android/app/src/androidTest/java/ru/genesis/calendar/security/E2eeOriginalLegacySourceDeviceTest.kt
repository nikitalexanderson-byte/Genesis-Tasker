package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
import android.os.Build
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import java.io.File
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.SecretKey

/** Owned synthetic root/public-key custody fixture only, not authenticated
 * recovery handoff, product migration, old-device enrollment or activation. */
class E2eeOriginalLegacySourceDeviceTest {
    private inner class Rig(size:Int):AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(app.noBackupFilesDir,"original-legacy-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=directory}
        val alias="genesis.qa.original-legacy.${UUID.randomUUID()}";val cipher=LocalCipher(alias);val secret=E2eeKeys.freshSecret();val raw=E2eeKeys.freshSecret();val producedRoot=E2eeEnvelope.importRoot(raw);val keys=E2eeKeys.generateDeviceKeys()
        val original=E2eeOriginalSource.Identity("original-actor","device:original-legacy","original-device",1,1,1);val target=E2eeSourceStage.Target("content-owner","project:original-legacy","project")
        val publicSpki=E2eeKeys.publicKeys(keys).getString("signingKey");val inventory=E2eePrivatePaths.load(app);val paths=inventory.required("project").map{it.id};val live=AtomicBoolean(true)
        var storage=E2eeSqliteStorage(context,true);val old=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(original.ownerId,original.scopeId,original.deviceId,1,1,1,"old-local-root",keys.signing.private,mapOf("old-local-root" to producedRoot)){if(it==original.deviceId)keys.signing.public else null})
        val reference:E2eeLegacySnapshotStream.Reference;val firstSize=size
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));save(File(directory,"root-only.bundle"),E2eeKeys.protectBundle(original.ownerId,"synthetic-old-root-only",secret,raw))
            val oldBundle=JSONObject().put("root",E2eeEnvelope.encode(raw)).put("keys",E2eeKeys.exportPrivateKeys(keys));val oldBytes=cipher.encrypt(oldBundle.toString(),"synthetic-original-legacy-device").toByteArray();try{File(directory,"old-device.bundle").outputStream().use{it.write(oldBytes);it.fd.sync()}}finally{oldBytes.fill(0)}
            val rows=JSONArray();for((index,path)in paths.withIndex()){val bytes=ByteArray(if(index==0)size else 3){(it*31+index*17).toByte()};try{rows.put(JSONObject().put("id",path).put("bytes",E2eeEnvelope.encode(bytes)))}finally{bytes.fill(0)}}
            val bytes=JSONObject().put("protocol",1).put("ownerId",target.ownerId).put("scopeId",target.scopeId).put("paths",rows).toString().toByteArray();val migrationId=UUID.randomUUID().toString()
            reference=E2eeLegacySnapshotStream.Reference(migrationId,bytes.size,(bytes.size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES,E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)))
            try{for(index in 0 until reference.snapshotParts){val part=bytes.copyOfRange(index*E2eeFiles.CHUNK_BYTES,minOf(bytes.size,(index+1)*E2eeFiles.CHUNK_BYTES));try{old.write(listOf(UnlockedE2eeVault.Write("local-snapshot","$migrationId:source:$index",part,null)))}finally{part.fill(0)}}}finally{bytes.fill(0);raw.fill(0)}
        }
        fun removeOnlyOldAlias(){old.lock();storage.close();val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};assertTrue(store.containsAlias(alias));store.deleteEntry(alias);assertFalse(store.containsAlias(alias));storage=E2eeSqliteStorage(context)}
        fun root():SecretKey {val recovered=E2eeKeys.openBundle(original.ownerId,"synthetic-old-root-only",secret,JSONObject(File(directory,"root-only.bundle").readText()));return try{E2eeEnvelope.importRoot(recovered)}finally{recovered.fill(0)}}
        fun signer():PublicKey=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(publicSpki,1,8192)))
        fun open(root:SecretKey=root())=E2eeOriginalSource.openLegacy(storage,original,mapOf("old-local-root" to root),signer(),target,paths,reference,inventory){check(live.get()){"E2EE_ACCOUNT_CHANGED"}}
        fun active():UnlockedE2eeVault {val keys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}};return UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(original.ownerId,"device:new","new-device",1,1,1,"new-local-root",keys.signing.private,mapOf("new-local-root" to root)){if(it=="new-device")keys.signing.public else null})}
        fun records()=storage.list("").associateWith{key->requireNotNull(storage.get(key)).let{row->row.serial.toString()+":"+row.envelope.toJson().toString()}}
        override fun close(){live.set(false);old.lock();storage.close();raw.fill(0);secret.fill(0);val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};if(store.containsAlias(alias))store.deleteEntry(alias)
            check(directory.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&directory.name.startsWith("original-legacy-synthetic-"));check(directory.deleteRecursively())}
    }
    private fun save(file:File,value:JSONObject){file.outputStream().use{it.write(value.toString().toByteArray());it.fd.sync()}}
    private fun export(name:String,value:JSONObject){val app=InstrumentationRegistry.getInstrumentation().targetContext;save(File(requireNotNull(app.getExternalFilesDir(null)),name),value)}
    private fun refuses(body:()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Invalid original legacy read accepted")}
    @Test fun independentRootAndPublicSignerOpenEveryOldByteAfterOnlyTheOldKeystoreAliasIsDeleted(){
        Rig(1024*1024+7).use{f->val start=SystemClock.elapsedRealtime();f.removeOnlyOldAlias();val active=f.active();active.write(listOf(UnlockedE2eeVault.Write("draft","new-device-work",byteArrayOf(9,8,7),null)));val identity=active.localIdentity();val before=f.records();val handle=f.open();val sizes=JSONArray();val hashes=JSONArray();val buffer=ByteArray(65536)
            try{for((index,path)in f.paths.withIndex()){val source=handle.openPath(path);val digest=MessageDigest.getInstance("SHA-256");var size=0;while(true){val count=source.read(buffer);if(count<0)break;for(at in 0 until count)assertEquals(((size+at)*31+index*17).toByte(),buffer[at]);digest.update(buffer,0,count);size+=count;buffer.fill(0)};source.assertComplete();source.close();sizes.put(size);val hash=digest.digest();try{hashes.put(E2eeEnvelope.encode(hash))}finally{hash.fill(0)}}}finally{buffer.fill(0);handle.close()}
            assertEquals(before,f.records());assertEquals(identity,active.localIdentity());val retained=requireNotNull(active.read("draft","new-device-work"));try{assertArrayEquals(byteArrayOf(9,8,7),retained.bytes)}finally{retained.bytes.fill(0)}
            val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};assertFalse(store.containsAlias(f.alias));active.lock()
            export("original-legacy336-proof.json",JSONObject().put("synthetic",true).put("componentOnly",true).put("oldAliasRemoved",true).put("publicSignerOnly",true).put("newIdentityUnchanged",true).put("rowsUnchanged",true).put("retainedRows",before.size).put("sourceBytes",f.reference.snapshotSize).put("sourceParts",f.reference.snapshotParts).put("sizes",sizes).put("sha256",hashes).put("elapsedMs",SystemClock.elapsedRealtime()-start).put("maxHeap",Runtime.getRuntime().maxMemory()))
        }
    }
    @Test fun closedForeignAndMissingAuthorityRefuseAndFreshPublicOnlyVectorCarriesNoOldPrivateKey(){
        Rig(3).use{f->f.removeOnlyOldAlias();val root=f.root();val handle=f.open(root);val source=handle.openPath(f.paths[0]);val bytes=ByteArray(3);handle.close();refuses{source.read(bytes)};assertTrue(bytes.all{it==0.toByte()})
            refuses{E2eeOriginalSource.openLegacy(f.storage,f.original,mapOf(),f.signer(),f.target,f.paths,f.reference,f.inventory){}}
            refuses{E2eeOriginalSource.openLegacy(f.storage,f.original.copy(deviceId="new-device"),mapOf("old-local-root" to root),f.signer(),f.target,f.paths,f.reference,f.inventory){}}
            val retired=f.open(root);val pending=retired.openPath(f.paths[0]);f.live.set(false);refuses{pending.read(bytes)};retired.close();f.live.set(true)
            val records=JSONArray();for(key in f.storage.list("")){val row=requireNotNull(f.storage.get(key));records.put(JSONObject().put("key",key).put("serial",row.serial).put("envelope",row.envelope.toJson()))}
            val rootBytes=requireNotNull(root.encoded);try{export("original-legacy336-native-vector.json",JSONObject().put("synthetic",true).put("warning","PUBLIC TEST KEYS; DO NOT USE FOR USER DATA").put("producer","Android/JCA API${Build.VERSION.SDK_INT}")
                .put("original",JSONObject().put("ownerId",f.original.ownerId).put("scopeId",f.original.scopeId).put("deviceId",f.original.deviceId).put("generation",f.original.generation).put("cryptoEpoch",f.original.cryptoEpoch).put("securityEpoch",f.original.securityEpoch))
                .put("localKeyId","old-local-root").put("localRootKey",E2eeEnvelope.encode(rootBytes)).put("publicKeySpki",f.publicSpki).put("target",JSONObject().put("ownerId",f.target.ownerId).put("scopeId",f.target.scopeId).put("kind",f.target.kind)).put("paths",JSONArray(f.paths))
                .put("reference",JSONObject().put("migrationId",f.reference.migrationId).put("snapshotSize",f.reference.snapshotSize).put("snapshotParts",f.reference.snapshotParts).put("snapshotHash",f.reference.snapshotHash)).put("records",records))}finally{rootBytes.fill(0)}
        }
    }
}
