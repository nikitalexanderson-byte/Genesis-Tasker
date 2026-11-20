package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
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
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

/** Isolated synthetic custody only. This exercises source read capability after
 * old alias loss, not product recovery UX, real users or whole-account coverage. */
class E2eeOriginalSourceDeviceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(app.noBackupFilesDir,"original-source-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=directory}
        val alias="genesis.qa.original-source.${UUID.randomUUID()}";val cipher=LocalCipher(alias);val recoverySecret=E2eeKeys.freshSecret()
        val raw=E2eeKeys.freshSecret();val keys=E2eeKeys.generateDeviceKeys();val keyId="original-local-root"
        val original=E2eeOriginalSource.Identity("original-actor","device:original-source","original-device",1,1,1)
        val target=E2eeSourceStage.Target("content-owner","project:original-source","project");val paths=listOf("project.content","project.local-work")
        val publicSigner=E2eeKeys.publicKeys(keys).getString("signingKey");var live=true
        val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"}}
        var storage=E2eeSqliteStorage(context,true)
        val old=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(original.ownerId,original.scopeId,original.deviceId,1,1,1,keyId,keys.signing.private,mapOf(keyId to E2eeEnvelope.importRoot(raw))){if(it==original.deviceId)keys.signing.public else null})
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))
            val recoveryBundle=E2eeKeys.protectBundle(original.ownerId,"synthetic-original-source",recoverySecret,raw)
            File(directory,"recovery-root.bundle").outputStream().use{out->out.write(recoveryBundle.toString().toByteArray());out.fd.sync()}
            val oldBundle=JSONObject().put("root",E2eeEnvelope.encode(raw)).put("deviceKeys",E2eeKeys.exportPrivateKeys(keys))
            File(directory,"old-device.bundle").outputStream().use{out->out.write(cipher.encrypt(oldBundle.toString(),"synthetic-original-source-device").toByteArray());out.fd.sync()}
        }
        fun stage(size:Long):E2eeSourceStage.Reference {
            val stage=E2eeSourceStage.create(E2eeSourceStage.Options(old,target,paths,E2eeSourceStage.Capacity(80L*1024*1024,512),{},current,{request->check(directory.usableSpace>2L*E2eeFiles.CHUNK_BYTES+request.metadataBytes){"SYNTHETIC_NO_SPACE"}}))
            val buffer=ByteArray(65536)
            try{for((pathIndex,path)in paths.withIndex())stage.capturePath(path){out->var at=0L;while(at<size){val count=minOf(buffer.size.toLong(),size-at).toInt();for(index in 0 until count)buffer[index]=((at+index)*37+pathIndex*17).toByte();out.write(buffer,0,count);at+=count}}}
            finally{buffer.fill(0)}
            return stage.finish()
        }
        fun loseOriginalAlias(){old.lock();raw.fill(0);storage.close();val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};assertTrue(store.containsAlias(alias));store.deleteEntry(alias);assertFalse(store.containsAlias(alias));storage=E2eeSqliteStorage(context)}
        fun recoveredRoot():javax.crypto.SecretKey {
            val bundle=JSONObject(File(directory,"recovery-root.bundle").readText());val bytes=E2eeKeys.openBundle(original.ownerId,"synthetic-original-source",recoverySecret,bundle)
            return try{E2eeEnvelope.importRoot(bytes)}finally{bytes.fill(0)}
        }
        fun signer()=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(publicSigner,1,8192)))
        override fun close(){old.lock();raw.fill(0);recoverySecret.fill(0);storage.close();val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};if(store.containsAlias(alias))store.deleteEntry(alias)
            check(directory.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&directory.name.startsWith("original-source-synthetic-"));check(directory.deleteRecursively())}
    }
    private fun save(file:File,value:JSONObject){file.outputStream().use{out->out.write(value.toString().toByteArray());out.fd.sync()}}
    private fun identity(value:E2eeOriginalSource.Identity)=JSONObject().put("ownerId",value.ownerId).put("scopeId",value.scopeId).put("deviceId",value.deviceId).put("generation",value.generation).put("cryptoEpoch",value.cryptoEpoch).put("securityEpoch",value.securityEpoch)
    private fun target(value:E2eeSourceStage.Target)=JSONObject().put("ownerId",value.ownerId).put("scopeId",value.scopeId).put("kind",value.kind)
    private fun ref(value:E2eeSourceStage.Reference)=JSONObject().put("stageId",value.stageId).put("manifestHash",value.manifestHash)
    @Test fun coldOriginalSourceReadsEveryByteAfterOnlyTheSyntheticOldAliasIsDeletedWithoutImportingOldPrivateKeys(){
        Rig().use{f->
            val started=SystemClock.elapsedRealtime();val size=35L*1024*1024+17;val reference=f.stage(size);f.loseOriginalAlias()
            val activeKeys=E2eeKeys.generateDeviceKeys();val activeRaw=E2eeKeys.freshSecret()
            val active=try{UnlockedE2eeVault(f.storage,UnlockedE2eeVault.Scope(f.original.ownerId,"device:new-source","new-device",1,1,1,"new-local-root",activeKeys.signing.private,mapOf("new-local-root" to E2eeEnvelope.importRoot(activeRaw))){if(it=="new-device")activeKeys.signing.public else null})}finally{activeRaw.fill(0)}
            val activeIdentity=active.localIdentity();val hashes=JSONArray();var total=0L
            E2eeOriginalSource.open(f.storage,f.original,mapOf(f.keyId to f.recoveredRoot()),f.signer(),f.target,reference,f.current).use{handle->
                assertEquals(f.paths,handle.paths)
                for((pathIndex,path)in handle.paths.withIndex())handle.openPath(path).use{source->val bytes=ByteArray(65536);val hash=MessageDigest.getInstance("SHA-256");var at=0L
                    try{while(true){val count=source.read(bytes);if(count<0)break;assertTrue(count in 1..bytes.size);for(index in 0 until count)if(bytes[index]!=((at+index)*37+pathIndex*17).toByte())error("SYNTHETIC_ORIGINAL_BYTE_MISMATCH");hash.update(bytes,0,count);at+=count;bytes.fill(0)};source.assertComplete();assertEquals(size,at);total+=at;hashes.put(hash.digest().joinToString(""){"%02x".format(it)})}
                    finally{bytes.fill(0)}
                }
            }
            assertEquals(activeIdentity,active.localIdentity());assertEquals("new-device",active.localIdentity().deviceId);active.lock()
            val proof=JSONObject().put("synthetic",true).put("componentOnly",true).put("oldAliasRemoved",true).put("oldPrivateKeysImportedByReader",false)
                .put("originalDevice",f.original.deviceId).put("newDevice",activeIdentity.deviceId).put("pathBytes",size).put("paths",f.paths.size).put("totalReadBytes",total).put("sha256",hashes)
                .put("maxHeap",Runtime.getRuntime().maxMemory()).put("elapsedMs",SystemClock.elapsedRealtime()-started)
            save(File(f.app.getExternalFilesDir(null),"original-source336-large-proof.json"),proof)
        }
    }
    @Test fun actualProviderRejectsForeignKeysContextAndRetirementAndExportsPublicReadOnlyInterop(){
        Rig().use{f->
            val reference=f.stage(3);val publicRaw=f.raw.copyOf();f.loseOriginalAlias();val root=f.recoveredRoot();val signer=f.signer()
            assertTrue(assertThrows(Exception::class.java){E2eeOriginalSource.open(f.storage,f.original.copy(deviceId="new-device"),mapOf(f.keyId to root),signer,f.target,reference,f.current)}.message.orEmpty().startsWith("E2EE_"))
            assertTrue(assertThrows(Exception::class.java){E2eeOriginalSource.open(f.storage,f.original,mapOf(f.keyId to root),E2eeKeys.generateDeviceKeys().signing.public,f.target,reference,f.current)}.message.orEmpty().startsWith("E2EE_"))
            val handle=E2eeOriginalSource.open(f.storage,f.original,mapOf(f.keyId to root),signer,f.target,reference,f.current);val input=handle.openPath(f.paths[0]);val first=ByteArray(1);assertEquals(1,input.read(first))
            assertThrows(IllegalStateException::class.java){handle.openPath(f.paths[0])};f.live=false;assertThrows(IllegalStateException::class.java){input.read(first)};assertThrows(IllegalStateException::class.java){input.assertComplete()};handle.close();first.fill(0);f.live=true
            val prefix=listOf(f.original.ownerId,f.original.scopeId,"local-snapshot").joinToString(""){"${it.length}:$it"}
            val records=JSONArray();for(key in f.storage.list(prefix)){val row=requireNotNull(f.storage.get(key));records.put(JSONObject().put("key",key).put("serial",row.serial).put("envelope",row.envelope.toJson()))}
            val paths=JSONArray();for((index,path)in f.paths.withIndex())paths.put(JSONObject().put("id",path).put("plaintext",E2eeEnvelope.encode(ByteArray(3){(it*37+index*17).toByte()})))
            val vector=JSONObject().put("synthetic",true).put("warning","PUBLIC TEST KEYS; DO NOT USE FOR USER DATA").put("producer","Android/JCA API${android.os.Build.VERSION.SDK_INT} original source reader")
                .put("original",identity(f.original)).put("target",target(f.target)).put("reference",ref(reference)).put("rootKey",E2eeEnvelope.encode(publicRaw)).put("keyId",f.keyId).put("publicKeySpki",f.publicSigner).put("paths",paths).put("records",records)
            try{save(File(f.app.getExternalFilesDir(null),"original-source336-native-vector.json"),vector)}finally{publicRaw.fill(0)}
        }
    }
}
