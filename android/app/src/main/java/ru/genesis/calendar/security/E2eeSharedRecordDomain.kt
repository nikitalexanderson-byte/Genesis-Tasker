package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import ru.genesis.calendar.data.MindmapDocument

/** Fixed relational domain schema shared with web. Exact column/resource
 * checks precede presentation; old operation rows have no executable meaning. */
internal class E2eeSharedRecordDomain(context:Context,val scopeId:String,val scopeKind:String,val resourceId:String){
    private val source=E2eePrivatePathCatalogue(context)
    private val paths=E2eePrivatePaths.load(context)
    private val contract=context.assets.open("shared-record-bodies-v1.json").use{E2eeFileManifestJson.readPrivateDocument(it.readBytes())}
    private fun strings(rows:JSONArray)=(0 until rows.length()).map{rows.getString(it)}
    init{E2eeKeys.technical(scopeId);E2eeKeys.technical(resourceId);check(scopeKind in setOf("project","space")&&contract.getInt("protocol")==1){"E2EE_SCOPE_BINDING_MISMATCH"}}
    fun roots(kind:String)=strings(contract.getJSONObject("roots").getJSONArray(kind))
    fun kinds()=contract.getJSONObject("roots").keys().asSequence().toList()
    fun related(kind:String)=strings(contract.getJSONObject("related").getJSONArray(kind))
    fun historyOnly(kind:String)=kind in strings(contract.getJSONArray("historyOnlyKinds"))
    fun entityId(kind:String,id:Any)=E2eeKeys.technical("$kind:$id")
    fun recordKey(kind:String,row:JSONObject)=entityId(kind,when{kind=="series-instance"->"${row.get("series_id")}:${row.get("occurrence_key")}";kind=="custom-field-value"->"${row.get("task_id")}:${row.get("field_id")}";kind=="trash"->"${row.get("kind")}:${row.get("object_id")}";kind=="file"->if(row.has("id"))"attachment:${row.get("id")}"else"image:${row.get("task_id")}";else->row.opt("id")?:row.opt("project_id")?:row.get("task_id")})
    private fun parsed(raw:Any):Any{check(raw is String){"E2EE_SHARED_DOMAIN_INVALID"};return E2eeFileManifestJson.readPrivateValue(raw.toByteArray(Charsets.UTF_8))}
    private fun row(table:String,value:JSONObject):JSONObject{
        val file=table in setOf("shared_task_attachments","shared_task_images");val columns=source.columns(table).filter{!file||it !in setOf("ciphertext","filename_ciphertext")}.toMutableSet();if(file)columns+="file";E2eeKeys.exact(value,columns)
        var chaos=false
        if(table=="shared_project_statuses"){
            val hidden=E2eeCommands.integer(value.get("is_chaos"));val done=E2eeCommands.integer(value.get("is_done"))
            check(hidden<=1&&done<=1){"E2EE_SHARED_DOMAIN_INVALID"};chaos=hidden==1L
            if(chaos){val position=value.get("position") as? Number?:error("E2EE_SHARED_DOMAIN_INVALID")
                check(scopeKind=="project"&&value.get("id")==(if(done==1L)"chaos-done:"else"chaos-open:")+resourceId&&position.toDouble()==(if(done==1L)-1.0 else -2.0)){"E2EE_SHARED_DOMAIN_INVALID"}}
        }
        for(name in value.keys()){val item=value.get(name)
            if(name=="file"&&file){val ref=item as? JSONObject?:error("E2EE_SHARED_DOMAIN_INVALID");E2eeKeys.exact(ref,setOf("objectId","size","filename","mediaType"));val id=E2eeKeys.technical(ref.getString("objectId"));check((id.startsWith("private-file:")||id.startsWith("shared-file:"))&&E2eeCommands.integer(ref.get("size"),1)<=E2eeFiles.MAX_FILE_BYTES&&ref.getString("filename").length<=512&&ref.getString("mediaType").length<=128){"E2EE_SHARED_DOMAIN_INVALID"};continue}
            check(item===JSONObject.NULL||item is String||item is Number){"E2EE_SHARED_DOMAIN_INVALID"};if(item is Number)check(item.toDouble().isFinite()){"E2EE_SHARED_DOMAIN_INVALID"};if(item is String)check(item.length<=16*1024*1024){"E2EE_SHARED_DOMAIN_INVALID"}
            if(item!==JSONObject.NULL&&name in setOf("revision","position","byte_size")&&!(name=="position"&&chaos))E2eeCommands.integer(item)
            if(item!==JSONObject.NULL&&(name.endsWith("_at")||name in setOf("start_date","end_date","due_date","day_key","period_key"))){check(item is String){"E2EE_SHARED_DOMAIN_INVALID"};if(name.endsWith("_at"))Instant.parse(item)else check(LocalDate.parse(item).toString()==item){"E2EE_SHARED_DOMAIN_INVALID"}}
            if(item!==JSONObject.NULL&&name in setOf("start_time","end_time"))check(item is String&&item.matches(Regex("(?:[01][0-9]|2[0-3]):[0-5][0-9]"))){"E2EE_SHARED_DOMAIN_INVALID"}
            if(item is String&&(name.endsWith("_json")||name in setOf("payload","content")))parsed(item)
        }
        if(value.has("project_id"))check(if(scopeKind=="project")value.get("project_id")==resourceId else value.isNull("project_id")){"E2EE_SCOPE_BINDING_MISMATCH"}
        if(value.has("space_id")&&scopeKind=="space")check(value.get("space_id")==resourceId){"E2EE_SCOPE_BINDING_MISMATCH"}
        if(table in setOf("shared_projects","shared_spaces"))check(value.get("id")==resourceId&&(table=="shared_projects")== (scopeKind=="project")){"E2EE_SCOPE_BINDING_MISMATCH"}
        if(table=="shared_automation_runs"){val payload=parsed(value.get("payload_json")) as? JSONObject?:error("E2EE_SHARED_DOMAIN_INVALID");E2eeKeys.technical(payload.getString("executedBy"));check(value.getString("state") in setOf("pending","succeeded","skipped","cancelled","failed")){"E2EE_SHARED_DOMAIN_INVALID"};E2eeCommands.integer(value.get("rule_revision"),1);E2eeCommands.integer(value.get("attempts"));E2eeCommands.integer(value.get("retry_count"))}
        if(table=="shared_series_instances"){check(value.getString("state") in setOf("created","skipped")&&LocalDate.parse(value.getString("original_date")).toString()==value.getString("original_date")){"E2EE_SHARED_DOMAIN_INVALID"};E2eeCommands.integer(value.get("ordinal"),1)}
        if(table=="shared_mindmaps"){val map=MindmapDocument.parse(parsed(value.get("content")) as JSONObject);check(map.id==value.getString("id")&&map.projectId==if(scopeKind=="project")resourceId else null){"E2EE_SCOPE_BINDING_MISMATCH"}}
        if(table=="shared_tasks"){
            check(value.getString("title").isNotBlank()&&value.getString("title").length<=2000&&value.getString("description").length<=100000&&value.getString("entry_type") in setOf("task","meeting","birthday","event")&&E2eeCommands.integer(value.get("priority"))<=5){"E2EE_SHARED_DOMAIN_INVALID"}
            val tags=parsed(value.get("tags_json")) as? JSONArray?:error("E2EE_SHARED_DOMAIN_INVALID");check(tags.length()<=100&&strings(tags).all{it.length<=240}){"E2EE_SHARED_DOMAIN_INVALID"}
            val lists=parsed(value.get("checklists_json")) as? JSONArray?:error("E2EE_SHARED_DOMAIN_INVALID");check(lists.length()<=100);val ids=mutableSetOf<String>()
            for(at in 0 until lists.length()){val list=lists.getJSONObject(at);check(ids.add(list.getString("id"))&&list.getString("title").length<=2000);val items=list.getJSONArray("items");check(items.length()<=1000);val seen=mutableSetOf<String>();for(index in 0 until items.length()){val item=items.getJSONObject(index);check(seen.add(item.getString("id"))&&item.getString("title").length<=2000&&item.get("done") is Boolean){"E2EE_SHARED_DOMAIN_INVALID"}}}
        }
        if(table in setOf("shared_comments","shared_project_comments"))check(value.getString("body").isNotBlank()&&value.getString("body").length<=100000){"E2EE_SHARED_DOMAIN_INVALID"}
        if(table=="shared_project_statuses")check(value.getInt("is_done") in 0..1&&value.getString("title").isNotBlank()&&value.getString("title").length<=2000){"E2EE_SHARED_DOMAIN_INVALID"}
        if(table=="shared_member_categories"){check(value.getString("title").isNotBlank()&&value.getString("title").length<=2000){"E2EE_SHARED_DOMAIN_INVALID"};val permissions=parsed(value.get("permissions_json")) as? JSONObject?:error("E2EE_SHARED_DOMAIN_INVALID");check(permissions.length()<=64&&permissions.keys().asSequence().all{permissions.get(it) is Boolean}){"E2EE_SHARED_DOMAIN_INVALID"}}
        if(table=="shared_custom_fields"){check(value.getString("type") in setOf("text","number","date","select","multi","checkbox","url"));val definition=parsed(value.get("definition_json")) as? JSONObject?:error("E2EE_SHARED_DOMAIN_INVALID");val options=definition.getJSONArray("options");check(options.length()<=200);val seen=mutableSetOf<String>();for(at in 0 until options.length()){val option=options.getJSONObject(at);check(seen.add(option.getString("id"))&&option.getString("title").length<=2000&&option.get("archived") is Boolean){"E2EE_SHARED_DOMAIN_INVALID"}}}
        if(table=="shared_sprints"){check(value.getString("state") in setOf("planning","active","completed")&&(value.isNull("estimate_unit")||value.getString("estimate_unit") in setOf("points","hours"))&&value.getString("start_date")<=value.getString("end_date")){"E2EE_SHARED_DOMAIN_INVALID"};parsed(value.get("content_json")) as? JSONObject?:error("E2EE_SHARED_DOMAIN_INVALID")}
        return JSONObject(value.toString())
    }
    fun metadata(body:JSONObject):JSONObject{
        val kind=body.getString("kind");val row=body.getJSONObject("record");val related=body.getJSONObject("related")
        if(kind=="automation"&&!row.isNull("owner_id"))return E2eeProductContract.metadata(kind,JSONObject().put("protocol",2).put("ownerId",row.get("owner_id")))
        if(kind=="automation-run"){val payload=parsed(row.get("payload_json")) as JSONObject;return E2eeProductContract.metadata(kind,JSONObject().put("protocol",2).put("ruleId",row.get("rule_id")).put("ruleRevision",row.get("rule_revision")).put("executorId",payload.get("executedBy")).put("triggerKey",row.get("trigger_key")))}
        if(kind=="series-instance"){val key=row.getString("occurrence_key").split('.');check(key.size==3);return E2eeProductContract.metadata(kind,JSONObject().put("protocol",2).put("seriesId",row.get("series_id")).put("seriesRevision",key[1].toLong()).put("executorId",String(E2eeEnvelope.decode(key[0],1,512),Charsets.UTF_8)).put("occurrenceKey",key[2]))}
        if(kind=="project")return E2eeProductContract.metadata(kind,JSONObject().put("protocol",2).put("spaceId",row.get("space_id"))
            .put("parentProjectId",row.get("parent_id")).put("projectCategoryId",row.get("category_id")).put("boardStatusId",row.get("board_status_id"))
            .put("projectType",row.get("kind")).put("layout",row.get("layout")).put("isInbox",row.getInt("is_inbox")==1).put("archived",!row.isNull("archived_at")))
        if(kind=="task"){
            val present=mutableSetOf<String>();val fields=mapOf("title" to "title","description" to "description","assigneeId" to "assignee_id","dueDate" to "due_date","startDate" to "start_date","startTime" to "start_time","endTime" to "end_time","categoryId" to "category_id")
            for((name,column)in fields)if(!row.isNull(column)&&row.get(column)!="")present+=name
            fun values(table:String,field:String,kind:String?=null):List<String>{val rows=related.optJSONArray(table)?:JSONArray();return(0 until rows.length()).map{val value=rows.getJSONObject(it).getString(field);if(kind==null)value else entityId(kind,value)}.distinct().sorted()}
            val custom=related.optJSONArray("shared_custom_field_values")?:JSONArray();for(at in 0 until custom.length()){val item=custom.getJSONObject(at);if(parsed(item.get("value_json"))!==JSONObject.NULL)present+=item.getString("field_id")}
            return E2eeProductContract.metadata(kind,JSONObject().put("protocol",1).put("statusId",if(row.isNull("status_id"))JSONObject.NULL else entityId("status",row.get("status_id"))).put("completed",!row.isNull("completed_at"))
                .put("approverIds",JSONArray(values("shared_task_approvals","user_id"))).put("dependsOnIds",JSONArray(values("shared_task_dependencies","predecessor_id","task"))).put("presentFields",JSONArray(present.sorted())))
        }
        if(kind=="workflow"){val definition=parsed(row.get("definition_json")) as? JSONObject?:error("E2EE_SHARED_DOMAIN_INVALID");val statuses=definition.getJSONArray("statuses");val transitions=definition.getJSONArray("transitions")
            for(at in 0 until statuses.length()){val status=statuses.getJSONObject(at);status.put("statusId",entityId("status",status.get("statusId")))}
            for(at in 0 until transitions.length()){val edge=transitions.getJSONObject(at);if(!edge.isNull("fromStatusId"))edge.put("fromStatusId",entityId("status",edge.get("fromStatusId")));edge.put("toStatusId",entityId("status",edge.get("toStatusId")))}
            return E2eeProductContract.metadata(kind,JSONObject().put("protocol",1).put("enabled",row.getInt("enabled")==1).put("statuses",statuses).put("transitions",transitions))}
        return JSONObject().put("protocol",1)
    }
    fun parent(body:JSONObject):Any{val kind=body.getString("kind");val row=body.getJSONObject("record")
        if(kind in setOf("project","space"))return JSONObject.NULL
        if(kind=="task")return if(row.isNull("parent_task_id"))entityId("project",resourceId)else entityId("task",row.get("parent_task_id"))
        if(kind=="automation-run")return entityId("automation",row.get("rule_id"))
        if(kind=="series-instance")return entityId("series",row.get("series_id"))
        if(row.has("task_id"))return entityId("task",row.get("task_id"));return entityId(scopeKind,resourceId)
    }
    fun validate(kind:String,input:Any,header:JSONObject?=null):JSONObject{
        val value=input as? JSONObject?:error("E2EE_SHARED_DOMAIN_INVALID");E2eeKeys.exact(value,setOf("format","kind","scopeId","scopeKind","resourceId","table","record","related","execution"))
        check(value.getString("format")=="genesis-shared-record-v1"&&value.getString("kind")==kind&&value.getString("scopeId")==scopeId&&value.getString("scopeKind")==scopeKind&&value.getString("resourceId")==resourceId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(value.getString("execution") in setOf("live","history-only")&&(!historyOnly(kind)||value.getString("execution")=="history-only")){"E2EE_HISTORY_NOT_EXECUTABLE"}
        val table=value.getString("table");check(table in roots(kind)&&paths.required(scopeKind).any{table in source.tables(scopeKind,it.id)}){"E2EE_SHARED_DOMAIN_INVALID"}
        val root=row(table,value.getJSONObject("record"));val children=value.getJSONObject("related");check(children.keys().asSequence().all{it in related(kind)}){"E2EE_SHARED_DOMAIN_INVALID"}
        for(name in children.keys()){val rows=children.getJSONArray(name);check(rows.length()<=10000);for(at in 0 until rows.length()){val child=row(name,rows.getJSONObject(at));val key=if(kind=="comment")"comment_id"else if(kind=="project")"project_id"else"task_id";check(child.get(key)==root.get("id")){"E2EE_SCOPE_BINDING_MISMATCH"}}}
        if(kind=="task"){
            val attachments=children.optJSONArray("shared_task_attachments")?:JSONArray();val images=children.optJSONArray("shared_task_images")?:JSONArray();check(attachments.length()<=5&&images.length()<=1){"E2EE_SHARED_DOMAIN_INVALID"};val ids=mutableSetOf<String>()
            for(at in 0 until attachments.length())check(ids.add(attachments.getJSONObject(at).getString("id"))){"E2EE_SHARED_DOMAIN_INVALID"}
            for(rows in listOf(attachments,images))for(at in 0 until rows.length()){val item=rows.getJSONObject(at);val file=item.getJSONObject("file");check(file.getLong("size")==item.getLong("byte_size")&&file.getString("mediaType")==item.getString("mime_type")){"E2EE_SHARED_DOMAIN_INVALID"}}
        }
        if(header!=null){
            val saved=E2eeProductContract.metadata(kind,header.getJSONObject("metadata"));val oldProject=kind in setOf("project","automation")&&saved.getInt("protocol")==1
            check(header.getString("scopeId")==scopeId&&header.getString("kind")==kind&&header.getString("entityId")==recordKey(kind,root)&&header.get("parentId")==parent(value)&&
                (oldProject||E2eeProductJson.same(saved,metadata(value)))){"E2EE_SHARED_HEADER_MISMATCH"}
        }
        return JSONObject(value.toString())
    }
}
