package ru.genesis.calendar

import android.app.Notification
import android.app.NotificationManager
import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import java.time.*
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*

/** Run arm and verify in separate instrumentation invocations, with `am kill` between them.
 * Only the dedicated QA package and a synthetic, network-isolated account are touched. */
class BackgroundReminderTest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private val fixture get() = app.getSharedPreferences("genesis.validation.v1", Context.MODE_PRIVATE)
    private val uid get() = requireNotNull(fixture.getString("backgroundUid", null)) { "Run the arm phase first" }
    private val habitId get() = requireNotNull(fixture.getString("backgroundHabitId", null)) { "Run the arm phase first" }
    private fun assertDebug() {
        check(BuildConfig.DEBUG && app.packageName in setOf(
            "ru.genesis.calendar.g1qa.debug", "ru.genesis.calendar.v313.debug"))
    }

    @Test fun armAccountAlarmAndPersistOfflinePreferences() = runBlocking {
        assertDebug()
        check(app.workspaceScope == "internal-validation-v1") { "Fixture requires the isolated local debug workspace" }
        val uid = "genesis-background-validation-${UUID.randomUUID()}"
        val habitId = "background-reading-${UUID.randomUUID()}"
        val work = WorkManager.getInstance(app)
        val hadSyncWork = work.getWorkInfosForUniqueWork("genesis-cloud-sync-v1")
            .get(10, TimeUnit.SECONDS).any { !it.state.isFinished }
        check(fixture.edit().putString("backgroundUid", uid).putString("backgroundHabitId", habitId)
            .putBoolean("backgroundHadIsolated", fixture.contains("isolated"))
            .putBoolean("backgroundOriginalIsolated", fixture.getBoolean("isolated", false))
            .putBoolean("backgroundHadSyncWork", hadSyncWork)
            .putBoolean("isolated", true).putString("originalScope", app.workspaceScope).commit())
        work.cancelUniqueWork("genesis-cloud-sync-v1").result.get(10, TimeUnit.SECONDS)
        app.activateAccount(uid)
        CachedAccountEntry(app).save(ServerIdentity(uid, "Validation", "validation@example.invalid"),
            AccountSettings(listOf(LinkedGoogleAccount("validation", "validation@example.invalid", "Validation", true, false, false)),
                SyncRouting("fixed", listOf("validation"), emptyMap()), false, "standart", 0,
                "sacred", "profane", "24h", false, "ru"))
        assertTrue(app.scheduler.notificationsAllowed())
        assertTrue(app.scheduler.exactAllowed())
        val at = ZonedDateTime.now().plusMinutes(2).withSecond(0).withNano(0)
        val repo = HabitsRepository(app)
        val current = repo.workspace.first()
        repo.updateSettings(current.settings.copy(notifications = current.settings.notifications.copy(
            enabled = false, motivational = false, tone = "heroic", quietHoursStart = "00:00", quietHoursEnd = "00:00")))
        val habit = Habit(TrackerEntity.create("habit", id = habitId),
            "Проверка чтения", at.toLocalDate(), HabitEngine(GenesisCalendar()).defaultSchedule(at.toLocalDate(), CalendarMode.PROFANE),
            preferredTime = at.toLocalTime().toString(), reminder = HabitReminder(enabled = true))
        repo.save(habit)
        assertFalse("A personal reminder must work with the general reminder disabled", repo.workspace.first().settings.notifications.enabled)
        val prefs = LocalPreferences(app, app.workspaceScope)
        prefs.setPending("display", "lunar")
        prefs.setRemote("display", "sacred")
        assertEquals(CalendarMode.LUNAR, prefs.values.first().display)
        prefs.setPending("time", "12h")
        prefs.acknowledge(mapOf("time" to "24h"))
        assertEquals("12h", prefs.pending.first()["time"])
        assertTrue(app.database.dao().outbox(app.workspaceScope).any { it.entityId == "habits" })
        check(fixture.edit().putLong("expectedAt", at.toInstant().toEpochMilli()).commit())
        println("GENESIS_BACKGROUND_ALARM_AT=${at.toInstant().toEpochMilli()}")
    }

    @Test fun verifyDeliveryAfterProcessDeathAndDurableLocalData() = runBlocking {
        assertDebug()
        val uid = this@BackgroundReminderTest.uid
        val habitId = this@BackgroundReminderTest.habitId
        val scope = CloudAccountSnapshot.scopeFor(uid)
        val originalScope = requireNotNull(fixture.getString("originalScope", null))
        check(originalScope == "internal-validation-v1") { "The original fixture scope must be restorable" }
        try {
            assertEquals(scope, app.workspaceScope)
            assertEquals(uid, CachedAccountEntry(app).read(scope)?.identity?.uid)
            val repo = HabitsRepository(app)
            assertEquals("Проверка чтения", repo.workspace.first().habits.single { it.id == habitId }.title)
            assertFalse(repo.workspace.first().settings.notifications.enabled)
            val prefs = LocalPreferences(app, scope)
            assertEquals(CalendarMode.LUNAR, prefs.values.first().display)
            assertEquals(false, prefs.values.first().use24)
            assertEquals(mapOf("display" to "lunar", "time" to "12h"), prefs.pending.first())
            val notification = app.getSystemService(NotificationManager::class.java).activeNotifications
                .single { Uri.parse(it.tag.orEmpty()).pathSegments.firstOrNull() == scope &&
                    it.notification.extras.getString(Notification.EXTRA_TITLE) == "Проверка чтения" }
            assertTrue(notification.postTime >= fixture.getLong("expectedAt", Long.MAX_VALUE))
            val verificationStartedAt = InstrumentationRegistry.getArguments().getString("verificationStartedAt")?.toLong()
            if (verificationStartedAt != null) assertTrue("The OS must deliver before the app/test is relaunched",
                notification.postTime < verificationStartedAt)
            val body = notification.notification.extras.getCharSequence(Notification.EXTRA_TEXT).toString()
            assertTrue(body.contains("Проверка чтения"))
            assertFalse(body.contains("Героический зов:"))
            assertTrue(app.database.dao().outbox(scope).any { it.entityId == "habits" })
            println("GENESIS_BACKGROUND_DELIVERED_AND_OFFLINE_STATE_PRESERVED")
        } finally {
            withContext(NonCancellable) {
                val hadIsolated = fixture.getBoolean("backgroundHadIsolated", false)
                val originalIsolated = fixture.getBoolean("backgroundOriginalIsolated", false)
                val hadSyncWork = fixture.getBoolean("backgroundHadSyncWork", false)
                try {
                    // Even a scope assertion failure must clean only the account armed by this fixture.
                    app.scheduler.deactivate(scope)
                    LocalPreferences(app, scope).run {
                        acknowledge(pending.first())
                        set("display", "profane")
                        set("time", "24h")
                    }
                    app.database.withTransaction {
                        val dao = app.database.dao()
                        dao.clearAccountTaskCache(scope)
                        dao.clearReminders(scope)
                        dao.deleteDocument(scope, "habits")
                        CachedAccountEntry(app).clear(scope)
                        dao.outbox(scope).forEach {
                            dao.acknowledgeOutbox(scope, it.entityId, it.revision, it.operationId)
                        }
                    }
                } finally {
                    app.activateAccount(null)
                    try {
                        assertEquals(originalScope, app.workspaceScope)
                        app.scheduler.restore()
                        app.scheduler.restoreHabitNotifications()
                    } finally {
                        check(fixture.edit().let { editor ->
                            if (hadIsolated) editor.putBoolean("isolated", originalIsolated) else editor.remove("isolated")
                        }.remove("expectedAt").remove("originalScope").remove("backgroundUid").remove("backgroundHabitId")
                            .remove("backgroundHadIsolated").remove("backgroundOriginalIsolated").remove("backgroundHadSyncWork").commit())
                        if (hadSyncWork) CloudSyncWorker.enqueue(app)
                    }
                }
            }
        }
    }
}