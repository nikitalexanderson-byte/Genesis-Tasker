package ru.genesis.calendar.security

import android.content.Context
import android.content.Intent
import androidx.test.core.app.ActivityScenario
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.By
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.MainActivity
import ru.genesis.calendar.auth.NativeBackupMutationGuard
import ru.genesis.calendar.data.*

/** Emulator-only fixture; no release hooks or activation signatures are embedded in the app. */
class UpdateGateSafetyTest {
    @Test fun blockedRestartDeepLinkWritersAndOfflineRescuePreserveData() = runBlocking {
        val instrumentation=InstrumentationRegistry.getInstrumentation()
        val app=instrumentation.targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".qa1103.debug") && BuildConfig.GENESIS_HOST=="localhost")
        check(app.workspaceScope=="internal-validation-v1")
        val scope=app.workspaceScope
        app.getSharedPreferences("genesis.validation.v1",Context.MODE_PRIVATE).edit().putBoolean("isolated",true).commit()
        val store=app.getSharedPreferences("genesis.security.update-policy.v1",Context.MODE_PRIVATE)
        check(!store.contains("activated"))
        val dao=app.database.dao()
        val cipher=LocalCipher()
        val task=TaskRecord(scope,"rescue335",cipher.encrypt("{\"title\":\"synthetic unsynced task\"}","$scope/rescue335"),7,false)
        val tombstone=TaskRecord(scope,"rescue335-deleted","unreadable-cell-preserved",8,false,true)
        dao.putTask(task);dao.putTask(tombstone)
        dao.putOutbox(OutboxRecord(scope,task.id,7,"synthetic-operation"))
        dao.putDocument(DocumentRecord(scope,"rescue335-draft",cipher.encrypt("synthetic unsent draft","$scope/rescue335-draft"),3))
        fun restartGate() {
            for(name in listOf("preferences","floor","candidate")) UpdateGate::class.java.getDeclaredField(name).apply { isAccessible=true }.set(null,null)
            UpdateGate::class.java.getDeclaredField("sequence").apply { isAccessible=true }.setLong(null,0)
            UpdateGate.initialize(app)
        }
        try {
            // A corrupt durable activation must fail closed after process initialization.
            store.edit().putString("activated","corrupt-durable-activation").commit()
            restartGate()
            assertTrue(UpdateGate.blocked.value)
            assertThrows(kotlinx.coroutines.CancellationException::class.java) { cipher.encrypt("must not write","$scope/rescue335") }
            assertThrows(kotlinx.coroutines.CancellationException::class.java) { NativeBackupMutationGuard(scope).check() }
            var mutated=false
            try { app.scheduler.withMutation { mutated=true };fail("Writer entered the active gate") }
            catch(_:kotlinx.coroutines.CancellationException) { }
            assertFalse(mutated)
            UpdateGate.observeAvailable(Int.MAX_VALUE)
            assertTrue(UpdateGate.blocked.value)
            restartGate();assertTrue(UpdateGate.blocked.value)
            val key=EmergencyArchive.newKey()
            val archive=emergencySnapshot(app,key)
            assertFalse(archive.contains("synthetic unsynced"))
            val restored=JSONObject(EmergencyArchive.open(archive,key))
            val tasks=restored.getJSONArray("tasks")
            val rows=(0 until tasks.length()).map { tasks.getJSONObject(it) }
            assertEquals("synthetic unsynced task",JSONObject(rows.single { it.getString("id")==task.id }.getString("value")).getString("title"))
            assertTrue(rows.single { it.getString("id")==tombstone.id }.getBoolean("deleted"))
            assertEquals(tombstone.encrypted,rows.single { it.getString("id")==tombstone.id }.getString("value"))
            assertTrue(restored.getJSONArray("deviceDependentCells").toString().contains(tombstone.id))
            assertTrue(restored.getJSONArray("outbox").toString().contains("synthetic-operation"))
            assertTrue(restored.getJSONArray("documents").toString().contains("synthetic unsent draft"))
            assertEquals(task,dao.task(scope,task.id));assertEquals(tombstone,dao.task(scope,tombstone.id))
            val device=UiDevice.getInstance(instrumentation)
            ActivityScenario.launch<MainActivity>(Intent(app,MainActivity::class.java).putExtra("scope",scope).putExtra("taskId",task.id)).use { scenario ->
                assertTrue(device.wait(Until.hasObject(By.text("Необходимо обновление безопасности")),15000))
                scenario.recreate()
                assertTrue(device.wait(Until.hasObject(By.text("Необходимо обновление безопасности")),15000))
                assertFalse(device.hasObject(By.text("synthetic unsynced task")))
                device.takeScreenshot(java.io.File(app.getExternalFilesDir(null),"security-gate335-api.png"))
            }
            assertTrue(UpdateGate.blocked.value)
            assertEquals(task,dao.task(scope,task.id))
        } finally {
            store.edit().clear().commit();restartGate()
            dao.deleteCachedTask(scope,task.id);dao.deleteCachedTask(scope,tombstone.id)
            dao.deleteDocument(scope,"rescue335-draft")
        }
    }
}
