package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject

internal object E2eeMembershipProductIndex {
    /** Matching membership-product-index.ts: complete normal business heads,
     * including tombstones and exact server timestamp representation. */
    fun hash(scope:String,input:JSONArray):String {
        E2eeKeys.technical(scope);check(input.length()<=10000){"E2EE_SCOPE_OBJECT_LIMIT"}
        val rows=(0 until input.length()).map{E2eeProductContract.entity(input.getJSONObject(it))}.sortedBy{it.getString("entityId")}
        check(rows.map{it.getString("entityId")}.toSet().size==rows.size){"E2EE_PRODUCT_INDEX_INVALID"}
        return E2eeMembershipAtomicContract.digest(JSONObject().put("format","genesis-membership-product-index-v1").put("scopeId",scope)
            .put("entities",JSONArray(rows.map{E2eeMembershipAtomicContract.digest(it)})))
    }
}
