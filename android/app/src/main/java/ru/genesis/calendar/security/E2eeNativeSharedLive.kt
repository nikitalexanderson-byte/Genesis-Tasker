package ru.genesis.calendar.security

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Same bundled content model as web, backed only by native authenticated
 * ciphertext repositories. The isolated renderer never receives vault keys,
 * credentials, arbitrary endpoints, or a generic native storage capability. */
internal class E2eeNativeSharedLive(private val context:Context,private val account:E2eeProductAccount){
    private val mutex=Mutex();private val trust=E2eeSharedTrust(account);private val opened=mutableMapOf<String,Live>()
    private var aggregateSeed:JSONObject?=null
    private fun validatePersonal(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("protocol","ownerId","views","requests","readFlags","watching"));check(value.getInt("protocol")==1&&value.getString("ownerId")==account.ownerId&&value.getJSONArray("views").length()<=10000&&value.getJSONArray("requests").length()<=10000&&value.getJSONObject("readFlags").length()<=100000&&value.getJSONObject("watching").length()<=100000){"E2EE_SHARED_VIEW_INVALID"};return JSONObject(value.toString())
    }
    private val aggregatePersonal by lazy{E2eeFeatureDocument(account,"workspace","personal-shared-views-live-v1",::validatePersonal,{aggregateSeed?.let{JSONObject(it.toString())}?:error("E2EE_PRIVATE_SEED_REQUIRED")},::current)}
    private val aggregateRuntime=NativeAdviceProductRuntime(context,"shared-aggregate")
    @Volatile var cachedPendingCount=0;private set
    private fun current(){account.requireOpen()}
    private inner class Live(val records:E2eeSharedRecords){
        val binding=records.domain
        val prefix="shared-request:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(binding.scopeId.toByteArray(Charsets.UTF_8)))+":"
        val runtime=NativeAdviceProductRuntime(context,"shared-product")
        private fun validateRequest(value:JSONObject):JSONObject{
            E2eeKeys.exact(value,setOf("protocol","scopeId","id","method","path","body","createdAt","edits","result","complete"));check(value.getInt("protocol")==1&&value.getString("scopeId")==binding.scopeId&&value.getString("method") in setOf("POST","PATCH","PUT","DELETE")&&value.getString("path").length<=2048&&value.get("complete") is Boolean){"E2EE_SHARED_REQUEST_INVALID"}
            E2eeKeys.technical(value.getString("id"));value.getJSONObject("body");java.time.Instant.parse(value.getString("createdAt"));if(!value.isNull("edits"))check(value.getJSONArray("edits").length() in 0..100){"E2EE_SHARED_REQUEST_INVALID"};if(!value.isNull("result"))value.getJSONObject("result");return JSONObject(value.toString())
        }
        fun request(id:String):E2eeDeviceDocument{E2eeKeys.technical(id);return E2eeDeviceDocument(account.device,prefix+id,::validateRequest,::current)}
        private val metadata=E2eeDeviceDocument(account.device,"shared-context:${binding.scopeId}",{value->E2eeKeys.exact(value,setOf("scopeId","context"));check(value.getString("scopeId")==binding.scopeId){"E2EE_SCOPE_BINDING_MISMATCH"};value.getJSONObject("context");value},::current)
        private val eventStore=E2eeDeviceDocument(account.device,"shared-events:${binding.scopeId}",{value->E2eeKeys.exact(value,setOf("scopeId","events"));check(value.getString("scopeId")==binding.scopeId&&value.getJSONArray("events").length()<=10000){"E2EE_SHARED_DOMAIN_INVALID"};value},::current)
        suspend fun execute(method:String,path:String,body:JSONObject,resumeId:String?=null):JSONObject{
            val heads=linkedMapOf<String,JSONObject>()
            suspend fun call(name:String,payload:JSONObject):Any{current();return when(name){
                "context"->{E2eeKeys.exact(payload,emptySet());val saved=metadata.load();if(account.offline)saved?.value?.getJSONObject("context")?:error("E2EE_OFFLINE_CONTENT_UNAVAILABLE")
                    else{val result=account.sharedScope(binding.scopeId,binding.scopeKind,binding.resourceId).client.readProductContext();current();E2eeKeys.exact(result,setOf("context","checkpointHash","directoryRevision"));val value=result.getJSONObject("context");metadata.save(JSONObject().put("scopeId",binding.scopeId).put("context",value),saved?.serial);value}}
                "heads"->{E2eeKeys.exact(payload,emptySet());check(heads.isEmpty()){"E2EE_PRODUCT_INDEX_INVALID"};val rows=records.index();val ids=JSONArray();for(at in 0 until rows.length()){val row=rows.getJSONObject(at);val id=row.getString("entityId");check(heads.put(id,row)==null){"E2EE_PRODUCT_INDEX_INVALID"};ids.put(JSONObject().put("entityId",id))};ids}
                "version"->{E2eeKeys.exact(payload,setOf("entityId"));records.read(heads[payload.getString("entityId")]?:error("E2EE_PRODUCT_ENTITY_MISSING"))}
                "localVersions"->{E2eeKeys.exact(payload,emptySet());records.product.localVersions()}
                "history"->{E2eeKeys.exact(payload,setOf("entityId","before"));check(!account.offline){"E2EE_ONLINE_REQUIRED"};records.product.history(payload.getString("entityId"),E2eeCommands.integer(payload.get("before"),1))}
                "sourceTable"->{E2eeKeys.exact(payload,setOf("table"));check(payload.getString("table") in setOf("shared_audit_events","shared_mindmap_versions")){"E2EE_SOURCE_PATH_FORBIDDEN"};records.sourceTable(payload.getString("table"))}
                "eventLoad"->{E2eeKeys.exact(payload,emptySet());eventStore.load()?.value?.getJSONArray("events")?:JSONObject.NULL}
                "eventSave"->{E2eeKeys.exact(payload,setOf("events"));val old=eventStore.load();eventStore.save(JSONObject().put("scopeId",binding.scopeId).put("events",payload.getJSONArray("events")),old?.serial);JSONObject().put("saved",true)}
                "completionProposals"->{E2eeKeys.exact(payload,emptySet());records.product.completionProposals()}
                "approvalPreview"->{E2eeKeys.exact(payload,setOf("entityId"));check(!account.offline){"E2EE_ONLINE_REQUIRED"};records.product.approvalPreview(payload.getString("entityId"))}
                "approve"->{E2eeKeys.exact(payload,setOf("review","intentId"));check(!account.offline){"E2EE_ONLINE_REQUIRED"};records.product.approve(payload.getJSONObject("review"),payload.getString("intentId"))}
                "stageFile"->{
                    E2eeKeys.exact(payload,setOf("reference","data"));val reference=payload.getJSONObject("reference");E2eeKeys.exact(reference,setOf("objectId","size","filename","mediaType"));val size=E2eeCommands.integer(reference.get("size"),1);check(size<=10*1024*1024){"TASK_FILES_TOO_LARGE"}
                    val bytes=E2eeEnvelope.decode(payload.getString("data"),size.toInt());val client=account.sharedScope(binding.scopeId,binding.scopeKind,binding.resourceId).client;val queue=E2eeEditorQueue(account.device,client,binding.scopeId,"attachment",reference.getString("objectId"));val saved=queue.load()
                    try{if(saved!=null)check(saved.remoteRevision<=1&&saved.bytes.contentEquals(bytes)&&saved.filename==reference.getString("filename")&&saved.mediaType==reference.getString("mediaType")){"E2EE_IDEMPOTENCY_CONFLICT"}
                        else queue.stage(bytes,null,0,reference.getString("filename"),reference.getString("mediaType"));current()
                        if(!account.offline){queue.flush();current();check(client.objectReference("attachment",reference.getString("objectId")).getLong("revision")==1L){"E2EE_PRIVATE_FILE_IMMUTABLE"}}
                    }finally{bytes.fill(0);saved?.bytes?.fill(0)};JSONObject().put("staged",true)
                }
                "readFile"->{
                    E2eeKeys.exact(payload,setOf("reference"));val reference=payload.getJSONObject("reference");E2eeKeys.exact(reference,setOf("objectId","size","filename","mediaType"));val client=account.sharedScope(binding.scopeId,binding.scopeKind,binding.resourceId).client
                    if(account.offline){val saved=E2eeEditorQueue(account.device,client,binding.scopeId,"attachment",reference.getString("objectId")).load()?:error("E2EE_OFFLINE_CONTENT_UNAVAILABLE")
                        try{JSONObject().put("data",E2eeEnvelope.encode(saved.bytes)).put("size",saved.bytes.size).put("filename",saved.filename).put("mediaType",saved.mediaType)}finally{saved.bytes.fill(0)}}
                    else{val file=client.read("attachment",reference.getString("objectId"))?:error("E2EE_PRIVATE_FILE_UNAVAILABLE");try{current();JSONObject().put("data",E2eeEnvelope.encode(file.bytes)).put("size",file.bytes.size).put("filename",file.filename).put("mediaType",file.mediaType)}finally{file.bytes.fill(0)}}
                }
                "stage"->{E2eeKeys.exact(payload,setOf("edits","intentId"));records.product.stage(payload.getJSONArray("edits"),payload.getString("intentId"))}
                "flush"->{E2eeKeys.exact(payload,setOf("intentId"));records.flush(payload.getString("intentId"))}
                "requestLoad"->{E2eeKeys.exact(payload,setOf("id"));request(payload.getString("id")).load()?.let{JSONObject().put("value",it.value).put("serial",it.serial)}?:JSONObject.NULL}
                "requestSave"->{E2eeKeys.exact(payload,setOf("document","expected"));val document=validateRequest(payload.getJSONObject("document"));val expected=if(payload.isNull("expected"))null else E2eeCommands.integer(payload.get("expected"),1);request(document.getString("id")).save(document,expected).serial}
                else->error("E2EE_SHARED_REQUEST_INVALID")
            }.also{current()}}
            return runtime.execute(JSONObject().put("protocol",1).put("mode","shared-product-v1").put("binding",JSONObject().put("scopeId",binding.scopeId).put("kind",binding.scopeKind).put("resourceId",binding.resourceId))
                .put("actorId",account.ownerId).put("online",!account.offline).put("method",method).put("path",path).put("body",body).put("resumeId",resumeId?:JSONObject.NULL),::current,::call).also{current()}
        }
    }
    private fun bindings():List<JSONObject>{val rows=trust.list();current();val scopes=(0 until rows.length()).map{rows.getJSONObject(it)}
        if(!account.offline){val current=account.scopeSummaries();val known=(0 until current.length()).map{current.getJSONObject(it)}.filter{it.getString("kind")!="personal"}
            check(known.all{scope->scope.getString("state")=="active"&&scopes.any{it.get("scopeId")==scope.get("scopeId")&&it.get("kind")==scope.get("kind")&&it.get("resourceId")==scope.get("resourceId")}}){"E2EE_SHARED_FINGERPRINT_REQUIRED"}
            check(scopes.all{scope->known.any{it.get("scopeId")==scope.get("scopeId")}}){"E2EE_SHARED_SCOPE_REVALIDATION_REQUIRED"}}
        return scopes
    }
    private fun open(kind:String,resourceId:String):Live{
        val rows=trust.list();val candidate=(0 until rows.length()).map{rows.getJSONObject(it)}.singleOrNull{it.getString("kind")==kind&&it.getString("resourceId")==resourceId}?:error("E2EE_SHARED_FINGERPRINT_REQUIRED")
        val id=candidate.getString("scopeId");trust.open(id);current();return opened.getOrPut(id){Live(E2eeSharedRecords(context,account,id,kind,resourceId))}
    }
    private suspend fun aggregate(method:String,path:String,body:JSONObject):JSONObject{
        suspend fun call(name:String,payload:JSONObject):Any{current();return when(name){
            "bindings"->{E2eeKeys.exact(payload,emptySet());val result=JSONArray();for(row in bindings())result.put(JSONObject().put("scopeId",row.get("scopeId")).put("kind",row.get("kind")).put("resourceId",row.get("resourceId")));result}
            "scopedRequest"->{E2eeKeys.exact(payload,setOf("binding","method","path","body"));val binding=payload.getJSONObject("binding");E2eeKeys.exact(binding,setOf("scopeId","kind","resourceId"));val live=open(binding.getString("kind"),binding.getString("resourceId"));check(live.binding.scopeId==binding.getString("scopeId")){"E2EE_SCOPE_BINDING_MISMATCH"};live.execute(payload.getString("method"),payload.getString("path"),payload.getJSONObject("body"))}
            "personalRead"->{E2eeKeys.exact(payload,if(payload.has("seed"))setOf("seed")else emptySet());if(payload.has("seed"))aggregateSeed=validatePersonal(payload.getJSONObject("seed"));try{aggregatePersonal.read()}finally{aggregateSeed=null}}
            "readHistorySeed"->{E2eeKeys.exact(payload,emptySet());check(!account.offline){"E2EE_ONLINE_REQUIRED"};account.client.sharedReadHistory()}
            "personalSeed"->{E2eeKeys.exact(payload,emptySet());check(!account.offline){"E2EE_ONLINE_REQUIRED"};val original=account.client.readMigrationOriginal("local-snapshot","private-table:personal.local-work:shared_saved_views")
                try{check(original.revision==1L){"E2EE_PRIVATE_SEED_REQUIRED"};E2eeFileManifestJson.readPrivateDocument(original.bytes)}finally{original.bytes.fill(0)}}
            "personalWrite"->{E2eeKeys.exact(payload,setOf("document"));aggregatePersonal.write(validatePersonal(payload.getJSONObject("document")))}
            "personalFlush"->{E2eeKeys.exact(payload,emptySet());aggregatePersonal.flush()}
            else->error("E2EE_SHARED_REQUEST_INVALID")
        }.also{current()}}
        return aggregateRuntime.execute(JSONObject().put("protocol",1).put("mode","shared-aggregate-v1").put("actorId",account.ownerId).put("method",method).put("path",path).put("body",body),::current,::call)
    }
    private fun pendingLocked(projectId:String?=null):List<JSONObject>{
        val result=mutableListOf<JSONObject>()
        for(binding in bindings())if(projectId==null||binding.getString("kind")=="project"&&binding.getString("resourceId")==projectId){val live=open(binding.getString("kind"),binding.getString("resourceId"))
            for(key in account.device.vault.listLocal("draft",live.prefix)){val request=live.request(key.removePrefix(live.prefix)).load()?.value?:error("E2EE_SHARED_REQUEST_MISSING")
                if(!request.getBoolean("complete"))result+=JSONObject().put("scopeId",binding.get("scopeId")).put("scopeKind",binding.get("kind")).put("resourceId",binding.get("resourceId")).put("request",request)}}
        if(projectId==null)cachedPendingCount=result.size;return result
    }
    suspend fun pending(projectId:String?=null):List<JSONObject> = withContext(Dispatchers.IO){mutex.withLock{current();pendingLocked(projectId)}}
    suspend fun resume(id:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{current();val item=pendingLocked().singleOrNull{it.getJSONObject("request").getString("id")==id}?:error("E2EE_SHARED_REQUEST_MISSING")
        open(item.getString("scopeKind"),item.getString("resourceId")).execute("POST","",JSONObject(),id).also{if(!account.offline)cachedPendingCount=(cachedPendingCount-1).coerceAtLeast(0)}}}
    suspend fun flush():Int=withContext(Dispatchers.IO){mutex.withLock{current();if(account.offline)return@withLock 0;var count=0
        for(item in pendingLocked()){val request=item.getJSONObject("request");open(item.getString("scopeKind"),item.getString("resourceId")).execute("POST","",JSONObject(),request.getString("id"));current();count++;cachedPendingCount=(cachedPendingCount-1).coerceAtLeast(0)};count}}
    suspend fun request(method:String,path:String,body:JSONObject?):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        current();val uri=Uri.parse(path);val parts=uri.pathSegments;check(parts.firstOrNull()=="shared"){"E2EE_SHARED_REQUEST_INVALID"};val query=uri.encodedQuery?.let{"?$it"}?:"";val input=body?.let{JSONObject(it.toString())}?:JSONObject()
        if(parts.getOrNull(1) in setOf("views","overview","inbox","notifications")||parts.getOrNull(1)=="spaces"&&parts.getOrNull(3)=="mindmaps"||parts.size==6&&parts[1]=="projects"&&parts[3]=="tasks"&&parts[5] in setOf("read","watch")||method=="GET"&&(parts.size==2&&parts[1]=="tasks"||parts.size==4&&parts[1]=="spaces"&&parts[3]=="search"))return@withLock aggregate(method,path,input)
        if(method=="GET"&&parts.getOrNull(1)=="tasks"&&(parts.size==4&&parts[3]=="image"||parts.size==5&&parts[3]=="attachments")){
            for(binding in bindings())if(binding.getString("kind")=="project"){val live=open("project",binding.getString("resourceId"));val entities=live.records.index()
                if((0 until entities.length()).any{entities.getJSONObject(it).let{row->row.getString("entityId")=="task:${parts[2]}"&&row.getString("kind")=="task"&&!row.getBoolean("deleted")}})
                    return@withLock live.execute("GET","tasks/"+parts.drop(2).joinToString("/"),JSONObject())}
            error("E2EE_PRODUCT_ENTITY_MISSING")
        }
        if(parts.size>=3&&parts[1] in setOf("projects","spaces")){
            val kind=if(parts[1]=="projects")"project"else"space";val id=E2eeKeys.technical(parts[2])
            if(method=="GET"&&kind=="space"&&parts.size==4&&parts[3] in setOf("projects","archived-projects")){
                val projects=JSONArray();for(scope in bindings())if(scope.getString("kind")=="project"){val result=open("project",scope.getString("resourceId")).execute("GET","",JSONObject()).getJSONObject("project")
                    if(result.getString("spaceId")==id&&(!result.isNull("archivedAt"))==(parts[3]=="archived-projects"))projects.put(result)}
                return@withLock JSONObject().put("projects",projects)
            }
            return@withLock open(kind,id).execute(method,parts.drop(3).joinToString("/")+query,input)
        }
        if(method=="GET"&&parts.size==2&&parts[1]=="spaces"){val result=JSONArray();for(scope in bindings())if(scope.getString("kind")=="space")result.put(open("space",scope.getString("resourceId")).execute("GET","",JSONObject()).getJSONObject("space"));return@withLock JSONObject().put("spaces",result)}
        if(method=="GET"&&parts.size==2&&parts[1]=="task-lists"){val result=JSONArray();for(scope in bindings())if(scope.getString("kind")=="project"){
            val snapshot=open("project",scope.getString("resourceId")).execute("GET","",JSONObject());val project=snapshot.getJSONObject("project");val statuses=snapshot.getJSONArray("statuses");val tasks=snapshot.getJSONArray("tasks")
            for(at in 0 until statuses.length()){val row=JSONObject(statuses.getJSONObject(at).toString());val selected=(0 until tasks.length()).map{tasks.getJSONObject(it)}.filter{it.get("statusId")==row.get("id")}
                result.put(row.put("projectId",scope.get("resourceId")).put("projectTitle",project.get("title")).put("spaceId",project.get("spaceId")).put("role",project.get("role")).put("taskCount",selected.size).put("openCount",selected.count{it.isNull("completedAt")}))}}
            return@withLock JSONObject().put("lists",result)}
        error("E2EE_SHARED_OPERATION_REVIEW_REQUIRED")
    }}
    override fun toString()="E2eeNativeSharedLive([redacted])"
}
