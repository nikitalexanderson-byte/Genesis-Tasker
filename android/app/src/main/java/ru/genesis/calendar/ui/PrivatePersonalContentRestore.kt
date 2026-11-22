package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.lifecycle.compose.LocalLifecycleOwner
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.cancelChildren
import kotlinx.coroutines.launch
import org.json.JSONObject
import ru.genesis.calendar.security.E2eeNativePersonalContentRestore
import ru.genesis.calendar.security.E2eeNativeDomainContentRestore
import ru.genesis.calendar.security.E2eeProductAccount

private data class PersonalRestoreChoice(val section:Int,val entry:Int,val versionId:String,val label:String,val domain:Boolean=false)
@Composable internal fun PrivatePersonalContentRestorePanel(account:E2eeProductAccount,payload:JSONObject?,language:String,guard:()->Unit){
    val context=LocalContext.current;val lifecycle=LocalLifecycleOwner.current.lifecycle;val jobs=rememberCoroutineScope();val alive=remember(account){java.util.concurrent.atomic.AtomicBoolean(true)}
    val c=remember(language){context.assets.open("personal-content-restore-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val common=remember(language){context.assets.open("shared-security-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    fun current(){guard();account.requireOpen();check(alive.get()&&lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)){"E2EE_FOREGROUND_REQUIRED"}}
    val restore=remember(account){E2eeNativePersonalContentRestore(context,account,::current)}
    val domainRestore=remember(account){E2eeNativeDomainContentRestore(context,account,::current)}
    var view by remember(account){mutableStateOf<JSONObject?>(null)};var pending by remember(account){mutableStateOf<List<JSONObject>>(emptyList())};var ack by remember(account){mutableStateOf(false)};var busy by remember(account){mutableStateOf(false)};var failed by remember(account){mutableStateOf(false)}
    suspend fun execute(action:String,args:JSONObject=JSONObject(),domain:Boolean=view?.optString("format")=="genesis-domain-content-restore-v1")=if(domain)domainRestore.execute(action,args)else restore.execute(action,args)
    DisposableEffect(account,lifecycle){alive.set(true);val observer=LifecycleEventObserver{_,event->if(event==Lifecycle.Event.ON_STOP){jobs.coroutineContext.cancelChildren();view=null;pending=emptyList();ack=false}};lifecycle.addObserver(observer);onDispose{alive.set(false);lifecycle.removeObserver(observer)}}
    fun run(action:suspend()->Unit){if(busy)return;busy=true;failed=false;jobs.launch{try{current();action();current()}catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(alive.get())failed=true}finally{if(alive.get())busy=false}}}
    val choices=remember(payload){buildList{
        val sections=payload?.optJSONArray("sections")
        if(sections!=null)for(s in 0 until sections.length()){val section=sections.getJSONObject(s);if(section.getString("id") !in setOf("workspace","diary","mindmaps","physis"))continue;val entries=section.getJSONObject("data").getJSONArray("entries")
            for(e in 0 until entries.length()){val entry=entries.getJSONObject(e);val scope=entry.optJSONObject("scope");val domain=section.getString("id") in setOf("diary","mindmaps","physis")||entry.getString("objectId")=="personal-diary-device-live-v1";if(scope!=null&&scope.optString("kind")!="personal"||!domain&&entry.getString("domain")!="workspace"&&!entry.getString("objectId").startsWith("imported-legacy-content:"))continue
                val head=entry.getJSONObject("current");add(PersonalRestoreChoice(s,e,head.getString("id"),head.getString("filename").ifBlank{entry.getString("objectId")},domain));val history=entry.getJSONArray("history")
                for(v in 0 until history.length()){val version=history.getJSONObject(v);add(PersonalRestoreChoice(s,e,version.getString("id"),version.getString("filename").ifBlank{entry.getString("objectId")}+" · "+(v+1),domain))}
            }
        }
    }}
    Column(Modifier.fillMaxWidth(),verticalArrangement=Arrangement.spacedBy(10.dp)){
        UntranslatedText(c.getString("title"),style=MaterialTheme.typography.titleMedium);UntranslatedText(c.getString("notice"));UntranslatedText(c.getString("localDiary"))
        if(payload!=null&&choices.isNotEmpty())LazyColumn(Modifier.fillMaxWidth().heightIn(max=220.dp)){
            items(choices.size){at->val choice=choices[at];OutlinedButton({val captured=JSONObject(payload.toString());run{val result=execute("create",JSONObject().put("payload",captured).put("sectionIndex",choice.section).put("entryIndex",choice.entry).put("versionId",choice.versionId),choice.domain);current();view=result.getJSONObject("state");ack=false}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("prepare")+": "+choice.label)}}
        }
        OutlinedButton({run{val personal=restore.execute("pending").getJSONArray("items");val domains=domainRestore.execute("pending").getJSONArray("items");current();pending=(0 until personal.length()).map{personal.getJSONObject(it)}+(0 until domains.length()).map{domains.getJSONObject(it)}}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(common.getString("load"))}
        for(item in pending)OutlinedButton({run{view=execute("inspect",JSONObject().put("id",item.get("intentId")),item.getString("format")=="genesis-domain-content-restore-v1").getJSONObject("state");current();ack=false}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("resume")+" · "+item.getString("backupId"))}
        view?.let{state->val id=state.getString("intentId");val proposal=state.optJSONObject("proposal")
            if(proposal==null)OutlinedButton({run{view=execute("preview",JSONObject().put("id",id)).getJSONObject("state");current();ack=false}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("prepare"))}
            else{
                UntranslatedText(c.getString("added")+": "+proposal.getLong("added"));UntranslatedText(c.getString("skipped")+": "+proposal.getLong("skipped"))
                if(state.getBoolean("complete"))UntranslatedText(c.getString("done"))
                else if(state.getBoolean("started"))OutlinedButton({run{view=execute("apply",JSONObject().put("id",id)).getJSONObject("state");current()}},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("resume"))}
                else{
                    Row(Modifier.fillMaxWidth()){Checkbox(ack,{ack=it},enabled=!busy);UntranslatedText(c.getString("ack"),modifier=Modifier.weight(1f))}
                    Button({val fingerprint=proposal.getString("fingerprint");run{execute("confirm",JSONObject().put("id",id).put("fingerprint",fingerprint));current();view=execute("apply",JSONObject().put("id",id)).getJSONObject("state");current();ack=false}},enabled=!busy&&ack,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(c.getString("apply"))}
                }
            }
        }
        if(failed)UntranslatedText(common.getString("error"),color=MaterialTheme.colorScheme.error)
    }
}
