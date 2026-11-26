package ru.genesis.calendar.ui

import android.app.Activity
import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.IntentSenderRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.withResumed
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.security.E2eeDriveBackup
import ru.genesis.calendar.security.E2eeKeys
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private fun driveActivity(context:Context):Activity?=when(context){is Activity->context;is ContextWrapper->driveActivity(context.baseContext);else->null}
private suspend fun <T> Task<T>.driveAwait():T=suspendCancellableCoroutine{next->
    addOnSuccessListener{if(next.isActive)next.resume(it)};addOnFailureListener{if(next.isActive)next.resumeWithException(it)};addOnCanceledListener{next.cancel()}
}

/** Above the vault gate: only an OAuth code may survive the system Google
 * activity. Original owner/session/restore, exact attempt and 2-minute expiry
 * remain mandatory; no vault key or plaintext is held by this host. */
@Composable internal fun PrivateDriveConnectionActivity(owner:String?){
    val context=LocalContext.current;val activity=remember(context){driveActivity(context)}?:return
    val lifecycle=LocalLifecycleOwner.current.lifecycle;val auth=remember(context){AuthController.get(context)}
    val pending by PrivateDriveConnection.state.collectAsStateWithLifecycle()
    pending?.takeIf{it.owner==owner&&it.phase !in setOf("complete","failed")}?.let{saved->key(saved.id,lifecycle){
        val coroutine=rememberCoroutineScope();val live=remember{AtomicBoolean(true)};val returned=remember{AtomicBoolean(false)}
        val gateway=remember(saved.id){auth.privateDriveGateway(saved.owner)}
        val deadline=remember(saved.id){SystemClock.elapsedRealtime()+120000}
        val attempt=remember{AtomicReference<String?>(null)};val io=remember{AtomicReference<ForegroundAccountCall?>(null)}
        fun current(){check(live.get()&&SystemClock.elapsedRealtime()<deadline){"DRIVE_AUTH_STALE"};gateway.current()}
        DisposableEffect(lifecycle){
            val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_PAUSE)io.getAndSet(null)?.cancel()}
            lifecycle.addObserver(observer)
            onDispose{live.set(false);lifecycle.removeObserver(observer);io.getAndSet(null)?.cancel();PrivateDriveConnection.failed(saved.id)}
        }
        suspend fun finish(result:AuthorizationResult){
            lifecycle.withResumed{};current();check(returned.compareAndSet(false,true)){"DRIVE_AUTH_STALE"}
            val code=result.serverAuthCode;check(!code.isNullOrBlank()&&code.length<=8192){"DRIVE_AUTH_STALE"}
            val original=requireNotNull(attempt.get()){"DRIVE_AUTH_STALE"}
            val call=ForegroundAccountCall(requireNotNull(NativeActivityVisit.foregroundVisitId()){"E2EE_FOREGROUND_REQUIRED"});io.set(call)
            try{
                val value=withContext(Dispatchers.IO){current();gateway.request("authorize",JSONObject().put("attemptId",original).put("serverAuthCode",code),call).also{current()}}
                current();E2eeKeys.exact(value,setOf("enabled","connectionId","consentVersion"));check(value.getString("consentVersion")==E2eeDriveBackup.CONSENT&&!value.isNull("connectionId")){"DRIVE_INVALID_RESPONSE"}
                PrivateDriveConnection.transition(saved.id,"complete")
            }finally{io.compareAndSet(call,null);call.cancel()}
        }
        val launcher=rememberLauncherForActivityResult(ActivityResultContracts.StartIntentSenderForResult()){response->coroutine.launch{
            try{current();check(response.resultCode==Activity.RESULT_OK&&response.data!=null){"DRIVE_AUTH_STALE"};finish(Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(response.data))}
            catch(cancel:CancellationException){PrivateDriveConnection.failed(saved.id);throw cancel}catch(_:Exception){PrivateDriveConnection.failed(saved.id)}
        }}
        LaunchedEffect(saved.id){
            try{
                lifecycle.withResumed{};current();check(saved.phase=="requested"){"DRIVE_AUTH_STALE"};PrivateDriveConnection.transition(saved.id,"running")
                val call=ForegroundAccountCall(requireNotNull(NativeActivityVisit.foregroundVisitId()){"E2EE_FOREGROUND_REQUIRED"});io.set(call)
                val config=try{withContext(Dispatchers.IO){current();gateway.request("connect",JSONObject().put("consentVersion",E2eeDriveBackup.CONSENT),call).also{current()}}}finally{io.compareAndSet(call,null);call.cancel()}
                E2eeKeys.exact(config,setOf("attemptId","serverClientId","scopes"));val id=config.getString("attemptId");check(java.util.UUID.fromString(id).toString()==id){"DRIVE_AUTH_STALE"};attempt.set(id)
                val scopes=config.getJSONArray("scopes");val requested=(0 until scopes.length()).map{scopes.getString(it)}
                check(requested.size==3&&requested.toSet()==setOf("openid","email","https://www.googleapis.com/auth/drive.appdata")){"DRIVE_INVALID_RESPONSE"}
                val clientId=config.getString("serverClientId");check(clientId.length in 1..512&&clientId.endsWith(".apps.googleusercontent.com")){"DRIVE_INVALID_RESPONSE"}
                val authorization=Identity.getAuthorizationClient(activity).authorize(AuthorizationRequest.builder().setRequestedScopes(requested.map(::Scope)).requestOfflineAccess(clientId)
                    .setPrompt(AuthorizationRequest.Prompt.CONSENT or AuthorizationRequest.Prompt.SELECT_ACCOUNT).build()).driveAwait();current()
                if(authorization.hasResolution()){
                    lifecycle.withResumed{};current();PrivateDriveConnection.transition(saved.id,"external");launcher.launch(IntentSenderRequest.Builder(requireNotNull(authorization.pendingIntent)).build())
                }else finish(authorization)
            }catch(cancel:CancellationException){PrivateDriveConnection.failed(saved.id);throw cancel}catch(_:Exception){PrivateDriveConnection.failed(saved.id)}
        }
        LaunchedEffect(saved.id,deadline){delay(maxOf(1,deadline-SystemClock.elapsedRealtime()));io.getAndSet(null)?.cancel();PrivateDriveConnection.failed(saved.id)}
    }}
}
