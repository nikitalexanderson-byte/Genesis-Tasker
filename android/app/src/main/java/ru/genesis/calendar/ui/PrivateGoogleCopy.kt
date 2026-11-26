package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.security.*

@Composable internal fun PrivateGoogleCopyEntry(source:JSONObject){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication;val storageScope=app.workspaceScope;if(!NativePrivateProducts.isProtected(storageScope))return
    val controller=remember(context){AuthController.get(context)};val state by controller.state.collectAsStateWithLifecycle();val owner=state.user?.uid?:return
    val account=remember(storageScope,owner){NativePrivateProducts.account(storageScope,owner)};val product=remember(account){E2eeGoogleCopyProduct(account)};val language=LocalGenesisLanguage.current
    val text=remember(language){context.assets.open("google-copy-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    var opened by remember{mutableStateOf(false)};var provider by remember{mutableStateOf("google-tasks")};var target by remember{mutableStateOf("")};var allDay by remember{mutableStateOf(false)}
    var job by remember{mutableStateOf<JSONObject?>(null)};var jobs by remember{mutableStateOf<List<JSONObject>>(emptyList())};var reviewed by remember{mutableStateOf("")};var busy by remember{mutableStateOf(false)};var message by remember{mutableStateOf("")};var failed by remember{mutableStateOf(false)};var visible by remember{mutableIntStateOf(20)}
    val alive=remember{java.util.concurrent.atomic.AtomicBoolean(true)};DisposableEffect(account){onDispose{alive.set(false);job=null;jobs=emptyList();reviewed=""}}
    val coroutine=rememberCoroutineScope();val accounts=state.accountSettings?.accounts.orEmpty().filter{it.provider=="google"};val original=remember(source.toString()){runCatching{E2eeGoogleCopyProduct.content(source)}.getOrNull()}
    val service=job?.getJSONObject("payload")?.getString("provider")?:provider;val destination=job?.getJSONObject("payload")?.getString("accountId")?:target
    val content=job?.getJSONObject("payload")?.getJSONObject("copy")?:original?.let{JSONObject(it.toString()).also{copy->if(service=="google-calendar"&&allDay)copy.put("startTime",JSONObject.NULL).put("endTime",JSONObject.NULL)}}
    val signature=JSONObject().put("provider",service).put("accountId",destination).put("copy",content?:JSONObject.NULL).toString();val available=accounts.any{it.id==destination&&if(service=="google-tasks")it.tasksConnected else it.calendarConnected}
    fun current(){account.requireOpen();check(alive.get()&&app.workspaceScope==storageScope&&NativePrivateProducts.account(storageScope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    fun run(load:Boolean){if(busy||!load&&(content==null||reviewed!=signature||!available))return;val selected=content?.let{JSONObject(it.toString())};val previous=job?.let{JSONObject(it.toString())};val selectedProvider=service;val selectedTarget=destination;busy=true;failed=false;message="";coroutine.launch{
        try{if(load){val retained=withContext(Dispatchers.IO){current();product.retained()};current();jobs=retained}
            else{val staged=previous?:withContext(Dispatchers.IO){current();product.prepare(selectedProvider,selectedTarget,checkNotNull(selected))};current();job=staged
                val result=withContext(Dispatchers.IO){current();product.send(staged,true){payload,consent->controller.privateGoogleCopy(owner,payload,consent)}};current();job=result;reviewed="";message=text.getString(if(result.getString("state")=="complete")"complete"else"uncertain")}}
        catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(alive.get())failed=true}finally{if(alive.get())busy=false}
    }}
    OutlinedButton(onClick={opened=!opened},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("title"))}
    if(opened)Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(12.dp)){
        listOf("google-tasks" to "Google Tasks","google-calendar" to "Google Calendar").forEach{(value,label)->Row{RadioButton(selected=service==value,onClick={provider=value;job=null;reviewed="";message=""},enabled=!busy);UntranslatedText(label)}}
        accounts.forEach{linked->OutlinedButton(onClick={target=linked.id;job=null;reviewed="";message=""},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText((if(destination==linked.id)"✓ "else"")+linked.email)}}
        if(service=="google-calendar"&&job==null)Row{Checkbox(checked=allDay,onCheckedChange={allDay=it;reviewed=""},enabled=!busy);Text("Весь день")}
        content?.let{copy->Column(Modifier.heightIn(max=260.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(4.dp)){
            UntranslatedText(copy.getString("title"));UntranslatedText(copy.getString("description"));for((key,label)in listOf("startDate" to "Начало","dueDate" to "Дата","startTime" to "Время","endTime" to "Окончание","timeZone" to "Часовой пояс","completedAt" to "Выполнено"))if(!copy.isNull(key)){Text(label);UntranslatedText(copy.getString(key))}
        }}
        Text(ExternalCopyConsent.copy(context,language,"notice").replace("{provider}",if(service=="google-tasks")"Google Tasks"else"Google Calendar"))
        Row{Checkbox(checked=reviewed==signature,onCheckedChange={reviewed=if(it)signature else""},enabled=!busy);Text(ExternalCopyConsent.copy(context,language,"accept"))}
        val datesValid=service!="google-calendar"||content?.let{!it.isNull("dueDate")&&it.isNull("startTime")==it.isNull("endTime")}==true
        Button(onClick={run(false)},enabled=!busy&&content!=null&&datesValid&&available&&reviewed==signature&&job?.optString("state")!="complete",modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("send"))}
        OutlinedButton(onClick={run(true)},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("pending"))}
        jobs.take(visible).forEach{saved->OutlinedButton(onClick={job=JSONObject(saved.toString());reviewed="";message="";failed=false},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(saved.getJSONObject("payload").getJSONObject("copy").getString("title"))}}
        if(jobs.size>visible)TextButton(onClick={visible+=20},enabled=!busy,modifier=Modifier.heightIn(min=48.dp)){Text("Показать ещё")}
        if(busy)LinearProgressIndicator(Modifier.fillMaxWidth());if(message.isNotBlank())Text(message);if(failed)Text(text.getString("error"),color=MaterialTheme.colorScheme.error)
    }
}
