package ru.genesis.calendar.ui

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.GenesisBackupContainer
import ru.genesis.calendar.security.*

/** Mounted above the vault gate: opening SAF is allowed to lock the vault.
 * Only ciphertext delivery and opaque URI selection survive that transition. */
@Composable internal fun PrivateBackupHandoffHost(owner:String?){
    val context=LocalContext.current.applicationContext
    remember(context){PrivateBackupHandoff.initialize(context)}
    val job by PrivateBackupHandoff.state.collectAsStateWithLifecycle()
    job?.let{saved->key(saved.id){
        val save=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->
            PrivateBackupHandoff.selected(context,saved.id,uri)
        }
        val open=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->
            PrivateBackupHandoff.selected(context,saved.id,uri)
        }
        LaunchedEffect(saved.id,saved.phase,owner){
            if(saved.phase=="pick"&&saved.ownerId==owner){
                val picking=PrivateBackupHandoff.beginPicker(context,saved.id)?:return@LaunchedEffect
                if(picking.kind=="export")save.launch("genesis-${saved.id}.genesisbackup")
                else open.launch(arrayOf("application/octet-stream","application/json","*/*"))
            }
            // This operation has no account/plaintext capability. Cancellation
            // leaves an immutable artifact and exact-prefix resumable receipt.
            if(saved.phase=="writing"&&saved.ownerId==owner)withContext(Dispatchers.IO){
                try{PrivateBackupHandoff.deliver(context,saved.id)}catch(cancel:CancellationException){throw cancel}catch(_:Exception){/* durable failed job is shown after unlock */}
            }
        }
    }}
}

@Composable internal fun PrivateBackupDialog(owner:String,title:String,onClose:()->Unit){
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication
    val storageScope=app.workspaceScope;val account=remember(owner,storageScope){NativePrivateProducts.account(storageScope,owner)}
    val archive=remember(account){E2eeContentArchive(account)};val language=LocalGenesisLanguage.current
    val text=remember(language){context.assets.open("content-archive-copy-v1.json").use{val all=JSONObject(it.readBytes().toString(Charsets.UTF_8));all.optJSONObject(language)?:all.getJSONObject("en")}}
    val backup=remember(language){if(language=="ru")null else context.assets.open("originals/i18n/backup-locales/$language.json").bufferedReader().use{JSONObject(it.readText())}}
    fun c(ru:String)=backup?.getString(ru)?:ru
    val coroutine=rememberCoroutineScope();var recovery by remember{mutableStateOf("")};var importKey by remember{mutableStateOf("")}
    var keySaved by remember{mutableStateOf(false)};var consent by remember{mutableStateOf(false)};var remote by remember{mutableStateOf(false)};var busy by remember{mutableStateOf(false)}
    var error by remember{mutableStateOf(false)};var content by remember{mutableStateOf<JSONObject?>(null)};var archives by remember{mutableStateOf<List<String>>(emptyList())}
    val job by PrivateBackupHandoff.state.collectAsStateWithLifecycle();val currentJob=job?.takeIf{it.ownerId==owner}
    val active=remember{java.util.concurrent.atomic.AtomicBoolean(true)}
    DisposableEffect(account){onDispose{active.set(false);recovery="";importKey="";content=null}}
    fun current(){account.requireOpen();check(active.get()&&app.workspaceScope==storageScope&&NativePrivateProducts.account(storageScope,owner)===account){"E2EE_ACCOUNT_CHANGED"}}
    fun <T> run(operation:()->T,complete:(T)->Unit={}){
        if(busy)return;busy=true;error=false;coroutine.launch{
            try{val result=withContext(Dispatchers.IO){current();operation().also{current()}};current();complete(result)}
            catch(cancel:CancellationException){throw cancel}catch(_:Exception){if(active.get())error=true}
            finally{if(active.get())busy=false}
        }
    }
    val unfinished=currentJob?.phase?.let{it !in setOf("complete","cancelled")}==true
    Dialog(onDismissRequest={if(!busy)onClose()},properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnClickOutside=false)){
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
                Button(onClick={val supplied=recovery;val fromServer=remote;run({val payload=if(fromServer)archive.captureRemote()else archive.capture();current();PrivateBackupHandoff.prepareExport(context,account,payload,supplied)},{recovery="";keySaved=false})},enabled=!busy&&!unfinished&&keySaved&&consent&&recovery.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(c(if(remote)"Снимок сервера"else"Снимок устройства"))}
                HorizontalDivider()
                Button(onClick={run({PrivateBackupHandoff.prepareImport(context,account)},{importKey="";content=null})},enabled=!busy&&!unfinished,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("import"))}
                currentJob?.let{pending->
                    if(pending.kind=="import"&&pending.phase=="ready"){
                        OutlinedTextField(value=importKey,onValueChange={importKey=it.take(64)},label={Text(c("Ключ копии"))},visualTransformation=PasswordVisualTransformation(),singleLine=true,enabled=!busy,modifier=Modifier.fillMaxWidth())
                        Button(onClick={val supplied=importKey;run({
                            val bytes=context.contentResolver.openInputStream(android.net.Uri.parse(pending.uri))?.use{PrivateBackupHandoff.readBounded(it,GenesisBackupContainer.MAX_FILE)}?:error("BACKUP_INVALID")
                            try{current();val decoded=GenesisBackupContainer.open(bytes.toString(Charsets.UTF_8),supplied);current();val retained=archive.retain(E2eeContentArchive.contentOnlyInput(decoded));current();PrivateBackupHandoff.imported(context,pending.id,account);retained}finally{bytes.fill(0)}
                        },{content=it;importKey=""})},enabled=!busy&&importKey.isNotBlank(),modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("import"))}
                    }
                    if(pending.phase in setOf("failed","picking"))OutlinedButton(onClick={run({PrivateBackupHandoff.retry(context,pending.id,account)})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("retry"))}
                    if(pending.phase !in setOf("complete","cancelled","writing"))TextButton(onClick={run({PrivateBackupHandoff.cancel(context,pending.id,account)},{importKey=""})},enabled=!busy,modifier=Modifier.fillMaxWidth().heightIn(min=48.dp)){Text(text.getString("cancel"))}
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
