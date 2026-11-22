package ru.genesis.calendar.ui

import android.app.KeyguardManager
import android.os.SystemClock
import android.provider.Settings
import android.content.Intent
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
    view?.takeIf{it.owner==auth.user?.uid}?.let{saved->key(saved.id,LocalLifecycleOwner.current.lifecycle){
        val night=rememberEveningTheme(AppearanceSettings.read("{}",auth.accountSettings?.theme?:"auto"));val palette=auth.accountSettings?.darkPalette?:"green"
        MaterialTheme(colorScheme=if(night)eveningPalette(palette)else daylightPalette(palette),typography=GenesisTypography,shapes=GenesisShapes){PrivateMigrationDialog(controller,auth,saved)}
    }}
}
@Composable private fun PrivateMigrationDialog(controller:AuthController,auth:AuthPanelState,view:NativeMigrationUiState.View){
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle;val scope=rememberCoroutineScope()
    val text=remember(view.language,view.target){migrationText(context,view.language,"migration-copy-v1.json").also{copy->if(view.target!=null){
        val shared=migrationText(context,view.language,"shared-migration-copy-v1.json");for(name in listOf("title","intro","done"))copy.put(name,shared.getString(name))
    }}};val vault=remember(view.language){migrationText(context,view.language,"vault-copy-v1.json")}
    val cancellation=remember(view.language){migrationText(context,view.language,"migration-cancel-copy-v1.json")}
    val creationText=remember(view.language){migrationText(context,view.language,"private-resource-copy-v1.json")}
    val projectText=remember(view.language){migrationText(context,view.language,"project-creation-copy-v1.json")}
    val projectCreation=view.creationId!=null&&view.target?.kind=="project"
    var projectReview by remember{mutableStateOf<JSONObject?>(null)};var reviewBusy by remember{mutableStateOf(false)}
    val creationReady=!projectCreation||projectReview?.getJSONObject("intent")?.isNull("review")==false
    var phase by remember{mutableStateOf(if(view.target!=null||view.resume||controller.privateVaultDeviceExists(view.owner))"confirm"else"intro")}
    val generatedMaterial=remember{AtomicReference<NativeRecoveryMaterial?>(null)}
    var generatedId by remember{mutableStateOf<String?>(null)}
    var savedFile by remember{mutableStateOf(false)};var savedSecret by remember{mutableStateOf(false)}
    var secret by remember{mutableStateOf("")};var kit by remember{mutableStateOf<JSONObject?>(null)};var busy by remember{mutableStateOf(false)}
    var stopping by remember{mutableStateOf(false)}
    var cancelConfirmed by remember{mutableStateOf(false)};var cancelling by remember{mutableStateOf(false)}
    val cancellationAttempt=remember{AtomicLong(-1)}
    var error by remember{mutableStateOf("")};var progress by remember{mutableStateOf("snapshot")};var started by remember{mutableStateOf(view.resume)}
    val alive=remember{AtomicBoolean(true)};val prepared=remember{AtomicReference<E2eeProductMigrationController?>(null)}
    val pendingFile=remember{AtomicReference<NativeRecoveryFileRequest?>(null)}
    var fileActivity by remember{mutableStateOf<NativeRecoveryFileRequest?>(null)}
    val fileAttempt=remember{AtomicLong(0)}
    val pendingCredential=remember{AtomicReference<NativeMigrationCredential?>(null)}
    var credentialActivity by remember{mutableStateOf<NativeMigrationCredential?>(null)}
    val credentialAttempt=remember{AtomicLong(0)};val activeSecret=remember{AtomicReference<ByteArray?>(null)}
    val migrationJob=remember{AtomicReference<Job?>(null)}
    val foregroundState=remember{AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
    fun current(){check(alive.get()&&NativeMigrationUiState.state.value?.id==view.id&&controller.state.value.user?.uid==view.owner&&!controller.state.value.requiresSignIn){"E2EE_ACCOUNT_CHANGED"}}
    fun foreground(){current();check(foregroundState.get()){"E2EE_FOREGROUND_REQUIRED"}}
    fun clearGenerated(){generatedMaterial.getAndSet(null)?.close();generatedId=null;savedFile=false;savedSecret=false}
    fun fileGuard(attempt:Long):()->Unit{
        val owner=controller.privateUiOwnerGuard(view.owner)
        return{current();owner();check(fileAttempt.get()==attempt){"E2EE_RECOVERY_REQUEST_CHANGED"}}
    }
    fun startFile(request:NativeRecoveryFileRequest){
        check(pendingFile.compareAndSet(null,request)){request.close();"E2EE_RECOVERY_REQUEST_CHANGED"}
        busy=true;error="";fileActivity=request
    }
    fun startCredential(cancel:Boolean){
        if(busy||reviewBusy||!creationReady||pendingCredential.get()!=null||cancel&&!cancelConfirmed)return
        try{
            foreground()
            val request=NativeMigrationCredential.capture(view.owner,view.id,credentialAttempt.incrementAndGet(),secret,requireNotNull(kit){"E2EE_RECOVERY_KIT_REQUIRED"},SystemClock.elapsedRealtime(),controller.privateUiOwnerGuard(view.owner))
            check(pendingCredential.compareAndSet(null,request)){request.close();"E2EE_CREDENTIAL_PENDING"}
            cancellationAttempt.set(if(cancel)request.attempt else -1);cancelling=cancel;cancelConfirmed=false
            secret="";kit=null;busy=true;credentialActivity=request
        }catch(reason:Exception){secret="";if(alive.get()){busy=false;error=text.getString("error")}}
    }
    fun message(reason:Exception):String=if(reason.message=="E2EE_PROJECT_TOPOLOGY_CHANGED")projectText.getString("changed")else if(reason.message in setOf("E2EE_RECIPIENT_REVIEW_REQUIRED","E2EE_PROJECT_RECIPIENT_REVIEW_REQUIRED"))creationText.getString("recipients")else if(Regex("E2EE_.*(?:CONFLICT|REVIEW_REQUIRED|ATTRIBUTION_REQUIRED)").matches(reason.message.orEmpty()))text.getString("reviewRequired")else text.getString("error")
    suspend fun reviewProject(confirm:Boolean=false,refresh:Boolean=true){
        if(!projectCreation||busy||reviewBusy)return;reviewBusy=true;error=""
        try{foreground();val id=requireNotNull(view.creationId);val result=if(confirm)controller.confirmPrivateProjectCreationReview(id,requireNotNull(projectReview).getString("topologyHash"),::foreground)
            else controller.previewPrivateProjectCreation(id,refresh,::foreground);foreground();val intent=result.getJSONObject("intent")
            check(intent.getString("scopeId")==view.target?.scopeId&&intent.getString("resourceId")==view.target?.resourceId){"E2EE_SCOPE_BINDING_MISMATCH"};projectReview=result
        }catch(cancel:CancellationException){throw cancel}catch(reason:Exception){if(alive.get()){if(!confirm||reason.message=="E2EE_PROJECT_TOPOLOGY_CHANGED")projectReview=null;error=message(reason)}}
        finally{if(alive.get())reviewBusy=false}
    }
    LaunchedEffect(view.id){if(projectCreation)reviewProject(false,false)}
    DisposableEffect(view.id,lifecycle){
        val observer=LifecycleEventObserver{_,event->
          if(event==Lifecycle.Event.ON_RESUME)foregroundState.set(true)
          if(event==Lifecycle.Event.ON_PAUSE)foregroundState.set(false)
          if(event==Lifecycle.Event.ON_STOP){
            prepared.getAndSet(null)?.let(controller::closePrivateMigration);secret="";kit=null;cancelConfirmed=false
            activeSecret.getAndSet(null)?.fill(0)
            if(pendingFile.get()?.waitingForPicker!=true){clearGenerated();if(phase=="generated")phase=if(started)"confirm"else"intro"}
        }};lifecycle.addObserver(observer)
        onDispose{alive.set(false);lifecycle.removeObserver(observer);prepared.getAndSet(null)?.let(controller::closePrivateMigration);pendingFile.getAndSet(null)?.close();generatedMaterial.getAndSet(null)?.close()
            pendingCredential.getAndSet(null)?.close();activeSecret.getAndSet(null)?.fill(0)}
    }
    LaunchedEffect(generatedId){val material=generatedMaterial.get()?:return@LaunchedEffect;delay(NativeRecoveryMaterial.LIFETIME_MILLIS)
        if(generatedMaterial.compareAndSet(material,null)){material.close();generatedId=null;savedFile=false;savedSecret=false;if(phase=="generated")phase=if(started)"confirm"else"intro"}}
    LaunchedEffect(auth.user?.uid,auth.requiresSignIn,auth.checkedAt,auth.busy){
        if(phase!="done"&&runCatching{generatedMaterial.get()?.current();pendingFile.get()?.current();pendingCredential.get()?.current()}.isFailure){
            pendingFile.getAndSet(null)?.close();pendingCredential.getAndSet(null)?.close();fileActivity=null;credentialActivity=null
            prepared.getAndSet(null)?.let(controller::closePrivateMigration);activeSecret.getAndSet(null)?.fill(0);clearGenerated()
            secret="";kit=null;busy=false;error=text.getString("error");phase=if(started)"confirm"else"intro"
        }
    }
    RecoveryFileActivity(fileActivity){request,result->
        if(pendingFile.compareAndSet(request,null)&&alive.get()){
            fileActivity=null
            try{current();when(result){
                is RecoveryFileResult.Saved->{foreground();val material=generatedMaterial.get()?:error("E2EE_RECOVERY_REQUEST_CHANGED")
                    check(material.id==request.materialId){"E2EE_RECOVERY_REQUEST_CHANGED"};material.saved(request.kind,result.uri)
                    if(request.kind=="kit")savedFile=true else savedSecret=true}
                is RecoveryFileResult.Loaded->{foreground();kit=result.kit;error=""}
                RecoveryFileResult.Cancelled->Unit
                RecoveryFileResult.Failed->{if(request.writing){clearGenerated();phase=if(started)"confirm"else"intro"};error=text.getString("error")}
            }}catch(reason:Exception){error=message(reason)}finally{busy=false}
        }
    }
    RecoveryCredentialActivity(credentialActivity,text.getString("title"),text.getString("confirm"),operation={request,material,admit->
            val job=currentCoroutineContext().job;check(migrationJob.compareAndSet(null,job)){"E2EE_MIGRATION_BUSY"}
            var migration:E2eeProductMigrationController?=null
            fun owns(){foreground();admit();check(pendingCredential.get()===request&&credentialAttempt.get()==request.attempt){"E2EE_CREDENTIAL_REVOKED"}}
            try{
                owns();activeSecret.set(material.secret)
                started=true;phase="running";error=""
                val suppliedKit=requireNotNull(material.kit){"E2EE_RECOVERY_KIT_REQUIRED"}
                if(view.creationId!=null){
                    check(cancellationAttempt.get()!=request.attempt){"E2EE_RESOURCE_CREATION_PAUSED"}
                    val result=if(projectCreation)controller.completePrivateProjectCreation(view.creationId,material.secret,suppliedKit,::owns,{value->owns();progress=value},{next->prepared.set(next)})
                        else controller.completePrivateSpaceCreation(view.creationId,material.secret,suppliedKit,::owns,{value->owns();progress=value},{next->prepared.set(next)})
                    owns();kit=null;NativeMigrationUiState.completeCreation(view.id,result);return@RecoveryCredentialActivity
                }
                val next=view.target?.let{controller.prepareSharedPrivateMigration(it,material.secret,suppliedKit,::owns)}?:controller.preparePrivateMigration(material.secret,suppliedKit,::owns);migration=next;owns();prepared.set(next)
                val cancel=cancellationAttempt.get()==request.attempt
                if(cancel)next.cancel(material.secret,suppliedKit)else next.run(material.secret,suppliedKit){value->owns();progress=value};owns()
                prepared.compareAndSet(next,null);controller.closePrivateMigration(next);migration=null
                if(!cancel&&view.target!=null){controller.finishSharedPrivateMigration(view.target);owns()}
                kit=null;phase=if(cancel)"cancelled"else"done";if(view.target==null)controller.checkSession()
            }finally{
                activeSecret.compareAndSet(material.secret,null)
                migration?.let{prepared.compareAndSet(it,null);controller.closePrivateMigration(it)}
                migrationJob.compareAndSet(job,null)
            }
    },finished={request,reason->
        if(pendingCredential.compareAndSet(request,null)&&alive.get()){
            credentialActivity=null;secret="";kit=null;cancelling=false;if(!stopping)busy=false
            if(reason!=null){if(!stopping)error=message(reason);if(reason.message=="E2EE_PROJECT_TOPOLOGY_CHANGED")projectReview=null;phase="confirm"}
        }
    })
    LaunchedEffect(phase,auth.user?.privateVault,auth.busy){if(phase=="done"&&auth.user?.privateVault==true&&!auth.busy)NativeMigrationUiState.close(view.id)}
    val keyguard=context.getSystemService(KeyguardManager::class.java)
    Dialog(onDismissRequest={},properties=DialogProperties(dismissOnBackPress=false,dismissOnClickOutside=false,usePlatformDefaultWidth=false,securePolicy=SecureFlagPolicy.SecureOn)){
        Surface(Modifier.fillMaxSize(),color=MaterialTheme.colorScheme.background){Column(Modifier.fillMaxSize().safeDrawingPadding().imePadding().verticalScroll(rememberScrollState()).padding(24.dp),verticalArrangement=Arrangement.Center){
            Column(Modifier.widthIn(max=560.dp).fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(20.dp)){
                Text(text.getString("title"),style=MaterialTheme.typography.headlineMedium,modifier=Modifier.semantics{heading()});Text(text.getString("intro"))
                if(phase=="intro")Button(onClick={if(!busy){busy=true;scope.launch{try{
                    foreground();val owner=controller.privateUiOwnerGuard(view.owner)
                    val createdSecret=AtomicReference<ByteArray?>(null)
                    try{val generated=withContext(Dispatchers.IO){owner();val created=E2eeKeys.createRecoveryKit(view.owner);createdSecret.set(created.secret)
                            try{owner();foreground();created}catch(reason:Throwable){created.secret.fill(0);throw reason}}
                        foreground();owner();val material=NativeRecoveryMaterial.capture(view.owner,view.id,generated.kit,generated.secret){current();owner()}
                        clearGenerated();generatedMaterial.set(material);generatedId=material.id;savedFile=false;savedSecret=false;phase="generated"
                    }finally{createdSecret.getAndSet(null)?.fill(0)}
                }catch(cancel:CancellationException){throw cancel}catch(reason:Exception){if(alive.get())error=message(reason)}finally{if(alive.get())busy=false}}}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("generate"))}
                if(phase=="generated"&&generatedId!=null){
                    Text(text.getString("generated"));Text(text.getString("secretNote"))
                    for(kind in listOf("kit","secret"))OutlinedButton(onClick={try{
                        foreground();val material=generatedMaterial.get()?:error("E2EE_RECOVERY_REQUEST_CHANGED");val guard=fileGuard(fileAttempt.incrementAndGet())
                        startFile(NativeRecoveryFileRequest.write(material,kind){guard();check(generatedMaterial.get()===material){"E2EE_RECOVERY_REQUEST_CHANGED"}})
                    }catch(reason:Exception){error=message(reason)}},enabled=!busy&&pendingFile.get()==null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString(if(kind=="kit")"saveFile"else"saveSecret"))}
                    Button(onClick={try{foreground();check(generatedMaterial.get()?.complete()==true){"E2EE_RECOVERY_UNVERIFIED"};clearGenerated();secret="";kit=null;phase="confirm"}catch(reason:Exception){error=message(reason)}},enabled=savedFile&&savedSecret&&!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("saved"))}
                }
                if(phase=="confirm"){
                    if(projectCreation){
                        Text(projectText.getString("title"),style=MaterialTheme.typography.titleMedium);Text(projectText.getString("intro"))
                        if(reviewBusy)Text(vault.getString("busy"))
                        projectReview?.let{review->
                            UntranslatedText(review.getJSONObject("intent").getJSONObject("input").getString("title"))
                            val members=review.getJSONArray("members");val roles=projectText.getJSONObject("roles")
                            for(at in 0 until members.length()){val member=members.getJSONObject(at)
                                Column(verticalArrangement=Arrangement.spacedBy(4.dp)){
                                    UntranslatedText(listOf(member.getString("displayName"),roles.getString(member.getString("role"))).filter{it.isNotEmpty()}.joinToString(" · "))
                                    UntranslatedText(member.getString("userId"),style=MaterialTheme.typography.bodySmall)
                                }
                            }
                            if(!review.getJSONObject("intent").isNull("review"))Text(projectText.getString("reviewed"))
                            else Button(onClick={scope.launch{reviewProject(true)}},enabled=!busy&&!reviewBusy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(projectText.getString("confirm"))}
                        }
                        if(projectReview?.getJSONObject("intent")?.getBoolean("started")!=true)OutlinedButton(onClick={scope.launch{reviewProject()}},enabled=!busy&&!reviewBusy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(projectText.getString(if(projectReview==null)"load"else"refresh"))}
                    }
                    if(creationReady){
                    Text(text.getString("confirm"));TextButton(onClick={try{foreground();kit=null;val guard=fileGuard(fileAttempt.incrementAndGet());startFile(NativeRecoveryFileRequest.read(view.owner,view.id,guard))}catch(reason:Exception){error=message(reason)}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("kit"))}
                    OutlinedTextField(secret,{secret=it.take(64)},label={Text(vault.getString("secret"))},visualTransformation=PasswordVisualTransformation(),keyboardOptions=KeyboardOptions(keyboardType=KeyboardType.Password),singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth())
                    if(!keyguard.isDeviceSecure)Button(onClick={context.startActivity(Intent(Settings.ACTION_SECURITY_SETTINGS))},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("screenLock"))}
                    else{
                        Button(onClick={startCredential(false)},enabled=!busy&&!reviewBusy&&kit!=null&&secret.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString(if(started)"resume"else"begin"))}
                        if(view.creationId==null&&(started||view.resume)){
                            Row{Checkbox(checked=cancelConfirmed,onCheckedChange={cancelConfirmed=it},enabled=!busy);Text(cancellation.getString("confirm"))}
                            OutlinedButton(onClick={startCredential(true)},enabled=!busy&&cancelConfirmed&&kit!=null&&secret.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(cancellation.getString("action"))}
                        }
                    }
                    }
                }
                if(phase=="running"||phase=="done")Text(if(cancelling)cancellation.getString("action")else text.getString(if(phase=="done"||progress=="active")"done"else progress))
                if(phase=="cancelled"){
                    Text(cancellation.getString("done"))
                    TextButton(onClick={NativeMigrationUiState.close(view.id)},enabled=!busy&&!auth.busy&&!auth.requiresSignIn&&auth.user?.uid==view.owner&&(view.target!=null||auth.user?.privateVault==false),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("close"))}
                }
                if(phase=="running")TextButton(onClick={if(!stopping){
                    stopping=true;credentialAttempt.incrementAndGet();scope.launch{
                        try{migrationJob.get()?.cancelAndJoin()}
                        finally{if(alive.get()){
                            prepared.getAndSet(null)?.let(controller::closePrivateMigration);pendingCredential.getAndSet(null)?.close();credentialActivity=null
                            activeSecret.getAndSet(null)?.fill(0);secret="";kit=null;error="";phase="confirm";stopping=false;busy=false
                        }}
                    }
                }},enabled=!stopping,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("stop"))}
                if(phase=="done"&&!auth.busy)TextButton(onClick={controller.checkSession()},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("unlock"))}
                if(error.isNotEmpty())Text(error,color=MaterialTheme.colorScheme.error)
                Text(text.getString("kept"),style=MaterialTheme.typography.bodyMedium)
                if(view.target!=null||!started)TextButton(onClick={secret="";kit=null;clearGenerated();NativeMigrationUiState.close(view.id)},enabled=!busy&&!reviewBusy&&pendingFile.get()==null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("close"))}
                TextButton(onClick={secret="";kit=null;clearGenerated();controller.logout()},enabled=!busy&&!reviewBusy&&pendingFile.get()==null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(vault.getString("exit"))}
                Text(vault.getString("privacy"),style=MaterialTheme.typography.bodySmall,color=MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }}
    }
}
