package ru.genesis.calendar.ui

import android.content.Intent
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.withResumed
import kotlinx.coroutines.*
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.security.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** A launcher belongs to an exact job AND picker attempt. Only its live,
 * unexpired owner/session/restore-bound return can start foreground ciphertext
 * delivery. Persisted writing metadata never starts provider IO by itself. */
@Composable internal fun PrivateBackupFileActivity(owner:String?){
    val context=LocalContext.current.applicationContext;val lifecycle=LocalLifecycleOwner.current.lifecycle
    val auth=remember(context){AuthController.get(context)};val identity by auth.state.collectAsStateWithLifecycle()
    val initialized=remember(context){runCatching{PrivateBackupHandoff.initialize(context)}.isSuccess}
    if(!initialized)return // A corrupt journal is not an empty/new handoff.
    val job by PrivateBackupHandoff.state.collectAsStateWithLifecycle()
    job?.takeIf{it.ownerId==owner&&it.ownerId==identity.user?.uid}?.let{saved->key(saved.id,saved.attemptId,owner,lifecycle){
        val scope=rememberCoroutineScope()
        val original=remember{saved.copy(phase="pick",uri=null)}
        val picker=remember{AtomicReference<NativeBackupPicker?>(null)}
        val admission=remember{AtomicReference<(() -> Unit)?>(null)}
        val active=remember{AtomicReference<NativeBackupFileAccess?>(null)}
        val activeJob=remember{AtomicReference<Job?>(null)}
        val live=remember{AtomicBoolean(true)}
        val foreground=remember{AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
        fun fail(){
            picker.getAndSet(null)?.close();active.getAndSet(null)?.close();activeJob.get()?.cancel()
            if(PrivateBackupHandoff.state.value?.phase in setOf("pick","picking","writing"))PrivateBackupHandoff.failed(context,original)
        }
        fun current(){check(live.get()&&foreground.get()){"E2EE_FOREGROUND_REQUIRED"};requireNotNull(admission.get()){ "BACKUP_HANDOFF_CHANGED" }.invoke()}
        DisposableEffect(lifecycle){
            val observer=LifecycleEventObserver{_,event->
                if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
                if(event==Lifecycle.Event.ON_PAUSE){foreground.set(false);if(active.get()!=null)fail()}
                if(event==Lifecycle.Event.ON_DESTROY)fail()
            };lifecycle.addObserver(observer)
            onDispose{live.set(false);lifecycle.removeObserver(observer);fail();admission.set(null)}
        }
        fun returned(uri:Uri?){
            val request=picker.get()?:return
            if(!request.returned())return
            scope.launch{
                var io:NativeBackupFileAccess?=null;var expiry:Job?=null
                val operation=currentCoroutineContext().job
                try{
                    lifecycle.withResumed{};current();request.claim()
                    if(uri!=null)withContext(Dispatchers.IO){
                        current();request.current()
                        runCatching{context.contentResolver.takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION or if(original.kind=="export")Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)}
                        current();request.current()
                    }
                    current();request.current()
                    val selected=PrivateBackupHandoff.selected(context,request.job,uri);current()
                    picker.compareAndSet(request,null);request.close()
                    if(selected.kind=="export"&&selected.phase=="writing"){
                        val ownerGuard=requireNotNull(admission.get())
                        val access=NativeBackupFileAccess(selected){check(live.get()&&foreground.get()){"E2EE_FOREGROUND_REQUIRED"};ownerGuard()};io=access
                        active.set(access);activeJob.set(operation)
                        expiry=scope.launch{delay(access.remainingMillis());if(active.get()===access)fail()}
                        withContext(Dispatchers.IO){PrivateBackupHandoff.deliver(context,selected,access)}
                    }
                }catch(cancel:CancellationException){PrivateBackupHandoff.failed(context,original);throw cancel}
                catch(_:Exception){PrivateBackupHandoff.failed(context,original)}
                finally{expiry?.cancel();io?.let{active.compareAndSet(it,null);it.close()};activeJob.compareAndSet(operation,null);picker.compareAndSet(request,null);request.close()}
            }
        }
        val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream"),::returned)
        val open=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument(),::returned)
        LaunchedEffect(saved.id,saved.attemptId){
            if(saved.phase!="pick")return@LaunchedEffect
            var request:NativeBackupPicker?=null
            try{
                lifecycle.withResumed{};check(live.get()&&foreground.get()){"E2EE_FOREGROUND_REQUIRED"}
                val guard=auth.privateUiOwnerGuard(saved.ownerId,allowOffline=true);admission.set(guard)
                val captured=NativeBackupPicker(original,guard);request=captured;picker.set(captured)
                current();captured.current();PrivateBackupHandoff.beginPicker(context,original)
                if(original.kind=="export")save.launch("genesis-${original.id}.genesisbackup")else open.launch(arrayOf("application/octet-stream","application/json","*/*"))
                delay(captured.remainingMillis());if(picker.get()===captured&&active.get()==null)fail()
            }catch(cancel:CancellationException){request?.close();fail();throw cancel}
            catch(_:Exception){fail()}
        }
        LaunchedEffect(identity.user?.uid,identity.checkedAt,identity.requiresSignIn){
            if(admission.get()!=null&&runCatching{admission.get()?.invoke()}.isFailure)fail()
        }
    }}
}
