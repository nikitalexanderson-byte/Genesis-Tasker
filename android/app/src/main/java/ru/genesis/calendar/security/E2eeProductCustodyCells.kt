package ru.genesis.calendar.security

import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate

/** Pure read-only product-cell decoders shared with actual native readers.
 * A completed flag/result is retained content, never a new service grant. */
internal object E2eeProductCustodyCells {
    private fun invalid():Nothing=error("E2EE_PRODUCT_CUSTODY_REVIEW_REQUIRED")
    private fun number(value:JSONObject,name:String,min:Long=0,max:Long=9007199254740991):Long=E2eeCommands.integer(value.get(name),min).also{if(it>max)invalid()}
    fun stoicheion(value:JSONObject,owner:String,scope:String,kind:String):JSONObject {
        E2eeKeys.exact(value,setOf("protocol","ownerId","kind","content","position","complete","result"));if(value.getInt("protocol")!=1||value.get("ownerId")!=owner||value.get("kind")!=kind||value.get("complete") !is Boolean)invalid()
        val content=value.getJSONObject("content");E2eeKeys.exact(content,setOf("protocol","ownerId","scopeId","intentId","kind","action","periodKey","expectedRevision","seed","cards"))
        if(content.getInt("protocol")!=1||content.get("ownerId")!=owner||content.get("scopeId")!=scope||content.get("kind")!=kind||kind !in setOf("daily","spread","timeline")||content.get("action") !in setOf("draw","spread-card","reveal","reroll"))invalid()
        E2eeKeys.technical(content.getString("intentId"));LocalDate.parse(content.getString("periodKey"));number(content,"expectedRevision");number(content,"seed",0,0xffff_ffffL)
        if(kind=="spread"){val cards=content.getJSONArray("cards");if(cards.length()!=9)invalid();val ids=mutableSetOf<String>();val allowed=setOf("alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa","lambda","mu","nu","xi","omicron","pi","rho","sigma","tau","upsilon","phi","chi","psi","omega")
            for(at in 0 until cards.length()){val card=cards.getJSONObject(at);E2eeKeys.exact(card,setOf("cardId","reversed"));if(card.getString("cardId") !in allowed||!ids.add(card.getString("cardId"))||card.get("reversed") !is Boolean)invalid()}
        }else if(!content.isNull("cards"))invalid()
        if(!value.isNull("position"))number(value,"position",0,8)
        if(!value.isNull("result")){val result=value.getJSONObject("result");if(result.get("intentId")!=content.get("intentId")||result.get("kind")!=kind)invalid();val head=result.getJSONObject("head");if(head.get("kind")!=kind)invalid();number(head,"revision",1)}
        if(value.getBoolean("complete")&&value.isNull("result"))invalid();return value
    }
    fun advice(id:String,value:JSONObject,owner:String,scope:String):JSONObject {
        if(id=="advice-policy-v1"){
            E2eeKeys.exact(value,setOf("dayKey","serverNow","auroraLimit","restricted","settingsAllowed","legacy","issues","checkpointHash","directoryRevision"));LocalDate.parse(value.getString("dayKey"));Instant.parse(value.getString("serverNow"));number(value,"auroraLimit",0,6);number(value,"directoryRevision",1);E2eeEnvelope.decode(value.getString("checkpointHash"),32)
            if(value.get("restricted") !is Boolean||value.get("settingsAllowed") !is Boolean)invalid();val slots=mutableSetOf<Long>();val legacy=value.getJSONArray("legacy");val issues=value.getJSONArray("issues");if(legacy.length()+issues.length()>9)invalid()
            for((array,live)in listOf(legacy to false,issues to true))for(at in 0 until array.length()){val row=array.getJSONObject(at);E2eeKeys.exact(row,setOf("slot","collection")+(if(live)setOf("objectId","payloadHash")else emptySet()));if(!slots.add(number(row,"slot",1,9))||row.get("collection") !in setOf("aurora","philosophers"))invalid();if(live){E2eeKeys.technical(row.getString("objectId"));if(!row.getString("objectId").startsWith("advice-live:"))invalid();E2eeEnvelope.decode(row.getString("payloadHash"),32)}}
            if(slots.sorted().withIndex().any{it.value!=it.index+1L})invalid();return value
        }
        if(id!="advice-pending-v1")invalid();E2eeKeys.exact(value,setOf("protocol","ownerId","issue","result","complete"));if(value.getInt("protocol")!=1||value.get("ownerId")!=owner||value.get("complete") !is Boolean)invalid()
        val issue=value.getJSONObject("issue");E2eeKeys.exact(issue,setOf("protocol","ownerId","scopeId","intentId","dayKey","slot","entry","selection"));if(issue.getInt("protocol")!=1||issue.get("ownerId")!=owner||issue.get("scopeId")!=scope)invalid()
        E2eeKeys.technical(issue.getString("intentId"));LocalDate.parse(issue.getString("dayKey"));number(issue,"slot",1,9);val entry=issue.getJSONObject("entry");E2eeKeys.technical(entry.getString("id"));if(entry.get("collection") !in setOf("aurora","philosophers"))invalid();issue.getJSONObject("selection")
        if(!value.isNull("result")){val result=value.getJSONObject("result");if(result.get("intentId")!=issue.get("intentId")||result.get("dayKey")!=issue.get("dayKey")||result.get("slot")!=issue.get("slot")||result.get("collection")!=entry.get("collection")||result.get("objectId")!="advice-live:"+issue.getString("intentId"))invalid();E2eeEnvelope.decode(result.getString("payloadHash"),32)}
        if(value.getBoolean("complete")&&value.isNull("result"))invalid();return value
    }
}
