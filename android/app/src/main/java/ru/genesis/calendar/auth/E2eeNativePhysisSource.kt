package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.security.*
import java.io.Closeable
import java.time.Instant
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean

internal class E2eePhysisRows(val documents:List<DocumentRecord>,val generation:Long,val pendingGeneration:Long?) {
    override fun toString()="E2eePhysisRows([redacted])"
}
internal class E2eePhysisCredential(val method:String,secret:CharArray):Closeable {
    internal val secret=secret.copyOf()
    override fun close(){secret.fill('\u0000')}
    override fun toString()="E2eePhysisCredential([redacted])"
}

/** Cold Android source still reads every server Physis table. This app has no
 * native Physis editor/repository; its unavailable backup placeholder is never
 * interpreted as an empty server vault. Keys remain in native for the whole job. */
internal class E2eeNativePhysisSource(private val ownerId:String,private val scopeId:String,
    private val captureRows:suspend ()->E2eePhysisRows,private val decrypt:(DocumentRecord)->String,
    private val assertCurrent:()->Unit,private val legacyPhysis:suspend (E2eeMigrationSourceContext)->JSONObject,
    private val reconciler:E2eePersonalSourceReconciler,
    private val independentUnlock:suspend (JSONObject)->E2eePhysisCredential?={null}):E2eePrivatePathAdapter {
    override val id="personal.physis"
    private val account=CloudAccountSnapshot.scopeFor(ownerId)
    private val maximum=16*1024*1024
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun bytes(value:JSONObject)=value.toString().toByteArray(Charsets.UTF_8)
    private fun oldKey(encoded:String):ByteArray {
        check(encoded.length==44){"E2EE_LEGACY_KEY_UNAVAILABLE"}
        val raw=try{WorkspaceCipher.decodeKey(encoded)}catch(_:IllegalArgumentException){error("E2EE_LEGACY_KEY_UNAVAILABLE")}
        if(Base64.getEncoder().encodeToString(raw)!=encoded){raw.fill(0);error("E2EE_LEGACY_KEY_UNAVAILABLE")};return raw
    }
    private fun bridgeSnapshot(value:JSONObject)=JSONObject(value.toString()).also{copy->
        val rows=copy.getJSONArray("documents");for(index in 0 until rows.length())rows.getJSONObject(index).remove("plain")
    }
    private fun retainedKey(value:JSONObject):String?=value.getJSONArray("documents").optJSONObject(0)?.let{if(it.has("plain"))it.getString("plain")else null}
    private suspend fun <T> safe(operation:suspend ()->T):T=try{operation()}
        catch(_:JSONException){error("E2EE_PHYSIS_SOURCE_INVALID")}
        catch(_:java.nio.charset.CharacterCodingException){error("E2EE_PHYSIS_SOURCE_INVALID")}
        catch(_:java.time.DateTimeException){error("E2EE_PHYSIS_SOURCE_INVALID")}
    override suspend fun captureLocal():ByteArray=safe {
        assertCurrent();val rows=captureRows();assertCurrent();check(rows.documents.size<=1){"E2EE_PHYSIS_FORMAT_UNSUPPORTED"}
        val documents=JSONArray()
        for(row in rows.documents){
            check(row.scope==account&&row.kind=="aurora-account-key"&&row.revision>=0&&row.encrypted.isNotEmpty()){"E2EE_SCOPE_BINDING_MISMATCH"}
            val plain=decrypt(row).also{assertCurrent()};oldKey(plain).fill(0)
            documents.put(JSONObject().put("kind",row.kind).put("revision",row.revision).put("encrypted",row.encrypted).put("plain",plain))
        }
        val memory=JSONObject().put("ownerId",ownerId).put("generation",rows.generation).put("reconciliationRequired",false).put("legacyKey","").put("stores",JSONArray())
        val result=bytes(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",Instant.now().toString())
            .put("generation",rows.generation).put("pendingGeneration",rows.pendingGeneration?:JSONObject.NULL).put("documents",documents).put("memory",memory))
        assertCurrent();if(result.size>maximum){result.fill(0);error("E2EE_SNAPSHOT_TOO_LARGE")};result
    }
    private fun snapshot(raw:ByteArray):JSONObject {
        check(raw.size in 1..maximum){"E2EE_PHYSIS_SOURCE_INVALID"};val value=JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","capturedAt","generation","pendingGeneration","documents","memory"))
        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        Instant.parse(value.getString("capturedAt"));E2eeCommands.integer(value.get("generation"));check(value.isNull("pendingGeneration")){"E2EE_PHYSIS_GENERATION_REVIEW_REQUIRED"}
        val rows=value.getJSONArray("documents");check(rows.length()<=1){"E2EE_PHYSIS_SOURCE_INVALID"}
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);E2eeKeys.exact(row,if(row.has("plain"))setOf("kind","revision","encrypted","plain")else setOf("kind","revision","encrypted"))
            check(row.get("kind")=="aurora-account-key"&&row.get("encrypted") is String&&row.getString("encrypted").isNotEmpty()){"E2EE_PHYSIS_SOURCE_INVALID"};E2eeCommands.integer(row.get("revision"))
            if(row.has("plain"))oldKey(row.getString("plain")).fill(0)
        };return value
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation=safe {
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"};check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(previous.size<=32&&local.size+previous.sumOf{it.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val captured=snapshot(local);val ancestors=previous.map(::snapshot)
        for(old in ancestors){
            val a=bridgeSnapshot(old).apply{remove("capturedAt")};val b=bridgeSnapshot(captured).apply{remove("capturedAt")}
            check(workspaceConflictJson(a)==workspaceConflictJson(b)&&retainedKey(old)==retainedKey(captured)){"E2EE_PHYSIS_HISTORY_REVIEW_REQUIRED"}
        }
        val remote=legacyPhysis(lease);assertCurrent();check(bytes(remote).size<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"}
        check(remote.get("ownerId")==ownerId&&remote.get("scopeId")==scopeId&&remote.get("migrationId")==lease.migrationId&&E2eeCommands.integer(remote.get("fence"),1)==lease.fence&&remote.get("sourceHash")==lease.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(remote.getLong("legacyGeneration")==captured.getLong("generation")&&lease.generation>remote.getLong("legacyGeneration")){"E2EE_PHYSIS_GENERATION_REVIEW_REQUIRED"}
        val keys=mutableListOf<ByteArray>();var reader:E2eeLegacyPhysis.Reader?=null;val active=AtomicBoolean(true)
        fun current(){check(active.get()){"E2EE_PHYSIS_CAPABILITY_CLOSED"};assertCurrent()}
        try{
            val docs=captured.getJSONArray("documents");for(index in 0 until docs.length()){val row=docs.getJSONObject(index)
                keys+=oldKey(if(row.has("plain"))row.getString("plain")else decrypt(DocumentRecord(account,"aurora-account-key",row.getString("encrypted"),row.getLong("revision"))).also{assertCurrent()})}
            val old=remote.getJSONObject("legacyKey");E2eeKeys.exact(old,setOf("keyMode","key"));if(old.get("keyMode")=="account")keys+=oldKey(old.getString("key"))
            else check(old.get("keyMode") in setOf("client","empty")&&old.isNull("key")){"E2EE_PHYSIS_SOURCE_INVALID"}
            val safeRemote=JSONObject(remote.toString());safeRemote.getJSONObject("legacyKey").put("key",JSONObject.NULL)
            val owners=remote.getJSONArray("owners");check(owners.length()<=1){"E2EE_PHYSIS_SOURCE_INVALID"}
            val original=owners.optJSONObject(0)?.let{if(it.isNull("vault_json"))null else JSONObject(it.getString("vault_json"))}
            val originals=mutableMapOf<String,JSONObject>();val rows=remote.getJSONArray("records")
            for(index in 0 until rows.length()){
                val row=rows.getJSONObject(index);val id=row.getString("id");check(!originals.containsKey(id)){"E2EE_PHYSIS_SOURCE_INVALID"}
                if(!row.isNull("envelope_json"))originals[id]=JSONObject(row.getString("envelope_json"))
            }
            val result=reconciler.reconcile(bridgeSnapshot(captured),ancestors.map(::bridgeSnapshot),lease,safeRemote,::current){envelope,purpose->
                current();E2eeKeys.exact(envelope,setOf("iv","ciphertext"));val vault=requireNotNull(original){"E2EE_PHYSIS_SOURCE_INVALID"}
                val version=E2eeCommands.integer(vault.get("version"),1);val keyVersion=E2eeCommands.integer(vault.get("keyVersion"),1)
                if(purpose=="physis-vault:$version:$keyVersion"){
                    val packet=vault.getJSONObject(if(version==2L)"account"else "password")
                    check(envelope.get("iv")==packet.get("iv")&&envelope.get("ciphertext")==packet.get("ciphertext")){"E2EE_PHYSIS_SOURCE_INVALID"}
                    if(reader==null){
                        if(version==2L){for(key in keys)try{reader=E2eeLegacyPhysis.unlockAccount(ownerId,vault,key,::current);break}
                            catch(error:IllegalStateException){current();if(error.message!="E2EE_PHYSIS_UNLOCK_REQUIRED")throw error}}
                        else if(version==1L){
                            val credential=independentUnlock(JSONObject(vault.toString()))?:error("E2EE_PHYSIS_UNLOCK_REQUIRED")
                            try{current();reader=E2eeLegacyPhysis.unlockIndependent(ownerId,vault,credential.method,credential.secret,::current)}finally{credential.close()}
                        }else error("E2EE_PHYSIS_FORMAT_UNSUPPORTED")
                    }
                    current();check(reader!=null){"E2EE_PHYSIS_UNLOCK_REQUIRED"};true
                }else{
                    val match=Regex("physis-record:([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}):([0-9]{1,16})").matchEntire(purpose)?:error("E2EE_PHYSIS_SOURCE_INVALID")
                    check(match.groupValues[2]==keyVersion.toString()){"E2EE_PHYSIS_SOURCE_INVALID"};val id=match.groupValues[1];val packet=originals[id]?:error("E2EE_PHYSIS_SOURCE_INVALID")
                    check(envelope.get("iv")==packet.get("iv")&&envelope.get("ciphertext")==packet.get("ciphertext")){"E2EE_PHYSIS_SOURCE_INVALID"}
                    requireNotNull(reader){"E2EE_PHYSIS_UNLOCK_REQUIRED"}.readRecord(ownerId,id,packet)
                }
            }
            try{current();check((result.content+result.localContent).sumOf{it.bytes.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"};result}
            catch(error:Throwable){(result.content+result.localContent).forEach{it.bytes.fill(0)};throw error}
        }finally{active.set(false);reader?.close();keys.forEach{it.fill(0)}}
    }
    override fun toString()="E2eeNativePhysisSource([redacted])"
}
