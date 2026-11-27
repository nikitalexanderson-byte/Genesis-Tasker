package ru.genesis.calendar.ui

import android.app.Activity
import android.app.KeyguardManager
import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.provider.Settings
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.biometric.AuthenticationResultCallback
import androidx.biometric.compose.rememberAuthenticationLauncher
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalLayoutDirection
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.LayoutDirection
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.withResumed
import ru.genesis.calendar.data.welcomeLanguageForDevice
import java.util.concurrent.atomic.AtomicReference

internal fun deviceScreenLockAvailable(context: Context): Boolean =
    context.getSystemService(KeyguardManager::class.java).isDeviceSecure

/** An opaque window above all workspace dialogs. The workspace retains its editors and system result callbacks. */
class AppLockActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE)
        enableEdgeToEdge()
        val requestId = intent.getStringExtra("request")
        val action = AppLockAction.entries.find { it.name == intent.getStringExtra("action") }
        if (action == null || requestId.isNullOrBlank()) { finish(); return }
        val language = welcomeLanguageForDevice(intent.getStringExtra("language"))
        val copy = appLockCopy(language)
        setContent {
            val dark = intent.getBooleanExtra("dark", isSystemInDarkTheme())
            val direction = if (language in setOf("ar", "he", "iw")) LayoutDirection.Rtl else LayoutDirection.Ltr
            CompositionLocalProvider(LocalLayoutDirection provides direction, LocalGenesisLanguage provides language) {
                MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    LockScreen(action, copy) {
                        setResult(Activity.RESULT_OK, Intent().putExtra("request", requestId))
                        finish()
                    }
                }
            }
        }
    }

    @Composable
    private fun LockScreen(action: AppLockAction, copy: AppLockCopy, authenticated: () -> Unit) {
        var available by remember { mutableStateOf(deviceScreenLockAvailable(this)) }
        var busy by remember { mutableStateOf(false) }
        val active = remember { AtomicReference<NativeDeviceAuthentication?>(null) }
        val credential = rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
            active.get()?.credentialReturned(result.resultCode == Activity.RESULT_OK)
        }
        val biometric = rememberAuthenticationLauncher(AuthenticationResultCallback { active.get()?.biometricReturned(it) })
        val title = when (action) {
            AppLockAction.ENABLE -> copy.enable
            AppLockAction.DISABLE -> copy.disable
            AppLockAction.UNLOCK -> copy.unlock
        }
        fun authenticate(pinOnly: Boolean) {
            available = deviceScreenLockAvailable(this)
            if (!available || busy || !lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) return
            val attempt = NativeDeviceAuthentication(this, title, copy.description, copy.pin,
                { credential.launch(it) }, biometric) { accepted ->
                active.getAndSet(null)?.close()
                busy = false
                if (accepted && deviceScreenLockAvailable(this) && !isFinishing) authenticated()
            }
            if (!active.compareAndSet(null, attempt)) return
            busy = true
            try { if (pinOnly) attempt.useCredential() else attempt.start() }
            catch (_: IllegalStateException) { attempt.cancel(); available = deviceScreenLockAvailable(this) }
        }
        DisposableEffect(Unit) {
            val observer = LifecycleEventObserver { _, event ->
                if (event == Lifecycle.Event.ON_RESUME) available = deviceScreenLockAvailable(this@AppLockActivity)
                if (event == Lifecycle.Event.ON_STOP) active.get()?.takeUnless { it.systemCredentialPending }?.cancel()
            }
            lifecycle.addObserver(observer)
            onDispose { lifecycle.removeObserver(observer); active.getAndSet(null)?.close() }
        }
        LaunchedEffect(Unit) { lifecycle.withResumed { authenticate(false) } }
        BackHandler(enabled = action == AppLockAction.UNLOCK) { moveTaskToBack(true) }
        Surface(Modifier.fillMaxSize().testTag("app-lock-screen")) {
            Box(Modifier.fillMaxSize().safeDrawingPadding().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(Modifier.widthIn(max = 420.dp).verticalScroll(rememberScrollState()),
                    horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    GenesisLucideIcon("lock-keyhole", Modifier.size(32.dp))
                    androidx.compose.material3.Text(copy.title, style = MaterialTheme.typography.headlineSmall)
                    androidx.compose.material3.Text(if (available) copy.description else copy.needsCredential)
                    if (available) {
                        Button(onClick = { authenticate(false) }, enabled = !busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("app-lock-authenticate")) {
                            androidx.compose.material3.Text(title)
                        }
                        OutlinedButton(onClick = { authenticate(true) }, enabled = !busy,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("app-lock-system-pin")) {
                            androidx.compose.material3.Text(copy.pin)
                        }
                    } else {
                        Button(onClick = { startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS)) },
                            modifier = Modifier.heightIn(min = 48.dp).testTag("app-lock-system-settings")) {
                            androidx.compose.material3.Text(copy.setUp)
                        }
                    }
                }
            }
        }
    }
}

@Composable
internal fun AppLockSettings(language: String) {
    val host = LocalAppLockHost.current
    val copy = appLockCopy(language)
    val dark = LocalEveningTheme.current
    SettingsPreferenceCard(copy.title, Modifier.testTag("app-lock-settings"), description = copy.description) {
        Button(onClick = { host?.changeSetting(language, dark) }, enabled = host != null,
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("app-lock-toggle")) {
            androidx.compose.material3.Text(if (host?.enabled == true) copy.disable else copy.enable)
        }
        if (host?.enabled == true) {
            OutlinedButton(onClick = host::lockNow,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("app-lock-now")) {
                androidx.compose.material3.Text(copy.lockNow)
            }
        }
        if (host?.saveFailed == true) androidx.compose.material3.Text(securityUpdateCopy(language).error)
    }
}
