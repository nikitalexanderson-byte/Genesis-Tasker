package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

internal object E2eeMembershipAtomicProofs {
    private fun invalid():Nothing=error("E2EE_INVALID_RECEIPT")
    private fun number(value:Any,min:Long=0)=E2eeCommands.integer(value,min)
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun strings(value:JSONArray)=(0 until value.length()).map{value.getString(it)}
    private fun same(a:Any,b:Any)=E2eeProductJson.same(a,b)
    fun verify(plan:JSONObject,rawAnchor:JSONObject,raw:JSONObject,ports:E2eeMembershipPeerPorts,confirmed:Boolean=false):JSONObject {
        ports.current();val anchor=E2eeMembershipAtomicContract.checkedAnchor(rawAnchor);val scope=anchor.getString("scopeId");val revision=number(anchor.get("directoryRevision"),1)
        // The caller obtains this anchor from a hash-checked plan page.
        val kind=if(raw.getJSONObject("command").get("action")=="rotate-membership")"rotation-packets"else"product-packets"
        val packet=E2eeMembershipAtomicContract.page(JSONObject().put("kind",kind).put("items",JSONArray().put(raw))).getJSONArray("items").getJSONObject(0);val command=packet.getJSONObject("command")
        if(scope !in strings(plan.getJSONArray("scopeIds"))||command.get("scopeId")!=scope||command.get("ownerId")!=anchor.get("ownerId")||number(command.get("expectedRevision"))!=revision
            ||command.get("checkpointHash")!=anchor.get("checkpointHash")||command.getJSONObject("payload").get("membershipHash")!=E2eeMembershipAtomicContract.changeHash(plan))invalid()
        val target=E2eeDeviceAccessContract.target(ports.target(scope));ports.current();if(listOf("scopeId","ownerId","kind","resourceId").any{target.get(it)!=anchor.get(it)})invalid()
        val previous=ports.checkpoint(scope);ports.current();val response=ports.directory(scope);ports.current();val events=response.getJSONArray("events");val frames=mutableMapOf<Long,E2eeDirectory.Verified>()
        val directory=E2eeDirectory.verify(anchor.getString("ownerId"),scope,target.getJSONObject("authority"),events,previous){if(it.checkpoint.revision==revision)frames[revision]=it};ports.current();val frame=frames[revision]?:invalid()
        if(frame.checkpoint.hash!=anchor.get("checkpointHash")||frame.ownerId!=anchor.get("ownerId")||frame.kind!=anchor.get("kind")||frame.resourceId!=anchor.get("resourceId")||frame.generation!=number(anchor.get("generation"),1)||frame.securityEpoch!=number(command.get("securityEpoch"),1))invalid()
        val signer=frame.devices[command.getString("deviceId")]?:invalid();if(signer.revoked||signer.role !in setOf("owner","writer")||kind=="rotation-packets"&&(signer.role!="owner"||signer.userId!=anchor.get("ownerId")))invalid()
        E2eeCommands.verify(packet,E2eeDirectory.signingKey(signer.signingKey));ports.current();val hash=E2eeCommands.hash(command);val next=if(revision<events.length())events.getJSONObject(revision.toInt())else null
        if(kind=="rotation-packets"){
            if(next!=null){if(E2eeCommands.hash(next.getJSONObject("command"))!=hash)error("E2EE_MEMBERSHIP_STALE")}
            else{if(confirmed||directory.checkpoint.revision!=revision)error("E2EE_MEMBERSHIP_STALE");E2eeDirectory.verify(anchor.getString("ownerId"),scope,target.getJSONObject("authority"),JSONArray(events.toString()).put(packet),directory.checkpoint);ports.current()}
        }else{
            val payload=command.getJSONObject("payload");E2eeKeys.exact(payload,setOf("intentId","membershipHash","operations"));val operations=rows(payload.getJSONArray("operations"));if(operations.size !in 1..100)invalid()
            for(operation in operations)if(E2eeProductContract.operation(operation).get("action")=="propose-complete")invalid()
            if(confirmed&&(next==null||next.getJSONObject("command").get("action")!="rotate-membership"||next.getJSONObject("command").getJSONObject("payload").get("membershipHash")!=payload.get("membershipHash")))invalid()
        }
        ports.remember(target,events);ports.current();return JSONObject().put("actorId",signer.userId).put("deviceId",signer.deviceId).put("commandHash",hash)
    }
    interface ReadbackPorts {
        val peers:E2eeMembershipPeerPorts
        fun current()
        /** Implementations must read verified normal repositories. */
        fun scope(packet:JSONObject,receipt:JSONObject)
        fun product(packet:JSONObject,receipt:JSONObject)
    }
    /** Complete signed proof + all ordinary repository readbacks. No signer,
     * network mutation, key forwarding or optimistic acknowledgement exists. */
    class ReceiptVerifier(rawPlan:JSONObject,rawPacketRefs:JSONArray,rawHeader:JSONObject,private val ports:ReadbackPorts){
        private val plan=E2eeMembershipAtomicContract.plan(rawPlan);private val packetRefs=E2eeMembershipAtomicContract.refs(rawPacketRefs,true)
        private val header=E2eeMembershipAtomicReceipts.header(rawHeader,plan,packetRefs);private val binding=E2eeMembershipAtomicContract.PacketBindings(plan)
        private val anchors=mutableMapOf<String,JSONObject>();private val planPages=mutableSetOf<Int>();private val packetPages=mutableSetOf<Int>();private val pages=mutableMapOf<Int,String>()
        private class Rotation(val packet:JSONObject,val hash:String)
        private class Product(val packet:JSONObject,val actor:String)
        private val rotations=mutableMapOf<String,Rotation>();private val products=mutableMapOf<String,Product>();private val scopes=mutableSetOf<String>();private val readProducts=mutableSetOf<String>();private var ready=false
        @Synchronized fun planPage(index:Int,input:JSONObject){
            ports.current();if(ready||packetPages.isNotEmpty()||index in planPages)invalid();val page=E2eeMembershipAtomicContract.page(input);val refs=plan.getJSONArray("pages")
            if(index !in 0 until refs.length()||!same(E2eeMembershipAtomicContract.pageRef(index,page),refs.getJSONObject(index)))invalid();binding.planPage(page)
            if(page.get("kind")=="anchors")for(anchor in rows(page.getJSONArray("items")))if(anchors.put(anchor.getString("scopeId"),anchor)!=null)invalid();planPages.add(index)
        }
        @Synchronized fun packetPage(index:Int,input:JSONObject){
            ports.current();val page=E2eeMembershipAtomicContract.page(input)
            if(ready||planPages.size!=plan.getJSONArray("pages").length()||index in packetPages||index !in 0 until packetRefs.length()||!same(E2eeMembershipAtomicContract.pageRef(index,page),packetRefs.getJSONObject(index))||page.get("kind") !in setOf("rotation-packets","product-packets"))invalid()
            val packets=rows(page.getJSONArray("items"));val verified=packets.map{packet->val anchor=anchors[packet.getJSONObject("command").getString("scopeId")]?:invalid();verify(plan,anchor,packet,ports.peers,true).also{ports.current()}}
            binding.packetPage(page)
            for((at,packet)in packets.withIndex()){
                val command=packet.getJSONObject("command");val scope=command.getString("scopeId")
                if(page.get("kind")=="rotation-packets")rotations[scope]=Rotation(packet,verified[at].getString("commandHash"))
                else products[scope+"\u0000"+command.getJSONObject("payload").getString("intentId")]=Product(packet,verified[at].getString("actorId"))
            };packetPages.add(index)
        }
        @Synchronized fun seal(){ports.current();if(planPages.size!=plan.getJSONArray("pages").length()||packetPages.size!=packetRefs.length())invalid();binding.complete();ready=true}
        @Synchronized fun consume(index:Int,input:JSONObject){
            ports.current();if(!ready)invalid();val page=E2eeMembershipAtomicReceipts.page(input);val ref=E2eeMembershipAtomicReceipts.ref(index,page);val refs=header.getJSONArray("pages")
            if(index !in 0 until refs.length()||!same(ref,refs.getJSONObject(index)))invalid();pages[index]?.let{if(it!=ref.get("pageHash"))invalid();return};val items=rows(page.getJSONArray("items"))
            if(page.get("kind")=="scopes"){
                for(row in items){val scope=row.getString("scopeId");val stored=rotations[scope]?:invalid();if(scope in scopes)invalid();val command=stored.packet.getJSONObject("command");val payload=command.getJSONObject("payload");val result=row.getJSONObject("result")
                    val bytes=(command.getString("checkpointHash")+"\u0000"+stored.hash).toByteArray(Charsets.UTF_8);val checkpoint=try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}
                    if(row.get("ownerId")!=command.get("ownerId")||number(result.get("directoryRevision"),1)!=number(command.get("expectedRevision"))+1||result.get("checkpointHash")!=checkpoint
                        ||number(result.get("cryptoEpoch"),1)!=number(payload.get("cryptoEpoch"),1)||number(result.get("securityEpoch"),1)!=number(payload.get("securityEpoch"),1)||result.get("signInRequired")!=(payload.getJSONArray("revokedDeviceIds").length()>0))invalid()
                }
                for(row in items){ports.scope(JSONObject(rotations[row.getString("scopeId")]!!.packet.toString()),JSONObject(row.toString()));ports.current()};for(row in items)scopes.add(row.getString("scopeId"))
            }else{
                for(row in items){val key=row.getString("scopeId")+"\u0000"+row.getString("intentId");val stored=products[key]?:invalid();if(stored.actor!=row.get("actorId")||key in readProducts)invalid()
                    val operations=rows(stored.packet.getJSONObject("command").getJSONObject("payload").getJSONArray("operations"));val results=rows(row.getJSONObject("result").getJSONArray("results"));if(results.size!=operations.size)invalid()
                    for(operation in operations){val result=results.singleOrNull{it.get("entityId")==operation.get("entityId")}?:invalid();if(number(result.get("revision"),1)!=number(operation.get("expectedRevision"))+1||result.get("payloadHash")!=operation.get("payloadHash"))invalid()}
                }
                for(row in items){ports.product(JSONObject(products[row.getString("scopeId")+"\u0000"+row.getString("intentId")]!!.packet.toString()),JSONObject(row.toString()));ports.current()};for(row in items)readProducts.add(row.getString("scopeId")+"\u0000"+row.getString("intentId"))
            };pages[index]=ref.getString("pageHash")
        }
        @Synchronized fun finish():JSONObject {ports.current();if(!ready||pages.size!=header.getJSONArray("pages").length()||scopes.sorted()!=strings(plan.getJSONArray("scopeIds"))||readProducts.size!=products.size)invalid();return JSONObject(header.toString())}
        override fun toString()="E2eeMembershipAtomicReceiptVerifier([redacted])"
    }
}
