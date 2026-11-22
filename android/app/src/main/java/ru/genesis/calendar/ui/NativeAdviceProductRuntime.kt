package ru.genesis.calendar.ui

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.*
import androidx.annotation.Keep
import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.data.BackupTransfer
import ru.genesis.calendar.security.E2eeEnvelope
import ru.genesis.calendar.security.E2eeKeys
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger

private fun adviceRuntimeCode(code:String?)=code?.takeIf{it.matches(Regex("E2EE_[A-Z_]{1,100}"))||it in ru.genesis.calendar.auth.ProjectAccessProtocol.errors}?:"E2EE_ADVICE_RUNTIME_FAILED"
private fun adviceRuntimeCode(error:Throwable)=adviceRuntimeCode(error.message)
/** Executes the bundled common product/selection engine. Network/storage and
 * navigation are blocked in WebView. Narrow native content ports own all keys. */
internal class NativeAdviceProductRuntime(private val context:Context,private val channel:String="advice-product"){
    init{require(channel in setOf("advice-product","shared-product","shared-aggregate","membership-operation","membership-drafts"))}
    @SuppressLint("SetJavaScriptEnabled")
    suspend fun execute(input:JSONObject,current:()->Unit,call:suspend(String,JSONObject)->Any):JSONObject=coroutineScope{
        current();val id=UUID.randomUUID().toString();val outcome=CompletableDeferred<JSONObject>();val active=AtomicBoolean(true)
        val operations=CoroutineScope(SupervisorJob(currentCoroutineContext()[Job])+Dispatchers.IO);var view:WebView?=null
        suspend fun deliver(request:String,value:JSONObject){current();val bytes=value.toString().toByteArray(Charsets.UTF_8)
            val encoded=try{check(bytes.size<=16*1024*1024){"E2EE_ADVICE_CONTENT_TOO_LARGE"};E2eeEnvelope.encode(bytes)}finally{bytes.fill(0)}
            withContext(Dispatchers.Main.immediate){if(!active.get()||outcome.isCompleted)return@withContext;current();val target=requireNotNull(view);check(target.url==AuroraSourceOrigin.ENTRY){"E2EE_ADVICE_RUNTIME_CLOSED"}
                val chunks=encoded.chunked(131072);chunks.forEachIndexed{at,chunk->target.evaluateJavascript("window.GenesisAuroraSourceRuntime.resolveChunk('$id','$request',$at,${at==chunks.lastIndex},'$chunk')",null)}}
        }
        val bridge=AdviceProductRuntimeBridge(id,active,operations,outcome,current,call,::deliver,channel)
        try{withTimeout(120000){val bytes=input.toString().toByteArray(Charsets.UTF_8);val encoded=try{check(bytes.size<=12*1024*1024){"E2EE_ADVICE_CONTENT_TOO_LARGE"};E2eeEnvelope.encode(bytes)}finally{bytes.fill(0)}
            withContext(Dispatchers.Main.immediate){current();check(nativeWebRuntimeProblem(context,"en")==null){"E2EE_WEB_RUNTIME_UPDATE_REQUIRED"};val started=AtomicBoolean(false)
                view=WebView(context).apply{
                    settings.javaScriptEnabled=true;settings.domStorageEnabled=false;settings.databaseEnabled=false;settings.allowFileAccess=false;settings.allowContentAccess=false;settings.blockNetworkLoads=true
                    settings.javaScriptCanOpenWindowsAutomatically=false;settings.setSupportMultipleWindows(false);settings.mixedContentMode=WebSettings.MIXED_CONTENT_NEVER_ALLOW;settings.cacheMode=WebSettings.LOAD_NO_CACHE
                    addJavascriptInterface(bridge,"GenesisAuroraSourceBridge")
                    webViewClient=object:WebViewClient(){
                        override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true
                        override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse{
                            val path=if(request.method=="GET")AuroraSourceOrigin.assetPath(request.url.toString())else null
                            val stream=path?.let{runCatching{context.assets.open(it)}.getOrNull()}
                            return WebResourceResponse(if(path?.endsWith(".html")==true)"text/html"else"text/javascript","UTF-8",if(stream!=null)200 else 403,if(stream!=null)"OK"else"Forbidden",
                                mapOf("Cache-Control" to "no-store","X-Content-Type-Options" to "nosniff"),stream?:ByteArrayInputStream(byteArrayOf()))
                        }
                        override fun onPageFinished(target:WebView,url:String){if(url!=AuroraSourceOrigin.ENTRY||!active.get()||outcome.isCompleted||!started.compareAndSet(false,true))return
                            try{current();val chunks=encoded.chunked(131072);chunks.forEachIndexed{at,chunk->target.evaluateJavascript("window.GenesisAuroraSourceRuntime.append('$id',$at,${at==chunks.lastIndex},'$chunk')"){accepted->if(accepted!="true"&&!outcome.isCompleted)outcome.completeExceptionally(IllegalStateException("E2EE_ADVICE_RUNTIME_FAILED"))}}}
                            catch(error:Throwable){outcome.completeExceptionally(IllegalStateException(adviceRuntimeCode(error)))}}
                        override fun onRenderProcessGone(view:WebView,detail:RenderProcessGoneDetail):Boolean{outcome.completeExceptionally(IllegalStateException("E2EE_ADVICE_RUNTIME_FAILED"));return true}
                    };loadUrl(AuroraSourceOrigin.ENTRY)
                }
            };outcome.await().also{current()}
        }}finally{active.set(false);bridge.clear();operations.cancel();withContext(NonCancellable){operations.coroutineContext[Job]?.join()}
            withContext(NonCancellable+Dispatchers.Main.immediate){view?.let{it.removeJavascriptInterface("GenesisAuroraSourceBridge");it.stopLoading();it.destroy()};view=null}}
    }
}
@Keep
private class AdviceProductRuntimeBridge(private val job:String,private val active:AtomicBoolean,private val operations:CoroutineScope,private val outcome:CompletableDeferred<JSONObject>,
    private val current:()->Unit,private val call:suspend(String,JSONObject)->Any,private val deliver:suspend(String,JSONObject)->Unit,private val channel:String){
    private val transfers=BackupTransfer(24*1024*1024);private val inflight=AtomicInteger()
    @JavascriptInterface fun postChunk(id:String,index:Int,last:Boolean,text:String){if(!active.get()||outcome.isCompleted)return;try{transfers.append(id,index,last,text)?.let(::postMessage)}catch(error:Throwable){outcome.completeExceptionally(IllegalStateException("E2EE_ADVICE_RUNTIME_FAILED"))}}
    @JavascriptInterface fun postMessage(raw:String){if(!active.get()||outcome.isCompleted)return
        if(raw.length>24*1024*1024||inflight.incrementAndGet()>4){outcome.completeExceptionally(IllegalStateException("E2EE_ADVICE_RUNTIME_FAILED"));return}
        operations.launch{try{current();val value=ru.genesis.calendar.security.E2eeFileManifestJson.readPrivateDocument(raw.toByteArray(Charsets.UTF_8));check(value.getString("job")==job){"E2EE_SCOPE_BINDING_MISMATCH"}
            when(value.getString("kind")){
                "$channel-call"->{E2eeKeys.exact(value,setOf("job","id","kind","method","payload"));val request=value.getString("id");check(request.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"E2EE_ADVICE_RUNTIME_FAILED"}
                    val response=try{JSONObject().put("value",call(value.getString("method"),value.getJSONObject("payload")))}catch(error:CancellationException){throw error}catch(error:Throwable){JSONObject().put("error",adviceRuntimeCode(error))}
                    current();if(active.get()&&!outcome.isCompleted)deliver(request,response)}
                "$channel-complete"->{E2eeKeys.exact(value,setOf("job","kind","value"));current();outcome.complete(value.getJSONObject("value"))}
                "error"->{E2eeKeys.exact(value,setOf("job","kind","code"));outcome.completeExceptionally(IllegalStateException(adviceRuntimeCode(value.getString("code"))))}
                else->error("E2EE_ADVICE_RUNTIME_FAILED")
            }
        }catch(error:Throwable){outcome.completeExceptionally(IllegalStateException(adviceRuntimeCode(error)))}finally{inflight.decrementAndGet()}}
    }
    fun clear(){transfers.clear()}
}
