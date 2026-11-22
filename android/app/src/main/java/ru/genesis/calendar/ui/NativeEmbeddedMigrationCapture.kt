package ru.genesis.calendar.ui

import android.webkit.WebView
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import ru.genesis.calendar.security.*
import java.util.UUID
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/** A local bundled-renderer mirror, never a server/RPC payload. Passive copies
 * preserve detached forms; an explicit JS read barrier must freeze and certify
 * the mounted editor before source capture may use its current document. */
internal class NativeEmbeddedMigrationCapture(private val owner:String,private val boot:JSONObject,private val assertOwner:()->Unit){
    private var active=true;private var snapshot:JSONObject?=null;private var invalid=false;private var receipt:String?=null
    @Synchronized fun accept(request:String,raw:String){
        if(!active)return
        try{
            assertOwner();check(request.isEmpty()||UUID.fromString(request).toString()==request){"E2EE_SOURCE_CAPTURE_CHANGED"}
            check(raw.length in 1..MAX_BYTES){"E2EE_SOURCE_TOO_LARGE"};val bytes=raw.toByteArray(Charsets.UTF_8)
            val value=try{check(bytes.size<=MAX_BYTES){"E2EE_SOURCE_TOO_LARGE"};E2eeFileManifestJson.readPrivateDocument(bytes)}finally{bytes.fill(0)}
            E2eeKeys.exact(value,setOf("protocol","ownerId","frozen","settled","rows","controls"))
            check(value.getInt("protocol")==1&&value.getString("ownerId")==owner&&value.get("frozen") is Boolean&&value.get("settled") is Boolean){"E2EE_SCOPE_BINDING_MISMATCH"}
            val rows=value.getJSONArray("rows");check(rows.length()<=1000&&value.getJSONArray("controls").length()<=10000){"E2EE_SOURCE_TOO_LARGE"}
            val seen=mutableSetOf<String>()
            for(index in 0 until rows.length()){
                val row=rows.getJSONObject(index);E2eeKeys.exact(row,setOf("sourceId","kind","mounted","value"))
                check(seen.add(E2eeKeys.technical(row.getString("sourceId")))&&row.getString("kind")=="aurora"&&row.get("mounted") is Boolean){"E2EE_SOURCE_CAPTURE_CHANGED"}
                val content=row.getJSONObject("value");E2eeKeys.exact(content,setOf("current","state")+(if(content.has("settled"))setOf("settled")else emptySet()))
                check(!content.has("settled")||content.get("settled") is Boolean){"E2EE_SOURCE_CAPTURE_CHANGED"}
                if(!content.isNull("current"))E2eeKeys.exact(content.getJSONObject("current"),setOf("document","base","revision"))
            }
            assertOwner();snapshot=JSONObject(value.toString());invalid=false;if(request.isNotEmpty())receipt=request
        }catch(_:Exception){invalid=true;receipt=null}
    }
    @Synchronized fun capture():NativeMigrationMemory.Capture{
        check(active&&!invalid){"E2EE_EMBEDDED_SOURCE_CAPTURE_REQUIRED"};assertOwner()
        val value=snapshot?.let{JSONObject(it.toString())}?:error("E2EE_EMBEDDED_SOURCE_CAPTURE_REQUIRED")
        val rows=value.getJSONArray("rows");val documents=mutableListOf<JSONObject>()
        var settled=value.getBoolean("frozen")&&value.getBoolean("settled")
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);val content=row.getJSONObject("value")
            if(row.getBoolean("mounted")){
                settled=settled&&content.optBoolean("settled",true)
                content.optJSONObject("current")?.let{documents+=it}
            }
        }
        check(documents.all{E2eeProductJson.same(it,documents.firstOrNull())}){"E2EE_MOUNTED_SOURCE_REVIEW_REQUIRED"}
        val state=JSONObject().put("form","native-aurora-gno").put("boot",JSONObject(boot.toString())).put("snapshot",value).put("execution","history-only")
        return NativeMigrationMemory.Capture(documents.firstOrNull()?.let{JSONObject(it.toString())},state,settled)
    }
    suspend fun prepare(view:WebView)=withTimeout(5000){
        val request=UUID.randomUUID().toString()
        synchronized(this@NativeEmbeddedMigrationCapture){check(active){"E2EE_SOURCE_CAPTURE_CHANGED"};assertOwner();receipt=null}
        check(view.url==AuroraWebOrigin.ENTRY){"E2EE_SOURCE_CAPTURE_CHANGED"}
        suspendCancellableCoroutine<Unit>{continuation->
            view.evaluateJavascript("window.GenesisAuroraRuntime?.captureMigration('$request') === true"){result->
                if(!continuation.isActive)return@evaluateJavascript
                try{
                    synchronized(this@NativeEmbeddedMigrationCapture){assertOwner();check(active&&!invalid&&result=="true"&&receipt==request){"E2EE_EMBEDDED_SOURCE_CAPTURE_REQUIRED"}}
                    continuation.resume(Unit)
                }catch(reason:Exception){continuation.resumeWithException(reason)}
            }
        }
    }
    fun thaw(view:WebView?){if(view?.url==AuroraWebOrigin.ENTRY)view.evaluateJavascript("window.GenesisAuroraRuntime?.resumeMigration()",null)}
    @Synchronized fun failed(){invalid=true;receipt=null}
    @Synchronized fun close(){active=false;snapshot=null;receipt=null}
    override fun toString()="NativeEmbeddedMigrationCapture([redacted])"
    companion object{private const val MAX_BYTES=8*1024*1024}
}
