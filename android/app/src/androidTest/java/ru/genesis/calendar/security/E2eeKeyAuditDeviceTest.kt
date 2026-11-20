package ru.genesis.calendar.security

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.util.UUID

/** Public synthetic keys only; the QA package owns all Keystore/SQLite data. */
@RunWith(AndroidJUnit4::class)
class E2eeKeyAuditDeviceTest {
    @Test fun directoryPersistsExactVerifiedInputsAndObserverCannotChangeAuthorityOrRoot() {
        val context=InstrumentationRegistry.getInstrumentation().targetContext
        val owner="audit-${UUID.randomUUID()}";val scope="personal:$owner";val keyId="audit-root"
        val recovery=E2eeKeys.createRecoveryKit(owner)
        val device=UnlockedE2eeDevice.provision(context,owner,recovery.secret,recovery.kit)
        val root=E2eeKeys.freshSecret();val original=root.copyOf()
        val pin=JSONObject(recovery.kit.getJSONObject("authority").toString())
        val deviceCapsule=E2eeKeys.sealRoot(root,E2eeKeys.publicKeys(device.keys()).getString("receivingKey"),
            E2eeKeys.RootRecipient(owner,scope,1,keyId,device.deviceId))
        val recoveryCapsule=E2eeKeys.sealRoot(root,pin.getString("receivingKey"),E2eeKeys.RootRecipient(owner,scope,1,keyId,"recovery"))
        val payload=JSONObject().put("kind","personal").put("resourceId",owner).put("keyId",keyId).put("generation",1)
            .put("recoveryKit",recovery.kit).put("recoveryCapsule",recoveryCapsule)
            .put("deviceKeys",E2eeKeys.publicKeys(device.keys())).put("deviceCapsule",deviceCapsule)
        val command=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("deviceId",device.deviceId)
            .put("action","bootstrap").put("expectedRevision",0).put("checkpointHash","genesis").put("securityEpoch",1)
            .put("operationId",UUID.randomUUID().toString()).put("payload",payload)
        payload.put("selfProof",E2eeCommands.sign(command,device.keys().signing.private).get("signature"))
        val events=JSONArray().put(E2eeCommands.sign(command,recovery.keys.signing.private))
        val expectedPin=pin.getString("signingKey")
        val verified=device.rememberDirectory(scope,pin,events,owner){frame->
            pin.put("signingKey","invalid");events.getJSONObject(0).put("signature","invalid")
            frame.recoveryKit.getJSONObject("authority").put("signingKey","invalid")
            frame.recoveryCapsule.put("ciphertext","invalid");frame.devices.values.forEach{it.capsule.put("ciphertext","invalid")}
        }
        try{
            assertEquals(expectedPin,verified.recoveryKit.getJSONObject("authority").getString("signingKey"))
            val opened=E2eeKeys.openRoot(requireNotNull(verified.devices[device.deviceId]).capsule,device.keys().receiving,
                E2eeKeys.RootRecipient(owner,scope,1,keyId,device.deviceId))
            assertArrayEquals(original,opened.encoded)
            device.lock()
            val reopened=UnlockedE2eeDevice.unlock(context,owner)
            try{
                val saved=requireNotNull(reopened.savedDirectory(scope))
                assertEquals(verified.checkpoint,saved.checkpoint)
                assertEquals(expectedPin,saved.recoveryKit.getJSONObject("authority").getString("signingKey"))
                assertArrayEquals(original,E2eeKeys.openRoot(requireNotNull(saved.devices[reopened.deviceId]).capsule,reopened.keys().receiving,
                    E2eeKeys.RootRecipient(owner,scope,1,keyId,reopened.deviceId)).encoded)
            }finally{reopened.lock()}
        }finally{device.lock();root.fill(0);original.fill(0);recovery.secret.fill(0)}
    }
}
