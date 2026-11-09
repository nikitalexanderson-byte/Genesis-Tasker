package ru.genesis.calendar

import android.content.Context
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.data.LocalTask

/** The runner changes POST_NOTIFICATIONS only for this task's disposable package. */
class FullQaNotificationPermissionTest {
    private val app get() = (InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication).also {
        check(BuildConfig.DEBUG && it.packageName == "ru.genesis.calendar.qa1103.debug")
        check(android.os.Build.VERSION.SDK_INT >= 33 && !it.workspaceScope.startsWith("account-"))
    }
    private val id = "full-qa-permission-preserved-task"
    private val fixture get() = app.getSharedPreferences("full.qa.notification.permission", Context.MODE_PRIVATE)

    @Test fun prepareGrantedPermissionAndPersistentReminder() = runBlocking {
        assertTrue(app.scheduler.notificationsAllowed())
        val task = app.repository.save(LocalTask(id = id, title = "Synthetic permission preservation",
            reminderAt = System.currentTimeMillis() + 600_000))
        val row = requireNotNull(app.database.dao().task(app.workspaceScope, id))
        assertTrue(fixture.edit().putString("ciphertext", row.encrypted).putLong("revision", task.revision).commit())
        assertTrue(app.database.dao().taskReminders(app.workspaceScope, id).any { it.state == "pending" })
    }

    @Test fun deniedPermissionSuppressesNotificationsWithoutDeletingData() = runBlocking {
        assertFalse(app.scheduler.notificationsAllowed())
        assertNull(app.scheduler.scheduleDiagnosticNotification(60_000))
        assertFalse(app.scheduler.showHabitTonePreview("calm", "ru"))
        assertPreserved()
    }

    @Test fun restoredPermissionKeepsTheSameEncryptedReminder() = runBlocking {
        assertTrue(app.scheduler.notificationsAllowed())
        assertPreserved()
        app.repository.delete(id)
        assertTrue(fixture.edit().clear().commit())
    }

    private suspend fun assertPreserved() {
        val task = requireNotNull(app.repository.get(id))
        assertEquals("Synthetic permission preservation", task.title)
        assertEquals(fixture.getLong("revision", -1), task.revision)
        assertEquals(fixture.getString("ciphertext", null), app.database.dao().task(app.workspaceScope, id)!!.encrypted)
        assertTrue(app.database.dao().taskReminders(app.workspaceScope, id).any { it.state == "pending" })
    }
}
