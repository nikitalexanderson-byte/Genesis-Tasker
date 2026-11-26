package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.security.*
import java.time.Instant
import java.util.Base64

internal class E2eeDiaryRows(val documents:List<DocumentRecord>,val generation:Long,val pendingGeneration:Long?,val mounted:JSONObject?) {
    override fun toString()="E2eeDiaryRows([redacted])"
}

/** Captures every diary root/current/dangling chunk before network reads. Old
 * LocalCipher/account keys stay native. No purge, sync, upload or cleanup port. */
internal class E2eeNativeDiarySource(private val ownerId:String,private val scopeId:String,
    private val captureRows:suspend ()->E2eeDiaryRows,private val decryptCache:(String)->String,
    private val decryptAccountKey:(DocumentRecord)->String,private val assertCurrent:()->Unit,
    private val legacyDiary:suspend (E2eeMigrationSourceContext)->JSONObject,private val reconciler:E2eePersonalSourceReconciler):E2eePrivatePathAdapter {
    override val id="personal.diary"
    private val account=CloudAccountSnapshot.scopeFor(ownerId)
    private val maximum=16*1024*1024
    private val prefix="genesis-diary-chunks-v1:"
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun bytes(value:JSONObject)=value.toString().toByteArray(Charsets.UTF_8)
    private fun oldKey(encoded:String):ByteArray {
        check(encoded.length==44){"E2EE_LEGACY_KEY_UNAVAILABLE"}
        val raw=try{WorkspaceCipher.decodeKey(encoded)}catch(_:IllegalArgumentException){error("E2EE_LEGACY_KEY_UNAVAILABLE")}
        if(Base64.getEncoder().encodeToString(raw)!=encoded){raw.fill(0);error("E2EE_LEGACY_KEY_UNAVAILABLE")};return raw
    }
    /** Old key material is only in the capture protected by the coordinator.
     * Strip it from current and historical captures before the JS bridge. */
    private fun bridgeSnapshot(value:JSONObject)=JSONObject(value.toString()).also{copy->
        val rows=copy.getJSONArray("documents");for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);if(row.get("kind")=="aurora-account-key")row.remove("plain")
        }
    }
    private fun retainedKey(value:JSONObject):String? {
        val rows=value.getJSONArray("documents");for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);if(row.get("kind")=="aurora-account-key")return if(row.has("plain"))row.getString("plain") else null
        };return null
    }
    private suspend fun <T> safe(operation:suspend ()->T):T=try{operation()}
        catch(_:JSONException){error("E2EE_DIARY_SOURCE_INVALID")}
        catch(_:java.nio.charset.CharacterCodingException){error("E2EE_DIARY_SOURCE_INVALID")}
    override suspend fun captureLocal():ByteArray=safe {
        assertCurrent();val rows=captureRows();assertCurrent();check(rows.documents.size<=10000){"E2EE_SNAPSHOT_TOO_LARGE"}
        val documents=JSONArray();val seen=mutableSetOf<String>();val chunks=mutableMapOf<String,MutableMap<Int,String>>()
        var root:String?=null;var size=0L
        for(row in rows.documents.sortedBy{it.kind}){
            check(row.scope==account&&row.revision>=0&&seen.add(row.kind)&&row.encrypted.isNotEmpty()){"E2EE_SCOPE_BINDING_MISMATCH"}
            size+=row.encrypted.toByteArray(Charsets.UTF_8).size;check(size<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"}
            val document=JSONObject().put("kind",row.kind).put("revision",row.revision).put("encrypted",row.encrypted)
            documents.put(document)
            when(row.kind){
                "diary-v1"->root=row.encrypted
                "aurora-account-key"->{val plain=decryptAccountKey(row).also{assertCurrent()};oldKey(plain).fill(0);document.put("plain",plain)}
                else->{
                    val match=Regex("diary-v1/([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})/(0|[1-9][0-9]{0,3})").matchEntire(row.kind)?:error("E2EE_DIARY_FORMAT_UNSUPPORTED")
                    check(chunks.getOrPut(match.groupValues[1]){mutableMapOf()}.put(match.groupValues[2].toInt(),row.encrypted)==null){"E2EE_DIARY_SOURCE_INVALID"}
                }
            }
        }
        val caches=JSONArray();val assembled=mutableMapOf<String,String>()
        for((generation,parts) in chunks){
            check(parts.size in 1..4096&&parts.keys== (0 until parts.size).toSet()){"E2EE_DIARY_NATIVE_HISTORY_REVIEW_REQUIRED"}
            val ciphertext=(0 until parts.size).joinToString(""){parts.getValue(it)}
            check(ciphertext.length<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"};assembled[generation]=ciphertext
            caches.put(JSONObject().put("source","diary-v1/$generation").put("plain",decryptCache(ciphertext).also{assertCurrent()}))
        }
        if(root!=null){
            val ciphertext=if(root.startsWith(prefix)){
                val manifest=JSONArray(root.removePrefix(prefix));check(manifest.length()==3){"E2EE_DIARY_SOURCE_INVALID"}
                val generation=manifest.getString(0);val count=E2eeCommands.integer(manifest.get(1),1);val length=E2eeCommands.integer(manifest.get(2))
                check(count<=4096&&chunks[generation]?.size?.toLong()==count){"E2EE_DIARY_NATIVE_HISTORY_REVIEW_REQUIRED"}
                val value=assembled[generation]?:error("E2EE_DIARY_SOURCE_INVALID");check(value.length.toLong()==length){"E2EE_DIARY_SOURCE_INVALID"};value
            }else root
            caches.put(JSONObject().put("source","diary-v1").put("plain",decryptCache(ciphertext).also{assertCurrent()}))
        }else check(chunks.isEmpty()){"E2EE_DIARY_NATIVE_HISTORY_REVIEW_REQUIRED"}
        val memory=JSONObject().put("ownerId",ownerId).put("legacyKey","").put("generation",rows.generation).put("reconciliationRequired",false).put("records",JSONArray()).put("editors",JSONArray())
        val result=bytes(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",Instant.now().toString())
            .put("generation",rows.generation).put("pendingGeneration",rows.pendingGeneration?:JSONObject.NULL).put("documents",documents).put("caches",caches)
            .put("mounted",rows.mounted?:JSONObject.NULL).put("memory",memory))
        assertCurrent();if(result.size>maximum){result.fill(0);error("E2EE_SNAPSHOT_TOO_LARGE")};result
    }
    private fun snapshot(raw:ByteArray):JSONObject {
        check(raw.size in 1..maximum){"E2EE_DIARY_SOURCE_INVALID"}
        val value=JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","capturedAt","generation","pendingGeneration","documents","caches","mounted","memory"))
        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        Instant.parse(value.getString("capturedAt"));E2eeCommands.integer(value.get("generation"));check(value.isNull("pendingGeneration")){"E2EE_DIARY_GENERATION_REVIEW_REQUIRED"}
        val docs=value.getJSONArray("documents");val caches=value.getJSONArray("caches");check(docs.length()<=10000&&caches.length()<=4097){"E2EE_SNAPSHOT_TOO_LARGE"}
        for(index in 0 until docs.length()){
            val row=docs.getJSONObject(index);val retained=row.get("kind")=="aurora-account-key"&&row.has("plain")
            E2eeKeys.exact(row,if(retained)setOf("kind","revision","encrypted","plain") else setOf("kind","revision","encrypted"))
            if(retained){check(row.get("plain") is String){"E2EE_DIARY_SOURCE_INVALID"};oldKey(row.getString("plain")).fill(0)}
        }
        return value
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation=safe {
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"};check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(previous.size<=32&&local.size+previous.sumOf{it.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val captured=snapshot(local);val ancestors=previous.map(::snapshot)
        fun stable(value:JSONObject)=bridgeSnapshot(value).apply{remove("capturedAt")}
        for(old in ancestors){
            check(workspaceConflictJson(stable(old))==workspaceConflictJson(stable(captured))){"E2EE_DIARY_HISTORY_REVIEW_REQUIRED"}
            val priorKey=retainedKey(old);val currentKey=retainedKey(captured)
            check(priorKey==null||currentKey==null||priorKey==currentKey){"E2EE_DIARY_HISTORY_REVIEW_REQUIRED"}
        }
        val remote=legacyDiary(lease);assertCurrent();check(bytes(remote).size<=maximum){"E2EE_SOURCE_TOO_LARGE"}
        check(remote.get("ownerId")==ownerId&&remote.get("scopeId")==scopeId&&remote.get("migrationId")==lease.migrationId
            &&E2eeCommands.integer(remote.get("fence"),1)==lease.fence&&remote.get("sourceHash")==lease.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(remote.getLong("legacyGeneration")==captured.getLong("generation")&&lease.generation>remote.getLong("legacyGeneration")){"E2EE_DIARY_GENERATION_REVIEW_REQUIRED"}
        val keys=mutableListOf<ByteArray>()
        fun key(encoded:String){keys+=oldKey(encoded)}
        try{
            val docs=captured.getJSONArray("documents");for(index in 0 until docs.length()){
                val row=docs.getJSONObject(index);if(row.getString("kind")=="aurora-account-key")key(if(row.has("plain"))row.getString("plain") else decryptAccountKey(DocumentRecord(account,"aurora-account-key",row.getString("encrypted"),row.getLong("revision"))).also{assertCurrent()})
            }
            val old=remote.getJSONObject("legacyKey");E2eeKeys.exact(old,setOf("keyMode","key"))
            if(old.get("keyMode")=="account")key(old.getString("key"))else check(old.get("keyMode") in setOf("client","empty")&&old.isNull("key")){"E2EE_DIARY_SOURCE_INVALID"}
            val safeRemote=JSONObject(remote.toString());safeRemote.getJSONObject("legacyKey").put("key",JSONObject.NULL)
            val originals=mutableMapOf<String,MutableList<Pair<String,String>>>()
            fun retain(id:String,row:JSONObject){
                check(id.matches(Regex("[A-Za-z0-9_-]{1,100}"))){"E2EE_DIARY_SOURCE_INVALID"}
                originals.getOrPut("diary-note:v1:$id"){mutableListOf()}.add(row.getString("iv") to row.getString("ciphertext"))
            }
            val notes=remote.getJSONArray("notes");for(index in 0 until notes.length()){val row=notes.getJSONObject(index);retain(row.getString("id"),row)}
            val caches=captured.getJSONArray("caches");for(index in 0 until caches.length()){
                val root=JSONObject(caches.getJSONObject(index).getString("plain"))
                for(field in listOf("records","drafts")){
                    val rows=root.getJSONArray(field)
                    for(i in 0 until rows.length()){
                        val row=rows.getJSONObject(i)
                        row.optJSONObject("pending")?.let{retain(row.getJSONObject("note").getString("id"),it)}
                    }
                }
            }
            captured.optJSONObject("mounted")?.optJSONArray("records")?.let{rows->for(index in 0 until rows.length()){val row=rows.getJSONObject(index);row.optJSONObject("pending")?.let{retain(row.getJSONObject("note").getString("id"),it)}}}
            val result=reconciler.reconcile(bridgeSnapshot(captured),ancestors.map(::bridgeSnapshot),lease,safeRemote,assertCurrent){envelope,purpose->
                assertCurrent();E2eeKeys.exact(envelope,setOf("iv","ciphertext"));val iv=envelope.getString("iv");val cipher=envelope.getString("ciphertext")
                check(cipher.length<=maximum&&originals[purpose]?.contains(iv to cipher)==true){"E2EE_DIARY_SOURCE_INVALID"}
                var opened:ByteArray?=null
                for(raw in keys)try{opened=WorkspaceCipher.decrypt(WorkspaceCipher.Envelope(cipher,iv),raw,"genesis-mindmap-v1:$ownerId:$purpose".toByteArray());break}catch(_:java.security.GeneralSecurityException){/* Captured old epochs only. */}
                val plain=opened?:error(if(keys.isEmpty())"E2EE_LEGACY_KEY_UNAVAILABLE" else "E2EE_LEGACY_DIARY_CORRUPT")
                try{assertCurrent();Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(plain)).toString()}finally{plain.fill(0)}
            }
            try{assertCurrent();check((result.content+result.localContent).sumOf{it.bytes.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"};result}
            catch(error:Throwable){(result.content+result.localContent).forEach{it.bytes.fill(0)};throw error}
        }finally{keys.forEach{it.fill(0)}}
    }
    override fun toString()="E2eeNativeDiarySource([redacted])"
}
