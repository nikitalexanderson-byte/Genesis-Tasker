package ru.genesis.calendar.data

import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.UUID

class NativeBackupValueInventoryTest {
    private val context get()=InstrumentationRegistry.getInstrumentation().targetContext
    private fun manifest(fields:List<Pair<String,String>>,file:JSONObject?=null)=JSONObject().put("protocol",2)
        .put("fields",JSONArray(fields.map{(name,id)->JSONObject().put("name",name).put("id",id)})).put("settled",true).put("file",file?:JSONObject.NULL).toString()
    @Test fun strictSmallManifestRefusesDuplicateEscapedNamesWrongTypesAndTrailingData(){
        val valid=manifest(emptyList());assertEquals(2,NativeBackupValueManifest.read(valid).getInt("protocol"))
        for(raw in listOf(valid.replace("\"protocol\":2","\"protocol\":1,\"protoco\\u006c\":2"),valid+"{}","[]",valid.replace("\"settled\":true","\"settled\":{\"x\":1,\"x\":2}"),valid.replace("\"protocol\":2","\"protocol\":2.0"))){
            assertThrows(Exception::class.java){NativeBackupValueManifest.read(raw)}
        }
    }
    @Test fun nativeFramesManifestsAndUtf8WireRetainExactProviderUnitsAndUnselectedCandidate(){
        val memory=BackupMigrationInventory{maximum->nativeBackupFormSpool(context,maximum)}
        val owner="values-qa-${UUID.randomUUID()}";val epoch=7L;val view=memory.open(owner,epoch)
        try{
            fun retain(name:String,raw:String):String {val id=UUID.randomUUID().toString();memory.appendValue(view,name,id,0,true,raw);return id}
            val key=retain("key","\" exact synthetic input \\uD800 \"");val zero=retain("zero","0");val payload=retain("payload","{\"raw\":\"literal\uDFFFunit\"}")
            val file=BackupImportFile(byteArrayOf(0,-1,0xc3.toByte(),0x28),"\uFEFFbad\uD800name","APPLICATION/JSON",0L,null)
            memory.retainFile(view,file.migrationCopy());file.clear()
            val selected=JSONObject().put("id",file.id).put("name","\uFEFFbad\uFFFDname").put("type","application/json").put("size",4).put("lastModified",0)
            val first=manifest(listOf("key" to key,"zero" to zero,"payload" to payload),selected);memory.publishManifest(view,first)
            val replacement=retain("key","\" exact replacement input \"");val last=manifest(listOf("key" to replacement,"zero" to zero,"payload" to payload),selected);memory.publishManifest(view,last)
            val candidate=retain("key","\" acknowledged but unselected input \"");memory.detach(view)
            val capture=memory.capture(owner,epoch);val bytes=backupJsonUtf8(capture.toString())
            try{
                val roundtrip=JSONObject(bytes.toString(Charsets.UTF_8));val row=roundtrip.getJSONArray("views").getJSONObject(0);val values=row.getJSONObject("valueForm")
                assertEquals(2,roundtrip.getInt("protocol"));assertEquals(last,values.getString("rawManifest"));assertEquals(first,values.getJSONArray("rawManifests").getString(0));assertEquals(5,values.getJSONArray("values").length())
                assertEquals(candidate,values.getJSONArray("values").getJSONObject(4).getString("id"));assertEquals("{\"raw\":\"literal\uDFFFunit\"}",values.getJSONArray("values").getJSONObject(2).getString("rawJson"))
                assertEquals("\uFEFFbad\uD800name",row.getJSONArray("files").getJSONObject(0).getJSONObject("descriptor").getString("name"))
                File(context.getExternalFilesDir(null),"backup336-native-value-input.json").writeBytes(bytes)
            }finally{bytes.fill(0)}
            val stats=memory.valueStatistics(owner,epoch).single();assertEquals(5,stats.values);assertEquals(2,stats.manifests);assertEquals(5L,stats.chunks)
        }finally{memory.clear()}
    }
    @Test fun refusedCrossFieldManifestAndInterruptedTransferKeepThePreviousAcceptedForm(){
        val memory=BackupMigrationInventory{maximum->nativeBackupFormSpool(context,maximum)};val owner="values-qa-${UUID.randomUUID()}";val view=memory.open(owner,3)
        try{
            val id=UUID.randomUUID().toString();memory.appendValue(view,"key",id,0,true,"\"original\"");val raw=manifest(listOf("key" to id));memory.publishManifest(view,raw)
            assertThrows(Exception::class.java){memory.publishManifest(view,manifest(listOf("payload" to id)))}
            memory.appendValue(view,"payload",UUID.randomUUID().toString(),0,false," ".repeat(BackupFormSpool.CHUNK));assertThrows(Exception::class.java){memory.capture(owner,3)}
            memory.detach(view);val source=memory.capture(owner,3).getJSONArray("views").getJSONObject(0).getJSONObject("valueForm")
            assertEquals(raw,source.getString("rawManifest"));assertEquals(1,source.getJSONArray("values").length())
            assertThrows(Exception::class.java){memory.capture(owner,4)};assertThrows(Exception::class.java){memory.publishManifest(view,raw)}
        }finally{memory.clear()}
    }
}
