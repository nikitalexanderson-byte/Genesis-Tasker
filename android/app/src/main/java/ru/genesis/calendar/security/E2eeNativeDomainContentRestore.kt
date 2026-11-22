package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.AuthController
import ru.genesis.calendar.auth.CloudAccountSnapshot
import ru.genesis.calendar.auth.FeatureAccess
import ru.genesis.calendar.data.NativePrivateDiary
import ru.genesis.calendar.data.NativePrivateMindmaps
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

internal class E2eeNativeDomainContentRestore(private val context:Context,private val account:E2eeProductAccount,private val guard:()->Unit){
    private val runtime=NativeAdviceProductRuntime(context,"personal-restore");private val mutex=Mutex();private val prefix="domain-content-restore:"
    private val scope=CloudAccountSnapshot.scopeFor(account.ownerId)
    private val diary=NativePrivateDiary(scope,account.ownerId,account);private val maps=NativePrivateMindmaps(scope,account.ownerId,account)
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun document(id:String)=E2eeDeviceDocument(account.device,prefix+E2eeKeys.technical(id),{value->
        E2eeKeys.exact(value,setOf("format","ownerId","intentId","backupId","source","proposal","confirmed","started","complete","applied"));check(value.get("format")=="genesis-domain-content-restore-v1"&&value.get("ownerId")==account.ownerId&&value.get("intentId")==id&&value.get("started") is Boolean&&value.get("complete") is Boolean){"E2EE_RESTORE_CONTENT_INVALID"};E2eeKeys.technical(value.getString("backupId"));val source=value.getJSONObject("source");E2eeKeys.exact(source,setOf("domain","records"));check(source.getString("domain") in setOf("diary","mindmap")&&source.getJSONArray("records").length() in 1..10000&&value.getJSONArray("applied").length()<=10000){"E2EE_RESTORE_CONTENT_INVALID"};JSONObject(value.toString())
    },::current)
    private fun access():FeatureAccess{current();val state=AuthController.get(context).state.value;check(state.user?.uid==account.ownerId){"E2EE_ACCOUNT_CHANGED"};return state.accountSettings?.featureAccess?:FeatureAccess.unverifiedAccount()}
    suspend fun execute(action:String,args:JSONObject=JSONObject()):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        current();check(action in setOf("create","pending","inspect","preview","confirm","apply")){"E2EE_RESTORE_CONTENT_INVALID"}
        suspend fun call(method:String,input:JSONObject):Any{current();val result:Any=when(method){
            "load"->{E2eeKeys.exact(input,setOf("id"));document(input.getString("id")).load()?.let{JSONObject().put("value",it.value).put("serial",it.serial)}?:JSONObject.NULL}
            "save"->{E2eeKeys.exact(input,setOf("id","document","expected"));document(input.getString("id")).save(input.getJSONObject("document"),if(input.isNull("expected"))null else E2eeCommands.integer(input.get("expected"),1)).serial}
            "list"->{E2eeKeys.exact(input,emptySet());JSONArray(account.device.vault.listLocal("draft",prefix).map{it.removePrefix(prefix)})}
            "read","flush"->{E2eeKeys.exact(input,setOf("domain"));when(input.getString("domain")){"diary"->diary.restoreView();"mindmap"->maps.restoreView();else->error("E2EE_RESTORE_DOMAIN_REQUIRED")}}
            "add"->{E2eeKeys.exact(input,setOf("domain","record"));when(input.getString("domain")){"diary"->diary.restoreAdd(input.getJSONObject("record"),access());"mindmap"->maps.restoreAdd(input.getJSONObject("record"),access());else->error("E2EE_RESTORE_DOMAIN_REQUIRED")};JSONObject().put("ok",true)}
            else->error("E2EE_RESTORE_CONTENT_INVALID")
        };current();return result}
        runtime.execute(JSONObject().put("protocol",1).put("mode","domain-restore-v1").put("ownerId",account.ownerId).put("action",action).put("args",JSONObject(args.toString())),::current,::call).also{current()}
    }}
}
