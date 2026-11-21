package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.spec.X509EncodedKeySpec
import java.time.Instant

/** Personal-vault custody of an explicitly compared group authority. Server
 * discovery may suggest a fingerprint, but cannot approve it for the user. */
internal class E2eeSharedTrust(private val account:E2eeProductAccount){
    companion object{
        fun fingerprint(proposal:JSONObject):String{
            E2eeKeys.exact(proposal,setOf("scopeId","ownerId","kind","resourceId","authority"));for(name in listOf("scopeId","ownerId","resourceId"))E2eeKeys.technical(proposal.getString(name))
            check(proposal.getString("kind") in setOf("project","space")){"E2EE_SHARED_TRUST_INVALID"};val authority=proposal.getJSONObject("authority");E2eeKeys.exact(authority,setOf("signingKey","receivingKey"))
            val factory=KeyFactory.getInstance("EC");E2eeEnvelope.assertP256(factory.generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(authority.getString("signingKey"),91))))
            val point=E2eeEnvelope.decode(authority.getString("receivingKey"),65);check(point[0].toInt()==4){"E2EE_SHARED_TRUST_INVALID"}
            val prefix="3059301306072a8648ce3d020106082a8648ce3d030107034200".chunked(2).map{it.toInt(16).toByte()}.toByteArray()
            E2eeEnvelope.assertP256(factory.generatePublic(X509EncodedKeySpec(prefix+point)))
            return E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(E2eeCommands.canonical(proposal)))
        }
    }
    private fun validate(value:JSONObject):JSONObject{
        E2eeKeys.exact(value,setOf("protocol","ownerId","scopes"));check(value.get("protocol")==1&&value.get("ownerId")==account.ownerId){"E2EE_SCOPE_BINDING_MISMATCH"}
        val rows=value.getJSONArray("scopes");check(rows.length()<=4096){"E2EE_SHARED_TRUST_INVALID"};val seen=mutableSetOf<String>()
        for(index in 0 until rows.length()){val row=rows.getJSONObject(index);E2eeKeys.exact(row,setOf("scopeId","ownerId","kind","resourceId","authority","fingerprint","acceptedAt"))
            val proposal=JSONObject(row.toString()).apply{remove("fingerprint");remove("acceptedAt")};check(seen.add(row.getString("scopeId"))&&row.get("fingerprint")==fingerprint(proposal)){"E2EE_SHARED_TRUST_INVALID"};Instant.parse(row.getString("acceptedAt"))}
        return JSONObject(value.toString())
    }
    private val document=E2eeFeatureDocument(account,"key-check","personal-shared-trust-live-v1",::validate,{
        JSONObject().put("protocol",1).put("ownerId",account.ownerId).put("scopes",JSONArray())},account::requireOpen)
    @Synchronized fun list():JSONArray{val view=document.read();check(view.isNull("conflict")){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};return JSONArray(view.getJSONObject("document").getJSONArray("scopes").toString())}
    @Synchronized fun accept(input:JSONObject,comparedFingerprint:String){account.requireOpen();val proposal=JSONObject(input.toString());val digest=fingerprint(proposal);check(digest==comparedFingerprint){"E2EE_SHARED_FINGERPRINT_MISMATCH"}
        val view=document.read();check(view.isNull("conflict")){"E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED"};val prior=view.getJSONObject("document");val rows=prior.getJSONArray("scopes");val output=JSONArray();var old:JSONObject?=null
        for(index in 0 until rows.length()){val row=rows.getJSONObject(index);if(row.get("scopeId")==proposal.get("scopeId"))old=row else output.put(row)}
        check(old==null||old?.get("fingerprint")==digest){"E2EE_SHARED_AUTHORITY_CHANGED"};output.put(proposal.put("fingerprint",digest).put("acceptedAt",old?.getString("acceptedAt")?:Instant.now().toString()))
        document.write(prior.put("scopes",output));document.flush();account.requireOpen()
    }
    @Synchronized fun open(scopeId:String):E2eeProductAccount.SharedScope{E2eeKeys.technical(scopeId);val rows=list();val trust=(0 until rows.length()).map{rows.getJSONObject(it)}.singleOrNull{it.get("scopeId")==scopeId}?:error("E2EE_SHARED_FINGERPRINT_REQUIRED")
        return account.openSharedScope(scopeId,trust.getString("kind"),trust.getString("resourceId"),trust.getString("ownerId"),trust.getJSONObject("authority"))}
    override fun toString()="E2eeSharedTrust([redacted])"
}
