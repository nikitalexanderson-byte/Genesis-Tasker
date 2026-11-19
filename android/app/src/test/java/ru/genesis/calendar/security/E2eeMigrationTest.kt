package ru.genesis.calendar.security

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest

class E2eeMigrationTest {
    private class Memory : E2eeRecordStorage {
        var rows = mutableMapOf<String,E2eeLocalRecord>(); var full = false
        var afterCommit:((List<E2eeStorageChange>)->Unit)?=null
        override fun get(key: String) = rows[key]
        override fun list(prefix: String) = rows.keys.filter { it.startsWith(prefix) }
        override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
            requireOpen(); check(!full) { "SYNTHETIC_DISK_FULL" }
            for (change in changes) check(rows[change.key]?.serial == change.expected) { "E2EE_LOCAL_CONFLICT" }
            val copy = rows.toMutableMap()
            for (change in changes) if (change.value == null) copy.remove(change.key) else copy[change.key] = change.value
            requireOpen(); rows = copy;afterCommit?.invoke(changes)
        }
    }
    private class Device(val storage: Memory) : E2eeScopeDevice {
        override val ownerId = "owner"; override val deviceId = "device"
        private val privateKeys = E2eeKeys.generateDeviceKeys()
        override val vault = UnlockedE2eeVault(storage,UnlockedE2eeVault.Scope(ownerId,"device:$deviceId",deviceId,1,1,1,"local-one",
            privateKeys.signing.private,mapOf("local-one" to E2eeEnvelope.importRoot(E2eeKeys.freshSecret()))) { if (it == deviceId) privateKeys.signing.public else null })
        var durable = true
        override fun requireOpen() { vault.requireOpen() }
        override fun keys(): E2eeKeys.DeviceKeys { requireOpen(); return privateKeys }
        override fun ensureDurableKeys() { requireOpen(); check(durable) { "KEYS_NOT_DURABLE" } }
        override fun rememberDirectory(scopeId: String, pin: JSONObject, events: JSONArray, scopeOwner: String,
            onVerified: ((E2eeDirectory.Verified) -> Unit)?) = E2eeDirectory.verify(scopeOwner,scopeId,pin,events,onVerified=onVerified)
        override fun savedDirectory(scopeId: String, onVerified: ((E2eeDirectory.Verified) -> Unit)?): E2eeDirectory.Verified? = null
    }
    private class Options(val before: Int? = null, val after: Int? = null, val expire: Int? = null,
        val resumeBefore: Boolean = false, val resumeAfter: Boolean = false, val registry: String? = null,
        val missing: String? = null, val incomplete: Boolean = false, val truncated: Boolean = false,
        val badRecovery: Boolean = false, val poisonedCheckpoint: Boolean = false,val localOnly:Boolean=false,val withLocal:Boolean=false,
        val localBytes:ByteArray?=null) { var changedSource = false }
    private class Fixture(val options: Options = Options()) : E2eeMigrationTransport {
        val storage = Memory(); val device = Device(storage); val trace = mutableListOf<String>()
        val kind = options.registry ?: "personal"; val scope = "$kind:owner"
        val recovery = E2eeKeys.createRecoveryKit("owner"); val rawRoot = E2eeKeys.freshSecret(); val root = E2eeEnvelope.importRoot(rawRoot)
        val events = JSONArray(); val objects = mutableMapOf<String,E2eeEnvelope.Envelope>()
        val receipts = mutableMapOf<String,Pair<String,JSONObject>>(); var state = "legacy"; var calls = 0
        val commands=mutableListOf<JSONObject>();var onReconcile:(()->Unit)?=null
        var fence = 1L; var generation = 1L; var migrationId: String? = null; var crashed = false; var resumedCrash = false; var expiredOnce = false
        var previousSnapshots = emptyList<String>()
        lateinit var directory: E2eeDirectory.Verified
        val sources: E2eeMigrationSource
        init {
            val public = E2eeKeys.publicKeys(device.keys())
            val command = JSONObject().put("protocol",1).put("ownerId","owner").put("scopeId",scope).put("deviceId","device")
                .put("action","bootstrap").put("expectedRevision",0).put("checkpointHash","genesis").put("securityEpoch",1).put("operationId","bootstrap")
                .put("payload",JSONObject().put("kind",kind).put("resourceId","owner").put("keyId","root-one").put("generation",1)
                    .put("recoveryKit",recovery.kit).put("deviceKeys",public)
                    .put("deviceCapsule",E2eeKeys.sealRoot(rawRoot,public.getString("receivingKey"),E2eeKeys.RootRecipient("owner",scope,1,"root-one","device")))
                    .put("recoveryCapsule",E2eeKeys.sealRoot(rawRoot,recovery.kit.getJSONObject("authority").getString("receivingKey"),E2eeKeys.RootRecipient("owner",scope,1,"root-one","recovery"))))
            command.getJSONObject("payload").put("selfProof",E2eeCommands.sign(command,device.keys().signing.private).get("signature"))
            events.put(E2eeCommands.sign(command,recovery.keys.signing.private)); verifyDirectory()
            sources = if (options.registry == null) object : E2eeMigrationSource {
                override val requiredCoverage = listOf("synthetic.workspace","synthetic.diary")
                override val allowedContentDomains = setOf("workspace","diary")
                override fun assertBinding(owner: String, scope: String, kind: String) { check(owner == "owner" && scope == this@Fixture.scope) }
                override suspend fun captureLocal(): ByteArray { trace += "snapshot-local"; return "LOCAL DRAFT + OUTBOX + TOMBSTONES".toByteArray() }
                override suspend fun reconcile(snapshot: ByteArray, previous: List<ByteArray>): E2eeMigrationReconciliation {
                    trace += "reconcile"; assertEquals("LOCAL DRAFT + OUTBOX + TOMBSTONES",snapshot.toString(Charsets.UTF_8)); previousSnapshots = previous.map { it.toString(Charsets.UTF_8) }
                    onReconcile?.invoke()
                    return E2eeMigrationReconciliation(listOf("synthetic.workspace" to !options.incomplete,"synthetic.diary" to true),if(options.localOnly)emptyList()else listOf(
                        E2eeMigrationContent("workspace","workspace","PRIVATE WORKSPACE".toByteArray()),E2eeMigrationContent("diary","note","PRIVATE NOTE".toByteArray())),
                        if(options.localOnly||options.withLocal)listOf(E2eeMigrationContent("diary","device-private-note",options.localBytes?.copyOf()?:"DEVICE-ONLY PRIVATE DIARY + DRAFT".toByteArray(),"Private diary title.json"))else emptyList())
                }
                override suspend fun reconcile(snapshot: ByteArray, previous: List<ByteArray>, context: E2eeMigrationSourceContext?): E2eeMigrationReconciliation {
                    requireNotNull(context); assertEquals("owner",context.ownerId); assertEquals(scope,context.scopeId)
                    assertEquals(migrationId,context.migrationId); assertEquals(fence,context.fence); assertEquals(generation,context.generation)
                    assertEquals(E2eeEnvelope.encode(ByteArray(32) { 13 }),context.sourceHash)
                    return reconcile(snapshot,previous)
                }
            } else {
                val file = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }
                    .map { File(it,"contracts/e2ee/private-paths-v1.json") }.first { it.isFile }
                val inventory = E2eePrivatePaths(JSONObject(file.readText())); val registry = E2eeMigrationSources("owner",scope,kind,inventory)
                for (path in inventory.required(kind)) if (path.id != options.missing) registry.register(object : E2eePrivatePathAdapter {
                    override val id = path.id
                    override suspend fun captureLocal(): ByteArray { trace += "snapshot-local"; return "local:$id".toByteArray() }
                    override suspend fun reconcile(local: ByteArray, previous: List<ByteArray>): E2eePathReconciliation {
                        assertEquals("local:$id",local.toString(Charsets.UTF_8))
                        return E2eePathReconciliation(!options.incomplete,listOf(E2eeMigrationContent(if(id == "project.content")"shared-comment" else path.domains.first(),id,"reconciled:$id".toByteArray())))
                    }
                    override suspend fun reconcile(local: ByteArray, previous: List<ByteArray>, context: E2eeMigrationSourceContext?): E2eePathReconciliation {
                        requireNotNull(context); assertEquals(scope,context.scopeId); assertEquals(migrationId,context.migrationId); assertEquals(fence,context.fence)
                        return reconcile(local,previous)
                    }
                })
                registry
            }
        }
        fun verifyDirectory() { directory = E2eeDirectory.verify("owner",scope,recovery.kit.getJSONObject("authority"),events) }
        fun make() = E2eeMigration(device.vault,directory,"device",device.keys().signing.private,device.keys().signing.public,root,this,sources,
            { trace += "durable-keys"; device.ensureDurableKeys() },object : E2eeMigrationFence {
                override suspend fun <T> withFence(operation: suspend () -> T): T { trace += "local-fence"; return operation() }
            },{ candidate -> trace += "recovery-checked"; check(!options.badRecovery) { "RECOVERY_FAILED" }
                val restored = E2eeKeys.recoverAuthority("owner",recovery.secret,recovery.kit)
                val opened = E2eeKeys.openRoot(directory.recoveryCapsule,restored.receiving,E2eeKeys.RootRecipient("owner",scope,1,"root-one","recovery"))
                assertArrayEquals(candidate.encoded,opened.encoded)
            })
        private fun current() = objects.values.filter { it.context.toJson().getLong("dataGeneration") == generation }
        private fun heads() = JSONArray(current().map { envelope -> envelope.context.toJson().let { ctx -> JSONObject().put("domain",ctx.get("domain"))
            .put("objectId",ctx.get("objectId")).put("revision",ctx.get("revision")).put("payloadHash",E2eeEnvelope.payloadHash(envelope)) } })
        override suspend fun sourceHash(): String {
            trace += "network-source"; assertTrue(storage.rows.values.any { it.envelope.context.toJson().getString("objectId").startsWith("migration:") })
            return E2eeEnvelope.encode(ByteArray(32) { 13 })
        }
        override suspend fun command(packet: JSONObject): JSONObject {
            val command = E2eeCommands.verify(packet,device.keys().signing.public); val id = command.getString("operationId"); val identity = E2eeCommands.hash(command)
            commands+=JSONObject(packet.toString())
            val action = command.getString("action"); trace += "network-$action"
            receipts[id]?.let { assertEquals(it.first,identity); return JSONObject(it.second.toString()) }
            val index = calls++; val payload = command.getJSONObject("payload")
            if (options.before == index && !crashed) { crashed = true; error("SYNTHETIC_PROCESS_DEATH") }
            if (options.expire == index && !expiredOnce) { expiredOnce = true; error("E2EE_MIGRATION_FENCED") }
            if (action in setOf("put","migration-verify","migration-commit")) check(payload.getLong("fence") == fence) { "E2EE_MIGRATION_FENCED" }
            val result = when (action) {
                "migration-start" -> {
                    if (migrationId != null && migrationId != payload.getString("migrationId")) { generation++; fence++ }
                    migrationId = payload.getString("migrationId"); state = "uploading"
                    JSONObject().put("fence",fence).put("leaseUntil",2000000000).put("generation",generation)
                }
                "migration-resume" -> {
                    check(!options.changedSource) { "E2EE_SOURCE_CHANGED" }; assertEquals(fence,payload.getLong("fence"))
                    if (options.resumeBefore && !resumedCrash) { resumedCrash = true; error("SYNTHETIC_PROCESS_DEATH") }
                    fence++; val old = receipts[payload.optString("pendingOperationId")]
                    JSONObject().put("fence",fence).put("leaseUntil",2000000000).put("generation",generation)
                        .put("pendingReceipt",old?.let { JSONObject().put("payloadHash",it.first).put("result",it.second) } ?: JSONObject.NULL)
                }
                "put" -> {
                    assertEquals("uploading",state); val envelope = E2eeEnvelope.Envelope.fromJson(payload.getJSONObject("envelope")); val ctx = envelope.context.toJson()
                    val key = "$generation\u0000${ctx.getString("domain")}\u0000${ctx.getString("objectId")}"; assertFalse(objects.containsKey(key)); objects[key] = envelope
                    JSONObject().put("revision",1).put("payloadHash",E2eeEnvelope.payloadHash(envelope)).put("generation",generation)
                }
                "migration-verify" -> {
                    assertEquals(E2eeFiles.objectManifestHash(heads()),payload.get("manifestHash")); assertEquals(current().size,payload.getInt("objectCount"))
                    state = "verified"; JSONObject().put("state",state).put("manifestHash",payload.get("manifestHash"))
                }
                "migration-commit" -> {
                    assertEquals("verified",state); state = "active"; events.put(packet); verifyDirectory()
                    val checkpoint = E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest("${command.getString("checkpointHash")}\u0000$identity".toByteArray()))
                    JSONObject().put("state",state).put("directoryRevision",command.getLong("expectedRevision")+1)
                        .put("checkpointHash",if(options.poisonedCheckpoint)"unsigned-server-value" else checkpoint)
                }
                "migration-cancel" -> { check(state != "active"); state = "legacy"; JSONObject().put("state","preparing") }
                else -> error("Unexpected synthetic command")
            }
            receipts[id] = identity to JSONObject(result.toString())
            if (action == "migration-resume" && options.resumeAfter && !resumedCrash) { resumedCrash = true; error("SYNTHETIC_PROCESS_DEATH") }
            if (options.after == index && !crashed) { crashed = true; error("SYNTHETIC_PROCESS_DEATH") }
            return result
        }
        override suspend fun readAll(): List<E2eeEnvelope.Envelope> { trace += "read-back"; return if(options.truncated)current().drop(1) else current() }
        fun stateObjectId()=storage.rows.values.first{it.envelope.context.toJson().getString("objectId").startsWith("migration:")}.envelope.context.toJson().getString("objectId")
        fun journal():JSONObject {
            val row=requireNotNull(device.vault.read("local-snapshot",stateObjectId()))
            return try{JSONObject(row.bytes.toString(Charsets.UTF_8))}finally{row.bytes.fill(0)}
        }
        fun changeJournal(operation:(JSONObject)->Unit){
            val id=stateObjectId();val row=requireNotNull(device.vault.read("local-snapshot",id));val value=try{JSONObject(row.bytes.toString(Charsets.UTF_8))}finally{row.bytes.fill(0)}
            operation(value);val bytes=value.toString().toByteArray();try{device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,bytes,row.serial)))}finally{bytes.fill(0)}
        }
        fun readComment(objectId: String): String {
            val client = E2eeScopeClient(device,"owner",scope,recovery.kit.getJSONObject("authority"),object : E2eeScopeTransport {
                override fun directory(scopeId: String) = JSONObject().put("events",events)
                override fun command(packet: JSONObject): JSONObject = error("Read-only fixture")
                override fun read(packet: JSONObject): JSONObject {
                    val command = E2eeCommands.verify(packet,device.keys().signing.public); val payload = command.getJSONObject("payload")
                    val result = JSONObject().put("checkpointHash",command.get("checkpointHash")).put("directoryRevision",command.get("expectedRevision"))
                    return when (command.getString("action")) {
                        "sealed-heads" -> result.put("objects",heads())
                        "get" -> result.put("envelopes",JSONArray(current().filter { it.context.toJson().get("domain") == payload.get("domain") && it.context.toJson().get("objectId") == payload.get("objectId") }.map { it.toJson() }))
                        else -> error("Unexpected read")
                    }
                }
            })
            client.refresh(); val opened = requireNotNull(client.read("shared-comment",objectId))
            return try { opened.bytes.toString(Charsets.UTF_8) } finally { opened.bytes.fill(0) }
        }
        var badPage: String? = null
        var pageRequests = 0
        fun paginatedTransport() = E2eeSignedMigrationTransport(device,directory,setOf("workspace","diary")) { path, body ->
            if (path == "/source") JSONObject().put("sourceHash",E2eeEnvelope.encode(ByteArray(32)))
            else {
                val command = E2eeCommands.verify(body,device.keys().signing.public); assertEquals("read",command.getString("action")); val payload = command.getJSONObject("payload"); pageRequests++
                val domain = payload.getString("domain"); val after = payload.getString("after")
                val rows = current().filter { it.context.toJson().getString("domain") == domain }
                    .sortedBy { it.context.toJson().getString("objectId") }.filter { badPage == "loop" || it.context.toJson().getString("objectId") > after }.take(1)
                if (badPage == "lock") device.vault.lock()
                JSONObject().put("checkpointHash",directory.checkpoint.hash).put("directoryRevision",directory.checkpoint.revision+if(badPage == "directory")1 else 0)
                    .put("envelopes",JSONArray(rows.map { it.toJson() }))
            }
        }
    }
    private suspend fun reject(code: String, action: suspend () -> Unit) {
        try { action() } catch (error: Exception) { assertEquals(code,error.message); return }; fail("Unsafe synthetic migration accepted")
    }
    @Test fun localOnlyOutputKeepsMultipartBytesFilenameAndDigestOffEveryNetworkPacket()=runBlocking{
        val payload=ByteArray(3*E2eeFiles.CHUNK_BYTES+13){71};val f=Fixture(Options(withLocal=true,localBytes=payload));val migration=f.make()
        migration.prepare();reject("E2EE_MIGRATION_UNVERIFIED"){migration.readLocal("diary","device-private-note")}
        assertEquals("active",migration.run());assertEquals(4,f.objects.size)
        val opened=requireNotNull(f.make().readLocal("diary","device-private-note"));try{assertArrayEquals(payload,opened.bytes);assertEquals("Private diary title.json",opened.filename)}finally{opened.bytes.fill(0)}
        assertNull(f.make().readLocal("diary","absent"));reject("E2EE_LOCAL_CONTENT_FORBIDDEN"){f.make().readLocal("attachment","device-private-note")}
        val journal=f.journal();assertEquals(2,journal.getInt("protocol"));assertEquals(4,journal.getJSONArray("local").getJSONObject(0).getInt("parts"))
        val wire=f.commands.joinToString{it.toString()};for(privateValue in listOf("device-private-note","Private diary title.json",journal.getJSONArray("local").getJSONObject(0).getString("plaintextHash")))assertFalse(wire.contains(privateValue))
        assertFalse(f.storage.rows.values.any{it.envelope.toJson().toString().contains("Private diary title.json")})
        f.device.vault.lock();reject("E2EE_UNLOCK_REQUIRED"){migration.readLocal("diary","device-private-note")}
    }
    @Test fun entirelyLocalPlanAndEveryAmbiguousNetworkCrashNeverUploadAPrivateObject()=runBlocking{
        for(timing in listOf("before","after"))for(index in 0..2){
            val f=Fixture(Options(before=if(timing=="before")index else null,after=if(timing=="after")index else null,localOnly=true))
            f.make().prepare();reject("SYNTHETIC_PROCESS_DEATH"){f.make().run()};assertEquals("active",f.make().run())
            assertTrue(f.objects.isEmpty());assertTrue(f.commands.none{it.getJSONObject("command").getString("action")=="put"})
            val record=requireNotNull(f.make().readLocal("diary","device-private-note"));try{assertEquals("DEVICE-ONLY PRIVATE DIARY + DRAFT",record.bytes.toString(Charsets.UTF_8))}finally{record.bytes.fill(0)}
        }
    }
    @Test fun fullDiskAndProcessDeathAtLocalCommitKeepOriginalSnapshotAndReuseOnlyTheCommittedPlan()=runBlocking{
        val full=Fixture(Options(withLocal=true));full.make().prepare();full.onReconcile={full.storage.full=true}
        reject("SYNTHETIC_DISK_FULL"){full.make().run()};assertTrue(full.objects.isEmpty());assertTrue(full.storage.rows.values.none{it.envelope.context.toJson().getString("objectId").contains(":private:")})
        full.storage.full=false;full.onReconcile=null;assertEquals("active",full.make().run())
        val died=Fixture(Options(localOnly=true));died.make().prepare();var interrupted=false
        died.storage.afterCommit={changes->if(!interrupted&&changes.any{it.value?.envelope?.context?.toJson()?.getString("objectId")?.contains(":private:")==true}){interrupted=true;error("SYNTHETIC_PROCESS_DEATH")}}
        reject("SYNTHETIC_PROCESS_DEATH"){died.make().run()};val count=died.trace.count{it=="reconcile"};assertEquals("active",died.make().run());assertEquals(count,died.trace.count{it=="reconcile"});assertTrue(died.objects.isEmpty())
    }
    @Test fun missingLocalPartStopsPendingCommitReplayBeforeNetworkAndNeverBecomesEmpty()=runBlocking{
        val f=Fixture(Options(before=2,localOnly=true));f.make().prepare();reject("SYNTHETIC_PROCESS_DEATH"){f.make().run()};assertEquals("verified",f.state)
        val part=f.storage.rows.entries.first{it.value.envelope.context.toJson().getString("objectId").contains(":private:")};val saved=part.value;val key=part.key
        f.storage.rows.remove(key);val count=f.commands.size;reject("E2EE_CORRUPT_LOCAL_CONTENT"){f.make().run()};assertEquals(count,f.commands.size);assertEquals("verified",f.state)
        f.storage.rows[key]=saved;assertEquals("active",f.make().run());f.storage.rows.remove(key);reject("E2EE_CORRUPT_LOCAL_CONTENT"){f.make().readLocal("diary","device-private-note")}
    }
    @Test fun journalV1ResumesButUnboundV2LocalMetadataCannotReachNetwork()=runBlocking{
        val old=Fixture();old.make().prepare();old.changeJournal{it.put("protocol",1);it.remove("local");it.remove("planned")};assertEquals("active",old.make().run())
        val bad=Fixture(Options(before=1,localOnly=true));bad.make().prepare();reject("SYNTHETIC_PROCESS_DEATH"){bad.make().run()}
        bad.changeJournal{it.getJSONArray("local").getJSONObject(0).put("recordId","foreign-source")};val count=bad.commands.size
        reject("E2EE_CORRUPT_LOCAL_CONTENT"){bad.make().run()};assertEquals(count,bad.commands.size)
    }
    @Test fun snapshotReadbackRecoveryAndFinalCommitAreOrderedAndIdempotent() = runBlocking {
        val f = Fixture(); val migration = f.make(); migration.prepare(); assertEquals(0,f.calls)
        assertEquals("active",migration.run()); assertEquals("active",f.state)
        assertTrue(f.trace.indexOf("snapshot-local") < f.trace.indexOf("network-source"))
        assertTrue(f.trace.indexOf("read-back") < f.trace.indexOf("network-migration-verify"))
        assertTrue(f.trace.indexOf("recovery-checked") < f.trace.indexOf("network-migration-commit"))
        assertFalse(f.storage.rows.values.any { it.envelope.toJson().toString().contains("LOCAL DRAFT") })
        val count = f.calls; assertEquals("active",f.make().run()); assertEquals(count,f.calls)
        reject("E2EE_DOWNGRADE_FORBIDDEN") { migration.cancel() }
    }
    @Test fun processDeathBeforeAndAfterEachRemoteOperationReplaysDurableCiphertext() = runBlocking {
        for (after in listOf(false,true)) for (index in 0..6) {
            val f = Fixture(if(after)Options(after=index) else Options(before=index)); f.make().prepare()
            reject("SYNTHETIC_PROCESS_DEATH") { f.make().run() }
            assertEquals("active",f.make().run()); assertEquals(4,f.objects.size); assertNull(f.make().status()?.pendingAction)
        }
    }
    @Test fun expiredLeaseAndCrashedRenewalKeepTheSameProtectedShadow() = runBlocking {
        for (index in 1..6) {
            val f = Fixture(Options(expire=index)); f.make().prepare(); assertEquals("active",f.make().run()); assertEquals(2L,f.fence); assertEquals(4,f.objects.size)
        }
        for (after in listOf(false,true)) {
            val f = Fixture(Options(expire=3,resumeBefore=!after,resumeAfter=after)); f.make().prepare()
            reject("SYNTHETIC_PROCESS_DEATH") { f.make().run() }; assertEquals("active",f.make().run()); assertEquals(4,f.objects.size)
        }
    }
    @Test fun changedSourceRequiresExplicitRestartAndAllPriorSnapshotsAreRetained() = runBlocking {
        val options = Options(expire=3); options.changedSource = true; val f = Fixture(options); f.make().prepare()
        val first = f.make().status()!!.migrationId; reject("E2EE_SOURCE_CHANGED") { f.make().run() }
        assertTrue(f.make().status()!!.resuming); val count = f.objects.size; f.make().restart()
        assertNotEquals(first,f.make().status()!!.migrationId); assertEquals(1,f.make().status()!!.ancestors.size)
        options.changedSource = false; assertEquals("active",f.make().run()); assertEquals(2L,f.generation); assertEquals(count+4,f.objects.size)
        assertEquals(listOf("LOCAL DRAFT + OUTBOX + TOMBSTONES"),f.previousSnapshots)
    }
    @Test fun fullStorageMissingKeysIncompleteDataAndBadRecoveryPreserveLegacyData() = runBlocking {
        val full = Fixture(); full.storage.full = true; reject("SYNTHETIC_DISK_FULL") { full.make().prepare() }; assertEquals(0,full.calls)
        val missing = Fixture(); missing.device.durable = false; reject("KEYS_NOT_DURABLE") { missing.make().prepare() }; assertEquals(0,missing.calls)
        for ((options,code) in listOf(Options(incomplete=true) to "E2EE_INCOMPLETE_COVERAGE",Options(truncated=true) to "E2EE_MANIFEST_MISMATCH",
            Options(badRecovery=true) to "RECOVERY_FAILED",Options(poisonedCheckpoint=true) to "E2EE_INVALID_RECEIPT")) {
            val f = Fixture(options); f.make().prepare(); reject(code) { f.make().run() }; assertNotEquals("active",f.make().status()!!.phase); assertTrue(f.storage.rows.size>1)
        }
    }
    @Test fun realRegistryAndNativeReaderAgreeOnSharedCommentWireFormat() = runBlocking {
        for (kind in listOf("personal","project","space")) {
            val f = Fixture(Options(registry=kind)); f.make().prepare(); assertEquals("active",f.make().run())
            if (kind == "project") assertEquals("reconciled:project.content",f.readComment("project.content"))
        }
        val missing = Fixture(Options(registry="personal",missing="personal.tasks")); reject("E2EE_SOURCE_ADAPTER_REQUIRED") { missing.make().prepare() }; assertEquals(0,missing.calls)
    }
    @Test fun authenticatedShadowPaginationRejectsLoopsEpochChangesAndLock() = runBlocking {
        val f = Fixture(); f.make().prepare(); f.make().run(); val transport = f.paginatedTransport()
        assertEquals(E2eeEnvelope.encode(ByteArray(32)),transport.sourceHash()); assertEquals(4,transport.readAll().size); assertEquals(7,f.pageRequests)
        f.badPage = "loop"; reject("E2EE_INVALID_RESPONSE") { transport.readAll() }
        f.badPage = "directory"; reject("E2EE_DIRECTORY_CONFLICT") { transport.readAll() }
        f.badPage = "lock"; reject("E2EE_UNLOCK_REQUIRED") { transport.readAll() }
    }
    @Test fun emitActualNativeReadbackPacketsForPhpSqliteContract() = runBlocking {
        val f = Fixture(); val reads = JSONArray(); var legacyRead: JSONObject? = null; var auroraRead: JSONObject? = null; var stoicheionRead: JSONObject? = null; var adviceRead: JSONObject? = null; var tasksRead: JSONObject? = null; var diaryRead: JSONObject? = null; var mindmapsRead: JSONObject? = null
        val transport = E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace")) { path, packet ->
            assertEquals("/read",path)
            if(packet.getJSONObject("command").getString("action") == "legacy-workspace") legacyRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-aurora") auroraRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-stoicheion") stoicheionRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-advice") adviceRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-tasks") tasksRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-diary") diaryRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-mindmaps") mindmapsRead = packet
            else { assertEquals("read",packet.getJSONObject("command").getString("action")); reads.put(packet) }
            JSONObject().put("checkpointHash",f.directory.checkpoint.hash).put("directoryRevision",f.directory.checkpoint.revision).put("envelopes",JSONArray())
        }
        assertTrue(transport.readAll().isEmpty()); assertEquals(2,reads.length())
        val context = E2eeMigrationSourceContext("owner",f.scope,"native-migration-transport",1,E2eeEnvelope.encode(ByteArray(32)),1)
        transport.legacyWorkspace(context); assertEquals("legacy-workspace",E2eeCommands.verify(requireNotNull(legacyRead),f.device.keys().signing.public).getString("action"))
        assertEquals(context.migrationId,legacyRead!!.getJSONObject("command").getJSONObject("payload").getString("migrationId"))
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyWorkspace(E2eeMigrationSourceContext("foreign",f.scope,context.migrationId,1,context.sourceHash,1)) }
        transport.legacyAurora(context); assertEquals("legacy-aurora",E2eeCommands.verify(requireNotNull(auroraRead),f.device.keys().signing.public).getString("action"))
        assertEquals(context.sourceHash,auroraRead!!.getJSONObject("command").getJSONObject("payload").getString("sourceHash"))
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyAurora(E2eeMigrationSourceContext("owner","personal:foreign",context.migrationId,1,context.sourceHash,1)) }
        val root = generateSequence(File(requireNotNull(System.getProperty("user.dir")))) { it.parentFile }.first { File(it,"contracts/e2ee/private-paths-v1.json").isFile }
        transport.legacyStoicheion(context); assertEquals("legacy-stoicheion",E2eeCommands.verify(requireNotNull(stoicheionRead),f.device.keys().signing.public).getString("action"))
        assertEquals(context.sourceHash,stoicheionRead!!.getJSONObject("command").getJSONObject("payload").getString("sourceHash"))
        transport.legacyAdvice(context); assertEquals("legacy-advice",E2eeCommands.verify(requireNotNull(adviceRead),f.device.keys().signing.public).getString("action"))
        val advicePayload=adviceRead!!.getJSONObject("command").getJSONObject("payload");E2eeKeys.exact(advicePayload,setOf("migrationId","fence","sourceHash"))
        assertEquals(context.migrationId,advicePayload.getString("migrationId"));assertEquals(context.fence,advicePayload.getLong("fence"));assertEquals(context.sourceHash,advicePayload.getString("sourceHash"))
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyAdvice(E2eeMigrationSourceContext("foreign",f.scope,context.migrationId,1,context.sourceHash,1)) }
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyAdvice(E2eeMigrationSourceContext("owner","personal:foreign",context.migrationId,1,context.sourceHash,1)) }
        transport.legacyTasks(context);assertEquals("legacy-tasks",E2eeCommands.verify(requireNotNull(tasksRead),f.device.keys().signing.public).getString("action"))
        val tasksPayload=tasksRead!!.getJSONObject("command").getJSONObject("payload");E2eeKeys.exact(tasksPayload,setOf("migrationId","fence","sourceHash"))
        assertEquals(context.migrationId,tasksPayload.getString("migrationId"));assertEquals(context.fence,tasksPayload.getLong("fence"));assertEquals(context.sourceHash,tasksPayload.getString("sourceHash"))
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyTasks(E2eeMigrationSourceContext("foreign",f.scope,context.migrationId,1,context.sourceHash,1)) }
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyTasks(E2eeMigrationSourceContext("owner","personal:foreign",context.migrationId,1,context.sourceHash,1)) }
        transport.legacyDiary(context);assertEquals("legacy-diary",E2eeCommands.verify(requireNotNull(diaryRead),f.device.keys().signing.public).getString("action"))
        val diaryPayload=diaryRead!!.getJSONObject("command").getJSONObject("payload");E2eeKeys.exact(diaryPayload,setOf("migrationId","fence","sourceHash"))
        assertEquals(context.migrationId,diaryPayload.getString("migrationId"));assertEquals(context.fence,diaryPayload.getLong("fence"));assertEquals(context.sourceHash,diaryPayload.getString("sourceHash"))
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyDiary(E2eeMigrationSourceContext("foreign",f.scope,context.migrationId,1,context.sourceHash,1)) }
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyDiary(E2eeMigrationSourceContext("owner","personal:foreign",context.migrationId,1,context.sourceHash,1)) }
        transport.legacyMindmaps(context);assertEquals("legacy-mindmaps",E2eeCommands.verify(requireNotNull(mindmapsRead),f.device.keys().signing.public).getString("action"))
        val mapsPayload=mindmapsRead!!.getJSONObject("command").getJSONObject("payload");E2eeKeys.exact(mapsPayload,setOf("migrationId","fence","sourceHash"))
        assertEquals(context.migrationId,mapsPayload.getString("migrationId"));assertEquals(context.fence,mapsPayload.getLong("fence"));assertEquals(context.sourceHash,mapsPayload.getString("sourceHash"))
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyMindmaps(E2eeMigrationSourceContext("foreign",f.scope,context.migrationId,1,context.sourceHash,1)) }
        reject("E2EE_SCOPE_BINDING_MISMATCH") { transport.legacyMindmaps(E2eeMigrationSourceContext("owner","personal:foreign",context.migrationId,1,context.sourceHash,1)) }
        val file = File(root,"output/release-3.3.6/runtime/native-migration-transport.json"); file.parentFile.mkdirs()
        file.writeText(JSONObject().put("protocol",1).put("synthetic",true).put("platform","native").put("bootstrap",f.events.getJSONObject(0)).put("reads",reads).put("legacyRead",legacyRead).put("auroraRead",auroraRead).put("stoicheionRead",stoicheionRead).put("adviceRead",adviceRead).put("tasksRead",tasksRead).put("diaryRead",diaryRead).put("mindmapsRead",mindmapsRead).toString(2))
    }
}
