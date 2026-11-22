package ru.genesis.calendar.ui

import android.app.Activity
import android.app.KeyguardManager
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.withResumed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import ru.genesis.calendar.security.NativeMigrationCredential
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** One request, one launcher and one captured operation. Admission waits for
 * RESUMED; background closes active material. Pending system confirmation has
 * an elapsed-time deadline but a long admitted migration is not time-limited. */
@Composable internal fun RecoveryCredentialActivity(
    request:NativeMigrationCredential?,title:String,description:String,
    operation:suspend(NativeMigrationCredential,NativeMigrationCredential.Opened,()->Unit)->Unit,
    finished:(NativeMigrationCredential,Exception?)->Unit,
){
    request?.let{held->key(held.id){
        val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle;val scope=rememberCoroutineScope()
        val ended=remember(held){AtomicBoolean(false)};val returned=remember(held){AtomicBoolean(false)}
        val active=remember(held){AtomicReference<NativeMigrationCredential.Opened?>(null)}
        val foreground=remember(lifecycle){AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
        fun current(){held.current();check(foreground.get()){"E2EE_FOREGROUND_REQUIRED"}}
        fun finish(reason:Exception?){if(ended.compareAndSet(false,true)){held.close();active.getAndSet(null)?.close();finished(held,reason)}}
        DisposableEffect(held,lifecycle){
            val observer=LifecycleEventObserver{_,event->
                if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
                if(event==Lifecycle.Event.ON_PAUSE){foreground.set(false);if(!held.waitingForCredential)finish(IllegalStateException("E2EE_FOREGROUND_REQUIRED"))}
                if(event==Lifecycle.Event.ON_DESTROY)finish(IllegalStateException("E2EE_CREDENTIAL_REVOKED"))
            }
            lifecycle.addObserver(observer)
            onDispose{ended.set(true);held.close();active.getAndSet(null)?.close();lifecycle.removeObserver(observer)}
        }
        val launcher=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
            if(returned.compareAndSet(false,true)&&!ended.get()){
                if(result.resultCode!=Activity.RESULT_OK)finish(IllegalStateException("E2EE_CREDENTIAL_CANCELLED"))
                else scope.launch{
                    try{
                        lifecycle.withResumed{};current();val material=held.claim(held.ownerId,held.viewId,held.attempt,SystemClock.elapsedRealtime());active.set(material)
                        current();operation(held,material,::current);finish(null)
                    }catch(cancel:CancellationException){finish(cancel);throw cancel}catch(reason:Exception){finish(reason)}
                    finally{active.getAndSet(null)?.close()}
                }
            }
        }
        LaunchedEffect(held.id){
            try{
                lifecycle.withResumed{};current();val keyguard=context.getSystemService(KeyguardManager::class.java)
                check(keyguard.isDeviceSecure){"E2EE_CREDENTIAL_UNAVAILABLE"}
                @Suppress("DEPRECATION") val intent=keyguard.createConfirmDeviceCredentialIntent(title,description)?:error("E2EE_CREDENTIAL_UNAVAILABLE")
                launcher.launch(intent)
            }catch(cancel:CancellationException){finish(cancel);throw cancel}catch(reason:Exception){finish(reason)}
        }
        LaunchedEffect(held.id,"expiry"){delay(held.remainingMillis());if(held.waitingForCredential)finish(IllegalStateException("E2EE_CREDENTIAL_EXPIRED"))}
    }}
}
