package ru.genesis.calendar.security

import org.json.JSONObject

/** Shape/custody only, never an independent directory/recipient trust grant. */
internal object E2eeProjectCreationContract {
    private val selectionFields=setOf("spaceId","parentId","categoryId","boardStatusId","kind","layout","spaceAnchor","parentAnchor","categoryAnchor","statusAnchor")
    private val locationFields=setOf("spaceId","parentId","categoryId","boardStatusId","kind","layout")
    fun location(input:JSONObject):JSONObject {
        E2eeKeys.exact(input,locationFields)
        E2eeKeys.technical(input.getString("spaceId"));for(key in listOf("parentId","categoryId","boardStatusId"))if(!input.isNull(key))E2eeKeys.technical(input.getString(key))
        check(input.get("kind") in setOf("project","task-list")&&input.get("layout") in setOf("list","board")
            &&(input.get("kind")!="task-list"||!input.isNull("parentId")&&input.isNull("categoryId"))&&(input.isNull("boardStatusId")||!input.isNull("parentId"))){"E2EE_PROJECT_TOPOLOGY_REQUIRED"}
        return JSONObject(input.toString())
    }
    fun selection(input:JSONObject):JSONObject {
        E2eeKeys.exact(input,selectionFields)
        location(JSONObject().apply{for(key in locationFields)put(key,input.get(key))})
        fun anchor(key:String,entity:String?){
            if(entity==null){check(input.isNull(key)){"E2EE_PROJECT_TOPOLOGY_REQUIRED"};return}
            val value=input.getJSONObject(key);E2eeKeys.exact(value,setOf("scopeId","entityId","generation","directoryRevision","checkpointHash","revision","payloadHash"));E2eeKeys.technical(value.getString("scopeId"))
            check(value.get("entityId")==entity){"E2EE_PROJECT_TOPOLOGY_REQUIRED"}
            for(field in listOf("generation","directoryRevision","revision"))E2eeCommands.integer(value.get(field),1)
            E2eeEnvelope.decode(value.getString("checkpointHash"),32);E2eeEnvelope.decode(value.getString("payloadHash"),32)
        }
        anchor("spaceAnchor","space:"+input.getString("spaceId"));anchor("parentAnchor",if(input.isNull("parentId"))null else "project:"+input.getString("parentId"))
        anchor("categoryAnchor",if(input.isNull("categoryId"))null else "category:"+input.getString("categoryId"));anchor("statusAnchor",if(input.isNull("boardStatusId"))null else "status:"+input.getString("boardStatusId"))
        fun sameFrame(left:String,right:String){for(key in listOf("scopeId","generation","directoryRevision","checkpointHash"))check(input.getJSONObject(left).get(key)==input.getJSONObject(right).get(key)){"E2EE_PROJECT_TOPOLOGY_REQUIRED"}}
        if(!input.isNull("categoryAnchor"))sameFrame("categoryAnchor","spaceAnchor");if(!input.isNull("statusAnchor"))sameFrame("statusAnchor","parentAnchor")
        return JSONObject(input.toString())
    }
    fun topology(input:JSONObject,actorId:String):JSONObject {
        E2eeKeys.exact(input,selectionFields+"reviewedMembers")
        selection(JSONObject(input.toString()).apply{remove("reviewedMembers")})
        val members=input.getJSONArray("reviewedMembers");check(members.length() in 1..200){"E2EE_PROJECT_TOPOLOGY_REQUIRED"}
        var previous="";var owners=0
        for(at in 0 until members.length()){val row=members.getJSONObject(at);E2eeKeys.exact(row,setOf("userId","role"));val user=E2eeKeys.technical(row.getString("userId"));val role=row.getString("role")
            check(user>previous&&role in setOf("owner","manager","member","commenter","viewer")&&(role=="owner")==(user==actorId)){"E2EE_PROJECT_TOPOLOGY_REQUIRED"}
            previous=user;if(role=="owner")owners++
        }
        check(owners==1){"E2EE_PROJECT_TOPOLOGY_REQUIRED"};return JSONObject(input.toString())
    }
}
