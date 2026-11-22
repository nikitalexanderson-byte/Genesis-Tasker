package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

/** Matching technical codec for membership-atomic-contract/local.ts. This
 * validates inert originals; it neither trusts a directory nor executes them. */
internal object E2eeMembershipAtomicContract {
    val actions=setOf("membership-atomic-begin","membership-atomic-page","membership-atomic-status","membership-atomic-cancel")
    private val planKinds=setOf("acl","anchors","clear-assignments","revoke-invitations","role-events","product-operations")
    private val packetKinds=setOf("rotation-packets","product-packets")
    private fun invalid():Nothing=error("E2EE_MEMBERSHIP_ATOMIC_INVALID")
    private fun rows(value:JSONArray)=(0 until value.length()).map{value.getJSONObject(it)}
    private fun number(value:Any,min:Long=0,max:Long=9007199254740990L)=E2eeCommands.integer(value,min).also{if(it>max)invalid()}
    fun digest(value:Any):String {val bytes=E2eeCommands.canonical(value);return try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}}
    fun stagingPayload(action:String,input:JSONObject):JSONObject {
        if(action !in actions)invalid();val extra=when(action){"membership-atomic-page"->setOf("phase","index","pageHash");"membership-atomic-status"->setOf("phase","after");else->emptySet()}
        E2eeKeys.exact(input,setOf("intentId","planHash")+extra);E2eeKeys.technical(input.getString("intentId"));E2eeEnvelope.decode(input.getString("planHash"),32)
        if(action in setOf("membership-atomic-page","membership-atomic-status")&&input.get("phase") !in setOf("plan","packets"))invalid()
        if(action=="membership-atomic-page"){number(input.get("index"),0,9999);E2eeEnvelope.decode(input.getString("pageHash"),32)}
        if(action=="membership-atomic-status")number(input.get("after"),0,10000)
        return JSONObject(input.toString())
    }
    private fun anchor(value:JSONObject){
        E2eeKeys.exact(value,setOf("scopeId","ownerId","kind","resourceId","generation","directoryRevision","checkpointHash","entityId","revision","payloadHash"))
        for(key in listOf("scopeId","ownerId","resourceId","entityId"))E2eeKeys.technical(value.getString(key))
        if(value.get("kind") !in setOf("space","project")||value.get("entityId")!=value.getString("kind")+":"+value.getString("resourceId"))invalid()
        for(key in listOf("generation","directoryRevision","revision"))number(value.get(key),1)
        E2eeEnvelope.decode(value.getString("checkpointHash"),32);E2eeEnvelope.decode(value.getString("payloadHash"),32)
    }
    private fun pageProjection(input:JSONObject)=JSONObject().put("format","genesis-membership-page-v2").put("kind",input.get("kind"))
        .put("items",if(input.get("kind")=="acl")E2eeMembershipContract.projection(input.getJSONArray("items"))else input.getJSONArray("items"))
    fun page(input:JSONObject):JSONObject {
        E2eeKeys.exact(input,setOf("kind","items"));val kind=input.getString("kind");val items=input.getJSONArray("items")
        if(kind !in planKinds+packetKinds||items.length() !in 1..200)invalid();val seen=mutableSetOf<String>()
        fun unique(value:String){if(!seen.add(value))invalid()}
        if(kind=="acl")E2eeMembershipContract.changes(items)else for(row in rows(items))when(kind){
            "anchors"->{anchor(row);unique(row.getString("scopeId"))}
            "clear-assignments"->{E2eeKeys.exact(row,setOf("projectId","userId"));for(key in listOf("projectId","userId"))E2eeKeys.technical(row.getString(key));unique(row.getString("projectId")+"\u0000"+row.getString("userId"))}
            "revoke-invitations"->{E2eeKeys.exact(row,setOf("kind","resourceId","userId"));if(row.get("kind") !in setOf("space","project"))invalid();for(key in listOf("resourceId","userId"))E2eeKeys.technical(row.getString(key));unique(row.getString("kind")+"\u0000"+row.getString("resourceId")+"\u0000"+row.getString("userId"))}
            "role-events"->{E2eeKeys.exact(row,setOf("projectId","userId","from","to"));for(key in listOf("projectId","userId"))E2eeKeys.technical(row.getString(key));for(key in listOf("from","to"))if(!row.isNull(key)&&row.get(key) !in setOf("manager","member","commenter","viewer"))invalid();unique(row.getString("projectId")+"\u0000"+row.getString("userId"))}
            "product-operations"->{E2eeKeys.exact(row,setOf("scopeId","intentId","operations"));for(key in listOf("scopeId","intentId"))E2eeKeys.technical(row.getString(key));unique(row.getString("scopeId")+"\u0000"+row.getString("intentId"));val operations=rows(row.getJSONArray("operations"));val ids=mutableSetOf<String>();if(operations.size !in 1..100)invalid();for(raw in operations){val operation=E2eeProductContract.operation(raw);if(!ids.add(operation.getString("entityId"))||operation.get("action")=="propose-complete")invalid()}}
            "rotation-packets","product-packets"->{E2eeKeys.exact(row,setOf("command","signature"));val command=row.getJSONObject("command");E2eeCommands.commandBytes(command).fill(0);E2eeEnvelope.decode(row.getString("signature"),64);if(command.get("action")!=(if(kind=="rotation-packets")"rotate-membership"else"product-commit-bound"))invalid();unique(command.getString("scopeId")+"\u0000"+command.getString("operationId"))}
            else->invalid()
        }
        val bytes=E2eeCommands.canonical(pageProjection(input));try{check(bytes.size<=512*1024){"E2EE_MEMBERSHIP_PAGE_TOO_LARGE"}}finally{bytes.fill(0)}
        return JSONObject(input.toString())
    }
    fun pageRef(index:Int,input:JSONObject):JSONObject {number(index);val value=page(input);return JSONObject().put("index",index).put("kind",value.get("kind")).put("count",value.getJSONArray("items").length()).put("pageHash",digest(pageProjection(value)))}
    fun refs(input:JSONArray,packets:Boolean):JSONArray {
        if(input.length()>10000||!packets&&input.length()<1)invalid();val kinds=if(packets)packetKinds else planKinds
        for((index,row)in rows(input).withIndex()){
            E2eeKeys.exact(row,setOf("index","kind","count","pageHash"));if(number(row.get("index"))!=index.toLong()||row.get("kind") !in kinds)invalid();number(row.get("count"),1,200);E2eeEnvelope.decode(row.getString("pageHash"),32)
        };return JSONArray(input.toString())
    }
    fun plan(input:JSONObject):JSONObject {
        E2eeKeys.exact(input,setOf("format","actorId","intentId","spaceId","reviewFingerprint","scopeIds","pages"));if(input.get("format")!="genesis-membership-atomic-plan-v2")invalid()
        for(key in listOf("actorId","intentId","spaceId"))E2eeKeys.technical(input.getString(key));E2eeEnvelope.decode(input.getString("reviewFingerprint"),32)
        val ids=input.getJSONArray("scopeIds");if(ids.length() !in 1..5001)invalid();val values=(0 until ids.length()).map{E2eeKeys.technical(ids.getString(it))};if(values!=values.toSet().sorted())invalid();refs(input.getJSONArray("pages"),false)
        return JSONObject(input.toString())
    }
    fun stem(owner:String,intent:String):String {E2eeKeys.technical(owner);E2eeKeys.technical(intent);return digest(JSONObject().put("format","genesis-membership-local-key-v2").put("ownerId",owner).put("intentId",intent))}
    fun localId(owner:String,intent:String)="membership-atomic-v2:"+stem(owner,intent)
    fun pageId(owner:String,intent:String,index:Int):String {number(index,0,9999);return "membership-atomic-page:"+stem(owner,intent)+":"+index}
    fun requestId(owner:String,action:String,payload:JSONObject):String {E2eeKeys.technical(owner);return "membership-atomic-request:"+digest(JSONObject().put("ownerId",owner).put("action",action).put("payload",stagingPayload(action,payload)))}
    fun localState(input:JSONObject,owner:String):JSONObject {
        E2eeKeys.exact(input,setOf("format","ownerId","plan","planHash","ready","cancelRequested","cancelled"));val plan=plan(input.getJSONObject("plan"))
        if(input.get("format")!="genesis-membership-local-stage-v2"||input.get("ownerId")!=owner||plan.get("actorId")!=owner||digest(plan)!=input.get("planHash")
            ||listOf("ready","cancelRequested","cancelled").any{input.get(it) !is Boolean}||input.getBoolean("cancelled")&&!input.getBoolean("cancelRequested"))invalid()
        return JSONObject(input.toString())
    }
    fun localPage(input:JSONObject,owner:String):JSONObject {
        E2eeKeys.exact(input,setOf("format","ownerId","intentId","planHash","index","page"));E2eeKeys.technical(input.getString("intentId"));E2eeEnvelope.decode(input.getString("planHash"),32);number(input.get("index"),0,9999)
        if(input.get("format")!="genesis-membership-local-page-v2"||input.get("ownerId")!=owner||page(input.getJSONObject("page")).get("kind") !in planKinds)invalid()
        return JSONObject(input.toString())
    }
    fun localPageMatches(state:JSONObject,input:JSONObject):JSONObject {
        val row=localPage(input,state.getString("ownerId"));val plan=state.getJSONObject("plan");val index=number(row.get("index"),0,9999).toInt();val refs=plan.getJSONArray("pages")
        if(row.get("intentId")!=plan.get("intentId")||row.get("planHash")!=state.get("planHash")||index>=refs.length()||!E2eeProductJson.same(pageRef(index,row.getJSONObject("page")),refs.getJSONObject(index)))invalid()
        return row
    }
    fun localRequest(input:JSONObject,owner:String):JSONObject {
        E2eeKeys.exact(input,setOf("format","ownerId","action","payload","packet"));if(input.get("format")!="genesis-membership-stage-request-v2"||input.get("ownerId")!=owner)invalid()
        val action=input.getString("action");val payload=stagingPayload(action,input.getJSONObject("payload"));val signed=input.getJSONObject("packet");E2eeKeys.exact(signed,setOf("command","signature"));val command=signed.getJSONObject("command")
        E2eeCommands.commandBytes(command).fill(0);E2eeEnvelope.decode(signed.getString("signature"),64)
        if(command.get("ownerId")!=owner||command.get("action")!=action||!E2eeProductJson.same(command.getJSONObject("payload"),payload))invalid()
        return JSONObject(input.toString())
    }
}
