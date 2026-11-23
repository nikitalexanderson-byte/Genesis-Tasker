package ru.genesis.calendar.ui

import android.app.KeyguardManager
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import android.os.SystemClock
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.activity
import ru.genesis.calendar.security.NativeMigrationCredential
import ru.genesis.calendar.security.NativeRecoveryFileRequest
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

/** Full-screen unlock keeps the existing private editors unmounted. Secret and
 * chosen kit are deliberately not rememberSaveable or placed in a ViewModel. */
@Composable
internal fun PrivateVaultGate(controller:AuthController,state:AuthPanelState){
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    key(state.user?.uid,lifecycle){PrivateVaultGateContent(controller,state)}
}
@Composable private fun PrivateVaultGateContent(controller:AuthController,state:AuthPanelState){
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle;val language=state.accountSettings?.language?:"en"
    val copy=remember(language){context.assets.open("vault-copy-v1.json").use{input->val bytes=input.readBytes()
        try{check(bytes.size<=128*1024);val all=JSONObject(bytes.toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}finally{bytes.fill(0)}}}
    val unlockCopy=remember(language){context.assets.open("native-unlock-copy-v1.json").use{input->val all=JSONObject(input.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    var secret by remember(state.user?.uid){mutableStateOf("")};var kit by remember(state.user?.uid){mutableStateOf<JSONObject?>(null)}
    val owner=state.user?.uid;var trusted by remember(owner){mutableStateOf(false)};val personalCopy=remember(language){context.assets.open("personal-device-entry-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}};val viewId=remember(owner){UUID.randomUUID().toString()}
    val alive=remember(owner){AtomicBoolean(true)}
    val foreground=remember(owner,lifecycle){AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
    var busy by remember(owner){mutableStateOf(false)};var failed by remember(owner){mutableStateOf(false)}
    val pendingCredential=remember(owner){AtomicReference<NativeMigrationCredential?>(null)}
    var credentialActivity by remember(owner){mutableStateOf<NativeMigrationCredential?>(null)}
    val credentialAttempt=remember(owner){AtomicLong(0)}
    val pendingFile=remember(owner){AtomicReference<NativeRecoveryFileRequest?>(null)}
    var fileActivity by remember(owner){mutableStateOf<NativeRecoveryFileRequest?>(null)}
    val fileAttempt=remember(owner){AtomicLong(0)}
    var needsRecovery by remember(state.user?.uid){mutableStateOf(false)}
    var hardwareRecovery by remember(state.user?.uid){mutableStateOf(false)}
    var recoveryConfirmed by remember(state.user?.uid){mutableStateOf(false)}
    val recoveryCopy=remember(language){context.assets.open("native-key-recovery-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val hasDevice=state.user?.uid?.let(controller::privateVaultDeviceExists)?:false
    val keyguard=context.getSystemService(KeyguardManager::class.java)
    fun current(){check(alive.get()&&owner!=null&&controller.state.value.user?.uid==owner){"E2EE_ACCOUNT_CHANGED"}}
    fun resumed(){current();check(foreground.get()){"E2EE_FOREGROUND_REQUIRED"}}
    DisposableEffect(owner,lifecycle){
        val observer=LifecycleEventObserver{_,event->
            if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
            if(event==Lifecycle.Event.ON_PAUSE)foreground.set(false)
            if(event==Lifecycle.Event.ON_STOP){secret="";kit=null}
        };lifecycle.addObserver(observer)
        onDispose{alive.set(false);lifecycle.removeObserver(observer);pendingCredential.getAndSet(null)?.close();pendingFile.getAndSet(null)?.close();secret="";kit=null}
    }
    LaunchedEffect(owner,state.requiresSignIn,state.checkedAt,state.busy){
        if(runCatching{pendingCredential.get()?.current();pendingFile.get()?.current()}.isFailure){
            pendingCredential.getAndSet(null)?.close();pendingFile.getAndSet(null)?.close();credentialActivity=null;fileActivity=null
            secret="";kit=null;busy=false;failed=true
        }
    }
    fun selectKit(){if(!busy)try{
        resumed();val uid=requireNotNull(owner);val binding=controller.privateUiOwnerGuard(uid,allowOffline=true);val attempt=fileAttempt.incrementAndGet()
        val request=NativeRecoveryFileRequest.read(uid,viewId){current();binding();check(fileAttempt.get()==attempt){"E2EE_RECOVERY_REQUEST_CHANGED"}}
        check(pendingFile.compareAndSet(null,request)){request.close();"E2EE_RECOVERY_REQUEST_CHANGED"}
        kit=null;secret="";busy=true;failed=false;fileActivity=request
    }catch(_:Exception){busy=false;failed=true}}
    RecoveryFileActivity(fileActivity){request,result->if(pendingFile.compareAndSet(request,null)&&alive.get()){
        fileActivity=null
        try{current();when(result){
            is RecoveryFileResult.Loaded->{resumed();kit=result.kit;failed=false}
            RecoveryFileResult.Cancelled->Unit
            else->failed=true
        }}catch(_:Exception){failed=true}finally{busy=false}
    }}
    fun unlock(offline:Boolean){if(!busy)try{
        resumed();val uid=requireNotNull(owner);val binding=controller.privateUiOwnerGuard(uid,allowOffline=offline)
        val request=NativeMigrationCredential.captureVault(uid,viewId,credentialAttempt.incrementAndGet(),secret,kit,offline,
            hardwareRecovery&&recoveryConfirmed&&!offline,SystemClock.elapsedRealtime()){current();binding()}
        check(pendingCredential.compareAndSet(null,request)){request.close();"E2EE_CREDENTIAL_PENDING"}
        secret="";kit=null;busy=true;failed=false;credentialActivity=request
    }catch(_:Exception){secret="";busy=false;failed=true}}
    RecoveryCredentialActivity(credentialActivity,copy.getString("title"),copy.getString(if(credentialActivity?.isOffline==true)"offline"else"description"),operation={request,material,admit->
        fun owns(){resumed();admit();check(pendingCredential.get()===request&&credentialAttempt.get()==request.attempt){"E2EE_CREDENTIAL_REVOKED"}}
        owns();controller.unlockPrivateVaultMaterial(material.secret.takeIf{it.isNotEmpty()},material.kit,material.offline,material.restoreHardware,::owns)
    },finished={request,reason->if(pendingCredential.compareAndSet(request,null)&&alive.get()){
        credentialActivity=null;secret="";kit=null;busy=false
        if(reason!=null){
            if(reason.message=="E2EE_MIGRATION_RESUME_REQUIRED")owner?.let{ru.genesis.calendar.security.NativeMigrationUiState.show(it,language,true)}
            if(reason.message=="E2EE_RECOVERY_KIT_REQUIRED")needsRecovery=true
            if(reason.message in setOf("E2EE_DEVICE_KEY_UNAVAILABLE","E2EE_DEVICE_KEY_INVALIDATED","E2EE_CORRUPT_DEVICE_VAULT")){hardwareRecovery=true;needsRecovery=true;recoveryConfirmed=false}
            failed=true
        }
    }})
    BackHandler{}
    if(trusted&&owner!=null){Surface(modifier=Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.spacedBy(20.dp)){PrivatePersonalDeviceEntry(controller,owner,language);TextButton({trusted=false},modifier=Modifier.heightIn(min=48.dp)){UntranslatedText(personalCopy.getString("back"))}}};return}
    Surface(modifier=Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.Center){
            Column(Modifier.widthIn(max=560.dp).fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(20.dp)){
                Text(copy.getString("title"),style=MaterialTheme.typography.headlineMedium,modifier=Modifier.semantics{heading()})
                Text(copy.getString("description"),style=MaterialTheme.typography.bodyLarge)
                if((!hasDevice||needsRecovery)&&state.user!=null){
                    TextButton(onClick={selectKit()},enabled=!busy,modifier=Modifier.heightIn(min=48.dp)){Text(copy.getString("kit"))}
                    Text(copy.getString("kitHint"),style=MaterialTheme.typography.bodyMedium)
                    OutlinedTextField(value=secret,onValueChange={secret=it.take(64)},label={Text(copy.getString("secret"))},singleLine=true,
                        visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),enabled=!busy,modifier=Modifier.fillMaxWidth())
                }
                TextButton(onClick={secret="";kit=null;trusted=true},enabled=!busy,modifier=Modifier.heightIn(min=48.dp)){UntranslatedText(personalCopy.getString("title"))}
                if(failed)Text(copy.getString("error"),color=MaterialTheme.colorScheme.error,style=MaterialTheme.typography.bodyMedium)
                if(hardwareRecovery){
                    Text(recoveryCopy.getString("notice"),style=MaterialTheme.typography.bodyMedium)
                    Row(Modifier.fillMaxWidth(),verticalAlignment=androidx.compose.ui.Alignment.CenterVertically){
                        Checkbox(checked=recoveryConfirmed,onCheckedChange={recoveryConfirmed=it},enabled=!busy)
                        Text(recoveryCopy.getString("confirmed"),modifier=Modifier.weight(1f))
                    }
                }
                if(state.user==null||state.requiresSignIn){Button(onClick={context.activity()?.let{controller.signIn(it,language)}},enabled=!busy&&!state.busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(copy.getString("signIn"))}}
                else if(!keyguard.isDeviceSecure){Button(onClick={context.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(copy.getString("screenLock"))}}
                else Button(onClick={unlock(false)},enabled=!busy&&!state.busy&&(hasDevice&&!needsRecovery||secret.isNotBlank()&&kit!=null)&&(!hardwareRecovery||recoveryConfirmed),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(if(hardwareRecovery&&!busy)recoveryCopy.getString("action")else if(hasDevice&&!needsRecovery&&!busy)unlockCopy.getString("unlock")else copy.getString(if(busy)"busy"else "unlock"))}
                if(hasDevice&&state.user!=null&&keyguard.isDeviceSecure)TextButton(onClick={unlock(true)},enabled=!busy&&!state.busy&&!hardwareRecovery&&!needsRecovery,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(copy.getString("offline"))}
                TextButton(onClick={secret="";kit=null;controller.logout()},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(copy.getString("exit"))}
                Text(copy.getString("privacy"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
