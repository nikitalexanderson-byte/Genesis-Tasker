package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.util.UUID

/** Real Keystore, private disk, strict Android JSON and bounded binary reads.
 * Synthetic source input only; no restore/HTTP/entitlement authority is used. */
class NativeBackupBinaryInventoryTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun hex(bytes:ByteArray)=try{bytes.joinToString(""){"%02x".format(it)}}finally{bytes.fill(0)}
    @Test fun exactTwentyFourMiBOfNonTextBinaryAndOriginalProviderUnitsReadBackWithBoundedBuffers(){
        val storage=nativeBackupFormSpool(context,BackupValueInventory.PHYSICAL_MAX)
        val bytes=ByteArray(24*1024*1024){((it*37+131)and 255).toByte()}
        val source=BackupImportFile(bytes,"\uFEFForiginal-\uD800name","APPLICATION/JSON",null,-1L)
        val raw=" \n"+source.descriptor().toString()+"\r\n";source.clear()
        val expected=hex(MessageDigest.getInstance("SHA-256").digest(bytes));var stored:BackupStoredBinary?=null
        val started=android.os.SystemClock.elapsedRealtime()
        try{
            val value=BackupStoredBinary.store(storage,UUID.randomUUID().toString(),"synthetic-original-owner:epoch7",raw,bytes);stored=value;bytes.fill(0)
            assertEquals(raw,value.descriptor);assertEquals(24*1024*1024,value.length)
            val hash=MessageDigest.getInstance("SHA-256");val buffer=ByteArray(65536);var count=0;var checks=0
            try{value.open{checks++}.use{input->while(true){val read=input.read(buffer);if(read<0)break;assertTrue(read>0);hash.update(buffer,0,read);count+=read}}}
            finally{buffer.fill(0)}
            assertEquals(24*1024*1024,count);assertEquals(expected,hex(hash.digest()));assertTrue(checks>count/buffer.size)
            File(context.getExternalFilesDir(null),"backup336-binary-24-proof.json").writeText(JSONObject().put("synthetic",true)
                .put("bytes",count).put("sha256",expected).put("originalDescriptorCodeUnits",true).put("readBufferBytes",buffer.size)
                .put("completeFooterAndEof",true).put("elapsedMs",android.os.SystemClock.elapsedRealtime()-started)
                .put("maxHeap",Runtime.getRuntime().maxMemory()).toString(2))
        }finally{bytes.fill(0);stored?.clear();storage.clear()}
    }
    @Test fun moreThanFortyEightMiBOfCandidatesRetainWithoutWholeFileHeapHistoryAndKeepAggregateGate(){
        val memory=BackupMigrationInventory{maximum->nativeBackupFormSpool(context,maximum)}
        val owner="binary-qa-${UUID.randomUUID()}";val epoch=9L;val view=memory.open(owner,epoch)
        val bytes=ByteArray(17*1024*1024){(it*31).toByte()};val started=android.os.SystemClock.elapsedRealtime();var selected:JSONObject?=null
        try{
            repeat(3){
                val source=BackupImportFile(bytes,"original\uD800name","APPLICATION/JSON",null,null)
                try{
                    val file=source.migrationCopy();memory.retainFile(view,file);assertEquals(0L,file.memoryBytes)
                    if(it==0)selected=JSONObject().put("id",file.id).put("name","original\uFFFDname").put("type","application/json").put("size",bytes.size).put("lastModified",0)
                }finally{source.clear()}
            };bytes.fill(0)
            val raw=JSONObject().put("protocol",2).put("fields",org.json.JSONArray()).put("settled",true).put("file",selected).toString()
            memory.publishManifest(view,raw);memory.detach(view)
            val statistics=memory.fileStatistics(owner,epoch)
            assertEquals(BackupMigrationInventory.FileStatistics(3,51L*1024*1024,0L,0),statistics)
            assertEquals("E2EE_SNAPSHOT_TOO_LARGE",assertThrows(IllegalStateException::class.java){memory.capture(owner,epoch)}.message)
            File(context.getExternalFilesDir(null),"backup336-binary-history-proof.json").writeText(JSONObject().put("synthetic",true)
                .put("files",statistics.files).put("originalBytes",statistics.bytes).put("retainedFileMemoryBytes",statistics.memoryBytes)
                .put("selectedFiles",1).put("unselectedFiles",2).put("pending",statistics.pending).put("retainedAfterClose",true)
                .put("aggregateCaptureGate","E2EE_SNAPSHOT_TOO_LARGE").put("elapsedMs",android.os.SystemClock.elapsedRealtime()-started)
                .put("maxHeap",Runtime.getRuntime().maxMemory()).toString(2))
        }finally{bytes.fill(0);memory.clear()}
    }
    @Test fun duplicateEscapedUnknownMalformedAndTrailingDescriptorsCannotPublishBinaryInput(){
        val storage=nativeBackupFormSpool(context,BackupValueInventory.PHYSICAL_MAX);val view=UUID.randomUUID().toString();var accepted:BackupStoredBinary?=null
        val bytes=byteArrayOf(0,-1,0xc3.toByte(),0x28);val source=BackupImportFile(bytes,null,null,null,null)
        val raw=source.descriptor().toString();source.clear()
        try{
            val original=BackupStoredBinary.store(storage,view,"synthetic-original-owner:epoch7",raw,bytes);accepted=original
            for(malformed in listOf(raw+"{}",raw.replace("\"protocol\":1","\"protocol\":1,\"protoco\\u006c\":1"),
                JSONObject(raw).put("unexpected",true).toString(),JSONObject(raw).put("length",4.5).toString(),
                JSONObject(raw).put("name",JSONObject()).toString(),JSONObject(raw).put("declaredSize",9007199254740992L).toString(),
                JSONObject(raw).put("length",24*1024*1024+1).toString(),JSONObject(raw).put("sha256","0".repeat(64)).toString())){
                assertThrows(Exception::class.java){BackupStoredBinary.store(storage,view,"synthetic-original-owner:epoch7",malformed,bytes)}
                assertArrayEquals(bytes,original.bytes())
            }
        }finally{bytes.fill(0);accepted?.clear();storage.clear()}
    }
}
