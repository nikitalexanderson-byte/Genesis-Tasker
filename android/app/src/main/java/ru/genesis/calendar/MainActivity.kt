package ru.genesis.calendar

import android.os.Bundle
import android.content.Intent
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import kotlinx.coroutines.channels.Channel
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AccountSyncRetry
import ru.genesis.calendar.auth.NativeActivityVisit
import ru.genesis.calendar.ui.AppLockHost
import ru.genesis.calendar.ui.LocalAppLockHost
import ru.genesis.calendar.ui.GenesisApp
import ru.genesis.calendar.ui.SecurityUpdateBoundary

class MainActivity : ComponentActivity() {
    private lateinit var appLock: AppLockHost
    private val openedTask = mutableStateOf<String?>(null)
    private val openedSection = mutableStateOf<String?>(null)
    private val openedHabit = mutableStateOf<ru.genesis.calendar.reminders.HabitReminderOpenRequest?>(null)
    private val openedAdvice = mutableStateOf<ru.genesis.calendar.reminders.AdviceNotificationOpenRequest?>(null)
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        acceptIntent(intent)
        appLock = AppLockHost(this, savedInstanceState)
        val app = application as GenesisApplication
        setContent {
            if (appLock.canMountWorkspace) CompositionLocalProvider(LocalAppLockHost provides appLock) {
                SecurityUpdateBoundary(app) {
                    GenesisApp(app, openedTask.value, openedSection.value,
                        openedHabit = openedHabit.value, openedAdvice = openedAdvice.value)
                }
            }
        }
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                val connectivity = getSystemService(ConnectivityManager::class.java)
                val online = Channel<Unit>(Channel.CONFLATED)
                val callback = object : ConnectivityManager.NetworkCallback() {
                    private var availableNetwork: Network? = null
                    private var validated = false
                    override fun onCapabilitiesChanged(network: Network, capabilities: NetworkCapabilities) {
                        if (capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)) {
                            val nowValidated = capabilities.hasCapability(NetworkCapabilities.NET_CAPABILITY_VALIDATED)
                            if (availableNetwork != network || (nowValidated && !validated)) online.trySend(Unit)
                            availableNetwork = network
                            validated = nowValidated
                        } else if (availableNetwork == network) availableNetwork = null
                    }
                    override fun onLost(network: Network) {
                        if (availableNetwork == network) availableNetwork = null
                    }
                }
                val registered = runCatching { connectivity.registerDefaultNetworkCallback(callback) }.isSuccess
                try {
                    if (!registered) online.trySend(Unit)
                    while (isActive) {
                        val connectionAvailable = withTimeoutOrNull(AccountSyncRetry.POLL_MILLIS) { online.receive() } != null
                        if (!ru.genesis.calendar.security.UpdateGate.blocked.value) {
                            AuthController.get(applicationContext).refreshIfReady(immediate = connectionAvailable)
                        }
                    }
                } finally {
                    if (registered) connectivity.unregisterNetworkCallback(callback)
                    online.close()
                }
            }
        }
    }
    override fun onPause() {
        NativeActivityVisit.onPause()
        if (!ru.genesis.calendar.security.UpdateGate.blocked.value) AuthController.get(applicationContext).onTrialBackground()
        super.onPause()
    }

    override fun onStop() {
        appLock.onStop()
        super.onStop()
    }

    override fun onSaveInstanceState(outState: Bundle) {
        appLock.saveState(outState)
        super.onSaveInstanceState(outState)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        setIntent(intent)
        acceptIntent(intent)
    }
    override fun onResume() {
        super.onResume()
        appLock.onResume()
        restoreRecentsCard()
        if (ru.genesis.calendar.security.UpdateGate.blocked.value) return
        NativeActivityVisit.onResume()
        AuthController.get(applicationContext).onTrialForeground()
        // Returning from Android permission/battery settings must restore the schedule
        // immediately, even when no habit or account data changed.
        lifecycleScope.launch {
            val app = application as GenesisApplication
            if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope))return@launch
            app.scheduler.restore(recoverOverdue = true); app.scheduler.restoreHabitNotifications()
            runCatching { ru.genesis.calendar.reminders.SleepReminderScheduler.restore(app) }
            runCatching { ru.genesis.calendar.reminders.AdviceReminderScheduler.restore(app) }
        }
    }
    /** An upgrade can reuse a task whose root intent inherited the icon trampoline's exclusion. */
    @Suppress("DEPRECATION")
    private fun restoreRecentsCard() {
        val manager = getSystemService(android.app.ActivityManager::class.java)
        for (task in manager.appTasks) {
            val info = task.taskInfo ?: continue
            val id = if (android.os.Build.VERSION.SDK_INT >= 29) info.taskId else info.id
            if (id == taskId && info.baseIntent.flags and Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS != 0) {
                task.setExcludeFromRecents(false)
                return
            }
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
