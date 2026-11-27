package ru.genesis.calendar.ui

import android.annotation.SuppressLint
import android.content.Context
import android.webkit.JavascriptInterface
import android.webkit.RenderProcessGoneDetail
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.annotation.Keep
import kotlinx.coroutines.*
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.E2eePersonalSourceReconciler
import ru.genesis.calendar.auth.NativeAdvicePublicCatalogues
import ru.genesis.calendar.data.BackupTransfer
import ru.genesis.calendar.security.*
import java.io.ByteArrayInputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicInteger
import java.util.concurrent.atomic.AtomicReference

internal object AuroraSourceOrigin {
    const val ENTRY="https://appassets.androidplatform.net/aurora/source.html"
    fun assetPath(url:String):String?=if(url==ENTRY)"aurora/source.html" else
        AuroraWebOrigin.assetPath(url)?.takeIf{it.matches(Regex("aurora/assets/[A-Za-z0-9_.-]+\\.js"))}
}

private const val SOURCE_MAXIMUM=16*1024*1024
private const val SOURCE_CHUNK=131072
private fun sourceCode(error:Throwable):String=error.message?.takeIf{it.matches(Regex("E2EE_[A-Z_]{1,100}"))}?:"E2EE_AURORA_RECONCILIATION_FAILED"

internal enum class PersonalSourceKind(val wire:String,val domain:String){
    AURORA("aurora","aurora"),STOICHEION("stoicheion","stoicheion"),ADVICE("advice","workspace"),TASKS("tasks","workspace"),DIARY("diary","diary"),MINDMAPS("mindmaps","mindmap"),PHYSIS("physis","physis"),REMINDERS("reminders","workspace"),ARCHIVES("archives","local-snapshot"),RELATIONAL("relational","shared-project");
    fun domainFor(id:String):String=if(this==RELATIONAL){if(id.startsWith("private-file:"))"attachment"else if(id.startsWith("private-table:personal.")||id.startsWith("private-path:personal.")||id.startsWith("private-work:personal."))"local-snapshot"
        else if(listOf("private-table:","private-path:","private-work:").any{prefix->id.startsWith(prefix+"project.mindmaps:")||id.startsWith(prefix+"space.mindmaps:")})"mindmap"else domain}
        else if(this==MINDMAPS&&id.startsWith("personal-mindmap-image:"))"attachment"else domain
    fun accepts(id:String):Boolean=when(this){
        AURORA->id in setOf("personal-aurora-workspace-v1","personal-aurora-local-history-v1")||id.matches(Regex("aurora-result:[a-f0-9-]{36}"))
        STOICHEION->id in setOf("personal-stoicheion-workspace-v1","personal-stoicheion-local-history-v1","personal-stoicheion-draw-history-v1")
        ADVICE->id in setOf("personal-advice-preferences-v1","personal-advice-local-history-v1","personal-advice-history-index-v1","personal-advice-native-metadata-v1")
            ||id.matches(Regex("personal-advice-day:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))
        TASKS->id in setOf("personal-task-index-v1","personal-task-history-v1","personal-tasks-live-v1")
            ||id.matches(Regex("personal-task-(?:record|shard):[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))
        DIARY->id in setOf("personal-diary-index-v1","personal-diary-local-index-v1","personal-diary-settings-v1","personal-diary-local-history-v1","personal-diary-native-history-v1")
            ||id.matches(Regex("personal-diary-record:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))
        MINDMAPS->id in setOf("personal-mindmap-index-v1","personal-mindmap-metadata-v1","personal-mindmap-local-work-v1","personal-mindmap-native-history-v1")
            ||id.matches(Regex("personal-mindmap-(?:record|version|image):[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))
        PHYSIS->id in setOf("personal-physis-index-v1","personal-physis-metadata-v1","personal-physis-local-history-v1","personal-physis-native-history-v1")
            ||id.matches(Regex("personal-physis-record:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))
        REMINDERS->id in setOf("personal-reminders-preferences-v1","personal-reminders-history-index-v1")
            ||id.matches(Regex("personal-reminder-(?:history|capture):[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))
        ARCHIVES->id=="personal-archive-index-v1"||id.matches(Regex("personal-archive:[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))
        RELATIONAL->id.matches(Regex("private-table:(?:personal|project|space)\\.[a-z-]+:[a-z_]+(?::part:(?:0|[1-9][0-9]{0,3}))?"))
            ||id.matches(Regex("private-path:(?:personal|project|space)\\.[a-z-]+:index-v1"))
            ||id.matches(Regex("private-work:(?:personal|project|space)\\.[a-z-]+:[a-f0-9-]{36}"))||id.matches(Regex("private-file:[a-f0-9-]{36}"))
    }
}
internal class NativeAuroraSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.AURORA)
internal class NativeStoicheionSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.STOICHEION)
internal class NativeTasksSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.TASKS)
internal class NativeDiarySourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.DIARY)
internal class NativeMindmapsSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.MINDMAPS)
internal class NativePhysisSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.PHYSIS)
internal class NativeRemindersSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.REMINDERS)
internal class NativeArchivesSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.ARCHIVES)
internal class NativeRelationalSourceRuntime(context:Context):E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.RELATIONAL)
internal class NativeAdviceSourceRuntime(context:Context,
    publicBytes:suspend (String,()->Unit)->ByteArray=NativeAdvicePublicCatalogues({context.assets.open("originals/catalogs/public-advice-editions-v2.json").use{it.readBytes()}})::read)
    :E2eePersonalSourceReconciler by NativePersonalSourceRuntime(context,PersonalSourceKind.ADVICE,publicBytes)

/** One owner-bound job in a newly constructed, network-disabled WebView. Only
 * immutable capture/legacy documents enter it. Every key stays in native code;
 * there are no vault, HTTP, storage, file or mutation bridge methods. */
internal class NativePersonalSourceRuntime(private val context:Context,private val source:PersonalSourceKind,
    private val publicBytes:(suspend (String,()->Unit)->ByteArray)?=null):E2eePersonalSourceReconciler {
    @SuppressLint("SetJavaScriptEnabled")
    override suspend fun reconcile(local:JSONObject,previous:List<JSONObject>,context:E2eeMigrationSourceContext,remote:JSONObject,
        assertCurrent:()->Unit,openLegacy:suspend (JSONObject,String)->Any):E2eePathReconciliation=coroutineScope {
        assertCurrent();val owner=context.ownerId;val scope=context.scopeId
        val localBinding=if(source==PersonalSourceKind.RELATIONAL)local.getJSONObject("target")else local
        check(localBinding.get("ownerId")==owner&&localBinding.get("scopeId")==scope&&remote.get("ownerId")==owner&&remote.get("scopeId")==scope){"E2EE_SCOPE_BINDING_MISMATCH"}
        if(source==PersonalSourceKind.ADVICE)check(!local.has("legacyKey")&&local.optJSONObject("memory")?.has("legacyKey")!=true&&!remote.has("legacyKey")&&publicBytes!=null){"E2EE_KEY_BRIDGE_FORBIDDEN"}
        else if(source==PersonalSourceKind.REMINDERS)check(!local.has("legacyKey")&&!local.has("memory")&&remote.getJSONObject("legacyKey").get("keyMode")=="empty"&&remote.getJSONObject("legacyKey").isNull("key")){"E2EE_KEY_BRIDGE_FORBIDDEN"}
        else if(source==PersonalSourceKind.ARCHIVES)check(local.getInt("protocol")==2&&!local.has("oldKeys")&&!local.has("memory")&&remote.getJSONObject("legacyKey").isNull("key")){"E2EE_KEY_BRIDGE_FORBIDDEN"}
        else if(source==PersonalSourceKind.RELATIONAL)check(!local.has("oldKeys")&&!local.has("memory")&&!remote.has("legacyKey")){"E2EE_KEY_BRIDGE_FORBIDDEN"}
        else check(local.getJSONObject("memory").getString("legacyKey").isEmpty()&&remote.getJSONObject("legacyKey").isNull("key")){"E2EE_KEY_BRIDGE_FORBIDDEN"}
        withContext(Dispatchers.Main.immediate){assertCurrent();check(nativeWebRuntimeProblem(this@NativePersonalSourceRuntime.context,"en")==null){"E2EE_WEB_RUNTIME_UPDATE_REQUIRED"}}
        val id=UUID.randomUUID().toString();val outcome=CompletableDeferred<E2eePathReconciliation>()
        val operations=CoroutineScope(SupervisorJob(currentCoroutineContext()[Job])+Dispatchers.IO)
        val completed=AtomicReference<E2eePathReconciliation?>();var handedOff=false
        var view:WebView?=null
        val active=AtomicBoolean(true)
        suspend fun deliver(request:String,value:JSONObject){
            assertCurrent();val plain=value.toString().toByteArray(Charsets.UTF_8)
            val encoded=try{check(plain.size<=(if(source in setOf(PersonalSourceKind.ARCHIVES,PersonalSourceKind.RELATIONAL))64*1024*1024 else SOURCE_MAXIMUM)){"E2EE_SOURCE_TOO_LARGE"};E2eeEnvelope.encode(plain)}finally{plain.fill(0)}
            withContext(Dispatchers.Main.immediate){
                if(!active.get()||outcome.isCompleted)return@withContext
                assertCurrent();val current=requireNotNull(view);check(current.url==AuroraSourceOrigin.ENTRY){"E2EE_AURORA_RUNTIME_CLOSED"}
                encoded.chunked(SOURCE_CHUNK).forEachIndexed{index,chunk->current.evaluateJavascript("window.GenesisAuroraSourceRuntime.resolveChunk('$id','$request',$index,${index==((encoded.length-1)/SOURCE_CHUNK)},'$chunk')",null)}
            }
        }
        val bridge=AuroraSourceBridge(id,source,active,operations,outcome,completed,assertCurrent,openLegacy,publicBytes,::deliver)
        try{
            withTimeout(120000){
                val input=JSONObject().put("protocol",1).put("source",source.wire).put("ownerId",owner).put("scopeId",scope)
                    .put("local",E2eeEnvelope.encode(local.toString().toByteArray(Charsets.UTF_8)))
                    .put("previous",JSONArray(previous.map{E2eeEnvelope.encode(it.toString().toByteArray(Charsets.UTF_8))}))
                    .put("context",JSONObject().put("ownerId",owner).put("scopeId",scope).put("migrationId",context.migrationId).put("fence",context.fence).put("sourceHash",context.sourceHash).put("generation",context.generation))
                    .put("remote",remote)
                val inputBytes=input.toString().toByteArray(Charsets.UTF_8)
                val maximum=E2eeMigrationSources.BYTE_BUDGET.toLong()
                val encoded=try{check(inputBytes.size.toLong()<=maximum){"E2EE_MIGRATION_TOO_LARGE"};E2eeEnvelope.encode(inputBytes)}finally{inputBytes.fill(0)}
                withContext(Dispatchers.Main.immediate){
                    assertCurrent();check(nativeWebRuntimeProblem(this@NativePersonalSourceRuntime.context,"en")==null){"E2EE_WEB_RUNTIME_UPDATE_REQUIRED"}
                    val started=AtomicBoolean(false)
                    view=WebView(this@NativePersonalSourceRuntime.context).apply{
                        settings.javaScriptEnabled=true;settings.domStorageEnabled=false;settings.databaseEnabled=false
                        settings.allowFileAccess=false;settings.allowContentAccess=false;settings.blockNetworkLoads=true
                        settings.javaScriptCanOpenWindowsAutomatically=false;settings.setSupportMultipleWindows(false)
                        settings.mixedContentMode=android.webkit.WebSettings.MIXED_CONTENT_NEVER_ALLOW;settings.cacheMode=android.webkit.WebSettings.LOAD_NO_CACHE
                        addJavascriptInterface(bridge,"GenesisAuroraSourceBridge")
                        webViewClient=object:WebViewClient(){
                            override fun shouldOverrideUrlLoading(view:WebView,request:WebResourceRequest)=true
                            override fun shouldInterceptRequest(view:WebView,request:WebResourceRequest):WebResourceResponse{
                                val path=if(request.method=="GET")AuroraSourceOrigin.assetPath(request.url.toString()) else null
                                val stream=path?.let{runCatching{this@NativePersonalSourceRuntime.context.assets.open(it)}.getOrNull()}
                                return WebResourceResponse(if(path?.endsWith(".html")==true)"text/html" else "text/javascript","UTF-8",if(stream!=null)200 else 403,
                                    if(stream!=null)"OK" else "Forbidden",mapOf("Cache-Control" to "no-store","X-Content-Type-Options" to "nosniff"),stream?:ByteArrayInputStream(byteArrayOf()))
                            }
                            override fun onPageFinished(view:WebView,url:String){
                                if(url!=AuroraSourceOrigin.ENTRY||!active.get()||outcome.isCompleted||!started.compareAndSet(false,true))return
                                try{
                                    fun append(index:Int){
                                        if(!active.get()||outcome.isCompleted)return
                                        try{assertCurrent();val offset=index*SOURCE_CHUNK;val last=offset+SOURCE_CHUNK>=encoded.length;val chunk=encoded.substring(offset,minOf(encoded.length,offset+SOURCE_CHUNK))
                                            view.evaluateJavascript("window.GenesisAuroraSourceRuntime.append('$id',$index,$last,'$chunk')"){value->
                                                if(value!="true"&&!outcome.isCompleted)outcome.completeExceptionally(IllegalStateException("E2EE_AURORA_RUNTIME_UNAVAILABLE")) else if(!last)append(index+1)
                                            }
                                        }catch(error:Throwable){outcome.completeExceptionally(IllegalStateException(sourceCode(error)))}
                                    };append(0)
                                }catch(error:Throwable){outcome.completeExceptionally(IllegalStateException(sourceCode(error)))}
                            }
                            override fun onRenderProcessGone(view:WebView,detail:RenderProcessGoneDetail):Boolean{
                                outcome.completeExceptionally(IllegalStateException("E2EE_AURORA_RUNTIME_UNAVAILABLE"));return true
                            }
                        }
                        loadUrl(AuroraSourceOrigin.ENTRY)
                    }
                }
                val result=outcome.await()
                assertCurrent();handedOff=true;completed.set(null);result
            }
        }finally{
            active.set(false);bridge.clear();operations.cancel()
            withContext(NonCancellable){operations.coroutineContext[Job]?.join();if(!handedOff)completed.getAndSet(null)?.let{(it.content+it.localContent).forEach{row->row.bytes.fill(0)}}}
            withContext(NonCancellable+Dispatchers.Main.immediate){view?.let{it.removeJavascriptInterface("GenesisAuroraSourceBridge");it.stopLoading();it.destroy()};view=null}
        }
    }
    override fun toString()="NativePersonalSourceRuntime([redacted])"
}

@Keep
internal class AuroraSourceBridge(private val job:String,private val source:PersonalSourceKind,private val active:AtomicBoolean,private val operations:CoroutineScope,
    private val result:CompletableDeferred<E2eePathReconciliation>,private val completed:AtomicReference<E2eePathReconciliation?>,private val assertCurrent:()->Unit,
    private val openLegacy:suspend (JSONObject,String)->Any,private val publicBytes:(suspend (String,()->Unit)->ByteArray)?,
    private val deliver:suspend (String,JSONObject)->Unit){
    private val transfers=BackupTransfer(24*1024*1024);private val inflight=AtomicInteger()
    private val stream=NativeSourceResultStream(accepts={domain,id->source.accepts(id)
        &&domain==source.domainFor(id)},acceptsPlacement={placement,_,id->
        source!=PersonalSourceKind.REMINDERS||if(placement=="remote")id=="personal-reminders-preferences-v1" else id!="personal-reminders-preferences-v1"})
    @JavascriptInterface fun postChunk(id:String,index:Int,last:Boolean,text:String){
        if(!active.get()||result.isCompleted)return
        try{transfers.append(id,index,last,text)?.let(::postMessage)}catch(_:Throwable){fail("E2EE_AURORA_BRIDGE_INVALID")}
    }
    @JavascriptInterface fun postMessage(raw:String){
        if(!active.get()||result.isCompleted)return
        if(raw.length>24*1024*1024){fail("E2EE_AURORA_BRIDGE_INVALID");return}
        if(inflight.incrementAndGet()>2){inflight.decrementAndGet();fail("E2EE_AURORA_BRIDGE_INVALID");return}
        val counted=AtomicBoolean(true)
        fun release(){if(counted.compareAndSet(true,false))inflight.decrementAndGet()}
        suspend fun reply(id:String,value:JSONObject){
            assertCurrent()
            if(active.get()&&!result.isCompleted){
                // Javascript may synchronously submit its next request while
                // receiving this acknowledgement. Native work has finished;
                // release its bounded permit before crossing that boundary.
                release();deliver(id,value)
            }
        }
        operations.launch{
            try{
                assertCurrent();check(active.get()&&!result.isCompleted){"E2EE_AURORA_RUNTIME_CLOSED"}
                val value=JSONObject(raw);check(value.get("job")==job){"E2EE_SCOPE_BINDING_MISMATCH"}
                when(value.getString("kind")){
                    "open"->{
                        check(source !in setOf(PersonalSourceKind.ADVICE,PersonalSourceKind.REMINDERS,PersonalSourceKind.RELATIONAL)){"E2EE_KEY_BRIDGE_FORBIDDEN"}
                        E2eeKeys.exact(value,setOf("job","id","kind","envelope","purpose"));val id=value.getString("id")
                        check(id.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"E2EE_AURORA_BRIDGE_INVALID"}
                        val envelope=value.getJSONObject("envelope");E2eeKeys.exact(envelope,setOf("iv","ciphertext"))
                        val response=try{JSONObject().put("value",openLegacy(envelope,value.getString("purpose")))}catch(error:Throwable){JSONObject().put("error",sourceCode(error))}
                        reply(id,response)
                    }
                    "public-catalogue"->{
                        check(source==PersonalSourceKind.ADVICE&&publicBytes!=null){"E2EE_AURORA_BRIDGE_INVALID"}
                        E2eeKeys.exact(value,setOf("job","id","kind","path"));val id=value.getString("id");val path=value.getString("path")
                        check(id.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))&&path.length<=256){"E2EE_AURORA_BRIDGE_INVALID"}
                        val response=try{
                            val bytes=publicBytes.invoke(path,assertCurrent)
                            try{assertCurrent();check(bytes.size in 2..8*1024*1024){"E2EE_ADVICE_CATALOGUE_INVALID"};JSONObject().put("value",E2eeEnvelope.encode(bytes))}finally{bytes.fill(0)}
                        }catch(error:Throwable){JSONObject().put("error",sourceCode(error))}
                        reply(id,response)
                    }
                    "result-part"->{
                        E2eeKeys.exact(value,setOf("job","id","kind","part"));val id=value.getString("id")
                        check(id.matches(Regex("[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}"))){"E2EE_AURORA_BRIDGE_INVALID"}
                        stream.part(value.getJSONObject("part"));reply(id,JSONObject().put("value",true))
                    }
                    "complete-stream"->{
                        E2eeKeys.exact(value,setOf("job","kind","protocol","complete","remoteCount","localCount"))
                        check(E2eeCommands.integer(value.get("protocol"))==1L&&value.get("complete") is Boolean){"E2EE_AURORA_BRIDGE_INVALID"};assertCurrent()
                        stream.finish(value.getBoolean("complete"),E2eeCommands.integer(value.get("remoteCount")),E2eeCommands.integer(value.get("localCount"))){reconciliation->
                            if(!active.get()||!completed.compareAndSet(null,reconciliation))false
                            else if(result.complete(reconciliation))true else{completed.compareAndSet(reconciliation,null);false}
                        }
                    }
                    "complete"->{
                        E2eeKeys.exact(value,setOf("job","kind","complete","content","localContent"));val rows=value.getJSONArray("content");val privateRows=value.getJSONArray("localContent")
                        check(rows.length()+privateRows.length() in 1..10000){"E2EE_MIGRATION_TOO_LARGE"};val content=mutableListOf<E2eeMigrationContent>();val localContent=mutableListOf<E2eeMigrationContent>();var size=0L;val seen=mutableSetOf<String>()
                        try{
                            for((input,output) in listOf(rows to content,privateRows to localContent))for(index in 0 until input.length()){
                                val row=input.getJSONObject(index);E2eeKeys.exact(row,setOf("domain","objectId","bytes","filename","mediaType"));val id=E2eeKeys.technical(row.getString("objectId"))
                                val domain=row.getString("domain");val attachment=source==PersonalSourceKind.MINDMAPS&&id.startsWith("personal-mindmap-image:")
                                check(domain==(if(attachment)"attachment" else source.domain)&&source.accepts(id)&&seen.add(id)&&row.get("filename") is String&&row.get("mediaType") is String){"E2EE_AURORA_BRIDGE_INVALID"}
                                val filename=row.getString("filename");val mediaType=row.getString("mediaType");check(filename.length<=512&&mediaType.length<=128){"E2EE_AURORA_BRIDGE_INVALID"}
                                val encoded=row.getString("bytes");val bytes=if(encoded.isEmpty())byteArrayOf()else E2eeEnvelope.decode(encoded,1,SOURCE_MAXIMUM)
                                output+=E2eeMigrationContent(domain,id,bytes,filename,mediaType);size+=bytes.size;check(size<=SOURCE_MAXIMUM){"E2EE_MIGRATION_TOO_LARGE"}
                            }
                            assertCurrent();val reconciliation=E2eePathReconciliation(value.getBoolean("complete"),content,localContent)
                            if(!active.get()||!completed.compareAndSet(null,reconciliation))(content+localContent).forEach{it.bytes.fill(0)}
                            else if(!result.complete(reconciliation)){completed.compareAndSet(reconciliation,null);(content+localContent).forEach{it.bytes.fill(0)}}
                        }catch(error:Throwable){(content+localContent).forEach{it.bytes.fill(0)};throw error}
                    }
                    "error"->{E2eeKeys.exact(value,setOf("job","kind","code"));val code=value.getString("code");fail(if(code.matches(Regex("E2EE_[A-Z_]{1,100}")))code else "E2EE_AURORA_RECONCILIATION_FAILED")}
                    else->fail("E2EE_AURORA_BRIDGE_INVALID")
                }
            }catch(error:Throwable){fail(sourceCode(error))}finally{release()}
        }
    }
    private fun fail(code:String){result.completeExceptionally(IllegalStateException(code))}
    fun clear(){transfers.clear();stream.clear()}
}
