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
import ru.genesis.calendar.security.*
import java.security.KeyStore
import java.util.Base64
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

/** Actual Room/Keystore, packaged shared engine and new-root SQLite vault.
 * The signed legacy reply is synthetic, and no provider HTTP is available. */
@RunWith(AndroidJUnit4::class)
class TasksMigrationSourceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val owner="tasks-source-${UUID.randomUUID()}";val account=CloudAccountSnapshot.scopeFor(owner);val scope="personal:$owner"
        val alias="genesis.qa.tasks-source.${UUID.randomUUID()}";val cipher=LocalCipher(alias)
        val current=AtomicBoolean(true);val reads=AtomicInteger();val opens=AtomicInteger();val epoch:Long
        val oldKey=E2eeKeys.freshSecret();val oldEncoded=Base64.getEncoder().encodeToString(oldKey)
        val fresh=E2eeKeys.freshSecret();val newEncoded=E2eeEnvelope.encode(fresh);val root=E2eeEnvelope.importRoot(fresh).also{fresh.fill(0)}
        val device=E2eeKeys.generateDeviceKeys();val storage:E2eeSqliteStorage;val vault:UnlockedE2eeVault
        val lease=E2eeMigrationSourceContext(owner,scope,"source-${UUID.randomUUID()}",1,E2eeEnvelope.encode(ByteArray(32)),2)
        var onOpen:suspend ()->Unit={}
        val response=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("migrationId",lease.migrationId).put("fence",1)
            .put("sourceHash",lease.sourceHash).put("legacyGeneration",0).put("checkpointHash",E2eeEnvelope.encode(ByteArray(32))).put("directoryRevision",1)
            .put("tasks",JSONArray()).put("deletions",JSONArray()).put("links",JSONArray()).put("recovered",JSONArray()).put("recoveredDeletions",JSONArray())
            .put("creations",JSONArray()).put("creationTargets",JSONArray()).put("legacyKey",JSONObject().put("keyMode","account").put("key",oldEncoded))
            .put("providerCaches",JSONArray().put(JSONObject().put("kind","primary").put("accountId",owner).put("slot","current").put("version",JSONObject.NULL)
                .put("presence","missing").put("provenance","none").put("calendar",JSONObject.NULL).put("tasks",JSONObject.NULL)))
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"));app.activateAccount(owner);epoch=app.workspaceEpoch
            storage=E2eeSqliteStorage(app,allowCreate=true)
            vault=UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(owner,scope,"synthetic-device",1,1,1,"synthetic-fresh-root",device.signing.private,mapOf("synthetic-fresh-root" to root)){device.signing.public})
        }
        fun check(){check(current.get()&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"};vault.requireOpen()}
        private fun task(id:String,title:String)=JSONObject().put("id",id).put("title",title).put("description","Synthetic original text").put("dueDate","2026-11-19").put("done",false)
            .put("priority",5).put("zoneId","UTC").put("updatedAt",1).put("recurrenceMode","lunar").put("recurrencePattern","lunar-days").put("recurrenceDays",JSONArray().put(2).put(7))
            .put("recurrenceSeriesId","synthetic-private-series").put("recurrenceOriginalDate","2026-11-18").put("syncToGoogle",true).put("googleTaskId","synthetic-private-provider-id")
        suspend fun seed(){
            val dao=app.database.dao();val value=task("local-unsent","Synthetic private unsent edit")
            dao.putTask(TaskRecord(account,"local-unsent",cipher.encrypt(value.toString(),"$account/local-unsent"),4,false));dao.putOutbox(OutboxRecord(account,"local-unsent",4,"unacknowledged-original-operation"))
            val deleted=task("deleted-locally","Deleted private content")
            dao.putTask(TaskRecord(account,"deleted-locally",cipher.encrypt(deleted.toString(),"$account/deleted-locally"),2,false,true));dao.putOutbox(OutboxRecord(account,"deleted-locally",2,"original-delete-operation"))
            dao.putDocument(DocumentRecord(account,"aurora-account-key",cipher.encrypt(oldEncoded,"$account/aurora/$owner/account-key"),1))
            val id="restored-"+"a".repeat(32);val recovered=task(id,"Synthetic exact recovered task").put("restoredFrom",JSONObject().put("sourceId","old-source").put("accountId",JSONObject.NULL)
                .put("taskListId",JSONObject.NULL).put("taskId","old-task").put("backupId","old-backup"))
            val envelope=WorkspaceCipher.encrypt(recovered.toString().toByteArray(),oldKey,"genesis-mindmap-v1:$owner:recovered-task:v1:$id".toByteArray())
            response.getJSONArray("recovered").put(JSONObject().put("id",id).put("revision",3).put("iv",envelope.iv).put("ciphertext",envelope.ciphertext).put("updated_at","2026-11-19T09:00:00Z"))
            // The actual personal_task_creations producer stores a target hash,
            // never a serialized task. This receipt is inert migration history.
            response.getJSONArray("creations").put(JSONObject().put("task_id","historical-created-task").put("state","a".repeat(64)))
        }
        private val engine=NativeTasksSourceRuntime(app)
        val source by lazy{E2eeNativeTasksSource(owner,scope,captureRows={app.database.withTransaction{
            check();val dao=app.database.dao();E2eeTasksRows(dao.backupTasks(account),dao.outbox(account),listOfNotNull(dao.document(account,"aurora-account-key")),0,null,null)
        }},decryptTask={row->check();cipher.decrypt(row.encrypted,"$account/${row.id}")},decryptDocument={row->check();cipher.decrypt(row.encrypted,"$account/aurora/$owner/account-key")},assertCurrent=::check,
            legacyTasks={context->check();val saved=requireNotNull(vault.read("local-snapshot","tasks-source"));try{assertEquals(owner,JSONObject(saved.bytes.toString(Charsets.UTF_8)).getString("ownerId"))}finally{saved.bytes.fill(0)}
                assertEquals(lease.migrationId,context.migrationId);reads.incrementAndGet();JSONObject(response.toString())},reconciler=object:E2eePersonalSourceReconciler{
                override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation{
                    assertFalse((local.toString()+remote.toString()).contains(oldEncoded));assertFalse((local.toString()+remote.toString()).contains(newEncoded))
                    return engine.reconcile(local,previous,context,remote,assertCurrent){envelope,purpose->opens.incrementAndGet();onOpen();openLegacy(envelope,purpose)}
                }
            })}
        suspend fun run():E2eePathReconciliation=NativeLegacyScopeFence(app.database,owner,scope,::check).withFence{
            val raw=source.captureLocal();assertEquals(0,reads.get());try{vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","tasks-source",raw,null)))}finally{raw.fill(0)}
            val record=requireNotNull(storage.get(UnlockedE2eeVault.recordKey(vault.requireOpen(),"local-snapshot","tasks-source")))
            val wire=record.envelope.toJson().toString();assertFalse(wire.contains(oldEncoded));assertFalse(wire.contains("Synthetic private unsent edit"));assertFalse(wire.contains(newEncoded))
            val saved=requireNotNull(vault.read("local-snapshot","tasks-source"));try{source.reconcile(saved.bytes,emptyList(),lease)}finally{saved.bytes.fill(0)}
        }
        suspend fun originals()=app.database.dao().backupTasks(account).associate{it.id to it.encrypted}
        fun eraseAlias(){KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}}
        override fun close(){current.set(false);vault.lock();storage.close();oldKey.fill(0);eraseAlias();app.activateAccount(null)}
    }
    @Test fun actualTaskQueueDeletionsAndRecoveredHistoryRemainReadableUnderNewRootAfterOldKeysDisappear()=runBlocking{
        val f=Rig();try{
            f.seed();val before=f.originals();val operations=f.app.database.dao().outbox(f.account);val result=withTimeout(90000){f.run()}
            assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(1,f.opens.get());assertEquals(7,result.content.size)
            assertTrue(result.content.any{it.objectId=="personal-tasks-live-v1"})
            for(row in result.content){assertEquals("workspace",row.domain);assertFalse(row.objectId.contains("2026-11-19"));assertFalse(row.bytes.toString(Charsets.UTF_8).contains(f.oldEncoded));f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)));row.bytes.fill(0)}
            f.oldKey.fill(0);f.eraseAlias();val index=requireNotNull(f.vault.read("workspace","personal-task-index-v1"));val entries=try{JSONObject(index.bytes.toString(Charsets.UTF_8)).getJSONArray("tasks")}finally{index.bytes.fill(0)}
            val records=mutableMapOf<String,JSONObject>();for(i in 0 until entries.length()){val row=entries.getJSONObject(i);val record=requireNotNull(f.vault.read("workspace",row.getString("objectId")));try{records[row.getString("id")]=JSONObject(record.bytes.toString(Charsets.UTF_8))}finally{record.bytes.fill(0)}}
            assertTrue(records.getValue("deleted-locally").getBoolean("deleted"));val task=records.getValue("local-unsent").getJSONObject("value")
            assertEquals("Synthetic private unsent edit",task.getString("title"));assertEquals("2026-11-18",task.getString("recurrenceOriginalDate"));assertEquals("requires-new-consent",records.getValue("local-unsent").getString("externalCopy"))
            assertEquals(3,records.getValue("restored-"+"a".repeat(32)).getJSONObject("value").getInt("restoredRevision"));assertEquals(before,f.originals());assertEquals(operations,f.app.database.dao().outbox(f.account))
            val history=requireNotNull(f.vault.read("workspace","personal-task-history-v1"));try{assertEquals("a".repeat(64),JSONObject(history.bytes.toString(Charsets.UTF_8)).getJSONArray("creations").getJSONObject(0).getString("state"))}finally{history.bytes.fill(0)}
        }finally{f.close()}
    }
    @Test fun orphanTaskOperationBlocksBeforeSignedReadAndRetainsProtectedSnapshot()=runBlocking{
        val f=Rig();try{f.seed();f.app.database.dao().putOutbox(OutboxRecord(f.account,"missing-original-task",1,"retained-orphan"));val before=f.originals()
            try{f.run();fail("Expected queue review")}catch(error:IllegalStateException){assertEquals("E2EE_TASK_QUEUE_REVIEW_REQUIRED",error.message)}
            assertEquals(0,f.reads.get());assertEquals(before,f.originals());assertNotNull(f.vault.read("local-snapshot","tasks-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
    @Test fun providerFileOnlyTaskAndListReachNewRootWithoutAnyNativeProviderOrKeyBridge()=runBlocking{
        val f=Rig();try{
            f.seed();val before=f.originals();val operations=f.app.database.dao().outbox(f.account)
            val provider=f.response.getJSONArray("providerCaches").getJSONObject(0)
            provider.put("presence","stored").put("version","b".repeat(64)).put("provenance","current-grant")
                .put("tasks",JSONObject().put("items",JSONArray().put(JSONObject().put("id","file-only").put("title","Synthetic file-only private task")
                    .put("done",false).put("createdIn","google-tasks").put("googleTaskId","native-file-only").put("googleTaskListId","private-list")))
                    .put("lists",JSONArray().put(JSONObject().put("id","private-list").put("title","Synthetic file-only list").put("updatedAt",JSONObject.NULL).put("isDefault",true))))
            val result=withTimeout(90000){f.run()};assertTrue(result.complete);assertEquals(1,f.reads.get());assertEquals(1,f.opens.get())
            for(row in result.content)try{f.vault.write(listOf(UnlockedE2eeVault.Write(row.domain,row.objectId,row.bytes,null)))}finally{row.bytes.fill(0)}
            f.oldKey.fill(0);f.eraseAlias()
            val index=requireNotNull(f.vault.read("workspace","personal-task-index-v1"));val entries=try{JSONObject(index.bytes.toString(Charsets.UTF_8)).getJSONArray("tasks")}finally{index.bytes.fill(0)}
            var found=false
            for(i in 0 until entries.length()){
                val record=requireNotNull(f.vault.read("workspace",entries.getJSONObject(i).getString("objectId")))
                try{val objectValue=JSONObject(record.bytes.toString(Charsets.UTF_8));val task=objectValue.optJSONObject("value")
                    if(task?.optString("googleTaskId")=="native-file-only"){
                        found=true;assertEquals("Synthetic file-only private task",task.getString("title"));assertEquals(f.owner,task.getString("googleAccountId"))
                        assertTrue(task.getString("id").startsWith("account-"));assertEquals("requires-new-consent",objectValue.getString("externalCopy"))
                    }
                }finally{record.bytes.fill(0)}
            }
            assertTrue(found);val history=requireNotNull(f.vault.read("workspace","personal-task-history-v1"))
            try{assertEquals("Synthetic file-only list",JSONObject(history.bytes.toString(Charsets.UTF_8)).getJSONArray("providerCaches").getJSONObject(0).getJSONObject("tasks").getJSONArray("lists").getJSONObject(0).getString("title"))}finally{history.bytes.fill(0)}
            assertEquals(before,f.originals());assertEquals(operations,f.app.database.dao().outbox(f.account))
        }finally{f.close()}
    }
    @Test fun historicalProviderGrantRefusesMigrationWithoutInventingConsentAndRetainsOriginalRoomQueue()=runBlocking{
        val f=Rig();try{
            f.seed();val before=f.originals();val operations=f.app.database.dao().outbox(f.account)
            f.response.getJSONArray("providerCaches").getJSONObject(0).put("presence","stored").put("version","b".repeat(64)).put("provenance","historical-grant")
            try{withTimeout(90000){f.run()};fail("Expected provider history review")}catch(error:IllegalStateException){assertEquals("E2EE_PROVIDER_HISTORY_REVIEW_REQUIRED",error.message)}
            assertEquals(1,f.reads.get());assertEquals(0,f.opens.get());assertEquals(before,f.originals());assertEquals(operations,f.app.database.dao().outbox(f.account))
            assertNotNull(f.vault.read("local-snapshot","tasks-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
    @Test fun lostKeystoreKeyStopsBeforeIOAndNeverCreatesANewKeyOverOriginalTasks()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.eraseAlias();assertTrue(runCatching{f.run()}.isFailure);assertEquals(0,f.reads.get());assertEquals(before,f.originals());assertFalse(KeyStore.getInstance("AndroidKeyStore").apply{load(null)}.containsAlias(f.alias))}finally{f.close()}
    }
    @Test fun sourceClosesDuringRealLegacyOpeningOnAccountEpochChangeWithoutDroppingQueue()=runBlocking{
        val f=Rig();try{f.seed();val before=f.originals();f.onOpen={f.app.activateAccount(null);f.app.activateAccount(f.owner)}
            try{withTimeout(90000){f.run()};fail("Expected owner epoch cancellation")}catch(error:IllegalStateException){assertEquals("E2EE_ACCOUNT_CHANGED",error.message)}
            assertEquals(before,f.originals());assertEquals(2,f.app.database.dao().outbox(f.account).size)
        }finally{f.close()}
    }
    @Test fun originalDuplicateJsonFieldsReachStrictSharedParserInsteadOfBeingSilentlyProjected()=runBlocking{
        val f=Rig();try{f.seed();val old=requireNotNull(f.app.database.dao().task(f.account,"local-unsent"));val raw="{\"id\":\"local-unsent\",\"title\":\"First private\",\"title\":\"Second private\",\"done\":false}"
            f.app.database.dao().putTask(old.copy(encrypted=f.cipher.encrypt(raw,"${f.account}/local-unsent")));val before=f.originals()
            try{withTimeout(90000){f.run()};fail("Expected strict JSON refusal")}catch(error:IllegalStateException){assertEquals("E2EE_TASK_SOURCE_INVALID",error.message)}
            assertEquals(before,f.originals());assertNotNull(f.vault.read("local-snapshot","tasks-source")?.also{it.bytes.fill(0)})
        }finally{f.close()}
    }
}
