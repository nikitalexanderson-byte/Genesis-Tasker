package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.time.Instant
import java.util.UUID

/** Same durable input/review/preparation contract as web. Only typed normal
 * repositories can publish/read back initial values; no capsule/device grant
 * follows from inherited routing. The caller runs this foreground work on IO. */
internal class E2eePrivateProjectCreation(context:Context,private val account:E2eeProductAccount,private val directory:suspend(String)->JSONObject,private val guard:()->Unit={}){
    private val context=context.applicationContext
    private val mutex=Mutex()
    private var operationJob:Job?=null
    companion object {
        private const val PREFIX="shared-project-create:"
        private val phases=listOf("draft","previewed","reviewed","prepared","migrated","values","complete")
        private val locationFields=listOf("spaceId","parentId","categoryId","boardStatusId","kind","layout")
        private val uuid=Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
        private fun invalid():Nothing=error("E2EE_PRIVATE_RESOURCE_CREATE_INVALID")
        private fun trim(value:String)=value.trim(' ','\t','\n','\r','\u000B','\u0000')
        private fun strings(value:JSONArray)=(0 until value.length()).map{value.get(it) as? String?:invalid()}
        fun location(value:JSONObject)=E2eeProjectCreationContract.location(JSONObject().apply{for(key in locationFields)put(key,value.get(key))})
        fun input(value:JSONObject):JSONObject {
            E2eeKeys.exact(value,(locationFields+listOf("title","description","tags","labelIds","statusTitles")).toSet());location(value)
            val title=value.get("title") as? String?:invalid();val description=value.get("description") as? String?:invalid()
            if(trim(title).isEmpty()||title.codePointCount(0,title.length)>160||description.codePointCount(0,description.length)>5000)invalid()
            val tags=strings(value.getJSONArray("tags"));val labels=strings(value.getJSONArray("labelIds"))
            if(tags.size>30||tags.any{it.codePointCount(0,it.length)>80}||labels.size>50||labels.any{!uuid.matches(it)})invalid()
            val titles=value.getJSONObject("statusTitles");E2eeKeys.exact(titles,setOf("open","progress","done","chaos"))
            for(key in titles.keys()){val text=titles.get(key) as? String?:invalid();if(trim(text).isEmpty()||text.codePointCount(0,text.length)>80)invalid()}
            return JSONObject(value.toString())
        }
        fun topologyHash(value:JSONObject):String {val bytes=E2eeCommands.canonical(value);return try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}}
        private fun review(value:JSONObject,topology:JSONObject){
            E2eeKeys.exact(value,setOf("topologyHash","reviewedAt"));E2eeEnvelope.decode(value.getString("topologyHash"),32)
            if(value.get("topologyHash")!=topologyHash(topology))invalid();Instant.parse(value.getString("reviewedAt"))
        }
        fun preparation(value:JSONObject,intent:JSONObject):JSONObject {
            E2eeKeys.exact(value,setOf("intentId","kind","resourceId","scopeId","spaceId","parentId","categoryId","boardStatusId","projectType","layout","statuses","reviewedMembers","topologyHash","state","bootstrapHash","directoryRevision","checkpointHash","createdAt"))
            val topology=intent.getJSONObject("topology")
            if(listOf("intentId","resourceId","scopeId").any{value.get(it)!=intent.get(it)}||value.get("kind")!="project"||value.get("state")!="preparing"||E2eeCommands.integer(value.get("directoryRevision"),1)!=1L
                ||listOf("spaceId","parentId","categoryId","boardStatusId","layout").any{value.get(it)!=topology.get(it)}||value.get("projectType")!=topology.get("kind")
                ||!E2eeProductJson.same(value.get("reviewedMembers"),topology.get("reviewedMembers"))||value.get("topologyHash")!=topologyHash(topology))invalid()
            Instant.parse(value.getString("createdAt"));E2eeEnvelope.decode(value.getString("bootstrapHash"),32);E2eeEnvelope.decode(value.getString("checkpointHash"),32)
            if(value.get("bootstrapHash")!=value.get("checkpointHash"))invalid()
            val rows=value.getJSONArray("statuses");if(rows.length()!=5)invalid();val ids=mutableSetOf<String>();val done=listOf(0L,1L,0L,0L,1L)
            for(at in 0 until rows.length()){val row=rows.getJSONObject(at);E2eeKeys.exact(row,setOf("id","isDone","isChaos"));val id=E2eeKeys.technical(row.getString("id"))
                if(!ids.add(id)||E2eeCommands.integer(row.get("isDone"))!=done[at]||E2eeCommands.integer(row.get("isChaos"))!=(if(at<2)1L else 0L))invalid()
                if(at<2){if(id!=(if(at==0)"chaos-open:"else"chaos-done:")+intent.getString("resourceId"))invalid()}else if(!uuid.matches(id))invalid()
            }
            return JSONObject(value.toString())
        }
    }
    private fun current(){operationJob?.ensureActive();guard();account.requireOpen()}
    private suspend fun <T> run(work:suspend()->T):T=mutex.withLock{
        operationJob=currentCoroutineContext().job
        try{current();work()}finally{operationJob=null}
    }
    private fun document(id:String):E2eeDeviceDocument {E2eeKeys.technical(id);return E2eeDeviceDocument(account.device,PREFIX+id,{value->
        E2eeKeys.exact(value,setOf("format","ownerId","intentId","scopeId","resourceId","kind","input","createdAt","topology","review","started","preparation","phase","history"))
        if(value.get("format")!="genesis-private-project-create-v1"||value.get("ownerId")!=account.ownerId||value.get("intentId")!=id||value.get("kind")!="project"
            ||value.get("started") !is Boolean||value.get("phase") !in phases||!uuid.matches(value.getString("resourceId")))invalid()
        E2eeKeys.technical(value.getString("scopeId"));E2eeKeys.technical(value.getString("resourceId"));Instant.parse(value.getString("createdAt"));input(value.getJSONObject("input"))
        val history=value.getJSONArray("history");if(history.length()>64)invalid()
        for(at in 0 until history.length()){val row=history.getJSONObject(at);E2eeKeys.exact(row,setOf("topology","review"));val topology=E2eeProjectCreationContract.topology(row.getJSONObject("topology"),account.ownerId);if(!row.isNull("review"))review(row.getJSONObject("review"),topology)}
        val phase=phases.indexOf(value.getString("phase"));val started=value.getBoolean("started")
        if(value.isNull("topology")){if(phase!=0||!value.isNull("review")||started||!value.isNull("preparation"))invalid()}
        else {val topology=E2eeProjectCreationContract.topology(value.getJSONObject("topology"),account.ownerId)
            if(!E2eeProductJson.same(location(value.getJSONObject("input")),location(topology))||phase<1||value.isNull("review")&&(phase>=2||started)||!value.isNull("review")&&phase<2)invalid()
            if(!value.isNull("review"))review(value.getJSONObject("review"),topology);if(!value.isNull("preparation"))preparation(value.getJSONObject("preparation"),value)
        }
        if(started&&value.isNull("review")||!value.isNull("preparation")&&!started||phase>=3&&value.isNull("preparation"))invalid()
        JSONObject(value.toString())
    },::current)}
    suspend fun create(value:JSONObject):String {val held=input(value);return run{
        val id=UUID.randomUUID().toString();val document=document(id);val intent=JSONObject().put("format","genesis-private-project-create-v1").put("ownerId",account.ownerId).put("intentId",id)
            .put("scopeId","project:${UUID.randomUUID()}").put("resourceId",UUID.randomUUID().toString()).put("kind","project").put("input",held).put("createdAt",Instant.now().toString())
            .put("topology",JSONObject.NULL).put("review",JSONObject.NULL).put("started",false).put("preparation",JSONObject.NULL).put("phase","draft").put("history",JSONArray())
        document.save(intent,null);current();check(E2eeProductJson.same(document.load()?.value,intent)){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"};id
    }}
    fun inspect(id:String):JSONObject {current();val value=document(id).load()?.value?:error("E2EE_PRIVATE_RESOURCE_CREATE_REQUIRED");current();return JSONObject(value.toString())}
    fun pending():List<JSONObject>{current();val ids=account.device.vault.listLocal("draft",PREFIX);current();return ids.map{inspect(it.removePrefix(PREFIX))}.filter{it.getString("phase")!="complete"}}
    private fun proposal(intent:JSONObject):JSONObject{
        val selected=E2eeProjectCreationSelection.capture(context,account,location(intent.getJSONObject("input")),::current);current()
        account.client.refresh();current();return account.client.readProjectCreationPreview(intent.getString("resourceId"),selected).also{current()}
    }
    suspend fun preview(id:String):JSONObject=run{
        val intent=inspect(id);check(!intent.getBoolean("started")&&intent.isNull("preparation")){"E2EE_RESOURCE_CREATION_LOCKED"}
        val topology=proposal(intent);val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT");current()
        check(!before.value.getBoolean("started")&&listOf("input","topology","review").all{E2eeProductJson.same(before.value.get(it),intent.get(it))}){"E2EE_LOCAL_CONFLICT"}
        if(E2eeProductJson.same(before.value.get("topology"),topology))return@run before.value
        val history=JSONArray(before.value.getJSONArray("history").toString());if(!before.value.isNull("topology"))history.put(JSONObject().put("topology",before.value.get("topology")).put("review",before.value.get("review")))
        check(history.length()<=64){"E2EE_SOURCE_HISTORY_CAPACITY"}
        document.save(JSONObject(before.value.toString()).put("topology",topology).put("review",JSONObject.NULL).put("phase","previewed").put("history",history),before.serial);current();inspect(id)
    }
    suspend fun confirmReview(id:String,expectedHash:String):JSONObject=run{
        E2eeEnvelope.decode(expectedHash,32);val intent=inspect(id)
        check(!intent.isNull("topology")&&!intent.getBoolean("started")&&topologyHash(intent.getJSONObject("topology"))==expectedHash){"E2EE_PROJECT_TOPOLOGY_CHANGED"}
        check(E2eeProductJson.same(proposal(intent),intent.get("topology"))){"E2EE_PROJECT_TOPOLOGY_CHANGED"}
        val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT");current()
        check(!before.value.getBoolean("started")&&listOf("input","topology").all{E2eeProductJson.same(before.value.get(it),intent.get(it))}){"E2EE_LOCAL_CONFLICT"}
        if(before.value.isNull("review"))document.save(JSONObject(before.value.toString()).put("review",JSONObject().put("topologyHash",expectedHash).put("reviewedAt",Instant.now().toString())).put("phase","reviewed"),before.serial)
        current();inspect(id)
    }
    suspend fun prepare(id:String,secret:ByteArray,savedKit:JSONObject):Pair<JSONObject,E2eeDirectory.Verified>{
        val held=secret.copyOf();val kit=try{JSONObject(savedKit.toString())}catch(error:Throwable){held.fill(0);throw error}
        try{return run{
            check(!account.offline){"E2EE_ONLINE_REQUIRED"};var intent=inspect(id);check(!intent.isNull("topology")&&!intent.isNull("review")){"E2EE_PROJECT_RECIPIENT_REVIEW_REQUIRED"}
            if(!intent.getBoolean("started")){
                check(E2eeProductJson.same(proposal(intent),intent.get("topology"))){"E2EE_PROJECT_TOPOLOGY_CHANGED"}
                val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT");current();check(E2eeProductJson.same(before.value,intent)){"E2EE_LOCAL_CONFLICT"}
                document.save(JSONObject(before.value.toString()).put("started",true),before.serial);intent=inspect(id)
            }
            val fixed=JSONObject(intent.toString());val target=JSONObject().put("ownerId",account.ownerId).put("scopeId",fixed.get("scopeId")).put("kind","project").put("resourceId",fixed.get("resourceId"))
            var resolved:JSONObject?=null;val transport=object:E2eeScopeSetupTransport{
                override suspend fun directory(scopeId:String):JSONObject=this@E2eePrivateProjectCreation.directory(scopeId)
                override suspend fun bootstrap(packet:JSONObject):JSONObject{
                    resolved?.let{return JSONObject(it.toString())}
                    current();val hash=E2eeCommands.hash(packet.getJSONObject("command"));val result=account.client.executeService("resource-create-prepare",JSONObject().put("bootstrap",packet).put("topology",fixed.get("topology")),id);current()
                    val receipt=preparation(result,fixed);check(receipt.get("bootstrapHash")==hash){"E2EE_INVALID_RECEIPT"}
                    val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT");current()
                    check(before.value.getBoolean("started")&&listOf("input","topology","review").all{E2eeProductJson.same(before.value.get(it),fixed.get(it))}){"E2EE_LOCAL_CONFLICT"}
                    if(!before.value.isNull("preparation"))check(E2eeProductJson.same(before.value.get("preparation"),receipt)){"E2EE_IDEMPOTENCY_CONFLICT"}
                    else document.save(JSONObject(before.value.toString()).put("preparation",receipt),before.serial);current();resolved=JSONObject(result.toString());return result
                }
            }
            val setup=E2eeScopeSetup(account.device,target,transport,::current);val packet=setup.prepare(held,kit,0);current()
            if(fixed.isNull("preparation"))transport.bootstrap(packet)else check(fixed.getJSONObject("preparation").get("bootstrapHash")==E2eeCommands.hash(packet.getJSONObject("command"))){"E2EE_INVALID_RECEIPT"}
            current();val verified=setup.submit();current();val document=document(id);val before=document.load()?:error("E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED")
            if(before.value.isNull("preparation")||verified.kind!="project"||verified.resourceId!=fixed.getString("resourceId")||verified.ownerId!=account.ownerId||verified.state !in setOf("preparing","uploading","verified","active"))invalid()
            if(phases.indexOf(before.value.getString("phase"))<phases.indexOf("prepared"))document.save(JSONObject(before.value.toString()).put("phase","prepared"),before.serial)
            current();inspect(id) to verified
        }}finally{held.fill(0)}
    }
    suspend fun markMigrated(id:String):JSONObject=run{
        val intent=inspect(id);check(phases.indexOf(intent.getString("phase"))>=phases.indexOf("prepared")&&!intent.isNull("preparation")){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"}
        if(phases.indexOf(intent.getString("phase"))>=phases.indexOf("migrated"))return@run intent
        val records=E2eeSharedRecords(context,account,intent.getString("scopeId"),"project",intent.getString("resourceId"));val index=records.index();current()
        val required=mutableListOf("project:"+intent.getString("resourceId"));val statuses=intent.getJSONObject("preparation").getJSONArray("statuses");for(at in 0 until statuses.length())required+="status:"+statuses.getJSONObject(at).getString("id")
        for(key in required)check((0 until index.length()).any{val row=index.getJSONObject(it);row.get("entityId")==key&&!row.getBoolean("deleted")}){"E2EE_PRIVATE_SEED_REQUIRED"}
        val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT");check(E2eeProductJson.same(before.value,intent)){"E2EE_LOCAL_CONFLICT"}
        document.save(JSONObject(before.value.toString()).put("phase","migrated"),before.serial);current();inspect(id)
    }
    private fun initialBodies(intent:JSONObject):Pair<E2eeSharedRecords,List<JSONObject>>{
        val receipt=intent.getJSONObject("preparation");val topology=intent.getJSONObject("topology");val input=intent.getJSONObject("input");val id=intent.getString("resourceId");val scope=intent.getString("scopeId")
        val records=E2eeSharedRecords(context,account,scope,"project",id);val roots=records.sourceTable("shared_projects");current()
        check(roots.length()==1&&roots.getJSONObject(0).get("id")==id){"E2EE_PRIVATE_SEED_REQUIRED"};val root=roots.getJSONObject(0)
        check(E2eeCommands.integer(root.get("is_inbox"))==0L&&root.isNull("archived_at")&&root.get("created_by")==intent.get("ownerId")){"E2EE_PROJECT_TOPOLOGY_CHANGED"}
        for((column,key)in listOf("space_id" to "spaceId","parent_id" to "parentId","category_id" to "categoryId","board_status_id" to "boardStatusId","kind" to "kind","layout" to "layout"))
            check(root.get(column)==input.get(key)){"E2EE_PROJECT_TOPOLOGY_CHANGED"}
        E2eeSharedTrust(account).open(topology.getJSONObject("spaceAnchor").getString("scopeId"));current()
        val space=E2eeSharedRecords(context,account,topology.getJSONObject("spaceAnchor").getString("scopeId"),"space",input.getString("spaceId"));val labels=strings(input.getJSONArray("labelIds")).distinct().sorted()
        for(labelId in labels){val label=space.get("label",labelId);current();check(!label.getBoolean("deleted")&&label.getJSONObject("body").get("table")=="shared_space_labels"
            &&label.getJSONObject("body").getJSONObject("record").get("space_id")==input.get("spaceId")){"E2EE_PRODUCT_PARENT_INVALID"}}
        val tags=strings(input.getJSONArray("tags")).map{trim(it).trimStart('#')}.filter{it.isNotEmpty()}.distinct()
        fun body(kind:String,table:String,row:JSONObject,related:JSONObject=JSONObject())=JSONObject().put("format","genesis-shared-record-v1").put("kind",kind).put("scopeId",scope).put("scopeKind","project").put("resourceId",id)
            .put("table",table).put("record",row).put("related",related).put("execution","live")
        val project=JSONObject(root.toString()).put("title",trim(input.getString("title"))).put("description",input.get("description")).put("tags_json",JSONArray(tags).toString()).put("revision",2).put("updated_at",receipt.get("createdAt"))
        val related=JSONObject().put("shared_project_labels",JSONArray().apply{labels.forEach{put(JSONObject().put("project_id",id).put("label_id",it))}})
        val bodies=mutableListOf(body("project","shared_projects",project,related));val source=records.sourceTable("shared_project_statuses");current()
        val titles=input.getJSONObject("statusTitles");val titleKeys=listOf("chaos","chaos","open","progress","done");val positions=listOf(-2L,-1L,0L,1L,2L);val statuses=receipt.getJSONArray("statuses")
        for(at in 0 until statuses.length()){val status=statuses.getJSONObject(at);val row=(0 until source.length()).map{source.getJSONObject(it)}.singleOrNull{it.get("id")==status.get("id")}?:error("E2EE_PRIVATE_SEED_REQUIRED")
            val position=row.get("position") as? Number?:invalid()
            check(row.get("project_id")==id&&E2eeCommands.integer(row.get("is_done"))==E2eeCommands.integer(status.get("isDone"))&&E2eeCommands.integer(row.get("is_chaos"))==E2eeCommands.integer(status.get("isChaos"))
                &&position.toDouble()==positions[at].toDouble()){"E2EE_PRIVATE_SEED_REQUIRED"}
            bodies+=body("status","shared_project_statuses",JSONObject(row.toString()).put("title",trim(titles.getString(titleKeys[at]))).put("revision",2))
        }
        return records to bodies
    }
    suspend fun applyInitialValues(id:String):JSONObject=run{
        val intent=inspect(id);check(phases.indexOf(intent.getString("phase"))>=phases.indexOf("migrated")){"E2EE_MIGRATION_UNVERIFIED"};if(intent.get("phase")=="complete")return@run intent
        val(records,bodies)=initialBodies(intent);val request="resource-create-values:$id";val domain=records.domain;val edits=JSONArray()
        for(body in bodies){val kind=body.getString("kind");edits.put(JSONObject().put("action","update").put("entityId",domain.recordKey(kind,body.getJSONObject("record"))).put("kind",kind).put("expectedRevision",1)
            .put("parentId",domain.parent(body)).put("metadata",domain.metadata(body)).put("body",body))}
        records.product.stage(edits,request);current();records.flush(request);current()
        for(body in bodies){val value=records.get(body.getString("kind"),body.getJSONObject("record").getString("id"));current()
            check(!value.getBoolean("deleted")&&value.getLong("revision")==2L&&E2eeProductJson.same(value.getJSONObject("body"),body)){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"}}
        val document=document(id);val before=document.load()?:error("E2EE_LOCAL_CONFLICT");check(E2eeProductJson.same(before.value,intent)){"E2EE_LOCAL_CONFLICT"}
        if(before.value.get("phase")!="values")document.save(JSONObject(before.value.toString()).put("phase","values"),before.serial);current();inspect(id)
    }
    suspend fun complete(id:String):JSONObject=run{
        val document=document(id);val before=document.load()?:error("E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED")
        check(before.value.get("phase") in setOf("values","complete")){"E2EE_PRIVATE_RESOURCE_CREATE_UNVERIFIED"}
        if(before.value.get("phase")!="complete")document.save(JSONObject(before.value.toString()).put("phase","complete"),before.serial);current();inspect(id)
    }
    override fun toString()="E2eePrivateProjectCreation([redacted])"
}
