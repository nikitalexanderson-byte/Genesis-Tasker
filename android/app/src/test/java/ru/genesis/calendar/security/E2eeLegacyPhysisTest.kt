package ru.genesis.calendar.security

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.util.Base64
import java.util.concurrent.atomic.AtomicBoolean

class E2eeLegacyPhysisTest {
    private val fixture by lazy {
        val file = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
            .map { File(it, "tests/fixtures/e2ee/physis-legacy.json") }.first { it.isFile }
        JSONObject(file.readText())
    }
    private val owner get() = fixture.getString("ownerId")
    private fun independent(index: Int = 0) = fixture.getJSONArray("independent").getJSONObject(index)
    private fun copy(value: JSONObject) = JSONObject(value.toString())
    private fun bytes(value: String) = Base64.getDecoder().decode(value)
    private suspend fun rejected(code: String? = null, operation: suspend () -> Unit) {
        try { operation() } catch (error: Exception) {
            if (code == null) assertTrue(error.message?.startsWith("E2EE_") == true) else assertEquals(code, error.message)
            return
        }
        fail("Invalid public synthetic Physis source was accepted")
    }
    private suspend fun reader(f: JSONObject = independent(), guard: () -> Unit = {}) =
        E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "recovery", f.getString("recovery").toCharArray(), guard)
    private fun sealed(f: JSONObject, plain: ByteArray): JSONObject {
        val raw = bytes(f.getString("recordKey"))
        val packet = try { WorkspaceCipher.encrypt(plain, raw,
            "genesis:physis:v1:$owner:${f.getString("id")}:1:${f.getJSONObject("vault").getLong("keyVersion")}".toByteArray()) }
            finally { raw.fill(0) }
        return JSONObject().put("version", 1).put("schemaVersion", 1).put("keyVersion", f.getJSONObject("vault").get("keyVersion"))
            .put("iv", packet.iv).put("ciphertext", packet.ciphertext)
    }

    @Test fun actualWebCryptoVaultsOpenWithBothSecretsIncludingUtf16AndMaximumSafeEpoch() = runBlocking {
        for (index in 0 until fixture.getJSONArray("independent").length()) {
            val f = independent(index); val original = f.toString()
            for (method in listOf("password", "recovery")) {
                val credential = f.getString(method).toCharArray(); val before = credential.copyOf()
                E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), method, credential, {}).use {
                    assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")))
                    assertEquals("E2eeLegacyPhysis.Reader([redacted])", it.toString())
                }
                assertArrayEquals(before, credential); credential.fill('\u0000'); before.fill('\u0000')
            }
            assertEquals(original, f.toString())
        }
    }
    @Test fun accountV2OpensOnlyTheOriginalWrapperAndRetainsItsImmutableEpoch() = runBlocking {
        val f = fixture.getJSONObject("account"); val original = f.toString(); val vault = copy(f.getJSONObject("vault"))
        val raw = bytes(f.getString("oldKey")); val old = raw.copyOf()
        try {
            E2eeLegacyPhysis.unlockAccount(owner, vault, raw, {}).use {
                vault.put("keyVersion", 99); vault.getJSONObject("account").put("iv", Base64.getEncoder().encodeToString(ByteArray(12)))
                assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")))
            }
            assertArrayEquals(old, raw); assertEquals(original, f.toString())
        } finally { raw.fill(0); old.fill(0) }
    }
    @Test fun missingWrongOrOtherModeSecretsNeverBecomeEmptyOrFallback() = runBlocking {
        val f = independent(); val original = f.toString()
        rejected { E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "password", charArrayOf(), {}) }
        rejected("E2EE_PHYSIS_UNLOCK_REQUIRED") {
            E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "password", "A wrong public synthetic password".toCharArray(), {})
        }
        rejected("E2EE_PHYSIS_UNLOCK_REQUIRED") { E2eeLegacyPhysis.unlockAccount(owner, f.getJSONObject("vault"), ByteArray(32), {}) }
        rejected("E2EE_PHYSIS_UNLOCK_REQUIRED") {
            E2eeLegacyPhysis.unlockIndependent(owner, fixture.getJSONObject("account").getJSONObject("vault"), "password", f.getString("password").toCharArray(), {})
        }
        rejected("E2EE_PHYSIS_UNLOCK_REQUIRED") {
            E2eeLegacyPhysis.unlockAccount(owner, fixture.getJSONObject("account").getJSONObject("vault"), ByteArray(32) { 7 }, {})
        }
        assertEquals(original, f.toString())
    }
    @Test fun futureMalformedAndExcessiveKdfClaimsRefuseBeforeStartingWorker() = runBlocking {
        val f = independent(); val original = f.toString()
        val changes: List<(JSONObject) -> Unit> = listOf(
            { it.put("version", 9) }, { it.put("keyVersion", 0) }, { it.put("keyVersion", "7") },
            { it.put("keyVersion", 9007199254740992L) }, { it.put("unsupportedPrivateMode", true) },
            { it.getJSONObject("password").put("iterations", 1) }, { it.getJSONObject("password").put("iterations", 1000000000000L) },
            { it.getJSONObject("password").put("iterations", "600000") }, { it.getJSONObject("password").put("salt", "A".repeat(100000)) },
            { it.getJSONObject("recovery").put("iv", "AA==") }, { it.getJSONObject("recovery").put("ciphertext", true) })
        for (change in changes) {
            var checks = 0; val vault = copy(f.getJSONObject("vault")).also(change)
            rejected { E2eeLegacyPhysis.unlockIndependent(owner, vault, "password", f.getString("password").toCharArray(), { checks++ }) }
            assertEquals(1, checks)
        }
        assertEquals(original, f.toString())
    }
    @Test fun recoveryRequiresCanonicalBitsAndMatchesJavascriptUnicodeTrim() = runBlocking {
        val f = independent(); val code = f.getString("recovery"); val alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_"
        val changed = code.dropLast(1) + alphabet[alphabet.indexOf(code.last()) or 1]
        assertNotEquals(code, changed)
        rejected("E2EE_PHYSIS_SOURCE_INVALID") { E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "recovery", changed.toCharArray(), {}) }
        E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "recovery", ("\uFEFF " + code + "\u00A0").toCharArray(), {}).use {
            assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")))
        }
    }
    @Test fun mutableCallerVaultDoesNotChangeTheSnapshotWhileKdfRuns() = runBlocking {
        val f = independent(); val vault = copy(f.getJSONObject("vault")); val caller = Thread.currentThread()
        var offThread = false
        E2eeLegacyPhysis.unlockIndependent(owner, vault, "password", f.getString("password").toCharArray(), {
            if (Thread.currentThread() !== caller) { offThread = true; vault.put("keyVersion", 99); vault.getJSONObject("password").put("ciphertext", "invalid") }
        }).use { assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope"))) }
        assertTrue(offThread)
    }
    @Test fun cancellationDuringKdfNeverReturnsAnOpeningCapability() = runBlocking {
        val f = independent(); val started = CompletableDeferred<Unit>(); val caller = Thread.currentThread(); var returned = false
        val credential = f.getString("password").toCharArray(); val original = credential.copyOf()
        val work = launch {
            E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "password", credential, {
                if (Thread.currentThread() !== caller) started.complete(Unit)
            }).use { returned = true }
        }
        started.await(); work.cancelAndJoin(); assertFalse(returned); assertArrayEquals(original, credential)
        credential.fill('\u0000'); original.fill('\u0000')
    }
    @Test fun changedOwnerCancelsUnlockAndPermanentlyClosesAnExistingReader() = runBlocking {
        val f = independent(); val caller = Thread.currentThread()
        rejected("E2EE_ACCOUNT_CHANGED") {
            E2eeLegacyPhysis.unlockIndependent(owner, f.getJSONObject("vault"), "password", f.getString("password").toCharArray(), {
                check(Thread.currentThread() === caller) { "E2EE_ACCOUNT_CHANGED" }
            })
        }
        val live = AtomicBoolean(true); val reader = reader(f) { check(live.get()) { "E2EE_ACCOUNT_CHANGED" } }
        live.set(false); rejected("E2EE_ACCOUNT_CHANGED") { reader.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")) }
        live.set(true); rejected("E2EE_PHYSIS_UNLOCK_REQUIRED") { reader.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")) }
        reader.close(); reader.close()
        reader(f).use { assertEquals(f.getString("plaintext"), it.readRecord(owner, f.getString("id"), f.getJSONObject("envelope"))) }
    }
    @Test fun ownerIdEpochSchemaAndCipherSubstitutionNeverReturnPartialPlaintext() = runBlocking {
        val f = independent(); val before = f.toString()
        reader(f).use { reader ->
            rejected { reader.readRecord("other-owner", f.getString("id"), f.getJSONObject("envelope")) }
            rejected { reader.readRecord(owner, "not-a-record-id", f.getJSONObject("envelope")) }
            rejected("E2EE_LEGACY_PHYSIS_CORRUPT") { reader.readRecord(owner, "00000000-0000-4000-8000-000000000009", f.getJSONObject("envelope")) }
            for (field in listOf("iv", "ciphertext")) {
                val envelope = copy(f.getJSONObject("envelope")); val raw = bytes(envelope.getString(field)); raw[0] = (raw[0].toInt() xor 1).toByte()
                envelope.put(field, Base64.getEncoder().encodeToString(raw)); raw.fill(0)
                rejected("E2EE_LEGACY_PHYSIS_CORRUPT") { reader.readRecord(owner, f.getString("id"), envelope) }
            }
            for ((field, value) in listOf("version" to 9, "schemaVersion" to 2, "keyVersion" to 8, "extra" to 1))
                rejected { reader.readRecord(owner, f.getString("id"), copy(f.getJSONObject("envelope")).put(field, value)) }
            assertEquals(f.getString("plaintext"), reader.readRecord(owner, f.getString("id"), f.getJSONObject("envelope")))
        }
        assertEquals(before, f.toString())
    }
    @Test fun duplicateJsonIsRetainedForSharedParserAndInvalidUtf8IsRefused() = runBlocking {
        val f = independent(); val duplicate = "{\"note\":\"one\",\"n\\u006fte\":\"two\"}"
        reader(f).use {
            assertEquals(duplicate, it.readRecord(owner, f.getString("id"), sealed(f, duplicate.toByteArray())))
            rejected("E2EE_PHYSIS_SOURCE_INVALID") { it.readRecord(owner, f.getString("id"), sealed(f, byteArrayOf(0xff.toByte(), 0xfe.toByte()))) }
        }
    }
    @Test fun exactMaximumRecordIsReadableAndOversizeOrNoncanonicalPacketsRefuse() = runBlocking {
        val f = independent(); val plain = "\"" + "x".repeat(E2eeLegacyPhysis.MAX_PLAIN - 2) + "\""
        reader(f).use {
            val packet = sealed(f, plain.toByteArray()); assertEquals(E2eeLegacyPhysis.MAX_CIPHER, bytes(packet.getString("ciphertext")).size)
            assertEquals(plain, it.readRecord(owner, f.getString("id"), packet))
            rejected { it.readRecord(owner, f.getString("id"), copy(packet).put("ciphertext", Base64.getEncoder().encodeToString(ByteArray(E2eeLegacyPhysis.MAX_CIPHER + 1)))) }
            rejected { it.readRecord(owner, f.getString("id"), copy(packet).put("iv", packet.getString("iv") + "=")) }
        }
    }
    @Test fun accountKeyPayloadCannotExploitPermissiveJsonDecoding() = runBlocking {
        val f = fixture.getJSONObject("account"); val raw = bytes(f.getString("oldKey")); val original = f.toString()
        try {
            // The legacy account writer always emits exactly 46 ASCII bytes.
            for (plain in listOf("null", " \"" + f.getString("recordKey") + "\"", "\"" + "A".repeat(44) + "\"")) {
                val vault = copy(f.getJSONObject("vault")); val packet = WorkspaceCipher.encrypt(plain.toByteArray(), raw,
                    "genesis-mindmap-v1:$owner:physis-vault:v2:3".toByteArray())
                vault.put("account", JSONObject().put("iv", packet.iv).put("ciphertext", packet.ciphertext))
                rejected { E2eeLegacyPhysis.unlockAccount(owner, vault, raw, {}) }
            }
            assertEquals(original, f.toString())
        } finally { raw.fill(0) }
    }
}
