package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest
import java.security.Signature

internal object E2eeDeviceAccessContract {
    private fun invalid():Nothing=error("E2EE_DEVICE_ACCESS_INVALID")
    fun target(value:JSONObject):JSONObject {
        E2eeKeys.exact(value,setOf("ownerId","scopeId","kind","resourceId","authority"));listOf("ownerId","scopeId","resourceId").forEach{E2eeKeys.technical(value.getString(it))}
        if(value.get("kind") !in setOf("personal","space","project")||value.get("kind")=="personal"&&value.get("ownerId")!=value.get("resourceId"))invalid()
        val authority=value.getJSONObject("authority");E2eeKeys.exact(authority,setOf("signingKey","receivingKey"));E2eeEnvelope.decode(authority.getString("signingKey"),91);E2eeEnvelope.decode(authority.getString("receivingKey"),65)
        return JSONObject(value.toString())
    }
    fun challenge(value:JSONObject,target:JSONObject):JSONObject {
        E2eeKeys.exact(value,setOf("id","scopeId","userId","role","sessionHash","deviceId","signingKey","receivingKey","nonce","expiresAt"))
        listOf("id","scopeId","userId","deviceId").forEach{E2eeKeys.technical(value.getString(it))}
        if(value.get("scopeId")!=target.get("scopeId")||value.get("deviceId")=="recovery"||value.get("role") !in setOf("owner","writer","commenter","reader")
            ||(value.get("role")=="owner")!=(value.get("userId")==target.get("ownerId"))||target.get("kind")=="personal"&&value.get("userId")!=target.get("ownerId"))invalid()
        for(key in listOf("sessionHash","nonce"))if(!Regex("[a-f0-9]{64}").matches(value.getString(key)))invalid()
        E2eeCommands.integer(value.get("expiresAt"),1);E2eeEnvelope.decode(value.getString("signingKey"),91);E2eeEnvelope.decode(value.getString("receivingKey"),65)
        return JSONObject(value.toString())
    }
    fun request(value:JSONObject):JSONObject {
        E2eeKeys.exact(value,setOf("format","target","challenge","selfProof"));if(value.get("format")!="genesis-device-access-request-v1")invalid()
        val target=target(value.getJSONObject("target"));challenge(value.getJSONObject("challenge"),target);E2eeEnvelope.decode(value.getString("selfProof"),64);return JSONObject(value.toString())
    }
    fun proof(challenge:JSONObject):ByteArray {val body=E2eeCommands.canonical(challenge);return try{"GENESIS-E2EE-ENROLLMENT\u0000v1\u0000".toByteArray(Charsets.UTF_8)+body}finally{body.fill(0)}}
    fun verify(value:JSONObject):JSONObject {
        val request=request(value);val challenge=request.getJSONObject("challenge");val bytes=proof(challenge)
        try{val verifier=Signature.getInstance("SHA256withECDSA");verifier.initVerify(E2eeDirectory.signingKey(challenge.getString("signingKey")));verifier.update(bytes)
            if(!verifier.verify(E2eeEnvelope.p1363ToDer(E2eeEnvelope.decode(request.getString("selfProof"),64))))invalid();return request
        }finally{bytes.fill(0)}
    }
    fun fingerprint(value:JSONObject):String {val bytes=E2eeCommands.canonical(request(value));return try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}}
}
