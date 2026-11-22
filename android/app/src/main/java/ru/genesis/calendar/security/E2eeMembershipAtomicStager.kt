package ru.genesis.calendar.security

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Account-scoped durable staging, matching MembershipAtomicStager. Every page
 * is persisted/read back before HTTP; retries retain their signed request.
 * No ACL/product application, rotation, key generation or receipt replay. */
internal class E2eeMembershipAtomicStager(private val device:UnlockedE2eeDevice,private val personal:E2eeScopeClient,
    private val transport:E2eeMembershipTransport,private val current:()->Unit){
    private val mutex=Mutex()
    private class Stored(val value:JSONObject,val serial:Long)
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun read(id:String):Stored? {
        current();val row=device.vault.read("outbox",id);if(row==null){current();return null}
        return try{current();Stored(E2eeFileManifestJson.readPrivateDocument(row.bytes),row.serial)}finally{row.bytes.fill(0)}
    }
    private fun save(id:String,value:JSONObject,expected:Long?):Long {
        current();val bytes=value.toString().toByteArray(Charsets.UTF_8)
        try{check(bytes.size<=6*1024*1024){"E2EE_MEMBERSHIP_PAGE_TOO_LARGE"};device.vault.write(listOf(UnlockedE2eeVault.Write("outbox",id,bytes,expected)),current)}finally{bytes.fill(0)}
        current();val serial=(expected?:0)+1;val back=read(id);check(back!=null&&back.serial==serial&&same(back.value,value)){"E2EE_MEMBERSHIP_LOCAL_WRITE_FAILED"};return serial
    }
    private fun load(intent:String):Stored {
        val row=read(E2eeMembershipAtomicContract.localId(device.ownerId,intent))?:error("E2EE_MEMBERSHIP_PLAN_REQUIRED")
        val state=E2eeMembershipAtomicContract.localState(row.value,device.ownerId);check(state.getJSONObject("plan").get("intentId")==intent){"E2EE_CORRUPT_OUTBOX"};return Stored(state,row.serial)
    }
    private fun request(action:String,input:JSONObject):JSONObject {
        val payload=E2eeMembershipAtomicContract.stagingPayload(action,input);val id=E2eeMembershipAtomicContract.requestId(device.ownerId,action,payload)
        var prior=read(id)
        if(prior==null){
            current();personal.refresh();current();val packet=personal.authorizeMembershipAtomic(action,payload);current()
            val value=JSONObject().put("format","genesis-membership-stage-request-v2").put("ownerId",device.ownerId).put("action",action).put("payload",payload).put("packet",packet)
            E2eeMembershipAtomicContract.localRequest(value,device.ownerId);check(packet.getJSONObject("command").get("deviceId")==device.deviceId){"E2EE_CORRUPT_OUTBOX"}
            save(id,value,null);prior=read(id)
        }
        check(prior?.serial==1L){"E2EE_CORRUPT_OUTBOX"};val value=E2eeMembershipAtomicContract.localRequest(prior?.value?:error("E2EE_MEMBERSHIP_LOCAL_WRITE_FAILED"),device.ownerId)
        check(value.get("action")==action&&same(value.getJSONObject("payload"),payload)&&value.getJSONObject("packet").getJSONObject("command").get("deviceId")==device.deviceId){"E2EE_CORRUPT_OUTBOX"}
        return JSONObject(value.getJSONObject("packet").toString())
    }
    private fun page(state:JSONObject,index:Int):JSONObject {
        val id=E2eeMembershipAtomicContract.pageId(device.ownerId,state.getJSONObject("plan").getString("intentId"),index)
        val row=read(id)?:error("E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED");check(row.serial==1L){"E2EE_CORRUPT_OUTBOX"}
        return E2eeMembershipAtomicContract.localPageMatches(state,row.value).getJSONObject("page")
    }
    private fun staging(intent:String,hash:String){val state=load(intent).value;check(state.get("planHash")==hash){"E2EE_IDEMPOTENCY_CONFLICT"};check(!state.getBoolean("cancelRequested")){"E2EE_MEMBERSHIP_CANCELLED"};check(state.getBoolean("ready")){"E2EE_MEMBERSHIP_LOCAL_PAGE_REQUIRED"}}
    suspend fun create(input:JSONObject,inputPages:JSONArray):String {
        current();val plan=E2eeMembershipAtomicContract.plan(input);val hash=E2eeMembershipAtomicContract.digest(plan);val intent=plan.getString("intentId");val refs=plan.getJSONArray("pages")
        check(plan.get("actorId")==device.ownerId&&inputPages.length()==refs.length()){"E2EE_MEMBERSHIP_ATOMIC_INVALID"}
        // Do not retain a caller-owned mutable JSON container across a suspend.
        val pages=JSONArray(inputPages.toString());for(at in 0 until pages.length())check(same(E2eeMembershipAtomicContract.pageRef(at,pages.getJSONObject(at)),refs.getJSONObject(at))){"E2EE_MEMBERSHIP_ATOMIC_INVALID"}
        return withContext(Dispatchers.IO){mutex.withLock{
        val id=E2eeMembershipAtomicContract.localId(device.ownerId,intent);val existing=read(id);var row:Stored
        if(existing!=null){row=load(intent);check(row.value.get("planHash")==hash){"E2EE_IDEMPOTENCY_CONFLICT"}}
        else{val state=JSONObject().put("format","genesis-membership-local-stage-v2").put("ownerId",device.ownerId).put("plan",plan).put("planHash",hash).put("ready",false).put("cancelRequested",false).put("cancelled",false);row=Stored(state,save(id,state,null))}
        check(!row.value.getBoolean("cancelRequested")){"E2EE_MEMBERSHIP_CANCELLED"}
        for(at in 0 until pages.length()){
            val key=E2eeMembershipAtomicContract.pageId(device.ownerId,intent,at);val value=JSONObject().put("format","genesis-membership-local-page-v2").put("ownerId",device.ownerId).put("intentId",intent).put("planHash",hash).put("index",at).put("page",pages.getJSONObject(at))
            val old=read(key);if(old!=null)check(old.serial==1L&&same(old.value,value)){"E2EE_IDEMPOTENCY_CONFLICT"}else save(key,value,null)
        }
        if(!row.value.getBoolean("ready"))save(id,JSONObject(row.value.toString()).put("ready",true),row.serial)
        intent
    }}}
    suspend fun stagePlan(intent:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        val state=load(intent).value;val hash=state.getString("planHash");staging(intent,hash);val plan=state.getJSONObject("plan");val refs=plan.getJSONArray("pages")
        for(at in 0 until refs.length())page(state,at)
        staging(intent,hash);val payload=JSONObject().put("intentId",intent).put("planHash",hash)
        val beginAuthorization=request("membership-atomic-begin",payload);staging(intent,hash)
        val begun=transport.membershipAtomicBegin(JSONObject().put("plan",plan).put("authorization",beginAuthorization));current()
        E2eeKeys.exact(begun,setOf("intentId","planHash","state"));check(begun.get("intentId")==intent&&begun.get("planHash")==hash){"E2EE_INVALID_RECEIPT"};check(begun.get("state")=="staged"){"E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED"}
        for(at in 0 until refs.length()){
            staging(intent,hash);val ref=refs.getJSONObject(at);val body=JSONObject().put("intentId",intent).put("planHash",hash).put("phase","plan").put("index",at)
            val authorization=request("membership-atomic-page",JSONObject(body.toString()).put("pageHash",ref.get("pageHash")));staging(intent,hash)
            val result=transport.membershipAtomicPage(body.put("page",page(state,at)).put("authorization",authorization));current()
            E2eeKeys.exact(result,setOf("intentId","planHash","phase","page"));check(result.get("intentId")==intent&&result.get("planHash")==hash&&result.get("phase")=="plan"&&same(result.getJSONObject("page"),ref)){"E2EE_INVALID_RECEIPT"}
        }
        staging(intent,hash);JSONObject().put("intentId",intent).put("planHash",hash).put("pages",refs.length())
    }}
    suspend fun cancel(intent:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        val loaded=load(intent);val state=loaded.value;val hash=state.getString("planHash");val payload=JSONObject().put("intentId",intent).put("planHash",hash)
        if(state.getBoolean("cancelled"))return@withLock payload.put("state","cancelled")
        if(!state.getBoolean("cancelRequested"))save(E2eeMembershipAtomicContract.localId(device.ownerId,intent),JSONObject(state.toString()).put("cancelRequested",true),loaded.serial)
        val result=transport.membershipAtomicCancel(JSONObject(payload.toString()).put("authorization",request("membership-atomic-cancel",payload)));current()
        check(result.get("intentId")==intent&&result.get("planHash")==hash){"E2EE_INVALID_RECEIPT"};check(result.get("state")=="cancelled"){"E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED"};E2eeKeys.exact(result,setOf("intentId","planHash","state"))
        val fresh=load(intent);save(E2eeMembershipAtomicContract.localId(device.ownerId,intent),JSONObject(fresh.value.toString()).put("cancelRequested",true).put("cancelled",true),fresh.serial)
        JSONObject(result.toString())
    }}
    suspend fun inspect(intent:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{JSONObject(load(intent).value.toString())}}
    override fun toString()="E2eeMembershipAtomicStager([redacted])"
}
