package ru.genesis.calendar.security

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

/** UI input is read on Main before source IO. No reader can flush, restore or
 * execute its content; detached inputs remain inert originals until sign-out. */
internal object NativeMigrationMemory{
    class Capture(val content:JSONObject?,val state:JSONObject,val settled:Boolean=true)
    private class Entry(val owner:String,val kind:String,val read:()->Capture)
    private class Retained(val owner:String,val value:JSONObject?)
    private val live=linkedMapOf<String,Entry>();private val retained=linkedMapOf<String,Retained>();private var revision=0L
    private val kinds=setOf("tasks","diary","mindmaps","aurora","stoicheion","advice","reminders","local-work")
    @Synchronized fun register(owner:String,kind:String,read:()->Capture):()->Unit{
        E2eeKeys.technical(owner);check(kind in kinds&&live.size+retained.size<1000){"E2EE_SOURCE_TOO_LARGE"}
        val id=UUID.randomUUID().toString();live[id]=Entry(owner,kind,read);revision++
        return{synchronized(this){val entry=live.remove(id);if(entry!=null){
            val copy=try{encode(id,entry,false)}catch(_:Exception){null};retained[id]=Retained(owner,copy);revision++
        }};Unit}
    }
    private fun encode(id:String,entry:Entry,mounted:Boolean):JSONObject{
        val value=entry.read();return JSONObject().put("ownerId",entry.owner).put("source",id).put("kind",entry.kind).put("mounted",mounted)
            .put("content",value.content?.let{JSONObject(it.toString())}?:JSONObject.NULL).put("state",JSONObject(value.state.toString())).put("settled",value.settled)
    }
    @Synchronized fun clearOwner(owner:String){live.entries.removeAll{it.value.owner==owner};retained.entries.removeAll{it.value.owner==owner};revision++}
    @Synchronized private fun rows(owner:String):JSONArray{
        E2eeKeys.technical(owner);val before=revision;val result=JSONArray()
        for(value in retained.values)if(value.owner==owner)result.put(value.value?.let{JSONObject(it.toString())}?:error("E2EE_DETACHED_SOURCE_CAPTURE_FAILED"))
        for((id,entry)in live)if(entry.owner==owner)result.put(encode(id,entry,true))
        check(revision==before&&result.length()<=1000){"E2EE_SOURCE_CAPTURE_CHANGED"}
        check(result.toString().toByteArray(Charsets.UTF_8).size<=64*1024*1024){"E2EE_SOURCE_TOO_LARGE"};return result
    }
    suspend fun localWork(owner:String,current:()->Unit):JSONObject=withContext(Dispatchers.Main.immediate){
        current();val before=rows(owner);current();val after=rows(owner);check(E2eeProductJson.same(before,after)){"E2EE_SOURCE_CAPTURE_CHANGED"}
        JSONObject().put("editors",before)
    }
    suspend fun content(owner:String,kind:String,current:()->Unit):JSONObject?=withContext(Dispatchers.Main.immediate){
        current();check(kind in kinds){"E2EE_SOURCE_ADAPTER_REQUIRED"};val rows=rows(owner)
        val values=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.getString("kind")==kind&&it.getBoolean("mounted")}
        check(values.none{!it.getBoolean("settled")}){"E2EE_SOURCE_NOT_SETTLED"}
        val content=values.mapNotNull{it.optJSONObject("content")}
        if(kind in setOf("diary","mindmaps")){
            if(content.isEmpty())return@withContext null
            val records=JSONArray();val editors=JSONArray()
            for((index,value)in content.withIndex()){
                E2eeKeys.exact(value,setOf("records","editors"));val found=value.getJSONArray("records");for(at in 0 until found.length())records.put(found.get(at))
                val forms=value.getJSONArray("editors");for(at in 0 until forms.length()){val editor=JSONObject(forms.getJSONObject(at).toString());editor.put("source","$index:${editor.optString("source",at.toString())}");editors.put(editor)}
            };current();return@withContext JSONObject().put("records",records).put("editors",editors)
        }
        check(content.all{E2eeProductJson.same(it,content.firstOrNull())}){"E2EE_MOUNTED_SOURCE_REVIEW_REQUIRED"};current();content.firstOrNull()?.let{JSONObject(it.toString())}
    }
}
