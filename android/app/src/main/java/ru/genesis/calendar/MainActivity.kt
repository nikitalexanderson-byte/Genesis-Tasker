package ru.genesis.calendar

import android.os.Bundle
import android.content.Intent
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.NativeActivityVisit
import ru.genesis.calendar.ui.GenesisApp

class MainActivity : ComponentActivity() {
    private val openedTask = mutableStateOf<String?>(null)
    private val openedSection = mutableStateOf<String?>(null)
    private val openedHabit = mutableStateOf<ru.genesis.calendar.reminders.HabitReminderOpenRequest?>(null)
    private val openedAdvice = mutableStateOf<ru.genesis.calendar.reminders.AdviceNotificationOpenRequest?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        acceptIntent(intent)
        setContent { GenesisApp(application as GenesisApplication, openedTask.value, openedSection.value,
            openedHabit = openedHabit.value, openedAdvice = openedAdvice.value) }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                while (isActive) {
                    AuthController.get(applicationContext).refreshIfReady()
                    delay(30_000)
                }
            }
        }
    }
    override fun onPause() {
        NativeActivityVisit.onPause()
        AuthController.get(applicationContext).onTrialBackground()
        super.onPause()
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptIntent(intent)
    }
    override fun onResume() {
        super.onResume()
        NativeActivityVisit.onResume()
        AuthController.get(applicationContext).onTrialForeground()
        // Returning from Android permission/battery settings must restore the schedule
        // immediately, even when no habit or account data changed.
        lifecycleScope.launch {
            val app = application as GenesisApplication
            app.scheduler.restore(recoverOverdue = true); app.scheduler.restoreHabitNotifications()
            runCatching { ru.genesis.calendar.reminders.SleepReminderScheduler.restore(app) }
            runCatching { ru.genesis.calendar.reminders.AdviceReminderScheduler.restore(app) }
        }
    }
    private fun acceptIntent(intent: Intent) {
        val app = application as GenesisApplication
        if (intent.getStringExtra("scope") == app.workspaceScope) {
            openedAdvice.value = ru.genesis.calendar.reminders.adviceNotificationRequest(intent, app.workspaceScope)
            openedHabit.value = ru.genesis.calendar.reminders.habitReminderRequest(intent, app.workspaceScope)
            openedTask.value = intent.getStringExtra("taskId")
            requestedSection(intent, app.workspaceScope)?.let { section ->
                val destination = if (section == "plan-guidance") "$section:${app.workspaceScope}" else section
                openedSection.value = "$destination#${System.nanoTime()}"
            }
        }
    }
}

internal fun requestedSection(intent: Intent, workspaceScope: String): String? =
    intent.getStringExtra("openSection").takeIf { intent.getStringExtra("scope") == workspaceScope }
