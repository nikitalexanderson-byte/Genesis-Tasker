package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest

internal object E2eeMembershipContract {
    const val HASH_FORMAT="acl-name-value-v1"
    val specs=mapOf(
        "shared_project_members" to Pair(setOf("project_id","user_id"),setOf("role")),
        "shared_space_members" to Pair(setOf("space_id","user_id"),setOf("role","can_organize_tasks","all_projects","permissions_json","member_category_id","project_access_restricted","project_access_revision")),
        "shared_member_categories" to Pair(setOf("id","space_id"),setOf("permissions_json","revision")),
        "shared_member_project_grants" to Pair(setOf("space_id","user_id","project_id"),setOf("role","include_descendants","excluded"))
    )
    private fun invalid():Nothing=error("E2EE_MEMBERSHIP_BATCH_INVALID")
    fun fields(value:JSONObject):JSONArray=JSONArray().apply{
        for(name in value.keys().asSequence().toList().sorted()){
            if(!Regex("[a-z_]{1,64}").matches(name))invalid();val raw=value.get(name)
            val projected=when(raw){is String->{val bytes=raw.toByteArray(Charsets.UTF_8);try{JSONObject().put("utf8",E2eeEnvelope.encode(bytes))}finally{bytes.fill(0)}}
                is Boolean->raw;JSONObject.NULL->raw;is Number->{E2eeCommands.integer(raw);raw};else->invalid()}
            put(JSONObject().put("name",name).put("value",projected))
        }
    }
    fun grantReviewRequired(input:JSONArray)=(0 until input.length()).any{val row=input.getJSONObject(it);row.get("table")=="shared_member_project_grants"&&!row.isNull("after")&&!row.getJSONObject("after").has("excluded")}
    fun changes(input:JSONArray,allowMissingExcluded:Boolean=false):JSONArray {
        if(input.length() !in 1..200)invalid();val seen=mutableSetOf<String>()
        for(at in 0 until input.length()){
            val row=input.getJSONObject(at);E2eeKeys.exact(row,setOf("table","key","expectedHash","after"));val table=row.getString("table");val spec=specs[table]?:invalid();val key=row.getJSONObject("key")
            E2eeKeys.exact(key,spec.first);for(name in spec.first)E2eeKeys.technical(key.getString(name))
            val identity=E2eeEnvelope.encode(E2eeCommands.canonical(JSONObject().put("table",table).put("key",fields(key))));if(!seen.add(identity))invalid()
            if(row.get("expectedHash")!="absent")E2eeEnvelope.decode(row.getString("expectedHash"),32);if(row.isNull("after"))continue
            val after=row.getJSONObject("after");val fields=if(allowMissingExcluded&&table=="shared_member_project_grants"&&!after.has("excluded"))spec.second-"excluded" else spec.second;E2eeKeys.exact(after,fields)
            for(name in fields){val value=after.get(name)
                if(name in setOf("can_organize_tasks","all_projects","project_access_restricted","include_descendants","excluded")&&E2eeCommands.integer(value) !in 0L..1L)invalid()
                if(name in setOf("revision","project_access_revision"))E2eeCommands.integer(value,1)
                if(name=="member_category_id"&&!after.isNull(name))E2eeKeys.technical(after.getString(name))
                if(name=="role"&&value !in when(table){"shared_space_members"->setOf("owner","admin","member","guest");"shared_project_members"->setOf("owner","manager","member","commenter","viewer");else->setOf("member","commenter","viewer")})invalid()
                if(name=="permissions_json"){
                    if(after.isNull(name)){if(table=="shared_member_categories")invalid();continue}
                    val bytes=after.getString(name).toByteArray(Charsets.UTF_8)
                    try{if(bytes.size>16384)invalid();val permissions=E2eeFileManifestJson.read(bytes);E2eeKeys.exact(permissions,setOf("createProjects","editTasks","organizeTasks","comment","manageProjects","inviteMembers"));if(permissions.keys().asSequence().any{permissions.get(it) !is Boolean})invalid()}finally{bytes.fill(0)}
                }
            };fields(after)
        };return JSONArray(input.toString())
    }
    fun projection(input:JSONArray):JSONArray {val rows=changes(input);return JSONArray().apply{for(at in 0 until rows.length()){val row=rows.getJSONObject(at)
        put(JSONObject().put("table",row.get("table")).put("key",fields(row.getJSONObject("key"))).put("expectedHash",row.get("expectedHash"))
            .put("after",if(row.isNull("after"))JSONObject.NULL else fields(row.getJSONObject("after"))))
    }}}
    fun changeHashValue(actorId:String,intentId:String,changes:JSONArray,scopeIds:JSONArray):JSONObject {
        E2eeKeys.technical(actorId);E2eeKeys.technical(intentId)
        return JSONObject().put("protocol",1).put("hashFormat",HASH_FORMAT).put("actorId",actorId).put("intentId",intentId).put("changes",projection(changes)).put("scopeIds",scopeIds)
    }
    fun changeHash(actorId:String,intentId:String,changes:JSONArray,scopeIds:JSONArray):String {val bytes=E2eeCommands.canonical(changeHashValue(actorId,intentId,changes,scopeIds));return try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}}
    fun beforeHash(table:String,value:JSONObject?):String {
        if(value==null)return "absent";val spec=specs[table]?:invalid();E2eeKeys.exact(value,spec.first+spec.second)
        val bytes=E2eeCommands.canonical(JSONObject().put("hashFormat",HASH_FORMAT).put("fields",fields(value)))
        return try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}
    }
}
