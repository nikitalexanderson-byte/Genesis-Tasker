package ru.genesis.calendar.security

import android.content.Context
import android.net.Uri
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Native owns the vault and ordinary shared writer. The isolated common
 * engine receives content only, never keys, server grants or raw endpoints. */
internal class E2eeNativeSharedContentRestore(context:Context,private val account:E2eeProductAccount,private val guard:()->Unit){
    private val runtime=NativeAdviceProductRuntime(context,"personal-restore");private val mutex=Mutex();private val prefix="shared-content-restore:"
    private val live=E2eeNativeSharedLive(context,account)
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun document(id:String)=E2eeDeviceDocument(account.device,prefix+E2eeKeys.technical(id),{value->validate(value,account.ownerId,id)},::current)
    suspend fun execute(action:String,args:JSONObject=JSONObject()):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        current();check(action in setOf("create","pending","inspect","preview","confirm","apply")){"E2EE_RESTORE_CONTENT_INVALID"}
        suspend fun call(method:String,input:JSONObject):Any{current();val result:Any=when(method){
            "load"->{E2eeKeys.exact(input,setOf("id"));document(input.getString("id")).load()?.let{JSONObject().put("value",it.value).put("serial",it.serial)}?:JSONObject.NULL}
            "save"->{E2eeKeys.exact(input,setOf("id","document","expected"));document(input.getString("id")).save(input.getJSONObject("document"),if(input.isNull("expected"))null else E2eeCommands.integer(input.get("expected"),1)).serial}
            "list"->{E2eeKeys.exact(input,emptySet());JSONArray(account.device.vault.listLocal("draft",prefix).map{it.removePrefix(prefix)})}
            "capture","request"->{E2eeKeys.exact(input,if(method=="capture")setOf("binding")else setOf("binding","path","input"));val binding=input.getJSONObject("binding");E2eeKeys.exact(binding,setOf("scopeId","kind","resourceId"));E2eeKeys.technical(binding.getString("scopeId"));val id=E2eeKeys.technical(binding.getString("resourceId"));val kind=binding.getString("kind");check(kind in setOf("project","space")){"E2EE_SCOPE_BINDING_MISMATCH"}
                val path=if(method=="capture")"execution/capture" else input.getString("path");check(path in setOf("execution/capture","content-restore/file","content-restore/records")){"E2EE_RESTORE_CONTENT_INVALID"}
                check((method=="capture")== (path=="execution/capture")){"E2EE_RESTORE_CONTENT_INVALID"};val url="/shared/"+(if(kind=="project")"projects"else"spaces")+"/"+Uri.encode(id)+"/"+path
                live.request(if(method=="capture")"GET"else"POST",url,if(method=="capture")null else input.getJSONObject("input"))}
            else->error("E2EE_RESTORE_CONTENT_INVALID")
        };current();return result}
        runtime.execute(JSONObject().put("protocol",1).put("mode","shared-content-restore-v1").put("ownerId",account.ownerId).put("action",action).put("args",JSONObject(args.toString())),::current,::call).also{current()}
    }}
    companion object{
        fun validate(value:JSONObject,ownerId:String,id:String):JSONObject{
            E2eeKeys.exact(value,setOf("format","ownerId","intentId","backupId","createdAt","source","proposal","confirmed","started","complete","applied"));check(value.get("format")=="genesis-shared-content-restore-v1"&&value.get("ownerId")==ownerId&&value.get("intentId")==id&&value.get("started") is Boolean&&value.get("complete") is Boolean){"E2EE_RESTORE_CONTENT_INVALID"};E2eeKeys.technical(value.getString("backupId"));java.time.Instant.parse(value.getString("createdAt"));val source=value.getJSONObject("source");E2eeKeys.exact(source,setOf("binding","records","files"));val binding=source.getJSONObject("binding");E2eeKeys.exact(binding,setOf("scopeId","kind","resourceId"));E2eeKeys.technical(binding.getString("scopeId"));E2eeKeys.technical(binding.getString("resourceId"));check(binding.getString("kind") in setOf("project","space")&&source.getJSONArray("records").length() in 1..100000&&source.getJSONArray("files").length()<=600000&&value.getJSONArray("applied").length()<=100000){"E2EE_RESTORE_CONTENT_INVALID"};return JSONObject(value.toString())
        }
    }
}
