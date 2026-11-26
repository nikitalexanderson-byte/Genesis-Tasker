package ru.genesis.calendar.security

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

class E2eeSourceStageTest {
    private class Memory : E2eeRecordStorage {
        var rows = mutableMapOf<String, E2eeLocalRecord>(); var full = false
        var beforeCommit: ((List<E2eeStorageChange>) -> Unit)? = null
        var afterCommit: ((List<E2eeStorageChange>) -> Unit)? = null
        override fun get(key: String) = synchronized(this) { rows[key] }
        override fun list(prefix: String) = synchronized(this) { rows.keys.filter { it.startsWith(prefix) } }
        override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
            beforeCommit?.invoke(changes)
            synchronized(this) {
                requireOpen(); check(!full) { "SYNTHETIC_DISK_FULL" }
                for (row in changes) check(rows[row.key]?.serial == row.expected) { "E2EE_LOCAL_CONFLICT" }
                val next = rows.toMutableMap()
                for (row in changes) if (row.value == null) next.remove(row.key) else next[row.key] = row.value
                requireOpen(); rows = next
            }
            afterCommit?.invoke(changes)
        }
    }
    private class Fixture {
        val memory = Memory(); val keys = E2eeKeys.generateDeviceKeys()
        val target = E2eeSourceStage.Target("content-owner", "project:content", "project")
        private val secret = E2eeKeys.freshSecret()
        val scope = UnlockedE2eeVault.Scope("device-actor", "device:stage", "stage-device", 1, 1, 1, "independent-root",
            keys.signing.private, mapOf("independent-root" to E2eeEnvelope.importRoot(secret))) { if (it == "stage-device") keys.signing.public else null }
        init { secret.fill(0) }
        var live = true; var durable = 0; val vault = spawn()
        val check: () -> Unit = { check(live) { "E2EE_ACCOUNT_CHANGED" } }
        val options = E2eeSourceStage.Options(vault, target, listOf("project.content", "project.local-work"), E2eeSourceStage.Capacity(4 * 1024 * 1024, 16),
            { durable++ }, check, {})
        fun spawn() = UnlockedE2eeVault(memory, scope)
        fun complete(bytes: ByteArray = "ORIGINAL PRIVATE SOURCE".toByteArray()): E2eeSourceStage.Reference {
            val stage = E2eeSourceStage.create(options)
            for (path in options.paths) stage.capturePath(path) { it.write(bytes) }
            return stage.finish()
        }
    }
    private fun refuses(code: String, action: () -> Unit) {
        try { action() } catch (error: Exception) { assertTrue("Expected $code, got ${error.message}", error.message.orEmpty().contains(code)); return }
        fail("Forbidden source stage operation accepted")
    }
    @Test fun originalPartLocatorsFilterOnlyActorSnapshotIdsAfterAllFramingChecks() {
        val f=Fixture();var gets=0;val tracked=object:E2eeRecordStorage by f.memory{override fun get(key:String):E2eeLocalRecord?{gets++;return f.memory.get(key)}}
        val vault=UnlockedE2eeVault(tracked,f.scope)
        vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","old:source:0",byteArrayOf(1),null),UnlockedE2eeVault.Write("local-snapshot","other:source",byteArrayOf(2),null),
            UnlockedE2eeVault.Write("local-snapshot","unrelated",byteArrayOf(3),null),UnlockedE2eeVault.Write("draft","draft:source:0",byteArrayOf(4),null)))
        assertEquals(listOf("old:source:0","other:source"),vault.listMigrationOriginalParts().sorted());assertEquals(0,gets);refuses("E2EE_"){vault.listLocal("local-snapshot","")}
        val prefix=listOf(f.scope.ownerId,f.scope.scopeId,"local-snapshot").joinToString(""){"${it.length}:$it"};f.memory.rows[prefix+"02:xx"]=f.memory.rows.values.first()
        refuses("CORRUPT_LOCAL_RECORD"){vault.listMigrationOriginalParts()};assertEquals(0,gets)
    }
    @Test fun aRetiredPendingOriginalLocatorLookupCannotReturnIds() {
        val f=Fixture();val entered=CountDownLatch(1);val resume=CountDownLatch(1);val result=AtomicReference<Throwable?>()
        val tracked=object:E2eeRecordStorage by f.memory{override fun list(prefix:String):List<String>{entered.countDown();check(resume.await(10,TimeUnit.SECONDS));return emptyList()}}
        val vault=UnlockedE2eeVault(tracked,f.scope);val thread=Thread{try{vault.listMigrationOriginalParts();result.set(AssertionError("Retired discovery accepted"))}catch(error:Throwable){result.set(error)}}
        thread.start();check(entered.await(10,TimeUnit.SECONDS));vault.lock();resume.countDown();thread.join(10000);assertFalse(thread.isAlive);assertEquals("E2EE_UNLOCK_REQUIRED",result.get()?.message)
    }
    @Test fun coldReadExactBytesUnderNewRootAndIndependentActor() {
        val f = Fixture(); val input = ByteArray(E2eeFiles.CHUNK_BYTES * 2 + 31) { (it * 37).toByte() }
        val ref = f.complete(input); assertEquals(1, f.durable)
        assertFalse(f.memory.rows.values.any { it.envelope.toJson().toString().contains("ORIGINAL PRIVATE SOURCE") })
        f.vault.lock(); val cold = f.spawn(); val opened = E2eeSourceStage.open(cold, f.target, ref, f.check)
        assertEquals(f.options.paths, opened.paths)
        for (path in opened.paths) opened.openPath(path).use { reader -> assertArrayEquals(input, reader.readBytes()); reader.assertComplete() }
        refuses("E2EE_") { E2eeSourceStage.open(cold, f.target.copy(ownerId = "wrong-owner"), ref, f.check) }
        assertTrue(E2eeSourceStage.inspect(cold, f.target, f.check).single().complete); input.fill(0); cold.lock()
    }
    @Test fun committedCrashKeepsBoundHistoryAndASecondStage() {
        val f = Fixture(); var crashed = false
        f.memory.afterCommit = { changes -> if (!crashed && changes.any { it.key.endsWith(":p:00:00000") }) { crashed = true; error("SYNTHETIC_PROCESS_LOSS") } }
        val stage = E2eeSourceStage.create(f.options)
        refuses("PROCESS_LOSS") { stage.capturePath(f.options.paths[0]) { it.write(ByteArray(E2eeFiles.CHUNK_BYTES) { 17 }) } }
        refuses("CLOSED") { stage.finish() }
        val old = E2eeSourceStage.inspect(f.vault, f.target, f.check).single(); assertFalse(old.complete)
        val kept = f.memory.rows.toMap(); f.memory.afterCommit = null; val ref = f.complete()
        val history = E2eeSourceStage.inspect(f.vault, f.target, f.check)
        assertEquals(listOf(old.id, ref.stageId), history.map { it.id }); assertFalse(history[0].complete); assertTrue(history[1].complete)
        for ((key, value) in kept) if (!key.contains("source-stage-catalog:")) assertSame(value, f.memory.rows[key])
    }
    @Test fun fullStorageAndCapacityDoNotPublishOrRemoveAcceptedChunks() {
        for (disk in listOf(true, false)) {
            val f = Fixture(); val options = if (disk) f.options else f.options.copy(capacity = E2eeSourceStage.Capacity(E2eeFiles.CHUNK_BYTES.toLong(), 1))
            val stage = E2eeSourceStage.create(options)
            refuses(if (disk) "DISK_FULL" else "CAPACITY") { stage.capturePath(options.paths[0]) { output ->
                output.write(ByteArray(E2eeFiles.CHUNK_BYTES) { 19 }); if (disk) f.memory.full = true; output.write(byteArrayOf(1))
            } }
            assertFalse(E2eeSourceStage.inspect(f.vault, f.target, f.check).single().complete)
            assertTrue(f.memory.rows.keys.any { it.endsWith(":p:00:00000") })
        }
    }
    @Test fun producerTagFailureAndSwallowedInvalidWriteCannotCompleteAPrefix() {
        for (tag in listOf(true, false)) {
            val f = Fixture(); val stage = E2eeSourceStage.create(f.options)
            refuses(if (tag) "TAG_FAILURE" else "CLOSED") { stage.capturePath(f.options.paths[0]) { output ->
                output.write(ByteArray(E2eeFiles.CHUNK_BYTES) { 23 })
                if (tag) error("SYNTHETIC_TAG_FAILURE") else refuses("INPUT") { output.write(byteArrayOf(1), 3, 1) }
            } }
            refuses("CLOSED") { stage.finish() }; assertFalse(E2eeSourceStage.inspect(f.vault, f.target, f.check).single().complete)
        }
    }
    @Test fun incompleteInventoryUnknownKeysAndMissingCatalogueRefuseWithoutDeletion() {
        for (mode in listOf("missing-catalog", "missing-part", "extra-part", "bad-framing")) {
            val f = Fixture(); val stage = E2eeSourceStage.create(f.options)
            stage.capturePath(f.options.paths[0]) { it.write(byteArrayOf(11, 12)) }
            if (mode == "missing-catalog") f.memory.rows.keys.filter { it.contains("source-stage-catalog:") }.forEach { f.memory.rows.remove(it) }
            if (mode == "missing-part") f.memory.rows.keys.filter { it.endsWith(":p:00:00000") }.forEach { f.memory.rows.remove(it) }
            if (mode == "extra-part") {
                val key = f.vault.listLocal("local-snapshot", "source-stage:").single { it.endsWith(":p:00:00000") }.dropLast(5) + "00002"
                f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot", key, byteArrayOf(1), null)))
            }
            if (mode == "bad-framing") { val key = f.memory.rows.keys.first(); f.memory.rows[key + "broken"] = f.memory.rows.getValue(key) }
            val kept = f.memory.rows.toMap(); refuses("E2EE_") { E2eeSourceStage.inspect(f.vault, f.target, f.check) }
            refuses("E2EE_") { E2eeSourceStage.create(f.options) }; assertEquals(kept, f.memory.rows)
        }
    }
    @Test fun actualEofRequiredAndRetirementBeforeReadNeverProducesPlaintext() {
        val f = Fixture(); val ref = f.complete(ByteArray(E2eeFiles.CHUNK_BYTES + 7) { 41 })
        val opened = E2eeSourceStage.open(f.vault, f.target, ref, f.check)
        opened.openPath(f.options.paths[0]).use { reader ->
            val output = ByteArray(19); assertEquals(19, reader.read(output)); reader.close(); refuses("EOF_REQUIRED") { reader.assertComplete() }
            refuses("CLOSED") { reader.read(output) }
        }
        val reader = opened.openPath(f.options.paths[0]); f.live = false; val output = ByteArray(32)
        refuses("ACCOUNT_CHANGED") { reader.read(output) }; assertTrue(output.all { it == 0.toByte() }); reader.close()
    }
    @Test fun concurrentFirstCreatorsShareOneCatalogueCas() {
        val f = Fixture(); val entered = CountDownLatch(2); val result = listOf(AtomicReference<Throwable?>(), AtomicReference<Throwable?>())
        f.memory.beforeCommit = { changes -> if (changes.any { it.key.contains("source-stage-catalog:") && it.expected == null }) { entered.countDown(); check(entered.await(10, TimeUnit.SECONDS)) } }
        val threads = result.map { outcome -> Thread { try { E2eeSourceStage.create(f.options) } catch (error: Throwable) { outcome.set(error) } } }
        threads.forEach { it.start() }; threads.forEach { it.join(10000); assertFalse(it.isAlive) }
        assertEquals(1, result.count { it.get() == null }); assertEquals(1, result.count { it.get()?.message == "E2EE_LOCAL_CONFLICT" })
        assertEquals(1, E2eeSourceStage.inspect(f.vault, f.target, f.check).size); assertEquals(2, f.memory.rows.size)
    }
    @Test fun changedAuthenticatedJournalIsNotAcceptedByDiscovery() {
        val f = Fixture(); E2eeSourceStage.create(f.options)
        val key = f.vault.listLocal("local-snapshot", "source-stage:").single()
        val old = f.vault.read("local-snapshot", key)!!
        try {
            val body = E2eeCommands.decodeCanonical(old.bytes) as JSONObject
            body.getJSONObject("context").put("actorId", "foreign-actor")
            val bytes = E2eeCommands.canonical(body)
            try { f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot", key, bytes, old.serial))) } finally { bytes.fill(0) }
        } finally { old.bytes.fill(0) }
        refuses("CONTEXT") { E2eeSourceStage.inspect(f.vault, f.target, f.check) }
    }
}
