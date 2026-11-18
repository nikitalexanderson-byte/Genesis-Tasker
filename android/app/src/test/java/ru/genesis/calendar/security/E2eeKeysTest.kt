package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.KeyFactory
import java.security.spec.X509EncodedKeySpec

class E2eeKeysTest {
    private val fixture by lazy {
        val file = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .map { File(it, "tests/fixtures/e2ee/v1-runtime.json") }.first { it.isFile }
        JSONObject(file.readText())
    }
    private fun bytes(name: String) = E2eeEnvelope.decode(fixture.getString(name), 1, 65536)
    private fun context(): E2eeKeys.RootRecipient = fixture.getJSONObject("rootContext").let {
        E2eeKeys.RootRecipient(it.getString("ownerId"), it.getString("scopeId"), it.getLong("cryptoEpoch"), it.getString("keyId"), it.getString("recipientId"))
    }
    private fun reject(action: () -> Unit) {
        try { action() } catch (_: Exception) { return }
        fail("Invalid synthetic recovery material accepted")
    }
    @Test fun webCryptoRecoveryAndDeviceBundleOpenOnCleanJcaClient() {
        val kit = fixture.getJSONObject("recoveryKit"); val owner = kit.getString("ownerId")
        val recovered = E2eeKeys.recoverAuthority(owner, bytes("secret"), kit)
        assertEquals(kit.getJSONObject("authority").getString("signingKey"), E2eeKeys.publicKeys(recovered).getString("signingKey"))
        assertArrayEquals(bytes("plaintext"), E2eeKeys.openBundle(owner, "device-vault", bytes("secret"), fixture.getJSONObject("bundle")))
        reject { E2eeKeys.recoverAuthority(owner, E2eeKeys.freshSecret(), kit) }
        reject { E2eeKeys.recoverAuthority("other-owner", bytes("secret"), kit) }
        reject { E2eeKeys.openBundle(owner, "recovery-authority", bytes("secret"), fixture.getJSONObject("bundle")) }
    }
    @Test fun rfc9180WebHpkeRootOpensWithBouncyCastleAndRejectsWrongRecipient() {
        val device = E2eeKeys.importDeviceKeys(fixture.getJSONObject("device")); val context = context()
        val root = E2eeKeys.openRoot(fixture.getJSONObject("rootCapsule"), device.receiving, context)
        assertArrayEquals(bytes("root"), root.encoded)
        reject { E2eeKeys.openRoot(fixture.getJSONObject("rootCapsule"), device.receiving, context.copy(keyId = "other-key")) }
        reject { E2eeKeys.openRoot(fixture.getJSONObject("rootCapsule"), E2eeKeys.generateDeviceKeys().receiving, context) }
        val capsule = E2eeKeys.sealRoot(bytes("root"), E2eeKeys.publicKeys(device).getString("receivingKey"), context)
        assertArrayEquals(bytes("root"), E2eeKeys.openRoot(capsule, device.receiving, context).encoded)
        System.getenv("GENESIS_E2EE_RUNTIME_VECTOR_OUTPUT")?.let { path ->
            val output = File(path); require(output.isAbsolute && output.name == "kotlin-runtime.json")
            requireNotNull(output.parentFile).mkdirs()
            output.writeText(JSONObject().put("warning", "PUBLIC SYNTHETIC FIXTURE; NEVER USE FOR USER DATA")
                .put("rootCapsule", capsule).put("bundle", E2eeKeys.protectBundle(context.ownerId, "device-vault", bytes("secret"), bytes("plaintext")))
                .put("nativeRecovery", E2eeKeys.createRecoveryKit(context.ownerId).let { JSONObject().put("kit",it.kit).put("secret",E2eeEnvelope.encode(it.secret)) })
                .toString(2) + "\n")
        }
    }
    @Test fun commandsHaveIdenticalCanonicalBytesHashAndSignatureToWebCrypto() {
        val packet = fixture.getJSONObject("signedCommand"); val command = packet.getJSONObject("command")
        val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(fixture.getJSONObject("device").getString("signingKey"), 91)))
        assertArrayEquals(bytes("commandBytes"), E2eeCommands.commandBytes(command))
        assertEquals(fixture.getString("commandHash"), E2eeCommands.hash(command))
        assertEquals("read", E2eeCommands.verify(packet, publicKey).getString("action"))
        val modified = JSONObject(packet.toString()); modified.getJSONObject("command").put("operationId", "modified")
        reject { E2eeCommands.verify(modified, publicKey) }
    }
    @Test fun nativeFreshRecoveryIndependentKeysAndNoRawPersistence() {
        val recovery = E2eeKeys.createRecoveryKit("native-owner")
        val other = E2eeKeys.createRecoveryKit("native-owner")
        assertFalse(recovery.secret.contentEquals(other.secret))
        val recovered = E2eeKeys.recoverAuthority("native-owner", recovery.secret, recovery.kit)
        assertEquals(E2eeKeys.publicKeys(recovery.keys).getString("receivingKey"), E2eeKeys.publicKeys(recovered).getString("receivingKey"))
        assertFalse(recovery.kit.toString().contains(E2eeEnvelope.encode(recovery.secret)))
        assertTrue(recovery.toString().contains("redacted"))
        val invalid = E2eeKeys.exportPrivateKeys(recovery.keys)
        invalid.put("receivingPrivate", E2eeKeys.exportPrivateKeys(other.keys).get("receivingPrivate"))
        reject { E2eeKeys.importDeviceKeys(invalid) }
    }
    @Test fun signedDirectoryMatchesWebCheckpointAndRejectsRollback() {
        val owner=fixture.getJSONObject("rootContext").getString("ownerId");val scope=fixture.getJSONObject("rootContext").getString("scopeId")
        val pin=fixture.getJSONObject("recoveryKit").getJSONObject("authority");val events=fixture.getJSONObject("directory").getJSONArray("events")
        val directory=E2eeDirectory.verify(owner,scope,pin,events)
        val expected=fixture.getJSONObject("directory").getJSONObject("checkpoint")
        assertEquals(expected.getString("hash"),directory.checkpoint.hash);assertEquals(expected.getLong("revision"),directory.checkpoint.revision)
        assertEquals(2L,directory.cryptoEpoch);assertEquals(true,directory.devices["fixture-device"]?.revoked)
        assertEquals(false,directory.devices["fixture-second"]?.revoked)
        assertEquals(1,directory.devices["fixture-second"]?.historyCapsules?.size)
        val historical=E2eeEnvelope.Envelope.fromJson(fixture.getJSONObject("file").getJSONObject("manifest"))
        E2eeDirectory.verifyHistoricalHead(directory,historical,fixture.getJSONArray("retiredHeads"))
        assertEquals(fixture.getJSONObject("directory").getJSONArray("events").getJSONObject(3).getJSONObject("command").getJSONObject("payload").getString("retiredManifestHash"),
            E2eeFiles.objectManifestHash(fixture.getJSONArray("retiredHeads")))
        val forged=E2eeEnvelope.Envelope.fromJson(historical.toJson().put("nonce",E2eeEnvelope.encode(ByteArray(12){7})))
        reject{E2eeDirectory.verifyHistoricalHead(directory,forged,fixture.getJSONArray("retiredHeads"))}
        val truncated=org.json.JSONArray().apply{for(index in 0 until events.length()-1)put(events.get(index))}
        reject{E2eeDirectory.verify(owner,scope,pin,truncated,directory.checkpoint)}
    }
    @Test fun authenticatedFileFromWebOpensOnNativeAndRejectsTruncation() {
        val file=fixture.getJSONObject("file");val envelope=E2eeEnvelope.Envelope.fromJson(file.getJSONObject("manifest"))
        val chunks=file.getJSONArray("chunks");val records=(0 until chunks.length()).map{E2eeEnvelope.Envelope.fromJson(chunks.getJSONObject(it))}
            .associateBy{it.context.toJson().getString("objectId")}
        val signer=E2eeDirectory.signingKey(fixture.getJSONObject("device").getString("signingKey"));val root=E2eeEnvelope.importRoot(bytes("root"))
        val opened=E2eeFiles.open(root,signer,envelope.context,envelope){records.getValue(it)}
        assertArrayEquals(bytes("plaintext"),opened.bytes);assertEquals("Синтетическое имя.txt",opened.filename)
        reject{E2eeFiles.open(root,signer,envelope.context,envelope){throw IllegalStateException("missing chunk")}}
        val own=E2eeKeys.importDeviceKeys(fixture.getJSONObject("device"))
        val large=ByteArray(E2eeFiles.CHUNK_BYTES+31){(it%127).toByte()}
        val sealed=E2eeFiles.seal(root,own.signing.private,envelope.context,large,"private.txt","text/plain")
        assertEquals(2,sealed.chunks.size)
        assertArrayEquals(large,E2eeFiles.open(root,signer,envelope.context,sealed.manifest){id->sealed.chunks.first{it.context.toJson().getString("objectId")==id}}.bytes)
        reject{E2eeFiles.open(root,signer,envelope.context,sealed.manifest){sealed.chunks.last()}}
    }
}
