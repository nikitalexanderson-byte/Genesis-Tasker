package ru.genesis.calendar.data

import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.security.*
import java.security.MessageDigest
import java.util.UUID

/** Real native diary editor route. Device-only notes/drafts have no uploader.
 * Privacy transitions preserve a local copy before changing the remote head. */
internal class NativePrivateDiary(private val scope:String,private val owner:String,val account:E2eeProductAccount){
    private val writer=UUID.randomUUID().toString()
    private val remote=E2eePrivateDocument(account.device,account.client,account.directory.scopeId,"diary","personal-diary-live-v1",
        {PrivateDiaryState.remote(it,owner)},::check,::check)
    private val local=E2eeDeviceDocument(account.device,"personal-diary-device-live-v1",{PrivateDiaryState.device(it,owner,account.device.deviceId)},::check)
    private var view:E2eePrivateDocument.Opened?=null;private var device:E2eeDeviceDocument.Opened?=null
    private fun check(){account.requireOpen();check(NativePrivateProducts.account(scope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    private fun state():Pair<E2eePrivateDocument.Opened,E2eeDeviceDocument.Opened>{check();val value=requireNotNull(view){"E2EE_PRODUCT_READ_REQUIRED"};check(value.conflict==null){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};return value to requireNotNull(device){"E2EE_PRODUCT_READ_REQUIRED"}}
    private fun read(id:String):JSONObject{val row=account.client.read("diary",id)?:error("E2EE_DIARY_SOURCE_INVALID");check()
        try{return E2eeFileManifestJson.readPrivateDocument(row.bytes)}finally{row.bytes.fill(0)}}
    private fun history(id:String)=NativePrivateProducts.history(scope,owner,"diary",id).also{check();check(it.availability!="present"||it.content!=null){"E2EE_DIARY_LOCAL_CONTENT_REQUIRED"}}
    private fun migrated(deviceOnly:Boolean):List<JSONObject>{
        val index=if(deviceOnly){val result=history("personal-diary-local-index-v1");check(result.availability=="present"){"E2EE_DIARY_LOCAL_CONTENT_REQUIRED"}
            try{E2eeFileManifestJson.readPrivateDocument(requireNotNull(result.content).bytes)}finally{result.content?.bytes?.fill(0)}}else read("personal-diary-index-v1")
        E2eeKeys.exact(index,setOf("protocol","ownerId","records","references"));check(index.get("protocol")==1&&index.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"}
        val seen=mutableSetOf<String>();return PrivateDiaryState.rows(index.getJSONArray("records")).map{entry->
            E2eeKeys.exact(entry,setOf("id","objectId","deleted"));val id=entry.getString("id");val objectId=entry.getString("objectId")
            check(DiaryNote.idPattern.matches(id)&&seen.add(id)&&objectId.matches(Regex("personal-diary-record:[a-f0-9-]{36}"))&&entry.get("deleted") is Boolean){"E2EE_DIARY_SOURCE_INVALID"}
            val row=if(deviceOnly){val result=history(objectId);check(result.availability=="present"){"E2EE_DIARY_LOCAL_CONTENT_REQUIRED"}
                try{E2eeFileManifestJson.readPrivateDocument(requireNotNull(result.content).bytes)}finally{result.content?.bytes?.fill(0)}}else read(objectId)
            E2eeKeys.exact(row,setOf("protocol","ownerId","id","selected","variants"));check(row.get("protocol")==1&&row.get("ownerId")==owner&&row.get("id")==id){"E2EE_SCOPE_BINDING_MISMATCH"}
            val selected=row.getJSONObject("selected");E2eeKeys.exact(selected,setOf("source","note","revision","deleted"));val revision=PrivateDiaryState.revision(selected.get("revision"))
            check(selected.get("deleted")==entry.get("deleted")&&PrivateDiaryState.rows(row.getJSONArray("variants")).any{E2eeCommands.canonical(it).contentEquals(E2eeCommands.canonical(selected))}){"E2EE_DIARY_SOURCE_INVALID"}
            val note=if(entry.getBoolean("deleted")){check(selected.isNull("note")){"E2EE_DIARY_SOURCE_INVALID"};null}else DiaryNote.parse(selected.getJSONObject("note")).also{check(it.id==id){"E2EE_SCOPE_BINDING_MISMATCH"}}
            PrivateDiaryState.entry(note,id,revision)
        }
    }
    @Synchronized fun load(refresh:Boolean=false){
        check();if(view==null||refresh){
            try{view=remote.load(account.offline)}catch(error:IllegalStateException){if(account.offline||error.message!="E2EE_PRIVATE_DOCUMENT_MISSING")throw error
                val records=migrated(false);val metadata=read("personal-diary-settings-v1");E2eeKeys.exact(metadata,setOf("protocol","ownerId","settings","dreamSettings","noteHistory","execution"))
                check(metadata.get("protocol")==1&&metadata.get("ownerId")==owner&&metadata.get("execution")=="history-only"){"E2EE_DIARY_SOURCE_INVALID"}
                val settings=metadata.getJSONArray("settings");val dreams=metadata.getJSONArray("dreamSettings");check(settings.length()<=1&&dreams.length()<=1){"E2EE_DIARY_SOURCE_INVALID"}
                val enabled=if(settings.length()==0)true else settings.getJSONObject(0).get("sync_enabled").let{check(it in setOf(0,1)){"E2EE_DIARY_SOURCE_INVALID"};it==1}
                val revision=if(settings.length()==0)0L else PrivateDiaryState.revision(settings.getJSONObject(0).get("revision"))
                val dream=if(dreams.length()==0)DreamSettings()else DreamSettings.parse(JSONObject().put("todayMode",dreams.getJSONObject(0).get("today_mode")).put("revision",dreams.getJSONObject(0).get("revision")))
                val value=JSONObject().put("protocol",1).put("ownerId",owner).put("syncEnabled",enabled).put("settingsRevision",revision).put("dreamSettings",dream.json()).put("records",PrivateDiaryState.array(records))
                val serial=remote.save(value,null,0);view=E2eePrivateDocument.Opened(value,serial,0,true)
            }
        }
        device=local.load();if(device==null){
            check(!account.offline){"E2EE_OFFLINE_CONTENT_UNAVAILABLE"};val index=history("personal-diary-local-index-v1");index.content?.bytes?.fill(0)
            var paused=!requireNotNull(view).value.getBoolean("syncEnabled");var records=emptyList<JSONObject>();val drafts=JSONArray()
            if(index.availability=="present"){
                records=migrated(true);val original=history("personal-diary-local-history-v1");check(original.availability=="present"){"E2EE_DIARY_LOCAL_CONTENT_REQUIRED"}
                try{val value=E2eeFileManifestJson.readPrivateDocument(requireNotNull(original.content).bytes);E2eeKeys.exact(value,setOf("protocol","ownerId","settings","dreamSettings","deletions","history","drafts","noteHistory","execution"))
                    check(value.get("protocol")==1&&value.get("ownerId")==owner&&value.get("execution")=="history-only"){"E2EE_DIARY_SOURCE_INVALID"}
                    value.optJSONObject("settings")?.let{paused=paused||!it.getBoolean("syncEnabled")||it.optBoolean("deviceLocalOnly")}
                    for(row in PrivateDiaryState.rows(value.getJSONArray("drafts"))){val note=DiaryNote.parseDraft(row.optJSONObject("pendingNote")?:row.getJSONObject("note"));val revision=PrivateDiaryState.revision(row.get("revision"))
                        drafts.put(JSONObject().put("key","diary-draft:"+UUID.randomUUID()).put("note",note.json()).put("revision",revision)
                            .put("localOnly",paused||records.any{it.getString("id")==note.id&&!it.getBoolean("deleted")}).put("editorState",JSONObject.NULL))}
                }finally{original.content?.bytes?.fill(0)}
            }
            device=local.save(JSONObject().put("protocol",1).put("ownerId",owner).put("deviceId",account.device.deviceId).put("migrationHistory",index.availability)
                .put("paused",paused).put("records",PrivateDiaryState.array(records)).put("drafts",drafts).put("promotions",JSONArray()),null)
        };state()
    }
    private fun stage(value:JSONObject){val old=state().first;val serial=remote.save(value,old.serial,old.remoteRevision);view=E2eePrivateDocument.Opened(JSONObject(value.toString()),serial,old.remoteRevision,true)}
    private fun stageLocal(value:JSONObject){device=local.save(value,state().second.serial)}
    @Synchronized fun flush(){val old=state().first;if(!old.pending||account.offline)return;remote.flush();view=remote.load(true);check()
        check(requireNotNull(view).let{!it.pending&&E2eeProductJson.same(it.value,old.value)}){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}}
    @Synchronized fun snapshot():DiaryState{
        val (remote,local)=state();val hidden=local.value.getBoolean("paused")||!remote.value.getBoolean("syncEnabled")
        fun records(value:JSONObject,localOnly:Boolean)=PrivateDiaryState.rows(value.getJSONArray("records")).filterNot{it.getBoolean("deleted")}.map{DiaryRecord(DiaryNote.parse(it.getJSONObject("note")),it.getLong("revision"),localOnly=localOnly)}
        val drafts=PrivateDiaryState.rows(local.value.getJSONArray("drafts")).map{DiaryRecord(DiaryNote.parseDraft(it.getJSONObject("note")),it.getLong("revision"),it.getString("key"),localOnly=hidden||it.getBoolean("localOnly"))}
        return DiaryState((if(hidden)emptyList()else records(remote.value,false))+records(local.value,true)+drafts,account.offline,true,false,!hidden,
            PrivateDiaryState.rows(local.value.getJSONArray("records")).count{!it.getBoolean("deleted")},DreamSettings.parse(remote.value.getJSONObject("dreamSettings")),local.value.getString("migrationHistory"))
    }
    private fun ownKey(id:String)="diary-draft:$writer:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(id.toByteArray(Charsets.UTF_8)))
    @Synchronized fun restoreView():JSONObject{load(true);flush();val (remote,local)=state();val records=JSONArray()
        for((value,deviceOnly)in listOf(remote.value to false,local.value to true))for(row in PrivateDiaryState.rows(value.getJSONArray("records")))records.put(JSONObject().put("id",row.get("id")).put("revision",row.get("revision")).put("deleted",row.get("deleted")).put("value",row.get("note")).put("localOnly",deviceOnly))
        return JSONObject().put("checkpoint",JSONArray().put(remote.serial).put(remote.remoteRevision).put(local.serial).toString()).put("pending",remote.pending||local.value.getJSONArray("promotions").length()>0).put("records",records)
    }
    @Synchronized fun restoreAdd(input:JSONObject,access:FeatureAccess){load();val note=DiaryNote.parse(input);val (remote,local)=state()
        check((PrivateDiaryState.rows(remote.value.getJSONArray("records"))+PrivateDiaryState.rows(local.value.getJSONArray("records"))).none{it.getString("id")==note.id}&&PrivateDiaryState.rows(local.value.getJSONArray("drafts")).none{it.getJSONObject("note").getString("id")==note.id}){"E2EE_RESTORE_OUTCOME_REQUIRED"}
        if(note.dreamDay!=null)check(access.allows("dream-journal")){"FEATURE_SUBSCRIPTION_REQUIRED"};if(note.adviceId==null)check(access.canCreate("diary",snapshot().records.count{!it.draft&&it.note.adviceId==null})){"FEATURE_SUBSCRIPTION_REQUIRED"}
        stageLocal(JSONObject(local.value.toString()).put("records",PrivateDiaryState.array(PrivateDiaryState.rows(local.value.getJSONArray("records"))+PrivateDiaryState.entry(note,note.id,1))))
    }
    private fun keep(note:DiaryNote,revision:Long,key:String?):DiaryRecord{
        val local=state().second.value;val draftKey=key?:ownKey(note.id);check(draftKey.startsWith("diary-draft:")){"DIARY_INVALID_DRAFT"}
        val drafts=PrivateDiaryState.rows(local.getJSONArray("drafts"));val old=drafts.firstOrNull{it.getString("key")==draftKey}
        check(old==null||old.getJSONObject("note").getString("id")==note.id){"DIARY_INVALID_DRAFT"}
        val localOnly=!snapshot().syncEnabled||old?.optBoolean("localOnly")==true||PrivateDiaryState.rows(local.getJSONArray("records")).any{it.getString("id")==note.id&&!it.getBoolean("deleted")}
        val value=JSONObject().put("key",draftKey).put("note",note.json()).put("revision",revision).put("localOnly",localOnly).put("editorState",old?.opt("editorState")?:JSONObject.NULL)
        stageLocal(JSONObject(local.toString()).put("drafts",PrivateDiaryState.array(drafts.filterNot{it.getString("key")==draftKey}+value)))
        return DiaryRecord(note,revision,draftKey,localOnly=localOnly)
    }
    @Synchronized fun keepDraft(note:DiaryNote,revision:Long,key:String?):DiaryRecord{load();return keep(DiaryNote.parseDraft(note.json()),revision,key)}
    private fun discard(keys:Set<String>){val local=state().second.value;check(keys.all{it.startsWith("diary-draft:")}){"DIARY_INVALID_DRAFT"}
        stageLocal(JSONObject(local.toString()).put("drafts",PrivateDiaryState.array(PrivateDiaryState.rows(local.getJSONArray("drafts")).filterNot{it.getString("key") in keys})))}
    @Synchronized fun discardDraft(key:String){load();discard(setOf(key))}
    @Synchronized fun discardEditorDraft(id:String,key:String?){load();val keys=setOfNotNull(key,ownKey(id));check(PrivateDiaryState.rows(state().second.value.getJSONArray("drafts")).none{it.getString("key") in keys&&it.getJSONObject("note").getString("id")!=id}){"DIARY_INVALID_DRAFT"};discard(keys)}
    @Synchronized fun save(input:DiaryNote,revision:Long,key:String?,access:FeatureAccess):DiaryRecord{
        load();val note=DiaryNote.parse(input.json());val draft=keep(note,revision,key);val (remote,local)=state();val selected=if(draft.localOnly)local.value else remote.value
        val rows=PrivateDiaryState.rows(selected.getJSONArray("records"));val old=rows.firstOrNull{it.getString("id")==note.id}
        check(old?.getBoolean("deleted")!=true){"DIARY_NOTE_DELETED"};check((old?.getLong("revision")?:0L)==revision){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
        if(note.dreamDay!=null)check(access.allows("dream-journal")){"FEATURE_SUBSCRIPTION_REQUIRED"}
        if(note.adviceId==null&&old==null)check(access.canCreate("diary",snapshot().records.count{!it.draft&&it.note.adviceId==null})){"FEATURE_SUBSCRIPTION_REQUIRED"}
        check(PrivateDiaryState.rows(local.value.getJSONArray("promotions")).none{it.getString("sourceId")==note.id}){"DIARY_LOCAL_UPLOAD_PENDING"}
        val next=JSONObject(selected.toString()).put("records",PrivateDiaryState.array(rows.filterNot{it.getString("id")==note.id}+PrivateDiaryState.entry(note,note.id,revision+1)))
        if(draft.localOnly)stageLocal(next)else{stage(next);flush()};discard(setOf(requireNotNull(draft.draftKey),ownKey(note.id)));return DiaryRecord(note,revision+1,localOnly=draft.localOnly)
    }
    @Synchronized fun saveCopy(note:DiaryNote,key:String?,access:FeatureAccess):DiaryRecord{
        load();val id=UUID.nameUUIDFromBytes("$owner:${key?:ownKey(note.id)}:private-copy".toByteArray(Charsets.UTF_8)).toString()
        val known=snapshot().records.firstOrNull{!it.draft&&it.note.id==id};val copy=note.asCopy(id).let{if(known==null)it else DiaryNote.parse(it.json().put("createdAt",known.note.createdAt))}
        val result=if(known!=null&&known.note.sameContent(copy))known else save(copy,known?.revision?:0,null,access)
        if(key!=null)discard(setOf(key));return result
    }
    @Synchronized fun remove(record:DiaryRecord){
        load();check(!record.draft){"DIARY_INVALID_NOTE"};val (remote,local)=state();val localOnly=record.localOnly||!snapshot().syncEnabled;val selected=if(localOnly)local.value else remote.value
        val rows=PrivateDiaryState.rows(selected.getJSONArray("records"));val old=rows.firstOrNull{it.getString("id")==record.note.id}?:return;if(old.getBoolean("deleted"))return
        check(old.getLong("revision")==record.revision&&PrivateDiaryState.rows(local.value.getJSONArray("promotions")).none{it.getString("sourceId")==record.note.id}){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
        val next=JSONObject(selected.toString()).put("records",PrivateDiaryState.array(rows.map{if(it.getString("id")==record.note.id)PrivateDiaryState.entry(null,record.note.id,record.revision+1)else it}))
        if(localOnly)stageLocal(next)else{stage(next);flush()}
        val current=state().second.value;stageLocal(JSONObject(current.toString()).put("drafts",PrivateDiaryState.array(PrivateDiaryState.rows(current.getJSONArray("drafts")).filterNot{it.getJSONObject("note").getString("id")==record.note.id&&(localOnly||!it.getBoolean("localOnly"))})))
    }
    @Synchronized fun setDreamTodayMode(mode:String){load();val value=state().first.value;val old=DreamSettings.parse(value.getJSONObject("dreamSettings"));val next=DreamSettings.parse(JSONObject().put("todayMode",mode).put("revision",old.revision+1));stage(JSONObject(value.toString()).put("dreamSettings",next.json()));flush()}
    @Synchronized fun setSyncEnabled(enabled:Boolean){
        check(!account.offline){"DIARY_ONLINE_REQUIRED"};load(true);flush();val (remote,local)=state();check(!remote.pending){"DIARY_ONLINE_REQUIRED"}
        if(!enabled){
            val copied=PrivateDiaryState.rows(local.value.getJSONArray("records")).toMutableList()
            for(row in PrivateDiaryState.rows(remote.value.getJSONArray("records")).filterNot{it.getBoolean("deleted")}){
                val old=copied.firstOrNull{it.getString("id")==row.getString("id")}
                check(old==null||!old.getBoolean("deleted")&&DiaryNote.parse(old.getJSONObject("note")).sameContent(DiaryNote.parse(row.getJSONObject("note")))){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
                if(old==null)copied+=row
            }
            stageLocal(JSONObject(local.value.toString()).put("paused",true).put("records",PrivateDiaryState.array(copied)).put("drafts",PrivateDiaryState.array(PrivateDiaryState.rows(local.value.getJSONArray("drafts")).map{JSONObject(it.toString()).put("localOnly",true)})))
            if(remote.value.getBoolean("syncEnabled")){stage(JSONObject(remote.value.toString()).put("syncEnabled",false).put("settingsRevision",remote.value.getLong("settingsRevision")+1)
                .put("records",PrivateDiaryState.array(PrivateDiaryState.rows(remote.value.getJSONArray("records")).map{if(it.getBoolean("deleted"))it else PrivateDiaryState.entry(null,it.getString("id"),it.getLong("revision")+1)})));flush()}
        }else{
            if(!remote.value.getBoolean("syncEnabled")){stage(JSONObject(remote.value.toString()).put("syncEnabled",true).put("settingsRevision",remote.value.getLong("settingsRevision")+1));flush()}
            stageLocal(JSONObject(state().second.value.toString()).put("paused",false));promote()
        }
    }
    private fun promote(){
        for(source in PrivateDiaryState.rows(state().second.value.getJSONArray("records")).filterNot{it.getBoolean("deleted")}){
            var local=state().second.value;var promotion=PrivateDiaryState.rows(local.getJSONArray("promotions")).firstOrNull{it.getString("sourceId")==source.getString("id")}
            if(promotion==null){promotion=JSONObject().put("sourceId",source.get("id")).put("sourceRevision",source.get("revision")).put("id",UUID.randomUUID().toString())
                stageLocal(JSONObject(local.toString()).put("promotions",PrivateDiaryState.array(PrivateDiaryState.rows(local.getJSONArray("promotions"))+promotion)))}
            val note=DiaryNote.parse(JSONObject(source.getJSONObject("note").toString()).put("id",promotion.getString("id")));val remote=state().first.value;val rows=PrivateDiaryState.rows(remote.getJSONArray("records"));val old=rows.firstOrNull{it.getString("id")==note.id}
            check(old==null||!old.getBoolean("deleted")&&DiaryNote.parse(old.getJSONObject("note")).sameContent(note)){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"}
            if(old==null)stage(JSONObject(remote.toString()).put("records",PrivateDiaryState.array(rows+PrivateDiaryState.entry(note,note.id,1))));flush();check(!state().first.pending){"DIARY_ONLINE_REQUIRED"}
            local=state().second.value;stageLocal(JSONObject(local.toString())
                .put("records",PrivateDiaryState.array(PrivateDiaryState.rows(local.getJSONArray("records")).filterNot{it.get("id")==source.get("id")}))
                .put("promotions",PrivateDiaryState.array(PrivateDiaryState.rows(local.getJSONArray("promotions")).filterNot{it.get("sourceId")==source.get("id")}))
                .put("drafts",PrivateDiaryState.array(PrivateDiaryState.rows(local.getJSONArray("drafts")).map{if(it.getJSONObject("note").get("id")==source.get("id"))JSONObject(it.toString()).put("note",JSONObject(it.getJSONObject("note").toString()).put("id",note.id)).put("revision",1).put("localOnly",false).put("editorState",JSONObject.NULL)else it})))
        }
    }
    @Synchronized fun adviceId(adviceId:String):String{load();snapshot().records.firstOrNull{!it.draft&&it.note.adviceId==adviceId}?.let{return it.note.id}
        val deleted=(PrivateDiaryState.rows(state().first.value.getJSONArray("records"))+PrivateDiaryState.rows(state().second.value.getJSONArray("records"))).filter{it.getBoolean("deleted")}.map{it.getString("id")}.toSet()
        for(generation in 0 until 20000){val bytes=MessageDigest.getInstance("SHA-256").digest("GENESIS-DIARY-ADVICE-ID\u0000v1\u0000$owner\u0000$adviceId\u0000$generation".toByteArray(Charsets.UTF_8))
            val id="adv-"+bytes.joinToString(""){"%02x".format(it.toInt() and 255)};bytes.fill(0);check();if(id !in deleted)return id};error("DIARY_ID_LIMIT")}
    @Synchronized fun react(advice:JSONObject,reaction:String,access:FeatureAccess):DiaryRecord{load(true);val id=adviceId(advice.getString("id"));val old=snapshot().records.firstOrNull{!it.draft&&it.note.id==id}
        return save(DiaryNote.reaction(advice,id,reaction,old?.note),old?.revision?:0,ownKey(id),access)}
    @Synchronized fun sealEditorState(value:String):String{
        check();check(value.length<=1024*1024){"E2EE_SOURCE_TOO_LARGE"};val source=JSONObject(value);val note=DiaryNote.parseDraft(source.optJSONObject("note")?:source)
        device=local.load()?:error("E2EE_PRODUCT_READ_REQUIRED");val content=state().second.value;val rows=PrivateDiaryState.rows(content.getJSONArray("drafts"));val key=ownKey(note.id)
        val old=rows.firstOrNull{it.getString("key")==key};val revision=if(source.has("revision"))PrivateDiaryState.revision(source.get("revision"))else old?.getLong("revision")?:snapshot().records.firstOrNull{!it.draft&&it.note.id==note.id}?.revision?:0
        if(old?.opt("editorState")!=value){
            val localOnly=!snapshot().syncEnabled||old?.optBoolean("localOnly")==true||PrivateDiaryState.rows(content.getJSONArray("records")).any{it.getString("id")==note.id&&!it.getBoolean("deleted")}
            val draft=JSONObject().put("key",key).put("note",note.json()).put("revision",revision).put("localOnly",localOnly).put("editorState",value)
            stageLocal(JSONObject(content.toString()).put("drafts",PrivateDiaryState.array(rows.filterNot{it.getString("key")==key}+draft)))
        }
        return "e2ee-diary-editor-v1:${account.device.deviceId}:$key"
    }
    @Synchronized fun openEditorState(pointer:String):String{
        check();val prefix="e2ee-diary-editor-v1:${account.device.deviceId}:";check(pointer.startsWith(prefix)){"E2EE_EDITOR_STATE_REVIEW_REQUIRED"};val key=pointer.removePrefix(prefix);E2eeKeys.technical(key)
        device=local.load()?:error("E2EE_OFFLINE_CONTENT_UNAVAILABLE");val row=PrivateDiaryState.rows(requireNotNull(device).value.getJSONArray("drafts")).firstOrNull{it.getString("key")==key}?:error("E2EE_EDITOR_STATE_MISSING")
        val value=row.opt("editorState") as? String?:error("E2EE_EDITOR_STATE_MISSING");val form=JSONObject(value);val note=DiaryNote.parseDraft(form.optJSONObject("note")?:form)
        check(note.id==row.getJSONObject("note").getString("id")){"E2EE_SCOPE_BINDING_MISMATCH"};return value
    }
    override fun toString()="NativePrivateDiary([redacted])"
}
