package ru.genesis.calendar.security

import org.json.JSONObject
import java.security.MessageDigest

/** Public authority material is exchanged with an existing trusted device.
 * A network status response never creates this comparison capability. */
internal class E2eeComparedPersonalDeviceTarget private constructor(private val encoded:String){
    fun target():JSONObject=E2eeDeviceAccessContract.target(JSONObject(encoded))
    companion object {
        fun fingerprint(input:JSONObject):String {val target=E2eeDeviceAccessContract.target(input);check(target.get("kind")=="personal"){"E2EE_SCOPE_BINDING_MISMATCH"};val bytes=E2eeCommands.canonical(JSONObject().put("format","genesis-personal-device-target-v1").put("target",target));return try{E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))}finally{bytes.fill(0)}}
        fun compare(input:JSONObject,comparedFingerprint:String,owner:String):E2eeComparedPersonalDeviceTarget{val target=E2eeDeviceAccessContract.target(input)
            check(target.get("kind")=="personal"&&target.get("ownerId")==owner&&target.get("resourceId")==owner&&fingerprint(target)==comparedFingerprint){"E2EE_DEVICE_FINGERPRINT_REQUIRED"};return E2eeComparedPersonalDeviceTarget(target.toString())
        }
    }
}
