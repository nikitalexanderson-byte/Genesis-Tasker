package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.security.*
import java.time.Instant
import java.util.Base64
import java.util.UUID

/** Native personal editor for the same live document as web. Existing migration
 * records/attachments remain authenticated seeds; legacy conversion receipts do
 * not execute. Every normal edit uses the durable new-root editor queue. */
internal class NativePrivateMindmaps(private val scope:String,private val owner:String,val account:E2eeProductAccount){
    private val document=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"mindmap","personal-mindmaps-live-v1",::validate,::check,::check)
    private var view:E2eePrivateDocument.Opened?=null
    private fun check(){account.requireOpen();check(NativePrivateProducts.account(scope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    private fun rows(value:JSONArray)=PrivateDiaryState.rows(value)
    private fun array(value:List<JSONObject>)=PrivateDiaryState.array(value)
    private fun validate(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("protocol","ownerId","records","versions"));check(value.get("protocol")==1&&value.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"}
        val seen=mutableSetOf<String>();val records=rows(value.getJSONArray("records"));val versions=rows(value.getJSONArray("versions"));check(records.size<=10000&&versions.size<=10000){"E2EE_MINDMAPS_SOURCE_INVALID"}
        for(row in records){E2eeKeys.exact(row,setOf("id","document","revision","deleted","updatedAt"));val id=E2eeKeys.technical(row.getString("id"));PrivateDiaryState.revision(row.get("revision"))
            check(seen.add(id)&&row.get("deleted") is Boolean&&DiaryNote.validDate(row.opt("updatedAt"))){"E2EE_MINDMAPS_SOURCE_INVALID"}
            if(row.getBoolean("deleted"))check(row.isNull("document")){"E2EE_MINDMAPS_SOURCE_INVALID"}else check(MindmapDocument.parse(row.getJSONObject("document")).id==id){"E2EE_SCOPE_BINDING_MISMATCH"}}
        for(row in versions){E2eeKeys.exact(row,setOf("document","revision","updatedAt"));MindmapDocument.parse(row.getJSONObject("document"));check(PrivateDiaryState.revision(row.get("revision"))>=1&&DiaryNote.validDate(row.opt("updatedAt"))){"E2EE_MINDMAPS_SOURCE_INVALID"}}
        return JSONObject(value.toString())
    }
    private fun read(id:String):JSONObject{val row=account.client.read("mindmap",id)?:error("E2EE_MINDMAPS_SOURCE_INVALID")
        try{check();return E2eeFileManifestJson.readPrivateDocument(row.bytes)}finally{row.bytes.fill(0)}}
    private fun hydrate(input:JSONObject):MindmapDocument{
        val value=JSONObject(input.toString());for(node in rows(value.getJSONArray("nodes"))){val presentation=node.optJSONObject("presentation")?:continue;val image=presentation.optJSONObject("image")?:continue
            if(!image.has("dataRef"))continue
            E2eeKeys.exact(image,setOf("alt","fit","dataRef"));val reference=image.getJSONObject("dataRef");E2eeKeys.exact(reference,setOf("objectId","mediaType","size"));val id=reference.getString("objectId");val type=reference.getString("mediaType");val size=PrivateDiaryState.revision(reference.get("size"))
            check(id.matches(Regex("personal-mindmap-image:[a-f0-9-]{36}"))&&type in setOf("image/png","image/jpeg","image/webp")&&size in 1..262500){"E2EE_MINDMAPS_SOURCE_INVALID"}
            val file=account.client.read("attachment",id)?:error("E2EE_MINDMAPS_ATTACHMENT_REQUIRED")
            try{check();check(file.bytes.size.toLong()==size&&file.mediaType==type){"E2EE_MINDMAPS_SOURCE_INVALID"};presentation.put("image",JSONObject().put("alt",image.get("alt")).put("fit",image.get("fit")).put("data","data:$type;base64,"+Base64.getEncoder().encodeToString(file.bytes)))}finally{file.bytes.fill(0)}
        };return MindmapDocument.parse(value)
    }
    private fun seed():JSONObject{
        val index=read("personal-mindmap-index-v1");E2eeKeys.exact(index,setOf("protocol","ownerId","records","versions"));check(index.get("protocol")==1&&index.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"}
        val seen=mutableSetOf<String>();val records=rows(index.getJSONArray("records")).map{entry->
            E2eeKeys.exact(entry,setOf("id","objectId","deleted"));val id=entry.getString("id");check(seen.add(id)&&entry.get("deleted") is Boolean&&entry.getString("objectId").matches(Regex("personal-mindmap-record:[a-f0-9-]{36}"))){"E2EE_MINDMAPS_SOURCE_INVALID"}
            val row=read(entry.getString("objectId"));E2eeKeys.exact(row,setOf("protocol","ownerId","id","selected","variants"));check(row.get("protocol")==1&&row.get("ownerId")==owner&&row.get("id")==id){"E2EE_SCOPE_BINDING_MISMATCH"}
            val selected=row.getJSONObject("selected");E2eeKeys.exact(selected,setOf("source","document","revision","deleted"));val revision=PrivateDiaryState.revision(selected.get("revision"))
            check(selected.get("deleted")==entry.get("deleted")&&rows(row.getJSONArray("variants")).any{E2eeProductJson.same(it,selected)}){"E2EE_MINDMAPS_SOURCE_INVALID"}
            val map=if(entry.getBoolean("deleted")){check(selected.isNull("document")){"E2EE_MINDMAPS_SOURCE_INVALID"};null}else hydrate(selected.getJSONObject("document")).also{check(it.id==id){"E2EE_SCOPE_BINDING_MISMATCH"}}
            JSONObject().put("id",id).put("document",map?.json()?:JSONObject.NULL).put("revision",revision).put("deleted",map==null).put("updatedAt",Instant.EPOCH.toString())
        }
        val versionIds=mutableSetOf<String>();val versions=rows(index.getJSONArray("versions")).map{entry->
            E2eeKeys.exact(entry,setOf("mapId","revision","schemaVersion","updatedAt","objectId"));check(versionIds.add(entry.getString("mapId")+":"+entry.getLong("revision"))&&entry.getString("objectId").matches(Regex("personal-mindmap-version:[a-f0-9-]{36}"))){"E2EE_MINDMAPS_SOURCE_INVALID"}
            val row=read(entry.getString("objectId"));E2eeKeys.exact(row,setOf("protocol","ownerId","id","revision","schemaVersion","updatedAt","document"))
            check(row.get("protocol")==1&&row.get("ownerId")==owner&&row.get("id")==entry.get("mapId")&&listOf("revision","schemaVersion","updatedAt").all{E2eeProductJson.same(row.get(it),entry.get(it))}&&entry.getInt("schemaVersion") in 1..2){"E2EE_SCOPE_BINDING_MISMATCH"}
            val map=hydrate(row.getJSONObject("document"));check(map.id==entry.getString("mapId")){"E2EE_SCOPE_BINDING_MISMATCH"}
            JSONObject().put("document",map.json()).put("revision",entry.get("revision")).put("updatedAt",entry.get("updatedAt"))
        }
        return JSONObject().put("protocol",1).put("ownerId",owner).put("records",array(records)).put("versions",array(versions))
    }
    @Synchronized fun load(refresh:Boolean=false){check();if(view!=null&&!refresh)return
        try{view=document.load(account.offline)}catch(error:IllegalStateException){if(account.offline||error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error
            val value=seed();val serial=document.save(value,null,0);view=E2eePrivateDocument.Opened(value,serial,0,true)}
    }
    private fun state(write:Boolean=true):E2eePrivateDocument.Opened{check();val value=requireNotNull(view){"E2EE_PRODUCT_READ_REQUIRED"};if(write)check(value.conflict==null){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};return value}
    @Synchronized fun snapshot():List<NativeMapRecord>{val value=state(false);return rows(value.value.getJSONArray("records")).filterNot{it.getBoolean("deleted")}.map{NativeMapRecord(MindmapDocument.parse(it.getJSONObject("document")),it.getLong("revision"),dirty=value.pending||value.conflict!=null)}}
    @Synchronized fun requireNoConflict(){state()}
    @Synchronized fun restoreView():JSONObject{load(true);flush();val opened=state();val records=JSONArray();for(row in rows(opened.value.getJSONArray("records")))records.put(JSONObject().put("id",row.get("id")).put("revision",row.get("revision")).put("deleted",row.get("deleted")).put("value",row.get("document")).put("localOnly",false));return JSONObject().put("checkpoint",JSONArray().put(opened.serial).put(opened.remoteRevision).toString()).put("pending",opened.pending).put("records",records)}
    @Synchronized fun restoreAdd(input:JSONObject,access:FeatureAccess){load();val map=MindmapDocument.parse(input);check(input.isNull("projectId")&&rows(state().value.getJSONArray("records")).none{it.getString("id")==map.id}){"E2EE_RESTORE_OUTCOME_REQUIRED"};save(map,0,access)}
    @Synchronized fun flush(){val old=state();if(!old.pending||account.offline)return;document.flush();view=document.load(true);check(!requireNotNull(view).pending&&E2eeProductJson.same(requireNotNull(view).value,old.value)){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}}
    @Synchronized fun save(input:MindmapDocument,expected:Long,access:FeatureAccess){
        load();val map=MindmapDocument.parse(input.json());val old=state();val records=rows(old.value.getJSONArray("records"));val previous=records.firstOrNull{it.getString("id")==map.id}
        check(previous?.optBoolean("deleted")!=true){"E2EE_MINDMAP_DELETED"};check((previous?.getLong("revision")?:0L)==expected){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
        if(previous==null)check(access.canCreate("mindmaps",records.count{!it.getBoolean("deleted")})){"FEATURE_SUBSCRIPTION_REQUIRED"}
        val now=Instant.now().toString();val revision=expected+1;val value=JSONObject(old.value.toString())
            .put("records",array(records.filterNot{it.getString("id")==map.id}+JSONObject().put("id",map.id).put("document",map.json()).put("revision",revision).put("deleted",false).put("updatedAt",now)))
            .put("versions",array(rows(old.value.getJSONArray("versions"))+JSONObject().put("document",map.json()).put("revision",revision).put("updatedAt",now)))
        val serial=document.save(value,old.serial,old.remoteRevision);view=E2eePrivateDocument.Opened(value,serial,old.remoteRevision,true);flush()
    }
    @Synchronized fun history(id:String):List<NativeMapRecord>{load();return rows(state(false).value.getJSONArray("versions")).filter{it.getJSONObject("document").getString("id")==id}.map{NativeMapRecord(MindmapDocument.parse(it.getJSONObject("document")),it.getLong("revision"))}}
    @Synchronized fun serverVersion(id:String):NativeMapRecord{check(!account.offline){"E2EE_ONLINE_REQUIRED"};load(true);val opened=state(false);val value=opened.conflict?.value?:opened.value
        val row=rows(value.getJSONArray("records")).firstOrNull{it.getString("id")==id&&!it.getBoolean("deleted")}?:error("E2EE_MINDMAP_DELETED");return NativeMapRecord(MindmapDocument.parse(row.getJSONObject("document")),row.getLong("revision"))}
    /** Explicit adoption keeps divergent local maps as copies before replacing
     * the aggregate head. No unrelated local branch is silently discarded. */
    @Synchronized fun adoptServer(id:String,access:FeatureAccess,copyInput:MindmapDocument?=null):MindmapDocument?{
        check(!account.offline){"E2EE_ONLINE_REQUIRED"};load(true);val opened=state(false);val conflict=opened.conflict?:return null;val value=JSONObject(conflict.value.toString())
        check(rows(value.getJSONArray("records")).any{it.getString("id")==id}){"E2EE_MINDMAP_DELETED"}
        val originals=rows(value.getJSONArray("records"));val records=originals.toMutableList();val versions=rows(value.getJSONArray("versions")).toMutableList()
        var selectedCopy:MindmapDocument?=null
        for(local in rows(opened.value.getJSONArray("records")).filterNot{it.getBoolean("deleted")}){
            if(originals.any{E2eeProductJson.same(it,local)}&&(copyInput==null||copyInput.id!=local.getString("id")))continue
            check(access.canCreate("mindmaps",records.count{!it.getBoolean("deleted")})){"FEATURE_SUBSCRIPTION_REQUIRED"}
            val map=(copyInput?.takeIf{it.id==local.getString("id")}?:MindmapDocument.parse(local.getJSONObject("document"))).let{it.copy(id=UUID.randomUUID().toString(),title=it.title.take(1985)+" · копия")};val now=Instant.now().toString()
            if(copyInput?.id==local.getString("id"))selectedCopy=map
            records+=JSONObject().put("id",map.id).put("document",map.json()).put("revision",1).put("deleted",false).put("updatedAt",now);versions+=JSONObject().put("document",map.json()).put("revision",1).put("updatedAt",now)
        }
        value.put("records",array(records)).put("versions",array(versions));val serial=document.reviewConflict(value,opened.serial,conflict.revision);view=E2eePrivateDocument.Opened(value,serial,conflict.revision,true);flush();return selectedCopy
    }
    @Synchronized fun fork(input:MindmapDocument,access:FeatureAccess):MindmapDocument{
        load(true);if(state(false).conflict!=null)adoptServer(input.id,access,input)?.let{return it}
        val copy=MindmapDocument.parse(input.json()).let{it.copy(id=UUID.randomUUID().toString(),title=it.title.take(1985)+" · копия")};save(copy,0,access);return copy
    }
    private fun localDocument(name:String)=E2eeDeviceDocument(account.device,name,{value->E2eeKeys.exact(value,setOf("protocol","ownerId","value"));check(value.get("protocol")==1&&value.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"};JSONObject(value.toString())},::check)
    @Synchronized fun saveLocal(name:String,value:JSONObject?){check();val target=localDocument(name);val old=target.load();target.save(JSONObject().put("protocol",1).put("ownerId",owner).put("value",value?:JSONObject.NULL),old?.serial)}
    @Synchronized fun readLocal(name:String):JSONObject?{check();return localDocument(name).load()?.value?.optJSONObject("value")}
    @Synchronized fun readView(id:String):JSONObject?{
        readLocal("mindmap-view:$id")?.let{return it};val history=NativePrivateProducts.history(scope,owner,"mindmap","personal-mindmap-local-work-v1")
        if(history.availability=="not-on-this-device")return null
        val content=history.content?:error("E2EE_MINDMAPS_LOCAL_CONTENT_REQUIRED")
        try{val value=E2eeFileManifestJson.readPrivateDocument(content.bytes);E2eeKeys.exact(value,setOf("protocol","ownerId","history","drafts","views","conversions","editors","entries","execution"))
            check(value.get("protocol")==1&&value.get("ownerId")==owner&&value.get("execution")=="history-only"){"E2EE_SCOPE_BINDING_MISMATCH"}
            val matching=rows(value.getJSONArray("views")).filter{it.opt("mapId")==id};val first=matching.firstOrNull()?.getJSONObject("value")?:return null
            check(matching.all{E2eeProductJson.same(it.getJSONObject("value"),first)}){"E2EE_MINDMAP_VIEW_REVIEW_REQUIRED"};return JSONObject(first.toString())
        }finally{content.bytes.fill(0)}
    }
    override fun toString()="NativePrivateMindmaps([redacted])"
}
