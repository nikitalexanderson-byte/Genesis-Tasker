package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.nio.file.Files
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class BackupValueInventoryTest {
    private class Rig {
        val root=Files.createTempDirectory("genesis-value-inventory-").toFile()
        private val spools=mutableListOf<BackupFormSpool>()
        val memory=BackupMigrationInventory({JSONObject(it)}){maximum->
            val folder=java.io.File(root,UUID.randomUUID().toString());val key=SecretKeySpec(ByteArray(32){(it+5).toByte()},"AES")
            BackupFormSpool(folder,object:BackupFormSpool.Crypto{
                override fun seal(value:String,aad:String):String{
                    val cipher=Cipher.getInstance("AES/GCM/NoPadding");cipher.init(Cipher.ENCRYPT_MODE,key);cipher.updateAAD(aad.toByteArray())
                    return Base64.getEncoder().encodeToString(cipher.iv+cipher.doFinal(value.toByteArray()))
                }
                override fun open(value:String,aad:String):String{
                    val bytes=Base64.getDecoder().decode(value);val cipher=Cipher.getInstance("AES/GCM/NoPadding")
                    cipher.init(Cipher.DECRYPT_MODE,key,GCMParameterSpec(128,bytes.copyOfRange(0,12)));cipher.updateAAD(aad.toByteArray())
                    return cipher.doFinal(bytes.copyOfRange(12,bytes.size)).toString(Charsets.UTF_8)
                }
            },{reader->val value=JSONObject(reader.readText());check(value.get("state") is JSONObject);value},maximum=maximum).also{spools+=it}
        }
        val owner="synthetic-value-owner";val epoch=7L;val view=memory.open(owner,epoch)
        fun value(name:String,raw:String):String{
            val id=UUID.randomUUID().toString();raw.chunked(BackupFormSpool.CHUNK).forEachIndexed{index,text->memory.appendValue(view,name,id,index,(index+1)*BackupFormSpool.CHUNK>=raw.length,text)};return id
        }
        fun manifest(fields:List<Pair<String,String>>,settled:Boolean=true,file:JSONObject?=null)=JSONObject().put("protocol",2)
            .put("fields",JSONArray(fields.map{(name,id)->JSONObject().put("name",name).put("id",id)})).put("settled",settled).put("file",file?:JSONObject.NULL).toString()
        fun captured()=memory.capture(owner,epoch).getJSONArray("views").getJSONObject(0).getJSONObject("valueForm")
        fun clear(){memory.clear();spools.forEach{it.clear()};root.listFiles()?.forEach{check(it.isDirectory&&it.listFiles()!!.isEmpty());it.delete()};root.delete()}
    }
    @Test fun changedSmallFieldReusesLargeValueAndKeepsAllOriginalValuesAndManifestHistory(){
        val r=Rig();try{
            val raw=JSONObject.quote("α😀".repeat(100000));val payload=r.value("payload",raw);val key=r.value("key","\" exact old key \"");val zero=r.value("zero","0")
            val first=r.manifest(listOf("payload" to payload,"key" to key,"zero" to zero));r.memory.publishManifest(r.view,first)
            val next=r.value("key","\" exact new key \\uD800 \"");val second=r.manifest(listOf("payload" to payload,"key" to next,"zero" to zero));r.memory.publishManifest(r.view,second)
            val before=r.captured();assertEquals(4,before.getJSONArray("values").length());assertEquals(2,before.getJSONArray("rawManifests").length())
            assertEquals(first,before.getJSONArray("rawManifests").getString(0));assertEquals(second,before.getString("rawManifest"));assertEquals(raw,before.getJSONArray("values").getJSONObject(0).getString("rawJson"))
            r.memory.detach(r.view);assertEquals(before.toString(),r.captured().toString());assertFalse(r.memory.toString().contains("exact"))
        }finally{r.clear()}
    }
    @Test fun uncommittedValueAndLegacyViewStaySeparateWhileMountedPendingWorkRefuses(){
        val r=Rig();try{
            val candidate=r.value("key","\" uncommitted original \"")
            assertThrows(IllegalStateException::class.java){r.memory.capture(r.owner,r.epoch)};r.memory.detach(r.view)
            val old=r.memory.open(r.owner,r.epoch);val raw="{\"protocol\":1,\"state\":{\"key\":\"legacy\"},\"settled\":true,\"file\":null}";r.memory.publish(old,raw)
            val captured=r.memory.capture(r.owner,r.epoch);assertEquals(2,captured.getInt("protocol"));val rows=captured.getJSONArray("views");assertEquals(2,rows.length())
            assertEquals(candidate,rows.getJSONObject(0).getJSONObject("valueForm").getJSONArray("values").getJSONObject(0).getString("id"));assertTrue(rows.getJSONObject(0).getJSONObject("valueForm").isNull("rawManifest"))
            assertEquals(raw,rows.getJSONObject(1).getString("rawForm"));assertTrue(rows.getJSONObject(1).isNull("valueForm"))
            assertThrows(IllegalStateException::class.java){r.memory.capture("foreign",r.epoch)};assertThrows(IllegalStateException::class.java){r.memory.capture(r.owner,r.epoch+1)}
        }finally{r.clear()}
    }
    @Test fun renamedMissingOrForeignFieldCannotReplaceTheAcknowledgedManifest(){
        val r=Rig();try{
            val id=r.value("key","\" original \"");val accepted=r.manifest(listOf("key" to id));r.memory.publishManifest(r.view,accepted)
            for(raw in listOf(r.manifest(listOf("payload" to id)),r.manifest(listOf("key" to UUID.randomUUID().toString())),r.manifest(listOf("key" to id,"key" to id)),"{}")){
                assertThrows(Exception::class.java){r.memory.publishManifest(r.view,raw)};assertEquals(accepted,r.captured().getString("rawManifest"))
            }
            val file=BackupImportFile(byteArrayOf(0,-1),"bad\uD800name","APPLICATION/JSON",null,null);r.memory.retainFile(r.view,file.migrationCopy());file.clear()
            val selected=JSONObject().put("id",file.id).put("name","bad\uFFFDname").put("type","application/json").put("size",2).put("lastModified",0)
            val manifest=r.manifest(listOf("key" to id),file=selected);r.memory.publishManifest(r.view,manifest);assertEquals(manifest,r.captured().getString("rawManifest"))
            selected.put("name","substituted");assertThrows(Exception::class.java){r.memory.publishManifest(r.view,r.manifest(listOf("key" to id),file=selected))};assertEquals(manifest,r.captured().getString("rawManifest"))
        }finally{r.clear()}
    }
    @Test fun interruptedNextValueCannotEraseThePreviouslyAcknowledgedFields(){
        val r=Rig();try{
            val id=r.value("key","\" accepted \"");val raw=r.manifest(listOf("key" to id));r.memory.publishManifest(r.view,raw)
            val partial=UUID.randomUUID().toString();r.memory.appendValue(r.view,"payload",partial,0,false," ".repeat(BackupFormSpool.CHUNK))
            assertThrows(Exception::class.java){r.memory.appendValue(r.view,"key",partial,1,true,"null")}
            assertThrows(Exception::class.java){r.memory.capture(r.owner,r.epoch)};r.memory.detach(r.view)
            assertEquals(raw,r.captured().getString("rawManifest"));assertEquals(1,r.captured().getJSONArray("values").length())
            assertThrows(Exception::class.java){r.memory.publishManifest(r.view,raw)}
        }finally{r.clear()}
    }
}
