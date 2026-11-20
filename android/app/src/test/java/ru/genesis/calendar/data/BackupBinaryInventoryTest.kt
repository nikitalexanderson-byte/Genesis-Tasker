package ru.genesis.calendar.data

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class BackupBinaryInventoryTest {
    private class Rig(val quota:Long=768L*1024*1024) {
        val root=Files.createTempDirectory("genesis-binary-inventory-").toFile()
        @Volatile var beforeSeal:((String)->Unit)?=null
        private val spools=mutableListOf<BackupFormSpool>()
        private val key=SecretKeySpec(ByteArray(32){(it+53).toByte()},"AES")
        val memory=BackupMigrationInventory({JSONObject(it)}){maximum->
            val folder=File(root,UUID.randomUUID().toString())
            BackupFormSpool(folder,object:BackupFormSpool.Crypto{
                override fun seal(value:String,aad:String):String {
                    beforeSeal?.invoke(aad);val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad.toByteArray())
                    return Base64.getEncoder().encodeToString(cipher.iv+cipher.doFinal(value.toByteArray()))
                }
                override fun open(value:String,aad:String):String {
                    val bytes=Base64.getDecoder().decode(value);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12)));cipher.updateAAD(aad.toByteArray())
                    return cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)
                }
            },{reader->
                // Test-generated wrappers only; drain without constructing a
                // second large plaintext tree and still authenticate footer/EOF.
                val buffer=CharArray(8192)
                try{while(reader.read(buffer)>=0)Unit}finally{buffer.fill('\u0000')}
                JSONObject().put("protocol",1).put("settled",true).put("file",JSONObject.NULL)
            },maximum=maximum,quota=quota).also{spools+=it}
        }
        val owner="synthetic-binary-owner";val epoch=7L;val view=memory.open(owner,epoch)
        fun raw()="{\"protocol\":1,\"state\":{\"key\":\"original input\"},\"settled\":true,\"file\":null}"
        fun source(bytes:ByteArray):BackupImportFile=BackupImportFile(bytes,"\uFEFForiginal\uD800name","APPLICATION/JSON",null,-1L)
        fun retainedFiles()=root.listFiles()!!.flatMap{it.listFiles()!!.toList()}
        fun clear(){beforeSeal=null;memory.clear();spools.forEach{it.clear()};root.listFiles()?.forEach{assertTrue(it.listFiles().isNullOrEmpty());it.delete()};root.delete()}
    }
    @Test fun encryptedCandidatesReleaseOwnedHeapAndRetainOriginalBinaryMetadataAfterDetach(){
        val r=Rig();try{
            val bytes=byteArrayOf(0,-1,0xc3.toByte(),0x28,9);val source=r.source(bytes);val file=source.migrationCopy()
            r.memory.retainFile(r.view,file);assertEquals(0L,file.memoryBytes);source.clear();bytes.fill(0)
            r.memory.publish(r.view,r.raw());r.memory.detach(r.view)
            val captured=r.memory.capture(r.owner,r.epoch).getJSONArray("views").getJSONObject(0)
            assertEquals(r.raw(),captured.getString("rawForm"));val candidate=captured.getJSONArray("files").getJSONObject(0)
            assertEquals("\uFEFForiginal\uD800name",candidate.getJSONObject("descriptor").getString("name"));assertEquals("APPLICATION/JSON",candidate.getJSONObject("descriptor").getString("type"))
            assertTrue(candidate.getJSONObject("descriptor").isNull("lastModified"));assertEquals(-1L,candidate.getJSONObject("descriptor").getLong("declaredSize"))
            assertArrayEquals(byteArrayOf(0,-1,0xc3.toByte(),0x28,9),Base64.getUrlDecoder().decode(candidate.getString("bytes")))
            assertEquals(BackupMigrationInventory.FileStatistics(1,5L,0L,0),r.memory.fileStatistics(r.owner,r.epoch))
            assertTrue(r.retainedFiles().all{!it.readBytes().toString(Charsets.US_ASCII).contains("original")})
            r.memory.clear();assertThrows(Exception::class.java){file.capture()}
        }finally{r.clear()}
    }
    @Test fun moreThanFortyEightMiBOfSelectedAndUnselectedInputUsesSpillWhileAggregateCaptureStillRefuses(){
        val r=Rig();try{
            val bytes=ByteArray(17*1024*1024){(it*31).toByte()};var selected:JSONObject?=null
            repeat(3){
                val source=r.source(bytes);val file=source.migrationCopy();r.memory.retainFile(r.view,file)
                if(it==0)selected=JSONObject().put("id",file.id).put("name","\uFEFForiginal\uFFFDname").put("type","application/json").put("size",bytes.size).put("lastModified",0)
                source.clear();assertEquals(0L,file.memoryBytes)
            };bytes.fill(0)
            val raw=JSONObject(r.raw()).put("file",selected).toString();r.memory.publish(r.view,raw);r.memory.detach(r.view)
            assertEquals(BackupMigrationInventory.FileStatistics(3,51L*1024*1024,0L,0),r.memory.fileStatistics(r.owner,r.epoch))
            assertEquals("E2EE_SNAPSHOT_TOO_LARGE",assertThrows(IllegalStateException::class.java){r.memory.capture(r.owner,r.epoch)}.message)
            assertEquals(6,r.retainedFiles().size)
        }finally{r.clear()}
    }
    @Test fun detachDuringWriteDoesNotBlockInventoryOrAdoptLateInputAndDuplicateCannotEraseEarlierFile(){
        val r=Rig();val executor=Executors.newSingleThreadExecutor();val release=CountDownLatch(1)
        try{
            val earlier=r.source(byteArrayOf(7,8,9));r.memory.retainFile(r.view,earlier.migrationCopy());earlier.clear();r.memory.publish(r.view,r.raw())
            val source=r.source(ByteArray(300000){(it*17).toByte()});val pending=source.migrationCopy();val duplicate=source.migrationCopy();source.clear()
            val entered=CountDownLatch(1);r.beforeSeal={aad->if(aad.endsWith("chunk:0")){entered.countDown();check(release.await(5,TimeUnit.SECONDS))}}
            val write=executor.submit<Throwable?>{try{r.memory.retainFile(r.view,pending);null}catch(error:Throwable){error}}
            assertTrue(entered.await(5,TimeUnit.SECONDS));assertEquals(1,r.memory.fileStatistics(r.owner,r.epoch).pending)
            assertThrows(Exception::class.java){r.memory.retainFile(r.view,duplicate)};duplicate.clear()
            // A separate thread owns encrypted IO; this call must return while
            // that IO is paused. Capture remains closed until it has drained.
            r.memory.detach(r.view);assertThrows(Exception::class.java){r.memory.capture(r.owner,r.epoch)}
            release.countDown();assertEquals("BACKUP_VIEW_CLOSED",write.get(5,TimeUnit.SECONDS)?.message)
            val files=r.memory.capture(r.owner,r.epoch).getJSONArray("views").getJSONObject(0).getJSONArray("files")
            assertEquals(1,files.length());assertArrayEquals(byteArrayOf(7,8,9),Base64.getUrlDecoder().decode(files.getJSONObject(0).getString("bytes")))
            assertEquals(2,r.retainedFiles().size);assertThrows(Exception::class.java){pending.capture()}
        }finally{release.countDown();executor.shutdownNow();assertTrue(executor.awaitTermination(10,TimeUnit.SECONDS));r.clear()}
    }
    @Test fun sameUidAndSameEpochReloginCannotAdoptThePreviousIncarnationsLateCandidate(){
        val r=Rig();try{
            val source=r.source(ByteArray(300000){(it*19).toByte()});val candidate=source.migrationCopy();source.clear();var switched=false
            assertThrows(Exception::class.java){r.memory.retainFile(r.view,candidate){
                if(!switched&&r.retainedFiles().any{it.name.endsWith(".pending")}){
                    switched=true;r.memory.clear();val next=r.memory.open(r.owner,r.epoch);r.memory.publish(next,r.raw())
                }
            }}
            assertTrue(switched);val views=r.memory.capture(r.owner,r.epoch).getJSONArray("views");assertEquals(1,views.length())
            assertEquals(0,views.getJSONObject(0).getJSONArray("files").length());assertTrue(r.retainedFiles().isEmpty());assertThrows(Exception::class.java){candidate.capture()}
        }finally{r.clear()}
    }
    @Test fun quotaFailureRemovesOnlyItsUnacknowledgedCandidateAndPreservesPriorInput(){
        val r=Rig(20000);try{
            val source=r.source(byteArrayOf(1,2,3));r.memory.retainFile(r.view,source.migrationCopy());source.clear();r.memory.publish(r.view,r.raw())
            val bad=r.source(ByteArray(50000){7});val candidate=bad.migrationCopy();bad.clear()
            assertEquals("BACKUP_FORM_QUOTA",assertThrows(Exception::class.java){r.memory.retainFile(r.view,candidate)}.message)
            val captured=r.memory.capture(r.owner,r.epoch).getJSONArray("views").getJSONObject(0)
            assertEquals(r.raw(),captured.getString("rawForm"));assertEquals(1,captured.getJSONArray("files").length());assertEquals(2,r.retainedFiles().size)
            assertThrows(Exception::class.java){candidate.capture()}
        }finally{r.clear()}
    }
}
