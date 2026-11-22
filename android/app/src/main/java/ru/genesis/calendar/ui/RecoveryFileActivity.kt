package ru.genesis.calendar.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.withResumed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.security.NativeRecoveryFileRequest
import java.util.concurrent.atomic.AtomicBoolean

internal sealed interface RecoveryFileResult{
    class Saved(val uri:Uri):RecoveryFileResult{override fun toString()="RecoveryFileResult.Saved([redacted])"}
    class Loaded(val kit:JSONObject):RecoveryFileResult{override fun toString()="RecoveryFileResult.Loaded([redacted])"}
    data object Cancelled:RecoveryFileResult
    data object Failed:RecoveryFileResult
}

/** The registry key and callback lifetime belong to one request. Process death
 * loses only this transient operation; a restored registry result has no new
 * request to adopt. No URI or recovery material is rememberSaveable. */
@Composable internal fun RecoveryFileActivity(request:NativeRecoveryFileRequest?,finished:(NativeRecoveryFileRequest,RecoveryFileResult)->Unit){
    request?.let{held->key(held.id){
        val context=LocalContext.current.applicationContext
        val lifecycle=LocalLifecycleOwner.current.lifecycle;val scope=rememberCoroutineScope()
        val ended=remember(held){AtomicBoolean(false)}
        val foreground=remember(lifecycle){AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
        fun current(){held.current();check(foreground.get()){"E2EE_FOREGROUND_REQUIRED"}}
        fun finish(value:RecoveryFileResult){if(ended.compareAndSet(false,true)){held.close();finished(held,value)}}
        DisposableEffect(held,lifecycle){
            val observer=LifecycleEventObserver{_,event->
                if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
                if(event==Lifecycle.Event.ON_PAUSE){foreground.set(false);if(!held.waitingForPicker)finish(RecoveryFileResult.Failed)}
                if(event==Lifecycle.Event.ON_DESTROY)finish(RecoveryFileResult.Failed)
            }
            lifecycle.addObserver(observer)
            onDispose{ended.set(true);held.close();lifecycle.removeObserver(observer)}
        }
        fun receive(uri:Uri?){
            if(!held.pickerReturned()||ended.get())return
            if(uri==null){finish(RecoveryFileResult.Cancelled);return}
            scope.launch{
                try{
                    lifecycle.withResumed{};current();held.claim(held.owner,held.view)
                    val kit=withContext(Dispatchers.IO){current();held.transfer(context,uri).also{current()}}
                    current();finish(if(held.writing)RecoveryFileResult.Saved(uri)else RecoveryFileResult.Loaded(requireNotNull(kit)))
                }catch(cancel:CancellationException){finish(RecoveryFileResult.Failed);throw cancel}catch(_:Exception){finish(RecoveryFileResult.Failed)}
            }
        }
        val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){receive(it)}
        val select=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){receive(it)}
        LaunchedEffect(held.id){
            try{lifecycle.withResumed{};current();if(held.writing)save.launch(requireNotNull(held.filename))else select.launch(arrayOf("application/json","application/octet-stream"))}
            catch(cancel:CancellationException){finish(RecoveryFileResult.Failed);throw cancel}catch(_:Exception){finish(RecoveryFileResult.Failed)}
        }
        LaunchedEffect(held.id,"expiry"){delay(held.remainingMillis());finish(RecoveryFileResult.Failed)}
    }}
}
