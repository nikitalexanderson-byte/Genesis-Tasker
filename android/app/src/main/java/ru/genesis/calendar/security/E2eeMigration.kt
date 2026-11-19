package ru.genesis.calendar.security

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONArray
import org.json.JSONObject
import java.security.MessageDigest
import java.security.PrivateKey
import java.security.PublicKey
import java.util.UUID
import javax.crypto.SecretKey

/** The caller must use this same fence for every legacy writer in the scope.
 * Holding it protects local capture/reconciliation; the server lease independently
 * fences other clients. It is not an account/session restore capability. */
interface E2eeMigrationFence {
    suspend fun <T> withFence(operation: suspend () -> T): T
}
interface E2eeMigrationTransport {
    suspend fun sourceHash(): String
    suspend fun command(packet: JSONObject): JSONObject
    suspend fun readAll(): List<E2eeEnvelope.Envelope>
}

/** Native parity with app/e2ee/migration.ts. Snapshot and new keys must be durable
 * before any network operation. Shadow objects, prior attempts and local work
 * are retained on failure/cancel; an active scope can never downgrade to legacy.
 * Product repositories still have to supply all real source adapters and fence. */
class E2eeMigration(
    private val vault: UnlockedE2eeVault, directory: E2eeDirectory.Verified,
    private val deviceId: String, private val signingKey: PrivateKey, private val signer: PublicKey,
    private val root: SecretKey, private val transport: E2eeMigrationTransport,
    private val sources: E2eeMigrationSource, private val ensureDurableKeys: () -> Unit,
    private val localFence: E2eeMigrationFence, private val verifyRecovery: suspend (SecretKey) -> Unit,
) {
    class Status(val migrationId: String, val phase: String, val uploaded: Int, val planned: Int,
        val ancestors: List<String>, val pendingAction: String?, val resuming: Boolean, val fence: Long?,val localObjects:Int=0,val planReady:Boolean=false) {
        override fun toString() = "E2eeMigration.Status([redacted])"
    }
    private class Loaded(val state: JSONObject, var serial: Long)
    private val ownerId = directory.ownerId
    private val scopeId = directory.scopeId
    private val kind = directory.kind
    private val cryptoEpoch = directory.cryptoEpoch
    private val securityEpoch = directory.securityEpoch
    private val keyId = directory.keyId
    private val initialCheckpoint = directory.checkpoint
    private val required = sources.requiredCoverage.toList()
    private val allowed = sources.allowedContentDomains.toSet()
    private val stateId = "migration:${hash(scopeId.toByteArray(Charsets.UTF_8))}"
    private val mutex = Mutex()
    init {
        sources.assertBinding(ownerId, scopeId, kind)
        E2eeKeys.technical(deviceId)
        check(required.isNotEmpty() && required.toSet().size == required.size && allowed.isNotEmpty()
            && allowed.all(E2eeEnvelope::supportsDomain)) { "E2EE_COVERAGE_REQUIRED" }
    }
    private fun hash(bytes: ByteArray) = E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun encoded(value: JSONObject) = value.toString().toByteArray(Charsets.UTF_8)
    private fun number(value: JSONObject, key: String, minimum: Long = 0) = E2eeCommands.integer(value.get(key), minimum)
    private fun nullable(value: JSONObject, key: String) = if (value.isNull(key)) null else value.getJSONObject(key)
    private fun decode(bytes: ByteArray): JSONObject {
        val state = JSONObject(bytes.toString(Charsets.UTF_8))
        val phases = setOf("preparing", "uploading", "verified", "active", "cancelled")
        val protocol=number(state,"protocol")
        check(protocol in setOf(1L,2L) && state.getString("phase") in phases) { "E2EE_CORRUPT_MIGRATION" }
        E2eeKeys.exact(state,setOf("protocol","migrationId","phase","snapshotParts","snapshotSize","snapshotHash","ancestors","sourceHash","lease","plan","logical","uploaded","manifestHash","verifiedCheckpoint","pending","resuming","checkpointHash","directoryRevision")+
            if(protocol==2L)setOf("local","planned")else emptySet())
        E2eeKeys.technical(state.getString("migrationId"))
        val plan = state.getJSONArray("plan"); val logical = state.getJSONArray("logical"); val ancestors = state.getJSONArray("ancestors")
        check(plan.length() <= 10000 && logical.length() <= 10000 && number(state,"uploaded") <= plan.length()
            && number(state,"snapshotParts") <= 256 && number(state,"snapshotSize") <= E2eeFiles.MAX_FILE_BYTES
            && ancestors.length() <= 32) { "E2EE_CORRUPT_MIGRATION" }
        val seen = mutableSetOf<String>()
        for (index in 0 until ancestors.length()) check(seen.add(E2eeKeys.technical(ancestors.getString(index)))) { "E2EE_CORRUPT_MIGRATION" }
        if(protocol==2L){
            check(state.get("planned") is Boolean){"E2EE_CORRUPT_MIGRATION"}
            val local=localEntries(state)
            check(state.getBoolean("planned")||local.isEmpty()&&plan.length()==0&&logical.length()==0&&state.getString("phase") !in setOf("verified","active")){"E2EE_CORRUPT_MIGRATION"}
        }
        return state
    }
    private fun localEntries(state:JSONObject)=if(number(state,"protocol")==2L)E2eeMigrationLocal.validate(state.getJSONArray("local"),state.getString("migrationId"),allowed)else emptyList()
    private fun verifyLocal(state:JSONObject){for(entry in localEntries(state))E2eeMigrationLocal.open(vault,entry).bytes.fill(0)}
    /** No network/legacy fallback for missing local-only content. */
    fun readLocal(domain:String,objectId:String):E2eeMigrationContent? {
        vault.requireOpen();E2eeKeys.technical(objectId);check(domain in allowed){"E2EE_LOCAL_CONTENT_FORBIDDEN"}
        val state=load().state;check(state.get("phase")=="active"){"E2EE_MIGRATION_UNVERIFIED"}
        return localEntries(state).firstOrNull{it.domain==domain&&it.objectId==objectId}?.let{E2eeMigrationLocal.open(vault,it)}
    }
    private fun loadOrNull(): Loaded? {
        val record = vault.read("local-snapshot",stateId) ?: return null
        return try { Loaded(decode(record.bytes),record.serial) } finally { record.bytes.fill(0) }
    }
    private fun load() = loadOrNull() ?: throw IllegalStateException("E2EE_SNAPSHOT_REQUIRED")
    fun status(): Status? = loadOrNull()?.state?.let { state ->
        val ancestors = state.getJSONArray("ancestors")
        Status(state.getString("migrationId"),state.getString("phase"),number(state,"uploaded").toInt(),state.getJSONArray("plan").length(),
            (0 until ancestors.length()).map { ancestors.getString(it) },nullable(state,"pending")?.getJSONObject("command")?.getString("action"),
            !state.isNull("resuming"),nullable(state,"lease")?.let { number(it,"fence",1) },localEntries(state).size,
            if(number(state,"protocol")==2L)state.getBoolean("planned")else state.getJSONArray("plan").length()>0)
    }
    private fun save(loaded: Loaded, extra: List<UnlockedE2eeVault.Write> = emptyList()) {
        val bytes = encoded(loaded.state)
        try {
            vault.write(extra + UnlockedE2eeVault.Write("local-snapshot",stateId,bytes,loaded.serial.takeIf { it > 0 }))
            loaded.serial++
        } finally { bytes.fill(0) }
    }
    private suspend fun <T> fenced(operation: suspend () -> T): T = mutex.withLock { localFence.withFence(operation) }
    suspend fun prepare() = fenced { prepareLocked() }
    private suspend fun prepareLocked() {
        ensureDurableKeys(); vault.requireOpen()
        val old = loadOrNull()
        check(old == null || old.state.get("phase") == "cancelled") { "E2EE_MIGRATION_ALREADY_PREPARED" }
        val ancestors = old?.state?.getJSONArray("ancestors")?.let { JSONArray(it.toString()) } ?: JSONArray()
        if (old != null) ancestors.put("${old.state.getString("migrationId")}:archive")
        check(ancestors.length() <= 32) { "E2EE_MIGRATION_HISTORY_LIMIT" }
        val snapshot = sources.captureLocal(); val changes = mutableListOf<UnlockedE2eeVault.Write>()
        try {
            check(snapshot.size <= E2eeFiles.MAX_FILE_BYTES) { "E2EE_SNAPSHOT_TOO_LARGE" }
            vault.requireOpen()
            val migrationId = UUID.randomUUID().toString(); val parts = (snapshot.size + E2eeFiles.CHUNK_BYTES - 1) / E2eeFiles.CHUNK_BYTES
            if (old != null) changes += UnlockedE2eeVault.Write("local-snapshot",ancestors.getString(ancestors.length()-1),encoded(old.state),null)
            for (index in 0 until parts) changes += UnlockedE2eeVault.Write("local-snapshot","$migrationId:source:$index",
                snapshot.copyOfRange(index * E2eeFiles.CHUNK_BYTES,minOf(snapshot.size,(index+1)*E2eeFiles.CHUNK_BYTES)),null)
            val state = JSONObject().put("protocol",2).put("migrationId",migrationId).put("phase","preparing").put("local",JSONArray()).put("planned",false)
                .put("snapshotParts",parts).put("snapshotSize",snapshot.size).put("snapshotHash",hash(snapshot)).put("ancestors",ancestors)
                .put("sourceHash",JSONObject.NULL).put("lease",JSONObject.NULL).put("plan",JSONArray()).put("logical",JSONArray())
                .put("uploaded",0).put("manifestHash",JSONObject.NULL).put("verifiedCheckpoint",JSONObject.NULL)
                .put("pending",JSONObject.NULL).put("resuming",JSONObject.NULL)
                .put("checkpointHash",initialCheckpoint.hash).put("directoryRevision",initialCheckpoint.revision)
            save(Loaded(state,old?.serial ?: 0),changes)
        } finally { snapshot.fill(0); changes.forEach { it.bytes.fill(0) } }
    }
    private fun snapshot(state: JSONObject): ByteArray {
        val size = number(state,"snapshotSize"); check(size <= E2eeFiles.MAX_FILE_BYTES) { "E2EE_CORRUPT_SNAPSHOT" }
        val result = ByteArray(size.toInt()); var offset = 0
        try {
            for (index in 0 until number(state,"snapshotParts").toInt()) {
                val part = vault.read("local-snapshot","${state.getString("migrationId")}:source:$index") ?: error("E2EE_CORRUPT_SNAPSHOT")
                try {
                    check(part.bytes.size == minOf(E2eeFiles.CHUNK_BYTES,result.size-offset)) { "E2EE_CORRUPT_SNAPSHOT" }
                    part.bytes.copyInto(result,offset); offset += part.bytes.size
                } finally { part.bytes.fill(0) }
            }
            check(offset == result.size && hash(result) == state.get("snapshotHash")) { "E2EE_CORRUPT_SNAPSHOT" }
            return result
        } catch (error: Exception) { result.fill(0); throw error }
    }
    private fun packet(state: JSONObject, action: String, payload: JSONObject, operationId: String = UUID.randomUUID().toString()): JSONObject =
        E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("deviceId",deviceId)
            .put("action",action).put("expectedRevision",number(state,"directoryRevision")).put("checkpointHash",state.get("checkpointHash"))
            .put("securityEpoch",securityEpoch).put("operationId",operationId).put("payload",payload),signingKey)
    private fun lease(state: JSONObject) = nullable(state,"lease") ?: throw IllegalStateException("E2EE_CORRUPT_MIGRATION")
    private suspend fun send(loaded: Loaded, packet: JSONObject) {
        loaded.state.put("pending",packet); save(loaded); replay(loaded)
    }
    private suspend fun replay(loaded: Loaded) {
        val state = loaded.state; val pending = nullable(state,"pending") ?: error("E2EE_CORRUPT_MIGRATION")
        vault.requireOpen()
        if(pending.getJSONObject("command").getString("action") in setOf("migration-verify","migration-commit"))verifyLocal(state)
        val result = try { transport.command(pending) } catch (error: Exception) {
            if (error.message != "E2EE_MIGRATION_FENCED" || state.isNull("lease") || pending.getJSONObject("command").get("action") == "migration-start") throw error
            resume(loaded); if (!state.isNull("pending")) replay(loaded); return
        }
        vault.requireOpen(); applyReceipt(loaded,result)
    }
    private fun receipt(condition: Boolean) { check(condition) { "E2EE_INVALID_RECEIPT" } }
    private fun applyReceipt(loaded: Loaded, result: JSONObject) {
        val state = loaded.state; val pending = state.getJSONObject("pending"); val command = pending.getJSONObject("command")
        when (command.getString("action")) {
            "migration-start" -> {
                val fence = number(result,"fence",1); val until = number(result,"leaseUntil",1); val generation = number(result,"generation",1)
                state.put("lease",JSONObject().put("fence",fence).put("leaseUntil",until).put("generation",generation)).put("phase","uploading")
            }
            "put" -> {
                val envelope = E2eeEnvelope.Envelope.fromJson(command.getJSONObject("payload").getJSONObject("envelope")); val ctx = envelope.context.toJson()
                receipt(number(result,"revision",1) == number(ctx,"revision",1) && result.get("payloadHash") == E2eeEnvelope.payloadHash(envelope)
                    && number(result,"generation",1) == number(ctx,"dataGeneration",1))
                state.put("uploaded",number(state,"uploaded")+1)
            }
            "migration-verify" -> {
                receipt(result.get("state") == "verified" && result.get("manifestHash") == state.get("manifestHash")); state.put("phase","verified")
            }
            "migration-commit" -> {
                val checkpoint = hash("${state.getString("checkpointHash")}\u0000${E2eeCommands.hash(command)}".toByteArray(Charsets.UTF_8))
                receipt(result.get("state") == "active" && result.get("checkpointHash") == checkpoint && number(result,"directoryRevision",1) == number(state,"directoryRevision")+1)
                state.put("phase","active").put("checkpointHash",checkpoint).put("directoryRevision",number(state,"directoryRevision")+1)
            }
            "migration-cancel" -> { receipt(result.get("state") == "preparing"); state.put("phase","cancelled") }
            else -> error("E2EE_CORRUPT_MIGRATION")
        }
        state.put("pending",JSONObject.NULL); save(loaded)
    }
    private suspend fun resume(loaded: Loaded) {
        val state = loaded.state; val lease = lease(state); check(!state.isNull("sourceHash")) { "E2EE_CORRUPT_MIGRATION" }
        if (state.isNull("resuming")) {
            val pending = nullable(state,"pending")?.getJSONObject("command")
            state.put("resuming",packet(state,"migration-resume",JSONObject().put("migrationId",state.get("migrationId"))
                .put("fence",lease.get("fence")).put("sourceHash",state.get("sourceHash"))
                .put("pendingOperationId",pending?.get("operationId") ?: JSONObject.NULL).put("pendingHash",pending?.let(E2eeCommands::hash) ?: JSONObject.NULL)))
            save(loaded)
        }
        vault.requireOpen(); val result = transport.command(state.getJSONObject("resuming")); vault.requireOpen()
        receipt(number(result,"fence",1) == number(lease,"fence",1)+1 && number(result,"generation",1) == number(lease,"generation",1))
        state.put("lease",JSONObject().put("fence",result.get("fence")).put("leaseUntil",number(result,"leaseUntil",1)).put("generation",lease.get("generation")))
        if (!result.isNull("pendingReceipt")) {
            val pending = nullable(state,"pending") ?: error("E2EE_INVALID_RECEIPT"); val recovered = result.getJSONObject("pendingReceipt")
            receipt(recovered.get("payloadHash") == E2eeCommands.hash(pending.getJSONObject("command")))
            state.put("resuming",JSONObject.NULL); applyReceipt(loaded,recovered.getJSONObject("result")); return
        }
        nullable(state,"pending")?.getJSONObject("command")?.let { previous ->
            val renewed = JSONObject(previous.toString()); renewed.getJSONObject("payload").put("fence",result.get("fence"))
            state.put("pending",E2eeCommands.sign(renewed,signingKey))
        }
        state.put("resuming",JSONObject.NULL); save(loaded)
    }
    private suspend fun plan(loaded: Loaded) {
        val state = loaded.state; val local = snapshot(state); val previous = mutableListOf<ByteArray>(); var content = emptyList<E2eeMigrationContent>();var localContent=emptyList<E2eeMigrationContent>()
        val changes = mutableListOf<UnlockedE2eeVault.Write>()
        try {
            var total = local.size.toLong(); val ancestors = state.getJSONArray("ancestors")
            for (index in 0 until ancestors.length()) {
                val row = vault.read("local-snapshot",ancestors.getString(index)) ?: error("E2EE_CORRUPT_SNAPSHOT")
                val old = try { decode(row.bytes) } finally { row.bytes.fill(0) }
                total += number(old,"snapshotSize"); check(total <= E2eeMigrationSources.BYTE_BUDGET) { "E2EE_MIGRATION_HISTORY_LIMIT" }
                previous += snapshot(old)
            }
            val currentLease = lease(state)
            val result = sources.reconcile(local,previous,E2eeMigrationSourceContext(ownerId,scopeId,state.getString("migrationId"),
                number(currentLease,"fence"),state.getString("sourceHash"),number(currentLease,"generation"))); content = result.content;localContent=result.localContent
            val all=content+localContent
            check(result.coverage.size == required.size && required.all { id -> result.coverage.count { it.first == id && it.second } == 1 }
                && result.coverage.all { it.first in required } && all.size in 1..10000
                && all.map { it.domain + "\u0000" + it.objectId }.toSet().size == all.size) { "E2EE_INCOMPLETE_COVERAGE" }
            check(all.all { it.domain in allowed }) { "E2EE_INCOMPLETE_COVERAGE" };all.forEach{E2eeKeys.technical(it.objectId)}
            check(all.all { it.bytes.size <= E2eeFiles.MAX_FILE_BYTES && (it.domain != "shared-comment" || it.bytes.size <= 65536) }) { "E2EE_INVALID_SOURCE_RESULT" }
            check(all.sumOf { it.bytes.size.toLong() } <= E2eeMigrationSources.BYTE_BUDGET) { "E2EE_MIGRATION_TOO_LARGE" }
            val plan = JSONArray(); val logical = JSONArray()
            for (item in content) {
                vault.requireOpen()
                val ctx = E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId",ownerId)
                    .put("scopeId",scopeId).put("domain",item.domain).put("objectId",item.objectId).put("schemaVersion",1)
                    .put("dataGeneration",lease(state).get("generation")).put("writerProtocol",9).put("cryptoEpoch",cryptoEpoch)
                    .put("securityEpoch",securityEpoch).put("revision",1).put("keyId",keyId).put("deviceId",deviceId).put("operationId",UUID.randomUUID().toString()))
                val file = if (item.domain == "shared-comment") E2eeFiles.Sealed(E2eeEnvelope.seal(root,signingKey,ctx,item.bytes),emptyList())
                    else E2eeFiles.seal(root,signingKey,ctx,item.bytes,item.filename,item.mediaType)
                logical.put(JSONObject().put("domain",item.domain).put("objectId",item.objectId).put("plaintextHash",hash(item.bytes)).put("size",item.bytes.size))
                for (envelope in file.chunks + file.manifest) {
                    val id = "${state.getString("migrationId")}:upload:${plan.length()}"; val context = envelope.context.toJson()
                    changes += UnlockedE2eeVault.Write("outbox",id,encoded(envelope.toJson()),null)
                    plan.put(JSONObject().put("recordId",id).put("domain",context.get("domain")).put("objectId",context.get("objectId")).put("hash",E2eeEnvelope.payloadHash(envelope)))
                    check(plan.length() <= 8000) { "E2EE_MIGRATION_TOO_LARGE" }
                }
            }
            val privatePlan=E2eeMigrationLocal.plan(state.getString("migrationId"),localContent);changes+=privatePlan.writes
            E2eeMigrationLocal.validate(privatePlan.entries,state.getString("migrationId"),allowed)
            state.put("protocol",2).put("local",privatePlan.entries).put("planned",true).put("plan",plan).put("logical",logical); save(loaded,changes)
        } finally { local.fill(0); previous.forEach { it.fill(0) }; (content+localContent).forEach { it.bytes.fill(0) }; changes.forEach { it.bytes.fill(0) } }
    }
    suspend fun run(): String = fenced { runLocked() }
    private suspend fun runLocked(): String {
        ensureDurableKeys(); val loaded = load(); val state = loaded.state
        verifyLocal(state)
        if (!state.isNull("resuming")) resume(loaded)
        if (!state.isNull("pending")) replay(loaded)
        if (state.get("phase") in setOf("active","cancelled")) return state.getString("phase")
        if (state.get("phase") == "preparing") {
            vault.requireOpen(); val source = transport.sourceHash(); vault.requireOpen(); E2eeEnvelope.decode(source,32); state.put("sourceHash",source)
            send(loaded,packet(state,"migration-start",JSONObject().put("migrationId",state.get("migrationId")).put("sourceHash",source)))
        }
        if (number(lease(state),"leaseUntil",1) <= System.currentTimeMillis()/1000+30) resume(loaded)
        if (state.get("phase") == "uploading" && (if(number(state,"protocol")==1L)state.getJSONArray("plan").length()==0 else !state.getBoolean("planned"))) plan(loaded)
        verifyLocal(state)
        val plan = state.getJSONArray("plan")
        while (state.get("phase") == "uploading" && number(state,"uploaded") < plan.length()) {
            val item = plan.getJSONObject(number(state,"uploaded").toInt()); val row = vault.read("outbox",item.getString("recordId")) ?: error("E2EE_CORRUPT_OUTBOX")
            val envelope = try { E2eeEnvelope.Envelope.fromJson(JSONObject(row.bytes.toString(Charsets.UTF_8))).also {
                check(E2eeEnvelope.payloadHash(it) == item.get("hash")) { "E2EE_CORRUPT_OUTBOX" }
            } } finally { row.bytes.fill(0) }
            send(loaded,packet(state,"put",JSONObject().put("envelope",envelope.toJson()).put("expectedObjectRevision",0)
                .put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence")),envelope.context.toJson().getString("operationId")))
        }
        if (state.get("phase") == "uploading") {
            vault.requireOpen(); val remote = transport.readAll(); vault.requireOpen()
            val byId = mutableMapOf<String,E2eeEnvelope.Envelope>()
            for (envelope in remote) {
                val ctx = envelope.context.toJson(); check(byId.put(ctx.getString("domain")+"\u0000"+ctx.getString("objectId"),envelope) == null) { "E2EE_DUPLICATE_OBJECT" }
            }
            check(byId.size == plan.length()) { "E2EE_MANIFEST_MISMATCH" }
            val heads = JSONArray()
            for (index in 0 until plan.length()) {
                val item = plan.getJSONObject(index); val key = item.getString("domain")+"\u0000"+item.getString("objectId")
                check(byId[key]?.let(E2eeEnvelope::payloadHash) == item.get("hash")) { "E2EE_MANIFEST_MISMATCH" }
                heads.put(JSONObject().put("domain",item.get("domain")).put("objectId",item.get("objectId")).put("revision",1).put("payloadHash",item.get("hash")))
            }
            val logical = state.getJSONArray("logical")
            for (index in 0 until logical.length()) {
                val item = logical.getJSONObject(index); val envelope = byId.getValue(item.getString("domain")+"\u0000"+item.getString("objectId"))
                val opened = if (item.getString("domain") == "shared-comment") E2eeFiles.Opened(E2eeEnvelope.open(root,signer,envelope.context,envelope),"","application/json")
                    else E2eeFiles.open(root,signer,envelope.context,envelope) { byId["attachment\u0000$it"] ?: error("E2EE_CORRUPT_FILE") }
                try { check(opened.bytes.size.toLong() == number(item,"size") && hash(opened.bytes) == item.get("plaintextHash")) { "E2EE_CONTENT_MISMATCH" } }
                finally { opened.bytes.fill(0) }
            }
            verifyRecovery(root); vault.requireOpen()
            verifyLocal(state)
            val manifest = E2eeFiles.objectManifestHash(heads); val checkpoint = E2eeEnvelope.encode(E2eeKeys.freshSecret())
            state.put("manifestHash",manifest).put("verifiedCheckpoint",checkpoint)
            send(loaded,packet(state,"migration-verify",JSONObject().put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence"))
                .put("manifestHash",manifest).put("objectCount",plan.length()).put("verifiedCheckpoint",checkpoint)))
        }
        if (state.get("phase") == "verified") {
            check(!state.isNull("manifestHash") && !state.isNull("verifiedCheckpoint")) { "E2EE_MIGRATION_UNVERIFIED" }
            send(loaded,packet(state,"migration-commit",JSONObject().put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence"))
                .put("manifestHash",state.get("manifestHash")).put("verifiedCheckpoint",state.get("verifiedCheckpoint"))
                .put("generation",lease(state).get("generation")).put("objectCount",plan.length())))
        }
        return state.getString("phase")
    }
    suspend fun cancel() = fenced { cancelLocked() }
    private suspend fun cancelLocked() {
        val loaded = load(); val state = loaded.state
        if (state.get("phase") == "cancelled") return
        if (!state.isNull("resuming")) try { resume(loaded) } catch (error: Exception) { if (error.message != "E2EE_SOURCE_CHANGED") throw error }
        if (nullable(state,"pending")?.getJSONObject("command")?.get("action") in setOf("migration-start","migration-commit")) try { replay(loaded) }
        catch (error: Exception) { if (error.message !in setOf("E2EE_SOURCE_CHANGED","E2EE_MIGRATION_FENCED")) throw error }
        check(state.get("phase") != "active") { "E2EE_DOWNGRADE_FORBIDDEN" }
        val bytes = encoded(state)
        try { save(loaded,listOf(UnlockedE2eeVault.Write("local-snapshot","${state.getString("migrationId")}:cancel:${UUID.randomUUID()}",bytes,null))) }
        finally { bytes.fill(0) }
        state.put("resuming",JSONObject.NULL)
        if (!state.isNull("lease")) send(loaded,packet(state,"migration-cancel",JSONObject().put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence"))))
        else { state.put("phase","cancelled"); save(loaded) }
    }
    suspend fun restart() = fenced { cancelLocked(); prepareLocked() }
    override fun toString() = "E2eeMigration([redacted])"
}
