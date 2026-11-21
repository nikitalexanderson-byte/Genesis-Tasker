package ru.genesis.calendar.auth

import org.json.JSONObject
import ru.genesis.calendar.security.*
import java.time.Instant
import java.nio.ByteBuffer

/** Actual native local inventory is captured by AuthController before signed
 * source IO. Common schema validation keeps original row JSON intact. */
internal class E2eeNativeRelationalSource(private val ownerId:String,private val scopeId:String,private val kind:String,
    private val resourceId:String,override val id:String,private val tables:List<String>,private val capture:suspend()->JSONObject,
    private val assertCurrent:()->Unit,private val transport:E2eeLegacyReadTransport,private val reconciler:E2eePersonalSourceReconciler):E2eePrivatePathAdapter {
    private val target=JSONObject().put("ownerId",ownerId).put("scopeId",scopeId).put("kind",kind).put("resourceId",resourceId).put("pathId",id)
    private val maximum=64*1024*1024
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId);E2eeKeys.technical(resourceId);check(id.startsWith("$kind.")){"E2EE_SCOPE_BINDING_MISMATCH"}}
    override suspend fun captureLocal():ByteArray{
        assertCurrent();val local=capture();assertCurrent()
        val bytes=JSONObject().put("protocol",1).put("target",JSONObject(target.toString())).put("capturedAt",Instant.now().toString()).put("local",local).toString().toByteArray(Charsets.UTF_8)
        try{assertCurrent();check(bytes.size in 1..maximum){"E2EE_SNAPSHOT_TOO_LARGE"};return bytes}catch(error:Throwable){bytes.fill(0);throw error}
    }
    private fun snapshot(bytes:ByteArray):JSONObject{
        check(bytes.size in 1..maximum){"E2EE_RELATIONAL_SOURCE_INVALID"};val value=JSONObject(Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(bytes)).toString())
        E2eeKeys.exact(value,setOf("protocol","target","capturedAt","local"));check(value.getInt("protocol")==1&&E2eeCommands.canonical(value.getJSONObject("target")).contentEquals(E2eeCommands.canonical(target))){"E2EE_SCOPE_BINDING_MISMATCH"};return value
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation{
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"};check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(previous.size<=32&&local.size+previous.sumOf{it.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val current=snapshot(local);val ancestors=previous.map(::snapshot)
        val remote=E2eePrivatePathFragments.collect(lease,kind,resourceId,id,tables,assertCurrent,transport::legacyPrivatePathFragment)
        val result=reconciler.reconcile(current,ancestors,lease,remote,assertCurrent){_,_->error("E2EE_KEY_BRIDGE_FORBIDDEN")}
        try{assertCurrent();val domain=if(kind=="personal")"local-snapshot"else if(id in setOf("project.mindmaps","space.mindmaps"))"mindmap"else "shared-project"
            for(row in result.content+result.localContent)check(row.domain==domain&&(row.objectId.startsWith("private-table:$id:")||row.objectId=="private-path:$id:index-v1"||row.objectId.startsWith("private-work:$id:"))
                ||id=="project.files"&&row.domain=="attachment"&&row.objectId.matches(Regex("private-file:[a-f0-9-]{36}"))){"E2EE_KEY_BRIDGE_FORBIDDEN"}
            return result
        }catch(error:Throwable){(result.content+result.localContent).forEach{it.bytes.fill(0)};throw error}
    }
    override fun toString()="E2eeNativeRelationalSource([redacted])"
}
