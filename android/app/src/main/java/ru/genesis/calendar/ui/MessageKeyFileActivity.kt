package ru.genesis.calendar.ui

import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.withResumed
import kotlinx.coroutines.*
import ru.genesis.calendar.security.NativeMessageKeyTransfer
import java.util.concurrent.atomic.AtomicBoolean

/** Only encrypted key files survive the picker. A return belongs to the exact
 * original transient request; IO starts again only in the foreground. */
@Composable internal fun MessageKeyFileActivity(owner:String?){
    val context=LocalContext.current.applicationContext;val lifecycle=LocalLifecycleOwner.current.lifecycle
    val value by NativeMessageKeyTransfer.state.collectAsStateWithLifecycle()
    value?.takeIf{it.request.owner==owner&&it.phase !in setOf("complete","failed")}?.let{saved->key(saved.request.id,lifecycle){
        val request=saved.request;val coroutine=rememberCoroutineScope();val live=remember{AtomicBoolean(true)}
        val foreground=remember{AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
        fun current(){check(live.get()&&foreground.get()){"E2EE_FOREGROUND_REQUIRED"};request.current()}
        DisposableEffect(lifecycle){
            val observer=LifecycleEventObserver{_,event->
                if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
                if(event==Lifecycle.Event.ON_PAUSE){foreground.set(false);if(NativeMessageKeyTransfer.state.value?.phase=="io")NativeMessageKeyTransfer.failed(request)}
                if(event==Lifecycle.Event.ON_DESTROY)NativeMessageKeyTransfer.failed(request)
            };lifecycle.addObserver(observer)
            onDispose{live.set(false);lifecycle.removeObserver(observer);NativeMessageKeyTransfer.failed(request)}
        }
        fun returned(uri:Uri?){coroutine.launch{
            try{request.current();if(!request.returned())return@launch;lifecycle.withResumed{};current()
                if(uri==null)NativeMessageKeyTransfer.failed(request)else withContext(Dispatchers.IO){current();request.deliver(context,uri,::current)}
            }catch(cancel:CancellationException){NativeMessageKeyTransfer.failed(request);throw cancel}catch(_:Exception){NativeMessageKeyTransfer.failed(request)}
        }}
        val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/json"),::returned)
        val open=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(),::returned)
        LaunchedEffect(request.id){
            try{check(saved.phase=="requested"){"MESSAGING_FILE_CHANGED"};lifecycle.withResumed{};current();request.picking()
                if(request.kind=="export")save.launch("genesis-messaging-key.json")else open.launch(arrayOf("application/json","text/*","application/octet-stream"))
            }catch(cancel:CancellationException){NativeMessageKeyTransfer.failed(request);throw cancel}catch(_:Exception){NativeMessageKeyTransfer.failed(request)}
        }
    }}
}
