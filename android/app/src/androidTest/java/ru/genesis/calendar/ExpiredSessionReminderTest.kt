package ru.genesis.calendar

import android.content.Context
import android.net.Uri
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import androidx.work.WorkManager
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import java.time.*
import java.util.UUID
import java.util.concurrent.TimeUnit

/** Anonymous production responses are exercised against disposable, isolated QA accounts only. */
class ExpiredSessionReminderTest {
    @Test fun expiredServerSessionPreservesEveryAccountLocalDataAndHabitAlarms() = runBlocking {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName in setOf(
            "ru.genesis.calendar.g1qa.debug", "ru.genesis.calendar.v313.debug"))
        val originalScope = app.workspaceScope
        val cache = CachedAccountEntry(app)
        val originalUid = cache.read(originalScope)?.identity?.uid
        check(originalScope == "internal-validation-v1" || originalUid != null) {
            "The starting workspace must be restorable; do not run between reminder arm and verify."
        }
        val client = AuthSessionClient(app)
        val anonymous = withContext(Dispatchers.IO) { client.session(client.begin()) }
        check(AuthProtocol.identity(anonymous) == null) { "Never replace an authenticated native session in this fixture." }
        val controller = AuthController.get(app)
        check(!controller.state.value.ready || controller.state.value.requiresSignIn) {
            "Never replace an authenticated controller in this fixture."
        }
        val fixture = app.getSharedPreferences("genesis.validation.v1", Context.MODE_PRIVATE)
        val originalIsolation = fixture.all["isolated"] as? Boolean
        val reminderScope = app.getSharedPreferences("genesis.reminder.scope.v1", Context.MODE_PRIVATE)
        val hadReminderScope = reminderScope.contains("workspace")
        val work = WorkManager.getInstance(app)
        val hadSyncWork = work.getWorkInfosForUniqueWork("genesis-cloud-sync-v1")
            .get(10, TimeUnit.SECONDS).any { !it.state.isFinished }
        val ownScopes = mutableListOf<String>()
        try {
            check(fixture.edit().putBoolean("isolated", true).commit())
            work.cancelUniqueWork("genesis-cloud-sync-v1").result.get(10, TimeUnit.SECONDS)
            // Start through the controller so its generation invalidates an earlier worker/UI operation.
            // activateAccount alone deliberately does not cancel authentication jobs.
            withContext(Dispatchers.Main.immediate) { controller.checkSession() }
            withTimeout(45_000) { controller.state.first { !it.busy } }
            for (kind in listOf("unlisted-consumer", "workspace-domain", "legacy-linked")) {
                val uid = "expired-session-$kind-${UUID.randomUUID()}"
                val habitId = "session-reading-${UUID.randomUUID()}"
                val scope = CloudAccountSnapshot.scopeFor(uid)
                ownScopes += scope
                app.activateAccount(uid)
                val settings = AccountSettings(listOf(LinkedGoogleAccount("test", "test@example.invalid", "Validation", true, false, false)),
                    SyncRouting("fixed", listOf("test"), emptyMap()), false, "standart", 0,
                    "sacred", "profane", "24h", false, "ru")
                cache.save(ServerIdentity(uid, "Validation", "test@example.invalid"), settings)
                val repo = HabitsRepository(app)
                val at = LocalDateTime.now().plusHours(1).withSecond(0).withNano(0)
                repo.save(Habit(TrackerEntity.create("habit", id = habitId), "Локальное чтение", at.toLocalDate(),
                    HabitEngine(GenesisCalendar()).defaultSchedule(at.toLocalDate(), CalendarMode.PROFANE),
                    preferredTime = at.toLocalTime().toString(),
                    reminder = HabitReminder(enabled = true, allowDuringQuietHours = true)))
                val preferences = LocalPreferences(app, scope)
                preferences.setPending("display", "lunar")
                val before = ownAlarms(app, scope)
                assertTrue("The synthetic habit must have its own scheduled alarm", before.isNotEmpty())
                val documentBefore = app.database.dao().document(scope, "habits")
                val outboxBefore = app.database.dao().outbox(scope)
                assertNotNull(documentBefore)
                withContext(Dispatchers.Main.immediate) { controller.checkSession() }
                assertTrue(withTimeout(45_000) { controller.synchronizeInBackground() })
                assertEquals(scope, app.workspaceScope)
                assertEquals(uid, controller.state.value.user?.uid)
                assertTrue(controller.state.value.ready)
                assertTrue(controller.state.value.requiresSignIn)
                assertEquals(uid, cache.read(scope)?.identity?.uid)
                assertEquals("Локальное чтение", repo.workspace.first().habits.single { it.id == habitId }.title)
                assertEquals("lunar", preferences.pending.first()["display"])
                assertEquals(before, ownAlarms(app, scope))
                assertEquals(documentBefore, app.database.dao().document(scope, "habits"))
                assertEquals(outboxBefore, app.database.dao().outbox(scope))
                assertTrue(outboxBefore.any { it.entityId == "habits" })
            }
        } finally {
            withContext(NonCancellable) {
                // Invalidate the last synthetic generation before removing its cache. The normal
                // session check restores the controller as well as the original workspace scope.
                app.activateAccount(originalUid)
                try {
                    withContext(Dispatchers.Main.immediate) { controller.checkSession() }
                    withTimeout(45_000) { controller.state.first { !it.busy } }
                } finally {
                    try {
                        for (scope in ownScopes) {
                            app.scheduler.deactivate(scope)
                            LocalPreferences(app, scope).run {
                                acknowledge(pending.first())
                                set("display", "profane")
                            }
                            app.database.withTransaction {
                                val dao = app.database.dao()
                                dao.clearAccountTaskCache(scope)
                                dao.clearReminders(scope)
                                dao.deleteDocument(scope, "habits")
                                dao.deleteDocument(scope, "account-entry")
                                dao.outbox(scope).forEach {
                                    dao.acknowledgeOutbox(scope, it.entityId, it.revision, it.operationId)
                                }
                            }
                        }
                    } finally {
                        try {
                            if (!hadReminderScope) check(reminderScope.edit().remove("workspace").commit())
                            app.scheduler.restore()
                            app.scheduler.restoreHabitNotifications()
                        } finally {
                            check(fixture.edit().let { editor ->
                                if (originalIsolation == null) editor.remove("isolated")
                                else editor.putBoolean("isolated", originalIsolation)
                            }.commit())
                            if (hadSyncWork) CloudSyncWorker.enqueue(app)
                        }
                    }
                }
            }
        }
    }

    private fun ownAlarms(app: GenesisApplication, scope: String): Set<String> = app
        .getSharedPreferences("genesis_habit_alarm_registry", Context.MODE_PRIVATE)
        .getStringSet("alarms", emptySet()).orEmpty()
        .filterTo(linkedSetOf()) { Uri.parse(it).pathSegments.firstOrNull() == scope }
}