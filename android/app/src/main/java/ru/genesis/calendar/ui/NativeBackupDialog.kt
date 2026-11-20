package ru.genesis.calendar.ui

import android.annotation.SuppressLint
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.annotation.Keep
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.*
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.data.BackupGateway
import ru.genesis.calendar.data.BackupNativeStore
import ru.genesis.calendar.data.GenesisBackupContainer
import ru.genesis.calendar.data.BackupImportFile
import ru.genesis.calendar.data.NativeLegacyOperationPermit
import ru.genesis.calendar.data.LegacyScopeLocks
import java.io.ByteArrayInputStream
import java.util.Base64

internal object BackupWebOrigin {
    const val ENTRY="https://appassets.androidplatform.net/aurora/backup.html"
    fun assetPath(url:String):String?=if(url==ENTRY)"aurora/backup.html" else AuroraWebOrigin.assetPath(url)?.takeUnless { it.endsWith("index.html") }
    fun legalUrl(url: String): String? {
        val uri=Uri.parse(url)
        return if(uri.scheme=="https"&&uri.host in setOf("appassets.androidplatform.net","genesiscalendar.com")&&
            uri.path in setOf("/privacy","/terms")&&uri.query==null&&uri.fragment==null)
            "https://genesiscalendar.com${uri.path}" else null
    }
}

/** Bounded, ordered chunks are also used for document payloads, not only the SAF file. */
@Keep
internal class BackupJavascriptBridge(private val store:BackupNativeStore,private val gateway:BackupGateway,
    private val app:GenesisApplication,private val owner:String,private val scope:CoroutineScope,
    private val deliver:(String,JSONObject)->Unit,private val choose:suspend(Boolean,String)->Uri?,private val restart:()->Unit,
    private val beforeUiDispatch:suspend (String)->Unit={},private val beforeFileRetention:()->Unit={},private val beforeFormRetention:()->Unit={}) {
    @Volatile private var active=true
    private val operationMonitor=Any()
    private val operations=java.util.concurrent.ConcurrentHashMap<String,NativeLegacyOperationPermit>()
    private val startedOperations=mutableSetOf<String>()
    private val endedOperations=mutableSetOf<String>()
    private val uuid=Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}")
    private val history=app.getSharedPreferences("genesis.backup.history.v1",android.content.Context.MODE_PRIVATE)
    private val importMonitor=Any()
    private val importSelectionMutex=Mutex()
    private var importFile:BackupImportFile?=null
    private var importOperation=""
    private var exportText:StringBuilder?=null
    private var exportLength=0
    private var exportId=""
    @Volatile private var reconciled=false
    private val transfers=ru.genesis.calendar.data.BackupTransfer()
    private val account=ru.genesis.calendar.auth.CloudAccountSnapshot.scopeFor(owner)
    private val migrationView=app.backupMigrationMemory.open(owner,app.workspaceEpoch)
    private fun check(){check(active) { "BACKUP_VIEW_CLOSED" };store.checkOperationOwner();gateway.check();NativeLegacyOperationPermit.current()?.check()}
    private fun operation(id:String)=operations[id]?:throw AuthApiError("E2EE_INVALID_LEGACY_OPERATION")
    private fun errorResponse(error:Exception)=JSONObject().put("error",(error as? AuthApiError)?.code?:error.message?.takeIf { it.matches(Regex("(?:BACKUP|E2EE)_[A-Z_]+")) }?:"BACKUP_NATIVE_FAILED")
    private fun endOperation(id:String)=synchronized(operationMonitor){
        // Cleanup never throws from a coroutine completion handler. Once the
        // bounded unknown-ID history is full, fresh begins are refused too.
        if(id !in endedOperations&&id !in startedOperations&&endedOperations.size>=8192)return@synchronized null
        endedOperations.add(id)
        val permit=operations.remove(id)
        synchronized(importMonitor){if(importOperation==id){importFile?.clear();importFile=null;importOperation=""}}
        permit
    }
    @JavascriptInterface fun currentSession(operationId:String):Boolean=try{
        if(reconciled&&operationId.isNotEmpty()){
            check(active){"BACKUP_VIEW_CLOSED"};store.checkOperationOwner();operation(operationId).check()
        }else{check();if(operationId.isNotEmpty())operation(operationId).check()}
        true
    }catch(_:Exception){false}
    @JavascriptInterface fun getHistory():String? { check();return history.getString(owner,null) }
    /** Only the admitted verified reset can retain its final form after retiring
     * its own HTTP generation. It grants no further HTTP/crypto/file operation. */
    private fun <T> formWrite(operationId:String,action:(()->Unit)->T):T {
        fun current(){
            if(reconciled&&operationId.isNotEmpty()){
                check(active){"BACKUP_VIEW_CLOSED"};store.checkOperationOwner();operation(operationId).check()
            }else check()
        }
        current();check(operationId.isEmpty()||operations.containsKey(operationId)||synchronized(operationMonitor){operationId in endedOperations}){"E2EE_INVALID_LEGACY_OPERATION"}
        return LegacyScopeLocks.memoryWrite(app.database,account,::current){beforeFormRetention();current();action(::current)}
    }
    // The owner memory gate/inventory serialize publication. Do not hold the
    // window monitor: stop must invalidate the actor before waiting for IO.
    @JavascriptInterface fun retainFormChunk(id:String,index:Int,last:Boolean,text:String,operationId:String):String=try {
        formWrite(operationId){current->
            app.backupMigrationMemory.appendForm(migrationView,id,index,last,text,current)
        };""
    }catch(error:Exception){error.message?.takeIf{it.matches(Regex("(?:BACKUP|E2EE)_[A-Z_]+"))}?:"BACKUP_NATIVE_FAILED"}
    @JavascriptInterface fun retainValueChunk(name:String,id:String,index:Int,last:Boolean,text:String,operationId:String):String=try {
        formWrite(operationId){current->app.backupMigrationMemory.appendValue(migrationView,name,id,index,last,text,current)};""
    }catch(error:Exception){error.message?.takeIf{it.matches(Regex("(?:BACKUP|E2EE)_[A-Z_]+"))}?:"BACKUP_NATIVE_FAILED"}
    @JavascriptInterface fun retainValueManifest(raw:String,operationId:String):String=try {
        formWrite(operationId){current->app.backupMigrationMemory.publishManifest(migrationView,raw,current)};""
    }catch(error:Exception){error.message?.takeIf{it.matches(Regex("(?:BACKUP|E2EE)_[A-Z_]+"))}?:"BACKUP_NATIVE_FAILED"}
    @JavascriptInterface fun setHistory(value:String,operationId:String) {
        check();store.writeHistory(operation(operationId)){
        require(value.length<=500);val parsed=JSONObject(value)
        require(parsed.keys().asSequence().all { it in setOf("attempt","success") })
        for(key in parsed.keys())java.time.Instant.parse(parsed.getString(key))
        check(history.edit().putString(owner,parsed.toString()).commit())
        }
    }
    @JavascriptInterface fun postChunk(id:String,index:Int,last:Boolean,text:String) {
        check();transfers.append(id,index,last,text)?.let(::postMessage)
    }
    @JavascriptInterface fun postMessage(raw:String) {
        if(raw.length>32*1024*1024)return
        val request=runCatching { JSONObject(raw) }.getOrNull()?:return
        val id=request.optString("id");if(!id.matches(Regex("[a-f0-9-]{36}")))return
        val beginToken=if(request.optString("method")=="operationBegin")request.optJSONObject("payload")?.optString("operationId")?.takeIf{uuid.matches(it)}else null
        val job=scope.launch(Dispatchers.IO) {
            val response=try {
                val method=request.getString("method");val payload=request.optJSONObject("payload")?:JSONObject()
                if(method=="operationEnd"){
                    val token=payload.getString("operationId");require(uuid.matches(token));endOperation(token)?.finish()
                    withContext(Dispatchers.Main){if(active)deliver(id,JSONObject().put("value",true))};return@launch
                }
                if(method=="restart"){
                    check(reconciled&&operations.isEmpty()&&payload.optString("operationId").isEmpty()){"BACKUP_RECONCILE_REQUIRED"}
                    check(active);store.checkOperationOwner()
                }else check()
                suspend fun execute():Any=when(method) {
                    "operationBegin"->{
                        val token=payload.getString("operationId");require(uuid.matches(token))
                        synchronized(operationMonitor){
                            check(active&&token !in endedOperations&&token !in startedOperations){"E2EE_INVALID_LEGACY_OPERATION"}
                            check(startedOperations.size<8192&&endedOperations.size<8192){"BACKUP_OPERATION_LIMIT"};startedOperations.add(token)
                        }
                        val permit=store.beginLegacyOperation{check(active){"BACKUP_VIEW_CLOSED"}}
                        try{
                            check();synchronized(operationMonitor){check(active&&token !in endedOperations){"E2EE_INVALID_LEGACY_OPERATION"};operations[token]=permit}
                            JSONObject().put("operationId",token)
                        }catch(error:Throwable){permit.close();operations.entries.removeAll{it.value===permit};throw error}
                    }
                    "request"->store.request(payload.getString("method"),payload.getString("path"),payload.optJSONObject("body"))
                    "capture"->store.capture()
                    "retain"->store.retain(payload.getJSONObject("snapshot"))
                    "materialize"->store.materialize(payload.getJSONObject("snapshot"))
                    "open"->store.open(payload.getJSONObject("value"),payload.getString("scope"))
                    "seal"->store.seal(payload.get("value"),payload.getString("scope"))
                    "current"->store.current()
                    "reconcile"->store.reconcile().also { reconciled=true }
                    "restart"->{reconciled=false;withContext(Dispatchers.Main){check(active);store.checkOperationOwner();restart()};JSONObject()}
                    "exportBegin"->{
                        val length=payload.getInt("length");require(length in 1..GenesisBackupContainer.MAX_FILE)
                        val backupId=payload.getString("id");require(backupId.matches(Regex("[a-f0-9-]{36}")))
                        exportLength=length;exportId=backupId;exportText=StringBuilder();true
                    }
                    "exportChunk"->{
                        val text=payload.getString("text");val buffer=requireNotNull(exportText)
                        require(text.length<=131072&&payload.getInt("offset")==buffer.length&&buffer.length+text.length<=exportLength)
                        buffer.append(text);true
                    }
                    "exportSave"->{
                        val text=requireNotNull(exportText).toString();require(text.length==exportLength)
                        val uri=try { choose(true,"genesis-$exportId.genesisbackup")?:error("BACKUP_CANCELLED") }finally{exportText=null}
                        check()
                        // SAF may remain open while access expires. Recheck natively
                        // immediately before writing rather than trusting the offline view.
                        store.request("POST","/backup/v1/authorize",JSONObject().put("noticeVersion","backup-3.2.2-v1"));check()
                        val bytes=text.toByteArray(Charsets.UTF_8);require(bytes.size<=GenesisBackupContainer.MAX_FILE)
                        try { requireNotNull(app.contentResolver.openOutputStream(uri,"wt")).use { it.write(bytes);it.flush() };check();true }
                        finally { bytes.fill(0) }
                    }
                    "importChoose"->importSelectionMutex.withLock{
                        check();operation(payload.getString("operationId")).check()
                        val uri=choose(false,"")?:error("BACKUP_CANCELLED");check()
                        val resolver=app.contentResolver;var name:String?=null;var modified:Long?=null;var declared:Long?=null
                        resolver.query(uri,null,null,null,null)?.use { cursor->if(cursor.moveToFirst()){
                            fun string(column:String)=cursor.getColumnIndex(column).takeIf{it>=0&&!cursor.isNull(it)}?.let{cursor.getString(it)}
                            fun number(column:String)=cursor.getColumnIndex(column).takeIf{it>=0&&!cursor.isNull(it)}?.let{cursor.getLong(it)}
                            name=string(android.provider.OpenableColumns.DISPLAY_NAME);declared=number(android.provider.OpenableColumns.SIZE)
                            modified=number(android.provider.DocumentsContract.Document.COLUMN_LAST_MODIFIED)
                        }}
                        val type=resolver.getType(uri);check()
                        val file=requireNotNull(resolver.openInputStream(uri)).use { input->BackupImportFile.read(input,name,type,modified,declared,::check) }
                        try{
                            check();operation(payload.getString("operationId")).check()
                            val retained=file.migrationCopy()
                            try{
                                beforeFileRetention()
                                app.backupMigrationMemory.retainFile(migrationView,retained){check();operation(payload.getString("operationId")).check()}
                            }catch(error:Throwable){retained.clear();throw error}
                            // Only the small transfer adoption uses the window
                            // monitor. Disposal/end can invalidate promptly while
                            // the whole-job permit still drains encrypted IO.
                            synchronized(importMonitor){
                                check();operation(payload.getString("operationId")).check()
                                importFile?.clear();importFile=file;importOperation=payload.getString("operationId");file.descriptor()
                            }
                        }catch(error:Throwable){file.clear();throw error}
                    }
                    "importChunk"->synchronized(importMonitor){
                        check(importOperation==payload.getString("operationId")){"BACKUP_TRANSFER"}
                        requireNotNull(importFile).chunk(payload.getString("id"),payload.getInt("offset"))
                    }
                    "importClear"->synchronized(importMonitor){
                        check(importOperation==payload.getString("operationId")&&importFile?.id==payload.getString("id")){"BACKUP_TRANSFER"}
                        importFile?.clear();importFile=null;importOperation="";true
                    }
                    else->error("BACKUP_METHOD_INVALID")
                }
                val token=payload.optString("operationId")
                val bootstrap=method=="request"&&payload.optString("method")=="GET"&&payload.optString("path")=="/backup/v1/status"&&token.isEmpty()
                val value=if(method=="operationBegin"||bootstrap||method=="restart"&&reconciled&&token.isEmpty())execute()
                    else operation(token).borrow{execute()}
                // Reconciliation deliberately retires this gateway before returning its receipt.
                if(method !in setOf("operationBegin","reconcile","restart"))check()
                JSONObject().put("value",value)
            } catch(cancelled:CancellationException){beginToken?.let{endOperation(it)?.close()};return@launch}
            catch(error:Exception){errorResponse(error)}
            beforeUiDispatch(request.optString("method"))
            withContext(Dispatchers.Main){if(active){
                // The owner may change while a completed IO response waits for
                // the UI queue. Never publish that old private result into the
                // still-mounted view. Only our own verified reset may retire
                // the gateway while retaining the SAME account activation.
                val outgoing=try{
                    if(request.optString("method") in setOf("reconcile","restart"))store.checkOperationOwner()else check()
                    response
                }catch(error:Exception){
                    beginToken?.let{endOperation(it)?.close()};errorResponse(error)
                }
                deliver(id,outgoing)
            }}
        }
        job.invokeOnCompletion{failure->if(failure!=null)beginToken?.let{endOperation(it)?.close()}}
    }
    @Synchronized fun stop(){
        val permits=synchronized(operationMonitor){active=false;operations.values.toList().also{operations.clear()}}
        permits.forEach{it.close()};transfers.clear();app.backupMigrationMemory.detach(migrationView)
        synchronized(importMonitor){importFile?.clear();importFile=null;importOperation=""};exportText=null
    }
}

@Composable internal fun NativeBackupEntry() {
    val context=LocalContext.current;val controller=remember(context){AuthController.get(context)}
    val state by controller.state.collectAsStateWithLifecycle();var opened by remember { mutableStateOf(false) }
    val language=LocalGenesisLanguage.current
    val title=remember(language){if(language=="ru")"Резервные копии и восстановление" else context.assets.open("originals/i18n/backup-locales/$language.json").bufferedReader().use { JSONObject(it.readText()).getString("Резервные копии и восстановление") }}
    if(state.user!=null)OutlinedButton(onClick={opened=true},modifier=Modifier.fillMaxWidth().heightIn(min=48.dp).testTag("open-native-backup")){UntranslatedText(title)}
    if(opened&&state.user!=null)NativeBackupDialog(state.user!!.uid,title,onClose={opened=false})
}

@SuppressLint("SetJavaScriptEnabled")
@Composable internal fun NativeBackupDialog(owner:String,title:String,onClose:()->Unit,testGateway:BackupGateway?=null,
    testChoose:(suspend(Boolean,String)->Uri?)?=null) {
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication
    val gateway=remember(owner,testGateway){testGateway?:AuthController.get(context).backupGateway(owner)}
    val store=remember(owner,gateway){BackupNativeStore(app,owner,app.workspaceScope,gateway)}
    val scope=rememberCoroutineScope();val scheme=MaterialTheme.colorScheme
    val language=LocalGenesisLanguage.current;val dark=LocalEveningTheme.current;val palette=LocalDarkPalette.current
    val runtimeProblem=rememberNativeWebRuntimeProblem(language)
    val textScale=LocalDensity.current.fontScale
    var chooser by remember { mutableStateOf<CompletableDeferred<Uri?>?>(null) }
    val openFile=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->chooser?.complete(uri);chooser=null}
    val saveFile=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->chooser?.complete(uri);chooser=null}
    suspend fun choose(save:Boolean,name:String):Uri? {
        if(testChoose!=null){check(ru.genesis.calendar.BuildConfig.DEBUG);return testChoose(save,name)}
        val result=CompletableDeferred<Uri?>()
        withContext(Dispatchers.Main){check(chooser==null);chooser=result;if(save)saveFile.launch(name)else openFile.launch(arrayOf("application/octet-stream","application/json","*/*"))}
        return result.await()
    }
    fun hex(color:Color)="#%06x".format(color.toArgb() and 0xffffff)
    val colors=JSONObject().put("--ink",hex(scheme.onSurface)).put("--ink-soft",hex(scheme.onSurfaceVariant)).put("--surface",hex(scheme.surface))
        .put("--paper",hex(scheme.background)).put("--line",hex(scheme.outlineVariant)).put("--ui-accent",hex(scheme.primary)).put("--teal",hex(scheme.primary)).put("--ui-on-accent",hex(scheme.onPrimary))
    val boot=remember(owner){JSONObject().put("ownerId",owner).put("language",language).put("dark",dark).put("palette",palette).put("colors",colors)}
    fun encoded(value:String):String {
        val bytes=ru.genesis.calendar.data.backupJsonUtf8(value)
        return try{Base64.getEncoder().encodeToString(bytes)}finally{bytes.fill(0)}
    }
    var ready by remember { mutableStateOf(false) }
    DisposableEffect(Unit){onDispose { chooser?.cancel();chooser=null }}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnClickOutside=false,decorFitsSystemWindows=false)) {
        Surface(Modifier.fillMaxSize().safeDrawingPadding().imePadding(),color=scheme.surface) {
            Column(Modifier.fillMaxSize().testTag("backup-native-dialog")) {
                Box(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp)){EditorDialogHeader(title,"backup-native-close",onClose)}
                if(runtimeProblem!=null)UntranslatedText(runtimeProblem,Modifier.padding(16.dp).testTag("backup-native-runtime-required"),color=scheme.error)
                if(runtimeProblem==null)AndroidView(factory={ctx->WebView(ctx).apply {
                    setBackgroundColor(scheme.surface.toArgb());settings.javaScriptEnabled=true
                    settings.allowFileAccess=false;settings.allowContentAccess=false;settings.domStorageEnabled=false;settings.databaseEnabled=false
                    settings.javaScriptCanOpenWindowsAutomatically=false;settings.setSupportMultipleWindows(false)
                    settings.mixedContentMode=android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW;settings.cacheMode=android.webkit.WebSettings.LOAD_NO_CACHE
                    settings.textZoom=(textScale*100).toInt().coerceIn(80,250)
                    val bridge=BackupJavascriptBridge(store,gateway,app,owner,scope,{id,response->
                        if(url==BackupWebOrigin.ENTRY){val payload=encoded(response.toString());val chunks=payload.chunked(131072)
                            chunks.forEachIndexed { index,chunk->evaluateJavascript("window.GenesisBackupRuntime.resolveChunk('$id','$chunk',$index,${index==chunks.lastIndex})",null) }
                        }
                    },::choose,{app.activateAccount(null);(context as? Activity)?.recreate()})
                    tag=bridge;addJavascriptInterface(bridge,"GenesisBackupBridge")
                    webViewClient=object:WebViewClient(){
                        override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest): Boolean {
                            if(request.isForMainFrame)BackupWebOrigin.legalUrl(request.url.toString())?.let { link ->
                                runCatching { ctx.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(link))) }
                            }
                            return true
                        }
                        override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse {
                            val path=BackupWebOrigin.assetPath(request.url.toString());val stream=path?.let { runCatching { ctx.assets.open(it) }.getOrNull() }
                            val mime=when(path?.substringAfterLast('.')){"html"->"text/html";"js"->"text/javascript";"css"->"text/css";"woff2"->"font/woff2";else->"application/octet-stream"}
                            return WebResourceResponse(mime,"UTF-8",if(stream!=null)200 else 404,if(stream!=null)"OK" else "Not Found",mapOf("Cache-Control" to "no-store","X-Content-Type-Options" to "nosniff"),stream?:ByteArrayInputStream(byteArrayOf()))
                        }
                        override fun onPageFinished(view:WebView,url:String){if(url==BackupWebOrigin.ENTRY)view.evaluateJavascript("(function(){if(!window.GenesisBackupRuntime)return false;window.GenesisBackupRuntime.init('${encoded(boot.toString())}');return true})()"){ready=it=="true"}}
                    }
                    loadUrl(BackupWebOrigin.ENTRY)
                }},modifier=Modifier.weight(1f).fillMaxWidth(),onRelease={view->(view.tag as? BackupJavascriptBridge)?.stop();view.removeJavascriptInterface("GenesisBackupBridge");view.stopLoading();view.destroy()})
                if(!ready&&runtimeProblem==null)LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
    }
}
