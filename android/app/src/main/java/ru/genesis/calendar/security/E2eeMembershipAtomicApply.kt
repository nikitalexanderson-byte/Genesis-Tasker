package ru.genesis.calendar.security

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject

/** Matching durable final-consent/apply coordinator. Identity and all private
 * storage/transport capabilities belong to this foreground account. */
internal class E2eeMembershipAtomicApply(private val account:E2eeProductAccount,private val transport:E2eeMembershipTransport,private val ports:Ports){
    interface Ports:E2eeMembershipAtomicProofs.ReadbackPorts {suspend fun acl(intentId:String)}
    companion object {
        const val PREFIX="membership-atomic-apply:"
        private fun invalid():Nothing=error("E2EE_CORRUPT_OUTBOX")
        fun localId(owner:String,intent:String)=PREFIX+E2eeMembershipAtomicContract.stem(owner,intent)
        fun requestId(owner:String,action:String,payload:JSONObject):String {E2eeKeys.technical(owner);return "membership-atomic-apply-request:"+E2eeMembershipAtomicContract.digest(JSONObject().put("ownerId",owner).put("action",action).put("payload",E2eeMembershipAtomicReceipts.payload(action,payload)))}
        fun reviewFingerprint(planHash:String,batchHash:String):String {E2eeEnvelope.decode(planHash,32);E2eeEnvelope.decode(batchHash,32);return E2eeMembershipAtomicContract.digest(JSONObject().put("format","genesis-membership-final-review-v2").put("planHash",planHash).put("batchHash",batchHash))}
        fun validate(input:JSONObject,owner:String):JSONObject {
            E2eeKeys.exact(input,setOf("format","ownerId","intentId","planHash","batchHash","reviewedFingerprint","started","receipt","complete"));E2eeKeys.technical(input.getString("intentId"))
            if(input.get("format")!="genesis-membership-local-apply-v2"||input.get("ownerId")!=owner||input.get("reviewedFingerprint")!=reviewFingerprint(input.getString("planHash"),input.getString("batchHash"))
                ||input.get("started") !is Boolean||input.get("complete") !is Boolean||!input.isNull("receipt")&&!input.getBoolean("started")||input.getBoolean("complete")&&input.isNull("receipt"))invalid()
            return JSONObject(input.toString())
        }
    }
    private class Stored(val value:JSONObject,val serial:Long)
    private class Original(val stage:JSONObject,val manifest:JSONObject)
    private class Loaded(val state:JSONObject,val serial:Long,val stage:JSONObject,val manifest:JSONObject)
    private val mutex=Mutex();private val stager=account.membershipAtomic()
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    private fun current(){ports.current();account.requireOpen();check(!account.offline){"E2EE_ONLINE_REQUIRED"}}
    private fun read(id:String):Stored? {
        current();val row=account.device.vault.read("outbox",id);if(row==null){current();return null}
        return try{current();Stored(E2eeFileManifestJson.readPrivateDocument(row.bytes),row.serial)}finally{row.bytes.fill(0)}
    }
    private fun save(id:String,value:JSONObject,expected:Long?):Long {
        current();val bytes=value.toString().toByteArray(Charsets.UTF_8)
        try{check(bytes.size<=6*1024*1024){"E2EE_MEMBERSHIP_PAGE_TOO_LARGE"};account.device.vault.write(listOf(UnlockedE2eeVault.Write("outbox",id,bytes,expected)),::current)}finally{bytes.fill(0)}
        current();val serial=(expected?:0)+1;val back=read(id);check(back!=null&&back.serial==serial&&same(back.value,value)){"E2EE_MEMBERSHIP_LOCAL_WRITE_FAILED"};return serial
    }
    private suspend fun originals(intent:String):Original {
        val state=stager.inspect(intent);val manifest=stager.readPacketManifest(intent);current();val plan=state.getJSONObject("plan")
        if(!state.getBoolean("ready")||!manifest.getBoolean("ready")||plan.get("actorId")!=account.ownerId||plan.get("intentId")!=intent||state.get("planHash")!=E2eeMembershipAtomicContract.digest(E2eeMembershipAtomicContract.plan(plan)))invalid()
        return Original(state,manifest)
    }
    private suspend fun load(intent:String):Loaded {
        val row=read(localId(account.ownerId,intent))?:error("E2EE_MEMBERSHIP_FINAL_REVIEW_REQUIRED");val state=validate(row.value,account.ownerId);val original=originals(intent)
        if(state.get("intentId")!=intent||state.get("planHash")!=original.stage.get("planHash")||state.get("batchHash")!=original.manifest.get("batchHash"))invalid()
        if(!state.isNull("receipt"))E2eeMembershipAtomicReceipts.header(state.getJSONObject("receipt"),original.stage.getJSONObject("plan"),original.manifest.getJSONArray("pages"))
        return Loaded(state,row.serial,original.stage,original.manifest)
    }
    private suspend fun describeLocked(intent:String):JSONObject {
        val original=originals(intent);val state=original.stage;val manifest=original.manifest;val plan=state.getJSONObject("plan");check(!state.getBoolean("cancelRequested")){"E2EE_MEMBERSHIP_CANCELLED"}
        val binding=E2eeMembershipAtomicContract.PacketBindings(plan);val anchors=mutableMapOf<String,JSONObject>()
        for(index in 0 until plan.getJSONArray("pages").length()){
            val page=stager.readPlanPage(intent,index);binding.planPage(page);if(page.get("kind")=="anchors"){val rows=page.getJSONArray("items");for(at in 0 until rows.length()){val row=rows.getJSONObject(at);anchors[row.getString("scopeId")]=row}}
        }
        for(index in 0 until manifest.getJSONArray("pages").length()){
            val page=stager.readPacketPage(intent,index);if(page.get("kind") !in setOf("rotation-packets","product-packets"))invalid();val packets=page.getJSONArray("items")
            for(at in 0 until packets.length()){val packet=packets.getJSONObject(at);val anchor=anchors[packet.getJSONObject("command").getString("scopeId")]?:invalid();E2eeMembershipAtomicProofs.verify(plan,anchor,packet,ports.peers);current()};binding.packetPage(page)
        };binding.complete()
        return JSONObject().put("plan",JSONObject(plan.toString())).put("manifest",JSONObject(manifest.toString())).put("fingerprint",reviewFingerprint(state.getString("planHash"),manifest.getString("batchHash")))
    }
    suspend fun describe(intent:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{describeLocked(intent)}}
    suspend fun confirm(intent:String,comparedFingerprint:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        val view=describeLocked(intent);check(view.get("fingerprint")==comparedFingerprint){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"};val id=localId(account.ownerId,intent);val old=read(id)
        if(old!=null){val loaded=load(intent);if(loaded.state.get("reviewedFingerprint")!=comparedFingerprint)invalid();return@withLock JSONObject(loaded.state.toString())}
        val state=JSONObject().put("format","genesis-membership-local-apply-v2").put("ownerId",account.ownerId).put("intentId",intent).put("planHash",E2eeMembershipAtomicContract.digest(view.getJSONObject("plan")))
            .put("batchHash",view.getJSONObject("manifest").get("batchHash")).put("reviewedFingerprint",comparedFingerprint).put("started",false).put("receipt",JSONObject.NULL).put("complete",false)
        save(id,state,null);JSONObject(state.toString())
    }}
    private fun checkedPacket(packet:JSONObject,action:String,payload:JSONObject){
        E2eeKeys.exact(packet,setOf("command","signature"));val command=packet.getJSONObject("command");E2eeCommands.commandBytes(command).fill(0);E2eeEnvelope.decode(packet.getString("signature"),64)
        if(command.get("ownerId")!=account.ownerId||command.get("deviceId")!=account.device.deviceId||command.get("action")!=action||!same(command.getJSONObject("payload"),payload))invalid()
    }
    private fun request(action:String,input:JSONObject):JSONObject {
        val payload=E2eeMembershipAtomicReceipts.payload(action,input);val id=requestId(account.ownerId,action,payload);var saved=read(id)
        if(saved==null){current();account.client.refresh();current();val packet=account.client.authorizeMembershipAtomicApply(action,payload);current();checkedPacket(packet,action,payload)
            save(id,JSONObject().put("format","genesis-membership-apply-request-v2").put("ownerId",account.ownerId).put("action",action).put("payload",payload).put("packet",packet),null);saved=read(id)}
        if(saved==null||saved.serial!=1L)invalid();val value=saved.value;E2eeKeys.exact(value,setOf("format","ownerId","action","payload","packet"))
        if(value.get("format")!="genesis-membership-apply-request-v2"||value.get("ownerId")!=account.ownerId||value.get("action")!=action||!same(value.getJSONObject("payload"),payload))invalid();val packet=value.getJSONObject("packet");checkedPacket(packet,action,payload);return JSONObject(packet.toString())
    }
    private fun receiptPage(state:JSONObject,index:Int):JSONObject {
        val header=state.getJSONObject("receipt");val refs=header.getJSONArray("pages");if(index !in 0 until refs.length())invalid();val intent=state.getString("intentId");val id="membership-atomic-receipt-page:"+E2eeMembershipAtomicContract.stem(account.ownerId,intent)+":"+index
        var row=read(id)
        if(row==null){
            val payload=JSONObject().put("intentId",intent).put("planHash",state.get("planHash")).put("batchHash",state.get("batchHash")).put("index",index);val authorization=request("membership-atomic-receipt-page",payload)
            val response=transport.membershipAtomicReceiptPage(JSONObject(payload.toString()).put("authorization",authorization));current();E2eeKeys.exact(response,setOf("intentId","planHash","batchHash","index","page"))
            if(listOf("intentId","planHash","batchHash").any{response.get(it)!=state.get(it)}||E2eeCommands.integer(response.get("index"))!=index.toLong())error("E2EE_INVALID_RECEIPT")
            val page=E2eeMembershipAtomicReceipts.page(response.getJSONObject("page"));if(!same(E2eeMembershipAtomicReceipts.ref(index,page),refs.getJSONObject(index)))error("E2EE_INVALID_RECEIPT")
            save(id,JSONObject().put("format","genesis-membership-local-receipt-page-v2").put("ownerId",account.ownerId).put("intentId",intent).put("planHash",state.get("planHash")).put("batchHash",state.get("batchHash")).put("index",index).put("page",page),null);row=read(id)
        }
        if(row==null||row.serial!=1L)invalid();val value=row.value;E2eeKeys.exact(value,setOf("format","ownerId","intentId","planHash","batchHash","index","page"))
        if(value.get("format")!="genesis-membership-local-receipt-page-v2"||value.get("ownerId")!=account.ownerId||listOf("intentId","planHash","batchHash").any{value.get(it)!=state.get(it)}||E2eeCommands.integer(value.get("index"))!=index.toLong()||!same(E2eeMembershipAtomicReceipts.ref(index,value.getJSONObject("page")),refs.getJSONObject(index)))invalid()
        return JSONObject(value.getJSONObject("page").toString())
    }
    private suspend fun verify(intent:String):JSONObject {
        val loaded=load(intent);val state=loaded.state;if(state.isNull("receipt"))error("E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED")
        if(state.getBoolean("complete")){
            for(index in 0 until loaded.stage.getJSONObject("plan").getJSONArray("pages").length())stager.readPlanPage(intent,index)
            for(index in 0 until loaded.manifest.getJSONArray("pages").length())stager.readPacketPage(intent,index)
            for(index in 0 until state.getJSONObject("receipt").getJSONArray("pages").length())receiptPage(state,index)
            return JSONObject(state.getJSONObject("receipt").toString())
        }
        check(!loaded.stage.getBoolean("cancelled")){"E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED"};val plan=loaded.stage.getJSONObject("plan");val receipt=state.getJSONObject("receipt")
        val guarded=object:E2eeMembershipAtomicProofs.ReadbackPorts{
            override val peers=ports.peers
            override fun current()=this@E2eeMembershipAtomicApply.current()
            override fun scope(packet:JSONObject,receipt:JSONObject){current();ports.scope(packet,receipt);current()}
            override fun product(packet:JSONObject,receipt:JSONObject){current();ports.product(packet,receipt);current()}
        }
        val verifier=E2eeMembershipAtomicProofs.ReceiptVerifier(plan,loaded.manifest.getJSONArray("pages"),receipt,guarded)
        for(index in 0 until plan.getJSONArray("pages").length())verifier.planPage(index,stager.readPlanPage(intent,index))
        for(index in 0 until loaded.manifest.getJSONArray("pages").length())verifier.packetPage(index,stager.readPacketPage(intent,index));verifier.seal()
        for(index in 0 until receipt.getJSONArray("pages").length())verifier.consume(index,receiptPage(state,index));val verified=verifier.finish();current();ports.acl(intent);current()
        val fresh=load(intent);if(!same(fresh.state.getJSONObject("receipt"),verified))invalid();save(localId(account.ownerId,intent),JSONObject(fresh.state.toString()).put("complete",true),fresh.serial);return verified
    }
    private suspend fun storeReceipt(intent:String,input:JSONObject):JSONObject {
        val loaded=load(intent);val receipt=E2eeMembershipAtomicReceipts.header(input,loaded.stage.getJSONObject("plan"),loaded.manifest.getJSONArray("pages"))
        if(!loaded.state.isNull("receipt")&&!same(loaded.state.getJSONObject("receipt"),receipt))error("E2EE_INVALID_RECEIPT")
        if(loaded.state.isNull("receipt"))save(localId(account.ownerId,intent),JSONObject(loaded.state.toString()).put("started",true).put("receipt",receipt),loaded.serial)
        return verify(intent)
    }
    private suspend fun reconcileLocked(intent:String):JSONObject {
        val loaded=load(intent);if(!loaded.state.isNull("receipt"))return verify(intent)
        val payload=JSONObject().put("intentId",intent).put("planHash",loaded.state.get("planHash")).put("batchHash",loaded.state.get("batchHash"));val authorization=request("membership-atomic-receipt",payload)
        val receipt=transport.membershipAtomicReceipt(JSONObject(payload.toString()).put("authorization",authorization));current();return storeReceipt(intent,receipt)
    }
    suspend fun submit(intent:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{
        var loaded=load(intent);if(!loaded.state.isNull("receipt"))return@withLock verify(intent);if(loaded.stage.getBoolean("cancelRequested"))return@withLock reconcileLocked(intent)
        if(!loaded.state.getBoolean("started")){save(localId(account.ownerId,intent),JSONObject(loaded.state.toString()).put("started",true),loaded.serial);loaded=load(intent)}
        val payload=JSONObject().put("intentId",intent).put("planHash",loaded.state.get("planHash")).put("batchHash",loaded.state.get("batchHash"))
        // A saved final request can have succeeded already. Never try to stage
        // its now immutable committed plan again before exact idempotent retry.
        if(read(requestId(account.ownerId,"membership-atomic-commit",payload))==null){stager.stagePackets(intent);current()}
        val authorization=request("membership-atomic-commit",payload);val fresh=stager.inspect(intent);current();if(fresh.getBoolean("cancelRequested"))return@withLock reconcileLocked(intent)
        val receipt=transport.membershipAtomicCommit(JSONObject(payload.toString()).put("authorization",authorization));current();storeReceipt(intent,receipt)
    }}
    suspend fun reconcile(intent:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{reconcileLocked(intent)}}
    suspend fun inspect(intent:String):JSONObject=withContext(Dispatchers.IO){mutex.withLock{JSONObject(load(intent).state.toString())}}
    suspend fun pending():JSONArray=withContext(Dispatchers.IO){mutex.withLock{
        current();val ids=account.device.vault.listLocal("outbox",PREFIX);current();val values=JSONArray()
        for(id in ids){val row=read(id)?:invalid();val state=validate(row.value,account.ownerId);val intent=state.getString("intentId");if(id!=localId(account.ownerId,intent))invalid();values.put(JSONObject(load(intent).state.toString()))};values
    }}
    override fun toString()="E2eeMembershipAtomicApply([redacted])"
}
