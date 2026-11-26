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
        var beforeCommit: ((List<E2eeStorageChange>) -> Unit)? = null
        var beforeGet: ((String) -> Unit)? = null
        override fun get(key: String): E2eeLocalRecord? { beforeGet?.invoke(key); return rows[key] }
        override fun list(prefix: String) = rows.keys.filter { it.startsWith(prefix) }
        override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
            requireOpen(); check(!full) { "SYNTHETIC_DISK_FULL" }
            beforeCommit?.invoke(changes)
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
        var durable = true
        override fun ensureDurableKeys() { requireOpen(); check(durable) { "E2EE_DEVICE_KEY_UNAVAILABLE" } }
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
    private class Fixture(val crashAtWrite: Int = 0, val crashBeforePut: Boolean = false, val crashAfterCancel: Boolean = false, val kind:String="personal") : E2eeScopeTransport {
        val owner = "native-owner"; val scope = "$kind:native-owner"; val storage = Memory()
        var device = Device(owner, storage)
        val recovery = E2eeKeys.createRecoveryKit(owner); val root = E2eeKeys.freshSecret(); val events = JSONArray()
        val objects = mutableMapOf<String, E2eeEnvelope.Envelope>(); val receipts = mutableMapOf<String, JSONObject>()
        var retired = JSONArray(); var writes = 0; var crashed = false; var beforeCrashed = false; var cancelCrashed = false
        var lastPut: JSONObject? = null
        var online = true; var network = 0
        var onCommandResult: ((JSONObject) -> Unit)? = null
        lateinit var verified: E2eeDirectory.Verified
        init {
            val keys = E2eeKeys.publicKeys(device.keys())
            val command = JSONObject().put("protocol", 1).put("ownerId", owner).put("scopeId", scope).put("deviceId", device.deviceId)
                .put("action", "bootstrap").put("expectedRevision", 0).put("checkpointHash", "genesis").put("securityEpoch", 1).put("operationId", "bootstrap")
                .put("payload", JSONObject().put("kind", kind).put("resourceId", owner).put("keyId", "root-one").put("generation", 1)
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
            onCommandResult?.invoke(packet)
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
    // Actual native vault/envelope/directory/business-proof crypto; only the
    // server projection and HTTP delivery are modeled by this component port.
    private class ImmutableProductFixture {
        val f=Fixture(kind="project");lateinit var page:JSONObject;var bodyGets=0;var indexReads=0
        private val transport=object:E2eeScopeTransport by f {
            override fun read(packet:JSONObject):JSONObject {
                if(packet.getJSONObject("command").getString("action")=="product-index"){indexReads++;return JSONObject(page.toString())}
                if(packet.getJSONObject("command").getString("action")=="get")bodyGets++
                return f.read(packet)
            }
        }
        private fun client()=E2eeScopeClient(f.device,f.owner,f.scope,f.recovery.kit.getJSONObject("authority"),transport)
        var scopeClient=client();private lateinit var baseline:JSONObject;private lateinit var stage:JSONObject
        private fun proof(action:String,payload:JSONObject):JSONObject {
            val directory=scopeClient.refresh()
            val command=JSONObject().put("protocol",1).put("ownerId",f.owner).put("scopeId",f.scope).put("deviceId",f.device.deviceId)
                .put("action",action).put("expectedRevision",directory.checkpoint.revision).put("checkpointHash",directory.checkpoint.hash)
                .put("securityEpoch",directory.securityEpoch).put("operationId",UUID.randomUUID().toString()).put("payload",payload)
            return JSONObject().put("proofHash",E2eeCommands.hash(command)).put("packet",E2eeCommands.sign(command,f.device.keys().signing.private).toString())
        }
        fun model()=E2eeSharedProduct(f.device,scopeClient,f.scope,f.device::requireOpen){_,body,_->body}
        fun update(title:String,revision:Int=1) {
            scopeClient.refresh();val objectId="product-version:${UUID.randomUUID()}";val metadata=JSONObject().put("protocol",1)
            val version=JSONObject().put("protocol",1).put("scopeId",f.scope).put("entityId","label:immutable-cache").put("kind","label").put("revision",revision)
                .put("parentId",JSONObject.NULL).put("deleted",false).put("metadata",metadata).put("body",JSONObject().put("title",title))
            val bytes=version.toString().toByteArray();try{scopeClient.prepare("shared-project",objectId,bytes,0);scopeClient.flush("shared-project",objectId)}finally{bytes.fill(0)}
            val reference=scopeClient.objectReference("shared-project",objectId)
            val entity=JSONObject().put("entityId","label:immutable-cache").put("kind","label").put("revision",revision).put("domain","shared-project")
                .put("objectId",objectId).put("payloadHash",reference.get("payloadHash")).put("parentId",JSONObject.NULL).put("authorId",f.owner).put("deleted",false).put("metadata",metadata).put("updatedAt","2026-11-24T00:00:00Z")
            val operation=JSONObject().put("action",if(revision==1)"create" else "update").put("entityId",entity.get("entityId")).put("kind","label").put("expectedRevision",revision-1)
                .put("domain","shared-project").put("objectId",objectId).put("payloadHash",entity.get("payloadHash")).put("parentId",JSONObject.NULL).put("metadata",metadata).put("proposalId",JSONObject.NULL)
            val head=if(revision==1){
                stage=proof("product-bootstrap-stage",JSONObject().put("intentId","cache-stage").put("bootstrapId","cache-bootstrap").put("partIndex",0).put("items",JSONArray().put(JSONObject().put("operation",operation).put("authorId",f.owner))))
                baseline=proof("product-bootstrap-complete",JSONObject().put("intentId","cache-complete").put("bootstrapId","cache-bootstrap").put("parts",JSONArray().put(JSONObject().put("partIndex",0).put("proofHash",stage.get("proofHash")))).put("expectedCount",1));stage
            }else proof("product-commit",JSONObject().put("intentId",UUID.randomUUID().toString()).put("operations",JSONArray().put(operation)))
            page=JSONObject().put("entities",JSONArray().put(entity)).put("heads",JSONArray().put(JSONObject().put("entityId",entity.get("entityId")).put("revision",revision).put("proofHash",head.get("proofHash"))))
                .put("proofs",JSONArray().put(baseline).put(head)).put("proposals",JSONArray()).put("attestations",JSONArray()).put("bootstrapProofHash",baseline.get("proofHash"))
                .put("checkpointHash",f.verified.checkpoint.hash).put("directoryRevision",f.verified.checkpoint.revision)
        }
        fun cold():E2eeSharedProduct{f.device=f.device.reopen();scopeClient=client();return model()}
        init{update("PRIVATE NATIVE IMMUTABLE CANARY")}
    }
    @Test fun immutableSnapshotsReuseEncryptedBodiesOnlyAfterFreshAuthorizationAndSurviveRestart() {
        val f=ImmutableProductFixture();try{
            val model=f.model();val before=f.bodyGets;val first=model.versions();val gets=f.bodyGets
            assertEquals("One manifest and one content chunk",2,gets-before)
            first.getJSONObject(0).getJSONObject("body").put("title","caller mutation")
            assertEquals("PRIVATE NATIVE IMMUTABLE CANARY",model.versions().getJSONObject(0).getJSONObject("body").getString("title"));assertEquals(gets,f.bodyGets);assertEquals(2,f.indexReads)
            assertEquals("PRIVATE NATIVE IMMUTABLE CANARY",f.cold().versions().getJSONObject(0).getJSONObject("body").getString("title"));assertEquals(gets,f.bodyGets);assertEquals(3,f.indexReads)
        }finally{f.f.device.vault.lock()}
    }
    @Test fun privateDocumentChecksTheExpectedReferenceBeforeCachingItsContents() {
        val f=ImmutableProductFixture();try{
            val entity=f.page.getJSONArray("entities").getJSONObject(0)
            val document=E2eePrivateDocument(f.f.device,f.scopeClient,f.f.scope,
                entity.getString("domain"),entity.getString("objectId"),{it},f.f.device::requireOpen,f.f.device::requireOpen)
            val expected=JSONObject().put("revision",2).put("payloadHash",entity.get("payloadHash")).put("currentGeneration",true)
            val before=f.bodyGets
            reject("E2EE_MANIFEST_MISMATCH"){document.load(expected=expected)}
            assertEquals(1,f.bodyGets-before)
            reject("E2EE_OFFLINE_CONTENT_UNAVAILABLE"){document.load(offline=true)}
            val opened=document.load(expected=expected.put("revision",1))
            assertEquals("PRIVATE NATIVE IMMUTABLE CANARY",opened.value.getJSONObject("body").getString("title"))
        }finally{f.f.device.vault.lock()}
    }
    @Test fun changedSignedHeadsFetchNewBytesAndForgedHeadsCannotSelectTheNativeCache() {
        val f=ImmutableProductFixture();try{
            val model=f.model();model.versions();val gets=f.bodyGets;f.update("new native immutable body",2)
            val next=model.versions().getJSONObject(0);assertEquals(2,next.getInt("revision"));assertEquals("new native immutable body",next.getJSONObject("body").getString("title"));assertTrue(f.bodyGets>gets)
            val acceptedGets=f.bodyGets;f.page.getJSONArray("entities").getJSONObject(0).put("payloadHash",E2eeEnvelope.encode(E2eeKeys.freshSecret()))
            reject("E2EE_PRODUCT_PROOF_INVALID"){model.versions()};assertEquals(acceptedGets,f.bodyGets)
        }finally{f.f.device.vault.lock()}
    }
    @Test fun refusedOnlineAuthorizationAndLockNeverReturnCachedNativeContent() {
        val f=ImmutableProductFixture();try{
            val model=f.model();model.versions();val gets=f.bodyGets;val reads=f.indexReads;f.f.online=false
            reject("SYNTHETIC_OFFLINE"){model.versions()};assertEquals(gets,f.bodyGets);assertEquals(reads,f.indexReads)
            f.f.device.vault.lock();reject("E2EE_UNLOCK_REQUIRED"){model.versions()};assertEquals(gets,f.bodyGets)
        }finally{f.f.device.vault.lock()}
    }
    private fun reject(message: String, action: () -> Unit) { try { action() } catch (error: Exception) { assertEquals(message, error.message); return }; fail("Forbidden operation accepted") }
    @Test fun retainedSharedTrustUploadIsReadOnlyAndUsesTheNormalDomainRegistry() {
        val f=Fixture();val client=f.client();client.refresh()
        val bytes=JSONObject().put("protocol",1).put("ownerId",f.owner).put("document",JSONObject().put("scopes",JSONArray())).put("base",JSONObject().put("scopes",JSONArray())).toString().toByteArray()
        client.prepare("key-check","personal-shared-trust-live-v1",bytes,0)
        val file=generateSequence(java.io.File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}.map{java.io.File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile}
        val inventory=E2eePrivatePaths(JSONObject(file.readText()));val claims=mutableMapOf<Pair<String,String>,String>()
        val readOnly=object:E2eeDeviceReadView {
            override val ownerId=f.owner
            override val deviceId=f.device.deviceId
            override val authorityPin=f.recovery.kit.getJSONObject("authority")
            override val vault=f.device.vault
            override fun requireOpen()=f.device.requireOpen()
            override fun readKeys()=f.device.keys().let{E2eeKeys.ReadKeys(E2eeKeys.publicKeys(it),it.receiving,it.signing.public)}
            override fun readSavedDirectory(scopeId:String,onVerified:((E2eeDirectory.Verified)->Unit)?)=f.device.savedDirectory(scopeId,onVerified)
        }
        f.storage.beforeCommit={error("READ_ONLY_CUSTODY_MUST_NOT_WRITE")}
        try{
            E2eeRetainedProductCustody.inspect(E2eeRetainedProductCustody.Options(readOnly,f.device.vault,inventory,
                f.device.vault.listMigrationPlanOutputs().first,emptyList(),emptyList(),emptyList(),f.scope,f.device::requireOpen,
                {domain,id->claims.containsKey(domain to id)}, {domain,id,scope,role->assertEquals(f.scope,scope);claims[domain to id]=role},
                {scope,select->assertEquals(f.scope,scope);assertTrue(select(f.verified));f.verified}))
            assertTrue(claims.values.contains("product-job"));assertTrue(claims.values.contains("product-cipher"));assertEquals(0,f.writes)
            assertFalse(inventory.allowsProductDomain("project","diary"));assertFalse(inventory.allowsProductDomain("space","workspace"))
        }finally{bytes.fill(0);f.device.vault.lock()}
    }

    @Test fun parameterlessReadsAndBootstrapCursorsUseUnambiguousSignedPayloads() {
        val f=Fixture();val actions=setOf("stoicheion-state","product-context","resource-transition-candidates","shared-read-history","advice-policy")
        val seen=mutableListOf<String>();val cursors=mutableListOf<Any>()
        val transport=object:E2eeScopeTransport by f {
            override fun read(packet:JSONObject):JSONObject {
                val command=E2eeCommands.verify(packet,f.device.keys().signing.public);val action=command.getString("action")
                if(action !in actions&&action!="product-bootstrap-state")return f.read(packet)
                val payload=command.getJSONObject("payload");val result=JSONObject().put("checkpointHash",command.get("checkpointHash")).put("directoryRevision",command.get("expectedRevision"))
                if(action=="product-bootstrap-state"){E2eeKeys.exact(payload,setOf("afterPart"));cursors+=payload.get("afterPart");return result.put("bootstrap",JSONObject.NULL).put("part",JSONObject.NULL)}
                E2eeKeys.exact(payload,setOf("protocol"));assertEquals(1,payload.getInt("protocol"));seen+=action
                return if(action=="shared-read-history")result.put("history",JSONObject().put("ownerId",f.owner).put("readFlags",JSONObject()).put("watching",JSONObject()))else result
            }
        }
        val client=E2eeScopeClient(f.device,f.owner,f.scope,f.recovery.kit.getJSONObject("authority"),transport)
        try {
            client.refresh();client.readStoicheionState();client.readProductContext();client.readTransitionCandidates();client.sharedReadHistory();client.readAdvicePolicy()
            assertEquals(actions,seen.toSet());assertEquals(5,seen.size)
            client.readBootstrapState();for(part in listOf(-1,0,255,256,4095))client.readBootstrapState(part)
            assertEquals(listOf(JSONObject.NULL,JSONObject.NULL,0,255,256,4095),cursors)
            for(part in listOf(-2,4096))reject("E2EE_INVALID_LIMIT"){client.readBootstrapState(part)}
            assertEquals(0,f.writes);reject("E2EE_INVALID_COMMAND"){E2eeCommands.canonical(JSONObject())}
        }finally{f.device.vault.lock()}
    }
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
    @Test fun repeatedOfflineEditsSurvivePendingUploadRestartAndFullDisk() {
        val f=Fixture(crashAtWrite=1);var client=f.client();client.refresh();var editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
        val first=editor.stage("FIRST EDIT".toByteArray(),null,0);editor.stage("SECOND EDIT".toByteArray(),first,0)
        reject("SYNTHETIC_PROCESS_DEATH"){editor.flush()}
        val previous=editor.load()!!;editor.stage("THIRD EDIT WHILE PENDING".toByteArray(),previous.serial,0)
        f.storage.full=true;val saved=editor.load()!!;reject("SYNTHETIC_DISK_FULL"){editor.stage("MUST NOT REPLACE".toByteArray(),saved.serial,0)};f.storage.full=false
        client=f.reopen();client.hydrateOffline();editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
        assertEquals("THIRD EDIT WHILE PENDING",editor.load()!!.bytes.toString(Charsets.UTF_8));client.refresh();assertEquals(2L,editor.flush())
        assertEquals("THIRD EDIT WHILE PENDING",client.read("diary","one")!!.bytes.toString(Charsets.UTF_8));assertFalse(editor.load()!!.pending)
    }
    @Test fun newEditDuringAcknowledgementIsRetainedAndStaleTabCannotOverwriteIt() {
        val f=Fixture();val client=f.client();client.refresh();val editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
        val oldSerial=editor.stage("INITIAL".toByteArray(),null,0);var edited=false
        f.onCommandResult={packet->if(!edited&&packet.getJSONObject("command").getJSONObject("payload").getJSONObject("envelope").getJSONObject("context").getString("domain")=="diary"){
            edited=true;val saved=editor.load()!!;editor.stage("EDIT DURING ACK".toByteArray(),saved.serial,saved.remoteRevision)
        }}
        assertEquals(2L,editor.flush());assertEquals("EDIT DURING ACK",client.read("diary","one")!!.bytes.toString(Charsets.UTF_8))
        val second=E2eeEditorQueue(f.device,client,f.scope,"diary","one");reject("E2EE_LOCAL_CONFLICT"){second.stage("STALE TAB".toByteArray(),oldSerial,0)}
    }
    @Test fun crashBetweenScopeReceiptAndEditorCommitNeedsNoSecondRemoteWrite() {
        val f=Fixture();val client=f.client();client.refresh();val editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
        editor.stage("PRIVATE FINAL EDIT".toByteArray(),null,0);var crashed=false
        f.storage.beforeCommit={changes->if(f.writes==2&&!crashed&&changes.any{it.value?.envelope?.context?.toJson()?.getString("objectId")?.startsWith("editor:")==true}){
            crashed=true;error("SYNTHETIC_PROCESS_DEATH")
        }}
        reject("SYNTHETIC_PROCESS_DEATH"){editor.flush()};assertTrue(client.localJob("diary","one")!!.complete)
        val writes=f.writes;assertEquals(1L,editor.flush());assertEquals(writes,f.writes);assertFalse(editor.load()!!.pending)
    }
    @Test fun missingDurableKeyBlocksNewEditorSaveAndRetainsPreviousSnapshot() {
        val f=Fixture();val client=f.client();client.refresh();val editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
        val serial=editor.stage("PRESERVED".toByteArray(),null,0);f.device.durable=false
        reject("E2EE_DEVICE_KEY_UNAVAILABLE"){editor.stage("UNSAFE".toByteArray(),serial,0)};assertEquals("PRESERVED",editor.load()!!.bytes.toString(Charsets.UTF_8))
    }
    @Test fun actualRebasedRevisionWinsIfAnotherWorkerCompletesBeforeRebaseCall() {
        val f=Fixture(crashBeforePut=true);val client=f.client();client.refresh();val editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
        editor.stage("LOCAL EDIT".toByteArray(),null,0);reject("SYNTHETIC_PROCESS_DEATH"){editor.flush()}
        val context=requireNotNull(f.lastPut).getJSONObject("command").getJSONObject("payload").getJSONObject("envelope").getJSONObject("context")
            .put("domain","diary").put("objectId","one").put("revision",5).put("operationId","other-device-head")
        val remote=E2eeFiles.seal(E2eeEnvelope.importRoot(f.root),f.device.keys().signing.private,E2eeEnvelope.Context.fromJson(context),"OTHER EDIT".toByteArray(),"","application/json")
        f.objects["diary\u0000one"]=remote.manifest;for(chunk in remote.chunks)f.objects["attachment\u0000${chunk.context.toJson().getString("objectId")}"]=chunk
        var interleaved=false
        f.storage.beforeGet={key->if(!interleaved&&f.storage.rows[key]?.envelope?.context?.toJson()?.getString("objectId")?.startsWith("editor:")==true){
            interleaved=true;val job=client.localJob("diary","one")!!;client.rebase("diary","one",5,originId=job.originId);client.flush("diary","one",job.originId)
        }}
        assertEquals("already-confirmed",editor.rebasePending(5));val saved=editor.load()!!;assertEquals(6L,saved.remoteRevision);assertFalse(saved.pending)
        editor.stage("NEXT".toByteArray(),saved.serial,6)
    }
    @Test fun crossScopeOrDeviceQueueIsRejectedBeforeAcceptingPrivateText() {
        val f=Fixture();val client=f.client()
        reject("E2EE_SCOPE_BINDING_MISMATCH"){E2eeEditorQueue(f.device,client,"project:foreign","mindmap","one")}
        reject("E2EE_SCOPE_BINDING_MISMATCH"){E2eeEditorQueue(Device(f.owner,Memory()),client,f.scope,"mindmap","one")}
        assertTrue(f.storage.rows.isEmpty());assertEquals(0,f.writes)
    }
    @Test fun verifiedRemoteUpdateCanReconcileCleanAndUnpreparedDirtyEditor() {
        for(dirty in listOf(false,true)){
            val f=Fixture();val client=f.client();client.refresh();val editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
            editor.stage("INITIAL".toByteArray(),null,0);editor.flush();var saved=editor.load()!!
            if(dirty){editor.stage("UNSENT".toByteArray(),saved.serial,1);saved=editor.load()!!}
            client.prepare("diary","one","REMOTE UPDATE".toByteArray(),1);client.flush("diary","one");client.read("diary","one")
            if(dirty)reject("E2EE_OBJECT_CONFLICT"){editor.flush()}
            saved=editor.load()!! // Failed preparation still retains its durable origin.
            reject("E2EE_VERIFIED_REMOTE_REQUIRED"){editor.reconcile("UNVERIFIED".toByteArray(),saved.serial,3)}
            val retained=f.storage.rows.size
            editor.reconcile((if(dirty)"MERGED LOCAL AND REMOTE" else "REMOTE UPDATE").toByteArray(),saved.serial,2,cache=!dirty)
            assertTrue(f.storage.rows.size>retained);saved=editor.load()!!;assertEquals(2L,saved.remoteRevision);assertEquals(dirty,saved.pending)
            if(!dirty)editor.stage("NEXT EDIT".toByteArray(),saved.serial,2)
            assertEquals(3L,editor.flush())
        }
    }
    @Test fun reconciliationCanConsumeOlderCompletedReceiptWithoutDowngradingNewBase() {
        val f=Fixture();val client=f.client();client.refresh();val editor=E2eeEditorQueue(f.device,client,f.scope,"diary","one")
        editor.stage("LOCAL A".toByteArray(),null,0);var crashed=false
        f.storage.beforeCommit={changes->if(f.writes==2&&!crashed&&changes.any{it.value?.envelope?.context?.toJson()?.getString("objectId")?.startsWith("editor:")==true}){
            crashed=true;error("SYNTHETIC_PROCESS_DEATH")
        }}
        reject("SYNTHETIC_PROCESS_DEATH"){editor.flush()};assertTrue(client.localJob("diary","one")!!.complete)
        val original=f.objects.getValue("diary\u0000one")
        val remote=E2eeFiles.seal(E2eeEnvelope.importRoot(f.root),f.device.keys().signing.private,
            E2eeEnvelope.Context.fromJson(original.context.toJson().put("revision",2).put("operationId","remote-after-crash")),"REMOTE B".toByteArray(),"","application/json")
        f.objects["diary\u0000one"]=remote.manifest;for(chunk in remote.chunks)f.objects["attachment\u0000${chunk.context.toJson().getString("objectId")}"]=chunk
        client.read("diary","one");val saved=editor.load()!!;editor.reconcile("MERGED A AND B".toByteArray(),saved.serial,2)
        assertEquals(3L,editor.flush());assertEquals(3L,editor.load()!!.remoteRevision)
        assertEquals("MERGED A AND B",client.read("diary","one")!!.bytes.toString(Charsets.UTF_8))
    }
}
