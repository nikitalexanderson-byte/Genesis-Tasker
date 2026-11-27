package ru.genesis.calendar

import android.app.NotificationManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.BySelector
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import ru.genesis.calendar.auth.AccountSettings
import ru.genesis.calendar.auth.CachedAccountEntry
import ru.genesis.calendar.auth.LinkedGoogleAccount
import ru.genesis.calendar.auth.ServerIdentity
import ru.genesis.calendar.auth.SyncRouting
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.ui.appLockCopy
import java.io.File
import java.util.regex.Pattern

/** The owned AVD driver supplies the registered sensor touch or the actual system PIN.
 * The launcher, notification, preferences and authentication results use their production paths. */
class AppLockEntryTest {
    private val instrumentation = InstrumentationRegistry.getInstrumentation()
    private val app = instrumentation.targetContext.applicationContext as GenesisApplication
    private val device = UiDevice.getInstance(instrumentation)
    private val copy = appLockCopy("ru")
    private val taskTitle = "GENESIS QA app lock"
    private val timeout = 75_000L

    private fun tap(selector: BySelector) {
        requireNotNull(device.wait(Until.findObject(selector), timeout)) { "Missing control: $selector" }.click()
    }

    private fun signal(stage: String) {
        instrumentation.sendStatus(2, Bundle().apply { putString("stream", "GENESIS_APP_LOCK_WAIT:$stage\n") })
    }

    private fun fingerprint() {
        tapGuard()
        signal("fingerprint")
    }

    private fun tapGuard() {
        assertTrue("System biometric prompt", device.wait(Until.hasObject(By.pkg("com.android.systemui").text(
            Pattern.compile(Pattern.quote(copy.pin), Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE))), timeout))
    }

    private fun launch() {
        app.startActivity(requireNotNull(app.packageManager.getLaunchIntentForPackage(app.packageName))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }

    private fun grantedSettings() {
        assertTrue("Authenticated settings screen", device.wait(Until.hasObject(By.text(copy.lockNow)), timeout))
    }

    private fun returnFromRecents() {
        val home = device.executeShellCommand(
            "cmd package resolve-activity --brief -a android.intent.action.MAIN -c android.intent.category.HOME"
        ).trim().lineSequence().last().substringBefore('/')
        check(home.isNotBlank() && home != app.packageName)
        assertTrue("Home key", device.pressHome())
        device.waitForIdle()
        assertTrue("Overview key", device.pressRecentApps())
        // The launcher also exposes partially visible adjacent cards. Immediately after
        // Home, the foreground app is the centered card. Selecting the first match can
        // open a neighboring activity from an earlier instrumentation run.
        val center = device.displayWidth / 2
        val thumbnail = listOf("snapshot", "thumbnail", "task_view").firstNotNullOfOrNull { id ->
            device.wait(Until.findObjects(By.res(home, id)), 4_000)?.firstOrNull {
                val bounds = it.visibleBounds
                center in bounds.left until bounds.right
            }
        }
        requireNotNull(thumbnail) { "GENESIS task card unavailable in overview" }.click()
    }

    private fun openSettings() {
        device.wait(Until.findObject(By.text("Не сейчас")), 4_000)?.click()
        device.wait(Until.findObject(By.text("Понятно")), 4_000)?.click()
        tap(By.desc("Открыть меню"))
        repeat(6) {
            device.findObject(By.desc(copy.section))?.let { it.click(); return }
            val area = requireNotNull(device.findObject(By.scrollable(true))).visibleBounds
            device.swipe(area.centerX(), area.bottom - 30, area.centerX(), area.top + 30, 16)
        }
        error("Security not reachable from the app drawer")
    }

    @Test fun settingsBackgroundAndNotificationRequireRealAuthentication() {
        assumeTrue(InstrumentationRegistry.getArguments().getString("genesisAppLockUi") == "true")
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v337lock.debug")
        val uid = "app-lock-entry-fixture"
        val taskId = "app-lock-entry-reminder"
        val validation = app.getSharedPreferences("genesis.validation.v1", Context.MODE_PRIVATE)
        val settings = app.getSharedPreferences("genesis.app-lock", Context.MODE_PRIVATE)
        check(!settings.getBoolean("enabled", false))
        validation.edit().putBoolean("isolated", true).commit()
        app.activateAccount(uid)
        val scope = app.workspaceScope
        val cache = CachedAccountEntry(app)
        try {
            runBlocking {
                cache.save(ServerIdentity(uid, "QA", "qa@example.invalid"), AccountSettings(
                    listOf(LinkedGoogleAccount("qa", "qa@example.invalid", "QA", true, false, false)),
                    SyncRouting("fixed", listOf("qa"), emptyMap()), false, "standart", 0,
                    "sacred", "profane", "24h", false, "ru"))
                LocalPreferences(app, scope).set("language", "ru")
            }
            launch()
            openSettings()
            tap(By.text(copy.enable))
            fingerprint()
            grantedSettings()
            assertTrue(settings.getBoolean("enabled", false))

            tap(By.text(copy.lockNow))
            tapGuard()
            device.pressBack()
            tap(By.text(copy.pin))
            // Some versions first present Android's own biometric/credential chooser.
            device.wait(Until.findObject(By.res("com.android.systemui:id/button_use_credential")), 4_000)?.click()
            val field = By.pkg(Pattern.compile("com\\.android\\.(settings|systemui)"))
                .clazz(Pattern.compile(".*(EditText|PasswordTextView)"))
            assertTrue("Platform PIN entry", device.wait(Until.hasObject(field), timeout))
            val prompt = File(app.getExternalFilesDir(null), "genesis-owned-unlock-prompt.xml")
            device.dumpWindowHierarchy(prompt)
            signal("pin")
            try { grantedSettings() } finally { prompt.delete() }

            returnFromRecents()
            tapGuard()
            assertFalse(device.hasObject(By.text(copy.lockNow)))
            signal("fingerprint")
            grantedSettings()

            tap(By.text(copy.disable))
            fingerprint()
            tap(By.text(copy.enable))
            assertFalse(settings.getBoolean("enabled", true))
            fingerprint()
            grantedSettings()

            runBlocking {
                val old = app.repository.get(taskId)
                app.repository.save(LocalTask(id = taskId, title = taskTitle, reminderAt = System.currentTimeMillis() - 1000,
                    revision = old?.revision ?: 0))
                val row = app.database.dao().taskReminders(scope, taskId).single { it.state == "pending" }
                app.scheduler.deliver(scope, row.id, row.revision)
            }
            device.pressHome()
            device.openNotification()
            tap(By.text("Время запланированного действия"))
            tapGuard()
            assertFalse("Task remains hidden while locked", device.hasObject(By.text(taskTitle)))
            signal("fingerprint")
            assertTrue("Notification destination restored", device.wait(Until.hasObject(By.text(taskTitle)), timeout))
        } finally {
            runBlocking {
                app.repository.get(taskId)?.let { app.repository.delete(taskId, it.revision) }
                cache.clear(scope)
            }
            app.getSystemService(NotificationManager::class.java).cancelAll()
            settings.edit().clear().commit()
            validation.edit().remove("isolated").commit()
            app.activateAccount(null)
        }
    }
}
