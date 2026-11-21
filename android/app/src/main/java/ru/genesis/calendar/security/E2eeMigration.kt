package ru.genesis.calendar.security

import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.job
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.E2eeRemoteOriginal
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
    /** Explicit bounded ports; never fall back to collecting readAll(). */
    suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int = error("E2EE_STREAMED_READBACK_REQUIRED")
    suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope? = error("E2EE_STREAMED_READBACK_REQUIRED")
}
/** Explicit capability for streamed shadow verification. The aggregate
 * transport's fail-closed default methods do not grant this capability. */
interface E2eeBoundedMigrationReadback {
    suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int
    suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope?
}

internal class E2eeStreamedPlanningOptions(val device:UnlockedE2eeDevice,val inventory:E2eePrivatePaths,
    val capacity:E2eeMigrationHistory.Capacity,val originalCapacity:E2eeRemoteOriginal.Capacity,
    val assertCurrent:()->Unit,val admit:(E2eeMigrationHistory.Admission)->Unit)
internal data class E2eeStreamedPlanningTicket(val migrationId:String,val attemptId:String,val sourceHash:String,val fence:Long,val generation:Long) {
    override fun toString()="E2eeStreamedPlanningTicket([redacted])"
}
internal data class E2eeStreamedPlanningOriginal(val registration:E2eeRemoteOriginal.Registration,val completion:E2eeRemoteOriginal.Reference?,val packet:JSONObject?=null) {
    override fun toString()="E2eeStreamedPlanningOriginal([redacted])"
}
internal data class E2eeStreamedPlanningReceipt(val ticket:E2eeStreamedPlanningTicket,val originals:List<E2eeStreamedPlanningOriginal>) {
    override fun toString()="E2eeStreamedPlanningReceipt([redacted])"
}
internal class E2eeStreamedContentPlanningOptions(val planning:E2eeStreamedPlanningOptions,val capacity:E2eeContentPlan.Capacity,val admit:(E2eeContentPlan.Admission)->Unit)
internal data class E2eeStreamedContentPlanningReceipt(val ticket:E2eeStreamedPlanningTicket,val plan:E2eeContentPlan.Reference) {
    override fun toString()="E2eeStreamedContentPlanningReceipt([redacted])"
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
        val ancestors: List<String>, val pendingAction: String?, val resuming: Boolean, val fence: Long?,val localObjects:Int=0,val planReady:Boolean=false,val sourceFormat:String="legacy",val protocol:Int=2) {
        override fun toString() = "E2eeMigration.Status([redacted])"
    }
    private class Loaded(var state: JSONObject, var serial: Long,var rawHash:String="")
    private data class PlanningDevice(val userId:String,val role:String,val revoked:Boolean,val signingKey:String)
    private val planningDevices=directory.devices.mapValues{(_,device)->PlanningDevice(device.userId,device.role,device.revoked,device.signingKey)}
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
        val state = E2eeFileManifestJson.readMigrationHistory(bytes)
        val phases = setOf("preparing", "uploading", "verified", "active", "cancelled")
        val protocol=number(state,"protocol")
        check(protocol in setOf(1L,2L,3L,4L,5L) && state.getString("phase") in phases) { "E2EE_CORRUPT_MIGRATION" }
        E2eeKeys.exact(state,setOf("protocol","migrationId","phase","ancestors","sourceHash","lease","plan","logical","uploaded","manifestHash","verifiedCheckpoint","pending","resuming","checkpointHash","directoryRevision")+
            (if(protocol>=3L)setOf("source")else setOf("snapshotParts","snapshotSize","snapshotHash"))+(if(protocol in setOf(4L,5L))setOf("ownership")else emptySet())+(if(protocol==5L)setOf("adopted")else emptySet())+(if(protocol!=1L)setOf("local","planned")else emptySet()))
        E2eeKeys.technical(state.getString("migrationId"))
        val plan = state.getJSONArray("plan"); val logical = state.getJSONArray("logical"); val ancestors = state.getJSONArray("ancestors")
        check(plan.length() <= 10000 && logical.length() <= 10000 && number(state,"uploaded") <= plan.length()
            && (protocol>=3L||number(state,"snapshotParts") <= 256 && number(state,"snapshotSize") <= E2eeFiles.MAX_FILE_BYTES)
            && ancestors.length() <= 32) { "E2EE_CORRUPT_MIGRATION" }
        val seen = mutableSetOf<String>()
        for (index in 0 until ancestors.length()) check(seen.add(E2eeKeys.technical(ancestors.getString(index)))) { "E2EE_CORRUPT_MIGRATION" }
        if(protocol!=1L){
            check(state.get("planned") is Boolean){"E2EE_CORRUPT_MIGRATION"}
            val local=localEntries(state)
            check(state.getBoolean("planned")||local.isEmpty()&&plan.length()==0&&logical.length()==0&&state.getString("phase") !in setOf("verified","active")){"E2EE_CORRUPT_MIGRATION"}
        }
        if(protocol>=3L)E2eeMigrationStage.validate(state.getJSONObject("source"),vault,E2eeSourceStage.Target(ownerId,scopeId,kind),required)
        if(protocol==3L){
            check(state.get("phase") in setOf("preparing","cancelled")&&!state.getBoolean("planned")&&number(state,"uploaded")==0L
                &&listOf("sourceHash","lease","pending","resuming","manifestHash","verifiedCheckpoint").all{state.isNull(it)}){"E2EE_CORRUPT_MIGRATION"}
        }
        if(protocol==5L){
            val adopted=state.getJSONObject("adopted");E2eeKeys.exact(adopted,setOf("reference","checkpointHash","directoryRevision","stateId","stateHash"));val reference=adopted.getJSONObject("reference");E2eeKeys.exact(reference,setOf("attemptId","manifestHash"))
            E2eeKeys.technical(reference.getString("attemptId"));E2eeKeys.technical(adopted.getString("stateId"));E2eeEnvelope.decode(reference.getString("manifestHash"),32);E2eeEnvelope.decode(adopted.getString("checkpointHash"),32);E2eeEnvelope.decode(adopted.getString("stateHash"),32);number(adopted,"directoryRevision",1)
            check(state.getBoolean("planned")&&state.get("phase")!="preparing"&&!state.isNull("sourceHash")&&!state.isNull("lease")&&number(state.getJSONObject("ownership"),"protocol")==3L){"E2EE_CORRUPT_MIGRATION"}
        }
        if(protocol==4L){
            check(state.get("phase")=="preparing"&&!state.getBoolean("planned")&&plan.length()==0&&logical.length()==0&&state.getJSONArray("local").length()==0
                &&number(state,"uploaded")==0L&&state.isNull("manifestHash")&&state.isNull("verifiedCheckpoint")
                &&(state.isNull("pending")||state.getJSONObject("pending").getJSONObject("command").get("action")=="migration-start")
                &&(state.isNull("resuming")||state.getJSONObject("resuming").getJSONObject("command").get("action")=="migration-resume")){"E2EE_CORRUPT_MIGRATION"}
        }
        if(protocol in setOf(4L,5L)){
            val pin=if(protocol==5L)state.getJSONObject("adopted")else state
            E2eeMigrationOwnership.validate(state.getJSONObject("ownership"),E2eeMigrationOwnership.Expected(state.getString("migrationId"),
                E2eeSourceStage.Target(ownerId,scopeId,kind),vault.localIdentity(),state.get("sourceHash") as? String,nullable(state,"lease"),pin.getString("checkpointHash"),number(pin,"directoryRevision",1)))
        }
        return state
    }
    private fun localEntries(state:JSONObject)=if(number(state,"protocol")!=1L)E2eeMigrationLocal.validate(state.getJSONArray("local"),if(number(state,"protocol")==5L)state.getJSONObject("adopted").getJSONObject("reference").getString("attemptId")else state.getString("migrationId"),allowed)else emptyList()
    private fun verifyLocal(state:JSONObject){for(entry in localEntries(state))E2eeMigrationLocal.open(vault,entry).bytes.fill(0)}
    /** No network/legacy fallback for missing local-only content. */
    fun readLocal(domain:String,objectId:String):E2eeMigrationContent? {
        vault.requireOpen();E2eeKeys.technical(objectId);check(domain in allowed){"E2EE_LOCAL_CONTENT_FORBIDDEN"}
        val state=load().state;check(state.get("phase")=="active"){"E2EE_MIGRATION_UNVERIFIED"}
        return localEntries(state).firstOrNull{it.domain==domain&&it.objectId==objectId}?.let{E2eeMigrationLocal.open(vault,it)}
    }
    private fun loadOrNull(): Loaded? {
        val record = vault.read("local-snapshot",stateId) ?: return null
        return try { Loaded(decode(record.bytes),record.serial,hash(record.bytes)) } finally { record.bytes.fill(0) }
    }
    private fun load() = loadOrNull() ?: throw IllegalStateException("E2EE_SNAPSHOT_REQUIRED")
    fun status(): Status? = loadOrNull()?.state?.let { state ->
        val ancestors = state.getJSONArray("ancestors")
        Status(state.getString("migrationId"),state.getString("phase"),number(state,"uploaded").toInt(),state.getJSONArray("plan").length(),
            (0 until ancestors.length()).map { ancestors.getString(it) },nullable(state,"pending")?.getJSONObject("command")?.getString("action"),
            !state.isNull("resuming"),nullable(state,"lease")?.let { number(it,"fence",1) },localEntries(state).size,
            if(number(state,"protocol")!=1L)state.getBoolean("planned")else state.getJSONArray("plan").length()>0,
            if(number(state,"protocol")>=3L)"source-stage-v1" else "legacy",number(state,"protocol").toInt())
    }
    private fun save(loaded: Loaded, extra: List<UnlockedE2eeVault.Write> = emptyList(),current:()->Unit=vault::requireOpen) {
        current()
        val bytes = encoded(loaded.state)
        try {
            if(number(loaded.state,"protocol") in setOf(4L,5L))decode(bytes)
            vault.write(extra + UnlockedE2eeVault.Write("local-snapshot",stateId,bytes,loaded.serial.takeIf { it > 0 }),current)
            current()
            loaded.serial++;loaded.rawHash=hash(bytes)
        } finally { bytes.fill(0) }
    }
    private suspend fun <T> fenced(operation: suspend () -> T): T = mutex.withLock { localFence.withFence(operation) }
    suspend fun prepare() = fenced { prepareLocked() }
    private suspend fun prepareLocked() {
        ensureDurableKeys(); vault.requireOpen()
        val old = loadOrNull()
        check(old==null||number(old.state,"protocol")<3L){"E2EE_STREAMED_SOURCE_REQUIRED"}
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
    /** Durable source publication only. v3 run remains closed until the complete
     * streaming planner/common reader is independently accepted. */
    suspend fun prepareStaged(capture:E2eeStagedMigrationCapture,options:E2eeStagedMigrationOptions) {
        val captured=E2eeStagedMigrationCapture(capture.target,capture.paths,capture.capturePath)
        return fenced{prepareStagedLocked(captured,options)}
    }
    private suspend fun prepareStagedLocked(capture:E2eeStagedMigrationCapture,options:E2eeStagedMigrationOptions) {
        val target=E2eeSourceStage.Target(ownerId,scopeId,kind);check(capture.target==target){"E2EE_SCOPE_BINDING_MISMATCH"}
        val current:()->Unit={options.assertCurrent();vault.requireOpen()};current();val old=loadOrNull()
        check(old==null||number(old.state,"protocol")!=4L){"E2EE_STREAMED_PLANNER_REQUIRED"}
        check(old==null||old.state.get("phase")=="cancelled"){"E2EE_MIGRATION_ALREADY_PREPARED"}
        val ancestors=old?.state?.getJSONArray("ancestors")?.let{JSONArray(it.toString())}?:JSONArray()
        if(old!=null)ancestors.put("${old.state.getString("migrationId")}:archive")
        check(ancestors.length()<=32){"E2EE_MIGRATION_HISTORY_LIMIT"}
        val source=E2eeMigrationStage.capture(vault,capture,required,options,ensureDurableKeys);current()
        val state=JSONObject().put("protocol",3).put("migrationId",UUID.randomUUID().toString()).put("phase","preparing").put("source",source).put("ancestors",ancestors)
            .put("local",JSONArray()).put("planned",false).put("sourceHash",JSONObject.NULL).put("lease",JSONObject.NULL).put("plan",JSONArray()).put("logical",JSONArray())
            .put("uploaded",0).put("manifestHash",JSONObject.NULL).put("verifiedCheckpoint",JSONObject.NULL).put("pending",JSONObject.NULL).put("resuming",JSONObject.NULL)
            .put("checkpointHash",initialCheckpoint.hash).put("directoryRevision",initialCheckpoint.revision)
        val changes=mutableListOf<UnlockedE2eeVault.Write>()
        if(old!=null)changes+=UnlockedE2eeVault.Write("local-snapshot",ancestors.getString(ancestors.length()-1),encoded(old.state),null)
        val bytes=encoded(state)
        try{
            val totals=E2eeMigrationStage.verify(vault,source,target,required,current);current()
            changes+=E2eeMigrationStage.publicationGuard(vault,source,target,required,current);current()
            options.admit(E2eeSourceStage.Admission(totals.first,totals.second,bytes.size+changes.sumOf{it.bytes.size}));current()
            save(Loaded(state,old?.serial?:0),changes,current);current()
        }finally{bytes.fill(0);changes.forEach{it.bytes.fill(0)}}
    }
    private fun snapshot(state: JSONObject): ByteArray {
        check(number(state,"protocol")<3L){"E2EE_STREAMED_PLANNER_REQUIRED"}
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
    /** Same-original-actor bounded input under the actual coordinator fence.
     * A complete callback still grants no lease/plan publication or activation. */
    internal suspend fun <T> withStagedSourceHistory(inventory:E2eePrivatePaths,options:E2eeMigrationHistory.Options,
        consume:suspend(E2eeStagedSourceInput)->T):T = fenced {
        val history=E2eeMigrationHistory.open(vault,E2eeSourceStage.Target(ownerId,scopeId,kind),required,stateId,inventory,::decode,options)
        var rejected:Throwable?=null
        try{val result=consume(history.input);history.assertCompleteAndUnchanged();result}
        catch(error:Throwable){rejected=error;throw error}
        finally{try{history.close()}catch(error:Throwable){if(rejected==null)throw error else if(rejected!==error)rejected.addSuppressed(error)}}
    }
    private class PlanningPolicy(val options:E2eeStreamedPlanningOptions,val current:()->Unit)
    private fun planningPolicy(input:E2eeStreamedPlanningOptions):PlanningPolicy {
        val options=E2eeStreamedPlanningOptions(input.device,input.inventory,input.capacity.copy(),input.originalCapacity.copy(),input.assertCurrent,input.admit)
        val current:()->Unit={
            options.assertCurrent();vault.requireOpen();val device=options.device
            check(device.vault===vault&&device.deviceId==deviceId){"E2EE_DEVICE_VAULT_REQUIRED"};device.requireOpen()
            val actor=vault.localIdentity();val trusted=planningDevices[deviceId]
            check(actor.ownerId==device.ownerId&&actor.scopeId=="device:$deviceId"&&actor.deviceId==deviceId
                &&trusted!=null&&!trusted.revoked&&trusted.role=="owner"&&trusted.userId==actor.ownerId){"E2EE_STREAMED_OWNER_REQUIRED"}
        };current();return PlanningPolicy(options,current)
    }
    private fun originalRead(policy:PlanningPolicy)=E2eeRemoteOriginal.ReadOptions(vault,E2eeRemoteOriginal.Target(ownerId,scopeId,kind),policy.options.originalCapacity,policy.current)
    private fun planningSigner(policy:PlanningPolicy):PublicKey {
        policy.current();val spki=requireNotNull(planningDevices[deviceId]).signingKey
        return E2eeDirectory.signingKey(spki).also{policy.current()}
    }
    private fun assertPlanningPackets(state:JSONObject,publicKey:PublicKey,current:()->Unit){
        val owned=state.getJSONObject("ownership")
        check(state.get("checkpointHash")==initialCheckpoint.hash&&number(state,"directoryRevision",1)==initialCheckpoint.revision
            &&number(owned,"securityEpoch",1)==securityEpoch&&owned.get("signer")==planningDevices[deviceId]?.signingKey){"E2EE_DIRECTORY_CONFLICT"}
        for(name in listOf("pending","resuming")){
            val packet=nullable(state,name)?:continue;val command=E2eeCommands.verify(packet,publicKey);current();val payload=command.getJSONObject("payload")
            check(command.get("ownerId")==ownerId&&command.get("scopeId")==scopeId&&command.get("deviceId")==deviceId
                &&number(command,"expectedRevision")==number(state,"directoryRevision",1)&&command.get("checkpointHash")==state.get("checkpointHash")
                &&number(command,"securityEpoch",1)==securityEpoch&&payload.get("migrationId")==state.get("migrationId")&&payload.get("sourceHash")==state.get("sourceHash")){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
            if(name=="pending"){
                E2eeKeys.exact(payload,setOf("migrationId","sourceHash"));check(command.get("action")=="migration-start"&&state.isNull("lease")){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
            }else{
                E2eeKeys.exact(payload,setOf("migrationId","fence","sourceHash","pendingOperationId","pendingHash"))
                check(command.get("action")=="migration-resume"&&!state.isNull("lease")&&number(payload,"fence",1)==number(lease(state),"fence",1)
                    &&payload.isNull("pendingOperationId")&&payload.isNull("pendingHash")){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
            }
        }
        check(!state.isNull("lease")||state.isNull("resuming")&&(state.isNull("sourceHash")||!state.isNull("pending"))){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
    }
    private fun sameTechnical(left:Any,right:Any):Boolean {
        val a=E2eeCommands.canonical(left);val b=E2eeCommands.canonical(right)
        return try{a.contentEquals(b)}finally{a.fill(0);b.fill(0)}
    }
    /** Only the root metadata ID aliases the exact retained state3 bytes.
     * All original/history/plan discovery remains unfiltered and fail-closed. */
    private fun preparedHistory(loaded:Loaded,policy:PlanningPolicy):E2eeMigrationHistory.Handle {
        val state=loaded.state;check(number(state,"protocol")==4L){"E2EE_STREAMED_PLANNING_REQUIRED"}
        val original=state.getJSONObject("ownership").getJSONObject("sourceState");val current=policy.current
        val view=object:E2eeSourceReadVault {
            override fun assertOpen()=current()
            override fun localIdentity()=vault.localIdentity()
            override fun listLocal(domain:String,objectPrefix:String)=vault.listLocal(domain,objectPrefix)
            override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened? {
                current();if(domain!="local-snapshot"||objectId!=stateId)return vault.read(domain,objectId)
                val active=vault.read(domain,stateId)
                try{current();check(active!=null&&active.serial==loaded.serial&&hash(active.bytes)==loaded.rawHash){"E2EE_SOURCE_HISTORY_CHANGED"};current()}finally{active?.bytes?.fill(0)}
                val raw=vault.read(domain,original.getString("objectId"))
                try{
                    current();check(raw!=null&&raw.serial==1L&&hash(raw.bytes)==original.get("hash")){"E2EE_SOURCE_HISTORY_INVALID"};current()
                    val old=decode(raw.bytes)
                    check(number(old,"protocol")==3L&&old.get("phase")=="preparing"&&old.get("migrationId")==state.get("migrationId")
                        &&old.get("checkpointHash")==state.get("checkpointHash")&&number(old,"directoryRevision",1)==number(state,"directoryRevision",1)
                        &&sameTechnical(JSONObject().put("source",old.get("source")).put("ancestors",old.get("ancestors")),
                            JSONObject().put("source",state.get("source")).put("ancestors",state.get("ancestors")))){"E2EE_SOURCE_HISTORY_INVALID"}
                    return UnlockedE2eeVault.Opened(1,raw.bytes.copyOf())
                }finally{raw?.bytes?.fill(0)}
            }
        }
        return E2eeMigrationHistory.openPrepared(view,E2eeSourceStage.Target(ownerId,scopeId,kind),required,stateId,policy.options.inventory,
            {bytes->decode(bytes).also{check(number(it,"protocol")!=4L){"E2EE_SOURCE_HISTORY_INVALID"}}},
            E2eeMigrationHistory.Options(policy.options.capacity,current,policy.options.admit),vault::listMigrationOriginalParts,vault::listMigrationHistoryCopies,
            {ids->assertPlanningCell(loaded,current);inspectOwnedContentPlans(loaded.state,ids,policy)})
    }
    private fun planReference(value:JSONObject)=E2eeContentPlan.Reference(value.getString("attemptId"),value.getString("manifestHash"))
    private fun planReferenceJson(value:E2eeContentPlan.Reference)=JSONObject().put("attemptId",value.attemptId).put("manifestHash",value.manifestHash)
    private fun contentPlanRead(state:JSONObject,plan:JSONObject,policy:PlanningPolicy):E2eeContentPlan.ReadOptions {
        val context=E2eeEnvelope.Context.fromJson(plan.getJSONObject("context"));val value=context.toJson()
        check(number(value,"cryptoEpoch",1)==cryptoEpoch&&value.get("keyId")==keyId&&number(value,"securityEpoch",1)==securityEpoch){"E2EE_DIRECTORY_CONFLICT"}
        return E2eeContentPlan.ReadOptions(vault,root,signer,context,E2eeSourceStage.Target(ownerId,scopeId,kind),state.getString("migrationId"),state.getString("sourceHash"),required,policy.options.inventory,policy.current)
    }
    private fun inspectOwnedContentPlans(state:JSONObject,ids:List<String>,policy:PlanningPolicy):E2eeMigrationHistory.Admission {
        val owned=state.getJSONObject("ownership");val plans=if(number(owned,"protocol")==3L)owned.getJSONArray("plans")else JSONArray()
        val reserved=(0 until plans.length()).map{plans.getJSONObject(it)};val known=mutableSetOf<String>();var bytes=0L;var parts=0;var metadata=0
        check(ids.all{id->reserved.any{plan->val attempt=plan.getString("attemptId");id=="content-plan:$attempt:journal"||id=="content-plan:$attempt:manifest"}}){"E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED"}
        for(plan in reserved){
            val found=E2eeContentPlan.inspect(contentPlanRead(state,plan,policy),plan.getString("attemptId"),if(plan.isNull("completion"))null else planReference(plan.getJSONObject("completion")));policy.current()
            known+=found.metadataIds;bytes+=found.bytes;parts+=found.records;metadata+=found.metadataBytes
        }
        check(known.size==ids.size&&ids.all{it in known}){"E2EE_SOURCE_HISTORY_CHANGED"}
        val outputs=vault.listMigrationPlanOutputs();policy.current()
        check(outputs.first.all{id->reserved.any{id.startsWith(it.getString("attemptId")+":upload:")}}
            &&outputs.second.all{id->reserved.any{id.startsWith(it.getString("attemptId")+":private:")}}){"E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED"}
        return E2eeMigrationHistory.Admission(bytes,parts,metadata,reserved.size)
    }
    private fun drainHistory(history:E2eeMigrationHistory.Handle,current:()->Unit):E2eeMigrationHistory.Receipt {
        var rejected:Throwable?=null;val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
        try{
            for(source in listOf(history.input.current)+history.input.previous)for(path in source.paths){
                val reader=source.openPath(path);reader.input.use{stream->while(true){current();val count=stream.read(buffer);if(count<0)break;buffer.fill(0,0,count)};reader.assertComplete();current()}
            }
            return history.assertCompleteAndUnchanged()
        }catch(error:Throwable){rejected=error;throw error}
        finally{buffer.fill(0);try{history.close()}catch(error:Throwable){if(rejected==null)throw error else if(rejected!==error)rejected.addSuppressed(error)}}
    }
    private fun checkOwnedOriginals(state:JSONObject,policy:PlanningPolicy,publicKey:PublicKey){
        val options=originalRead(policy);val markers=E2eeRemoteOriginal.listOriginals(options);policy.current()
        val list=state.getJSONObject("ownership").getJSONArray("originals");val owned=mutableMapOf<String,JSONObject>()
        for(index in 0 until list.length()){
            val entry=list.getJSONObject(index);val registration=entry.getJSONObject("registration")
            E2eeRemoteOriginal.authenticateRegistration(registration,entry.getJSONObject("packet"),publicKey,options,number(lease(state),"generation",1));policy.current()
            owned[registration.getString("id")]=entry
            if(number(state.getJSONObject("ownership"),"protocol")!=1L&&!entry.isNull("completion"))check(markers.any{it.id==registration.getString("id")}){"E2EE_REMOTE_ORIGINAL_MISSING"}
        }
        for(marker in markers){
            val entry=owned[marker.id]?:error("E2EE_STREAMED_ORIGINAL_REVIEW_REQUIRED")
            val found=E2eeRemoteOriginal.describeOriginal(options,marker.id);policy.current()
            check(sameTechnical(found.registration.toJson(),entry.getJSONObject("registration"))){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
            if(number(state.getJSONObject("ownership"),"protocol")!=1L&&!entry.isNull("completion")){
                val ref=entry.getJSONObject("completion");val buffer=ByteArray(65536)
                val proof=try{E2eeRemoteOriginal.withOriginal(options,marker.id){input->while(true){policy.current();val count=input.read(buffer);if(count<0)break;buffer.fill(0,0,count)}}}finally{buffer.fill(0)}
                policy.current();check(proof.complete&&proof.manifestHash==ref.get("manifestHash")&&proof.rawHash==ref.get("rawHash")&&proof.size==number(ref,"size")){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
            }
        }
    }
    /** State4 preparation only: protected source publication precedes a signed
     * lease; normal run, upload, plan adoption and activation remain closed. */
    internal suspend fun prepareStreamedPlanning(input:E2eeStreamedPlanningOptions):E2eeStreamedPlanningTicket {
        val policy=planningPolicy(input)
        return fenced{prepareStreamedPlanningLocked(policy).first}
    }
    private suspend fun prepareStreamedPlanningLocked(policy:PlanningPolicy):Pair<E2eeStreamedPlanningTicket,Loaded> {
            val current=policy.current;val options=policy.options
            current();options.device.ensureDurableKeys();current();ensureDurableKeys();current();val publicKey=planningSigner(policy)
            var loaded=load();current()
            if(number(loaded.state,"protocol")==3L){
                check(loaded.state.get("phase")=="preparing"){"E2EE_STAGED_SOURCE_REQUIRED"}
                check(loaded.state.get("checkpointHash")==initialCheckpoint.hash&&number(loaded.state,"directoryRevision",1)==initialCheckpoint.revision){"E2EE_DIRECTORY_CONFLICT"}
                check(E2eeRemoteOriginal.listOriginals(originalRead(policy)).isEmpty()){"E2EE_STREAMED_ORIGINAL_REVIEW_REQUIRED"};current()
                val raw=vault.read("local-snapshot",stateId)
                try{
                    current();check(raw!=null&&raw.serial==loaded.serial&&hash(raw.bytes)==loaded.rawHash){"E2EE_SOURCE_HISTORY_CHANGED"};current()
                    val history=E2eeMigrationHistory.open(vault,E2eeSourceStage.Target(ownerId,scopeId,kind),required,stateId,options.inventory,
                        {bytes->decode(bytes).also{check(number(it,"protocol")!=4L){"E2EE_SOURCE_HISTORY_INVALID"}}},E2eeMigrationHistory.Options(options.capacity,current,options.admit))
                    val totals=drainHistory(history,current).totals;current();val old=loaded.state
                    val originalId="${old.getString("migrationId")}:preparation:3"
                    val ownership=JSONObject().put("protocol",1).put("attemptId",UUID.randomUUID().toString())
                        .put("sourceState",JSONObject().put("objectId",originalId).put("hash",loaded.rawHash).put("originalSerial",loaded.serial))
                        .put("signer",requireNotNull(planningDevices[deviceId]).signingKey).put("securityEpoch",securityEpoch).put("originals",JSONArray())
                    val next=JSONObject(old.toString()).put("protocol",4).put("ownership",ownership)
                    val guard=E2eeMigrationStage.publicationGuard(vault,next.getJSONObject("source"),E2eeSourceStage.Target(ownerId,scopeId,kind),required,current);current()
                    val bytes=encoded(next)
                    try{
                        val metadata=totals.metadataBytes.toLong()+raw.bytes.size+bytes.size+guard.bytes.size
                        check(metadata<=options.capacity.maximumMetadataBytes){"E2EE_SOURCE_HISTORY_CAPACITY"}
                        options.admit(E2eeMigrationHistory.Admission(totals.bytes,totals.parts,metadata.toInt(),totals.sources));current()
                        save(Loaded(next,loaded.serial),listOf(guard,UnlockedE2eeVault.Write("local-snapshot",originalId,raw.bytes,null)),current);current()
                    }finally{bytes.fill(0);guard.bytes.fill(0)}
                }finally{raw?.bytes?.fill(0)}
                loaded=load();current()
            }
            val state=loaded.state;check(number(state,"protocol")==4L){"E2EE_STREAMED_PLANNING_REQUIRED"}
            assertPlanningPackets(state,publicKey,current);checkOwnedOriginals(state,policy,publicKey)
            drainHistory(preparedHistory(loaded,policy),current);current()
            if(!state.isNull("resuming"))resume(loaded,current);current()
            if(!state.isNull("pending"))replay(loaded,current);current()
            if(state.isNull("lease")){
                val source=transport.sourceHash();current();E2eeEnvelope.decode(source,32);state.put("sourceHash",source)
                val request=packet(state,"migration-start",JSONObject().put("migrationId",state.get("migrationId")).put("sourceHash",source));current()
                E2eeCommands.verify(request,publicKey);current();send(loaded,request,current);current()
            }
            check(!state.isNull("sourceHash")&&!state.isNull("lease")){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
            if(number(lease(state),"leaseUntil",1)<=System.currentTimeMillis()/1000+30)resume(loaded,current)
            current();options.device.ensureDurableKeys();current()
            val ticket=E2eeStreamedPlanningTicket(state.getString("migrationId"),state.getJSONObject("ownership").getString("attemptId"),state.getString("sourceHash"),number(lease(state),"fence",1),number(lease(state),"generation",1))
            val bytes=encoded(state);val expected=try{hash(bytes)}finally{bytes.fill(0)};val actual=load();current()
            check(actual.serial==loaded.serial&&actual.rawHash==expected){"E2EE_SOURCE_HISTORY_CHANGED"}
            return ticket to actual
    }
    private fun assertPlanningCell(cell:Loaded,current:()->Unit){
        current();val actual=load();current();check(actual.serial==cell.serial&&actual.rawHash==cell.rawHash){"E2EE_SOURCE_HISTORY_CHANGED"}
    }
    private fun advancePlanningCell(cell:Loaded,expected:Loaded,current:()->Unit){
        current();val actual=load();current();check(actual.serial==expected.serial&&actual.rawHash==expected.rawHash){"E2EE_SOURCE_HISTORY_CHANGED"}
        cell.state=actual.state;cell.serial=actual.serial;cell.rawHash=actual.rawHash
    }
    private fun savePlanningCell(cell:Loaded,next:JSONObject,policy:PlanningPolicy,history:E2eeMigrationHistory.Handle,current:()->Unit){
        current();assertPlanningCell(cell,current);val totals=history.assertMetadataUnchanged();current()
        val guard=E2eeMigrationStage.publicationGuard(vault,next.getJSONObject("source"),E2eeSourceStage.Target(ownerId,scopeId,kind),required,current)
        val bytes=encoded(next)
        try{
            val metadata=totals.metadataBytes.toLong()+bytes.size+guard.bytes.size
            check(metadata<=policy.options.capacity.maximumMetadataBytes){"E2EE_SOURCE_HISTORY_CAPACITY"}
            policy.options.admit(E2eeMigrationHistory.Admission(totals.bytes,totals.parts,metadata.toInt(),totals.sources));current();policy.options.device.ensureDurableKeys();current()
            val expected=Loaded(next,cell.serial);save(expected,listOf(guard),current);current();advancePlanningCell(cell,expected,current)
        }finally{bytes.fill(0);guard.bytes.fill(0)}
    }
    private fun completionJson(value:E2eeRemoteOriginal.Reference)=JSONObject().put("id",value.id).put("manifestHash",value.manifestHash).put("rawHash",value.rawHash).put("size",value.size)
    private fun sessionState(cell:Loaded,current:()->Unit):JSONObject {
        current();val state=cell.state;check(number(state,"protocol")==4L&&!state.isNull("sourceHash")&&!state.isNull("lease")
            &&number(state.getJSONObject("ownership"),"protocol")!=1L){"E2EE_STREAMED_PLANNING_REQUIRED"};return state
    }
    /** One nonreentrant whole-job fence owns capture and all awaited children.
     * No content plan, upload, ordinary writer or activation is adopted here. */
    internal suspend fun withStreamedPlanning(input:E2eeStreamedPlanningOptions,consume:suspend(E2eeMigrationSession)->Unit):E2eeStreamedPlanningReceipt {
        val ownerJob=currentCoroutineContext().job;val base=planningPolicy(input)
        val current:()->Unit={ownerJob.ensureActive();base.current()};val policy=PlanningPolicy(base.options,current)
        return fenced {
            val (ticket,cell)=prepareStreamedPlanningLocked(policy);current();val history=preparedHistory(cell,policy)
            var rejected:Throwable?=null;val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
            try{
                for(source in listOf(history.input.current)+history.input.previous)for(path in source.paths){
                    val reader=source.openPath(path);reader.input.use{stream->while(true){current();val count=stream.read(buffer);if(count<0)break;buffer.fill(0,0,count)};reader.assertComplete();current()}
                }
                history.assertCompleteAndUnchanged();current()
                if(number(cell.state.getJSONObject("ownership"),"protocol")==1L){
                    val next=JSONObject(cell.state.toString());val ownership=next.getJSONObject("ownership").put("protocol",2);val originals=ownership.getJSONArray("originals")
                    for(index in 0 until originals.length())originals.getJSONObject(index).put("completion",JSONObject.NULL)
                    savePlanningCell(cell,next,policy,history,current)
                }
                val publicKey=planningSigner(policy)
                fun read(guard:()->Unit)=originalRead(PlanningPolicy(policy.options,guard))
                fun complete(registration:E2eeRemoteOriginal.Registration,packet:JSONObject,reference:E2eeRemoteOriginal.Reference,guard:()->Unit){
                    guard();val state=sessionState(cell,guard);val originals=state.getJSONObject("ownership").getJSONArray("originals")
                    val index=(0 until originals.length()).firstOrNull{originals.getJSONObject(it).getJSONObject("registration").get("id")==registration.id}
                        ?:error("E2EE_CORRUPT_STREAMED_OWNERSHIP")
                    val owned=originals.getJSONObject(index);val value=completionJson(reference)
                    check(sameTechnical(owned.getJSONObject("registration"),registration.toJson())&&sameTechnical(owned.getJSONObject("packet"),packet)&&reference.id==registration.id){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
                    if(!owned.isNull("completion")){check(sameTechnical(owned.getJSONObject("completion"),value)){"E2EE_CORRUPT_STREAMED_OWNERSHIP"};assertPlanningCell(cell,guard);return}
                    val descriptor=E2eeRemoteOriginal.describeOriginal(read(guard),registration.id);guard()
                    check(descriptor.registration==registration&&descriptor.phase=="complete"&&descriptor.manifestHash==reference.manifestHash&&descriptor.rawHash==reference.rawHash&&descriptor.size==reference.size){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
                    val next=JSONObject(state.toString());next.getJSONObject("ownership").getJSONArray("originals").getJSONObject(index).put("completion",value)
                    savePlanningCell(cell,next,policy,history,guard)
                }
                val prior=sessionState(cell,current).getJSONObject("ownership").getJSONArray("originals").length()
                for(index in 0 until prior){
                    val owned=sessionState(cell,current).getJSONObject("ownership").getJSONArray("originals").getJSONObject(index)
                    if(!owned.isNull("completion"))continue
                    val id=owned.getJSONObject("registration").getString("id");val marker=E2eeRemoteOriginal.listOriginals(read(current)).firstOrNull{it.id==id};current()
                    if(marker?.phase!="complete")continue
                    val proof=E2eeRemoteOriginal.withOriginal(read(current),id){stream->while(true){current();val count=stream.read(buffer);if(count<0)break;buffer.fill(0,0,count)}};current()
                    check(proof.complete&&proof.manifestHash!=null){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
                    val registration=E2eeRemoteOriginal.authenticateRegistration(owned.getJSONObject("registration"),owned.getJSONObject("packet"),publicKey,read(current),number(lease(cell.state),"generation",1))
                    complete(registration,owned.getJSONObject("packet"),E2eeRemoteOriginal.Reference(id,requireNotNull(proof.manifestHash),proof.rawHash,proof.size),current)
                }
                suspend fun refresh(guard:()->Unit){
                    assertPlanningCell(cell,guard);history.assertMetadataUnchanged();guard();val state=sessionState(cell,guard)
                    if(number(lease(state),"leaseUntil",1)<=System.currentTimeMillis()/1000+30){
                        val next=Loaded(JSONObject(state.toString()),cell.serial,cell.rawHash);resume(next,guard);guard();advancePlanningCell(cell,next,guard)
                    }
                }
                val context=E2eeMigrationSourceContext(ownerId,scopeId,ticket.migrationId,ticket.fence,ticket.sourceHash,ticket.generation)
                E2eeMigrationSession.use(E2eeMigrationSession.Hooks(context,E2eeMigrationPlanningBinding(ownerId,scopeId,deviceId,initialCheckpoint.hash,initialCheckpoint.revision,securityEpoch),current,
                    packet={action,page,guard->
                        refresh(guard);val state=sessionState(cell,guard)
                        packet(state,action,JSONObject().put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence")).put("sourceHash",state.get("sourceHash"))
                            .apply{page?.let{value->value.keys().forEach{key->put(key,value.get(key))}}})
                    },
                    original={request,guard->E2eeRemoteOriginal.Options(vault,E2eeRemoteOriginal.Target(ownerId,scopeId,kind),policy.options.originalCapacity,request,publicKey,number(lease(sessionState(cell,guard)),"generation",1),guard,
                        policy.options.device::ensureDurableKeys,{usage->policy.options.admit(E2eeMigrationHistory.Admission(usage.bytes,usage.parts,usage.metadataBytes,usage.observations));guard()})},
                    reserve={registration,request,guard->
                        val state=sessionState(cell,guard);val authenticated=E2eeRemoteOriginal.authenticateRegistration(registration.toJson(),request,publicKey,read(guard),number(lease(state),"generation",1));guard()
                        check(authenticated.binding.fence==number(lease(state),"fence",1)&&authenticated.binding.migrationId==state.get("migrationId")&&authenticated.binding.sourceHash==state.get("sourceHash")){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
                        val known=state.getJSONObject("ownership").getJSONArray("originals")
                        check(known.length()<1000&&(0 until known.length()).none{known.getJSONObject(it).getJSONObject("registration").get("id")==registration.id}){"E2EE_STREAMED_ORIGINAL_ALREADY_RESERVED"}
                        val next=JSONObject(state.toString());next.getJSONObject("ownership").getJSONArray("originals").put(JSONObject().put("registration",authenticated.toJson()).put("packet",JSONObject(request.toString())).put("completion",JSONObject.NULL))
                        savePlanningCell(cell,next,policy,history,guard)
                    },complete={registration,request,reference,guard->complete(registration,request,reference,guard)},
                    finish={
                        history.assertCompleteAndUnchanged();current();assertPlanningCell(cell,current);val state=sessionState(cell,current)
                        checkOwnedOriginals(state,policy,publicKey);policy.options.device.ensureDurableKeys();current()
                        val originals=state.getJSONObject("ownership").getJSONArray("originals");val values=(0 until originals.length()).map{index->val item=originals.getJSONObject(index)
                            val registration=E2eeRemoteOriginal.authenticateRegistration(item.getJSONObject("registration"),item.getJSONObject("packet"),publicKey,read(current),number(lease(state),"generation",1))
                            val ref=if(item.isNull("completion"))null else item.getJSONObject("completion").let{E2eeRemoteOriginal.Reference(it.getString("id"),it.getString("manifestHash"),it.getString("rawHash"),number(it,"size"))}
                            E2eeStreamedPlanningOriginal(registration,ref)}
                        E2eeStreamedPlanningReceipt(ticket.copy(fence=number(lease(state),"fence",1)),java.util.Collections.unmodifiableList(values))
                    }),consume)
            }catch(error:Throwable){rejected=error;throw error}
            finally{buffer.fill(0);try{history.close()}catch(error:Throwable){if(rejected==null)throw error else if(rejected!==error)rejected.addSuppressed(error)}}
        }
    }
    /** Exact local plan/source adoption. No legacy request, upload, normal run
     * or activation is introduced. Every retained attempt remains discoverable. */
    internal suspend fun planStreamedContent(input:E2eeStreamedContentPlanningOptions,build:suspend(E2eeContentPlanningSession)->List<Pair<String,Boolean>>):E2eeStreamedContentPlanningReceipt {
        val ownerJob=currentCoroutineContext().job;val base=planningPolicy(input.planning);val current:()->Unit={ownerJob.ensureActive();base.current()}
        val policy=PlanningPolicy(base.options,current);val capacity=input.capacity.copy();val admit=input.admit
        check(capacity.maximumBytes in 1..9007199254740991L&&capacity.maximumEnvelopes in 1..8000&&capacity.maximumLocalParts in 1..8000){"E2EE_CONTENT_PLAN_CAPACITY"}
        return fenced {
            val(ticket,cell)=prepareStreamedPlanningLocked(policy);current();val history=preparedHistory(cell,policy)
            var writer:E2eeContentPlan.Writer?=null;var session:E2eeContentPlanningSession?=null;var rejected:Throwable?=null;val buffer=ByteArray(E2eeFiles.CHUNK_BYTES)
            fun state():JSONObject {current();val value=cell.state;check(number(value,"protocol")==4L&&!value.isNull("lease")&&!value.isNull("sourceHash")){"E2EE_STREAMED_PLANNING_REQUIRED"};return value}
            fun drainLocal(){for(source in listOf(history.input.current)+history.input.previous)for(path in source.paths){
                val reader=source.openPath(path);reader.input.use{stream->while(true){current();val count=stream.read(buffer);if(count<0)break;buffer.fill(0,0,count)};reader.assertComplete()}
            }}
            try{
                if(number(state().getJSONObject("ownership"),"protocol")!=3L){
                    val next=JSONObject(state().toString());val owned=next.getJSONObject("ownership")
                    check(number(owned,"protocol")!=1L||owned.getJSONArray("originals").length()==0){"E2EE_STREAMED_CAPTURE_REQUIRED"}
                    owned.put("protocol",3).put("plans",JSONArray());savePlanningCell(cell,next,policy,history,current)
                }
                val entries=state().getJSONObject("ownership").getJSONArray("originals");val publicKey=planningSigner(policy)
                val originals=(0 until entries.length()).map{index->val row=entries.getJSONObject(index)
                    check(!row.isNull("completion")){"E2EE_REMOTE_ORIGINAL_INCOMPLETE"};val ref=row.getJSONObject("completion")
                    E2eeStreamedPlanningOriginal(E2eeRemoteOriginal.authenticateRegistration(row.getJSONObject("registration"),row.getJSONObject("packet"),publicKey,originalRead(policy),number(lease(state()),"generation",1)),
                        E2eeRemoteOriginal.Reference(ref.getString("id"),ref.getString("manifestHash"),ref.getString("rawHash"),number(ref,"size")),JSONObject(row.getJSONObject("packet").toString()))}
                val references=JSONArray(originals.map{completionJson(requireNotNull(it.completion))})
                val prior=JSONArray(state().getJSONObject("ownership").getJSONArray("plans").toString())
                for(index in 0 until prior.length()){
                    val plan=prior.getJSONObject(index);val found=E2eeContentPlan.inspect(contentPlanRead(state(),plan,policy),plan.getString("attemptId"),if(plan.isNull("completion"))null else planReference(plan.getJSONObject("completion")));current()
                    if(plan.isNull("completion")&&found.reference!=null){
                        val next=JSONObject(state().toString());next.getJSONObject("ownership").getJSONArray("plans").getJSONObject(index).put("completion",planReferenceJson(found.reference))
                        savePlanningCell(cell,next,policy,history,current)
                    }
                }
                val plans=state().getJSONObject("ownership").getJSONArray("plans")
                val reusable=(plans.length()-1 downTo 0).map{plans.getJSONObject(it)}.firstOrNull{!it.isNull("completion")&&sameTechnical(it.getJSONArray("originals"),references)}
                if(reusable!=null){
                    drainLocal();history.assertCompleteAndUnchanged();checkOwnedOriginals(state(),policy,publicKey);assertPlanningCell(cell,current)
                    policy.options.device.ensureDurableKeys();current();ensureDurableKeys();current();assertPlanningCell(cell,current)
                    E2eeStreamedContentPlanningReceipt(ticket.copy(fence=number(lease(state()),"fence",1)),planReference(reusable.getJSONObject("completion")))
                }else{
                    check(plans.length()<64){"E2EE_CONTENT_PLAN_CAPACITY"};val attempt=UUID.randomUUID().toString()
                    val context=JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId",ownerId).put("scopeId",scopeId).put("domain","local-snapshot")
                        .put("objectId","migration-content-plan").put("schemaVersion",1).put("dataGeneration",lease(state()).get("generation")).put("writerProtocol",9).put("cryptoEpoch",cryptoEpoch)
                        .put("securityEpoch",securityEpoch).put("revision",1).put("keyId",keyId).put("deviceId",deviceId).put("operationId",UUID.randomUUID().toString())
                    val reserved=JSONObject().put("attemptId",attempt).put("context",context).put("fence",lease(state()).get("fence")).put("generation",lease(state()).get("generation"))
                        .put("originals",references).put("completion",JSONObject.NULL)
                    val next=JSONObject(state().toString());next.getJSONObject("ownership").getJSONArray("plans").put(reserved);savePlanningCell(cell,next,policy,history,current)
                    val consumed=mutableSetOf<String>()
                    fun sourceComplete(){
                        history.assertCompleteAndUnchanged();current();assertPlanningCell(cell,current)
                        check(originals.all{synchronized(consumed){requireNotNull(it.completion).id in consumed}}){"E2EE_REMOTE_ORIGINAL_INCOMPLETE_READ"}
                        checkOwnedOriginals(state(),policy,publicKey);current()
                        policy.options.device.ensureDurableKeys();current();ensureDurableKeys();current()
                    }
                    val borrowed=E2eeContentPlanningSession(history.input,originals,current,
                        read={id,consume,guard->
                            val owned=originals.firstOrNull{it.completion?.id==id}?:error("E2EE_STREAMED_ORIGINAL_REVIEW_REQUIRED");assertPlanningCell(cell,guard)
                            val proof=E2eeRemoteOriginal.withOriginal(originalRead(PlanningPolicy(policy.options,guard)),id,consume=consume);guard();val ref=requireNotNull(owned.completion)
                            check(proof.complete&&proof.id==ref.id&&proof.manifestHash==ref.manifestHash&&proof.rawHash==ref.rawHash&&proof.size==ref.size){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
                            synchronized(consumed){consumed+=id}
                        },write={path,record,guard->guard();requireNotNull(writer).append(path,record);guard()})
                    session=borrowed
                    val guardedPolicy=PlanningPolicy(policy.options,borrowed::assertCurrent)
                    writer=E2eeContentPlan.create(E2eeContentPlan.Options(contentPlanRead(state(),reserved,guardedPolicy),signingKey,capacity,
                        {usage->assertPlanningCell(cell,current);admit(usage);current()},
                        {policy.options.device.ensureDurableKeys();current();ensureDurableKeys();current()},::sourceComplete),attempt)
                    val coverage=build(borrowed);borrowed.finishInput()
                    val reference=requireNotNull(writer).finish(coverage);current();E2eeContentPlan.open(contentPlanRead(state(),reserved,policy),reference);current();sourceComplete()
                    val complete=JSONObject(state().toString());complete.getJSONObject("ownership").getJSONArray("plans").getJSONObject(plans.length()).put("completion",planReferenceJson(reference))
                    savePlanningCell(cell,complete,policy,history,current);assertPlanningCell(cell,current);history.assertCompleteAndUnchanged();current()
                    E2eeStreamedContentPlanningReceipt(ticket.copy(fence=number(lease(state()),"fence",1)),reference)
                }
            }catch(error:Throwable){rejected=error;throw error}
            finally{
                session?.closeAndDrain();writer?.close();buffer.fill(0)
                try{history.close()}catch(error:Throwable){if(rejected==null)throw error else if(rejected!==error)rejected.addSuppressed(error)}
            }
        }
    }
    /** Complete-plan adoption is a distinct CAS from preparation. It retains
     * the exact prior state and all raw/staged originals for recovery. */
    internal suspend fun adoptStreamedContentPlan(reference:E2eeContentPlan.Reference,input:E2eeStreamedPlanningOptions){
        val chosen=reference.copy();val policy=planningPolicy(input);val current=policy.current
        return fenced{
            val loaded=load();current();val state=loaded.state
            if(number(state,"protocol")==5L){check(sameTechnical(state.getJSONObject("adopted").getJSONObject("reference"),planReferenceJson(chosen))){"E2EE_CONTENT_PLAN_CONFLICT"};adoptedPlan(state,policy);return@fenced}
            check(number(state,"protocol")==4L&&number(state.getJSONObject("ownership"),"protocol")==3L&&!state.isNull("lease")&&!state.isNull("sourceHash")&&state.isNull("pending")&&state.isNull("resuming")){"E2EE_STREAMED_PLANNING_REQUIRED"}
            val ownership=state.getJSONObject("ownership");val plans=ownership.getJSONArray("plans")
            val reserved=(0 until plans.length()).map{plans.getJSONObject(it)}.find{!it.isNull("completion")&&sameTechnical(it.getJSONObject("completion"),planReferenceJson(chosen))}?:error("E2EE_CONTENT_PLAN_CONFLICT")
            check(number(reserved,"fence",1)==number(lease(state),"fence",1)&&number(reserved,"generation",1)==number(lease(state),"generation",1)){"E2EE_CONTENT_PLAN_CONFLICT"}
            val originals=ownership.getJSONArray("originals");val expected=JSONArray()
            for(i in 0 until originals.length()){val row=originals.getJSONObject(i);check(!row.isNull("completion")){"E2EE_CONTENT_PLAN_CONFLICT"};expected.put(row.getJSONObject("completion"))}
            check(sameTechnical(JSONObject().put("values",reserved.getJSONArray("originals")),JSONObject().put("values",expected))){"E2EE_CONTENT_PLAN_CONFLICT"}
            checkOwnedOriginals(state,policy,planningSigner(policy));val manifest=E2eeContentPlan.open(contentPlanRead(state,reserved,policy),chosen).manifest;current()
            drainHistory(preparedHistory(loaded,policy),current);verifyRecovery(root);current();input.device.ensureDurableKeys();current();ensureDurableKeys();current()
            val original=encoded(state);val originalId="${state.getString("migrationId")}:adoption:${chosen.attemptId}"
            val guard=E2eeMigrationStage.publicationGuard(vault,state.getJSONObject("source"),E2eeSourceStage.Target(ownerId,scopeId,kind),required,current)
            try{
                val next=JSONObject(state.toString()).put("protocol",5).put("phase","uploading").put("planned",true)
                    .put("plan",manifest.getJSONArray("plan")).put("logical",manifest.getJSONArray("logical")).put("local",manifest.getJSONArray("local"))
                    .put("adopted",JSONObject().put("reference",planReferenceJson(chosen)).put("checkpointHash",state.get("checkpointHash")).put("directoryRevision",state.get("directoryRevision"))
                        .put("stateId",originalId).put("stateHash",hash(original)))
                val adopted=Loaded(next,loaded.serial);save(adopted,listOf(guard,UnlockedE2eeVault.Write("local-snapshot",originalId,original,null)),current);current()
            }finally{original.fill(0);guard.bytes.fill(0)}
        }
    }
    private fun adoptedPlan(state:JSONObject,policy:PlanningPolicy):Pair<E2eeContentPlan.ReadOptions,JSONObject>{
        val current=policy.current;check(number(state,"protocol")==5L){"E2EE_STREAMED_PLAN_ADOPTION_REQUIRED"};decode(encoded(state));current()
        val adopted=state.getJSONObject("adopted");val reference=planReference(adopted.getJSONObject("reference"));val id=adopted.getString("stateId")
        check(id=="${state.getString("migrationId")}:adoption:${reference.attemptId}"){"E2EE_CONTENT_PLAN_CONFLICT"}
        val saved=vault.read("local-snapshot",id)?:error("E2EE_CONTENT_PLAN_CONFLICT")
        try{
            current();check(saved.serial==1L&&hash(saved.bytes)==adopted.get("stateHash")){"E2EE_CONTENT_PLAN_CONFLICT"};val original=decode(saved.bytes)
            check(number(original,"protocol")==4L&&number(original.getJSONObject("ownership"),"protocol")==3L&&original.get("migrationId")==state.get("migrationId")
                &&original.get("sourceHash")==state.get("sourceHash")&&original.get("checkpointHash")==adopted.get("checkpointHash")&&original.get("directoryRevision")==adopted.get("directoryRevision")
                &&sameTechnical(original.getJSONObject("ownership"),state.getJSONObject("ownership"))&&sameTechnical(original.getJSONObject("source"),state.getJSONObject("source"))){"E2EE_CONTENT_PLAN_CONFLICT"}
            val plans=original.getJSONObject("ownership").getJSONArray("plans")
            val plan=(0 until plans.length()).map{plans.getJSONObject(it)}.find{!it.isNull("completion")&&sameTechnical(it.getJSONObject("completion"),planReferenceJson(reference))}?:error("E2EE_CONTENT_PLAN_CONFLICT")
            val read=contentPlanRead(state,plan,policy);val manifest=E2eeContentPlan.open(read,reference).manifest;current()
            for(name in listOf("plan","logical","local"))check(sameTechnical(JSONObject().put("values",state.getJSONArray(name)),JSONObject().put("values",manifest.getJSONArray(name)))){"E2EE_CONTENT_PLAN_CONFLICT"}
            return read to original
        }finally{saved.bytes.fill(0)}
    }
    internal suspend fun runStreamed(input:E2eeStreamedPlanningOptions):String{
        val policy=planningPolicy(input)
        return fenced{val state=load().state;val (_,original)=adoptedPlan(state,policy);checkOwnedOriginals(original,policy,planningSigner(policy));policy.current();runLocked(policy)}
    }
    /** Durable exact request reservation precedes observation.prepare/network.
     * Missing, partial and complete previous reservations all remain owned. */
    internal suspend fun reserveStreamedRemoteOriginal(registration:JSONObject,packet:JSONObject,input:E2eeStreamedPlanningOptions) {
        val saved=JSONObject(registration.toString());val request=JSONObject(packet.toString());val policy=planningPolicy(input);val current=policy.current
        return fenced {
            current();policy.options.device.ensureDurableKeys();current();val loaded=load();val state=loaded.state;current()
            check(number(state,"protocol")==4L&&!state.isNull("lease")&&!state.isNull("sourceHash")&&state.isNull("pending")&&state.isNull("resuming")){"E2EE_STREAMED_PLANNING_REQUIRED"}
            val publicKey=planningSigner(policy);assertPlanningPackets(state,publicKey,current);checkOwnedOriginals(state,policy,publicKey)
            val authenticated=E2eeRemoteOriginal.authenticateRegistration(saved,request,publicKey,originalRead(policy),number(lease(state),"generation",1));current()
            check(authenticated.binding.fence==number(lease(state),"fence",1)&&authenticated.binding.migrationId==state.get("migrationId")&&authenticated.binding.sourceHash==state.get("sourceHash")){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
            val originals=state.getJSONObject("ownership").getJSONArray("originals")
            check(originals.length()<1000&&(0 until originals.length()).none{originals.getJSONObject(it).getJSONObject("registration").get("id")==authenticated.id}){"E2EE_STREAMED_ORIGINAL_ALREADY_RESERVED"}
            val next=JSONObject(state.toString());next.getJSONObject("ownership").getJSONArray("originals").put(JSONObject().put("registration",authenticated.toJson()).put("packet",request)
                .apply{if(number(state.getJSONObject("ownership"),"protocol")!=1L)put("completion",JSONObject.NULL)})
            drainHistory(preparedHistory(loaded,policy),current);current()
            val guard=E2eeMigrationStage.publicationGuard(vault,state.getJSONObject("source"),E2eeSourceStage.Target(ownerId,scopeId,kind),required,current);val bytes=encoded(next)
            try{
                check(bytes.size.toLong()+guard.bytes.size<=policy.options.capacity.maximumMetadataBytes){"E2EE_SOURCE_HISTORY_CAPACITY"}
                policy.options.admit(E2eeMigrationHistory.Admission(0,0,bytes.size+guard.bytes.size,1));current();policy.options.device.ensureDurableKeys();current()
                save(Loaded(next,loaded.serial),listOf(guard),current);current()
            }finally{guard.bytes.fill(0);bytes.fill(0)}
        }
    }
    private fun packet(state: JSONObject, action: String, payload: JSONObject, operationId: String = UUID.randomUUID().toString()): JSONObject =
        E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",ownerId).put("scopeId",scopeId).put("deviceId",deviceId)
            .put("action",action).put("expectedRevision",number(state,"directoryRevision")).put("checkpointHash",state.get("checkpointHash"))
            .put("securityEpoch",securityEpoch).put("operationId",operationId).put("payload",payload),signingKey)
    private fun lease(state: JSONObject) = nullable(state,"lease") ?: throw IllegalStateException("E2EE_CORRUPT_MIGRATION")
    private suspend fun send(loaded: Loaded, packet: JSONObject,current:()->Unit=vault::requireOpen) {
        current();loaded.state.put("pending",JSONObject(packet.toString())); save(loaded,current=current);current(); replay(loaded,current)
    }
    private suspend fun replay(loaded: Loaded,current:()->Unit=vault::requireOpen) {
        val state = loaded.state; val pending = nullable(state,"pending") ?: error("E2EE_CORRUPT_MIGRATION")
        current();vault.requireOpen()
        if(pending.getJSONObject("command").getString("action") in setOf("migration-verify","migration-commit"))verifyLocal(state)
        val result = try { transport.command(JSONObject(pending.toString())) } catch (error: Exception) {
            current()
            if (error.message != "E2EE_MIGRATION_FENCED" || state.isNull("lease") || pending.getJSONObject("command").get("action") == "migration-start") throw error
            resume(loaded,current); if (!state.isNull("pending")) replay(loaded,current); return
        }
        current();vault.requireOpen(); applyReceipt(loaded,result,current)
    }
    private fun receipt(condition: Boolean) { check(condition) { "E2EE_INVALID_RECEIPT" } }
    private fun applyReceipt(loaded: Loaded, result: JSONObject,current:()->Unit=vault::requireOpen) {
        current()
        val state = loaded.state; val pending = state.getJSONObject("pending"); val command = pending.getJSONObject("command")
        when (command.getString("action")) {
            "migration-start" -> {
                val fence = number(result,"fence",1); val until = number(result,"leaseUntil",1); val generation = number(result,"generation",1)
                state.put("lease",JSONObject().put("fence",fence).put("leaseUntil",until).put("generation",generation)).put("phase",if(number(state,"protocol")==4L)"preparing"else"uploading")
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
        current();state.put("pending",JSONObject.NULL); save(loaded,current=current);current()
    }
    private suspend fun resume(loaded: Loaded,current:()->Unit=vault::requireOpen) {
        current()
        val state = loaded.state; val lease = lease(state); check(!state.isNull("sourceHash")) { "E2EE_CORRUPT_MIGRATION" }
        if (state.isNull("resuming")) {
            val pending = nullable(state,"pending")?.getJSONObject("command")
            state.put("resuming",packet(state,"migration-resume",JSONObject().put("migrationId",state.get("migrationId"))
                .put("fence",lease.get("fence")).put("sourceHash",state.get("sourceHash"))
                .put("pendingOperationId",pending?.get("operationId") ?: JSONObject.NULL).put("pendingHash",pending?.let(E2eeCommands::hash) ?: JSONObject.NULL)))
            current();save(loaded,current=current);current()
        }
        current();vault.requireOpen(); val result = transport.command(JSONObject(state.getJSONObject("resuming").toString()));current(); vault.requireOpen()
        receipt(number(result,"fence",1) == number(lease,"fence",1)+1 && number(result,"generation",1) == number(lease,"generation",1))
        state.put("lease",JSONObject().put("fence",result.get("fence")).put("leaseUntil",number(result,"leaseUntil",1)).put("generation",lease.get("generation")))
        if (!result.isNull("pendingReceipt")) {
            val pending = nullable(state,"pending") ?: error("E2EE_INVALID_RECEIPT"); val recovered = result.getJSONObject("pendingReceipt")
            receipt(recovered.get("payloadHash") == E2eeCommands.hash(pending.getJSONObject("command")))
            state.put("resuming",JSONObject.NULL); applyReceipt(loaded,recovered.getJSONObject("result"),current); return
        }
        nullable(state,"pending")?.getJSONObject("command")?.let { previous ->
            val renewed = JSONObject(previous.toString()); renewed.getJSONObject("payload").put("fence",result.get("fence"))
            state.put("pending",E2eeCommands.sign(renewed,signingKey))
        }
        current();state.put("resuming",JSONObject.NULL); save(loaded,current=current);current()
    }
    private suspend fun plan(loaded: Loaded) {
        val state = loaded.state; val local = snapshot(state); val previous = mutableListOf<ByteArray>(); var content = emptyList<E2eeMigrationContent>();var localContent=emptyList<E2eeMigrationContent>()
        val changes = mutableListOf<UnlockedE2eeVault.Write>()
        try {
            var total = local.size.toLong(); val ancestors = state.getJSONArray("ancestors")
            for (index in 0 until ancestors.length()) {
                val row = vault.read("local-snapshot",ancestors.getString(index)) ?: error("E2EE_CORRUPT_SNAPSHOT")
                val old = try { decode(row.bytes) } finally { row.bytes.fill(0) }
                check(number(old,"protocol")<3L){"E2EE_STREAMED_SOURCE_REQUIRED"}
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
    private suspend fun runLocked(policy:PlanningPolicy?=null): String {
        val loaded = load(); val state = loaded.state
        val current=policy?.current?:vault::requireOpen;current()
        if(number(state,"protocol")==3L&&state.get("phase")=="cancelled")return "cancelled"
        check(number(state,"protocol")<3L||number(state,"protocol")==5L&&policy!=null){"E2EE_STREAMED_PLANNER_REQUIRED"}
        ensureDurableKeys()
        verifyLocal(state)
        if (!state.isNull("resuming")) resume(loaded,current)
        if (!state.isNull("pending")) replay(loaded,current)
        if (state.get("phase") in setOf("active","cancelled")) return state.getString("phase")
        if (state.get("phase") == "preparing") {
            vault.requireOpen(); val source = transport.sourceHash(); vault.requireOpen(); E2eeEnvelope.decode(source,32); state.put("sourceHash",source)
            send(loaded,packet(state,"migration-start",JSONObject().put("migrationId",state.get("migrationId")).put("sourceHash",source)))
        }
        if (number(lease(state),"leaseUntil",1) <= System.currentTimeMillis()/1000+30) resume(loaded,current)
        if (state.get("phase") == "uploading" && (if(number(state,"protocol")==1L)state.getJSONArray("plan").length()==0 else !state.getBoolean("planned"))) plan(loaded)
        verifyLocal(state)
        val plan = state.getJSONArray("plan")
        while (state.get("phase") == "uploading" && number(state,"uploaded") < plan.length()) {
            current()
            val item = plan.getJSONObject(number(state,"uploaded").toInt()); val row = vault.read("outbox",item.getString("recordId")) ?: error("E2EE_CORRUPT_OUTBOX")
            val envelope = try { E2eeEnvelope.Envelope.fromJson(JSONObject(row.bytes.toString(Charsets.UTF_8))).also {
                check(E2eeEnvelope.payloadHash(it) == item.get("hash")) { "E2EE_CORRUPT_OUTBOX" }
            } } finally { row.bytes.fill(0) }
            send(loaded,packet(state,"put",JSONObject().put("envelope",envelope.toJson()).put("expectedObjectRevision",0)
                .put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence")),envelope.context.toJson().getString("operationId")),current)
        }
        if (state.get("phase") == "uploading") {
            val heads=JSONArray()
            if(number(state,"protocol")==5L){
                val selected=adoptedPlan(state,requireNotNull(policy)).first;val readback=transport as? E2eeBoundedMigrationReadback?:error("E2EE_STREAMED_READBACK_REQUIRED")
                E2eeContentPlan.verifyReadback(selected,planReference(state.getJSONObject("adopted").getJSONObject("reference")),readback);current()
                for(index in 0 until plan.length()){val item=plan.getJSONObject(index);heads.put(JSONObject().put("domain",item.get("domain")).put("objectId",item.get("objectId")).put("revision",1).put("payloadHash",item.get("hash")))}
            }else{
            vault.requireOpen(); val remote = transport.readAll(); vault.requireOpen()
            val byId = mutableMapOf<String,E2eeEnvelope.Envelope>()
            for (envelope in remote) {
                val ctx = envelope.context.toJson(); check(byId.put(ctx.getString("domain")+"\u0000"+ctx.getString("objectId"),envelope) == null) { "E2EE_DUPLICATE_OBJECT" }
            }
            check(byId.size == plan.length()) { "E2EE_MANIFEST_MISMATCH" }
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
            }
            verifyRecovery(root); vault.requireOpen()
            verifyLocal(state)
            val manifest = E2eeFiles.objectManifestHash(heads); val checkpoint = E2eeEnvelope.encode(E2eeKeys.freshSecret())
            state.put("manifestHash",manifest).put("verifiedCheckpoint",checkpoint)
            send(loaded,packet(state,"migration-verify",JSONObject().put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence"))
                .put("manifestHash",manifest).put("objectCount",plan.length()).put("verifiedCheckpoint",checkpoint)),current)
        }
        if (state.get("phase") == "verified") {
            check(!state.isNull("manifestHash") && !state.isNull("verifiedCheckpoint")) { "E2EE_MIGRATION_UNVERIFIED" }
            send(loaded,packet(state,"migration-commit",JSONObject().put("migrationId",state.get("migrationId")).put("fence",lease(state).get("fence"))
                .put("manifestHash",state.get("manifestHash")).put("verifiedCheckpoint",state.get("verifiedCheckpoint"))
                .put("generation",lease(state).get("generation")).put("objectCount",plan.length())),current)
        }
        return state.getString("phase")
    }
    suspend fun cancel() = fenced { cancelLocked() }
    private suspend fun cancelLocked() {
        val loaded = load(); val state = loaded.state
        check(number(state,"protocol")!=4L){"E2EE_STREAMED_PLANNER_REQUIRED"}
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
    suspend fun restart() = fenced { check((loadOrNull()?.state?.let{number(it,"protocol")}?:0)<3L){"E2EE_STREAMED_SOURCE_REQUIRED"};cancelLocked(); prepareLocked() }
    suspend fun restartStaged(capture:E2eeStagedMigrationCapture,options:E2eeStagedMigrationOptions) {
        val captured=E2eeStagedMigrationCapture(capture.target,capture.paths,capture.capturePath)
        return fenced{cancelLocked();prepareStagedLocked(captured,options)}
    }
    override fun toString() = "E2eeMigration([redacted])"
}
