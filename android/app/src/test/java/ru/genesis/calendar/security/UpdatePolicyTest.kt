package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.security.KeyPairGenerator
import java.security.Signature
import java.security.spec.ECGenParameterSpec
import java.util.Base64

class UpdatePolicyTest {
    private val keys=KeyPairGenerator.getInstance("EC").apply { initialize(ECGenParameterSpec("secp256r1")) }.generateKeyPair()
    private val publicKey=Base64.getEncoder().encodeToString(keys.public.encoded)
    private fun envelope(change:(JSONObject)->Unit={}):String {
        val root=JSONObject("""{"schema":1,"sequence":2,"issuedAt":1000,"activatesAt":1100,"expiresAt":2000,"package":"ru.genesis.calendar","channels":{"site":{"minimumVersionCode":200,"minimumCryptoProtocol":1},"play":{"minimumVersionCode":0,"minimumCryptoProtocol":0}}}""")
        change(root)
        val bytes=root.toString().toByteArray()
        val signature=Signature.getInstance("SHA256withECDSA").run { initSign(keys.private); update(bytes); sign() }
        return JSONObject().put("payload",Base64.getEncoder().encodeToString(bytes)).put("signature",Base64.getEncoder().encodeToString(signature)).toString()
    }
    @Test fun channelsAndCohortsDoNotPrematurelyBlock() {
        val site=UpdatePolicy.verify(envelope(),"site",publicKey)
        assertFalse(site.mayActivate(1099,200,148,0))
        assertFalse(site.mayActivate(1200,199,148,0))
        assertFalse(site.mayActivate(999,200,148,0))
        assertFalse(site.mayActivate(2001,200,148,0))
        assertTrue(site.mayActivate(1200,201,148,0))
        assertFalse(UpdatePolicy.verify(envelope(),"play",publicKey).needsUpdate(148,0))
    }
    @Test fun stickyFloorDoesNotDependOnClockNetworkOrDismissal() {
        val floor=UpdatePolicy.verify(envelope(),"site",publicKey)
        assertTrue(updateFloorBlocked(floor,148,0))
        assertTrue(updateFloorBlocked(floor,200,0))
        assertFalse(updateFloorBlocked(floor,200,1))
        assertFalse(updateFloorBlocked(floor,300,2))
        assertFalse(updateFloorBlocked(null,148,0))
    }
    @Test fun tamperedOrWrongSignerRejected() {
        val signed=JSONObject(envelope()); val bytes=Base64.getDecoder().decode(signed.getString("payload"));bytes[5]=(bytes[5].toInt() xor 1).toByte()
        signed.put("payload",Base64.getEncoder().encodeToString(bytes))
        assertThrows(IllegalArgumentException::class.java){UpdatePolicy.verify(signed.toString(),"site",publicKey)}
        assertThrows(IllegalArgumentException::class.java){UpdatePolicy.verify(envelope(),"site")}
    }
    @Test fun malformedSignedPoliciesRejected() {
        for(change in listOf<(JSONObject)->Unit>(
            {it.put("sequence",1.5)}, {it.put("expiresAt",30000000)}, {it.put("package","other.app")},
            {it.put("unexpected",true)}, {it.getJSONObject("channels").getJSONObject("site").put("minimumVersionCode",-1)})) {
            assertThrows(IllegalArgumentException::class.java){UpdatePolicy.verify(envelope(change),"site",publicKey)}
        }
    }
    @Test fun nodeSignedProductionPolicyVerifiesAndIsDisabled() {
        val text=requireNotNull(javaClass.getResource("/security/android-security-policy.json")).readText()
        for(channel in listOf("site","play"))assertFalse(UpdatePolicy.verify(text,channel).needsUpdate(1,0))
    }
    @Test fun emergencyArchiveRoundtripTamperWrongKeyAndRandomNonces() {
        val key=EmergencyArchive.newKey();val payload="""{"tasks":[{"title":"synthetic private text"}],"outbox":["pending"]}"""
        val first=EmergencyArchive.seal(payload,key);val second=EmergencyArchive.seal(payload,key)
        assertNotEquals(first,second);assertFalse(first.contains("synthetic"));assertEquals(payload,EmergencyArchive.open(first,key))
        assertThrows(Exception::class.java){EmergencyArchive.open(first,EmergencyArchive.newKey())}
        val bad=JSONObject(first);val cipher=Base64.getDecoder().decode(bad.getString("ciphertext"));cipher[0]=(cipher[0].toInt() xor 1).toByte();bad.put("ciphertext",Base64.getEncoder().encodeToString(cipher))
        assertThrows(Exception::class.java){EmergencyArchive.open(bad.toString(),key)}
        bad.put("iv","AA==");assertThrows(IllegalArgumentException::class.java){EmergencyArchive.open(bad.toString(),key)}
    }
}
