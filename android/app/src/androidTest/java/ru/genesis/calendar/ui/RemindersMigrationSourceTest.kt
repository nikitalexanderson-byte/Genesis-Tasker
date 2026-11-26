package ru.genesis.calendar.ui

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.reminders.*
import ru.genesis.calendar.security.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

/** Actual Room/SharedPreferences/DataStore, owner fence, packaged JS with no
 * network/storage capability, new-root encrypted local history and readback.
 * Synthetic QA package only. This is not signed product-lifecycle acceptance. */
@RunWith(AndroidJUnit4::class)
class RemindersMigrationSourceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="reminder-source-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val live=AtomicBoolean(true);val reads=AtomicInteger();val opens=AtomicInteger();val epoch:Long
        val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage;val vault:UnlockedE2eeVault
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        val canary="Synthetic private unsent reminder 🌙";val now="2026-11-19T14:00:00Z"
        val names=listOf("genesis_habit_reminder_preferences","genesis_habit_alarm_registry","genesis_sleep_alarm_registry","genesis_moon_alarm_registry","genesis.advice.alarms.v1")
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1).put("sourceHash",lease.sourceHash)
            .put("legacyGeneration",0).put("checkpointHash",lease.sourceHash).put("directoryRevision",1).put("legacyKey",JSONObject().put("keyMode","empty").put("key",JSONObject.NULL))
            .apply{for(name in listOf("habitProfiles","habitDevices","habitDeliveries","adviceDays","adviceDeliveries","sharedPreferences"))put(name,JSONArray())}
        var onRead:()->Unit={};var mounted=JSONObject().put("editors",JSONArray().put(JSONObject().put("source","habit-reminder-input").put("mounted",false)
            .put("state",JSONObject().put("value","1,,").put("note",canary).put("operationId","exact-uncertain-operation"))))
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner);epoch=app.workspaceEpoch
            for(name in names)check(app.getSharedPreferences(name,0).edit().clear().commit())
            storage=E2eeSqliteStorage(app,allowCreate=true);val fresh=E2eeKeys.freshSecret()
            val root=try{E2eeEnvelope.importRoot(fresh)}finally{fresh.fill(0)}
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-root",device.signing.private,mapOf("synthetic-root" to root)){device.signing.public})
        }
        fun check(){check(live.get()&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        fun target(id:String="occurrence")=JSONObject().put("id",id).put("kind","habit").put("date","2026-11-19").put("at",now).put("timeZone","UTC").put("allowDuringQuietHours",false)
            .put("habitId","synthetic-habit").put("ruleId","synthetic-rule").put("action","input")
        suspend fun seed(count:Int=1,large:Boolean=false){
            for((index,state)in listOf("pending","delivered","cancelled").withIndex())app.database.dao().putReminder(ReminderRecord(account,"local-$index","task","occurrence",7,123L+index,state,if(state=="delivered")145 else null))
            saveHabitReminderFrequency(app,account,HabitReminderFrequency(24,15));LocalPreferences(app,account).set("fullMoonLeadDays","3,1")
            val uri="genesis://habit-reminder/$account/old-event"
            val snooze=JSONObject().put("scope",account).put("requestId",uri).put("habitId","synthetic-habit").put("date","2026-11-19").put("at",123).put("ruleId","synthetic-rule").put("until",456).toString()
            check(app.getSharedPreferences("genesis_habit_alarm_registry",0).edit().putStringSet("alarms",setOf(uri)).putStringSet("delivered",setOf(uri))
                .putStringSet("deliveryTimes",setOf("$uri\t145")).putStringSet("snoozes",setOf(snooze)).putStringSet("snoozeRequests",setOf(uri)).commit())
            response.getJSONArray("habitDevices").put(JSONObject().put("id","old-device").put("device_key","old-device-key").put("encrypted_subscription","inert-old-subscription")
                .put("enabled",0).put("request_id","exact-uncertain-request").put("request_hash","a".repeat(64)).put("time_zone","UTC").put("max_per_day",24).put("snooze_minutes",15).put("revision",9).put("created_at",now).put("updated_at",now))
            for(index in 0 until count)response.getJSONArray("habitDeliveries").put(JSONObject().put("id","old-delivery-$index").put("device_id","old-device").put("profile_revision",4).put("event_key",java.security.MessageDigest.getInstance("SHA-256").digest("event-$index".toByteArray()).joinToString(""){"%02x".format(it)})
                .put("encrypted_target",if(large)"x".repeat(220000)else "exact-old-ciphertext").put("target_json",target("occurrence-$index").toString()).put("scheduled_at",now).put("expires_at",now)
                .put("state","failed").put("sent_at",JSONObject.NULL).put("reserved_at",now).put("snooze_of",JSONObject.NULL).put("error_code","OLD_FAILURE").put("created_at",now).put("updated_at",now))
            response.getJSONArray("sharedPreferences").put(JSONObject().put("settings_json","{ \"enabled\":false, \"privateNote\":\"$canary\" }").put("revision",3).put("updated_at",now))
        }
        val source get()=E2eeNativeRemindersSource(owner,scope,captureRows={
            check();val local=LocalPreferences(app,account).reminderMigrationRaw();val preferences=reminderMigrationRegistries(app)
            val rows=app.database.withTransaction{check();app.database.dao().reminders(account)};check()
            E2eeRemindersRows(rows,preferences,local,0,null,JSONObject(mounted.toString()))
        },assertCurrent=::check,legacyReminders={
            assertNotNull(vault.read("local-snapshot","reminder-source")?.also{it.bytes.fill(0)});reads.incrementAndGet();onRead();JSONObject(response.toString())
        },reconciler=object:E2eePersonalSourceReconciler{
            override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                assertFalse(local.has("legacyKey"));return NativeRemindersSourceRuntime(app).reconcile(local,previous,context,remote,assertCurrent){_,_->opens.incrementAndGet();error("E2EE_KEY_BRIDGE_FORBIDDEN")}
            }})
        suspend fun capture(){val raw=source.captureLocal();try{assertEquals(0,reads.get());vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","reminder-source",raw,null)))}finally{raw.fill(0)}}
        suspend fun reconcile():E2eePathReconciliation{val saved=requireNotNull(vault.read("local-snapshot","reminder-source"));try{return source.reconcile(saved.bytes,emptyList(),lease)}finally{saved.bytes.fill(0)}}
        suspend fun run()=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{capture();reconcile()}
        override fun close(){live.set(false);vault.lock();storage.close();app.activateAccount(null)}
    }
    private suspend fun rejected(code:String,operation:suspend ()->Unit){try{operation();fail("Expected $code")}catch(error:Exception){assertTrue("Unexpected refusal class/code",error.message?.contains(code)==true)}}
    @Test fun actualRoomRegistryAndDetachedInputSurvivePackagedReconciliationAndNewRootReadback()=runBlocking{
        val f=Rig();try{f.seed();val before=reminderMigrationRegistries(f.app).toString();val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(0,f.opens.get());assertEquals(1,f.reads.get())
            assertEquals(listOf("personal-reminders-preferences-v1"),result.content.map{it.objectId});assertTrue(result.content.none{it.bytes.toString(Charsets.UTF_8).contains("exact-uncertain-request")})
            val plan=E2eeMigrationLocal.plan(f.lease.migrationId,result.localContent);try{f.vault.write(plan.writes)}finally{plan.writes.forEach{it.bytes.fill(0)};(result.content+result.localContent).forEach{it.bytes.fill(0)}}
            val entries=E2eeMigrationLocal.validate(plan.entries,f.lease.migrationId,setOf("workspace"))
            val index=E2eeMigrationLocal.open(f.vault,entries.single{it.objectId=="personal-reminders-history-index-v1"})
            val captureId=try{val value=JSONObject(index.bytes.toString(Charsets.UTF_8));assertEquals("history-only",value.getString("execution"));assertEquals("fresh-consent-required",value.getString("deliveryAuthority"));value.getJSONArray("captures").getString(0)}finally{index.bytes.fill(0)}
            val capture=E2eeMigrationLocal.open(f.vault,entries.single{it.objectId==captureId});try{val local=JSONObject(capture.bytes.toString(Charsets.UTF_8)).getJSONObject("local");assertEquals(3,local.getJSONArray("room").length())
                assertEquals("1,,",local.getJSONArray("editors").getJSONObject(0).getJSONObject("state").getString("value"));assertTrue(capture.bytes.toString(Charsets.UTF_8).contains(f.canary))}finally{capture.bytes.fill(0)}
            assertEquals(before,reminderMigrationRegistries(f.app).toString());assertEquals(3,f.app.database.dao().reminders(f.account).size)
        }finally{f.close()}
    }
    @Test fun duplicateServerTargetsAndRawSnoozeScopesAreRejectedByTheActualSharedParser()=runBlocking{
        for(local in listOf(false,true)){val f=Rig();try{f.seed();if(local){val raw="{\"scope\":\"${f.account}\",\"scope\":\"foreign\"}";assertTrue(f.app.getSharedPreferences("genesis_habit_alarm_registry",0).edit().putStringSet("snoozes",setOf(raw)).commit())}
            else f.response.getJSONArray("habitDeliveries").getJSONObject(0).put("target_json","{\"id\":\"one\",\"id\":\"two\"}")
            rejected("E2EE_REMINDER_SOURCE_INVALID"){withTimeout(90000){f.run()}};assertEquals(0,f.opens.get());assertEquals(3,f.app.database.dao().reminders(f.account).size)
        }finally{f.close()}}
    }
    @Test fun aLostOrSwitchedAccountCannotContinueIntoThePackagedEngine()=runBlocking{
        val f=Rig();try{f.seed();f.onRead={f.live.set(false)};rejected("E2EE_ACCOUNT_CHANGED"){f.run()};assertEquals(0,f.opens.get());assertEquals(3,f.app.database.dao().reminders(f.account).size)}finally{f.close()}
    }
    @Test fun lateNativeSchedulersAndPreferenceWritersCannotCrossThePersistentPreparingFence()=runBlocking{
        val f=Rig();try{f.seed();NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{f.capture()};val before=reminderMigrationRegistries(f.app).toString()
            rejected("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN"){saveHabitReminderFrequency(f.app,f.account,HabitReminderFrequency(4,5))}
            rejected("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN"){LocalPreferences(f.app,f.account).set("fullMoonLeadDays","2")}
            rejected("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN"){f.app.scheduler.restoreHabitNotifications()}
            rejected("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN"){MoonReminderScheduler.restore(f.app)}
            rejected("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN"){SleepReminderScheduler.restore(f.app)}
            assertEquals(before,reminderMigrationRegistries(f.app).toString());assertEquals("3,1",LocalPreferences(f.app,f.account).reminderMigrationRaw().getString("fullMoonLeadDays"))
        }finally{f.close()}
    }
    @Test fun alreadyAdmittedNativeReminderOperationDrainsBeforeCaptureWithoutNestedPermitDeadlock()=runBlocking{
        val f=Rig();try{f.seed();val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>();val captured=AtomicBoolean(false)
            val operation=async(Dispatchers.Default){legacyReminderOperation(f.app,f.account){entered.complete(Unit);release.await();saveHabitReminderFrequency(f.app,f.account,HabitReminderFrequency(64,30))}}
            entered.await();val migration=async(Dispatchers.Default){NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{f.capture();captured.set(true)}}
            delay(100);assertFalse(captured.get());release.complete(Unit);withTimeout(10000){operation.await();migration.await()};assertTrue(captured.get())
            val saved=requireNotNull(f.vault.read("local-snapshot","reminder-source"));try{assertEquals(64,JSONObject(saved.bytes.toString(Charsets.UTF_8)).getJSONObject("preferences").getJSONObject("genesis_habit_reminder_preferences").getInt("${f.account}:max"))}finally{saved.bytes.fill(0)}
        }finally{f.close()}
    }
    @Test fun accountChangesAndPreparingFencesCancelBackgroundJobsWithoutCrashingOrWriting()=runBlocking{
        val f=Rig();val failures=AtomicReference<Throwable?>()
        val background=CoroutineScope(SupervisorJob()+Dispatchers.Default+CoroutineExceptionHandler{_,error->failures.set(error)})
        try{
            f.seed();val before=reminderMigrationRegistries(f.app).toString();val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
            val stale=background.launch{legacyReminderOperation(f.app,f.account){current->entered.complete(Unit);release.await();current();saveHabitReminderFrequency(f.app,f.account,HabitReminderFrequency(4,5))}}
            entered.await();f.app.activateAccount("next-${UUID.randomUUID()}");release.complete(Unit);withTimeout(10000){stale.join()}
            assertTrue(stale.isCancelled);assertNull(failures.get());assertEquals(before,reminderMigrationRegistries(f.app).toString())
            f.app.activateAccount(f.owner)
            NativeLegacyScopeFence(f.app.database,f.owner,f.scope,{Unit}).withFence{Unit}
            val blocked=background.launch{MoonReminderScheduler.restore(f.app)};withTimeout(10000){blocked.join()}
            assertTrue(blocked.isCancelled);assertNull(failures.get());assertEquals(before,reminderMigrationRegistries(f.app).toString())
            // A stale callback must also recheck after waiting for the scheduler
            // mutex, before it can read the next account's dynamic workspace.
            f.app.activateAccount(null);val local=f.app.workspaceScope;val held=CompletableDeferred<Unit>();val unlock=CompletableDeferred<Unit>()
            val first=background.launch{f.app.scheduler.withMutation{held.complete(Unit);unlock.await()}};held.await()
            val ran=AtomicBoolean(false)
            val second=background.launch(start=CoroutineStart.UNDISPATCHED){f.app.scheduler.withMutation(local){ran.set(true)}}
            f.app.activateAccount("after-wait-${UUID.randomUUID()}");unlock.complete(Unit);withTimeout(10000){first.join();second.join()}
            assertTrue(first.isCancelled);assertTrue(second.isCancelled);assertFalse(ran.get());assertNull(failures.get())
        }finally{background.cancel();f.close()}
    }
    @Test fun verifiedIncomingBootstrapImportsItsOwnScopeBeforeActivationAndStillHonorsThatScopesFence()=runBlocking{
        val f=Rig();try{
            val incomingOwner="incoming-${UUID.randomUUID()}";val incoming=CloudAccountSnapshot.scopeFor(incomingOwner)
            val snapshot=CloudAccountSnapshot.fromBootstrap(JSONObject().put("user",JSONObject().put("uid",incomingOwner).put("email","fixture@example.invalid"))
                .put("workspace",JSONObject().put("keyMode","new").put("envelope",JSONObject.NULL)).put("tasks",JSONArray()))
            NativeLegacyScopeFence(f.app.database,f.owner,f.scope,f::check).withFence{Unit}
            assertEquals(f.account,f.app.workspaceScope);val checks=AtomicInteger()
            assertEquals(CloudAccountImporter.Result.IMPORTED,CloudAccountImporter(f.app.database,f.app.scheduler).import(snapshot){f.check();checks.incrementAndGet()})
            assertEquals(f.account,f.app.workspaceScope);assertTrue(checks.get()>2);val original=requireNotNull(f.app.database.dao().document(incoming,"structure")).encrypted
            NativeLegacyScopeFence(f.app.database,incomingOwner,"personal:$incomingOwner",f::check).withFence{Unit}
            rejected("E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN"){CloudAccountImporter(f.app.database,f.app.scheduler).import(snapshot){f.check()}}
            assertEquals(original,f.app.database.dao().document(incoming,"structure")?.encrypted)
            rejected("E2EE_ACCOUNT_CHANGED"){CloudAccountImporter(f.app.database,f.app.scheduler).import(snapshot){throw AuthApiError("E2EE_ACCOUNT_CHANGED")}}
        }finally{f.close()}
    }
    @Test fun completeReminderHistoryAboveOneMessageLimitUsesBackpressuredNativeOutput()=runBlocking{
        val f=Rig();try{f.seed(80,true);val result=withTimeout(120000){f.run()};assertTrue(result.complete);assertTrue(result.localContent.sumOf{it.bytes.size.toLong()}>16L*1024*1024)
            assertEquals(80,result.localContent.count{it.objectId.startsWith("personal-reminder-history:")} - 2)
            val plan=E2eeMigrationLocal.plan(f.lease.migrationId,result.localContent);try{f.vault.write(plan.writes)}finally{plan.writes.forEach{it.bytes.fill(0)};(result.content+result.localContent).forEach{it.bytes.fill(0)}}
            val entries=E2eeMigrationLocal.validate(plan.entries,f.lease.migrationId,setOf("workspace"));val read=E2eeMigrationLocal.open(f.vault,entries.first{it.objectId.startsWith("personal-reminder-history:")})
            try{assertEquals("history-only",JSONObject(read.bytes.toString(Charsets.UTF_8)).getString("execution"))}finally{read.bytes.fill(0)};assertEquals(0,f.opens.get())
        }finally{f.close()}
    }
}
