package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.data.TaskRecord
import ru.genesis.calendar.security.*
import java.time.Instant
import java.util.Base64

/** Exact Room rows, including deleted tasks and unresolved operations. Never log. */
internal class E2eeTasksRows(val tasks:List<TaskRecord>,val outbox:List<OutboxRecord>,val documents:List<DocumentRecord>,
    val generation:Long,val pendingGeneration:Long?,val mounted:JSONObject?){override fun toString()="E2eeTasksRows([redacted])"}

/** LocalCipher/legacy keys remain native. The bundled shared task validator sees
 * only authenticated content; no provider, queue drain or acknowledgement port. */
internal class E2eeNativeTasksSource(private val ownerId:String,private val scopeId:String,
    private val captureRows:suspend ()->E2eeTasksRows,private val decryptTask:(TaskRecord)->String,
    private val decryptDocument:(DocumentRecord)->String,private val assertCurrent:()->Unit,
    private val legacyTasks:suspend (E2eeMigrationSourceContext)->JSONObject,private val reconciler:E2eePersonalSourceReconciler):E2eePrivatePathAdapter {
    override val id="personal.tasks"
    private val account=CloudAccountSnapshot.scopeFor(ownerId)
    private val maximum=16*1024*1024
    private val workspaceOutbox=setOf("workspace-structure","habits","trackers")
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun bytes(value:JSONObject)=value.toString().toByteArray(Charsets.UTF_8)
    private suspend fun <T> parseSafely(operation:suspend ()->T):T=try{operation()}
        catch(_:JSONException){error("E2EE_TASK_SOURCE_INVALID")}
        catch(_:java.nio.charset.CharacterCodingException){error("E2EE_TASK_SOURCE_INVALID")}
        catch(_:java.time.DateTimeException){error("E2EE_TASK_SOURCE_INVALID")}
    override suspend fun captureLocal():ByteArray=parseSafely {
        assertCurrent();val captured=captureRows();assertCurrent()
        check(captured.tasks.size<=10000&&captured.outbox.size<=10003&&captured.documents.size<=1){"E2EE_JOURNAL_LIMIT"}
        val tasks=JSONArray();var size=0L
        for(row in captured.tasks.sortedBy{it.id}){
            check(row.scope==account&&row.revision>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
            val plain=decryptTask(row);assertCurrent()
            val copy=JSONObject().put("id",row.id).put("revision",row.revision).put("encrypted",row.encrypted).put("plain",plain).put("done",row.done).put("deleted",row.deleted)
            size+=bytes(copy).size;check(size<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"};tasks.put(copy)
        }
        val documents=JSONArray(captured.documents.map{row->
            check(row.scope==account&&row.kind=="aurora-account-key"&&row.revision>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
            JSONObject().put("kind",row.kind).put("revision",row.revision).put("encrypted",row.encrypted).put("plain",decryptDocument(row).also{assertCurrent()})
        })
        val outbox=JSONArray(captured.outbox.sortedBy{it.entityId}.map{row->
            check(row.scope==account&&row.revision>=0&&row.operationId.isNotBlank()){ "E2EE_SCOPE_BINDING_MISMATCH" }
            JSONObject().put("entityId",row.entityId).put("revision",row.revision).put("operationId",row.operationId).put("state",row.state)
        })
        val snapshot=JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",Instant.now().toString())
            .put("generation",captured.generation).put("pendingGeneration",captured.pendingGeneration?:JSONObject.NULL)
            .put("tasks",tasks).put("documents",documents).put("outbox",outbox).put("mounted",captured.mounted?:JSONObject.NULL)
        val result=bytes(snapshot);assertCurrent();if(result.size>maximum){result.fill(0);error("E2EE_SNAPSHOT_TOO_LARGE")};result
    }
    private fun snapshot(raw:ByteArray):JSONObject {
        check(raw.size in 1..maximum){"E2EE_TASK_SOURCE_INVALID"}
        val value=JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","capturedAt","generation","pendingGeneration","tasks","documents","outbox","mounted"))
        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        Instant.parse(value.getString("capturedAt"));E2eeCommands.integer(value.get("generation"));check(value.isNull("pendingGeneration")){"E2EE_TASK_GENERATION_REVIEW_REQUIRED"}
        val rows=value.getJSONArray("tasks");check(rows.length()<=10000){"E2EE_JOURNAL_LIMIT"};val ids=mutableSetOf<String>()
        val revisions=mutableMapOf<String,Long>()
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);E2eeKeys.exact(row,setOf("id","revision","encrypted","plain","done","deleted"))
            val id=row.getString("id");check(id.isNotBlank()&&id.length<=512&&ids.add(id)){"E2EE_TASK_SOURCE_INVALID"}
            revisions[id]=E2eeCommands.integer(row.get("revision"));row.getString("encrypted");val plain=JSONObject(row.getString("plain"))
            check(plain.get("id")==id&&row.get("done") is Boolean&&row.get("deleted") is Boolean
                &&(!plain.has("done")||plain.get("done")==row.get("done"))){"E2EE_TASK_SOURCE_INVALID"}
        }
        val outbox=value.getJSONArray("outbox");check(outbox.length()<=10003){"E2EE_JOURNAL_LIMIT"};val pending=mutableSetOf<String>()
        for(index in 0 until outbox.length()){
            val row=outbox.getJSONObject(index);E2eeKeys.exact(row,setOf("entityId","revision","operationId","state"));val id=row.getString("entityId")
            check(pending.add(id)&&row.getString("operationId").isNotBlank()&&row.getString("state").isNotBlank()){ "E2EE_TASK_SOURCE_INVALID" }
            val revision=E2eeCommands.integer(row.get("revision"))
            check(id in workspaceOutbox||revisions[id]==revision){"E2EE_TASK_QUEUE_REVIEW_REQUIRED"}
        }
        val documents=value.getJSONArray("documents");check(documents.length()<=1){"E2EE_JOURNAL_LIMIT"}
        for(index in 0 until documents.length()){
            val row=documents.getJSONObject(index);E2eeKeys.exact(row,setOf("kind","revision","encrypted","plain"));check(row.get("kind")=="aurora-account-key"){"E2EE_TASK_FORMAT_UNSUPPORTED"}
            E2eeCommands.integer(row.get("revision"));row.getString("encrypted");row.getString("plain")
        }
        if(!value.isNull("mounted"))E2eeKeys.exact(value.getJSONObject("mounted"),setOf("tasks","editors"))
        return value
    }
    private fun webSnapshot(value:JSONObject):JSONObject {
        val rows=value.getJSONArray("tasks");val tasks=JSONArray();val rawTasks=mutableListOf<String>();val deleted=JSONArray();val byId=mutableMapOf<String,JSONObject>()
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);val id=row.getString("id");val raw=row.getString("plain");val plain=JSONObject(raw);tasks.put(plain);rawTasks+=raw;byId[id]=row
            if(row.getBoolean("deleted"))deleted.put(id)
        }
        val pending=JSONArray();val outbox=value.getJSONArray("outbox")
        for(index in 0 until outbox.length()){
            val entry=outbox.getJSONObject(index);val id=entry.getString("entityId");val row=byId[id]?:continue
            val encoded=java.net.URLEncoder.encode(id,"UTF-8").replace("+","%20").replace("%21","!").replace("%27","'").replace("%28","(").replace("%29",")").replace("%7E","~")
            pending.put(JSONObject().put("key","task:$id").put("path","/tasks/$encoded").put("method",if(row.getBoolean("deleted"))"DELETE" else "PUT").put("body",row.getString("plain")))
        }
        val entries=JSONArray()
        fun entry(key:String,raw:String?){entries.put(JSONObject().put("key",key).put("value",raw?:JSONObject.NULL))}
        // Shared backupJson must see the original text. JSONObject serialization
        // alone would hide duplicate keys/trailing bytes in a legacy plaintext.
        entry("genesis-calendar-v2:$ownerId","{\"tasks\":["+rawTasks.joinToString(",")+"]}")
        entry("genesis-pending-mutations-v2:$ownerId",pending.toString());entry("genesis-pending-mutations-v2-deleted:$ownerId",deleted.toString())
        entry("genesis-workspace-device-key-v2:$ownerId",null);entry("genesis-data-generation-v1:$ownerId",value.getLong("generation").toString())
        entry("genesis-calendar-v1",null);entry("genesis-pending-mutations-v2",null)
        val mounted=value.optJSONObject("mounted")
        val memory=JSONObject().put("ownerId",ownerId).put("legacyKey","").put("generation",value.getLong("generation")).put("reconciliationRequired",false)
            .put("tasks",mounted?.getJSONArray("tasks")?:tasks).put("editors",mounted?.getJSONArray("editors")?:JSONArray())
        return JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",value.getString("capturedAt")).put("entries",entries).put("memory",memory)
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation=parseSafely {
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"};check(previous.size<=32){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val captured=snapshot(local);val ancestors=previous.map(::snapshot)
        fun stable(value:JSONObject)=JSONObject(value.toString()).apply{remove("capturedAt")}
        for(old in ancestors)check(workspaceConflictJson(stable(old))==workspaceConflictJson(stable(captured))){"E2EE_TASK_HISTORY_REVIEW_REQUIRED"}
        val remote=legacyTasks(lease);assertCurrent();check(bytes(remote).size<=maximum){"E2EE_SOURCE_TOO_LARGE"}
        check(remote.get("ownerId")==ownerId&&remote.get("scopeId")==scopeId&&remote.get("migrationId")==lease.migrationId
            &&E2eeCommands.integer(remote.get("fence"),1)==lease.fence&&remote.get("sourceHash")==lease.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(remote.getLong("legacyGeneration")==captured.getLong("generation")&&lease.generation>remote.getLong("legacyGeneration")){"E2EE_TASK_GENERATION_REVIEW_REQUIRED"}
        val keys=mutableListOf<ByteArray>()
        fun key(encoded:String){
            check(encoded.length==44){"E2EE_LEGACY_KEY_UNAVAILABLE"};val raw=try{WorkspaceCipher.decodeKey(encoded)}catch(_:IllegalArgumentException){error("E2EE_LEGACY_KEY_UNAVAILABLE")}
            if(Base64.getEncoder().encodeToString(raw)!=encoded){raw.fill(0);error("E2EE_LEGACY_KEY_UNAVAILABLE")};keys+=raw
        }
        try{
            val docs=captured.getJSONArray("documents");for(index in 0 until docs.length())key(docs.getJSONObject(index).getString("plain"))
            val old=remote.getJSONObject("legacyKey");E2eeKeys.exact(old,setOf("keyMode","key"))
            if(old.get("keyMode")=="account")key(old.getString("key"))else check(old.get("keyMode") in setOf("client","empty")&&old.isNull("key")){"E2EE_TASK_SOURCE_INVALID"}
            val safeRemote=JSONObject(remote.toString());safeRemote.getJSONObject("legacyKey").put("key",JSONObject.NULL)
            val recovered=remote.getJSONArray("recovered");val originals=mutableMapOf<String,JSONObject>()
            for(index in 0 until recovered.length()){
                val row=recovered.getJSONObject(index);val id=row.getString("id");check(id.matches(Regex("restored-[a-f0-9]{32}"))&&originals.put("recovered-task:v1:$id",row)==null){"E2EE_TASK_SOURCE_INVALID"}
            }
            val result=reconciler.reconcile(webSnapshot(captured),ancestors.map(::webSnapshot),lease,safeRemote,assertCurrent){envelope,purpose->
                assertCurrent();E2eeKeys.exact(envelope,setOf("iv","ciphertext"));val row=originals[purpose]?:error("E2EE_TASK_SOURCE_INVALID")
                check(envelope.get("iv")==row.get("iv")&&envelope.get("ciphertext")==row.get("ciphertext")&&envelope.getString("ciphertext").length<=maximum){"E2EE_TASK_SOURCE_INVALID"}
                var opened:ByteArray?=null
                for(raw in keys)try{opened=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(envelope.getString("ciphertext"),envelope.getString("iv")),raw,"genesis-mindmap-v1:$ownerId:$purpose".toByteArray());break}catch(_:java.security.GeneralSecurityException){/* Captured old epochs only. */}
                val plain=opened?:error(if(keys.isEmpty())"E2EE_LEGACY_KEY_UNAVAILABLE" else "E2EE_LEGACY_TASK_CORRUPT")
                try{assertCurrent();Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(plain)).toString()}finally{plain.fill(0)}
            }
            val output=result.content.toMutableList()
            try{
                assertCurrent();val taskIds=mutableSetOf<String>();val tasks=captured.getJSONArray("tasks");for(index in 0 until tasks.length())taskIds+=tasks.getJSONObject(index).getString("id")
                val pending=JSONArray();val operations=captured.getJSONArray("outbox");for(index in 0 until operations.length()){val row=operations.getJSONObject(index);if(row.getString("entityId") in taskIds)pending.put(row)}
                val history=JSONObject().put("protocol",1).put("ownerId",ownerId).put("tasks",tasks).put("retainedOperations",pending).put("mounted",captured.get("mounted")).put("execution","history-only")
                val bytes=bytes(history);if(bytes.size>maximum){bytes.fill(0);error("E2EE_SOURCE_TOO_LARGE")};output+=E2eeMigrationContent("workspace","personal-task-native-history-v1",bytes)
                check((output+result.localContent).sumOf{it.bytes.size.toLong()}<=maximum){"E2EE_SOURCE_TOO_LARGE"};assertCurrent();E2eePathReconciliation(result.complete,output,result.localContent)
            }catch(error:Throwable){(output+result.localContent).forEach{it.bytes.fill(0)};throw error}
        }finally{keys.forEach{it.fill(0)}}
    }
    override fun toString()="E2eeNativeTasksSource([redacted])"
}
