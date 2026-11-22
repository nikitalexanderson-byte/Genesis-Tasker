package ru.genesis.calendar.ui

import android.os.SystemClock
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.security.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong
import java.util.concurrent.atomic.AtomicReference

private data class PersonalEntryInput(val action:String,val target:String,val compared:String,val approval:String)
/** Every native candidate step obtains a fresh bounded system credential. Only
 * public exchange material leaves that step; device/root handles stay on IO. */
@Composable internal fun PrivatePersonalDeviceEntry(controller:AuthController,owner:String,language:String){
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle
    fun copy(name:String)=context.assets.open(name).use{input->val bytes=input.readBytes();try{check(bytes.size<=512*1024);val all=JSONObject(bytes.toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}finally{bytes.fill(0)}}
    val c=remember(language){copy("personal-device-entry-copy-v1.json")};val d=remember(language){copy("device-access-copy-v1.json")};val common=remember(language){copy("shared-security-copy-v1.json")}
    var target by remember(owner){mutableStateOf("")};var compared by remember(owner){mutableStateOf("")};var fingerprint by remember(owner){mutableStateOf("")};var approval by remember(owner){mutableStateOf("")}
    var view by remember(owner){mutableStateOf<JSONObject?>(null)};var busy by remember(owner){mutableStateOf(false)};var message by remember(owner){mutableStateOf("")}
    val alive=remember(owner){AtomicBoolean(true)};val foreground=remember(owner,lifecycle){AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))};val attempt=remember(owner){AtomicLong()};val viewId=remember(owner){UUID.randomUUID().toString()}
    val pending=remember(owner){AtomicReference<NativeMigrationCredential?>(null)};val captured=remember(owner){AtomicReference<PersonalEntryInput?>(null)};val output=remember(owner){AtomicReference<JSONObject?>(null)}
    var activity by remember(owner){mutableStateOf<NativeMigrationCredential?>(null)}
    fun current(){check(alive.get()&&controller.state.value.user?.uid==owner){"E2EE_ACCOUNT_CHANGED"}}
    fun resumed(){current();check(foreground.get()){"E2EE_FOREGROUND_REQUIRED"}}
    fun parse(input:String):JSONObject{val bytes=input.toByteArray(Charsets.UTF_8);return try{check(bytes.size in 1..128*1024){"E2EE_DEVICE_ACCESS_INVALID"};E2eeFileManifestJson.readPrivateDocument(bytes)}finally{bytes.fill(0)}}
    DisposableEffect(owner,lifecycle){val observer=LifecycleEventObserver{_,event->
        if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
        if(event==Lifecycle.Event.ON_PAUSE)foreground.set(false)
        if(event==Lifecycle.Event.ON_STOP){target="";compared="";fingerprint="";approval="";view=null;message=""}
    };lifecycle.addObserver(observer);onDispose{alive.set(false);attempt.incrementAndGet();pending.getAndSet(null)?.close();captured.set(null);output.set(null);lifecycle.removeObserver(observer)}}
    fun start(action:String){if(busy)return;try{resumed();val ownerGuard=controller.privateUiOwnerGuard(owner);val number=attempt.incrementAndGet();val input=PersonalEntryInput(action,target,compared,approval)
        val request=NativeMigrationCredential.captureVault(owner,viewId,number,"",null,false,false,SystemClock.elapsedRealtime()){current();ownerGuard();check(attempt.get()==number){"E2EE_CREDENTIAL_REVOKED"}}
        check(pending.compareAndSet(null,request)){request.close();"E2EE_CREDENTIAL_PENDING"};captured.set(input);output.set(null);busy=true;message="";activity=request
    }catch(_:Exception){busy=false;message=common.getString("error")}}
    RecoveryCredentialActivity(activity,c.getString("title"),c.getString("notice"),operation={request,_,admit->
        fun owns(){resumed();admit();check(pending.get()===request&&attempt.get()==request.attempt){"E2EE_CREDENTIAL_REVOKED"}}
        owns();val input=captured.get()?:error("E2EE_DEVICE_ACCESS_REQUIRED");val result=controller.personalDeviceEntry(input.action,input.target,input.compared,input.approval,::owns);owns();output.set(result)
    },finished={request,reason->if(pending.compareAndSet(request,null)&&alive.get()){
        activity=null;captured.set(null);busy=false;val result=output.getAndSet(null)
        if(reason==null){view=result;approval="";message=""}else message=if(reason.message=="E2EE_CHALLENGE_EXPIRED")d.getString("expired")else common.getString("error")
    }})
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
        UntranslatedText(c.getString("title"),style=MaterialTheme.typography.titleMedium);UntranslatedText(c.getString("notice"))
        OutlinedTextField(target,{if(it.length<=8192){target=it;fingerprint="";compared=""}},enabled=!busy&&view==null,minLines=3,maxLines=6,label={UntranslatedText(c.getString("target"))},modifier=Modifier.fillMaxWidth())
        OutlinedButton({try{resumed();val value=E2eeDeviceAccessContract.target(parse(target));check(value.get("kind")=="personal"&&value.get("ownerId")==owner){"E2EE_SCOPE_BINDING_MISMATCH"};fingerprint=E2eeComparedPersonalDeviceTarget.fingerprint(value);compared="";message=""}catch(_:Exception){message=common.getString("error")}},enabled=!busy&&view==null&&target.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("inspect"))}
        if(fingerprint.isNotEmpty()){OutlinedTextField(fingerprint,{},readOnly=true,singleLine=true,label={UntranslatedText(c.getString("targetFingerprint"))},modifier=Modifier.fillMaxWidth());OutlinedTextField(compared,{if(it.length<=64)compared=it.trim()},enabled=!busy&&view==null,singleLine=true,label={UntranslatedText(d.getString("compare"))},modifier=Modifier.fillMaxWidth())}
        Button({start("begin")},enabled=!busy&&view==null&&fingerprint.isNotEmpty()&&compared==fingerprint,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(d.getString("create"))}
        if(controller.privateVaultDeviceExists(owner))OutlinedButton({start("resume")},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("resume"))}
        view?.let{result->val state=result.getJSONObject("state");if(!state.isNull("request")){
            OutlinedTextField(state.getJSONObject("request").toString(),{},readOnly=true,minLines=3,maxLines=6,label={UntranslatedText(d.getString("request"))},modifier=Modifier.fillMaxWidth())
            OutlinedTextField(result.getString("fingerprint"),{},readOnly=true,singleLine=true,label={UntranslatedText(d.getString("compare"))},modifier=Modifier.fillMaxWidth())
            val savedApproval=if(state.isNull("approval"))null else state.getJSONObject("approval").toString()
            OutlinedTextField(savedApproval?:approval,{if(it.length<=128*1024)approval=it},enabled=!busy&&savedApproval==null,minLines=3,maxLines=6,label={UntranslatedText(d.getString("approval"))},modifier=Modifier.fillMaxWidth())
            Button({start("submit")},enabled=!busy&&(savedApproval!=null||approval.isNotBlank()),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("finish"))}
            OutlinedButton({start("new")},enabled=!busy&&savedApproval==null,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("newRequest"))}
        }}
        if(message.isNotEmpty())UntranslatedText(message,color=MaterialTheme.colorScheme.error)
    }
}
