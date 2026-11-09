package ru.genesis.calendar

import android.app.NotificationManager
import android.content.Context
import java.time.LocalDate
import androidx.room.Room
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.data.*
import ru.genesis.calendar.auth.*
import androidx.work.WorkManager

/** These synthetic records exist only in androidTest and the .debug validation scope. */
@RunWith(AndroidJUnit4::class)
class ReminderFlowTest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private val fixtureId = "internal-reminder-validation-v1"

    @Test fun prepareScreenOffReminder() = runBlocking {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        check(app.scheduler.notificationsAllowed()) { "Notification permission must be granted first" }
        check(app.scheduler.exactAllowed()) { "Exact alarm access must be granted first" }
        val old = app.repository.get(fixtureId)
        val task = app.repository.save(LocalTask(id=fixtureId,title="Изолированный тест напоминания",
            description="Синтетическая запись androidTest, не данные аккаунта",reminderAt=System.currentTimeMillis()+90_000,
            revision=old?.revision ?: 0))
        val independent = Room.databaseBuilder(app,GenesisDatabase::class.java,"genesis.db").build()
        try {
            val record = independent.dao().task(app.workspaceScope,fixtureId)!!
            assertFalse(record.encrypted.contains(task.title))
            assertEquals(task.title, LocalTask.from(record,LocalCipher().decrypt(record.encrypted,
                app.workspaceScope + "/" + fixtureId)).title)
        } finally { independent.close() }
        val row=app.database.dao().taskReminders(app.workspaceScope,fixtureId).single { it.state=="pending" }
        assertEquals(task.reminderAt,row.at)
    }

    @Test fun verifyDeliveredAndCompleteAction() = runBlocking {
        val row=app.database.dao().taskReminders(app.workspaceScope,fixtureId).single { it.state=="delivered" }
        assertEquals("delivered",row.state)
        assertNotNull(row.deliveredAt)
        assertTrue("Alarm should arrive after due time",row.deliveredAt!! >= row.at - 1000)
        val manager=app.getSystemService(NotificationManager::class.java)
        val notification=manager.activeNotifications.single { it.tag == app.workspaceScope + "/" + row.id }
        assertEquals("Время запланированного действия",notification.notification.extras.getCharSequence("android.text").toString())
        val action=notification.notification.actions.first { it.title.toString()=="Выполнено" }.actionIntent
        action.send()
        repeat(40) {
            if(app.repository.get(fixtureId)?.done==true) return@repeat
            Thread.sleep(100)
        }
        assertTrue(app.repository.get(fixtureId)!!.done)
        val revision=app.repository.get(fixtureId)!!.revision
        action.send()
        Thread.sleep(300)
        assertEquals(revision,app.repository.get(fixtureId)!!.revision)
        assertTrue(app.database.dao().taskReminders(app.workspaceScope,fixtureId).all{it.state=="cancelled"})
        assertTrue(manager.activeNotifications.none { it.tag==notification.tag })
    }

    @Test fun notificationOpensTheStoredRecord() = runBlocking {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        check(!app.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) {
            "Unlock device manually before the notification-opening test"
        }
        // Notification entry uses the same account gate as the release launcher.
        val fixture = app.getSharedPreferences("genesis.validation.v1", Context.MODE_PRIVATE)
        fixture.edit().putBoolean("isolated", true).commit()
        WorkManager.getInstance(app).cancelUniqueWork("genesis-cloud-sync-v1").result.get()
        val uid = "notification-open-validation-v1"
        app.activateAccount(uid)
        val validationScope = app.workspaceScope
        CachedAccountEntry(app).save(ServerIdentity(uid, "Validation", "validation@example.invalid"),
            AccountSettings(listOf(LinkedGoogleAccount("validation", "validation@example.invalid", "Validation", true, false, false)),
                SyncRouting("fixed", listOf("validation"), emptyMap()), false,
                "standart", 0, "sacred", "profane", "24h", false, "ru"))
        assertNotNull("The synthetic account cache must be valid", CachedAccountEntry(app).read(validationScope))
        try {
        // This tests system-notification navigation, not delayed AlarmManager delivery.
        // Keep it independent of the screen-off test and its completed fixture.
        val openId="internal-open-validation-v1"
        val old=app.repository.get(openId)
        app.repository.save(LocalTask(id=openId,title="Изолированный тест открытия",
            reminderAt=System.currentTimeMillis()-1000,revision=old?.revision ?: 0))
        val opening=app.database.dao().taskReminders(app.workspaceScope,openId).single{it.state=="pending"}
        app.scheduler.deliver(opening.scope,opening.id,opening.revision)
        val row=app.database.dao().taskReminders(app.workspaceScope,openId).single{it.state=="delivered"}
        assertEquals("delivered",row.state)
        val notification=app.getSystemService(NotificationManager::class.java).activeNotifications.single {
            it.tag==app.workspaceScope + "/" + row.id
        }
        val device=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        check(!app.getSystemService(android.app.KeyguardManager::class.java).isKeyguardLocked) {
            "Unlock device manually before the notification-opening test"
        }
        device.openNotification()
        val visible=device.wait(Until.findObject(By.text("Время запланированного действия")),5000)
        assertNotNull("The actual system notification is visible",visible)
        visible.click()
        // A synthetic account has not accepted the optional Google services offer.
        // Dismiss it through the same control available to an offline user.
        device.wait(Until.findObject(By.text("Не сейчас").enabled(true)), 5_000)?.click()
        // A newly created QA account also sees the real release notes. Acknowledge
        // that modal explicitly before inspecting the editor beneath it.
        if (device.wait(Until.hasObject(By.text("Что нового · ${BuildConfig.VERSION_NAME}")), 2_000)) {
            val acknowledge = device.wait(Until.findObject(By.text("Понятно").enabled(true)), 5_000)
            assertNotNull("Release notes expose their acknowledgement control", acknowledge)
            acknowledge.click()
        }
        val opened = device.wait(Until.hasObject(By.text("Изолированный тест открытия")),10_000)
        if (!opened) {
            device.takeScreenshot(java.io.File(app.getExternalFilesDir(null), "notification-open-failure.png"))
            device.dumpWindowHierarchy(java.io.File(app.getExternalFilesDir(null), "notification-open-failure.xml"))
        }
        val auth = AuthController.get(app).state.value
        assertTrue("Notification opens the exact record; ready=${auth.ready}, busy=${auth.busy}, cachedUser=${auth.user != null}, app=${device.currentPackageName}", opened)
        assertTrue(device.hasObject(By.text("Изменить задачу")))
        app.repository.complete(openId)
        } finally {
            app.scheduler.deactivate(validationScope)
            CachedAccountEntry(app).clear(validationScope)
            app.activateAccount(null)
            fixture.edit().remove("isolated").commit()
        }
    }

    @Test fun notificationChannelDiagnostics() = runBlocking {
        val manager=app.getSystemService(NotificationManager::class.java)
        val channel=manager.getNotificationChannel(ru.genesis.calendar.reminders.ReminderScheduler.TASK_CHANNEL)
        val audio=app.getSystemService(android.media.AudioManager::class.java)
        fun report(text:String) { InstrumentationRegistry.getInstrumentation().sendStatus(0,
            android.os.Bundle().apply { putString("stream","\n$text\n") }) }
        report("GENESIS channel importance=${channel.importance}, soundConfigured=${channel.sound!=null}, vibration=${channel.shouldVibrate()}, DNDfilter=${manager.currentInterruptionFilter}")
        report("GENESIS notification volume=${audio.getStreamVolume(android.media.AudioManager.STREAM_NOTIFICATION)}, ringerMode=${audio.ringerMode}, globalSoundConfigured=${!android.provider.Settings.System.getString(app.contentResolver,android.provider.Settings.System.NOTIFICATION_SOUND).isNullOrBlank()}")
        val row=app.database.dao().taskReminders(app.workspaceScope,fixtureId).lastOrNull()
        report("GENESIS synthetic alarm state=${row?.state}, delayMs=${row?.deliveredAt?.minus(row.at)}")
        assertTrue(app.scheduler.notificationsAllowed())
        assertTrue(app.scheduler.exactAllowed())
        assertTrue(channel.importance>=NotificationManager.IMPORTANCE_DEFAULT)
        assertNotNull(channel.sound)
    }

    @Test fun persistedCompletionSurvivesFreshProcess() = runBlocking {
        assertTrue(app.repository.get(fixtureId)!!.done)
        val row=app.database.dao().taskReminders(app.workspaceScope,fixtureId).maxBy { it.revision }
        assertEquals("cancelled",row.state)
        app.scheduler.restore()
        app.scheduler.deliver(row.scope,row.id,row.revision-1)
        assertTrue(app.getSystemService(NotificationManager::class.java).activeNotifications.none {
            it.tag==row.scope + "/" + row.id
        })
    }

    @Test fun snoozeAndStaleVersionAreIdempotent() = runBlocking {
        val id="internal-snooze-validation-v1"
        val old=app.repository.get(id)
        val task=app.repository.save(LocalTask(id=id,title="Изолированный тест отложения",
            reminderAt=System.currentTimeMillis()-1000,revision=old?.revision?:0))
        val row=app.database.dao().taskReminders(app.workspaceScope,id).single{it.state=="pending"}
        app.scheduler.deliver(row.scope,row.id,row.revision)
        assertTrue(app.repository.snooze(row.id,row.revision))
        assertFalse(app.repository.snooze(row.id,row.revision))
        val next=app.database.dao().taskReminders(app.workspaceScope,id).single{it.state=="pending"}
        assertEquals(task.revision,next.revision)
        assertTrue(next.at>System.currentTimeMillis())
        app.scheduler.deliver(row.scope,row.id,row.revision)
        assertEquals("pending",app.database.dao().reminder(row.scope,next.id)!!.state)
        app.repository.complete(id)
        assertTrue(app.database.dao().taskReminders(app.workspaceScope,id).all{it.state=="cancelled"})
    }

    @Test fun fiveRemindersPersistAndCancelTogether() = runBlocking {
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val id = "internal-five-reminders-validation-v1"
        val previous = app.repository.get(id)
        val saved = app.repository.save(LocalTask(id=id, title="Изолированный тест пяти напоминаний",
            date=LocalDate.now().plusDays(2).toString(), time="12:00",
            reminders=listOf(10,30,60,1440,2880).map(TaskReminder::relative),
            revision=previous?.revision ?: 0))
        val rows = app.database.dao().taskReminders(app.workspaceScope,id)
        assertEquals(5,rows.count{it.state=="pending"})
        assertEquals(5,app.repository.get(id)!!.reminders!!.size)
        app.repository.complete(id)
        assertTrue(app.database.dao().taskReminders(app.workspaceScope,id).all{it.state=="cancelled"})
        assertEquals(saved.revision+1,app.repository.get(id)!!.revision)
    }
}
