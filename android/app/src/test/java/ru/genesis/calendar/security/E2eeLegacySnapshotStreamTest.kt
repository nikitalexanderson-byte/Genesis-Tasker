package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class E2eeLegacySnapshotStreamTest {
    private class Memory:E2eeRecordStorage {
        val rows=mutableMapOf<String,E2eeLocalRecord>()
        override fun get(key:String)=rows[key]
        override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
        override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){requireOpen();for(row in changes)check(rows[row.key]?.serial==row.expected){"E2EE_LOCAL_CONFLICT"};for(row in changes)if(row.value==null)rows.remove(row.key)else rows[row.key]=row.value}
    }
    private val inventory by lazy{val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}.map{File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile};E2eePrivatePaths(JSONObject(file.readText()))}
    private inner class Rig(size:Int=3,wire:(JSONObject)->String={it.toString()}) {
        val memory=Memory();val keys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        val vault=UnlockedE2eeVault(memory,UnlockedE2eeVault.Scope("legacy-actor","device:legacy-reader","legacy-device",1,1,1,"local-root",keys.signing.private,mapOf("local-root" to root)){if(it=="legacy-device")keys.signing.public else null})
        val live=AtomicBoolean(true);val paths=inventory.required("project").map{it.id};val target=E2eeSourceStage.Target("content-owner","project:legacy-reader","project")
        val values=paths.mapIndexed{index,_->ByteArray(if(index==0)size else 3){(it*31+index*17).toByte()}}
        val bytes:ByteArray;val reference:E2eeLegacySnapshotStream.Reference
        init{
            val rows=JSONArray();for(index in paths.indices)rows.put(JSONObject().put("id",paths[index]).put("bytes",E2eeEnvelope.encode(values[index])))
            bytes=wire(JSONObject().put("protocol",1).put("ownerId",target.ownerId).put("scopeId",target.scopeId).put("paths",rows)).toByteArray()
            val migrationId=UUID.randomUUID().toString();reference=E2eeLegacySnapshotStream.Reference(migrationId,bytes.size,(bytes.size+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES,E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)))
            for(index in 0 until reference.snapshotParts){val value=bytes.copyOfRange(index*E2eeFiles.CHUNK_BYTES,minOf(bytes.size,(index+1)*E2eeFiles.CHUNK_BYTES));try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","$migrationId:source:$index",value,null)))}finally{value.fill(0)}}
        }
        fun options(vault:E2eeSourceReadVault=this.vault,reference:E2eeLegacySnapshotStream.Reference=this.reference,paths:List<String> =this.paths)=E2eeLegacySnapshotStream.Options(vault,target,paths,reference,inventory){check(live.get()){"E2EE_ACCOUNT_CHANGED"}}
        fun open(options:E2eeLegacySnapshotStream.Options=options())=E2eeLegacySnapshotStream.open(options)
    }
    private fun refuses(body:()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Corrupt original wrapper accepted")}
    private fun collect(source:E2eeLegacySnapshotStream.Handle.SourceInput):ByteArray {val bytes=source.readBytes();source.assertComplete();return bytes}
    @Test fun everyPathKeepsTheExactOriginalReferenceAndNoCiphertextChanges(){
        val f=Rig(1024*1024+7);val before=f.memory.rows.toMap();val opened=f.open();assertEquals(f.reference,opened.reference);assertEquals(f.paths,opened.paths)
        for(index in f.paths.indices)assertArrayEquals(f.values[index],collect(opened.openPath(f.paths[index])));opened.close();assertEquals(before.keys,f.memory.rows.keys);for((key,row)in before)assertSame(row,f.memory.rows[key])
    }
    @Test fun arbitraryHistoricalSerializerFieldAndPathOrdersPreserveContent(){
        val f=Rig(wire={value->val rows=value.getJSONArray("paths");val reordered=JSONArray();for(index in rows.length()-1 downTo 0){val row=rows.getJSONObject(index);reordered.put(JSONObject().put("bytes",row.get("bytes")).put("id",row.get("id")))}
            "{\"paths\":$reordered,\"scopeId\":${JSONObject.quote(value.getString("scopeId"))},\"ownerId\":${JSONObject.quote(value.getString("ownerId"))},\"protocol\":1}"})
        val opened=f.open();for(index in f.paths.indices)assertArrayEquals(f.values[index],collect(opened.openPath(f.paths[index])));opened.close()
    }
    @Test fun jsonEscapesAtAPhysicalPartBoundaryAndUtf8BomKeepOriginalHash(){
        val f=Rig(E2eeFiles.CHUNK_BYTES+17){value->var raw=value.toString();val start=raw.indexOf("\"bytes\":\"")+9;val at=((start+E2eeFiles.CHUNK_BYTES-1)/E2eeFiles.CHUNK_BYTES)*E2eeFiles.CHUNK_BYTES-5
            check(at in start until raw.indexOf('"',start));val code=raw[at].code;raw=raw.take(at)+"\\u"+code.toString(16).padStart(4,'0')+raw.drop(at+1);"\uFEFF$raw"}
        val opened=f.open();assertArrayEquals(f.values[0],collect(opened.openPath(f.paths[0])));assertEquals(f.reference,opened.reference);opened.close()
    }
    @Test fun wrongOwnerScopeMissingPathsDuplicatesAndUnknownFieldsRefuse(){
        for(mode in listOf("owner","scope","missing","duplicate","extra","duplicate-key")){val f=Rig(wire={value->when(mode){"owner"->value.put("ownerId","foreign");"scope"->value.put("scopeId","foreign");"missing"->value.getJSONArray("paths").remove(0);"duplicate"->value.getJSONArray("paths").put(1,value.getJSONArray("paths").get(0));"extra"->value.put("extra",true)}
            val raw=value.toString();if(mode=="duplicate-key")raw.replace("\"protocol\":1","\"protocol\":1,\"\\u0070rotocol\":1")else raw});refuses{f.open()}}
        val f=Rig();refuses{f.open(f.options(reference=f.reference.copy(snapshotHash=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(byteArrayOf(99))))))}
    }
    @Test fun nonCanonicalBase64AndTrailingJsonRefuse(){
        for(raw in listOf("AA=","AB","A","AA+_","AA/","AA\n")){val f=Rig(wire={value->value.getJSONArray("paths").getJSONObject(0).put("bytes",raw);value.toString()});refuses{f.open()}}
        for(tail in listOf("{}",","," null")){val f=Rig(wire={it.toString()+tail});refuses{f.open()}}
    }
    @Test fun missingExtraAndLateChangedOriginalPartsNeverBecomeEmptySources(){
        val f=Rig(E2eeFiles.CHUNK_BYTES+7);val opened=f.open();f.memory.rows.remove(f.memory.rows.keys.last());refuses{collect(opened.openPath(f.paths[0]))};opened.close()
        val g=Rig();g.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","${g.reference.migrationId}:source:${g.reference.snapshotParts}",byteArrayOf(7),null)));refuses{g.open()};refuses{g.open(g.options(paths=g.paths.drop(1)))}
    }
    @Test fun onlyOnePathCanBeOpenAndClosingWipesRetainedRawWrapperParts(){
        val f=Rig(E2eeFiles.CHUNK_BYTES+7);val raw=mutableListOf<ByteArray>();val tracked=object:E2eeSourceReadVault by f.vault {override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened?=f.vault.read(domain,objectId)?.also{raw+=it.bytes}}
        val opened=f.open(f.options(vault=tracked));val source=opened.openPath(f.paths[0]);val out=ByteArray(E2eeFiles.CHUNK_BYTES);assertEquals(out.size,source.read(out));assertTrue(raw.any{part->part.any{it!=0.toByte()}})
        refuses{opened.openPath(f.paths[1])};opened.close();assertTrue(raw.all{part->part.all{it==0.toByte()}});refuses{source.read(out)};refuses{source.assertComplete()};out.fill(0)
    }
    @Test fun closeDuringAnOutstandingProtectedReadRevokesItsPlaintextContinuation(){
        val f=Rig();val entered=CountDownLatch(1);val release=CountDownLatch(1);val block=AtomicBoolean(false)
        val tracked=object:E2eeSourceReadVault by f.vault {override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened? {if(block.get()){entered.countDown();check(release.await(5,TimeUnit.SECONDS))};return f.vault.read(domain,objectId)}}
        val opened=f.open(f.options(vault=tracked));block.set(true);val source=opened.openPath(f.paths[0]);val out=ByteArray(3);val pool=Executors.newSingleThreadExecutor()
        try{val pending=pool.submit<Boolean>{try{source.read(out);false}catch(error:Exception){error.message.orEmpty().startsWith("E2EE_")}};assertTrue(entered.await(5,TimeUnit.SECONDS));opened.close();release.countDown();assertTrue(pending.get(5,TimeUnit.SECONDS));assertTrue(out.all{it==0.toByte()})}finally{release.countDown();pool.shutdownNow();opened.close()}
    }
    @Test fun closingACompletedSourceNeverClosesTheLaterReader(){
        val f=Rig();val opened=f.open();val old=opened.openPath(f.paths[0]);collect(old);val next=opened.openPath(f.paths[1]);val out=ByteArray(3);assertEquals(3,next.read(out));old.close();assertEquals(-1,next.read(out));next.assertComplete();next.close();opened.close();out.fill(0)
    }
    @Test fun closedPendingSourceKeepsItsReservationUntilTheOriginalReadDrains(){
        val f=Rig();val entered=CountDownLatch(1);val release=CountDownLatch(1);val block=AtomicBoolean(false)
        val tracked=object:E2eeSourceReadVault by f.vault {override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened? {if(block.get()){entered.countDown();check(release.await(5,TimeUnit.SECONDS))};return f.vault.read(domain,objectId)}}
        val opened=f.open(f.options(vault=tracked));block.set(true);val source=opened.openPath(f.paths[0]);val out=ByteArray(3);val pool=Executors.newSingleThreadExecutor()
        try{val pending=pool.submit<Boolean>{try{source.read(out);false}catch(error:Exception){error.message.orEmpty().startsWith("E2EE_")}};assertTrue(entered.await(5,TimeUnit.SECONDS));source.close();refuses{opened.openPath(f.paths[1])};release.countDown();assertTrue(pending.get(5,TimeUnit.SECONDS));block.set(false);assertArrayEquals(f.values[1],collect(opened.openPath(f.paths[1])))}finally{release.countDown();pool.shutdownNow();opened.close();out.fill(0)}
    }
}
