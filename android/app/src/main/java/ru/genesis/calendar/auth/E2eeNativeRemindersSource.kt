package ru.genesis.calendar.auth

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import ru.genesis.calendar.data.ReminderRecord
import ru.genesis.calendar.security.*
import java.time.Instant

internal class E2eeRemindersRows(val reminders:List<ReminderRecord>,val preferences:JSONObject,val localPreferences:JSONObject,
    val generation:Long,val pendingGeneration:Long?,val mounted:JSONObject?){override fun toString()="E2eeRemindersRows([redacted])"}

/** No old account key, endpoint decryption, OS alarm or network mutation port.
 * Capture is kept under the NEW root before reading the signed server source.
 * SharedPreferences raw JSON remains text until the common strict parser sees it. */
internal class E2eeNativeRemindersSource(private val ownerId:String,private val scopeId:String,
    private val captureRows:suspend ()->E2eeRemindersRows,private val assertCurrent:()->Unit,
    private val legacyReminders:suspend (E2eeMigrationSourceContext)->JSONObject,
    private val reconciler:E2eePersonalSourceReconciler):E2eePrivatePathAdapter {
    override val id="personal.reminders"
    private val account=CloudAccountSnapshot.scopeFor(ownerId)
    private val maximum=16*1024*1024
    init{E2eeKeys.technical(ownerId);E2eeKeys.technical(scopeId)}
    private fun bytes(value:JSONObject)=value.toString().toByteArray(Charsets.UTF_8)
    private suspend fun <T> safe(operation:suspend ()->T):T=try{operation()}
        catch(_:JSONException){error("E2EE_REMINDER_SOURCE_INVALID")}
        catch(_:java.nio.charset.CharacterCodingException){error("E2EE_REMINDER_SOURCE_INVALID")}
        catch(_:java.time.DateTimeException){error("E2EE_REMINDER_SOURCE_INVALID")}
    override suspend fun captureLocal():ByteArray=safe {
        assertCurrent();val rows=captureRows();assertCurrent();check(rows.reminders.size<=10000){"E2EE_SOURCE_TOO_LARGE"}
        val reminders=JSONArray();for(row in rows.reminders){
            check(row.scope==account){"E2EE_SCOPE_BINDING_MISMATCH"}
            reminders.put(JSONObject().put("scope",row.scope).put("id",row.id).put("taskId",row.taskId).put("occurrenceId",row.occurrenceId)
                .put("revision",row.revision).put("at",row.at).put("state",row.state).put("deliveredAt",row.deliveredAt?:JSONObject.NULL))
        }
        val output=bytes(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("capturedAt",Instant.now().toString())
            .put("generation",rows.generation).put("pendingGeneration",rows.pendingGeneration?:JSONObject.NULL).put("accountScope",account)
            .put("room",reminders).put("preferences",JSONObject(rows.preferences.toString())).put("localPreferences",JSONObject(rows.localPreferences.toString()))
            .put("mounted",rows.mounted?.let{JSONObject(it.toString())}?:JSONObject.NULL))
        assertCurrent();if(output.size>maximum){output.fill(0);error("E2EE_SNAPSHOT_TOO_LARGE")};output
    }
    private fun snapshot(raw:ByteArray):JSONObject {
        check(raw.size in 1..maximum){"E2EE_REMINDER_SOURCE_INVALID"}
        val value=JSONObject(Charsets.UTF_8.newDecoder().decode(java.nio.ByteBuffer.wrap(raw)).toString())
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopeId","capturedAt","generation","pendingGeneration","accountScope","room","preferences","localPreferences","mounted"))
        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("ownerId")==ownerId&&value.get("scopeId")==scopeId&&value.get("accountScope")==account){"E2EE_SCOPE_BINDING_MISMATCH"}
        Instant.parse(value.getString("capturedAt"));E2eeCommands.integer(value.get("generation"));check(value.isNull("pendingGeneration")){"E2EE_REMINDER_GENERATION_REVIEW_REQUIRED"}
        return value
    }
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>):E2eePathReconciliation=error("E2EE_SCOPE_BINDING_MISMATCH")
    override suspend fun reconcile(local:ByteArray,previous:List<ByteArray>,context:E2eeMigrationSourceContext?):E2eePathReconciliation=safe {
        assertCurrent();val lease=requireNotNull(context){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(lease.ownerId==ownerId&&lease.scopeId==scopeId){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(previous.size<=32&&local.size+previous.sumOf{it.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val captured=snapshot(local);val ancestors=previous.map(::snapshot)
        val remote=legacyReminders(lease);assertCurrent()
        check(bytes(remote).size<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"}
        check(remote.get("ownerId")==ownerId&&remote.get("scopeId")==scopeId&&remote.get("migrationId")==lease.migrationId&&E2eeCommands.integer(remote.get("fence"),1)==lease.fence&&remote.get("sourceHash")==lease.sourceHash){"E2EE_SCOPE_BINDING_MISMATCH"}
        check(remote.getLong("legacyGeneration")==captured.getLong("generation")&&lease.generation>remote.getLong("legacyGeneration")){"E2EE_REMINDER_GENERATION_REVIEW_REQUIRED"}
        val old=remote.getJSONObject("legacyKey");E2eeKeys.exact(old,setOf("keyMode","key"));check(old.get("keyMode")=="empty"&&old.isNull("key")){"E2EE_KEY_BRIDGE_FORBIDDEN"}
        val result=reconciler.reconcile(captured,ancestors,lease,remote,assertCurrent){_,_->error("E2EE_KEY_BRIDGE_FORBIDDEN")}
        try{
            assertCurrent();check(result.content.all{it.domain=="workspace"&&it.objectId=="personal-reminders-preferences-v1"}
                &&result.localContent.all{it.domain=="workspace"&&(it.objectId=="personal-reminders-history-index-v1"||it.objectId.matches(Regex("personal-reminder-(?:history|capture):[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")))}){"E2EE_KEY_BRIDGE_FORBIDDEN"}
            check((result.content+result.localContent).sumOf{it.bytes.size.toLong()}<=E2eeMigrationSources.BYTE_BUDGET){"E2EE_SOURCE_TOO_LARGE"};result
        }catch(error:Throwable){(result.content+result.localContent).forEach{it.bytes.fill(0)};throw error}
    }
    override fun toString()="E2eeNativeRemindersSource([redacted])"
}
