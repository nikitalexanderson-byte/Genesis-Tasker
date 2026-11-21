package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant

internal object E2eeProductContract{
    val kinds=setOf("project","space","task","comment","project-comment","status","category","label","mindmap","file","workflow","review-policy","planning","sprint","series","automation","template","custom-field","custom-field-value","view","history","trash","import")
    fun domain(kind:String):String{check(kind in kinds){"E2EE_PRODUCT_ENTITY_INVALID"};return when(kind){"comment","project-comment"->"shared-comment";"mindmap"->"mindmap";"file"->"attachment";else->"shared-project"}}
    fun ids(value:JSONArray,maximum:Int=200):List<String>{check(value.length()<=maximum){"E2EE_PRODUCT_METADATA_INVALID"};val values=(0 until value.length()).map{E2eeKeys.technical(value.getString(it))};check(values.toSet().size==values.size){"E2EE_PRODUCT_METADATA_INVALID"};return values}
    fun metadata(kind:String,input:JSONObject):JSONObject{
        domain(kind);val fields=when(kind){"task"->setOf("protocol","statusId","completed","approverIds","dependsOnIds","presentFields");"workflow"->setOf("protocol","enabled","statuses","transitions");else->setOf("protocol")}
        E2eeKeys.exact(input,fields);check(input.get("protocol")==1){"E2EE_PRODUCT_METADATA_INVALID"}
        if(kind=="task"){if(!input.isNull("statusId"))E2eeKeys.technical(input.getString("statusId"));check(input.get("completed") is Boolean){"E2EE_PRODUCT_METADATA_INVALID"};ids(input.getJSONArray("approverIds"));ids(input.getJSONArray("dependsOnIds"),1000);ids(input.getJSONArray("presentFields"))}
        if(kind=="workflow"){check(input.get("enabled") is Boolean){"E2EE_PRODUCT_METADATA_INVALID"};val rows=input.getJSONArray("statuses");val transitions=input.getJSONArray("transitions");check(rows.length()<=200&&transitions.length()<=10000){"E2EE_PRODUCT_METADATA_INVALID"};val statuses=mutableSetOf<String>()
            for(index in 0 until rows.length()){val row=rows.getJSONObject(index);E2eeKeys.exact(row,setOf("statusId","wipLimit","requiredFields"));check(statuses.add(E2eeKeys.technical(row.getString("statusId")))){"E2EE_PRODUCT_METADATA_INVALID"};if(!row.isNull("wipLimit"))check(E2eeCommands.integer(row.get("wipLimit"),1)<=100000){"E2EE_PRODUCT_METADATA_INVALID"};ids(row.getJSONArray("requiredFields"))}
            for(index in 0 until transitions.length()){val row=transitions.getJSONObject(index);E2eeKeys.exact(row,setOf("fromStatusId","toStatusId","roles"));check((row.isNull("fromStatusId")||row.getString("fromStatusId") in statuses)&&row.getString("toStatusId") in statuses){"E2EE_PRODUCT_METADATA_INVALID"};val roles=ids(row.getJSONArray("roles"),5);check(roles.isNotEmpty()&&roles.all{it in setOf("owner","manager","member","commenter","viewer")}){"E2EE_PRODUCT_METADATA_INVALID"}}
        };return JSONObject(input.toString())
    }
    fun entity(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("entityId","kind","revision","domain","objectId","payloadHash","parentId","authorId","deleted","metadata","updatedAt"));for(key in listOf("entityId","objectId","authorId"))E2eeKeys.technical(value.getString(key))
        check(value.get("domain")==domain(value.getString("kind"))&&value.get("deleted") is Boolean){"E2EE_PRODUCT_ENTITY_INVALID"};E2eeCommands.integer(value.get("revision"),1);E2eeEnvelope.decode(value.getString("payloadHash"),32);if(!value.isNull("parentId"))E2eeKeys.technical(value.getString("parentId"));metadata(value.getString("kind"),value.getJSONObject("metadata"));Instant.parse(value.getString("updatedAt"));return JSONObject(value.toString())
    }
    fun operation(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("action","entityId","kind","expectedRevision","domain","objectId","payloadHash","parentId","metadata","proposalId"));val kind=value.getString("kind");val action=value.getString("action")
        check(action in setOf("create","update","delete","restore","propose-complete")&&value.get("domain")==domain(kind)&&value.getString("objectId").matches(Regex("product-version:[a-f0-9-]{36}"))){"E2EE_PRODUCT_BATCH_INVALID"}
        E2eeKeys.technical(value.getString("entityId"));E2eeEnvelope.decode(value.getString("payloadHash"),32);check(E2eeCommands.integer(value.get("expectedRevision"))<9_007_199_254_740_991L){"E2EE_INVALID_REVISION"}
        if(!value.isNull("parentId"))E2eeKeys.technical(value.getString("parentId"));if(action=="propose-complete"){check(kind=="task"){"E2EE_PRODUCT_BATCH_INVALID"};E2eeKeys.technical(value.getString("proposalId"))}else check(value.isNull("proposalId")){"E2EE_PRODUCT_BATCH_INVALID"}
        metadata(kind,value.getJSONObject("metadata"));return JSONObject(value.toString())
    }
}
