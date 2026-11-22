package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

/** Exact read-only wire codec. Reading a receipt does not approve a plan,
 * refresh a stale signature, import a pin or acknowledge product readback. */
internal object E2eeMembershipAtomicReceipts {
    private fun invalid():Nothing=error("E2EE_INVALID_RECEIPT")
    private fun number(input:Any,min:Long=0,max:Long=9007199254740990L)=E2eeCommands.integer(input,min).also{if(it>max)invalid()}
    private fun rows(input:JSONArray)=(0 until input.length()).map{input.getJSONObject(it)}
    fun payload(action:String,input:JSONObject):JSONObject {
        if(action !in setOf("membership-atomic-commit","membership-atomic-receipt","membership-atomic-receipt-page"))invalid()
        E2eeKeys.exact(input,setOf("intentId","planHash","batchHash")+(if(action=="membership-atomic-receipt-page")setOf("index")else emptySet()))
        E2eeKeys.technical(input.getString("intentId"));E2eeEnvelope.decode(input.getString("planHash"),32);E2eeEnvelope.decode(input.getString("batchHash"),32)
        if(action=="membership-atomic-receipt-page")number(input.get("index"),0,9999)
        return JSONObject(input.toString())
    }
    fun header(input:JSONObject,plan:JSONObject,packetPages:JSONArray):JSONObject {
        E2eeKeys.exact(input,setOf("format","actorId","intentId","planHash","batchHash","changeHash","pages","signInRequired"))
        if(input.get("format")!="genesis-membership-atomic-receipt-v2"||input.get("actorId")!=plan.get("actorId")||input.get("intentId")!=plan.get("intentId")
            ||input.get("planHash")!=E2eeMembershipAtomicContract.digest(E2eeMembershipAtomicContract.plan(plan))||input.get("batchHash")!=E2eeMembershipAtomicContract.batchHash(plan,packetPages)
            ||input.get("changeHash")!=E2eeMembershipAtomicContract.changeHash(plan)||input.get("signInRequired")!=true)invalid()
        val pages=rows(input.getJSONArray("pages"));if(pages.size !in 1..10000)invalid();var scopes=0L
        for((index,row)in pages.withIndex()){
            E2eeKeys.exact(row,setOf("index","kind","count","pageHash"));if(number(row.get("index"))!=index.toLong()||row.get("kind") !in setOf("scopes","products"))invalid()
            val count=number(row.get("count"),1,200);E2eeEnvelope.decode(row.getString("pageHash"),32);if(row.get("kind")=="scopes")scopes+=count
        }
        if(scopes!=plan.getJSONArray("scopeIds").length().toLong())invalid();return JSONObject(input.toString())
    }
    fun page(input:JSONObject):JSONObject {
        E2eeKeys.exact(input,setOf("format","kind","items"));val kind=input.getString("kind");val items=rows(input.getJSONArray("items"))
        if(input.get("format")!="genesis-membership-receipt-page-v2"||kind !in setOf("scopes","products")||items.size !in 1..200)invalid();val seen=mutableSetOf<String>()
        for(row in items){
            if(kind=="scopes"){
                E2eeKeys.exact(row,setOf("scopeId","ownerId","result"));E2eeKeys.technical(row.getString("scopeId"));E2eeKeys.technical(row.getString("ownerId"));if(!seen.add(row.getString("scopeId")))invalid()
                val result=row.getJSONObject("result");E2eeKeys.exact(result,setOf("directoryRevision","checkpointHash","cryptoEpoch","securityEpoch","signInRequired"))
                for(key in listOf("directoryRevision","cryptoEpoch","securityEpoch"))number(result.get(key),1);E2eeEnvelope.decode(result.getString("checkpointHash"),32);if(result.get("signInRequired") !is Boolean)invalid()
            }else{
                E2eeKeys.exact(row,setOf("scopeId","intentId","actorId","result"));for(key in listOf("scopeId","intentId","actorId"))E2eeKeys.technical(row.getString(key));if(!seen.add(row.getString("scopeId")+"\u0000"+row.getString("intentId")))invalid()
                val result=row.getJSONObject("result");E2eeKeys.exact(result,setOf("intentId","results"));val results=rows(result.getJSONArray("results"));if(result.get("intentId")!=row.get("intentId")||results.size !in 1..100)invalid()
                val entities=mutableSetOf<String>();for(entity in results){E2eeKeys.exact(entity,setOf("entityId","revision","payloadHash"));if(!entities.add(E2eeKeys.technical(entity.getString("entityId"))))invalid();number(entity.get("revision"),1);E2eeEnvelope.decode(entity.getString("payloadHash"),32)}
            }
        }
        val bytes=E2eeCommands.canonical(input);try{if(bytes.size>512*1024)invalid()}finally{bytes.fill(0)}
        return JSONObject(input.toString())
    }
    fun ref(index:Int,input:JSONObject):JSONObject {number(index,0,9999);val page=page(input);return JSONObject().put("index",index).put("kind",page.get("kind")).put("count",page.getJSONArray("items").length()).put("pageHash",E2eeMembershipAtomicContract.digest(page))}
}
