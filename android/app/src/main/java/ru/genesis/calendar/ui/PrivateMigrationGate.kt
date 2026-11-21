package ru.genesis.calendar.ui

import android.app.Activity
import android.app.KeyguardManager
import android.net.Uri
import android.os.SystemClock
import android.provider.Settings
import android.content.Intent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.withResumed
import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthPanelState
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.security.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference
import java.util.concurrent.atomic.AtomicLong

private fun migrationText(context:android.content.Context,language:String,name:String)=context.assets.open(name).use{input->
    val bytes=input.readBytes();try{check(bytes.size<=128*1024);val all=JSONObject(bytes.toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}finally{bytes.fill(0)}}
@Composable internal fun PrivateMigrationEntry(){
    val context=LocalContext.current;val auth=remember(context){AuthController.get(context)};val state by auth.state.collectAsStateWithLifecycle();val identity=state.user?:return
    if(identity.privateVault||state.requiresSignIn)return
    val language=LocalGenesisLanguage.current;val text=remember(language){migrationText(context,language,"migration-copy-v1.json")}
    var available by remember(identity.uid){mutableStateOf(false)};var resume by remember(identity.uid){mutableStateOf(false)}
    LaunchedEffect(identity.uid){try{val value=auth.privateMigrationStatus();check(value.getInt("cryptoProtocol")==1);val scopes=value.getJSONArray("scopes")
        resume=(0 until scopes.length()).map{scopes.getJSONObject(it)}.any{it.getString("kind")=="personal"&&it.getString("resourceId")==identity.uid&&it.getString("state") !in setOf("active","retirement")}
        available=value.getBoolean("pilotAllowed")||resume
    }catch(cancel:CancellationException){throw cancel}catch(_:Exception){available=false}}
    if(available)OutlinedButton({NativeMigrationUiState.show(identity.uid,language,resume)},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString(if(resume)"resume"else"entry"))}
}
/** Hosted above the normal vault gate, so an unfinished transfer can resume
 * after process death without mounting legacy content or running legacy sync. */
@Composable internal fun PrivateMigrationHost(controller:AuthController,auth:AuthPanelState){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication;val view by NativeMigrationUiState.state.collectAsStateWithLifecycle()
    LaunchedEffect(auth.user?.uid,auth.checkedAt,auth.busy){
        val owner=auth.user?.uid
        view?.takeIf{it.owner!=owner}?.let{NativeMigrationUiState.close(it.id)}
        if(owner!=null&&!auth.requiresSignIn&&!auth.busy)try{
            val marker=withContext(Dispatchers.IO){app.database.dao().legacyScopeFence(CloudAccountSnapshot.scopeFor(owner))}
            if(marker?.phase=="preparing")NativeMigrationUiState.show(owner,auth.accountSettings?.language?:"en",true)
        }catch(cancel:CancellationException){throw cancel}catch(_:Exception){/* Existing SQL/transport denial remains in force. */}
    }
    view?.takeIf{it.owner==auth.user?.uid}?.let{saved->key(saved.id){
        val night=rememberEveningTheme(AppearanceSettings.read("{}",auth.accountSettings?.theme?:"auto"));val palette=auth.accountSettings?.darkPalette?:"green"
        MaterialTheme(colorScheme=if(night)eveningPalette(palette)else daylightPalette(palette),typography=GenesisTypography,shapes=GenesisShapes){PrivateMigrationDialog(controller,auth,saved)}
    }}
}
@Composable private fun PrivateMigrationDialog(controller:AuthController,auth:AuthPanelState,view:NativeMigrationUiState.View){
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle;val scope=rememberCoroutineScope()
    val text=remember(view.language){migrationText(context,view.language,"migration-copy-v1.json")};val vault=remember(view.language){migrationText(context,view.language,"vault-copy-v1.json")}
    var phase by remember{mutableStateOf(if(view.resume||controller.privateVaultDeviceExists(view.owner))"confirm"else"intro")}
    var generatedKit by remember{mutableStateOf<JSONObject?>(null)};var generatedSecret by remember{mutableStateOf("")}
    var savedFile by remember{mutableStateOf(false)};var savedSecret by remember{mutableStateOf(false)}
    var secret by remember{mutableStateOf("")};var kit by remember{mutableStateOf<JSONObject?>(null)};var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf("")};var progress by remember{mutableStateOf("snapshot")};var started by remember{mutableStateOf(view.resume)}
    val alive=remember{AtomicBoolean(true)};val prepared=remember{AtomicReference<E2eeProductMigrationController?>(null)}
    val pendingSave=remember{AtomicReference<Pair<String,ByteArray>?>(null)}
    val pendingCredential=remember{AtomicReference<NativeMigrationCredential?>(null)}
    val credentialOutstanding=remember{AtomicBoolean(false)};val credentialAttempt=remember{AtomicLong(0)}
    val credentialTimeout=remember{AtomicReference<Job?>(null)};val activeSecret=remember{AtomicReference<ByteArray?>(null)}
    fun current(){check(alive.get()&&NativeMigrationUiState.state.value?.id==view.id&&controller.state.value.user?.uid==view.owner){"E2EE_ACCOUNT_CHANGED"}}
    fun foreground(){current();check(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)){"E2EE_FOREGROUND_REQUIRED"}}
    fun message(reason:Exception):String=if(Regex("E2EE_.*(?:CONFLICT|REVIEW_REQUIRED|ATTRIBUTION_REQUIRED)").matches(reason.message.orEmpty()))text.getString("reviewRequired")else text.getString("error")
    DisposableEffect(view.id,lifecycle){
        val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_STOP){
            prepared.getAndSet(null)?.let(controller::closePrivateMigration);secret="";kit=null
            activeSecret.getAndSet(null)?.fill(0)
            if(pendingSave.get()==null){generatedSecret="";generatedKit=null;if(phase=="generated")phase=if(started)"confirm"else"intro"}
        }};lifecycle.addObserver(observer)
        onDispose{alive.set(false);lifecycle.removeObserver(observer);prepared.getAndSet(null)?.let(controller::closePrivateMigration);pendingSave.getAndSet(null)?.second?.fill(0)
            credentialTimeout.getAndSet(null)?.cancel();pendingCredential.getAndSet(null)?.close();activeSecret.getAndSet(null)?.fill(0)}
    }
    val export=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->
        val request=pendingSave.getAndSet(null)
        if(uri!=null&&request!=null){busy=true;scope.launch{try{
            current();withContext(Dispatchers.IO){
                val output=context.contentResolver.openOutputStream(uri,"wt")?:error("E2EE_STORAGE_UNAVAILABLE");output.use{it.write(request.second);it.flush()}
                val read=context.contentResolver.openInputStream(uri)?:error("E2EE_STORAGE_UNAVAILABLE")
                val bytes=read.use{it.readBytesAtMost(request.second.size+1)};try{check(bytes.contentEquals(request.second)){"E2EE_RECOVERY_UNVERIFIED"}}finally{bytes.fill(0)}
            };current();if(request.first=="kit")savedFile=true else savedSecret=true
        }catch(cancel:CancellationException){throw cancel}catch(reason:Exception){if(alive.get())error=message(reason)}finally{request.second.fill(0);if(alive.get())busy=false}}}
        else request?.second?.fill(0)
    }
    val select=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->
        kit=null;if(uri!=null){busy=true;scope.launch{try{
            val parsed=withContext(Dispatchers.IO){val input=context.contentResolver.openInputStream(uri)?:error("E2EE_INVALID_RECOVERY_KIT")
                val bytes=input.use{it.readBytesAtMost(65537)};try{check(bytes.size in 1..65536){"E2EE_INVALID_RECOVERY_KIT"};E2eeFileManifestJson.readPrivateDocument(bytes)}finally{bytes.fill(0)}}
            current();check(parsed.getString("ownerId")==view.owner&&parsed.getInt("protocol")==1){"E2EE_SCOPE_BINDING_MISMATCH"};kit=parsed;error=""
        }catch(cancel:CancellationException){throw cancel}catch(reason:Exception){if(alive.get())error=message(reason)}finally{if(alive.get())busy=false}}}
    }
    val credential=rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()){result->
        credentialOutstanding.set(false)
        val request=pendingCredential.get()
        if(request==null){if(alive.get())busy=false}
        else if(result.resultCode!=Activity.RESULT_OK){
            pendingCredential.compareAndSet(request,null);request.close();credentialTimeout.getAndSet(null)?.cancel()
            if(alive.get()&&credentialAttempt.get()==request.attempt){secret="";busy=false;error=text.getString("error")}
        }else scope.launch{
            var opened:NativeMigrationCredential.Opened?=null;var migration:E2eeProductMigrationController?=null
            fun owns(){foreground();check(credentialAttempt.get()==request.attempt){"E2EE_CREDENTIAL_REVOKED"}}
            try{
                lifecycle.withResumed{};owns();check(pendingCredential.compareAndSet(request,null)){"E2EE_CREDENTIAL_REVOKED"}
                credentialTimeout.getAndSet(null)?.cancel()
                val material=request.claim(view.owner,view.id,request.attempt,SystemClock.elapsedRealtime());opened=material;activeSecret.set(material.secret)
                started=true;phase="running";error=""
                val next=controller.preparePrivateMigration(material.secret,material.kit,::owns);migration=next;owns();prepared.set(next)
                next.run(material.secret,material.kit){value->owns();progress=value};owns()
                prepared.compareAndSet(next,null);controller.closePrivateMigration(next);migration=null;kit=null;phase="done";controller.checkSession()
            }catch(cancel:CancellationException){throw cancel}catch(reason:Exception){if(alive.get()&&credentialAttempt.get()==request.attempt){error=message(reason);phase="confirm"}}
            finally{
                pendingCredential.compareAndSet(request,null);request.close()
                opened?.let{activeSecret.compareAndSet(it.secret,null);it.close()}
                migration?.let{prepared.compareAndSet(it,null);controller.closePrivateMigration(it)}
                if(credentialAttempt.get()==request.attempt){credentialTimeout.getAndSet(null)?.cancel();if(alive.get()){secret="";busy=false}}
            }
        }
    }
    LaunchedEffect(phase,auth.user?.privateVault,auth.busy){if(phase=="done"&&auth.user?.privateVault==true&&!auth.busy)NativeMigrationUiState.close(view.id)}
    val keyguard=context.getSystemService(KeyguardManager::class.java)
    Dialog(onDismissRequest={},properties=DialogProperties(dismissOnBackPress=false,dismissOnClickOutside=false,usePlatformDefaultWidth=false,securePolicy=SecureFlagPolicy.SecureOn)){
        Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.Center){
            Column(Modifier.widthIn(max=560.dp).fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(20.dp)){
                Text(text.getString("title"),style=MaterialTheme.typography.headlineMedium,modifier=Modifier.semantics{heading()});Text(text.getString("intro"))
                if(phase=="intro")Button(onClick={if(!busy){busy=true;scope.launch{try{
                    val generated=withContext(Dispatchers.IO){E2eeKeys.createRecoveryKit(view.owner)}
                    try{current();generatedKit=generated.kit;generatedSecret=E2eeEnvelope.encode(generated.secret);savedFile=false;savedSecret=false;phase="generated"}finally{generated.secret.fill(0)}
                }catch(cancel:CancellationException){throw cancel}catch(reason:Exception){if(alive.get())error=message(reason)}finally{if(alive.get())busy=false}}}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("generate"))}
                if(phase=="generated"&&generatedKit!=null){
                    Text(text.getString("generated"));Text(text.getString("secretNote"))
                    OutlinedButton(onClick={pendingSave.set(Pair("kit",requireNotNull(generatedKit).toString(2).toByteArray(Charsets.UTF_8)));export.launch("genesis-recovery.json")},enabled=!busy&&pendingSave.get()==null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("saveFile"))}
                    OutlinedButton(onClick={pendingSave.set(Pair("secret",(generatedSecret+"\n").toByteArray(Charsets.UTF_8)));export.launch("genesis-recovery-secret.txt")},enabled=!busy&&pendingSave.get()==null&&generatedSecret.isNotEmpty(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("saveSecret"))}
                    Button(onClick={generatedKit=null;generatedSecret="";secret="";kit=null;phase="confirm"},enabled=savedFile&&savedSecret&&!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("saved"))}
                }
                if(phase=="confirm"){
                    Text(text.getString("confirm"));TextButton(onClick={select.launch(arrayOf("application/json","application/octet-stream"))},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("kit"))}
                    OutlinedTextField(secret,{secret=it.take(64)},label={Text(vault.getString("secret"))},visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth())
                    if(!keyguard.isDeviceSecure)Button(onClick={context.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("screenLock"))}
                    else Button(onClick={
                        if(!busy&&!credentialOutstanding.get())try{
                            foreground();@Suppress("DEPRECATION") val intent=keyguard.createConfirmDeviceCredentialIntent(text.getString("title"),text.getString("confirm"))?:error("E2EE_CREDENTIAL_UNAVAILABLE")
                            val request=NativeMigrationCredential.capture(view.owner,view.id,credentialAttempt.incrementAndGet(),secret,requireNotNull(kit){"E2EE_RECOVERY_KIT_REQUIRED"},SystemClock.elapsedRealtime())
                            check(pendingCredential.compareAndSet(null,request)){request.close();"E2EE_CREDENTIAL_PENDING"}
                            secret="";kit=null;busy=true;credentialOutstanding.set(true)
                            credentialTimeout.getAndSet(scope.launch{
                                delay(NativeMigrationCredential.TIMEOUT_MILLIS)
                                if(pendingCredential.compareAndSet(request,null)){request.close();if(alive.get()&&credentialAttempt.get()==request.attempt){error=text.getString("error");if(!credentialOutstanding.get())busy=false}}
                            })?.cancel()
                            try{credential.launch(intent)}catch(reason:Exception){credentialOutstanding.set(false);pendingCredential.compareAndSet(request,null);request.close();credentialTimeout.getAndSet(null)?.cancel();throw reason}
                        }catch(reason:Exception){secret="";if(alive.get()){busy=false;error=message(reason)}}
                    },enabled=!busy&&kit!=null&&secret.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString(if(started)"resume"else"begin"))}
                }
                if(phase=="running"||phase=="done")Text(text.getString(if(phase=="done"||progress=="active")"done"else progress))
                if(phase=="done"&&!auth.busy)TextButton(onClick={controller.checkSession()},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("unlock"))}
                if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
                Text(text.getString("kept"),style=MaterialTheme.typography.bodyMedium)
                if(!started)TextButton(onClick={secret="";kit=null;generatedSecret="";generatedKit=null;NativeMigrationUiState.close(view.id)},enabled=!busy&&pendingSave.get()==null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("close"))}
                TextButton(onClick={secret="";kit=null;generatedSecret="";generatedKit=null;controller.logout()},enabled=!busy&&pendingSave.get()==null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("exit"))}
                Text(vault.getString("privacy"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }}
    }
}
private fun java.io.InputStream.readBytesAtMost(maximum:Int):ByteArray{
    val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(8192)
    try{while(output.size()<maximum){val count=read(buffer,0,minOf(buffer.size,maximum-output.size()));if(count<0)break;check(count>0){"E2EE_STORAGE_UNAVAILABLE"};output.write(buffer,0,count)};return output.toByteArray()}
    finally{buffer.fill(0);output.reset()}
}
