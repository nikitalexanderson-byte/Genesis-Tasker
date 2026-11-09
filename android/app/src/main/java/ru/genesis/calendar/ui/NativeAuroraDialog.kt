package ru.genesis.calendar.ui

import android.annotation.SuppressLint
import android.content.Intent
import android.net.Uri
import android.speech.tts.TextToSpeech
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.Keep
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.DialogProperties
import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.AuthFailure
import ru.genesis.calendar.data.AuroraGateway
import ru.genesis.calendar.data.AuroraNativeStore
import java.io.ByteArrayInputStream
import java.net.URI
import java.util.Base64
import java.util.Locale

data class AuroraTaskDraft(val title: String, val description: String, val dueDate: String?,
    val dueTime: String?, val zoneId: String?, val kind: String, val sourceId: String)

internal object AuroraWebOrigin {
    const val ENTRY = "https://appassets.androidplatform.net/aurora/index.html"
    fun assetPath(url: String): String? = runCatching {
        val uri=URI(url)
        if(uri.scheme!="https" || uri.host!="appassets.androidplatform.net" || uri.userInfo!=null || uri.port!=-1) return null
        val path=uri.path.removePrefix("/")
        if(path.split('/').any { it in setOf(".","..","") || !it.matches(Regex("[A-Za-z0-9_.-]+")) }) return null
        when {
            path=="aurora/index.html" || path.matches(Regex("aurora/assets/[A-Za-z0-9_.-]+\\.(js|css)")) -> path
            path.startsWith("fonts/") || path.startsWith("stoicheion-cards/") || path.startsWith("theokyklos-symbols/") || path.startsWith("calendar-art/") -> "originals/$path"
            else -> null
        }
    }.getOrNull()
    fun checkout(url: String): Boolean = runCatching {
        val uri=URI(url);val host=uri.host.orEmpty()
        uri.scheme=="https" && uri.userInfo==null && uri.port==-1 &&
            (host in setOf("yoomoney.ru","yookassa.ru","lemonsqueezy.com") || host.endsWith(".lemonsqueezy.com"))
    }.getOrDefault(false)
}

@Keep
private class AuroraJavascriptBridge(private val store: AuroraNativeStore, private val gateway: AuroraGateway,
    private val scope: CoroutineScope, private val deliver: (String,JSONObject)->Unit,
    private val onTask: (AuroraTaskDraft)->Unit, private val onCheckout: (String)->Unit,
    private val onSpeak: (String)->Unit, private val onClose: ()->Unit,
    private val onContentSize: (Int,Int)->Unit) {
    @Volatile private var active=true
    @JavascriptInterface fun contentSize(height: Int, width: Int) {
        if (!active || height !in 1..100000 || width !in 1..8192) return
        scope.launch(Dispatchers.Main) { if (active) onContentSize(height, width) }
    }
    private fun check(){check(active){"AURORA_VIEW_CLOSED"};gateway.check()}
    @JavascriptInterface fun getItem(key:String):String?=runBlocking(Dispatchers.IO){check();store.getItem(key).also{check()}}
    @JavascriptInterface fun setItem(key:String,value:String)=runBlocking(Dispatchers.IO){check();store.setItem(key,value);check()}
    @JavascriptInterface fun removeItem(key:String)=runBlocking(Dispatchers.IO){check();store.removeItem(key);check()}
    @JavascriptInterface fun postMessage(raw:String){
        if(raw.length>4_100_000)return
        val request=runCatching{JSONObject(raw)}.getOrNull()?:return
        val id=request.optString("id");if(!id.matches(Regex("[a-f0-9-]{36}")))return
        scope.launch(Dispatchers.IO){
            val response=try{
                check();val payload=request.optJSONObject("payload")?:JSONObject()
                val value:Any=when(request.getString("method")){
                    "request"->store.request(payload.getString("method"),payload.getString("path"),payload.optJSONObject("body"))
                    "billing"->{val method=payload.getString("method");val path=payload.getString("path");val body=payload.optJSONObject("body")
                        if(method=="POST"&&path=="/billing/modeling/orders")body?.put("client",if(BuildConfig.PLAY_DISTRIBUTION)"android-play" else "android")
                        store.billing(method,path,body)}
                    "seal"->store.seal(payload.get("value"),payload.getString("scope"))
                    "open"->store.open(payload.getJSONObject("value"),payload.getString("scope"))
                    "checkout"->{val url=payload.getString("url");require(AuroraWebOrigin.checkout(url));withContext(Dispatchers.Main){check();onCheckout(url)};JSONObject()}
                    "speak"->{val text=payload.getString("pronunciation");require(text.length<=300);withContext(Dispatchers.Main){check();onSpeak(text)};JSONObject()}
                    "task"->{val title=payload.getString("title");val description=payload.optString("description");require(title.isNotBlank()&&title.length<=500&&description.length<=20000)
                        val date=payload.optString("dueDate").takeUnless{it.isBlank()||it=="null"};date?.let{java.time.LocalDate.parse(it)}
                        val time=payload.optString("dueTime").takeUnless{it.isBlank()||it=="null"};time?.let{java.time.LocalTime.parse(it)}
                        val zone=payload.optString("zoneId").takeUnless{it.isBlank()||it=="null"};zone?.let{java.time.ZoneId.of(it)}
                        val kind=payload.getString("kind");require(kind in setOf("action","review"))
                        val source=payload.getString("sourceId");require(source.length<=350)
                        withContext(Dispatchers.Main){check();onTask(AuroraTaskDraft(title,description,date,time,zone,kind,source))};JSONObject()}
                    "close"->{withContext(Dispatchers.Main){check();onClose()};JSONObject()}
                    else->error("AURORA_METHOD_INVALID")
                }
                check();JSONObject().put("value",value)
            }catch(cancelled:CancellationException){return@launch}
            catch(error:Exception){
                val code=when(error){is AuthApiError->error.code;else->error.message?.takeIf{it.matches(Regex("(?:AURORA|MODELING)_[A-Z_]+"))}?:"AURORA_NATIVE_REQUEST_FAILED"}
                JSONObject().put("error",code).put("status",(error as? AuthFailure)?.httpStatus?:if(code=="AURORA_ACCOUNT_CHANGED")401 else 0)
            }
            withContext(Dispatchers.Main){if(active)deliver(id,response)}
        }
    }
    fun stop(){active=false;store.close()}
}

/** Native navigation/insets/crypto surround a local signed, shared module.
 * The WebView cannot navigate, access files, use cookies, or fetch the network.
 */
@SuppressLint("SetJavaScriptEnabled")
@Composable internal fun NativeAuroraDialog(owner:String,source:JSONObject?,onClose:()->Unit,onTask:(AuroraTaskDraft)->Unit,
    testGateway:AuroraGateway?=null) {
    val context=LocalContext.current;val app=context.applicationContext as GenesisApplication
    val controller=remember(context){AuthController.get(context)}
    val gateway=remember(owner,testGateway){testGateway?:controller.auroraGateway(owner)}
    val scope=rememberCoroutineScope();val store=remember(owner,gateway){AuroraNativeStore(app,owner,app.workspaceScope,gateway)}
    val dark=LocalEveningTheme.current;val palette=LocalDarkPalette.current;val language=LocalGenesisLanguage.current
    val entryCopy=remember(context,language){context.assets.open("originals/i18n/aurora-availability.json").bufferedReader(Charsets.UTF_8).use{JSONObject(it.readText()).getJSONObject(language)}}
    val scheme=MaterialTheme.colorScheme
    val textScale=LocalDensity.current.fontScale
    fun hex(color:Color)="#%06x".format(color.toArgb() and 0xffffff)
    val colors=JSONObject().put("--ink",hex(scheme.onSurface)).put("--ink-soft",hex(scheme.onSurfaceVariant))
        .put("--surface",hex(scheme.surface)).put("--paper",hex(scheme.background)).put("--line",hex(scheme.outlineVariant))
        .put("--ui-accent",hex(scheme.primary)).put("--ui-on-accent",hex(scheme.onPrimary)).put("--teal",hex(scheme.primary))
    val theme=JSONObject().put("dark",dark).put("palette",palette).put("colors",colors)
    fun encoded(value:JSONObject)=Base64.getEncoder().encodeToString(value.toString().toByteArray(Charsets.UTF_8))
    val boot=remember(owner){JSONObject().put("ownerId",owner).put("language",language)
        .put("client",if(BuildConfig.PLAY_DISTRIBUTION)"android-play" else "android").put("source",source?:JSONObject.NULL)
        .put("dark",dark).put("palette",palette).put("colors",colors)}
    var web by remember { mutableStateOf<WebView?>(null) };var ready by remember{mutableStateOf(false)};var failed by remember{mutableStateOf(false)}
    val density = LocalDensity.current.density
    var contentHeight by remember { mutableStateOf(160.dp) }
    var headerHeight by remember { mutableStateOf(80.dp) }
    val speech=remember(context){TextToSpeech(context){}}
    DisposableEffect(speech){onDispose{speech.stop();speech.shutdown()}}
    fun close(){val view=web;if(ready&&view!=null)view.evaluateJavascript("window.GenesisAuroraRuntime.requestClose()",null) else onClose()}
    Dialog(onDismissRequest={close()},properties=DialogProperties(usePlatformDefaultWidth=false,dismissOnClickOutside=false,decorFitsSystemWindows=false)){
        Surface(Modifier.fillMaxWidth(),color=scheme.surface){
          BoxWithConstraints(Modifier.fillMaxWidth()) {
            val viewportHeight = contentHeight.coerceIn(48.dp, (maxHeight - headerHeight - 8.dp).coerceAtLeast(48.dp))
            Column(Modifier.fillMaxWidth().testTag("aurora-native-dialog")){
                Box(Modifier.fillMaxWidth().onSizeChanged { headerHeight = (it.height / density).dp }
                    .padding(horizontal = 8.dp, vertical = 4.dp)) {
                    EditorDialogHeader("Метод моделирования будущего","aurora-native-close"){close()}
                }
                if(failed)UntranslatedText(entryCopy.getString("loadError"),Modifier.padding(16.dp),color=scheme.error)
                AndroidView(factory={ctx->WebView(ctx).apply{
                    web=this;setBackgroundColor(scheme.surface.toArgb())
                    settings.javaScriptEnabled=true;settings.allowFileAccess=false;settings.allowContentAccess=false
                    settings.domStorageEnabled=false;settings.databaseEnabled=false;settings.javaScriptCanOpenWindowsAutomatically=false
                    settings.setSupportMultipleWindows(false);settings.mixedContentMode=android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW
                    settings.cacheMode=android.webkit.WebSettings.LOAD_NO_CACHE
                    settings.textZoom=(textScale*100).toInt().coerceIn(80,250)
                    val bridge=AuroraJavascriptBridge(store,gateway,scope,{id,response->
                        if(url==AuroraWebOrigin.ENTRY)evaluateJavascript("window.GenesisAuroraRuntime.resolve('$id','${encoded(response)}')",null)
                    },onTask,{url->ctx.startActivity(Intent(Intent.ACTION_VIEW,Uri.parse(url)))},{text->speech.language=Locale.forLanguageTag("ru-RU");speech.speak(text,TextToSpeech.QUEUE_FLUSH,null,"aurora")},onClose,
                        { height, width -> if (this.width > 0) contentHeight = (height.toFloat() * this.width / width / density).dp })
                    tag=bridge;addJavascriptInterface(bridge,"GenesisAuroraBridge")
                    webViewClient=object:WebViewClient(){
                        override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true
                        override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse{
                            val path=AuroraWebOrigin.assetPath(request.url.toString())
                            val mime=when(path?.substringAfterLast('.')){"html"->"text/html";"js"->"text/javascript";"css"->"text/css";"webp"->"image/webp";"png"->"image/png";"jpg","jpeg"->"image/jpeg";"svg"->"image/svg+xml";"woff2"->"font/woff2";else->"application/octet-stream"}
                            val stream=path?.let{runCatching{ctx.assets.open(it)}.getOrNull()}
                            return WebResourceResponse(mime,"UTF-8",if(stream!=null)200 else 404,if(stream!=null)"OK" else "Not Found",
                                mapOf("Cache-Control" to "no-store","X-Content-Type-Options" to "nosniff"),stream?:ByteArrayInputStream(byteArrayOf()))
                        }
                        override fun onPageFinished(view:WebView,url:String){
                            if(url!=AuroraWebOrigin.ENTRY)return
                            view.evaluateJavascript("(function(){if(!window.GenesisAuroraRuntime)return false;window.GenesisAuroraRuntime.init('${encoded(boot)}');return true})()"){value->ready=value=="true";failed=!ready}
                        }
                    }
                    loadUrl(AuroraWebOrigin.ENTRY)
                }},update={view->if(ready)view.evaluateJavascript("window.GenesisAuroraRuntime.theme('${encoded(theme)}')",null)},
                    modifier=Modifier.fillMaxWidth().height(viewportHeight).testTag("aurora-native-webview"),onRelease={view->
                        (view.tag as? AuroraJavascriptBridge)?.stop();view.removeJavascriptInterface("GenesisAuroraBridge");view.stopLoading();view.destroy();web=null
                    })
                if(!ready&&!failed)LinearProgressIndicator(Modifier.fillMaxWidth())
            }
          }
        }
    }
}
