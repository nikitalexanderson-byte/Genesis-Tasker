package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.security.*
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicLong

@Composable internal fun PrivateDeviceAccessEntry(){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication;val storageScope=app.workspaceScope
    if(!NativePrivateProducts.isProtected(storageScope))return
    val account=remember(storageScope){NativePrivateProducts.currentAccount(storageScope)};val auth=remember(context){AuthController.get(context)}
    val language=LocalGenesisLanguage.current;val lifecycle=LocalLifecycleOwner.current.lifecycle;val coroutine=rememberCoroutineScope()
    fun copy(name:String)=context.assets.open(name).use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}
    val text=remember(language){copy("device-access-copy-v1.json")};val common=remember(language){copy("shared-security-copy-v1.json")}
    var scopes by remember{mutableStateOf<List<JSONObject>>(emptyList())};var selected by remember{mutableStateOf("")};var pending by remember{mutableStateOf<List<JSONObject>>(emptyList())}
    var view by remember{mutableStateOf<JSONObject?>(null)};var incoming by remember{mutableStateOf("")};var approval by remember{mutableStateOf("")}
    var preview by remember{mutableStateOf<JSONObject?>(null)};var compared by remember{mutableStateOf("")};var busy by remember{mutableStateOf(false)};var message by remember{mutableStateOf("")}
    val alive=remember{AtomicBoolean(true)};val epoch=remember{AtomicLong()};val foreground=remember{AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
    DisposableEffect(lifecycle,storageScope){val observer=LifecycleEventObserver{_,event->
        if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
        if(event==Lifecycle.Event.ON_PAUSE)foreground.set(false)
        if(event==Lifecycle.Event.ON_STOP){epoch.incrementAndGet();view=null;incoming="";approval="";preview=null;compared="";busy=false;message=""}
    };lifecycle.addObserver(observer);onDispose{alive.set(false);epoch.incrementAndGet();lifecycle.removeObserver(observer)}}
    fun run(work:suspend(()->Unit)->Unit){if(busy)return;val token=epoch.incrementAndGet();busy=true;message=""
        fun current(){account.requireOpen();check(alive.get()&&foreground.get()&&epoch.get()==token&&app.workspaceScope==storageScope&&NativePrivateProducts.currentAccount(storageScope)===account){"E2EE_ACCOUNT_CHANGED"}}
        coroutine.launch{try{current();work(::current);current()}catch(cancel:CancellationException){throw cancel}catch(reason:Exception){if(alive.get()&&epoch.get()==token)message=if(reason.message=="E2EE_CHALLENGE_EXPIRED")text.getString("expired")else common.getString("error")}
            finally{if(alive.get()&&epoch.get()==token)busy=false}}
    }
    fun parse(input:String):JSONObject{val bytes=input.toByteArray(Charsets.UTF_8);return try{check(bytes.size<=128*1024){"E2EE_DEVICE_ACCESS_INVALID"};E2eeFileManifestJson.read(bytes)}finally{bytes.fill(0)}}
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
        Text(text.getString("title"),style=MaterialTheme.typography.titleMedium);Text(text.getString("notice"))
        OutlinedButton(onClick={run{current->val rows=withContext(Dispatchers.IO){current();account.scopeSummaries().also{current()}};val saved=auth.pendingPrivateDeviceAccess();current()
            scopes=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.get("state")=="active"};pending=saved
        }},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(common.getString("load"))}
        if(scopes.isNotEmpty()){
            Text(text.getString("scope"));Column(Modifier.heightIn(max=200.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
                scopes.forEach{row->OutlinedButton(onClick={selected=row.getString("scopeId")},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText((if(selected==row.getString("scopeId"))"✓ "else "")+row.getString("resourceId"))}}
            }
            Button(onClick={run{current->val result=auth.createPrivateDeviceAccess(selected);current();view=result;approval="";val saved=auth.pendingPrivateDeviceAccess();current();pending=saved}},enabled=!busy&&selected.isNotEmpty(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("create"))}
        }
        if(pending.isNotEmpty())Column(Modifier.heightIn(max=200.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(8.dp)){
            pending.forEach{row->OutlinedButton(onClick={run{current->val result=auth.loadPrivateDeviceAccess(row.getString("id"));current();view=result;approval=""}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(text.getString(if(row.get("mode")=="grant")"approval"else "request")+": "+row.getString("scopeId"))}}
        }
        view?.getJSONObject("state")?.let{state->if(!state.isNull("request")){
            OutlinedTextField(state.getJSONObject("request").toString(),{},readOnly=true,minLines=3,maxLines=6,label={Text(text.getString("request"))},modifier=Modifier.fillMaxWidth())
            UntranslatedText(view?.optString("fingerprint").orEmpty())
            if(!state.isNull("approval"))OutlinedTextField(state.getJSONObject("approval").toString(),{},readOnly=true,minLines=3,maxLines=6,label={Text(text.getString("approval"))},modifier=Modifier.fillMaxWidth())
            if(state.get("mode")=="request"&&!state.getBoolean("complete")){
                OutlinedTextField(approval,{if(it.length<=128*1024)approval=it else message=common.getString("error")},enabled=!busy&&state.isNull("approval"),minLines=3,maxLines=6,label={Text(text.getString("approval"))},modifier=Modifier.fillMaxWidth())
                Button(onClick={run{current->val result=auth.submitPrivateDeviceAccess(state.getString("id"),approval);current();view=result;approval="";message=text.getString("saved");val saved=auth.pendingPrivateDeviceAccess();current();pending=saved}},enabled=!busy&&(!state.isNull("approval")||approval.isNotBlank()),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("submit"))}
            }
        }}
        OutlinedTextField(incoming,{if(it.length<=128*1024){incoming=it;preview=null;compared=""}else message=common.getString("error")},enabled=!busy,minLines=3,maxLines=6,label={Text(text.getString("incoming"))},modifier=Modifier.fillMaxWidth())
        OutlinedButton(onClick={run{current->val result=withContext(Dispatchers.IO){current();val request=E2eeDeviceAccessContract.verify(parse(incoming));val fingerprint=E2eeDeviceAccessContract.fingerprint(request);current();JSONObject().put("request",request).put("fingerprint",fingerprint)};current();preview=result;compared=""}},enabled=!busy&&incoming.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(common.getString("load"))}
        preview?.let{value->val request=value.getJSONObject("request");val challenge=request.getJSONObject("challenge")
            UntranslatedText(listOf(request.getJSONObject("target").getString("scopeId"),challenge.getString("userId"),challenge.getString("deviceId"),text.getJSONObject("roles").getString(challenge.getString("role"))).joinToString("\n"))
            UntranslatedText(value.getString("fingerprint"));OutlinedTextField(compared,{if(it.length<=64)compared=it.trim()},enabled=!busy,singleLine=true,label={Text(text.getString("compare"))},modifier=Modifier.fillMaxWidth())
            Button(onClick={run{current->val result=auth.approvePrivateDeviceAccess(request.toString(),compared);current();view=result;compared="";val saved=auth.pendingPrivateDeviceAccess();current();pending=saved}},enabled=!busy&&compared==value.getString("fingerprint"),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("approve"))}
        }
        if(message.isNotEmpty())Text(message,style=MaterialTheme.typography.bodyMedium)
    }
}
