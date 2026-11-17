package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.UiPreferences
import ru.genesis.calendar.security.UpdateGate
import kotlin.coroutines.resume

/** Replaces the app composition, including deep links. It is never an overlay over active sync. */
@Composable
internal fun SecurityUpdateBoundary(app: GenesisApplication, content: @Composable () -> Unit) {
    val blocked by UpdateGate.blocked.collectAsState()
    val prefs by remember(app) { LocalPreferences(app,app.workspaceScope).values }.collectAsState(UiPreferences())
    val scope = rememberCoroutineScope()
    val resumeEpoch = rememberUpdateResumeEpoch()
    val manager = remember(app) { if (BuildConfig.PLAY_DISTRIBUTION) AppUpdateManagerFactory.create(app) else null }
    var error by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var resumedPlay by rememberSaveable { mutableStateOf(false) }
    var apk by remember { mutableStateOf<AndroidRelease?>(null) }
    val launcher = rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) {
        // Cancellation/error never clears the durable gate. Retry always fetches a new AppUpdateInfo.
        busy=false; error=it.resultCode != android.app.Activity.RESULT_OK
    }
    suspend fun playInfo(): AppUpdateInfo? = suspendCancellableCoroutine { continuation ->
        if (manager == null) { continuation.resume(null); return@suspendCancellableCoroutine }
        manager.appUpdateInfo.addOnSuccessListener { if(continuation.isActive)continuation.resume(it) }
            .addOnFailureListener { if(continuation.isActive)continuation.resume(null) }
    }
    suspend fun checkAvailability(start: Boolean) {
        busy=true; error=false
        try {
            UpdateGate.refresh()
            if (manager != null) {
                val info = requireNotNull(playInfo())
                if(info.updateAvailability() in setOf(UpdateAvailability.UPDATE_AVAILABLE,UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS))
                    UpdateGate.observeAvailable(info.availableVersionCode())
                if (UpdateGate.blocked.value && info.availableVersionCode() >= UpdateGate.minimumVersion()) {
                    if (start && info.installStatus()==InstallStatus.DOWNLOADED) manager.completeUpdate().addOnFailureListener { error=true }
                    else if ((start || !resumedPlay && info.updateAvailability()==UpdateAvailability.DEVELOPER_TRIGGERED_UPDATE_IN_PROGRESS)
                        && info.isUpdateTypeAllowed(AppUpdateType.IMMEDIATE)) {
                        resumedPlay=true
                        check(manager.startUpdateFlowForResult(info,launcher,AppUpdateOptions.newBuilder(AppUpdateType.IMMEDIATE).build()))
                    } else if (start) error=true
                } else if(start) error=true
            } else {
                val current = withContext(Dispatchers.IO) { fetchAndroidRelease() }
                current?.let { UpdateGate.observeAvailable(it.versionCode) }
                if (start) { require(current != null && current.versionCode >= UpdateGate.minimumVersion()); apk=current.copy(required=true) }
            }
        } catch (cancel: kotlinx.coroutines.CancellationException) { throw cancel }
        catch (_: Exception) { error=true }
        finally { busy=false }
    }
    LaunchedEffect(resumeEpoch) { checkAvailability(false) }
    if (!blocked) { content(); return }
    CompositionLocalProvider(LocalGenesisLanguage provides prefs.language) {
        MaterialTheme(colorScheme=if(prefs.theme in setOf("standart-dark", "experimental-dark"))eveningPalette(prefs.darkPalette) else daylightPalette(prefs.darkPalette),typography=GenesisTypography) {
            Surface(modifier=Modifier.fillMaxSize()) {
                val copy=securityUpdateCopy(prefs.language)
                Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(16.dp)) {
                    Text(copy.title,style=MaterialTheme.typography.headlineSmall,translate=false)
                    Text(copy.body,translate=false)
                    if(error)Text(copy.error,translate=false)
                    Button(enabled=!busy,onClick={scope.launch { checkAvailability(true) }}) { Text(appUpdateCopy(prefs.language).action,translate=false) }
                    TextButton(enabled=!busy,onClick={scope.launch { checkAvailability(false) }}) { Text(copy.retry,translate=false) }
                    TextButton(onClick={
                        val url=if(BuildConfig.PLAY_DISTRIBUTION)"https://play.google.com/store/apps/details?id=ru.genesis.calendar" else "https://genesiscalendar.com/android"
                        runCatching { app.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure { error=true }
                    }) { Text(copy.channel,translate=false) }
                    EmergencyExportAction(app,copy)
                    TextButton(onClick={runCatching { app.startActivity(Intent(Intent.ACTION_SENDTO,Uri.parse("mailto:nikitalexanderson@gmail.com")).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)) }.onFailure { error=true }}) { Text(copy.support,translate=false) }
                }
            }
            apk?.let { AndroidUpdateDialog(app,it,securityGate=true) { apk=null } }
        }
    }
}
