package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.security.*
import java.time.Instant
import java.util.Base64

internal class E2eeMindmapsRows(val documents:List<DocumentRecord>,val generation:Long,val pendingGeneration:Long?,val mounted:JSONObject?) {
    override fun toString()="E2eeMindmapsRows([redacted])"
}

/** Exact Room/view/conversion originals before any source HTTP. LocalCipher
 * keys and old account keys never cross the network-disabled JS bridge. */
internal class E2eeNativeMindmapsSource(private val ownerId:String,private val scopeId:String,
    private val captureRows:suspend ()->E2eeMindmapsRows,private val decrypt:(DocumentRecord)->String,
    private val assertCurrent:()->Unit,private val legacyMindmaps:suspend (E2eeMigrationSourceContext)->JSONObject,
    private val reconciler:E2eePersonalSourceReconciler):E2eePrivatePathAdapter {
    override val id="personal.mindmaps"
    private val account=CloudAccountSnapshot.scopeFor(ownerId)
    private val maximum=16*1024*1024
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun bytes(value:JSONObject)=value.toString().toByteArray(Charsets.UTF_8)
    private suspend fun <T> safe(operation:suspend ()->T):T=try{operation()}
        catch(_:JSONException){error("E2EE_MINDMAPS_SOURCE_INVALID")}
        catch(_:java.nio.charset.CharacterCodingException){error("E2EE_MINDMAPS_SOURCE_INVALID")}
    override suspend fun captureLocal():ByteArray=safe {
        assertCurrent();val rows=captureRows();assertCurrent();check(rows.documents.size<=10000){"E2EE_SNAPSHOT_TOO_LARGE"}
        val documents=JSONArray();val caches=JSONArray();val seen=mutableSetOf<String>()
        for(row in rows.documents.sortedBy{it.kind}){
            check(row.scope==account&&row.revision>=0&&row.encrypted.isNotEmpty()&&seen.add(row.kind)){"E2EE_SCOPE_BINDING_MISMATCH"}
            check(row.kind in setOf("mindmaps","mindmap-conversion","aurora-account-key")||row.kind.matches(Regex("mindmap-view:[A-Za-z0-9_-]{1,100}"))){"E2EE_MINDMAPS_FORMAT_UNSUPPORTED"}
            documents.put(JSONObject().put("kind",row.kind).put("revision",row.revision).put("encrypted",row.encrypted))
            if(row.kind!="aurora-account-key")caches.put(JSONObject().put("kind",row.kind).put("plain",decrypt(row).also{assertCurrent()}))
        }
        val memory=JSONObject().put("ownerId",ownerId).put("legacyKey","").put("generation",rows.generation).put("reconciliationRequired",false).put("records",JSONArray()).put("editors",JSONArray()).put("localWork",JSONArray())
        val result=bytes(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",Instant.now().toString())
            .put("generation",rows.generation).put("pendingGeneration",rows.pendingGeneration?:JSONObject.NULL).put("documents",documents).put("caches",caches).put("mounted",rows.mounted?:JSONObject.NULL).put("memory",memory))
        assertCurrent();if(result.size>maximum){result.fill(0);error("E2EE_SNAPSHOT_TOO_LARGE")};result
    }
    private fun snapshot(raw:ByteArray):JSONObject {
        check(raw.size in 1..maximum){"E2EE_MINDMAPS_SOURCE_INVALID"};val value=JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","capturedAt","generation","pendingGeneration","documents","caches","mounted","memory"))
        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        Instant.parse(value.getString("capturedAt"));E2eeCommands.integer(value.get("generation"));check(value.isNull("pendingGeneration")){"E2EE_MINDMAPS_GENERATION_REVIEW_REQUIRED"};return value
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation=safe {
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"};check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(previous.size<=32&&local.size+previous.sumOf{it.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val captured=snapshot(local);val ancestors=previous.map(::snapshot)
        fun stable(value:JSONObject)=JSONObject(value.toString()).apply{remove("capturedAt")}
        for(old in ancestors)check(workspaceConflictJson(stable(old))==workspaceConflictJson(stable(captured))){"E2EE_MINDMAPS_HISTORY_REVIEW_REQUIRED"}
        val remote=legacyMindmaps(lease);assertCurrent();check(bytes(remote).size<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"}
        check(remote.get("ownerId")==ownerId&&remote.get("scopeId")==scopeId&&remote.get("migrationId")==lease.migrationId&&E2eeCommands.integer(remote.get("fence"),1)==lease.fence&&remote.get("sourceHash")==lease.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(remote.getLong("legacyGeneration")==captured.getLong("generation")&&lease.generation>remote.getLong("legacyGeneration")){"E2EE_MINDMAPS_GENERATION_REVIEW_REQUIRED"}
        val keys=mutableListOf<ByteArray>()
        fun retainKey(encoded:String){val raw=try{WorkspaceCipher.decodeKey(encoded)}catch(_:IllegalArgumentException){error("E2EE_LEGACY_KEY_UNAVAILABLE")}
            if(raw.size!=32||Base64.getEncoder().encodeToString(raw)!=encoded){raw.fill(0);error("E2EE_LEGACY_KEY_UNAVAILABLE")};keys+=raw}
        try{
            val docs=captured.getJSONArray("documents");for(index in 0 until docs.length()){val row=docs.getJSONObject(index)
                if(row.get("kind")=="aurora-account-key")retainKey(decrypt(DocumentRecord(account,"aurora-account-key",row.getString("encrypted"),row.getLong("revision"))).also{assertCurrent()})}
            val old=remote.getJSONObject("legacyKey");E2eeKeys.exact(old,setOf("keyMode","key"));if(old.get("keyMode")=="account")retainKey(old.getString("key"))else check(old.get("keyMode") in setOf("client","empty")&&old.isNull("key")){"E2EE_MINDMAPS_SOURCE_INVALID"}
            val safeRemote=JSONObject(remote.toString());safeRemote.getJSONObject("legacyKey").put("key",JSONObject.NULL)
            val originals=mutableMapOf<String,MutableList<Pair<String,String>>>()
            fun retain(id:String,row:JSONObject){check(id.matches(Regex("[A-Za-z0-9_-]{1,100}"))){"E2EE_MINDMAPS_SOURCE_INVALID"};originals.getOrPut("map:$id"){mutableListOf()}.add(row.getString("iv") to row.getString("ciphertext"))}
            for(field in listOf("maps","versions")){val rows=remote.getJSONArray(field);for(index in 0 until rows.length()){val row=rows.getJSONObject(index);retain(row.getString(if(field=="maps")"id" else "map_id"),row)}}
            fun retainPending(rows:JSONArray){for(index in 0 until rows.length()){val row=rows.getJSONObject(index);row.optJSONObject("pending")?.let{retain(row.getJSONObject("document").getString("id"),it)}}}
            val caches=captured.getJSONArray("caches");for(index in 0 until caches.length()){val row=caches.getJSONObject(index);if(row.get("kind")=="mindmaps")retainPending(JSONArray(row.getString("plain")))}
            captured.optJSONObject("mounted")?.optJSONArray("records")?.let(::retainPending)
            val result=reconciler.reconcile(captured,ancestors,lease,safeRemote,assertCurrent){envelope,purpose->
                assertCurrent();E2eeKeys.exact(envelope,setOf("iv","ciphertext"));val iv=envelope.getString("iv");val cipher=envelope.getString("ciphertext")
                check(cipher.length<=2800000&&originals[purpose]?.contains(iv to cipher)==true){"E2EE_MINDMAPS_SOURCE_INVALID"};var opened:ByteArray?=null
                for(raw in keys)try{opened=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(cipher,iv),raw,"genesis-mindmap-v1:$ownerId:$purpose".toByteArray());break}catch(_:java.security.GeneralSecurityException){/* Captured old keys only. */}
                val plain=opened?:error(if(keys.isEmpty())"E2EE_LEGACY_KEY_UNAVAILABLE" else "E2EE_LEGACY_MINDMAPS_CORRUPT")
                try{assertCurrent();Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(plain)).toString()}finally{plain.fill(0)}
            }
            try{assertCurrent();check((result.content+result.localContent).sumOf{it.bytes.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"};result}
            catch(error:Throwable){(result.content+result.localContent).forEach{it.bytes.fill(0)};throw error}
        }finally{keys.forEach{it.fill(0)}}
    }
    override fun toString()="E2eeNativeMindmapsSource([redacted])"
}
