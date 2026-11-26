package ru.genesis.calendar.auth

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.ReminderRecord
import ru.genesis.calendar.security.*

class E2eeNativeRemindersSourceTest {
    private val owner="reminder-owner"
    private val account=CloudAccountSnapshot.scopeFor(owner)
    private val lease=E2eeMigrationSourceContext(owner,"personal:$owner","reminder-migration",4,E2eeEnvelope.encode(ByteArray(32)),2)
    private inner class Rig {
        var live=true;var pending:Long?=null;var reads=0
        var rows=listOf(ReminderRecord(account,"reminder","task","occurrence",7,123,"pending"),ReminderRecord(account,"old-delivered","task","occurrence",8,99,"delivered",100))
        val preferences=JSONObject().put("genesis_habit_alarm_registry",JSONObject().put("snoozes",JSONArray().put("{\"scope\":\"$account\",\"scope\":\"foreign\"}")))
        val localPreferences=JSONObject().put("fullMoonLeadDays","3,1").put("newMoonLeadDays",JSONObject.NULL)
        val remote=JSONObject().put("ownerId",owner).put("scopeId",lease.scopeId).put("migrationId",lease.migrationId).put("fence",lease.fence).put("sourceHash",lease.sourceHash)
            .put("legacyGeneration",0).put("legacyKey",JSONObject().put("keyMode","empty").put("key",JSONObject.NULL))
        var engine:suspend (JSONObject,JSONObject,suspend (JSONObject,String)->Any)->E2eePathReconciliation={_,_,_->E2eePathReconciliation(true,listOf(E2eeMigrationContent("workspace","personal-reminders-preferences-v1","{}".toByteArray())))}
        fun current(){check(live){"E2EE_ACCOUNT_CHANGED"}}
        val source get()=E2eeNativeRemindersSource(owner,lease.scopeId,captureRows={current();E2eeRemindersRows(rows,preferences,localPreferences,0,pending,JSONObject().put("editors",JSONArray()))},assertCurrent=::current,
            legacyReminders={assertEquals(lease,it);reads++;JSONObject(remote.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                    assertEquals(lease,context);assertCurrent();return engine(local,remote,openLegacy)
                }})
        suspend fun run()=source.let{it.reconcile(it.captureLocal(),emptyList(),lease)}
    }
    private suspend fun rejects(code:String,operation:suspend ()->Unit){try{operation();fail("Expected $code")}catch(error:Exception){assertTrue(error.message?.contains(code)==true)}}
    @Test fun captureIncludesAllRoomStatesAndRawRegistryJsonBeforeAnySourceRead()=runBlocking{
        val f=Rig();val raw=f.source.captureLocal();assertEquals(0,f.reads);val value=JSONObject(raw.toString(Charsets.UTF_8));assertEquals(2,value.getJSONArray("room").length())
        assertEquals("delivered",value.getJSONArray("room").getJSONObject(1).getString("state"));assertEquals("3,1",value.getJSONObject("localPreferences").getString("fullMoonLeadDays"))
        assertEquals(f.preferences.toString(),value.getJSONObject("preferences").toString());assertFalse(value.has("legacyKey"));assertFalse(value.has("memory"));assertTrue(f.run().complete)
    }
    @Test fun pendingGenerationForeignRoomAndWrongContextRefuseBeforeAnyRead()=runBlocking{
        val pending=Rig();pending.pending=1;rejects("GENERATION_REVIEW_REQUIRED"){pending.run()};assertEquals(0,pending.reads)
        val foreign=Rig();foreign.rows=foreign.rows.map{it.copy(scope="foreign")};rejects("SCOPE_BINDING_MISMATCH"){foreign.source.captureLocal()};assertEquals(0,foreign.reads)
        val f=Rig();rejects("SCOPE_BINDING_MISMATCH"){f.source.reconcile(f.source.captureLocal(),emptyList(),E2eeMigrationSourceContext("foreign",lease.scopeId,lease.migrationId,lease.fence,lease.sourceHash,lease.generation))};assertEquals(0,f.reads)
    }
    @Test fun nativeReminderSourceHasNoOldKeyOpeningCapability()=runBlocking{
        val f=Rig();f.engine={_,_,open->rejects("KEY_BRIDGE_FORBIDDEN"){open(JSONObject(),"any-purpose")};E2eePathReconciliation(true,emptyList())};assertTrue(f.run().complete)
        f.remote.getJSONObject("legacyKey").put("keyMode","account");rejects("KEY_BRIDGE_FORBIDDEN"){f.run()}
    }
    @Test fun capturedInventoryCanResumeWithoutRecaptureOrLegacyAccountKey()=runBlocking{
        val f=Rig();val source=f.source;val raw=source.captureLocal();f.rows=emptyList();f.preferences.put("later",true)
        f.engine={local,_,_->assertEquals(2,local.getJSONArray("room").length());assertFalse(local.getJSONObject("preferences").has("later"));E2eePathReconciliation(true,emptyList())}
        assertTrue(f.source.reconcile(raw,listOf(raw),lease).complete);assertEquals(1,f.reads)
    }
    @Test fun oldReminderHistoryCannotBeReturnedAsRemoteExecutableContent()=runBlocking{
        val f=Rig();val bytes="private old action".toByteArray();f.engine={_,_,_->E2eePathReconciliation(true,listOf(E2eeMigrationContent("workspace","personal-reminder-history:00000000-0000-4000-8000-000000000000",bytes)))}
        rejects("KEY_BRIDGE_FORBIDDEN"){f.run()};assertArrayEquals(ByteArray(bytes.size),bytes)
    }
    @Test fun lateAccountLossWipesBothResultPlacements()=runBlocking{
        val f=Rig();val cloud=byteArrayOf(1,2);val local=byteArrayOf(3,4);f.engine={_,_,_->f.live=false;E2eePathReconciliation(true,
            listOf(E2eeMigrationContent("workspace","personal-reminders-preferences-v1",cloud)),listOf(E2eeMigrationContent("workspace","personal-reminders-history-index-v1",local)))}
        rejects("ACCOUNT_CHANGED"){f.run()};assertArrayEquals(ByteArray(2),cloud);assertArrayEquals(ByteArray(2),local)
    }
}
