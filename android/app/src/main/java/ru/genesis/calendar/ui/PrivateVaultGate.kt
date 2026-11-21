package ru.genesis.calendar.ui

import android.app.Activity
import android.app.KeyguardManager
import android.content.Intent
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.lifecycle.withResumed
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.activity
import ru.genesis.calendar.security.E2eeFileManifestJson

/** Full-screen unlock keeps the existing private editors unmounted. Secret and
 * chosen kit are deliberately not rememberSaveable or placed in a ViewModel. */
@Composable
internal fun PrivateVaultGate(controller:AuthController,state:AuthPanelState){
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle;val language=state.accountSettings?.language?:"en"
    val copy=remember(language){context.assets.open("vault-copy-v1.json").use{input->val bytes=input.readBytes()
        try{check(bytes.size<=128*1024);val all=JSONObject(bytes.toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}finally{bytes.fill(0)}}}
    var secret by remember(state.user?.uid){mutableStateOf("")};var kit by remember(state.user?.uid){mutableStateOf<JSONObject?>(null)}
    var busy by remember{mutableStateOf(false)};var failed by remember{mutableStateOf(false)};val scope=rememberCoroutineScope()
    var offlineMode by remember{mutableStateOf(false)}
    var needsRecovery by remember(state.user?.uid){mutableStateOf(false)}
    var hardwareRecovery by remember(state.user?.uid){mutableStateOf(false)}
    var recoveryConfirmed by remember(state.user?.uid){mutableStateOf(false)}
    val recoveryCopy=remember(language){context.assets.open("native-key-recovery-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val hasDevice=state.user?.uid?.let(controller::privateVaultDeviceExists)?:false
    val keyguard=context.getSystemService(KeyguardManager::class.java)
    val credential=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
        if(result.resultCode==Activity.RESULT_OK){busy=true;failed=false;scope.launch{
            try{lifecycle.withResumed{};controller.unlockPrivateVault(secret,kit,offlineMode,hardwareRecovery&&recoveryConfirmed&&!offlineMode)}catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(error:Exception){
                if(error.message=="E2EE_RECOVERY_KIT_REQUIRED")needsRecovery=true
                if(error.message in setOf("E2EE_DEVICE_KEY_UNAVAILABLE","E2EE_DEVICE_KEY_INVALIDATED","E2EE_CORRUPT_DEVICE_VAULT")){hardwareRecovery=true;needsRecovery=true;recoveryConfirmed=false}
                failed=true}
            finally{secret="";busy=false}
        }}else{secret="";failed=true}
    }
    val selectedFile=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->
        kit=null;if(uri!=null){busy=true;scope.launch{
            try{kit=withContext(Dispatchers.IO){val input=context.contentResolver.openInputStream(uri)?:error("E2EE_INVALID_RECOVERY_KIT")
                input.use{stream->val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
                    try{while(true){val count=stream.read(buffer);if(count<0)break;check(count>0&&output.size()+count<=65536){"E2EE_INVALID_RECOVERY_KIT"};output.write(buffer,0,count)}
                        val bytes=output.toByteArray();try{E2eeFileManifestJson.readPrivateDocument(bytes).also{check(it.getString("ownerId")==state.user?.uid&&it.getInt("protocol")==1){"E2EE_SCOPE_BINDING_MISMATCH"}}}finally{bytes.fill(0)}
                    }finally{buffer.fill(0);output.reset()}}}}
            catch(cancelled:kotlinx.coroutines.CancellationException){throw cancelled}catch(_:Exception){failed=true}finally{busy=false}
        }}
    }
    BackHandler{}
    Surface(modifier=Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){
        Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.Center){
            Column(Modifier.widthIn(max=560.dp).fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(20.dp)){
                Text(copy.getString("title"),style=MaterialTheme.typography.headlineMedium,modifier=Modifier.semantics{heading()})
                Text(copy.getString("description"),style=MaterialTheme.typography.bodyLarge)
                if((!hasDevice||needsRecovery)&&state.user!=null){
                    OutlinedTextField(value=secret,onValueChange={secret=it.take(64)},label={Text(copy.getString("secret"))},singleLine=true,
                        visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),enabled=!busy,modifier=Modifier.fillMaxWidth())
                    TextButton(onClick={selectedFile.launch(arrayOf("application/json","application/octet-stream"))},enabled=!busy,modifier=Modifier.heightIn(min=48.dp)){Text(copy.getString("kit"))}
                    Text(copy.getString("kitHint"),style=MaterialTheme.typography.bodyMedium)
                }
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
                else Button(onClick={
                    offlineMode=false
                    @Suppress("DEPRECATION") val intent=keyguard.createConfirmDeviceCredentialIntent(copy.getString("title"),copy.getString("description"))
                    if(intent!=null)credential.launch(intent)else failed=true
                },enabled=!busy&&!state.busy&&(hasDevice&&!needsRecovery||secret.isNotBlank()&&kit!=null)&&(!hardwareRecovery||recoveryConfirmed),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(if(hardwareRecovery&&!busy)recoveryCopy.getString("action")else copy.getString(if(busy)"busy"else "unlock"))}
                if(hasDevice&&state.user!=null&&keyguard.isDeviceSecure)TextButton(onClick={
                    offlineMode=true
                    @Suppress("DEPRECATION") val intent=keyguard.createConfirmDeviceCredentialIntent(copy.getString("title"),copy.getString("offline"))
                    if(intent!=null)credential.launch(intent)else failed=true
                },enabled=!busy&&!state.busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(copy.getString("offline"))}
                TextButton(onClick={secret="";kit=null;controller.logout()},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(copy.getString("exit"))}
                Text(copy.getString("privacy"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
    }
}
