package ru.genesis.calendar.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.withResumed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import ru.genesis.calendar.security.NativeContentFileDestination
import java.util.concurrent.atomic.AtomicBoolean

/** No plaintext producer/provider IO exists above the vault gate. Only a
 * fresh unlocked product can use the returned, exact-attempt destination. */
@Composable internal fun ContentFileDestinationActivity(owner:String?){
    val lifecycle=LocalLifecycleOwner.current.lifecycle;val value by NativeContentFileDestination.state.collectAsStateWithLifecycle()
    value?.takeIf{it.request.owner==owner&&it.phase !in setOf("complete","failed")}?.let{saved->key(saved.request.id,lifecycle){
        val request=saved.request;val coroutine=rememberCoroutineScope();val live=remember{AtomicBoolean(true)}
        DisposableEffect(lifecycle){val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_DESTROY||event==Lifecycle.Event.ON_PAUSE&&NativeContentFileDestination.state.value?.phase=="io")NativeContentFileDestination.failed(request)}
            lifecycle.addObserver(observer);onDispose{live.set(false);lifecycle.removeObserver(observer);NativeContentFileDestination.failed(request)}}
        val picker=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->coroutine.launch{
            try{lifecycle.withResumed{};check(live.get()){"E2EE_FOREGROUND_REQUIRED"};request.current();request.returned(uri)}
            catch(cancel:CancellationException){NativeContentFileDestination.failed(request);throw cancel}catch(_:Exception){NativeContentFileDestination.failed(request)}
        }}
        LaunchedEffect(request.id){
            try{if(saved.phase=="ready")return@LaunchedEffect;check(saved.phase=="requested"){"E2EE_FILE_DESTINATION_CHANGED"}
                lifecycle.withResumed{};check(live.get()){"E2EE_FOREGROUND_REQUIRED"};request.picking();picker.launch("genesis-content.bin")
            }catch(cancel:CancellationException){NativeContentFileDestination.failed(request);throw cancel}catch(_:Exception){NativeContentFileDestination.failed(request)}
        }
    }}
}
