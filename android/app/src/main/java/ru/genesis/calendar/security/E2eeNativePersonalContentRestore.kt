package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Common typed restore semantics run in the isolated bundled engine. Native
 * owns local encryption, normal personal repository, current identity and IO. */
internal class E2eeNativePersonalContentRestore(context:Context,private val account:E2eeProductAccount,private val guard:()->Unit){
    private val runtime=NativeAdviceProductRuntime(context,"personal-restore");private val mutex=Mutex();private val prefix="personal-content-restore:"
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun document(id:String):E2eeDeviceDocument{E2eeKeys.technical(id);return E2eeDeviceDocument(account.device,prefix+id,{value->
        E2eeKeys.exact(value,setOf("format","ownerId","intentId","backupId","source","proposal","confirmed","started","complete"));check(value.get("format")=="genesis-personal-content-restore-v1"&&value.get("ownerId")==account.ownerId&&value.get("intentId")==id&&value.get("started") is Boolean&&value.get("complete") is Boolean){"E2EE_RESTORE_CONTENT_INVALID"};E2eeKeys.technical(value.getString("backupId"));val source=value.getJSONObject("source");E2eeKeys.exact(source,setOf("workspace","tasks"));check(!source.isNull("workspace")||!source.isNull("tasks")){"E2EE_RESTORE_CONTENT_INVALID"};JSONObject(value.toString())
    },::current)}
    suspend fun execute(action:String,args:JSONObject=JSONObject()):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        current();check(action in setOf("create","pending","inspect","preview","confirm","apply")){"E2EE_RESTORE_CONTENT_INVALID"};val product=E2eePersonalProduct(account)
        suspend fun call(method:String,input:JSONObject):Any{current();val result:Any=when(method){
            "load"->{E2eeKeys.exact(input,setOf("id"));document(input.getString("id")).load()?.let{JSONObject().put("value",it.value).put("serial",it.serial)}?:JSONObject.NULL}
            "save"->{E2eeKeys.exact(input,setOf("id","document","expected"));val expected=if(input.isNull("expected"))null else E2eeCommands.integer(input.get("expected"),1);document(input.getString("id")).save(input.getJSONObject("document"),expected).serial}
            "list"->{E2eeKeys.exact(input,emptySet());JSONArray(account.device.vault.listLocal("draft",prefix).map{it.removePrefix(prefix)})}
            "read"->{E2eeKeys.exact(input,emptySet());product.load(false);current();product.restoreView()}
            "apply"->{E2eeKeys.exact(input,setOf("snapshot","expectedContentRevision","alreadyStaged"));val revision=E2eeCommands.integer(input.get("expectedContentRevision"),1);check(product.contentRevision()==revision&&input.get("alreadyStaged") is Boolean){"E2EE_RESTORE_REVIEW_STALE"};val snapshot=input.getJSONObject("snapshot")
                if(input.getBoolean("alreadyStaged")){check(E2eeProductJson.same(product.snapshot(),snapshot)){"E2EE_RESTORE_OUTCOME_REQUIRED"};product.flush()}else product.restoreSnapshot(snapshot,revision);JSONObject().put("ok",true)}
            else->error("E2EE_RESTORE_CONTENT_INVALID")
        };current();return result}
        runtime.execute(JSONObject().put("protocol",1).put("mode","personal-restore-v1").put("ownerId",account.ownerId).put("action",action).put("args",JSONObject(args.toString())),::current,::call).also{current()}
    }}
}
