package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest
import ru.genesis.calendar.auth.E2eeHttpResponseJson

internal abstract class E2eeLegacyReadAdapter:E2eeLegacyReadTransport{
    abstract suspend fun read(action:String,context:E2eeMigrationSourceContext,page:JSONObject?=null):JSONObject
    override suspend fun legacyWorkspace(context:E2eeMigrationSourceContext)=read("legacy-workspace",context)
    override suspend fun legacyAurora(context:E2eeMigrationSourceContext)=read("legacy-aurora",context)
    override suspend fun legacyStoicheion(context:E2eeMigrationSourceContext)=read("legacy-stoicheion",context)
    override suspend fun legacyAdvice(context:E2eeMigrationSourceContext)=read("legacy-advice",context)
    override suspend fun legacyTasks(context:E2eeMigrationSourceContext)=read("legacy-tasks",context)
    override suspend fun legacyDiary(context:E2eeMigrationSourceContext)=read("legacy-diary",context)
    override suspend fun legacyMindmaps(context:E2eeMigrationSourceContext)=read("legacy-mindmaps",context)
    override suspend fun legacyMindmapsPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=read("legacy-mindmaps",context,JSONObject().put("table",table).put("offset",offset))
    override suspend fun legacyPhysisPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=read("legacy-physis",context,JSONObject().put("table",table).put("offset",offset))
    override suspend fun legacyRemindersPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=read("legacy-reminders",context,JSONObject().put("table",table).put("offset",offset))
    override suspend fun legacyArchiveFragment(context:E2eeMigrationSourceContext,table:String,offset:Long,byteOffset:Long)=read("legacy-archives",context,JSONObject().put("table",table).put("offset",offset).put("byteOffset",byteOffset))
    override suspend fun legacySharedMindmapsPage(context:E2eeMigrationSourceContext,table:String,offset:Long)=read("legacy-shared-mindmaps",context,JSONObject().put("table",table).put("offset",offset))
    override suspend fun legacyPrivatePathFragment(context:E2eeMigrationSourceContext,pathId:String,table:String,offset:Long,byteOffset:Long)=read("legacy-private-path",context,JSONObject().put("pathId",pathId).put("table",table).put("offset",offset).put("byteOffset",byteOffset))
}
internal class E2eeMigrationSourceReadRouter:E2eeLegacyReadAdapter(){
    @Volatile private var active:E2eeLegacyReadTransport?=null
    suspend fun <T> use(port:E2eeLegacyReadTransport,operation:suspend()->T):T{
        synchronized(this){check(active==null){"E2EE_SOURCE_READ_PHASE_BUSY"};active=port}
        try{return operation()}finally{synchronized(this){active=null}}
    }
    override suspend fun read(action:String,context:E2eeMigrationSourceContext,page:JSONObject?):JSONObject{
        val port=active?:error("E2EE_SOURCE_READ_PHASE_REQUIRED")
        val result=when(action){
            "legacy-workspace"->port.legacyWorkspace(context);"legacy-aurora"->port.legacyAurora(context);"legacy-stoicheion"->port.legacyStoicheion(context)
            "legacy-advice"->port.legacyAdvice(context);"legacy-tasks"->port.legacyTasks(context);"legacy-diary"->port.legacyDiary(context)
            "legacy-mindmaps"->if(page==null)port.legacyMindmaps(context)else port.legacyMindmapsPage(context,page.getString("table"),page.getLong("offset"))
            "legacy-physis"->port.legacyPhysisPage(context,requireNotNull(page).getString("table"),page.getLong("offset"))
            "legacy-reminders"->port.legacyRemindersPage(context,requireNotNull(page).getString("table"),page.getLong("offset"))
            "legacy-archives"->port.legacyArchiveFragment(context,requireNotNull(page).getString("table"),page.getLong("offset"),page.getLong("byteOffset"))
            "legacy-shared-mindmaps"->port.legacySharedMindmapsPage(context,requireNotNull(page).getString("table"),page.getLong("offset"))
            "legacy-private-path"->port.legacyPrivatePathFragment(context,requireNotNull(page).getString("pathId"),page.getString("table"),page.getLong("offset"),page.getLong("byteOffset"))
            else->error("E2EE_SOURCE_PATH_FORBIDDEN")}
        check(active===port){"E2EE_SOURCE_READ_PHASE_REQUIRED"};return result
    }
}

/** Captured requests remain inert. Only exact signed-packet matches may supply
 * a feature source, and complete original EOF is authenticated on every read. */
internal class E2eeOriginalSourceReplay(private val session:E2eeContentPlanningSession,private val assertCurrent:()->Unit):E2eeLegacyReadAdapter(),AutoCloseable{
    private val consumed=mutableSetOf<String>();private var closed=false
    private fun current(){assertCurrent();session.assertCurrent();check(!closed){"E2EE_SOURCE_REPLAY_CLOSED"}}
    override suspend fun read(action:String,context:E2eeMigrationSourceContext,page:JSONObject?):JSONObject{
        current();val original=session.originals.asReversed().firstOrNull{row->
            val command=row.packet?.optJSONObject("command");val payload=command?.optJSONObject("payload");val fields=page?:JSONObject()
            command!=null&&payload!=null&&command.opt("action")==action&&command.opt("ownerId")==context.ownerId&&command.opt("scopeId")==context.scopeId
                &&payload.opt("migrationId")==context.migrationId&&payload.opt("sourceHash")==context.sourceHash
                &&fields.keys().asSequence().all{payload.opt(it)==fields.get(it)}&&listOf("pathId","table","offset","byteOffset").all{payload.has(it)==fields.has(it)}
        }?:error("E2EE_CAPTURED_SOURCE_REQUIRED")
        val packet=requireNotNull(original.packet);val bytes=E2eeCommands.canonical(packet)
        try{check(E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))==original.registration.binding.packetHash){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}}finally{bytes.fill(0)}
        val reference=requireNotNull(original.completion);var response:JSONObject?=null
        session.withOriginal(reference.id){stream->response=E2eeHttpResponseJson.read(stream,"/e2ee/v1/read",200,"application/json",-1,::current)}
        current();consumed+=reference.id;val value=requireNotNull(response){"E2EE_CAPTURED_SOURCE_CONTEXT"};val binding=original.registration.binding
        check(value.opt("protocol")==1&&value.opt("ownerId")==context.ownerId&&value.opt("scopeId")==context.scopeId&&value.opt("migrationId")==context.migrationId&&value.opt("sourceHash")==context.sourceHash
            &&E2eeCommands.integer(value.get("fence"),1)==binding.fence&&binding.fence<=context.fence&&value.opt("checkpointHash")==binding.checkpointHash&&E2eeCommands.integer(value.get("directoryRevision"),1)==binding.directoryRevision){"E2EE_CAPTURED_SOURCE_CONTEXT"}
        return value.put("fence",context.fence)
    }
    fun drain(){current();val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
        try{for(row in session.originals){val reference=requireNotNull(row.completion);if(reference.id in consumed)continue
            session.withOriginal(reference.id){stream->while(true){current();val count=stream.read(buffer);if(count<0)break;check(count>0){"E2EE_INVALID_SOURCE_STREAM"};buffer.fill(0,0,count)}};current();consumed+=reference.id
        }}finally{buffer.fill(0)}
    }
    override fun close(){closed=true;consumed.clear()}
    override fun toString()="E2eeOriginalSourceReplay([redacted])"
}
