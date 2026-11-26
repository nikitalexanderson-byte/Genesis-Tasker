package ru.genesis.calendar.security

import org.json.JSONObject

internal object E2eeMembershipAtomicPreview {
    private fun invalid():Nothing=error("E2EE_MEMBERSHIP_REVIEW_MISMATCH")
    private fun number(input:Any,min:Long=0,max:Long=9007199254740990L)=E2eeCommands.integer(input,min).also{if(it>max)invalid()}
    fun page(input:JSONObject,plan:JSONObject,hash:String,after:Int,anchors:Map<String,JSONObject>):JSONObject {
        val scopes=plan.getJSONArray("scopeIds");number(after,0,scopes.length().toLong());E2eeKeys.exact(input,setOf("intentId","planHash","changeHash","scopePlans","next"))
        if(hash!=E2eeMembershipAtomicContract.digest(E2eeMembershipAtomicContract.plan(plan))||input.get("intentId")!=plan.get("intentId")||input.get("planHash")!=hash||input.get("changeHash")!=E2eeMembershipAtomicContract.changeHash(plan))invalid()
        val rows=input.getJSONArray("scopePlans");if(rows.length()>200||after+rows.length()>scopes.length()||rows.length()==0&&after<scopes.length())invalid();val next=after+rows.length()
        if(next<scopes.length()){if(number(input.get("next"))!=next.toLong())invalid()}else if(!input.isNull("next"))invalid()
        for(index in 0 until rows.length()){
            val row=rows.getJSONObject(index);E2eeKeys.exact(row,setOf("scopeId","ownerId","kind","resourceId","generation","directoryRevision","checkpointHash","cryptoEpoch","securityEpoch","roles","manifest"))
            val anchor=anchors[scopes.getString(after+index)]?:invalid()
            if(listOf("scopeId","ownerId","kind","resourceId","checkpointHash").any{row.get(it)!=anchor.get(it)}||listOf("generation","directoryRevision").any{number(row.get(it),1)!=number(anchor.get(it),1)})invalid()
            number(row.get("cryptoEpoch"),1);number(row.get("securityEpoch"),1);val manifest=row.getJSONObject("manifest");E2eeKeys.exact(manifest,setOf("manifestHash","objectCount"));E2eeEnvelope.decode(manifest.getString("manifestHash"),32);number(manifest.get("objectCount"),0,10000)
            val roles=row.getJSONArray("roles");if(roles.length() !in 1..256)invalid();var previous=""
            for(at in 0 until roles.length()){
                val role=roles.getJSONObject(at);E2eeKeys.exact(role,setOf("deviceId","userId","role"));val device=E2eeKeys.technical(role.getString("deviceId"));E2eeKeys.technical(role.getString("userId"))
                if(device<=previous||!role.isNull("role")&&role.get("role") !in setOf("owner","writer","commenter","reader"))invalid();previous=device
            }
        }
        return JSONObject(input.toString())
    }
}
