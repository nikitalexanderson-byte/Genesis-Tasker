package ru.genesis.calendar.security

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.UUID

class E2eeScopeClientTest {
    private class Memory : E2eeRecordStorage {
        var rows = mutableMapOf<String, E2eeLocalRecord>()
        var full = false
        override fun get(key: String) = rows[key]
        override fun list(prefix: String) = rows.keys.filter { it.startsWith(prefix) }
        override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
            requireOpen(); check(!full) { "SYNTHETIC_DISK_FULL" }
            for (change in changes) check(rows[change.key]?.serial == change.expected) { "E2EE_LOCAL_CONFLICT" }
            val next = rows.toMutableMap()
            for (change in changes) if (change.value == null) next.remove(change.key) else next[change.key] = change.value
            requireOpen(); rows = next
        }
    }
    private class Device(override val ownerId: String, private val storage: Memory,
        private val privateKeys: E2eeKeys.DeviceKeys = E2eeKeys.generateDeviceKeys(), override val deviceId: String = "device-one",
        private val localRoot: javax.crypto.SecretKey = E2eeEnvelope.importRoot(E2eeKeys.freshSecret())) : E2eeScopeDevice {
        override val vault = UnlockedE2eeVault(storage, UnlockedE2eeVault.Scope(ownerId, "device:$deviceId", deviceId, 1, 1, 1, "local-one",
            privateKeys.signing.private, mapOf("local-one" to localRoot)) { if (it == deviceId) privateKeys.signing.public else null })
        override fun requireOpen() { vault.requireOpen() }
        override fun keys(): E2eeKeys.DeviceKeys { requireOpen(); return privateKeys }
        override fun ensureDurableKeys() { requireOpen() }
        override fun rememberDirectory(scopeId: String, pin: JSONObject, events: JSONArray, scopeOwner: String,
            onVerified: ((E2eeDirectory.Verified) -> Unit)?): E2eeDirectory.Verified {
            val old = vault.read("key-check", "directory")
            try {
                val previous = old?.let { JSONObject(it.bytes.toString(Charsets.UTF_8)).let { saved -> E2eeDirectory.Checkpoint(saved.getLong("revision"), saved.getString("hash")) } }
                val value = E2eeDirectory.verify(scopeOwner, scopeId, pin, events, previous, onVerified)
                val bytes = JSONObject().put("revision", value.checkpoint.revision).put("hash", value.checkpoint.hash)
                    .put("ownerId",scopeOwner).put("pin",pin).put("events",events).toString().toByteArray()
                try { vault.write(listOf(UnlockedE2eeVault.Write("key-check", "directory", bytes, old?.serial))) } finally { bytes.fill(0) }
                return value
            } finally { old?.bytes?.fill(0) }
        }
        override fun savedDirectory(scopeId: String, onVerified: ((E2eeDirectory.Verified) -> Unit)?): E2eeDirectory.Verified? {
            val row = vault.read("key-check","directory") ?: return null
            try { val saved = JSONObject(row.bytes.toString(Charsets.UTF_8))
                return E2eeDirectory.verify(saved.getString("ownerId"),scopeId,saved.getJSONObject("pin"),saved.getJSONArray("events"),
                    E2eeDirectory.Checkpoint(saved.getLong("revision"),saved.getString("hash")),onVerified)
            } finally { row.bytes.fill(0) }
        }
        fun reopen(): Device { vault.lock(); return Device(ownerId, storage, privateKeys, deviceId, localRoot) }
    }
    private class Fixture(val crashAtWrite: Int = 0, val crashBeforePut: Boolean = false, val crashAfterCancel: Boolean = false) : E2eeScopeTransport {
        val owner = "native-owner"; val scope = "personal:native-owner"; val storage = Memory()
        var device = Device(owner, storage)
        val recovery = E2eeKeys.createRecoveryKit(owner); val root = E2eeKeys.freshSecret(); val events = JSONArray()
        val objects = mutableMapOf<String, E2eeEnvelope.Envelope>(); val receipts = mutableMapOf<String, JSONObject>()
        var retired = JSONArray(); var writes = 0; var crashed = false; var beforeCrashed = false; var cancelCrashed = false
        var lastPut: JSONObject? = null
        var online = true; var network = 0
        lateinit var verified: E2eeDirectory.Verified
        init {
            val keys = E2eeKeys.publicKeys(device.keys())
            val command = JSONObject().put("protocol", 1).put("ownerId", owner).put("scopeId", scope).put("deviceId", device.deviceId)
                .put("action", "bootstrap").put("expectedRevision", 0).put("checkpointHash", "genesis").put("securityEpoch", 1).put("operationId", "bootstrap")
                .put("payload", JSONObject().put("kind", "personal").put("resourceId", owner).put("keyId", "root-one").put("generation", 1)
                    .put("recoveryKit", recovery.kit).put("deviceKeys", keys)
                    .put("deviceCapsule", E2eeKeys.sealRoot(root, keys.getString("receivingKey"), E2eeKeys.RootRecipient(owner, scope, 1, "root-one", device.deviceId)))
                    .put("recoveryCapsule", E2eeKeys.sealRoot(root, recovery.kit.getJSONObject("authority").getString("receivingKey"), E2eeKeys.RootRecipient(owner, scope, 1, "root-one", "recovery"))))
            command.getJSONObject("payload").put("selfProof", E2eeCommands.sign(command, device.keys().signing.private).get("signature"))
            events.put(E2eeCommands.sign(command, recovery.keys.signing.private)); verify()
            append("migration-commit", JSONObject().put("migrationId", "synthetic").put("fence", 1).put("generation", 1)
                .put("manifestHash", E2eeFiles.objectManifestHash(JSONArray())).put("objectCount", 0).put("verifiedCheckpoint", E2eeEnvelope.encode(E2eeKeys.freshSecret())))
        }
        fun verify() { verified = E2eeDirectory.verify(owner, scope, recovery.kit.getJSONObject("authority"), events) }
        fun append(action: String, payload: JSONObject) {
            events.put(E2eeCommands.sign(JSONObject().put("protocol", 1).put("ownerId", owner).put("scopeId", scope).put("deviceId", device.deviceId)
                .put("action", action).put("expectedRevision", verified.checkpoint.revision).put("checkpointHash", verified.checkpoint.hash)
                .put("securityEpoch", verified.securityEpoch).put("operationId", UUID.randomUUID().toString()).put("payload", payload), device.keys().signing.private))
            verify()
        }
        fun client() = E2eeScopeClient(device, owner, scope, recovery.kit.getJSONObject("authority"), this)
        fun reopen(): E2eeScopeClient { device = device.reopen(); return client() }
        fun rotate(): ByteArray {
            retired = JSONArray(objects.values.map { e -> e.context.toJson().let { JSONObject().put("domain", it.get("domain")).put("objectId", it.get("objectId"))
                .put("revision", it.get("revision")).put("payloadHash", E2eeEnvelope.payloadHash(e)) } })
            val next = E2eeKeys.freshSecret()
            append("rotate", JSONObject().put("revokedDeviceIds", JSONArray()).put("cryptoEpoch", 2).put("securityEpoch", 2).put("keyId", "root-two")
                .put("capsules", JSONArray().put(JSONObject().put("deviceId", device.deviceId).put("capsule", E2eeKeys.sealRoot(next,
                    E2eeKeys.publicKeys(device.keys()).getString("receivingKey"), E2eeKeys.RootRecipient(owner, scope, 2, "root-two", device.deviceId)))))
                .put("recoveryCapsule", E2eeKeys.sealRoot(next, recovery.kit.getJSONObject("authority").getString("receivingKey"), E2eeKeys.RootRecipient(owner, scope, 2, "root-two", "recovery")))
                .put("retiredManifestHash", E2eeFiles.objectManifestHash(retired)).put("retiredObjectCount", retired.length()))
            return next
        }
        override fun directory(scopeId: String): JSONObject { network++; check(online) { "SYNTHETIC_OFFLINE" }; return JSONObject().put("events", JSONArray(events.toString())) }
        override fun command(packet: JSONObject): JSONObject {
            network++; check(online) { "SYNTHETIC_OFFLINE" }
            val command = E2eeCommands.verify(packet, device.keys().signing.public); val identity = E2eeCommands.hash(command)
            receipts[command.getString("operationId")]?.let { check(it.get("payloadHash") == identity); return it.getJSONObject("result") }
            check(command.getLong("expectedRevision") == verified.checkpoint.revision && command.get("checkpointHash") == verified.checkpoint.hash
                && command.getLong("securityEpoch") == verified.securityEpoch)
            val payload = command.getJSONObject("payload")
            if (command.getString("action") == "cancel-put") {
                val original = payload.getJSONObject("original").getJSONObject("command"); val hash = E2eeCommands.hash(original)
                val old = receipts.getOrPut(original.getString("operationId")) { JSONObject().put("payloadHash", hash).put("result", JSONObject().put("cancelled", true)) }
                check(old.get("payloadHash") == hash)
                val result = JSONObject().put("operationReceipt", old)
                receipts[command.getString("operationId")] = JSONObject().put("payloadHash", identity).put("result", result)
                if (crashAfterCancel && !cancelCrashed) { cancelCrashed = true; error("SYNTHETIC_PROCESS_DEATH") }; return result
            }
            lastPut = JSONObject(packet.toString())
            if (crashBeforePut && !beforeCrashed) { beforeCrashed = true; error("SYNTHETIC_PROCESS_DEATH") }
            val e = E2eeEnvelope.Envelope.fromJson(payload.getJSONObject("envelope")); val context = e.context.toJson()
            val key = "${context.getString("domain")}\u0000${context.getString("objectId")}"
            check((objects[key]?.context?.toJson()?.getLong("revision") ?: 0) == payload.getLong("expectedObjectRevision")) { "E2EE_OBJECT_CONFLICT" }
            val result = JSONObject().put("revision", context.get("revision")).put("generation", context.get("dataGeneration")).put("payloadHash", E2eeEnvelope.payloadHash(e))
            objects[key] = e; receipts[command.getString("operationId")] = JSONObject().put("payloadHash", identity).put("result", result); writes++
            if (writes == crashAtWrite && !crashed) { crashed = true; error("SYNTHETIC_PROCESS_DEATH") }; return result
        }
        override fun read(packet: JSONObject): JSONObject {
            network++; check(online) { "SYNTHETIC_OFFLINE" }
            val command = E2eeCommands.verify(packet, device.keys().signing.public); check(command.get("checkpointHash") == verified.checkpoint.hash)
            val payload = command.getJSONObject("payload")
            val result = JSONObject().put("checkpointHash", command.get("checkpointHash")).put("directoryRevision", command.get("expectedRevision"))
            return when (command.getString("action")) {
                "receipt" -> result.put("receipt", receipts[payload.getString("operationId")] ?: JSONObject.NULL)
                "sealed-heads" -> result.put("objects", if (payload.getLong("cryptoEpoch") == 0L) JSONArray() else retired)
                else -> result.put("envelopes", JSONArray().apply { objects["${payload.getString("domain")}\u0000${payload.getString("objectId")}"]?.let { put(it.toJson()) } })
            }
        }
        fun clearFloors() { storage.rows = storage.rows.filterValues { !it.envelope.context.toJson().getString("objectId").startsWith("floor:") }.toMutableMap() }
    }
    private fun reject(message: String, action: () -> Unit) { try { action() } catch (error: Exception) { assertEquals(message, error.message); return }; fail("Forbidden operation accepted") }
    @Test fun restartRetriesExactCiphertextAfterLostAcknowledgement() {
        val f = Fixture(crashAtWrite = 1); var client = f.client(); client.refresh()
        client.prepare("workspace", "one", "PRIVATE OFFLINE EDIT".toByteArray(), 0)
        assertEquals(0, f.writes); assertFalse(f.storage.rows.values.any { it.envelope.toJson().toString().contains("PRIVATE OFFLINE") })
        reject("SYNTHETIC_PROCESS_DEATH") { client.flush("workspace", "one") }
        val old = requireNotNull(f.lastPut).toString(); client = f.reopen(); client.refresh()
        assertEquals("PRIVATE OFFLINE EDIT", client.readDraft("workspace", "one")!!.toString(Charsets.UTF_8))
        assertEquals(1L, client.flush("workspace", "one")); assertEquals(2, f.writes)
        assertTrue(f.receipts.values.any { it.get("payloadHash") == E2eeCommands.hash(JSONObject(old).getJSONObject("command")) })
        assertEquals("PRIVATE OFFLINE EDIT", client.read("workspace", "one")!!.bytes.toString(Charsets.UTF_8))
    }
    @Test fun fullStorageAndLockCannotAcceptOrLoseDrafts() {
        val f = Fixture(); val client = f.client(); client.refresh(); f.storage.full = true
        reject("SYNTHETIC_DISK_FULL") { client.prepare("diary", "one", byteArrayOf(1), 0) }; assertEquals(0, f.writes)
        f.storage.full = false; client.prepare("diary", "one", byteArrayOf(1), 0)
        reject("E2EE_PENDING_SAVE_REQUIRED") { client.prepare("diary", "one", byteArrayOf(2), 0) }
        f.device.vault.lock(); reject("E2EE_UNLOCK_REQUIRED") { client.flush("diary", "one") }; assertEquals(0, f.writes)
        val reopened = f.reopen(); reopened.refresh(); assertArrayEquals(byteArrayOf(1), reopened.readDraft("diary", "one"))
    }
    @Test fun signedRotationFloorRejectsCurrentEpochRollbackWithoutLocalFloor() {
        val f = Fixture(); val client = f.client(); client.refresh()
        for (expected in 0L..1L) { client.prepare("workspace", "one", "version-${expected + 1}".toByteArray(), expected); client.flush("workspace", "one") }
        val original = f.objects.getValue("workspace\u0000one"); val root = f.rotate(); client.refresh(); f.clearFloors()
        reject("E2EE_OBJECT_CONFLICT") { client.prepare("workspace", "one", "STALE".toByteArray(), 0) }
        val stale = E2eeFiles.seal(E2eeEnvelope.importRoot(root), f.device.keys().signing.private,
            E2eeEnvelope.Context.fromJson(original.context.toJson().put("cryptoEpoch", 2).put("securityEpoch", 2).put("keyId", "root-two").put("revision", 1).put("operationId", "stale")),
            "STALE BUT AUTHENTIC".toByteArray(), "", "application/json")
        f.objects["workspace\u0000one"] = stale.manifest
        reject("E2EE_REMOTE_ROLLBACK") { client.read("workspace", "one") }
    }
    @Test fun rebaseRetainsMetadataAndBlocksDelayedOriginalAfterCrash() {
        val f = Fixture(crashBeforePut = true, crashAfterCancel = true); var client = f.client(); client.refresh()
        client.prepare("attachment", "photo", "SYNTHETIC IMAGE".toByteArray(), 0, "private.png", "image/png")
        reject("SYNTHETIC_PROCESS_DEATH") { client.flush("attachment", "photo") }; val original = requireNotNull(f.lastPut)
        f.rotate(); client.refresh(); reject("SYNTHETIC_PROCESS_DEATH") { client.rebase("attachment", "photo", 0) }
        client = f.reopen(); client.refresh(); assertEquals("rebased", client.rebase("attachment", "photo", 0))
        assertEquals(true, f.command(original).getBoolean("cancelled")); client.flush("attachment", "photo")
        val opened = client.read("attachment", "photo")!!
        assertEquals("private.png", opened.filename); assertEquals("image/png", opened.mediaType); assertEquals("SYNTHETIC IMAGE", opened.bytes.toString(Charsets.UTF_8))
        assertFalse(f.storage.rows.values.any { it.envelope.toJson().toString().contains("private.png") })
    }
    @Test fun signedExistenceAndHistoricalAuthenticitySurviveCleanFloor() {
        val f = Fixture(); val client = f.client(); client.refresh(); client.prepare("diary", "one", "HISTORY".toByteArray(), 0); client.flush("diary", "one")
        val original = f.objects.getValue("diary\u0000one"); f.rotate(); client.refresh(); f.clearFloors()
        assertEquals("HISTORY", client.read("diary", "one")!!.bytes.toString(Charsets.UTF_8)); f.clearFloors()
        f.objects.remove("diary\u0000one"); reject("E2EE_REMOTE_ROLLBACK") { client.read("diary", "one") }
        f.objects["diary\u0000one"] = E2eeEnvelope.seal(E2eeEnvelope.importRoot(f.root), f.device.keys().signing.private,
            E2eeEnvelope.Context.fromJson(original.context.toJson().put("operationId", "forged")), "FORGED LATER".toByteArray())
        reject("E2EE_REMOTE_ROLLBACK") { client.read("diary", "one") }
    }
    @Test fun offlineUnlockPreservesDraftAndAcceptsNewEditsWithoutNetwork() {
        val f=Fixture();var client=f.client();client.refresh();client.prepare("diary","one","SAVED BEFORE OFFLINE".toByteArray(),0)
        client=f.reopen();f.online=false;val requests=f.network
        assertEquals("SAVED BEFORE OFFLINE",client.readDraft("diary","one")!!.toString(Charsets.UTF_8))
        client.hydrateOffline();client.prepare("diary","two","NEW OFFLINE DRAFT".toByteArray(),0)
        assertEquals("NEW OFFLINE DRAFT",client.readDraft("diary","two")!!.toString(Charsets.UTF_8));assertEquals(requests,f.network)
        reject("E2EE_REFRESH_REQUIRED"){client.flush("diary","two")};assertEquals(requests,f.network)
    }
}
