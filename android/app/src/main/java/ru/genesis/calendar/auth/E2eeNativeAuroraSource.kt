package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.security.*
import java.time.Instant
import java.util.Base64

internal class E2eeAuroraRows(val documents:List<DocumentRecord>,val outbox:List<OutboxRecord>,val generation:Long,
    val pendingGeneration:Long?,val mounted:JSONObject?){override fun toString()="E2eeAuroraRows([redacted])"}

/** Uses the same bundled domain validator/merger as web. This port receives only
 * captured envelopes/documents, never old keys, device private keys or new roots. */
internal interface E2eePersonalSourceReconciler {
    suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,
        assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation
}

internal typealias E2eeAuroraReconciler = E2eePersonalSourceReconciler

/** Actual Room source; only the existing LocalCipher and captured legacy account
 * keys may open historical data. The migration coordinator supplies its durable
 * writer fence and stores captureLocal() under the new root before any IO. */
internal class E2eeNativeAuroraSource(private val ownerId:String,private val scopeId:String,
    private val captureRows:suspend ()->E2eeAuroraRows,private val decrypt:(DocumentRecord)->String,
    private val assertCurrent:()->Unit,private val legacyAurora:suspend (E2eeMigrationSourceContext)->JSONObject,
    private val reconciler:E2eeAuroraReconciler):E2eePrivatePathAdapter {
    override val id="personal.aurora"
    private val account=CloudAccountSnapshot.scopeFor(ownerId)
    private val maximum=16*1024*1024
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun bytes(value:JSONObject)=value.toString().toByteArray(Charsets.UTF_8)
    private suspend fun <T> parseSafely(operation:suspend ()->T):T=try{operation()}
        catch(_:JSONException){error("E2EE_AURORA_SOURCE_INVALID")}
        catch(_:java.nio.charset.CharacterCodingException){error("E2EE_AURORA_SOURCE_INVALID")}
        catch(_:java.time.DateTimeException){error("E2EE_AURORA_SOURCE_INVALID")}
    override suspend fun captureLocal():ByteArray=parseSafely {
        assertCurrent();val captured=captureRows();assertCurrent()
        check(captured.documents.size<=1026&&captured.documents.map{it.kind}.toSet().size==captured.documents.size&&captured.outbox.size<=1024){"E2EE_JOURNAL_LIMIT"}
        val documents=JSONArray();var size=0L
        for(row in captured.documents.sortedBy{it.kind}){
            check(row.scope==account&&row.kind.startsWith("aurora-")&&row.revision>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
            val plain=decrypt(row);assertCurrent()
            val copy=JSONObject().put("kind",row.kind).put("revision",row.revision).put("encrypted",row.encrypted).put("plain",plain)
            size+=bytes(copy).size;check(size<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"};documents.put(copy)
        }
        val outbox=JSONArray(captured.outbox.map{row->
            check(row.scope==account&&row.entityId.startsWith("aurora")&&row.revision>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
            JSONObject().put("entityId",row.entityId).put("operationId",row.operationId).put("revision",row.revision).put("state",row.state)
        })
        val value=JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",Instant.now().toString())
            .put("generation",captured.generation).put("pendingGeneration",captured.pendingGeneration?:JSONObject.NULL)
            .put("documents",documents).put("outbox",outbox).put("mounted",captured.mounted?:JSONObject.NULL)
        val result=bytes(value);assertCurrent();if(result.size>maximum){result.fill(0);error("E2EE_SNAPSHOT_TOO_LARGE")};result
    }
    private fun snapshot(raw:ByteArray):JSONObject {
        check(raw.size in 1..maximum){"E2EE_AURORA_SOURCE_INVALID"}
        val value=JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","capturedAt","generation","pendingGeneration","documents","outbox","mounted"))
        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        Instant.parse(value.getString("capturedAt"));E2eeCommands.integer(value.get("generation"))
        check(value.isNull("pendingGeneration")){"E2EE_AURORA_GENERATION_REVIEW_REQUIRED"}
        val documents=value.getJSONArray("documents");check(documents.length()<=1026){"E2EE_JOURNAL_LIMIT"};val seen=mutableSetOf<String>()
        for(index in 0 until documents.length()){
            val row=documents.getJSONObject(index);E2eeKeys.exact(row,setOf("kind","revision","encrypted","plain"))
            val kind=row.getString("kind");check(seen.add(kind)&&(kind=="aurora-account-key"||AuroraProtocol.cacheKey(ownerId,kind)!=null)){"E2EE_AURORA_FORMAT_UNSUPPORTED"}
            E2eeCommands.integer(row.get("revision"));row.getString("encrypted");row.getString("plain")
        }
        check(value.getJSONArray("outbox").length()==0){"E2EE_AURORA_QUEUE_REVIEW_REQUIRED"}
        if(!value.isNull("mounted"))value.getJSONObject("mounted")
        return value
    }
    private fun webSnapshot(value:JSONObject):JSONObject {
        val entries=JSONArray();val rows=value.getJSONArray("documents")
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);if(row.getString("kind")=="aurora-account-key")continue
            entries.put(JSONObject().put("key",requireNotNull(AuroraProtocol.cacheKey(ownerId,row.getString("kind")))).put("value",row.getString("plain")))
        }
        return JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",value.getString("capturedAt"))
            .put("entries",entries).put("memory",JSONObject().put("ownerId",ownerId).put("legacyKey","").put("generation",value.getLong("generation"))
                .put("reconciliationRequired",false).put("current",value.optJSONObject("mounted")?:JSONObject.NULL))
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation=parseSafely {
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val captured=snapshot(local);val ancestors=previous.map(::snapshot)
        for(old in ancestors)check(workspaceConflictJson(old.get("documents"))==workspaceConflictJson(captured.get("documents"))
            &&workspaceConflictJson(old.get("mounted"))==workspaceConflictJson(captured.get("mounted"))&&old.getLong("generation")==captured.getLong("generation")){"E2EE_AURORA_HISTORY_REVIEW_REQUIRED"}
        val remote=legacyAurora(lease);assertCurrent();check(bytes(remote).size<=maximum){"E2EE_SOURCE_TOO_LARGE"}
        check(remote.get("ownerId")==ownerId&&remote.get("scopeId")==scopeId&&remote.get("migrationId")==lease.migrationId
            &&E2eeCommands.integer(remote.get("fence"),1)==lease.fence&&remote.get("sourceHash")==lease.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(remote.getLong("legacyGeneration")==captured.getLong("generation")&&lease.generation>remote.getLong("legacyGeneration")){"E2EE_AURORA_GENERATION_REVIEW_REQUIRED"}
        val keys=mutableListOf<ByteArray>()
        fun retainKey(value:String){
            check(value.length==44){"E2EE_LEGACY_KEY_UNAVAILABLE"};val decoded=try{WorkspaceCipher.decodeKey(value)}catch(_:IllegalArgumentException){error("E2EE_LEGACY_KEY_UNAVAILABLE")}
            if(Base64.getEncoder().encodeToString(decoded)!=value){decoded.fill(0);error("E2EE_LEGACY_KEY_UNAVAILABLE")};keys+=decoded
        }
        try{
            val rows=captured.getJSONArray("documents")
            for(index in 0 until rows.length()){val row=rows.getJSONObject(index);if(row.getString("kind")=="aurora-account-key")retainKey(row.getString("plain"))}
            val oldKey=remote.getJSONObject("legacyKey");E2eeKeys.exact(oldKey,setOf("keyMode","key"))
            if(oldKey.get("keyMode")=="account")retainKey(oldKey.getString("key"))else check(oldKey.get("keyMode") in setOf("client","empty")&&oldKey.isNull("key")){"E2EE_AURORA_SOURCE_INVALID"}
            val safeRemote=JSONObject(remote.toString());safeRemote.getJSONObject("legacyKey").put("key",JSONObject.NULL)
            val result=reconciler.reconcile(webSnapshot(captured),ancestors.map(::webSnapshot),lease,safeRemote,assertCurrent){envelope,purpose->
                assertCurrent();check(AuroraProtocol.allowedScope(purpose)){"E2EE_AURORA_SOURCE_INVALID"}
                val iv=envelope.getString("iv");val cipher=envelope.getString("ciphertext")
                check(iv.length==16&&cipher.length<=maximum){"E2EE_AURORA_SOURCE_INVALID"}
                var opened:ByteArray?=null
                for(key in keys){try{opened=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(cipher,iv),key,"genesis-mindmap-v1:$ownerId:$purpose".toByteArray());break}catch(_:java.security.GeneralSecurityException){/* Only captured historical keys. */}}
                val plain=opened?:error(if(keys.isEmpty())"E2EE_LEGACY_KEY_UNAVAILABLE" else "E2EE_LEGACY_AURORA_CORRUPT")
                try{assertCurrent();JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(plain)).toString())}finally{plain.fill(0)}
            }
            try{assertCurrent();result}catch(error:Throwable){(result.content+result.localContent).forEach{it.bytes.fill(0)};throw error}
        }finally{keys.forEach{it.fill(0)}}
    }
    override fun toString()="E2eeNativeAuroraSource([redacted])"
}
