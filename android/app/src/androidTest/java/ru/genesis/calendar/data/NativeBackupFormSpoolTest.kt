package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

/** Real Android Keystore, private disk, JsonReader.skipValue and account/view
 * inventory. No provider/server account and no huge JSONObject is constructed. */
class NativeBackupFormSpoolTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    @Test fun streamsFortyMiBFormWithoutBuildingItsStateInNativeMemory(){
        val store=nativeBackupFormSpool(context);val view=UUID.randomUUID().toString();val id=UUID.randomUUID().toString()
        val prefix="{\"protocol\":1,\"state\":{\"key\":\" exact original input \",\"payload\":\""
        val suffix="\",\"zero\":0,\"confirmed\":false},\"settled\":true,\"file\":null}"
        val chunks=321;var form:BackupFormSpool.Form?=null
        val before=Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory()
        val started=android.os.SystemClock.elapsedRealtime()
        try{
            for(index in 0 until chunks){
                val text=when(index){0->prefix+"x".repeat(BackupFormSpool.CHUNK-prefix.length);chunks-1->"x".repeat(BackupFormSpool.CHUNK-suffix.length)+suffix;else->"x".repeat(BackupFormSpool.CHUNK)}
                form=store.append(view,"synthetic-owner:epoch7:$view",id,index,index==chunks-1,text)
            }
            val accepted=requireNotNull(form);assertEquals(chunks*BackupFormSpool.CHUNK,accepted.characters);assertEquals(0L,accepted.memoryBytes)
            assertTrue(accepted.header.getBoolean("settled"));assertTrue(accepted.header.isNull("file"))
            var count=0;accepted.reader().use{reader->val buffer=CharArray(8192);while(true){val size=reader.read(buffer);if(size<0)break;count+=size};buffer.fill('\u0000')}
            assertEquals(accepted.characters,count)
            val after=Runtime.getRuntime().totalMemory()-Runtime.getRuntime().freeMemory()
            File(context.getExternalFilesDir(null),"backup336-spool-large-proof.json").writeText(JSONObject().put("synthetic",true).put("characters",count)
                .put("metadataStreamed",true).put("exactEofReadback",true).put("elapsedMs",android.os.SystemClock.elapsedRealtime()-started)
                .put("heapBefore",before).put("heapAfter",after).put("maxHeap",Runtime.getRuntime().maxMemory()).toString(2))
        }finally{form?.clear();store.clear()}
    }
    @Test fun streamedMetadataPreservesOriginalStateAndRefusesWrongTypesDuplicateHeaderAndTrailingJson(){
        val samples=listOf("{}","{\"protocol\":1,\"protocol\":1,\"state\":{},\"settled\":true,\"file\":null}",
            "{\"protocol\":1,\"state\":[],\"settled\":true,\"file\":null}","{\"protocol\":1,\"state\":{},\"settled\":1,\"file\":null}",
            "{\"protocol\":1,\"state\":{},\"settled\":true,\"file\":null} {}")
        for(raw in samples)assertThrows(Exception::class.java){NativeBackupFormMetadata.read(raw.reader())}
        val raw="{\"protocol\":1,\"state\":{\"duplicate\":1,\"duplicate\":2,\"note\":\"α😀\\uD800\"},\"settled\":false,\"file\":null}"
        val memory=BackupMigrationInventory{maximum->nativeBackupFormSpool(context,maximum)};val view=memory.open("synthetic-spool-owner",7)
        try{memory.appendForm(view,UUID.randomUUID().toString(),0,true,raw);memory.detach(view)
            assertEquals(raw,memory.capture("synthetic-spool-owner",7).getJSONArray("views").getJSONObject(0).getString("rawForm"))
        }finally{memory.clear()}
    }
}
