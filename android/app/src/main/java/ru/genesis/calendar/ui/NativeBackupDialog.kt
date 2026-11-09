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
import org.json.JSONObject
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.data.BackupGateway
import ru.genesis.calendar.data.BackupNativeStore
import ru.genesis.calendar.data.GenesisBackupContainer
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
private class BackupJavascriptBridge(private val store:BackupNativeStore,private val gateway:BackupGateway,
    private val app:GenesisApplication,private val owner:String,private val scope:CoroutineScope,
    private val deliver:(String,JSONObject)->Unit,private val choose:suspend(Boolean,String)->Uri?,private val restart:()->Unit) {
    @Volatile private var active=true
    private val history=app.getSharedPreferences("genesis.backup.history.v1",android.content.Context.MODE_PRIVATE)
    private var importText:String?=null
    private var exportText:StringBuilder?=null
    private var exportLength=0
    private var exportId=""
    private var reconciled=false
    private val transfers=ru.genesis.calendar.data.BackupTransfer()
    private fun check(){check(active) { "BACKUP_VIEW_CLOSED" };gateway.check()}
    @JavascriptInterface fun getHistory():String? { check();return history.getString(owner,null) }
    @JavascriptInterface fun setHistory(value:String) {
        check();require(value.length<=500);val parsed=JSONObject(value)
        require(parsed.keys().asSequence().all { it in setOf("attempt","success") })
        for(key in parsed.keys())java.time.Instant.parse(parsed.getString(key))
        check(history.edit().putString(owner,parsed.toString()).commit())
    }
    @JavascriptInterface @Synchronized fun postChunk(id:String,index:Int,last:Boolean,text:String) {
        check();transfers.append(id,index,last,text)?.let(::postMessage)
    }
    @JavascriptInterface fun postMessage(raw:String) {
        if(raw.length>32*1024*1024)return
        val request=runCatching { JSONObject(raw) }.getOrNull()?:return
        val id=request.optString("id");if(!id.matches(Regex("[a-f0-9-]{36}")))return
        scope.launch(Dispatchers.IO) {
            val response=try {
                if(request.getString("method")=="restart"&&reconciled)check(active)else check();val payload=request.optJSONObject("payload")?:JSONObject()
                val value:Any=when(request.getString("method")) {
                    "request"->store.request(payload.getString("method"),payload.getString("path"),payload.optJSONObject("body"))
                    "capture"->store.capture()
                    "retain"->store.retain(payload.getJSONObject("snapshot"))
                    "materialize"->store.materialize(payload.getJSONObject("snapshot"))
                    "open"->store.open(payload.getJSONObject("value"),payload.getString("scope"))
                    "seal"->store.seal(payload.get("value"),payload.getString("scope"))
                    "current"->store.current()
                    "reconcile"->store.reconcile().also { reconciled=true }
                    "restart"->{withContext(Dispatchers.Main){restart()};JSONObject()}
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
                    "importChoose"->{
                        importText=null;val uri=choose(false,"")?:error("BACKUP_CANCELLED");check()
                        val bytes=requireNotNull(app.contentResolver.openInputStream(uri)).use { input ->
                            val output=java.io.ByteArrayOutputStream();val buffer=ByteArray(65536)
                            while(true){val count=input.read(buffer);if(count<0)break;require(output.size()+count<=GenesisBackupContainer.MAX_FILE){"BACKUP_TOO_LARGE"};output.write(buffer,0,count)}
                            output.toByteArray()
                        }
                        try { check();val text=bytes.toString(Charsets.UTF_8);importText=text
                            JSONObject().put("length",text.length).put("name","import.genesisbackup")
                        }finally { bytes.fill(0) }
                    }
                    "importChunk"->{val text=requireNotNull(importText);val offset=payload.getInt("offset");require(offset in 0 until text.length);text.substring(offset,minOf(offset+131072,text.length))}
                    "importClear"->{importText=null;true}
                    else->error("BACKUP_METHOD_INVALID")
                }
                // Reconciliation deliberately retires this gateway before returning its receipt.
                if(request.getString("method") !in setOf("reconcile","restart"))check()
                JSONObject().put("value",value)
            } catch(cancelled:CancellationException){return@launch}
            catch(error:Exception){JSONObject().put("error",(error as? AuthApiError)?.code?:error.message?.takeIf { it.matches(Regex("BACKUP_[A-Z_]+")) }?:"BACKUP_NATIVE_FAILED")}
            withContext(Dispatchers.Main){if(active)deliver(id,response)}
        }
    }
    @Synchronized fun stop(){active=false;transfers.clear();importText=null;exportText=null}
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
@Composable internal fun NativeBackupDialog(owner:String,title:String,onClose:()->Unit,testGateway:BackupGateway?=null) {
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication
    val gateway=remember(owner,testGateway){testGateway?:AuthController.get(context).backupGateway(owner)}
    val store=remember(owner,gateway){BackupNativeStore(app,owner,app.workspaceScope,gateway)}
    val scope=rememberCoroutineScope();val scheme=MaterialTheme.colorScheme
    val language=LocalGenesisLanguage.current;val dark=LocalEveningTheme.current;val palette=LocalDarkPalette.current
    val textScale=LocalDensity.current.fontScale
    var chooser by remember { mutableStateOf<CompletableDeferred<Uri?>?>(null) }
    val openFile=rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()){uri->chooser?.complete(uri);chooser=null}
    val saveFile=rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/octet-stream")){uri->chooser?.complete(uri);chooser=null}
    suspend fun choose(save:Boolean,name:String):Uri? {
        val result=CompletableDeferred<Uri?>()
        withContext(Dispatchers.Main){check(chooser==null);chooser=result;if(save)saveFile.launch(name)else openFile.launch(arrayOf("application/octet-stream","application/json","*/*"))}
        return result.await()
    }
    fun hex(color:Color)="#%06x".format(color.toArgb() and 0xffffff)
    val colors=JSONObject().put("--ink",hex(scheme.onSurface)).put("--ink-soft",hex(scheme.onSurfaceVariant)).put("--surface",hex(scheme.surface))
        .put("--paper",hex(scheme.background)).put("--line",hex(scheme.outlineVariant)).put("--ui-accent",hex(scheme.primary)).put("--teal",hex(scheme.primary)).put("--ui-on-accent",hex(scheme.onPrimary))
    val boot=remember(owner){JSONObject().put("ownerId",owner).put("language",language).put("dark",dark).put("palette",palette).put("colors",colors)}
    fun encoded(value:String)=Base64.getEncoder().encodeToString(value.toByteArray(Charsets.UTF_8))
    var ready by remember { mutableStateOf(false) }
    DisposableEffect(Unit){onDispose { chooser?.cancel();chooser=null }}
    Dialog(onDismissRequest=onClose,properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnClickOutside=false,decorFitsSystemWindows=false)) {
        Surface(Modifier.fillMaxSize().safeDrawingPadding().imePadding(),color=scheme.surface) {
            Column(Modifier.fillMaxSize().testTag("backup-native-dialog")) {
                Box(Modifier.fillMaxWidth().padding(horizontal=16.dp,vertical=8.dp)){EditorDialogHeader(title,"backup-native-close",onClose)}
                AndroidView(factory={ctx->WebView(ctx).apply {
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
                if(!ready)LinearProgressIndicator(Modifier.fillMaxWidth())
            }
        }
    }
}
