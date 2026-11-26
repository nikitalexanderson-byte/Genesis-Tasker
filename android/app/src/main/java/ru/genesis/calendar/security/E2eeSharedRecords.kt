package ru.genesis.calendar.security

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Native normal-operation editor port using the same fixed domain catalogue,
 * immutable versions and independently authorized business commits as web. */
internal class E2eeSharedRecords(context:Context,private val account:E2eeProductAccount,scopeId:String,scopeKind:String,resourceId:String){
    private val paths=E2eePrivatePaths.load(context);private val sources=E2eePrivatePathCatalogue(context)
    val domain=E2eeSharedRecordDomain(context,scopeId,scopeKind,resourceId)
    private val scope=account.sharedScope(scopeId,scopeKind,resourceId)
    val product=E2eeSharedProduct(account.device,scope.client,scopeId,account::requireOpen){kind,body,header->domain.validate(kind,body,header)}
    @Synchronized fun index():JSONArray{account.requireOpen();return product.index(account.offline)}
    @Synchronized fun versions():JSONArray{account.requireOpen();return product.versions(account.offline)}
    @Synchronized fun read(entity:JSONObject):JSONObject{account.requireOpen();return product.read(entity,account.offline)}
    @Synchronized fun get(kind:String,id:String):JSONObject{val key=domain.entityId(kind,id);val rows=index();val entity=(0 until rows.length()).map{rows.getJSONObject(it)}.singleOrNull{it.getString("kind")==kind&&it.getString("entityId")==key}?:error("E2EE_PRODUCT_ENTITY_MISSING");return read(entity)}
    @Synchronized fun list(kind:String,includeDeleted:Boolean=false):JSONArray{val rows=index();val result=JSONArray();for(at in 0 until rows.length()){val entity=rows.getJSONObject(at);if(entity.getString("kind")==kind&&(includeDeleted||!entity.getBoolean("deleted")))result.put(read(entity))};return result}
    @Synchronized fun sourceTable(table:String):JSONArray{
        account.requireOpen();val candidates=paths.required(domain.scopeKind).filter{table in sources.tables(domain.scopeKind,it.id)};check(candidates.size==1){"E2EE_SOURCE_PATH_FORBIDDEN"};val path=candidates.single()
        val contentDomain=path.domains.firstOrNull{it!="attachment"}?:error("E2EE_SOURCE_PATH_FORBIDDEN")
        return E2eePrivateTableReader.read({id->val opened=scope.client.readMigrationOriginal(contentDomain,id);account.requireOpen();E2eePrivateTableReader.Opened(opened.bytes,1)},"private-table:${path.id}:$table",path.id,table,{account.requireOpen()})
    }
    @Synchronized fun stage(body:JSONObject,expectedRevision:Long,action:String="update"):String{account.requireOpen();val kind=body.getString("kind");val value=domain.validate(kind,body);check(value.getString("execution")=="live"){"E2EE_HISTORY_NOT_EXECUTABLE"}
        return product.stage(JSONArray().put(JSONObject().put("action",action).put("entityId",domain.recordKey(kind,value.getJSONObject("record"))).put("kind",kind).put("expectedRevision",expectedRevision).put("parentId",domain.parent(value)).put("metadata",domain.metadata(value)).put("body",value)))}
    @Synchronized fun flush(intentId:String):JSONObject{account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"};return product.flush(intentId)}
    @Synchronized fun collectBootstrap():JSONArray{
        account.requireOpen();check(!account.offline&&scope.directory.ownerId==account.ownerId){"E2EE_OWNER_REQUIRED"};val tables=mutableMapOf<String,JSONArray>()
        fun read(domain:String,id:String):JSONObject{val row=scope.client.read(domain,id)?:error("E2EE_PRIVATE_SEED_REQUIRED");account.requireOpen();try{check(row.revision==1L){"E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID"};return E2eeFileManifestJson.readPrivateDocument(row.bytes)}finally{row.bytes.fill(0)}}
        for(path in paths.required(domain.scopeKind)){val names=sources.tables(domain.scopeKind,path.id);if(names.isEmpty())continue;val contentDomain=path.domains.firstOrNull{it!="attachment"}?:"attachment"
            val index=read(contentDomain,"private-path:${path.id}:index-v1");E2eeKeys.exact(index,setOf("format","pathId","tables","localHistory","execution"));val declared=index.getJSONArray("tables")
            check(index.getString("format")=="genesis-private-path-index-v1"&&index.getString("pathId")==path.id&&index.getString("execution")=="content-only"&&declared.length()==names.size){"E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID"}
            for(table in names){val reference=(0 until declared.length()).map{declared.getJSONObject(it)}.singleOrNull{it.getString("table")==table}?:error("E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID");val id="private-table:${path.id}:$table";check(reference.getString("objectId")==id){"E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID"}
                val rows=E2eePrivateTableReader.read({objectId->val row=scope.client.read(contentDomain,objectId)?:error("E2EE_PRIVATE_SEED_REQUIRED");account.requireOpen();E2eePrivateTableReader.Opened(row.bytes,row.revision)},id,path.id,table,{account.requireOpen()},reference.getInt("count"))
                val old=tables[table];check(old==null||E2eeProductJson.same(old,rows)){"E2EE_SHARED_BOOTSTRAP_SOURCE_DIVERGED"};tables[table]=rows
            }
        }
        val trash=tables["shared_trash"]?:JSONArray();val deleted=(0 until trash.length()).map{trash.getJSONObject(it).let{row->"${row.getString("kind")}:${row.getString("object_id")}"}}.toSet();val items=mutableMapOf<String,JSONObject>()
        for(kind in domain.kinds()){if(domain.historyOnly(kind)||kind=="automation-run")continue;for(table in domain.roots(kind)){val rows=tables[table]?:continue
            for(at in 0 until rows.length()){val row=JSONObject(rows.getJSONObject(at).toString());if(kind=="series-instance"){val hash=java.security.MessageDigest.getInstance("SHA-256").digest(row.getString("occurrence_key").toByteArray(Charsets.UTF_8));row.put("occurrence_key",E2eeEnvelope.encode(hash))};val related=JSONObject();for(name in domain.related(kind)){val source=tables[name]?:error("E2EE_PRIVATE_SEED_REQUIRED");val key=if(kind=="comment")"comment_id"else if(kind=="project")"project_id"else"task_id";val values=JSONArray();for(index in 0 until source.length()){val value=source.getJSONObject(index);if(value.get(key)==row.get("id"))values.put(value)};related.put(name,values)}
                val body=domain.validate(kind,JSONObject().put("format","genesis-shared-record-v1").put("kind",kind).put("scopeId",domain.scopeId).put("scopeKind",domain.scopeKind).put("resourceId",domain.resourceId).put("table",table).put("record",row).put("related",related).put("execution","live"));val id=domain.recordKey(kind,row)
                check(id !in items){"E2EE_SHARED_BOOTSTRAP_DUPLICATE"};val author=E2eeKeys.technical((row.opt("created_by")?.takeUnless{it===JSONObject.NULL}?:row.opt("author_id")?.takeUnless{it===JSONObject.NULL}?:row.opt("owner_id")?.takeUnless{it===JSONObject.NULL}?:scope.directory.ownerId).toString())
                val edit=JSONObject().put("action",if(id in deleted)"delete"else"create").put("entityId",id).put("kind",kind).put("expectedRevision",0).put("parentId",domain.parent(body)).put("metadata",domain.metadata(body)).put("body",if(id in deleted)JSONObject.NULL else body)
                items[id]=JSONObject().put("edit",edit).put("authorId",author)
            }
        }}
        check(domain.entityId(domain.scopeKind,domain.resourceId) in items){"E2EE_SHARED_BOOTSTRAP_SOURCE_INVALID"};val result=JSONArray();val completed=mutableSetOf<String>();val remaining=items.toSortedMap()
        while(remaining.isNotEmpty()){var progress=false;for((id,value)in remaining.toMap()){val edit=value.getJSONObject("edit");val dependencies=mutableListOf<String>();if(!edit.isNull("parentId"))dependencies+=edit.getString("parentId");val links=edit.getJSONObject("metadata").optJSONArray("dependsOnIds")?:JSONArray();for(at in 0 until links.length())dependencies+=links.getString(at)
                check(dependencies.all{it in items}){"E2EE_SHARED_BOOTSTRAP_REFERENCE_INVALID"};if(dependencies.all{it in completed}){result.put(value);completed+=id;remaining.remove(id);progress=true}}
            check(progress){"E2EE_SHARED_BOOTSTRAP_CYCLE_REVIEW_REQUIRED"}}
        return result
    }
    override fun toString()="E2eeSharedRecords([redacted])"
}
