package ru.genesis.calendar.security

import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.File
import java.security.MessageDigest
import java.io.OutputStream
import kotlinx.coroutines.yield

class E2eeMigrationTest {
    private class Memory : E2eeRecordStorage {
        var rows = mutableMapOf<String,E2eeLocalRecord>(); var full = false
        val reads=mutableListOf<String>()
        var afterCommit:((List<E2eeStorageChange>)->Unit)?=null
        var beforeCommit:((List<E2eeStorageChange>)->Unit)?=null
        override fun get(key: String):E2eeLocalRecord? {reads+=key;return rows[key]}
        override fun list(prefix: String) = rows.keys.filter { it.startsWith(prefix) }
        override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
            requireOpen(); check(!full) { "SYNTHETIC_DISK_FULL" }
            beforeCommit?.invoke(changes)
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
    private fun staged(f:Fixture,producer:(suspend (String,OutputStream)->Unit)?=null)=E2eeStagedMigrationCapture(E2eeSourceStage.Target("owner",f.scope,f.kind),f.sources.requiredCoverage){id,out->
        if(producer!=null)producer(id,out)else{yield();out.write("STAGED ORIGINAL $id".toByteArray());yield()}
    }
    private fun stagedOptions()=E2eeStagedMigrationOptions(E2eeSourceStage.Capacity(4L*1024*1024,16),{},{})
    private fun historyInventory():E2eePrivatePaths {
        val file=generateSequence(File(requireNotNull(System.getProperty("user.dir")))){it.parentFile}.map{File(it,"contracts/e2ee/private-paths-v1.json")}.first{it.isFile}
        return E2eePrivatePaths(JSONObject(file.readText()))
    }
    private fun historyOptions()=E2eeMigrationHistory.Options(E2eeMigrationHistory.Capacity(8L*1024*1024,128,4*1024*1024),{},{})
    private fun readHistory(input:E2eeStagedSourceInput):List<Pair<String,List<String>>> = (listOf(input.current)+input.previous).map{source->
        source.id to source.paths.map{path->val reader=source.openPath(path);reader.input.use{val bytes=it.readBytes();try{reader.assertComplete();bytes.toString(Charsets.UTF_8)}finally{bytes.fill(0)}}}
    }
    @Test fun coordinatorResolvesExactMixedOriginalsAndCompleteOrphanWithoutNetwork()=runBlocking {
        for(protocol in listOf(1,2)){
            val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepare()
            if(protocol==1){val id="migration:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(f.scope.toByteArray()));val row=requireNotNull(f.device.vault.read("local-snapshot",id))
                val old=JSONObject(row.bytes.toString(Charsets.UTF_8));row.bytes.fill(0);old.put("protocol",1);old.remove("local");old.remove("planned")
                f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,old.toString().toByteArray(),row.serial)))}
            migration.cancel();val capture=staged(f);val orphan=E2eeSourceStage.create(E2eeSourceStage.Options(f.device.vault,capture.target,capture.paths,stagedOptions().capacity,{},{},{}))
            for(path in capture.paths)orphan.capturePath(path){it.write("ORPHAN $path".toByteArray())};val original=orphan.finish()
            migration.prepareStaged(capture,stagedOptions());migration.cancel();migration.restartStaged(capture,stagedOptions());val kept=f.storage.rows.toMap();var retained:E2eeStagedSourceInput?=null
            val result=f.make().withStagedSourceHistory(historyInventory(),historyOptions()){input->retained=input;readHistory(input)}
            assertEquals(4,result.size);assertEquals("STAGED ORIGINAL ${capture.paths[0]}",result[0].second[0]);assertEquals("local:${capture.paths[0]}",result[1].second[0]);assertEquals("stage:${original.stageId}",result[2].first);assertEquals("ORPHAN ${capture.paths[0]}",result[2].second[0])
            assertEquals(kept,f.storage.rows);assertEquals(0,f.calls);reject("E2EE_SOURCE_HISTORY_CLOSED"){requireNotNull(retained).current.openPath(capture.paths[0])}
        }
    }
    @Test fun coordinatorHistoryRequiresActualEofForEveryPathAndKeepsCaughtPrefixFailures()=runBlocking {
        for(mode in listOf("empty","prefix","missed-history","caught-busy")){
            val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepare();migration.cancel();migration.prepareStaged(staged(f),stagedOptions());val kept=f.storage.rows.toMap()
            reject("E2EE_SOURCE_INPUT_EOF_REQUIRED"){migration.withStagedSourceHistory(historyInventory(),historyOptions()){input->
                when(mode){
                    "prefix"->{val reader=input.current.openPath(input.current.paths.first());reader.input.read();reader.input.close()}
                    "missed-history"->readHistory(E2eeStagedSourceInput(input.current,emptyList()))
                    "caught-busy"->{val reader=input.current.openPath(input.current.paths.first());reject("E2EE_SOURCE_INPUT_BUSY"){input.previous.first().openPath(input.current.paths.first())};reader.input.close()}
                }
            }};assertEquals(kept,f.storage.rows);assertEquals(0,f.calls)
        }
    }
    @Test fun unknownOriginalMissingArchiveCorruptPartAndIncompleteStageRefuseBeforeConsumer()=runBlocking {
        for(mode in listOf("unknown","missing","corrupt","incomplete")){
            val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepare();migration.cancel();val capture=staged(f);migration.prepareStaged(capture,stagedOptions());val state=stagedState(f)
            when(mode){
                "unknown"->f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","unresolved:source:0",byteArrayOf(1),null)))
                "missing"->{val id=state.getJSONArray("ancestors").getString(0);f.storage.rows.remove(f.storage.rows.keys.single{it.endsWith(id)})}
                "corrupt"->{val id=f.storage.rows.values.first{it.envelope.context.toJson().getString("objectId").contains(":source:")}.envelope.context.toJson().getString("objectId");val row=requireNotNull(f.device.vault.read("local-snapshot",id));row.bytes.fill(0);f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,byteArrayOf(9),row.serial)))}
                "incomplete"->E2eeSourceStage.create(E2eeSourceStage.Options(f.device.vault,capture.target,capture.paths,stagedOptions().capacity,{},{},{}))
            }
            val kept=f.storage.rows.toMap();var called=0
            try{migration.withStagedSourceHistory(historyInventory(),historyOptions()){called++};fail("Incomplete history accepted")}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"))}
            assertEquals(0,called);assertEquals(kept,f.storage.rows);assertEquals(0,f.calls)
        }
    }
    @Test fun duplicateRawStateAndNonCancelledOrGappedAncestorCannotProjectIntoHistory()=runBlocking {
        for(mode in listOf("duplicate","active","hole")){
            val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepare();migration.cancel();migration.prepareStaged(staged(f),stagedOptions());val id=stagedState(f).getJSONArray("ancestors").getString(0)
            val row=requireNotNull(f.device.vault.read("local-snapshot",id));val old=JSONObject(row.bytes.toString(Charsets.UTF_8));row.bytes.fill(0)
            if(mode=="active")old.put("phase","active");if(mode=="hole")old.put("ancestors",JSONArray().put("unknown:archive"))
            var raw=old.toString();if(mode=="duplicate")raw=raw.replace("\"protocol\":2","\"protocol\":1,\"pr\\u006ftocol\":2")
            f.storage.rows.remove(f.storage.rows.keys.single{it.endsWith(id)});f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,raw.toByteArray(),null)))
            var called=0;try{migration.withStagedSourceHistory(historyInventory(),historyOptions()){called++};fail("Invalid original accepted")}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"))};assertEquals(0,called);assertEquals(0,f.calls)
        }
    }
    @Test fun historyCapacityAndAdmissionRefuseBeforeAnyOriginalPartBody()=runBlocking {
        for(mode in listOf("bytes","parts","metadata","admission")){
            val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepareStaged(staged(f),stagedOptions());val kept=f.storage.rows.toMap();var called=0
            val capacity=E2eeMigrationHistory.Capacity(if(mode=="bytes")1 else 8L*1024*1024,if(mode=="parts")1 else 128,if(mode=="metadata")1 else 4*1024*1024)
            val options=E2eeMigrationHistory.Options(capacity,{},{if(mode=="admission")error("SYNTHETIC_NO_SPACE")})
            try{migration.withStagedSourceHistory(historyInventory(),options){called++};fail("Over-capacity history accepted")}catch(error:Exception){assertTrue(error.message.orEmpty().contains("CAPACITY")||error.message=="SYNTHETIC_NO_SPACE")}
            assertEquals(0,called);assertEquals(kept,f.storage.rows);assertEquals(0,f.calls)
        }
    }
    @Test fun retiredActorChangedCoordinatorOrCatalogueCannotReturnHistorySuccess()=runBlocking {
        for(mode in listOf("actor","state","catalogue")){
            val f=Fixture(Options(registry="project"));val migration=f.make();val capture=staged(f);migration.prepareStaged(capture,stagedOptions());var live=true
            val options=E2eeMigrationHistory.Options(historyOptions().capacity,{check(live){"E2EE_ACCOUNT_CHANGED"}},{})
            try{migration.withStagedSourceHistory(historyInventory(),options){input->readHistory(input)
                when(mode){"actor"->live=false;"state"->f.make().cancel();"catalogue"->E2eeSourceStage.create(E2eeSourceStage.Options(f.device.vault,capture.target,capture.paths,stagedOptions().capacity,{},{},{}))}
            };fail("Changed history accepted")}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"))};assertEquals(0,f.calls)
        }
    }
    @Test fun retainedReaderIsClosedAndConsumerFailureSurvivesCleanup()=runBlocking {
        val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepareStaged(staged(f),stagedOptions());var retained:E2eeStagedPathReader?=null
        reject("SYNTHETIC_CONSUMER_FAILURE"){migration.withStagedSourceHistory(historyInventory(),historyOptions()){input->val reader=input.current.openPath(input.current.paths.first());retained=reader;reader.input.read();error("SYNTHETIC_CONSUMER_FAILURE")}}
        reject("E2EE_SOURCE_HISTORY_CLOSED"){requireNotNull(retained).input.read()};assertEquals(0,f.calls)
    }
    @Test fun unknownAncestorRoleRefusesBeforeCorrespondingBodyLookup()=runBlocking {
        val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepareStaged(staged(f),stagedOptions())
        val id="migration:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(f.scope.toByteArray()));val row=requireNotNull(f.device.vault.read("local-snapshot",id));val state=JSONObject(row.bytes.toString(Charsets.UTF_8));row.bytes.fill(0)
        state.put("ancestors",JSONArray().put("private:unexpected"));f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,state.toString().toByteArray(),row.serial)));f.storage.reads.clear()
        reject("E2EE_SOURCE_HISTORY_INVALID"){migration.withStagedSourceHistory(historyInventory(),historyOptions()){fail("Unknown role reached consumer")}}
        assertFalse(f.storage.reads.any{it.endsWith("private:unexpected")});assertEquals(0,f.calls)
    }
    @Test fun retainedPlanOrOrphanOutputCannotBeDiscardedBySourceOnlyHistory()=runBlocking {
        for(mode in listOf("legacy-output","orphan-upload","orphan-private","content-plan")){
            val f=Fixture(Options(before=2,registry="project"));val migration=f.make();migration.prepare()
            if(mode=="legacy-output")reject("SYNTHETIC_PROCESS_DEATH"){migration.run()}
            val original=stagedState(f).getString("migrationId");migration.cancel()
            if(mode=="legacy-output"){
                val kept=f.storage.rows.toMap();val calls=f.calls
                reject("E2EE_STREAMED_PLANNER_REQUIRED"){migration.prepareStaged(staged(f),stagedOptions())}
                assertEquals(kept,f.storage.rows);assertEquals(calls,f.calls);continue
            }
            migration.prepareStaged(staged(f),stagedOptions())
            when(mode){
                "orphan-upload"->f.device.vault.write(listOf(UnlockedE2eeVault.Write("outbox","$original:upload:unbound",byteArrayOf(1),null)))
                "orphan-private"->f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","$original:private:unbound",byteArrayOf(1),null)))
                "content-plan"->f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","content-plan:unbound:journal",byteArrayOf(1),null)))
            }
            val kept=f.storage.rows.toMap();val calls=f.calls;var consumed=false
            reject("E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED"){migration.withStagedSourceHistory(historyInventory(),historyOptions()){consumed=true}}
            assertFalse(consumed);assertEquals(kept,f.storage.rows);assertEquals(calls,f.calls)
        }
    }
    @Test fun everyPresentCancellationCopyNeedsItsOriginalBindingAndKnownRole()=runBlocking {
        for(mode in listOf("changed","duplicate","missing","unknown-role")){
            val f=Fixture(Options(registry="project"));val migration=f.make();migration.prepare();migration.cancel();migration.prepareStaged(staged(f),stagedOptions())
            val copy=f.storage.rows.values.first{it.envelope.context.toJson().getString("objectId").contains(":cancel:")}.envelope.context.toJson().getString("objectId")
            if(mode=="missing")f.storage.rows.remove(f.storage.rows.keys.single{it.endsWith(copy)})
            else if(mode=="unknown-role")f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","unknown:cancel:${java.util.UUID.randomUUID()}",byteArrayOf(9),null)))
            else{
                val row=requireNotNull(f.device.vault.read("local-snapshot",copy));val old=JSONObject(row.bytes.toString(Charsets.UTF_8));row.bytes.fill(0);if(mode=="changed")old.put("snapshotHash","A".repeat(43))
                var raw=old.toString();if(mode=="duplicate")raw=raw.replace("\"protocol\":2","\"protocol\":1,\"pr\\u006ftocol\":2")
                f.storage.rows.remove(f.storage.rows.keys.single{it.endsWith(copy)});f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",copy,raw.toByteArray(),null)))
            }
            val kept=f.storage.rows.toMap();f.storage.reads.clear();var consumed=false
            try{migration.withStagedSourceHistory(historyInventory(),historyOptions()){input->consumed=true;readHistory(input)};fail("Invalid cancellation history accepted")}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"))}
            assertFalse(consumed);if(mode=="unknown-role")assertFalse(f.storage.reads.any{it.contains("unknown:cancel:")});assertEquals(kept,f.storage.rows);assertEquals(0,f.calls)
        }
    }
    private fun stagedState(f:Fixture):JSONObject {
        val id="migration:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(f.scope.toByteArray()))
        val row=requireNotNull(f.device.vault.read("local-snapshot",id));return try{JSONObject(row.bytes.toString(Charsets.UTF_8))}finally{row.bytes.fill(0)}
    }
    @Test fun stagedPointerSurvivesColdCoordinatorAndCannotReachLegacyTransport()=runBlocking {
        val f=Fixture();val capture=staged(f);f.make().prepareStaged(capture,stagedOptions())
        val status=requireNotNull(f.make().status());assertEquals("source-stage-v1",status.sourceFormat);assertFalse(status.planReady)
        val state=stagedState(f);assertEquals(3,state.getInt("protocol"));for(field in listOf("snapshotParts","snapshotSize","snapshotHash"))assertFalse(state.has(field))
        val source=state.getJSONObject("source");val ref=source.getJSONObject("reference")
        assertEquals("device:device",source.getJSONObject("actor").getString("scopeId"))
        val opened=E2eeSourceStage.open(f.device.vault,capture.target,E2eeSourceStage.Reference(ref.getString("stageId"),ref.getString("manifestHash")),{})
        for(path in opened.paths)opened.openPath(path).use{assertEquals("STAGED ORIGINAL $path",it.readBytes().toString(Charsets.UTF_8));it.assertComplete()}
        reject("E2EE_STREAMED_PLANNER_REQUIRED"){f.make().run()};assertEquals(0,f.calls);assertFalse(f.trace.contains("network-source"))
    }
    @Test fun missingStagedRegistryPathRefusesBeforeKeysAndProducer()=runBlocking {
        val f=Fixture();var calls=0;val capture=E2eeStagedMigrationCapture(E2eeSourceStage.Target("owner",f.scope,f.kind),f.sources.requiredCoverage.dropLast(1)){_,_->calls++}
        reject("E2EE_SOURCE_ADAPTER_REQUIRED"){f.make().prepareStaged(capture,stagedOptions())}
        assertEquals(0,calls);assertFalse(f.trace.contains("durable-keys"));assertTrue(f.storage.rows.isEmpty());assertEquals(0,f.calls)
    }
    @Test fun committedPartDeathBlocksFutureCaptureWithoutDroppingIncompleteHistory()=runBlocking {
        val f=Fixture();val capture=staged(f){_,out->out.write(ByteArray(E2eeFiles.CHUNK_BYTES){47})};var died=false
        f.storage.afterCommit={changes->if(!died&&changes.any{it.key.contains("source-stage:")&&it.key.endsWith(":p:00:00000")}){died=true;error("SYNTHETIC_PART_DEATH")}}
        reject("SYNTHETIC_PART_DEATH"){f.make().prepareStaged(capture,stagedOptions())};assertNull(f.make().status())
        val known=E2eeSourceStage.inspect(f.device.vault,capture.target,{}).single();assertFalse(known.complete);val kept=f.storage.rows.toMap();var calls=0;f.storage.afterCommit=null
        reject("E2EE_SOURCE_STAGE_REPLAY_CHANGED"){f.make().prepareStaged(staged(f){_,_->calls++},stagedOptions())}
        assertEquals(1,calls);assertEquals(kept,f.storage.rows);assertEquals(0,f.calls)
        f.make().prepareStaged(capture,stagedOptions())
        val after=E2eeSourceStage.inspect(f.device.vault,capture.target,{});assertEquals(1,after.size);assertTrue(after.single().complete)
        assertEquals(known.id,stagedState(f).getJSONObject("source").getJSONObject("reference").getString("stageId"))
    }
    @Test fun lostCoordinatorCasLeavesCompleteOrphanInTheNextSnapshotHistory()=runBlocking {
        val f=Fixture();val capture=staged(f);var refused=false
        f.storage.beforeCommit={changes->if(!refused&&changes.any{it.value?.envelope?.context?.toJson()?.getString("objectId")?.startsWith("migration:")==true}){refused=true;error("E2EE_LOCAL_CONFLICT")}}
        reject("E2EE_LOCAL_CONFLICT"){f.make().prepareStaged(capture,stagedOptions())};assertNull(f.make().status())
        val orphan=E2eeSourceStage.inspect(f.device.vault,capture.target,{}).single();assertTrue(orphan.complete);val kept=f.storage.rows.toMap()
        f.make().prepareStaged(capture,stagedOptions());val history=stagedState(f).getJSONObject("source").getJSONArray("history");assertEquals(1,history.length());assertEquals(orphan.id,history.getJSONObject(0).getString("stageId"))
        for((key,value)in kept)if(!key.contains("source-stage-catalog:"))assertSame(value,f.storage.rows[key]);assertEquals(0,f.calls)
    }
    @Test fun pointerCommitDeathDoesNotStartAnotherCaptureAfterColdLoad()=runBlocking {
        val f=Fixture();val capture=staged(f);var died=false
        f.storage.afterCommit={changes->if(!died&&changes.any{it.value?.envelope?.context?.toJson()?.getString("objectId")?.startsWith("migration:")==true}){died=true;error("SYNTHETIC_POINTER_DEATH")}}
        reject("SYNTHETIC_POINTER_DEATH"){f.make().prepareStaged(capture,stagedOptions())};f.storage.afterCommit=null
        assertEquals("source-stage-v1",requireNotNull(f.make().status()).sourceFormat);val kept=f.storage.rows.toMap()
        reject("E2EE_MIGRATION_ALREADY_PREPARED"){f.make().prepareStaged(capture,stagedOptions())};assertEquals(kept,f.storage.rows)
        assertEquals(1,E2eeSourceStage.inspect(f.device.vault,capture.target,{}).size);assertEquals(0,f.calls)
    }
    @Test fun cancelledMixedAncestorsKeepExactVersionsAndCannotUseLegacyRestart()=runBlocking {
        val f=Fixture();val migration=f.make();migration.prepare();val original=stagedState(f);migration.cancel();val capture=staged(f)
        migration.prepareStaged(capture,stagedOptions());var state=stagedState(f);assertEquals(1,state.getJSONArray("ancestors").length())
        val previous=requireNotNull(f.device.vault.read("local-snapshot",state.getJSONArray("ancestors").getString(0)))
        try{val old=JSONObject(previous.bytes.toString(Charsets.UTF_8));assertEquals(2,old.getInt("protocol"));assertEquals(original.get("snapshotHash"),old.get("snapshotHash"));assertEquals("cancelled",old.get("phase"))}finally{previous.bytes.fill(0)}
        migration.cancel();assertEquals("cancelled",migration.run());val kept=f.storage.rows.toMap()
        reject("E2EE_STREAMED_SOURCE_REQUIRED"){migration.prepare()};reject("E2EE_STREAMED_SOURCE_REQUIRED"){migration.restart()};assertEquals(kept,f.storage.rows)
        migration.restartStaged(capture,stagedOptions());state=stagedState(f);assertEquals(2,state.getJSONArray("ancestors").length());assertEquals(1,state.getJSONObject("source").getJSONArray("history").length());assertEquals(0,f.calls)
    }
    @Test fun injectedStagedLeaseOrPlanCannotReachTransport()=runBlocking {
        for(mode in listOf("lease","planned","binding")){
            val f=Fixture();val capture=staged(f);f.make().prepareStaged(capture,stagedOptions());val state=stagedState(f)
            if(mode=="lease")state.put("lease",JSONObject().put("fence",1).put("generation",1).put("leaseUntil",2000000000))else if(mode=="planned")state.put("planned",true)
            else state.getJSONObject("source").getJSONObject("actor").put("deviceId","foreign-device")
            val id="migration:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(f.scope.toByteArray()))
            val row=requireNotNull(f.device.vault.read("local-snapshot",id));val bytes=state.toString().toByteArray()
            try{f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,bytes,row.serial)))}finally{bytes.fill(0);row.bytes.fill(0)}
            reject(if(mode=="binding")"E2EE_CORRUPT_STAGED_MIGRATION" else "E2EE_CORRUPT_MIGRATION"){f.make().run()};assertEquals(0,f.calls)
        }
    }
    @Test fun catalogueRaceDuringAdmissionAtomicallyRefusesPointerAndRetainsAllOriginals()=runBlocking {
        val f=Fixture();val capture=staged(f);var injected=false;val capacity=E2eeSourceStage.Capacity(4L*1024*1024,16)
        val options=E2eeStagedMigrationOptions(capacity,{}, {
            val known=E2eeSourceStage.inspect(f.device.vault,capture.target,{})
            if(!injected&&known.size==1&&known.single().complete){injected=true;E2eeSourceStage.create(E2eeSourceStage.Options(f.device.vault,capture.target,capture.paths,capacity,{},{},{}))}
        })
        reject("E2EE_LOCAL_CONFLICT"){f.make().prepareStaged(capture,options)};assertTrue(injected);assertNull(f.make().status())
        val known=E2eeSourceStage.inspect(f.device.vault,capture.target,{});assertEquals(2,known.size);assertTrue(known[0].complete);assertFalse(known[1].complete)
        f.make().prepareStaged(capture,stagedOptions());val after=E2eeSourceStage.inspect(f.device.vault,capture.target,{})
        assertEquals(2,after.size);assertTrue(after.all{it.complete});val source=stagedState(f).getJSONObject("source")
        assertEquals(known[1].id,source.getJSONObject("reference").getString("stageId"));assertEquals(known[0].id,source.getJSONArray("history").getJSONObject(0).getString("stageId"));assertEquals(0,f.calls)
    }
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
    @Test fun emitSignedReadbackAndFixtureOnlyLegacyPacketsForPhpSqliteContract() = runBlocking {
        val f = Fixture(); val reads = JSONArray(); var legacyRead: JSONObject? = null; var auroraRead: JSONObject? = null; var stoicheionRead: JSONObject? = null; var adviceRead: JSONObject? = null; var tasksRead: JSONObject? = null; var diaryRead: JSONObject? = null; var mindmapsRead: JSONObject? = null; var mindmapsPageRead:JSONObject?=null;var physisPageRead:JSONObject?=null;var archiveRead:JSONObject?=null
        // Packet generation for the PHP contract only; no HTTP/custody claim.
        val planning=object:E2eeMigrationPlanningPort {
            override val context=E2eeMigrationSourceContext("owner",f.scope,"native-migration-transport",1,E2eeEnvelope.encode(ByteArray(32)),1)
            override fun assertBinding(value:E2eeMigrationPlanningBinding){assertEquals("owner",value.ownerId);assertEquals(f.scope,value.scopeId)}
            override suspend fun requestLegacy(source:E2eeMigrationSourceContext,action:String,page:JSONObject?,send:suspend(JSONObject,ru.genesis.calendar.auth.E2eeHttpObservation)->JSONObject):JSONObject {
                val packet=E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId","owner").put("scopeId",f.scope).put("deviceId",f.device.deviceId)
                    .put("action",action).put("expectedRevision",f.directory.checkpoint.revision).put("checkpointHash",f.directory.checkpoint.hash).put("securityEpoch",f.directory.securityEpoch)
                    .put("operationId",java.util.UUID.randomUUID().toString()).put("payload",JSONObject().put("migrationId",source.migrationId).put("fence",source.fence).put("sourceHash",source.sourceHash)
                        .apply{page?.let{value->value.keys().forEach{put(it,value.get(it))}}}),f.device.keys().signing.private)
                val noHttp=object:ru.genesis.calendar.auth.E2eeHttpObservation {
                    override fun prepare(request:ru.genesis.calendar.auth.E2eeHttpObservation.Request):Unit=error("FIXTURE_NO_HTTP")
                    override fun begin(response:ru.genesis.calendar.auth.E2eeHttpBodyObservation.Response):Unit=error("FIXTURE_NO_HTTP")
                    override fun append(bytes:ByteArray):Unit=error("FIXTURE_NO_HTTP")
                    override fun finish():Unit=error("FIXTURE_NO_HTTP")
                    override fun close():Unit=error("FIXTURE_NO_HTTP")
                }
                return send(packet,noHttp)
            }
        }
        val transport = E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace"),planning) { path, packet, _ ->
            assertEquals("/read",path)
            if(packet.getJSONObject("command").getString("action") == "legacy-workspace") legacyRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-aurora") auroraRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-stoicheion") stoicheionRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-advice") adviceRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-tasks") tasksRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-diary") diaryRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-mindmaps"&&packet.getJSONObject("command").getJSONObject("payload").has("table"))mindmapsPageRead=packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-mindmaps") mindmapsRead = packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-physis")physisPageRead=packet
            else if(packet.getJSONObject("command").getString("action") == "legacy-archives")archiveRead=packet
            else { assertEquals("read",packet.getJSONObject("command").getString("action")); reads.put(packet) }
            val command=packet.getJSONObject("command")
            JSONObject().put("checkpointHash",f.directory.checkpoint.hash).put("directoryRevision",f.directory.checkpoint.revision).apply{
                if(command.getString("action").startsWith("legacy-")){
                    val payload=command.getJSONObject("payload")
                    put("protocol",1);put("ownerId",command.get("ownerId"));put("scopeId",command.get("scopeId"))
                    put("migrationId",payload.get("migrationId"));put("fence",payload.get("fence"));put("sourceHash",payload.get("sourceHash"))
                }else put("envelopes",JSONArray())
            }
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
        transport.legacyMindmapsPage(context,"versions",128)
        assertEquals("legacy-mindmaps",E2eeCommands.verify(requireNotNull(mindmapsPageRead),f.device.keys().signing.public).getString("action"))
        val mapPage=mindmapsPageRead!!.getJSONObject("command").getJSONObject("payload");E2eeKeys.exact(mapPage,setOf("migrationId","fence","sourceHash","table","offset"));assertEquals("versions",mapPage.getString("table"));assertEquals(128,mapPage.getInt("offset"))
        transport.legacyPhysisPage(context,"records",128)
        transport.legacyArchiveFragment(context,"stages",0,1024*1024)
        assertEquals("legacy-archives",E2eeCommands.verify(requireNotNull(archiveRead),f.device.keys().signing.public).getString("action"))
        val archivePage=archiveRead!!.getJSONObject("command").getJSONObject("payload");E2eeKeys.exact(archivePage,setOf("migrationId","fence","sourceHash","table","offset","byteOffset"))
        assertEquals("stages",archivePage.getString("table"));assertEquals(0L,archivePage.getLong("offset"));assertEquals(1024L*1024,archivePage.getLong("byteOffset"))
        reject("E2EE_ARCHIVE_TRANSPORT_INVALID"){transport.legacyArchiveFragment(context,"users",0,0)}
        reject("E2EE_ARCHIVE_TRANSPORT_INVALID"){transport.legacyArchiveFragment(context,"stages",-1,0)}
        reject("E2EE_ARCHIVE_TRANSPORT_INVALID"){transport.legacyArchiveFragment(context,"stages",0,-1)}
        reject("E2EE_ARCHIVE_TRANSPORT_INVALID"){transport.legacyArchiveFragment(context,"stages",0,64L*1024*1024+1)}
        reject("E2EE_SCOPE_BINDING_MISMATCH"){transport.legacyArchiveFragment(E2eeMigrationSourceContext("owner","personal:foreign",context.migrationId,1,context.sourceHash,1),"stages",0,0)}
        reject("E2EE_SCOPE_BINDING_MISMATCH"){transport.legacyArchiveFragment(E2eeMigrationSourceContext("foreign",f.scope,context.migrationId,1,context.sourceHash,1),"stages",0,0)}
        assertEquals("legacy-physis",E2eeCommands.verify(requireNotNull(physisPageRead),f.device.keys().signing.public).getString("action"))
        val physisPage=physisPageRead!!.getJSONObject("command").getJSONObject("payload");E2eeKeys.exact(physisPage,setOf("migrationId","fence","sourceHash","table","offset"));assertEquals("records",physisPage.getString("table"));assertEquals(128,physisPage.getInt("offset"))
        reject("E2EE_LEGACY_PAGE_INVALID"){transport.legacyMindmapsPage(context,"users",0)}
        reject("E2EE_LEGACY_PAGE_INVALID"){transport.legacyPhysisPage(context,"records",-1)}
        reject("E2EE_SCOPE_BINDING_MISMATCH"){transport.legacyPhysisPage(E2eeMigrationSourceContext("owner","personal:foreign",context.migrationId,1,context.sourceHash,1),"records",0)}
        val file = File(root,"output/release-3.3.6/runtime/native-migration-transport.json"); file.parentFile.mkdirs()
        file.writeText(JSONObject().put("protocol",1).put("synthetic",true).put("platform","native").put("bootstrap",f.events.getJSONObject(0)).put("reads",reads).put("legacyRead",legacyRead).put("auroraRead",auroraRead).put("stoicheionRead",stoicheionRead).put("adviceRead",adviceRead).put("tasksRead",tasksRead).put("diaryRead",diaryRead).put("mindmapsRead",mindmapsRead).put("mindmapsPageRead",mindmapsPageRead).put("physisPageRead",physisPageRead).put("archiveRead",archiveRead).toString(2))
    }
}
