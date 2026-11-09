package ru.genesis.calendar.ui

import android.content.Context
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.*
import androidx.compose.runtime.*
import com.google.android.play.core.appupdate.AppUpdateInfo
import com.google.android.play.core.appupdate.AppUpdateManagerFactory
import com.google.android.play.core.appupdate.AppUpdateOptions
import com.google.android.play.core.install.model.AppUpdateType
import com.google.android.play.core.install.model.InstallStatus
import com.google.android.play.core.install.model.UpdateAvailability
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

internal fun shouldOfferPlayUpdate(available:Int,installStatus:Int,flexibleAllowed:Boolean):Boolean = installStatus==InstallStatus.DOWNLOADED || available==UpdateAvailability.UPDATE_AVAILABLE && flexibleAllowed

/** The Play channel offers only a version actually available to this installation. */
@Composable
internal fun PlayUpdatePrompt(context:Context,checkedAt:Long?) {
    val copy=appUpdateCopy(LocalGenesisLanguage.current)
    val manager=remember(context) {AppUpdateManagerFactory.create(context)}
    var offered by remember {mutableStateOf<AppUpdateInfo?>(null)}
    var dismissedVersion by remember {mutableIntStateOf(0)}
    var error by remember {mutableStateOf(false)}
    val launcher=rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()) { result->
        if(result.resultCode!=android.app.Activity.RESULT_OK){dismissedVersion=offered?.availableVersionCode() ?: 0;offered=null}
    }
    val resumeEpoch = rememberUpdateResumeEpoch()
    LaunchedEffect(checkedAt, resumeEpoch) {
        val info=suspendCancellableCoroutine<AppUpdateInfo?> { continuation-> manager.appUpdateInfo.addOnSuccessListener {if(continuation.isActive)continuation.resume(it)}.addOnFailureListener {if(continuation.isActive)continuation.resume(null)} }
        if(info!=null&&info.availableVersionCode()!=dismissedVersion&&shouldOfferPlayUpdate(info.updateAvailability(),info.installStatus(),info.isUpdateTypeAllowed(AppUpdateType.FLEXIBLE)))offered=info
    }
    DisposableEffect(manager) {
        val listener=com.google.android.play.core.install.InstallStateUpdatedListener {state->if(state.installStatus()==InstallStatus.DOWNLOADED)manager.appUpdateInfo.addOnSuccessListener {offered=it}}
        manager.registerListener(listener);onDispose {manager.unregisterListener(listener)}
    }
    offered?.let { info->AlertDialog(onDismissRequest={dismissedVersion=info.availableVersionCode();offered=null},title={Text(if(info.installStatus()==InstallStatus.DOWNLOADED)"Обновление готово" else "Доступно обновление в Google Play")},
        text={Text(if(error)"Google Play сейчас не запустил обновление. Повторите позже; приложение доступно." else if(info.installStatus()==InstallStatus.DOWNLOADED)"Перезапустите GENESIS, чтобы установить скачанную версию. Данные сохранятся." else "Google Play подтвердил доступность новой версии для вашей установки.")},
        confirmButton={TextButton(onClick={error=false;runCatching {if(info.installStatus()==InstallStatus.DOWNLOADED)manager.completeUpdate() else check(manager.startUpdateFlowForResult(info,launcher,AppUpdateOptions.newBuilder(AppUpdateType.FLEXIBLE).build()))}.onFailure {error=true}}){Text(if(info.installStatus()==InstallStatus.DOWNLOADED)genesisTranslate("Перезапустить") else copy.action,translate=false)}},
        dismissButton={TextButton(onClick={dismissedVersion=info.availableVersionCode();offered=null}){Text(copy.later,translate=false)}}) }
}
