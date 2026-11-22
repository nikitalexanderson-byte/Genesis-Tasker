package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import androidx.compose.ui.window.DialogProperties
import androidx.compose.ui.window.SecureFlagPolicy
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.GenesisBackupContainer
import ru.genesis.calendar.security.*

/** Mounted above the vault gate: opening SAF is allowed to lock the vault.
 * Only ciphertext delivery and opaque URI selection survive that transition. */
@Composable internal fun PrivateBackupHandoffHost(owner:String?){
    PrivateBackupFileActivity(owner)
}

@Composable internal fun PrivateBackupDialog(owner:String,title:String,onClose:()->Unit){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication
    val lifecycle=LocalLifecycleOwner.current.lifecycle
    val storageScope=app.workspaceScope;val account=remember(owner,storageScope){NativePrivateProducts.account(storageScope,owner)}
    val archive=remember(account){E2eeContentArchive(account)};val language=LocalGenesisLanguage.current
    val text=remember(language){context.assets.open("content-archive-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val backup=remember(language){if(language=="ru")null else context.assets.open("originals/i18n/backup-locales/$language.json").bufferedReader().use{JSONObject(it.readText())}}
    fun c(ru:String)=backup?.getString(ru)?:ru
    val coroutine=rememberCoroutineScope();var recovery by remember{mutableStateOf("")};var importKey by remember{mutableStateOf("")}
    var keySaved by remember{mutableStateOf(false)};var consent by remember{mutableStateOf(false)};var remote by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf(false)};var content by remember{mutableStateOf<JSONObject?>(null)};var archives by remember{mutableStateOf<List<String>>(emptyList())}
    val job by PrivateBackupHandoff.state.collectAsStateWithLifecycle();val currentJob=job?.takeIf{it.ownerId==owner}
    val active=remember(account,lifecycle){java.util.concurrent.atomic.AtomicBoolean(true)}
    val foreground=remember(account,lifecycle){java.util.concurrent.atomic.AtomicBoolean(lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED))}
    val fileAccess=remember(account){java.util.concurrent.atomic.AtomicReference<NativeBackupFileAccess?>(null)}
    val operationJob=remember(account){java.util.concurrent.atomic.AtomicReference<Job?>(null)}
    DisposableEffect(account,lifecycle){
        val observer=LifecycleEventObserver{_,event->
            if(event==Lifecycle.Event.ON_RESUME)foreground.set(true)
            if(event==Lifecycle.Event.ON_PAUSE){foreground.set(false);fileAccess.getAndSet(null)?.close();operationJob.get()?.cancel();recovery="";importKey="";content=null}
        };lifecycle.addObserver(observer)
        onDispose{active.set(false);lifecycle.removeObserver(observer);fileAccess.getAndSet(null)?.close();operationJob.get()?.cancel();recovery="";importKey="";content=null}
    }
    fun current(){account.requireOpen();check(active.get()&&foreground.get()&&app.workspaceScope==storageScope&&NativePrivateProducts.account(storageScope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    fun <T> run(operation:()->T,complete:(T)->Unit={}){
        if(busy||operationJob.get()!=null)return;busy=true;error=false;coroutine.launch{
            val job=currentCoroutineContext()[Job]
            try{check(job!=null&&operationJob.compareAndSet(null,job)){"BACKUP_HANDOFF_BUSY"};val result=withContext(Dispatchers.IO){current();operation().also{current()}};current();complete(result)}
            catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(active.get())error=true}
            finally{operationJob.compareAndSet(job,null);if(active.get())busy=false}
        }
    }
    val unfinished=currentJob?.phase?.let{it !in setOf("complete","cancelled")}==true
    Dialog(onDismissRequest={if(!busy)onClose()},properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnClickOutside=false,securePolicy=SecureFlagPolicy.SecureOn)){
        Surface(Modifier.fillMaxWidth().fillMaxHeight(.94f).safeDrawingPadding().imePadding()){
            Column(Modifier.padding(16.dp).verticalScroll(rememberScrollState()),verticalArrangement=Arrangement.spacedBy(12.dp)){
                EditorDialogHeader(title,"private-backup-close"){if(!busy)onClose()}
                Text(text.getString("title"),style=MaterialTheme.typography.titleMedium)
                Text(text.getString("notice"))
                Row{Checkbox(checked=remote,onCheckedChange={remote=it},enabled=!busy&&!unfinished&&!account.offline);Text(c("Снимок сервера"))}
                if(remote)Text(text.getString("remoteNotice"))
                OutlinedTextField(value=recovery,onValueChange={recovery=it.take(64);keySaved=false},enabled=!busy&&!unfinished,label={Text(c("Ключ копии"))},modifier=Modifier.fillMaxWidth())
                OutlinedButton(onClick={recovery=GenesisBackupContainer.newRecoveryKey();keySaved=false},enabled=!busy&&!unfinished,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(c("Создать ключ"))}
                Text(c("Храните ключ отдельно от файла и Google"))
                Row{Checkbox(checked=keySaved,onCheckedChange={keySaved=it},enabled=!busy&&!unfinished);Text(c("Я сохранил ключ отдельно. Он расшифровывает данные и не восстанавливает вход."))}
                Row{Checkbox(checked=consent,onCheckedChange={consent=it},enabled=!busy&&!unfinished);Text(c("Я ознакомился с составом копии, шифрованием и условиями восстановления в")+" "+c("политике")+" "+c("и")+" "+c("соглашении"))}
                val uriHandler=androidx.compose.ui.platform.LocalUriHandler.current
                Row(horizontalArrangement=Arrangement.spacedBy(8.dp)){
                    TextButton(onClick={uriHandler.openUri("https://genesiscalendar.com/privacy")},modifier=Modifier.heightIn(min=48.dp)){Text(c("политике"))}
                    TextButton(onClick={uriHandler.openUri("https://genesiscalendar.com/terms")},modifier=Modifier.heightIn(min=48.dp)){Text(c("соглашении"))}
                }
                Button(onClick={val supplied=recovery;val fromServer=remote;recovery="";keySaved=false;run({val payload=if(fromServer)archive.captureRemote()else archive.capture();current();PrivateBackupHandoff.prepareExport(context,account,payload,supplied,::current)})},enabled=!busy&&!unfinished&&keySaved&&consent&&recovery.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(c(if(remote)"Снимок сервера"else"Снимок устройства"))}
                HorizontalDivider()
                Button(onClick={run({PrivateBackupHandoff.prepareImport(context,account)},{importKey="";content=null})},enabled=!busy&&!unfinished,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("import"))}
                currentJob?.let{pending->
                    if(pending.kind=="import"&&pending.phase=="ready"){
                        OutlinedTextField(value=importKey,onValueChange={importKey=it.take(64)},label={Text(c("Ключ копии"))},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth())
                        Button(onClick={val supplied=importKey;importKey="";run({
                            current();PrivateBackupHandoff.requireImport(pending,account)
                            val access=NativeBackupFileAccess(pending){current();PrivateBackupHandoff.requireImport(pending,account)}
                            check(fileAccess.compareAndSet(null,access)){access.close();"BACKUP_HANDOFF_BUSY"}
                            try{
                                val retained=access.read(context,GenesisBackupContainer.MAX_FILE){bytes,size->
                                    current();val decoded=GenesisBackupContainer.open(String(bytes,0,size,Charsets.UTF_8),supplied);access.current()
                                    archive.retain(E2eeContentArchive.contentOnlyInput(decoded)).also{access.current()}
                                };access.current();PrivateBackupHandoff.imported(context,pending,account);retained
                            }finally{fileAccess.compareAndSet(access,null);access.close()}
                        },{content=it;importKey=""})},enabled=!busy&&importKey.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("import"))}
                    }
                    if(pending.phase in setOf("failed","picking","ready")&&pending.scopeId==account.directory.scopeId&&pending.generation==account.directory.generation&&(pending.kind!="export"||pending.sha256!=null))OutlinedButton(onClick={run({PrivateBackupHandoff.retry(context,pending,account)})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("retry"))}
                    if(pending.phase !in setOf("complete","cancelled","sealing","writing"))TextButton(onClick={run({PrivateBackupHandoff.cancel(context,pending,account)},{importKey=""})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("cancel"))}
                    if(pending.phase=="complete")Text(text.getString("saved"))
                    if(pending.phase=="failed")Text(text.getString("error"),color=MaterialTheme.colorScheme.error)
                }
                OutlinedButton(onClick={run({archive.retained()},{archives=it})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("history"))}
                archives.forEach{id->OutlinedButton(onClick={run({archive.openRetained(id)},{content=it})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){UntranslatedText(id)}}
                content?.let{retained->Text(text.getString("history"));val sections=retained.getJSONArray("sections")
                    repeat(sections.length()){index->val section=sections.getJSONObject(index);UntranslatedText("${section.getString("id")}: ${section.getJSONObject("data").getJSONArray("entries").length()}")}
                }
                if(busy)LinearProgressIndicator(Modifier.fillMaxWidth())
                if(error)Text(text.getString("error"),color=MaterialTheme.colorScheme.error)
            }
        }
    }
}
