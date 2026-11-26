package ru.genesis.calendar.security

import org.junit.Assert.*
import org.junit.Test
import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec

class E2eeOriginalSourceTest {
    private class Memory:E2eeRecordStorage {
        val rows=mutableMapOf<String,E2eeLocalRecord>();var writes=0;var beforeGet:((String)->Unit)?=null
        override fun get(key:String):E2eeLocalRecord?{beforeGet?.invoke(key);return rows[key]}
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){requireOpen();for(row in changes)check(rows[row.key]?.serial==row.expected){"E2EE_LOCAL_CONFLICT"}
            for(row in changes)if(row.value==null)rows.remove(row.key)else rows[row.key]=row.value;writes++}
    }
    private class Rig {
        val memory=Memory();val keys=E2eeKeys.generateDeviceKeys();val original=E2eeOriginalSource.Identity("original-actor","device:original","original-device",1,1,1)
        val target=E2eeSourceStage.Target("project-content-owner","project:original-input","project");val paths=listOf("project.content","project.local-work")
        val input=ByteArray(E2eeFiles.CHUNK_BYTES*2+37){(it*37).toByte()};var live=true
        val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"}}
        val roots=E2eeKeys.freshSecret().let{raw->try{mutableMapOf("original-local-root" to E2eeEnvelope.importRoot(raw))}finally{raw.fill(0)}}
        val signer=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(keys.signing.public.encoded))
        val reference:E2eeSourceStage.Reference
        init {
            val old=UnlockedE2eeVault(memory,UnlockedE2eeVault.Scope(original.ownerId,original.scopeId,original.deviceId,1,1,1,"original-local-root",keys.signing.private,roots.toMap()){if(it==original.deviceId)keys.signing.public else null})
            val stage=E2eeSourceStage.create(E2eeSourceStage.Options(old,target,paths,E2eeSourceStage.Capacity(4L*1024*1024,16),{},current,{}))
            for(path in paths)stage.capturePath(path){out->var at=0;while(at<input.size){val count=minOf(65536,input.size-at);out.write(input,at,count);at+=count}}
            reference=stage.finish();old.lock()
        }
        fun open()=E2eeOriginalSource.open(memory,original,roots,signer,target,reference,current)
    }
    private fun refuses(body:()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Forbidden original source accepted")}
    @Test fun independentlyImportedPublicSignerReadsOriginalActorBytesWithoutWritesOrNewDeviceRebinding(){
        val f=Rig();val writes=f.memory.writes;val activeKeys=E2eeKeys.generateDeviceKeys();val activeRaw=E2eeKeys.freshSecret()
        val active=try{UnlockedE2eeVault(f.memory,UnlockedE2eeVault.Scope(f.original.ownerId,"device:new","new-device",1,1,1,"new-root",activeKeys.signing.private,mapOf("new-root" to E2eeEnvelope.importRoot(activeRaw))){if(it=="new-device")activeKeys.signing.public else null})}finally{activeRaw.fill(0)}
        val identity=active.localIdentity()
        f.open().use{handle->assertEquals(f.paths,handle.paths);for(path in handle.paths)handle.openPath(path).use{reader->val bytes=reader.readBytes();try{assertArrayEquals(f.input,bytes);reader.assertComplete()}finally{bytes.fill(0)}}}
        assertEquals(writes,f.memory.writes);assertEquals(identity,active.localIdentity());assertEquals("new-device",identity.deviceId);active.lock();f.input.fill(0)
    }
    @Test fun wrongOriginalCoordinatesRootSignerTargetAndManifestNeverBecomeEmptyRecovery(){
        val f=Rig();val writes=f.memory.writes
        for(identity in listOf(f.original.copy(ownerId="foreign"),f.original.copy(scopeId="device:foreign"),f.original.copy(deviceId="new-device"),f.original.copy(generation=2),f.original.copy(cryptoEpoch=0),f.original.copy(securityEpoch=0)))
            refuses{E2eeOriginalSource.open(f.memory,identity,f.roots,f.signer,f.target,f.reference,f.current).close()}
        val raw=E2eeKeys.freshSecret();val wrong=try{E2eeEnvelope.importRoot(raw)}finally{raw.fill(0)}
        for(roots in listOf(emptyMap(),mapOf("original-local-root" to wrong)))refuses{E2eeOriginalSource.open(f.memory,f.original,roots,f.signer,f.target,f.reference,f.current).close()}
        refuses{E2eeOriginalSource.open(f.memory,f.original,f.roots,E2eeKeys.generateDeviceKeys().signing.public,f.target,f.reference,f.current).close()}
        refuses{E2eeOriginalSource.open(f.memory,f.original,f.roots,f.signer,f.target.copy(ownerId="foreign"),f.reference,f.current).close()}
        refuses{E2eeOriginalSource.open(f.memory,f.original,f.roots,f.signer,f.target,f.reference.copy(manifestHash="A".repeat(43)),f.current).close()}
        assertEquals(writes,f.memory.writes);f.input.fill(0)
    }
    @Test fun originalRootMapIsCapturedBeforeTheFirstStorageRead(){
        val f=Rig();f.memory.beforeGet={f.roots.clear();f.memory.beforeGet=null}
        f.open().use{handle->handle.openPath(f.paths[0]).use{reader->val bytes=reader.readBytes();try{assertArrayEquals(f.input,bytes);reader.assertComplete()}finally{bytes.fill(0)}}};f.input.fill(0)
    }
    @Test fun duplicatePathReadersAreBoundedAndAClosedPrefixCanNeverCertifyCompletion(){
        val f=Rig();val handle=f.open();val reader=handle.openPath(f.paths[0]);refuses{handle.openPath(f.paths[0])}
        val bytes=ByteArray(65536);assertEquals(bytes.size,reader.read(bytes));handle.close();refuses{reader.read(bytes)};refuses{reader.assertComplete()};refuses{handle.openPath(f.paths[1])};bytes.fill(0);f.input.fill(0)
    }
    @Test fun closeOrAccountRetirementDuringStorageReadReturnsNoPlaintextAndCannotComplete(){
        for(close in listOf(true,false)){
            val f=Rig();val handle=f.open();val reader=handle.openPath(f.paths[0]);val bytes=ByteArray(65536)
            f.memory.beforeGet={key->if(key.contains(":p:00:00000")){f.memory.beforeGet=null;if(close)handle.close()else f.live=false}}
            refuses{reader.read(bytes)};assertTrue(bytes.all{it==0.toByte()});refuses{reader.assertComplete()};handle.close();f.input.fill(0)
        }
    }
}
