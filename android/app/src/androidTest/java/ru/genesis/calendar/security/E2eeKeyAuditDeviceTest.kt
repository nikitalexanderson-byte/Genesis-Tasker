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
    @Test fun durabilityWitnessRejectsProtectedBundleChangeAndStaysDeniedAfterRestoration(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext;val owner="audit-durable-${UUID.randomUUID()}"
        val recovery=E2eeKeys.createRecoveryKit(owner);val device=UnlockedE2eeDevice.provision(context,owner,recovery.secret,recovery.kit)
        val persistence=UnlockedE2eeDevice::class.java.getDeclaredField("persistence").apply{isAccessible=true}.get(device) as E2eeDeviceVault
        val file=E2eeDeviceVault::class.java.getDeclaredField("file").apply{isAccessible=true}.get(persistence) as android.util.AtomicFile
        check(file.baseFile.parentFile==context.noBackupFilesDir&&file.baseFile.name.startsWith("e2ee-device-"))
        val original=file.openRead().use{it.readBytes()}
        fun write(bytes:ByteArray){val output=file.startWrite();try{output.write(bytes);file.finishWrite(output)}catch(error:Exception){file.failWrite(output);throw error}}
        try{
            device.ensureDurableKeys();val changed=original.copyOf();changed[changed.lastIndex]=(changed.last().toInt() xor 1).toByte()
            try{write(changed)}finally{changed.fill(0)}
            assertEquals("E2EE_DEVICE_KEY_UNAVAILABLE",runCatching{device.ensureDurableKeys()}.exceptionOrNull()?.message)
            write(original)
            assertEquals("E2EE_DEVICE_KEY_UNAVAILABLE",runCatching{device.ensureDurableKeys()}.exceptionOrNull()?.message)
        }finally{write(original);original.fill(0);device.lock();recovery.secret.fill(0)}
    }
    @Test fun durabilityWitnessRejectsMissingOrReplacedHardwareKeyWithoutReplacingTheBundle(){
        val context=InstrumentationRegistry.getInstrumentation().targetContext;val owner="audit-alias-${UUID.randomUUID()}"
        val recovery=E2eeKeys.createRecoveryKit(owner);val device=UnlockedE2eeDevice.provision(context,owner,recovery.secret,recovery.kit)
        val observer=UnlockedE2eeDevice.unlock(context,owner)
        val persistence=UnlockedE2eeDevice::class.java.getDeclaredField("persistence").apply{isAccessible=true}.get(device) as E2eeDeviceVault
        val alias=E2eeDeviceVault::class.java.getDeclaredField("alias").apply{isAccessible=true}.get(persistence) as String
        val file=E2eeDeviceVault::class.java.getDeclaredField("file").apply{isAccessible=true}.get(persistence) as android.util.AtomicFile
        check(file.baseFile.parentFile==context.noBackupFilesDir&&file.baseFile.name.startsWith("e2ee-device-"))
        val original=file.openRead().use{it.readBytes()}
        try{
            java.security.KeyStore.getInstance("AndroidKeyStore").apply{load(null);deleteEntry(alias)}
            assertEquals("E2EE_DEVICE_KEY_UNAVAILABLE",runCatching{device.ensureDurableKeys()}.exceptionOrNull()?.message)
            val spec=android.security.keystore.KeyGenParameterSpec.Builder(alias,android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT)
                .setBlockModes(android.security.keystore.KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(android.security.keystore.KeyProperties.ENCRYPTION_PADDING_NONE)
                .setKeySize(256).setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(false)
            if(android.os.Build.VERSION.SDK_INT>=30)spec.setUserAuthenticationParameters(300,android.security.keystore.KeyProperties.AUTH_BIOMETRIC_STRONG or android.security.keystore.KeyProperties.AUTH_DEVICE_CREDENTIAL)
            else @Suppress("DEPRECATION") spec.setUserAuthenticationValidityDurationSeconds(300)
            javax.crypto.KeyGenerator.getInstance(android.security.keystore.KeyProperties.KEY_ALGORITHM_AES,"AndroidKeyStore").apply{init(spec.build())}.generateKey()
            assertEquals("E2EE_DEVICE_KEY_UNAVAILABLE",runCatching{observer.ensureDurableKeys()}.exceptionOrNull()?.message)
            val retained=file.openRead().use{it.readBytes()};try{assertArrayEquals(original,retained)}finally{retained.fill(0)}
        }finally{original.fill(0);observer.lock();device.lock();recovery.secret.fill(0)}
    }
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
        val originalEvents=JSONArray(events.toString())
        val expectedPin=pin.getString("signingKey")
        val verified=device.rememberDirectory(scope,pin,events,owner){frame->
            pin.put("signingKey","invalid");events.getJSONObject(0).put("signature","invalid")
            frame.recoveryKit.getJSONObject("authority").put("signingKey","invalid")
            frame.recoveryCapsule.put("ciphertext","invalid");frame.devices.values.forEach{it.capsule.put("ciphertext","invalid")}
        }
        try{
            val directoryId=device.vault.listLocal("key-check","directory-").single()
            val before=requireNotNull(device.vault.read("key-check",directoryId))
            try{
                device.rememberDirectory(scope,verified.recoveryKit.getJSONObject("authority"),originalEvents,owner)
                val after=requireNotNull(device.vault.read("key-check",directoryId))
                try{assertEquals("Unchanged verification must retain serial",before.serial,after.serial);assertArrayEquals(before.bytes,after.bytes)}finally{after.bytes.fill(0)}
                var replaced=false
                try{
                    device.rememberDirectory(scope,verified.recoveryKit.getJSONObject("authority"),originalEvents,owner){
                        if(!replaced){replaced=true;device.vault.write(listOf(UnlockedE2eeVault.Write("key-check",directoryId,before.bytes,before.serial)))}
                    }
                    fail("A concurrent directory record replacement must refuse")
                }catch(error:IllegalStateException){assertEquals("E2EE_LOCAL_CONFLICT",error.message)}
            }finally{before.bytes.fill(0)}
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
