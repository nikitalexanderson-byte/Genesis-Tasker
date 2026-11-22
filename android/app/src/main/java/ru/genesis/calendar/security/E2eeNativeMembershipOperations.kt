package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.ui.NativeAdviceProductRuntime

/** Full ordinary input is persisted by the common state machine before any
 * graph/state request. The renderer gets content/technical references only;
 * native repositories retain pins, keys and the foreground account guard. */
internal class E2eeNativeMembershipOperations(private val context:Context,private val account:E2eeProductAccount,private val guard:()->Unit=account::requireOpen){
    private val runtime=NativeAdviceProductRuntime(context,"membership-drafts")
    private val mutex=Mutex()
    private val trust=E2eeSharedTrust(account)
    private val prefix="membership-operation:"
    private fun current(){guard();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun document(id:String):E2eeDeviceDocument{
        E2eeKeys.technical(id)
        return E2eeDeviceDocument(account.device,prefix+id,{value->
            E2eeKeys.exact(value,setOf("format","ownerId","intentId","operation","createdAt","proposal","review","started","history"))
            check(value.get("format")=="genesis-membership-operation-draft-v1"&&value.get("ownerId")==account.ownerId&&value.get("intentId")==id&&value.get("started") is Boolean&&value.getJSONArray("history").length()<=64){"E2EE_MEMBERSHIP_OPERATION_INVALID"}
            value.getJSONObject("operation");java.time.Instant.parse(value.getString("createdAt"));JSONObject(value.toString())
        },::current)
    }
    suspend fun execute(action:String,args:JSONObject=JSONObject()):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        current();check(action in setOf("create","inspect","pending","preview","confirm","start")){"E2EE_MEMBERSHIP_OPERATION_INVALID"}
        val records=mutableMapOf<String,E2eeSharedRecords>();val membership=account.membership()
        suspend fun call(method:String,input:JSONObject):Any{
            current();val result:Any=when(method){
                "load"->{E2eeKeys.exact(input,setOf("id"));document(input.getString("id")).load()?.let{JSONObject().put("value",it.value).put("serial",it.serial)}?:JSONObject.NULL}
                "save"->{E2eeKeys.exact(input,setOf("id","document","expected"));val id=input.getString("id");val expected=if(input.isNull("expected"))null else E2eeCommands.integer(input.get("expected"),1)
                    document(id).save(input.getJSONObject("document"),expected).serial}
                "list"->{E2eeKeys.exact(input,emptySet());JSONArray(account.device.vault.listLocal("draft",prefix).map{it.removePrefix(prefix)})}
                "bindings"->{E2eeKeys.exact(input,emptySet());val rows=trust.list();val result=JSONArray()
                    for(row in (0 until rows.length()).map{rows.getJSONObject(it)}.sortedBy{it.getString("scopeId")})result.put(JSONObject().put("scopeId",row.get("scopeId")).put("kind",row.get("kind")).put("resourceId",row.get("resourceId")))
                    result}
                "graph"->{E2eeKeys.exact(input,setOf("spaceId"));membership.graph(input.getString("spaceId"))}
                "state"->{E2eeKeys.exact(input,setOf("targets"));JSONObject().put("rows",membership.readState(input.getJSONArray("targets")))}
                "open"->{E2eeKeys.exact(input,setOf("kind","resourceId","scopeId"));val id=input.getString("scopeId");val kind=input.getString("kind");val resource=input.getString("resourceId");val opened=trust.open(id);current();val directory=opened.directory;val own=directory.devices[account.device.deviceId]
                    check(directory.scopeId==id&&directory.kind==kind&&directory.resourceId==resource&&own!=null&&!own.revoked&&own.userId==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
                    val repository=E2eeSharedRecords(context,account,id,kind,resource);records[id]=repository
                    JSONObject().put("scope",JSONObject().put("scopeId",id).put("ownerId",directory.ownerId).put("state",directory.state))
                        .put("generation",directory.generation).put("directoryRevision",directory.checkpoint.revision).put("checkpointHash",directory.checkpoint.hash).put("entities",repository.index())}
                "read"->{E2eeKeys.exact(input,setOf("scopeId","entity"));val repository=records[input.getString("scopeId")]?:error("E2EE_SHARED_SCOPE_UNLOCK_REQUIRED");repository.read(input.getJSONObject("entity"))}
                else->error("E2EE_MEMBERSHIP_OPERATION_INVALID")
            };current();return result
        }
        runtime.execute(JSONObject().put("protocol",1).put("mode","membership-drafts-v1").put("ownerId",account.ownerId).put("action",action).put("args",JSONObject(args.toString())),::current,::call).also{current()}
    }}
    override fun toString()="E2eeNativeMembershipOperations([redacted])"
}
