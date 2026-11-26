package ru.genesis.calendar.security

import org.json.JSONObject

/** Technical discovery is not a key/owner capability. The real controller must
 * still use recovery setup and a directory pinned to this owner's vault. */
internal object E2eeSharedTransitionTargets{
    fun read(value:JSONObject,owner:String):List<E2eeProductMigration.Target>{
        E2eeKeys.technical(owner);E2eeKeys.exact(value,setOf("resources","checkpointHash","directoryRevision"));E2eeEnvelope.decode(value.getString("checkpointHash"),32)
        E2eeCommands.integer(value.get("directoryRevision"),1);val rows=value.getJSONArray("resources");check(rows.length()<=4096){"E2EE_INVALID_RESPONSE"}
        val seen=mutableSetOf<String>();val scopes=mutableSetOf<String>();val result=mutableListOf<E2eeProductMigration.Target>()
        for(at in 0 until rows.length()){
            val row=rows.getJSONObject(at);E2eeKeys.exact(row,setOf("kind","resourceId","scopeId","state"));val kind=row.getString("kind");val resource=E2eeKeys.technical(row.getString("resourceId"))
            check(kind in setOf("space","project")&&seen.add("$kind:$resource")&&row.isNull("scopeId")==row.isNull("state")){"E2EE_INVALID_RESPONSE"}
            val scope=if(row.isNull("scopeId"))"$kind:$resource"else E2eeKeys.technical(row.getString("scopeId"))
            check(scopes.add(scope)&&(row.isNull("state")||row.getString("state") in setOf("preparing","uploading","verified","active","retirement"))){"E2EE_INVALID_RESPONSE"}
            if(row.optString("state")!="retirement")result+=E2eeProductMigration.Target(owner,E2eeKeys.technical(scope),kind,resource)
        };return result
    }
}
