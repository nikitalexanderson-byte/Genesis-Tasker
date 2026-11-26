package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.security.*

internal class NativePrivateSharedMindmaps(private val storageScope:String,private val owner:String,private val space:String,override val account:E2eeProductAccount):NativeMapProduct{
    private var records:List<NativeMapRecord>?=null
    private fun check(){account.requireOpen();check(NativePrivateProducts.account(storageScope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private suspend fun request(relative:String,body:JSONObject?=null,method:String="GET"):JSONObject{check();return NativePrivateProducts.sharedRequest(storageScope,method,"/shared/spaces/$space/mindmaps$relative",body).also{check()}}
    private fun draft(id:String)=E2eeDeviceDocument(account.device,"shared-map-draft:$space:$id",{value->
        E2eeKeys.exact(value,setOf("protocol","ownerId","spaceId","id","document","expectedRevision","staged","complete","createdAt"));check(value.getInt("protocol")==1&&value.getString("ownerId")==owner&&value.getString("spaceId")==space&&value.getString("id")==id&&value.get("staged") is Boolean&&value.get("complete") is Boolean){"E2EE_MINDMAPS_SOURCE_INVALID"}
        E2eeCommands.integer(value.get("expectedRevision"));MindmapDocument.parse(value.getJSONObject("document"));Instant.parse(value.getString("createdAt"));JSONObject(value.toString())},::check)
    private fun drafts()=account.device.vault.listLocal("draft","shared-map-draft:$space:").map{key->draft(key.removePrefix("shared-map-draft:$space:")).load()?:error("E2EE_PRIVATE_DOCUMENT_CORRUPT")}.sortedWith(compareBy({it.value.getString("createdAt")},{it.value.getString("id")}))
    private fun record(value:JSONObject)=NativeMapRecord(MindmapDocument.parse(value.getJSONObject("document")),
        E2eeCommands.integer(value.get("revision"),1),migratedHistory=value.optString("historyOrigin")=="migration")
    override suspend fun load(refresh:Boolean){check();if(records!=null&&!refresh)return;val response=request("");val current=rows(response.getJSONArray("maps")).map(::record)
        val pending=drafts().filter{!it.value.getBoolean("complete")}.map{saved->val value=saved.value;NativeMapRecord(MindmapDocument.parse(value.getJSONObject("document")),value.getLong("expectedRevision")+if(value.getBoolean("staged"))1L else 0L,pending=JSONObject().put("id",value.get("id")),dirty=true)}
        records=(current+pending).associateBy{it.document.id}.values.toList();check()
    }
    override fun snapshot():List<NativeMapRecord>{check();return records?:error("E2EE_PRODUCT_READ_REQUIRED")}
    override suspend fun requireNoConflict(){check();check(records!=null){"E2EE_PRODUCT_READ_REQUIRED"}}
    private suspend fun deliver(saved:E2eeDeviceDocument.Opened){
        val value=saved.value;val map=MindmapDocument.parse(value.getJSONObject("document"));val result=request("/${map.id}",JSONObject().put("document",map.json()).put("expectedRevision",value.get("expectedRevision")).put("operationId",value.get("id")).put("schemaVersion",1),"PUT")
        check(result.getLong("revision")==value.getLong("expectedRevision")+1){"E2EE_INVALID_RECEIPT"};val complete=!result.optBoolean("pending");draft(value.getString("id")).save(JSONObject(value.toString()).put("staged",true).put("complete",complete),saved.serial);check()
        records=(records.orEmpty().filterNot{it.document.id==map.id}+NativeMapRecord(map,result.getLong("revision"),pending=if(complete)null else JSONObject().put("id",value.get("id")),dirty=!complete))
    }
    override suspend fun flush(){check();if(account.offline)return;for(saved in drafts().filter{!it.value.getBoolean("complete")}){deliver(saved);check()}}
    override suspend fun save(input:MindmapDocument,expected:Long,access:FeatureAccess){
        check();val map=MindmapDocument.parse(input.json());val id=UUID.randomUUID().toString();val value=JSONObject().put("protocol",1).put("ownerId",owner).put("spaceId",space).put("id",id).put("document",map.json()).put("expectedRevision",expected).put("staged",false).put("complete",false).put("createdAt",Instant.now().toString())
        val saved=draft(id).save(value,null);check();records=records.orEmpty().filterNot{it.document.id==map.id}+NativeMapRecord(map,expected,pending=JSONObject().put("id",id),dirty=true);deliver(saved)
    }
    override suspend fun history(id:String):List<NativeMapRecord>{check();check(!account.offline){"E2EE_ONLINE_REQUIRED"};val versions=mutableListOf<NativeMapRecord>();var before:Long?=null;val seen=mutableSetOf<Long>()
        do{val response=request("/$id/history"+(before?.let{"?before=$it"}?:""));for(value in rows(response.getJSONArray("versions")))if(!value.optBoolean("deleted"))versions+=record(value)
            before=if(response.isNull("nextCursor"))null else E2eeCommands.integer(response.get("nextCursor"),1);check(before==null||seen.add(before)){"E2EE_PRODUCT_HISTORY_INVALID"};check(versions.size<=10000){"E2EE_SHARED_QUERY_TOO_LARGE"}
        }while(before!=null);return versions
    }
    override suspend fun serverVersion(id:String):NativeMapRecord{check();check(!account.offline){"E2EE_ONLINE_REQUIRED"};load(true);return snapshot().singleOrNull{it.document.id==id&&!it.unsynced}?:error("E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED")}
    override suspend fun adoptServer(id:String,access:FeatureAccess){check();check(drafts().none{!it.value.getBoolean("complete")&&it.value.getJSONObject("document").getString("id")==id}){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};load(true)}
    override suspend fun fork(input:MindmapDocument,access:FeatureAccess):MindmapDocument{val copy=MindmapDocument.parse(input.json()).copy(id=UUID.randomUUID().toString());save(copy,0,access);return copy}
    private fun local(name:String)=E2eeDeviceDocument(account.device,"shared-map-local:$space:$name",{value->E2eeKeys.exact(value,setOf("ownerId","spaceId","value"));check(value.getString("ownerId")==owner&&value.getString("spaceId")==space){"E2EE_SCOPE_BINDING_MISMATCH"};value},::check)
    override suspend fun saveLocal(name:String,value:JSONObject?){check();val store=local(name);val old=store.load();store.save(JSONObject().put("ownerId",owner).put("spaceId",space).put("value",value?:JSONObject.NULL),old?.serial);check()}
    override suspend fun readLocal(name:String):JSONObject?{check();return local(name).load()?.value?.optJSONObject("value")}
    override suspend fun readView(id:String)=readLocal("view:$id")
    override fun toString()="NativePrivateSharedMindmaps([redacted])"
}
