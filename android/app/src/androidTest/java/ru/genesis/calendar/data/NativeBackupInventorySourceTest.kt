package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.io.OutputStream
import java.security.MessageDigest
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/** Actual retained input -> bounded source wire. No coordinator, restore, HTTP
 * or complete protected-snapshot authority. Large output goes only to a digest. */
class NativeBackupInventorySourceTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun inventory()=BackupMigrationInventory{maximum->nativeBackupFormSpool(context,maximum)}
    private fun manifest(fields:List<Pair<String,String>>,file:JSONObject?=null)=JSONObject().put("protocol",2).put("fields",JSONArray(fields.map{(name,id)->JSONObject().put("name",name).put("id",id)}))
        .put("settled",true).put("file",file?:JSONObject.NULL).toString()
    @Test fun realValuesHistoriesAndProviderUnitsReachTheCommonSourceWireWithoutProjection(){
        val memory=inventory();val owner="stream-qa-${UUID.randomUUID()}";val epoch=7L;val view=memory.open(owner,epoch)
        try{
            fun value(name:String,raw:String):String {val id=UUID.randomUUID().toString();memory.appendValue(view,name,id,0,true,raw);return id}
            val key=value("key","\" original \uD800 input \"");val payload=value("payload","{\"note\":\"literal\uDFFFunit α😀\"}");val original=manifest(listOf("key" to key,"payload" to payload));memory.publishManifest(view,original)
            val replacement=value("key","\" replacement input \"");val latest=manifest(listOf("key" to replacement,"payload" to payload));memory.publishManifest(view,latest)
            value("key","\" acknowledged unselected input \"")
            val input=BackupImportFile(byteArrayOf(0,-1,0xc3.toByte(),0x28),"\uFEFFbad\uD800name","APPLICATION/JSON",null,null)
            try{memory.retainFile(view,input.migrationCopy())}finally{input.clear()}
            memory.detach(view)
            val target=File(context.getExternalFilesDir(null),"backup336-inventory-stream-input.json")
            target.outputStream().use{memory.source(owner,epoch).writeTo(it)}
            val wire=JSONObject(target.readText(Charsets.UTF_8));val row=wire.getJSONArray("views").getJSONObject(0)
            assertEquals(3,wire.getInt("protocol"));assertEquals(4,row.getJSONObject("valueForm").getJSONArray("values").length());assertEquals(2,row.getJSONObject("valueForm").getJSONArray("rawManifests").length())
            assertEquals(latest,row.getJSONObject("valueForm").getString("rawManifest"));assertEquals(original,row.getJSONObject("valueForm").getJSONArray("rawManifests").getString(0))
            assertEquals("AP_DKA",row.getJSONArray("files").getJSONObject(0).getString("bytes"))
        }finally{memory.clear()}
    }
    @Test fun actualFiftyOneMiBFileHistoryStreamsPastTheAggregateGateWithoutABase64Tree(){
        val memory=inventory();val owner="stream-qa-${UUID.randomUUID()}";val epoch=9L;val view=memory.open(owner,epoch)
        val sizes=listOf(24,17,10).map{it*1024*1024};val descriptors=mutableListOf<String>();var selected:JSONObject?=null
        val started=android.os.SystemClock.elapsedRealtime()
        try{
            for((index,size)in sizes.withIndex()){
                val bytes=ByteArray(size){(it*31).toByte()}
                val input=BackupImportFile(bytes,"\uFEFForiginal\uD800name","APPLICATION/JSON",null,null)
                try{
                    val file=input.migrationCopy();descriptors+=file.descriptor;memory.retainFile(view,file);assertEquals(0L,file.memoryBytes)
                    if(index==0)selected=JSONObject().put("id",file.id).put("name","\uFEFForiginal\uFFFDname").put("type","application/json").put("size",bytes.size).put("lastModified",0)
                }finally{input.clear();bytes.fill(0)}
            }
            val raw=manifest(emptyList(),selected);memory.publishManifest(view,raw);memory.detach(view)
            assertEquals("E2EE_SNAPSHOT_TOO_LARGE",assertThrows(IllegalStateException::class.java){memory.capture(owner,epoch)}.message)
            val hash=MessageDigest.getInstance("SHA-256");var written=0L;var maximumWrite=0
            val output=object:OutputStream(){
                override fun write(value:Int){hash.update(value.toByte());written++}
                override fun write(value:ByteArray,start:Int,count:Int){maximumWrite=maxOf(maximumWrite,count);hash.update(value,start,count);written+=count}
                override fun close()=error("Caller owns output")
            }
            memory.source(owner,epoch).writeTo(output);assertTrue(written>64L*1024*1024);assertTrue(maximumWrite<=128*1024)
            val proof=JSONObject().put("synthetic",true).put("ownerId",owner).put("sessionEpoch",epoch).put("viewId",view).put("rawManifest",raw)
                .put("rawDescriptors",JSONArray(descriptors)).put("fileSizes",JSONArray(sizes)).put("originalBytes",51L*1024*1024).put("files",3).put("bytes",written)
                .put("sha256",hash.digest().joinToString(""){"%02x".format(it)}).put("maximumWrite",maximumWrite).put("maxHeap",Runtime.getRuntime().maxMemory())
                .put("elapsedMs",android.os.SystemClock.elapsedRealtime()-started).put("oldAggregateGate","E2EE_SNAPSHOT_TOO_LARGE")
            File(context.getExternalFilesDir(null),"backup336-inventory-stream-large-proof.json").writeBytes(backupJsonUtf8(proof.toString()))
        }finally{memory.clear()}
    }
    @Test fun retiringAnAccountCanClearTheInventoryWhileBinaryOutputIsPaused(){
        val memory=inventory();val owner="stream-qa-${UUID.randomUUID()}";val view=memory.open(owner,7)
        val paused=CountDownLatch(1);val release=CountDownLatch(1);val executor=Executors.newFixedThreadPool(2)
        try{
            val input=BackupImportFile(ByteArray(65536){123},null,null,null,null)
            try{memory.retainFile(view,input.migrationCopy())}finally{input.clear()}
            memory.publishManifest(view,manifest(emptyList()));memory.detach(view);val source=memory.source(owner,7)
            var written=0L;var maximumWrite=0;var singleWrites=0L;var stopped=false
            fun progress(count:Int){
                written+=count;maximumWrite=maxOf(maximumWrite,count)
                // API26's platform Base64 encoder writes single bytes; API34
                // uses arrays. Pause by stream position, not provider chunking.
                if(!stopped&&written>=4096){stopped=true;paused.countDown();check(release.await(10,TimeUnit.SECONDS))}
            }
            val output=object:OutputStream(){override fun write(value:Int){singleWrites++;progress(1)};override fun write(value:ByteArray,start:Int,count:Int){progress(count)}}
            val writing=executor.submit<String>{try{source.writeTo(output);"UNEXPECTED_SUCCESS"}catch(error:IllegalStateException){error.message.orEmpty()}}
            assertTrue(paused.await(10,TimeUnit.SECONDS));val clearStarted=android.os.SystemClock.elapsedRealtime()
            executor.submit{memory.clear()}.get(3,TimeUnit.SECONDS);val clearMs=android.os.SystemClock.elapsedRealtime()-clearStarted;release.countDown()
            assertEquals("E2EE_ACCOUNT_CHANGED",writing.get(10,TimeUnit.SECONDS))
            File(context.getExternalFilesDir(null),"backup336-inventory-stream-lifetime-proof.json").writeText(JSONObject().put("synthetic",true)
                .put("pauseAtBytes",written).put("maximumWrite",maximumWrite).put("singleWrites",singleWrites).put("clearWhilePausedMs",clearMs)
                .put("error","E2EE_ACCOUNT_CHANGED").put("clearedWhilePaused",true).toString(2))
        }finally{release.countDown();executor.shutdownNow();assertTrue(executor.awaitTermination(10,TimeUnit.SECONDS));memory.clear()}
    }
}
