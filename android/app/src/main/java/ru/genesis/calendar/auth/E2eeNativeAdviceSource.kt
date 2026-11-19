package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONObject
import org.json.JSONException
import ru.genesis.calendar.data.DocumentRecord
import ru.genesis.calendar.data.OutboxRecord
import ru.genesis.calendar.security.*
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.time.Instant

internal class E2eeAdviceRows(val documents:List<DocumentRecord>,val outbox:List<OutboxRecord>,val generation:Long,
    val pendingGeneration:Long?,val knownPreferences:List<String>,val mounted:JSONObject?){override fun toString()="E2eeAdviceRows([redacted])"}
internal class E2eeAdviceLegacyRows(val entries:Map<String,String>,val unknownCount:Int){override fun toString()="E2eeAdviceLegacyRows([redacted])"}
internal val adviceMigrationLanguages=listOf("ru","en","el","de","fr","es","it","pt","pl","sr","uk","zh","tr","ja")

/** Real owner-scoped Room + proven v1 lookups. Unknown shared preference hashes
 * are never assigned/copied to this owner. Their presence blocks reconciliation
 * without changing originals. No legacy or new-root key enters the JS engine. */
internal class E2eeNativeAdviceSource(private val ownerId:String,private val scopeId:String,
    private val captureRows:suspend ()->E2eeAdviceRows,private val decrypt:(DocumentRecord)->String,
    private val captureLegacy:suspend (Set<String>)->E2eeAdviceLegacyRows,private val assertCurrent:()->Unit,
    private val legacyAdvice:suspend (E2eeMigrationSourceContext)->JSONObject,private val reconciler:E2eePersonalSourceReconciler):E2eePrivatePathAdapter {
    override val id="personal.advice"
    private val account=CloudAccountSnapshot.scopeFor(ownerId);private val maximum=16*1024*1024
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun bytes(value:JSONObject)=value.toString().toByteArray(Charsets.UTF_8)
    private fun hash(value:String)=MessageDigest.getInstance("SHA-256").digest(value.toByteArray(Charsets.UTF_8)).joinToString(""){"%02x".format(it)}
    private suspend fun <T> safely(run:suspend ()->T):T=try{run()}
        catch(_:JSONException){error("E2EE_ADVICE_SOURCE_INVALID")}
        catch(_:java.nio.charset.CharacterCodingException){error("E2EE_ADVICE_SOURCE_INVALID")}
        catch(_:java.time.DateTimeException){error("E2EE_ADVICE_SOURCE_INVALID")}
    override suspend fun captureLocal():ByteArray=safely{
        assertCurrent();val captured=captureRows();assertCurrent()
        check(captured.documents.size<=1026&&captured.documents.map{it.kind}.toSet().size==captured.documents.size&&captured.outbox.size<=1024){"E2EE_JOURNAL_LIMIT"}
        val preferences=captured.knownPreferences.toMutableSet();val documents=JSONArray();var size=0L
        for(row in captured.documents.sortedBy{it.kind}){
            check(row.scope==account&&row.kind.startsWith("advice-")&&row.revision>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
            val plain=decrypt(row);assertCurrent()
            if(row.kind=="advice-cache-v2"||row.kind.startsWith("advice-cache-history-v2:")){
                val container=JSONObject(plain);E2eeKeys.exact(container,setOf("protocol","ownerId","profiles"))
                check(container.get("ownerId")==ownerId&&E2eeCommands.integer(container.get("protocol"))==2L){"E2EE_SCOPE_BINDING_MISMATCH"}
                val profiles=container.getJSONObject("profiles");check(profiles.length()<=256){"E2EE_JOURNAL_LIMIT"}
                for(key in profiles.keys()){
                    val profile=profiles.getJSONObject(key);val language=profile.getString("language");val raw=profile.getString("preferences")
                    check(language in adviceMigrationLanguages&&raw.length<=16384&&key==hash("$ownerId\u0000$language\u0000$raw")){"E2EE_SCOPE_BINDING_MISMATCH"};preferences+=raw
                }
            }
            val copy=JSONObject().put("kind",row.kind).put("revision",row.revision).put("encrypted",row.encrypted).put("plain",plain)
            size+=bytes(copy).size;check(size<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"};documents.put(copy)
        }
        check(preferences.size*adviceMigrationLanguages.size<=4096&&preferences.all{it.length<=16384}){"E2EE_SOURCE_TOO_LARGE"}
        val knownProfiles=JSONArray();val keys=mutableSetOf<String>()
        for(preference in preferences.sorted())for(language in adviceMigrationLanguages){
            knownProfiles.put(JSONObject().put("language",language).put("preferences",preference));check(keys.add(hash("$ownerId\u0000$language\u0000$preference"))){"E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED"}
        }
        assertCurrent();val old=captureLegacy(keys);assertCurrent();check(old.entries.size<=10000&&old.unknownCount>=0){"E2EE_JOURNAL_LIMIT"}
        val legacy=JSONArray();for((key,value)in old.entries.toSortedMap()){
            val match=Regex("([a-f0-9]{64})(?::seen:advice-[a-f0-9]{24})?").matchEntire(key)
            check(match!=null&&match.groupValues[1] in keys){"E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED"};check(value.length<=maximum){"E2EE_SNAPSHOT_TOO_LARGE"}
            legacy.put(JSONObject().put("key",key).put("value",value))
        }
        val outbox=JSONArray(captured.outbox.map{row->check(row.scope==account&&row.entityId.startsWith("advice")&&row.revision>=0){"E2EE_SCOPE_BINDING_MISMATCH"}
            JSONObject().put("entityId",row.entityId).put("revision",row.revision).put("operationId",row.operationId).put("state",row.state)})
        val value=JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",Instant.now().toString())
            .put("generation",captured.generation).put("pendingGeneration",captured.pendingGeneration?:JSONObject.NULL).put("documents",documents).put("outbox",outbox)
            .put("legacy",legacy).put("unknownLegacyCount",old.unknownCount).put("knownProfiles",knownProfiles).put("mounted",captured.mounted?:JSONObject.NULL)
        val result=bytes(value);assertCurrent();if(result.size>maximum){result.fill(0);error("E2EE_SNAPSHOT_TOO_LARGE")};result
    }
    private fun snapshot(raw:ByteArray):JSONObject{
        check(raw.size in 1..maximum){"E2EE_ADVICE_SOURCE_INVALID"};val value=JSONObject(Charsets.UTF_8.newDecoder().decode(ByteBuffer.wrap(raw)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","capturedAt","generation","pendingGeneration","documents","outbox","legacy","unknownLegacyCount","knownProfiles","mounted"))
        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        Instant.parse(value.getString("capturedAt"));E2eeCommands.integer(value.get("generation"))
        check(value.isNull("pendingGeneration")){"E2EE_ADVICE_GENERATION_REVIEW_REQUIRED"}
        check(E2eeCommands.integer(value.get("unknownLegacyCount"))==0L){"E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED"}
        check(value.getJSONArray("outbox").length()==0){"E2EE_ADVICE_QUEUE_REVIEW_REQUIRED"}
        return value
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation=safely{
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"};check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(previous.size<=32&&local.size.toLong()+previous.sumOf{it.size.toLong()}<=128L*1024*1024){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val current=snapshot(local);val ancestors=previous.map(::snapshot)
        for(old in ancestors)for(field in listOf("generation","documents","outbox","legacy","unknownLegacyCount","knownProfiles","mounted"))
            check(workspaceConflictJson(old.get(field))==workspaceConflictJson(current.get(field))){"E2EE_ADVICE_HISTORY_REVIEW_REQUIRED"}
        val remote=legacyAdvice(lease);assertCurrent();check(bytes(remote).size<=maximum){"E2EE_SOURCE_TOO_LARGE"}
        check(remote.get("ownerId")==ownerId&&remote.get("scopeId")==scopeId&&remote.get("migrationId")==lease.migrationId
            &&E2eeCommands.integer(remote.get("fence"),1)==lease.fence&&remote.get("sourceHash")==lease.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(remote.getLong("legacyGeneration")==current.getLong("generation")&&lease.generation>remote.getLong("legacyGeneration")){"E2EE_ADVICE_GENERATION_REVIEW_REQUIRED"}
        val result=reconciler.reconcile(current,ancestors,lease,remote,assertCurrent){_,_->error("E2EE_KEY_BRIDGE_FORBIDDEN")}
        try{assertCurrent();result}catch(error:Throwable){result.content.forEach{it.bytes.fill(0)};throw error}
    }
    override fun toString()="E2eeNativeAdviceSource([redacted])"
}
