package ru.genesis.calendar.ui

import android.app.Activity
import android.os.SystemClock
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.*
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import org.json.JSONObject

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
        val language=LocalGenesisLanguage.current
        val copy=remember(language){context.assets.open("native-unlock-copy-v1.json").use{input->val all=JSONObject(input.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
        var fingerprintVisible by remember(held){mutableStateOf(false)};var fingerprintRetry by remember(held){mutableStateOf(false)}
        val authenticationRef=remember(held){AtomicReference<NativeDeviceAuthentication?>(null)}
        val ended=remember(held){AtomicBoolean(false)};val returned=remember(held){AtomicBoolean(false)}
        val active=remember(held){AtomicReference<NativeMigrationCredential.Opened?>(null)}
        val foreground=remember(lifecycle){AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
        fun current(){held.current();check(foreground.get()){"E2EE_FOREGROUND_REQUIRED"}}
        fun finish(reason:Exception?){if(ended.compareAndSet(false,true)){authenticationRef.get()?.close();held.close();active.getAndSet(null)?.close();finished(held,reason)}}
        DisposableEffect(held,lifecycle){
            val observer=LifecycleEventObserver{_,event->
                if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
                if(event==Lifecycle.Event.ON_PAUSE){foreground.set(false);if(!held.waitingForCredential)finish(IllegalStateException("E2EE_FOREGROUND_REQUIRED"))}
                if(event==Lifecycle.Event.ON_STOP&&authenticationRef.get()?.systemCredentialPending!=true)finish(IllegalStateException("E2EE_FOREGROUND_REQUIRED"))
                if(event==Lifecycle.Event.ON_DESTROY)finish(IllegalStateException("E2EE_CREDENTIAL_REVOKED"))
            }
            lifecycle.addObserver(observer)
            onDispose{ended.set(true);authenticationRef.getAndSet(null)?.close();held.close();active.getAndSet(null)?.close();lifecycle.removeObserver(observer)}
        }
        fun authenticated(accepted:Boolean){
            if(returned.compareAndSet(false,true)&&!ended.get()){
                if(!accepted)finish(IllegalStateException("E2EE_CREDENTIAL_CANCELLED"))
                else scope.launch{
                    try{
                        lifecycle.withResumed{};current();val material=held.claim(held.ownerId,held.viewId,held.attempt,SystemClock.elapsedRealtime());active.set(material)
                        current();operation(held,material,::current);finish(null)
                    }catch(cancel:CancellationException){finish(cancel);throw cancel}catch(reason:Exception){finish(reason)}
                    finally{active.getAndSet(null)?.close()}
                }
            }
        }
        val launcher=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->authenticationRef.get()?.credentialReturned(result.resultCode==Activity.RESULT_OK)}
        val authentication=remember(held,context,lifecycle){NativeDeviceAuthentication(context,title,description,copy.getString("pin"),{launcher.launch(it)},
            {visible,retry->fingerprintVisible=visible;fingerprintRetry=retry},::authenticated).also{authenticationRef.set(it)}}
        if(fingerprintVisible)AlertDialog(onDismissRequest={authentication.cancel()},title={Text(title)},
            text={Text(copy.getString(if(fingerprintRetry)"retry"else"hint"))},
            confirmButton={TextButton(onClick={authentication.useCredential()}){Text(copy.getString("pin"))}},
            dismissButton={TextButton(onClick={authentication.cancel()}){Text(copy.getString("cancel"))}})
        LaunchedEffect(held.id){
            try{
                lifecycle.withResumed{};current();authentication.start()
            }catch(cancel:CancellationException){finish(cancel);throw cancel}catch(reason:Exception){finish(reason)}
        }
        LaunchedEffect(held.id,"expiry"){delay(held.remainingMillis());if(held.waitingForCredential)finish(IllegalStateException("E2EE_CREDENTIAL_EXPIRED"))}
    }}
}
