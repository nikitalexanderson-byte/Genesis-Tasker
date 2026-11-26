package ru.genesis.calendar.data

import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.security.*
import java.io.File
import java.io.OutputStream
import java.security.KeyStore
import java.security.KeyFactory
import java.security.MessageDigest
import java.security.spec.PKCS8EncodedKeySpec
import java.security.spec.X509EncodedKeySpec
import java.util.UUID

/** Actual SQLite/Keystore source staging. Fixture key custody uses a separate
 * synthetic no-auth LocalCipher alias; this does not accept product user-presence,
 * coordinator publication, all archives or nested legacy decryption. */
class NativeBackupProtectedSourceStageTest {
    private val app get() = InstrumentationRegistry.getInstrumentation().targetContext
    private class Rig : AutoCloseable {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        val root = File(app.noBackupFilesDir, "source-stage-synthetic-${UUID.randomUUID()}").apply { check(mkdir()) }
        val context = object : ContextWrapper(app) {
            override fun getApplicationContext(): Context = this
            override fun getNoBackupFilesDir() = root
        }
        val oldAlias = "genesis.qa.source-stage.old.${UUID.randomUUID()}"
        val newAlias = "genesis.qa.source-stage.new.${UUID.randomUUID()}"
        val oldCipher = LocalCipher(oldAlias); val newCipher = LocalCipher(newAlias)
        val target = E2eeSourceStage.Target("content-owner", "project:source-stage", "project")
        val owner = "device-actor"; val scope = "device:source-stage"; val device = "source-stage-device"
        val saved = File(root, "synthetic-new-key.bundle")
        private val expectedBundleHash: String
        var storage = E2eeSqliteStorage(context, allowCreate = true)
        lateinit var vault: UnlockedE2eeVault
        var live = true
        val guard: () -> Unit = { check(live) { "E2EE_ACCOUNT_CHANGED" }; vault.requireOpen() }
        init {
            check(BuildConfig.DEBUG && app.packageName.endsWith(".qa1103.debug"))
            val keys = E2eeKeys.generateDeviceKeys(); val secret = E2eeKeys.freshSecret()
            try {
                val bundle = JSONObject().put("root", E2eeEnvelope.encode(secret)).put("keys", E2eeKeys.exportPrivateKeys(keys))
                expectedBundleHash = keyHash(bundle)
                saved.outputStream().use { stream -> stream.write(newCipher.encrypt(bundle.toString(), "synthetic-new-root-v1").toByteArray()); stream.fd.sync() }
            } finally { secret.fill(0) }
            reopen()
        }
        fun reopen() {
            val bundle = JSONObject(newCipher.decrypt(saved.readText(), "synthetic-new-root-v1"))
            check(keyHash(bundle) == expectedBundleHash)
            val keys = E2eeKeys.importDeviceKeys(bundle.getJSONObject("keys")); val secret = E2eeEnvelope.decode(bundle.getString("root"), 32)
            val root = try { E2eeEnvelope.importRoot(secret) } finally { secret.fill(0) }
            vault = UnlockedE2eeVault(storage, UnlockedE2eeVault.Scope(owner, scope, device, 1, 1, 1, "independent-new-root", keys.signing.private,
                mapOf("independent-new-root" to root)) { if (it == device) keys.signing.public else null })
        }
        fun cold() { vault.lock(); storage.close(); storage = E2eeSqliteStorage(context); reopen() }
        fun options(paths: List<String> = listOf("personal.archives")) = E2eeSourceStage.Options(vault, target, paths,
            E2eeSourceStage.Capacity(128L * 1024 * 1024, 512), {
                guard(); val bundle = JSONObject(newCipher.decrypt(saved.readText(), "synthetic-new-root-v1"))
                check(keyHash(bundle) == expectedBundleHash); guard()
            }, guard, { request -> check(root.usableSpace > 2L * request.metadataBytes + 2L * E2eeFiles.CHUNK_BYTES) { "SYNTHETIC_NO_SPACE" } })
        fun eraseOld() { KeyStore.getInstance("AndroidKeyStore").apply { load(null); deleteEntry(oldAlias) } }
        private fun keyHash(bundle: JSONObject): String {
            val bytes = E2eeCommands.canonical(bundle)
            return try { E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes)) } finally { bytes.fill(0) }
        }
        override fun close() {
            live = false; vault.lock(); storage.close()
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            for (alias in listOf(oldAlias, newAlias)) { check(alias.startsWith("genesis.qa.source-stage.")); store.deleteEntry(alias) }
            check(root.canonicalFile.parentFile == app.noBackupFilesDir.canonicalFile && root.name.startsWith("source-stage-synthetic-")); check(root.deleteRecursively())
        }
        fun inventory() = BackupMigrationInventory(spoolFactory = { maximum ->
            BackupFormSpool(File(root, "old-spill"), object : BackupFormSpool.Crypto {
                override fun seal(value: String, aad: String) = oldCipher.encrypt(value, aad)
                override fun open(value: String, aad: String) = oldCipher.decrypt(value, aad)
            }, NativeBackupFormMetadata::read, maximum = maximum, syncDirectory = ::syncNativeBackupDirectory)
        })
    }
    private fun sink(hash: MessageDigest, progress: (Int) -> Unit = {}) = object : OutputStream() {
        override fun write(value: Int) { hash.update(value.toByte()); progress(1) }
        override fun write(bytes: ByteArray, offset: Int, count: Int) { hash.update(bytes, offset, count); progress(count) }
    }
    @Test fun actualRetainedFiftyOneMiBHistoryColdReadsFromIndependentRootWithoutOldAlias() {
        val started = SystemClock.elapsedRealtime(); val f = Rig(); val memory = f.inventory()
        try {
            val view = memory.open(f.owner, 7); val sizes = listOf(24, 17, 10).map { it * 1024 * 1024 }; val descriptors = mutableListOf<String>()
            var selected: JSONObject? = null
            for ((index, size) in sizes.withIndex()) {
                val bytes = ByteArray(size) { (it * 31).toByte() }; val input = BackupImportFile(bytes, "\uFEFForiginal\uD800name", "APPLICATION/JSON", null, null)
                try {
                    val file = input.migrationCopy(); descriptors += file.descriptor; memory.retainFile(view, file); assertEquals(0L, file.memoryBytes)
                    if (index == 0) selected = JSONObject().put("id", file.id).put("name", "\uFEFForiginal\uFFFDname").put("type", "application/json").put("size", size).put("lastModified", 0)
                } finally { input.clear(); bytes.fill(0) }
            }
            val originals = JSONArray()
            fun value(name: String, raw: String): String {
                val id = UUID.randomUUID().toString(); memory.appendValue(view, name, id, 0, true, raw)
                originals.put(JSONObject().put("id", id).put("name", name).put("rawJson", raw)); return id
            }
            val first = value("key", "\" original \uD800 input \"")
            val payload = value("payload", "{\"note\":\"literal\uDFFFunit α😀\"}")
            fun manifest(key: String) = JSONObject().put("protocol", 2).put("fields", JSONArray().put(JSONObject().put("name", "key").put("id", key))
                .put(JSONObject().put("name", "payload").put("id", payload))).put("settled", true).put("file", selected).toString()
            val initialManifest = manifest(first); memory.publishManifest(view, initialManifest)
            val replacement = value("key", "\" replacement input \""); val rawManifest = manifest(replacement); memory.publishManifest(view, rawManifest)
            value("key", "\" acknowledged unselected input \""); memory.detach(view)
            assertEquals("E2EE_SNAPSHOT_TOO_LARGE", assertThrows(IllegalStateException::class.java) { memory.capture(f.owner, 7) }.message)
            val source = memory.source(f.owner, 7); val stage = E2eeSourceStage.create(f.options()); val expected = MessageDigest.getInstance("SHA-256"); var written = 0L
            stage.capturePath("personal.archives") { encrypted ->
                val tee = object : OutputStream() {
                    override fun write(value: Int) { encrypted.write(value); expected.update(value.toByte()); written++ }
                    override fun write(bytes: ByteArray, offset: Int, count: Int) { encrypted.write(bytes, offset, count); expected.update(bytes, offset, count); written += count }
                }
                source.writeTo(tee)
            }
            assertTrue(written > 64L * 1024 * 1024); val ref = stage.finish(); val digest = expected.digest()
            f.eraseOld(); assertFalse(KeyStore.getInstance("AndroidKeyStore").apply { load(null) }.containsAlias(f.oldAlias)); f.cold()
            val reopened = E2eeSourceStage.open(f.vault, f.target, ref, f.guard); val actual = MessageDigest.getInstance("SHA-256"); var read = 0L
            reopened.openPath("personal.archives").use { input -> input.copyTo(sink(actual) { read += it }, 65536); input.assertComplete() }
            assertEquals(written, read); assertArrayEquals(digest, actual.digest())
            val proof = JSONObject().put("synthetic", true).put("sourceOnly", true).put("bytes", written).put("sha256", digest.joinToString("") { "%02x".format(it) })
                .put("originalBytes", 51L * 1024 * 1024).put("rawDescriptors", JSONArray(descriptors)).put("rawManifest", rawManifest).put("fileSizes", JSONArray(sizes))
                .put("rawManifests", JSONArray().put(initialManifest).put(rawManifest)).put("originalValues", originals)
                .put("viewId", view).put("ownerId", f.owner).put("sessionEpoch", 7).put("stageId", ref.stageId).put("oldAliasDeleted", true)
                .put("elapsedMs", SystemClock.elapsedRealtime() - started).put("maxHeap", Runtime.getRuntime().maxMemory())
            File(app.getExternalFilesDir(null), "source-stage336-large-proof.json").writeBytes(backupJsonUtf8(proof.toString()))
        } finally { memory.clear(); f.close() }
    }
    @Test fun sqliteRestartKeepsAnIncompleteBoundStageAndAllowsSeparateAttempt() {
        val f = Rig()
        try {
            val stage = E2eeSourceStage.create(f.options()); val original = ByteArray(E2eeFiles.CHUNK_BYTES) { 37 }
            assertEquals("SYNTHETIC_TAG_FAILURE", assertThrows(IllegalStateException::class.java) { stage.capturePath("personal.archives") { it.write(original); error("SYNTHETIC_TAG_FAILURE") } }.message)
            f.cold(); val first = E2eeSourceStage.inspect(f.vault, f.target, f.guard).single(); assertFalse(first.complete)
            val kept = f.storage.list("").filter { !it.contains("source-stage-catalog:") }.associateWith { f.storage.get(it)!!.envelope.toJson().toString() }
            val second = E2eeSourceStage.create(f.options()); second.capturePath("personal.archives") { it.write("OTHER COMPLETE SOURCE".toByteArray()) }; val ref = second.finish()
            f.cold(); val history = E2eeSourceStage.inspect(f.vault, f.target, f.guard); assertEquals(2, history.size); assertFalse(history[0].complete); assertEquals(ref.stageId, history[1].id)
            for ((key, value) in kept) assertEquals(value, f.storage.get(key)!!.envelope.toJson().toString())
            original.fill(0)
        } finally { f.close() }
    }
    @Test fun platformCanonicalDecoderRejectsEveryIndependentMalformedVector() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee/canonical-values-v1.json").bufferedReader().use { JSONObject(it.readText()) }
        fun bytes(hex: String) = hex.chunked(2).map { it.toInt(16).toByte() }.toByteArray()
        val valid = fixture.getJSONArray("valid")
        for (index in 0 until valid.length()) {
            val row = valid.getJSONObject(index); val wire = bytes(row.getString("hex"))
            assertArrayEquals(wire, E2eeCommands.canonical(row.get("value"))); assertArrayEquals(wire, E2eeCommands.canonical(E2eeCommands.decodeCanonical(wire)))
        }
        val invalid = fixture.getJSONArray("invalid")
        for (index in 0 until invalid.length()) assertThrows(IllegalArgumentException::class.java) { E2eeCommands.decodeCanonical(bytes(invalid.getJSONObject(index).getString("hex"))) }
    }
    @Test fun webStagesOpenInNativeAndNativeStagesExportForIndependentWebReadback() {
        val fixture = InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee/source-stage-web-v1.json").bufferedReader().use { JSONObject(it.readText()) }
        assertTrue(fixture.getBoolean("synthetic")); assertEquals("PUBLIC TEST KEYS; DO NOT USE FOR USER DATA", fixture.getString("warning"))
        val f = Rig()
        try {
            val records = fixture.getJSONArray("records"); val scope = fixture.getJSONObject("scope")
            f.storage.commit((0 until records.length()).map { records.getJSONObject(it).let { row -> E2eeStorageChange(row.getString("key"), null,
                E2eeLocalRecord(row.getLong("serial"), E2eeEnvelope.Envelope.fromJson(row.getJSONObject("envelope")))) } }) {}
            val signing = KeyFactory.getInstance("EC").generatePrivate(PKCS8EncodedKeySpec(E2eeEnvelope.decode(fixture.getString("privateKeyPkcs8"), 1, 8192)))
            val publicKey = KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(fixture.getString("publicKeySpki"), 1, 8192)))
            val raw = E2eeEnvelope.decode(fixture.getString("rootKey"), 32); val root = try { E2eeEnvelope.importRoot(raw) } finally { raw.fill(0) }
            val vault = UnlockedE2eeVault(f.storage, UnlockedE2eeVault.Scope(scope.getString("ownerId"), scope.getString("scopeId"), scope.getString("deviceId"), 1, 1, 1,
                scope.getString("keyId"), signing, mapOf(scope.getString("keyId") to root)) { if (it == scope.getString("deviceId")) publicKey else null })
            val target = fixture.getJSONObject("target").let { E2eeSourceStage.Target(it.getString("ownerId"), it.getString("scopeId"), it.getString("kind")) }
            val ref = fixture.getJSONObject("reference").let { E2eeSourceStage.Reference(it.getString("stageId"), it.getString("manifestHash")) }
            val history = E2eeSourceStage.inspect(vault, target, { vault.requireOpen() }); assertEquals(2, history.size); assertFalse(history[0].complete)
            val opened = E2eeSourceStage.open(vault, target, ref) { vault.requireOpen() }; val paths = fixture.getJSONArray("expectedPaths")
            for (index in 0 until paths.length()) {
                val path = paths.getJSONObject(index); val expected = E2eeEnvelope.decode(path.getString("bytes"), 1, 1024 * 1024)
                try { opened.openPath(path.getString("id")).use { input -> assertArrayEquals(expected, input.readBytes()); input.assertComplete() } } finally { expected.fill(0) }
            }
            val before = f.storage.list("").toSet(); val nativeTarget = target.copy(scopeId = "project:native-interop-source")
            val stage = E2eeSourceStage.create(E2eeSourceStage.Options(vault, nativeTarget, (0 until paths.length()).map { paths.getJSONObject(it).getString("id") },
                E2eeSourceStage.Capacity(1024 * 1024, 4), {}, { vault.requireOpen() }, {}))
            for (index in 0 until paths.length()) {
                val path = paths.getJSONObject(index); val bytes = E2eeEnvelope.decode(path.getString("bytes"), 1, 1024 * 1024)
                try { stage.capturePath(path.getString("id")) { it.write(bytes) } } finally { bytes.fill(0) }
            }
            val nativeRef = stage.finish(); val exported = JSONObject(fixture.toString()).put("producer", "Android/JCA API${android.os.Build.VERSION.SDK_INT}")
                .put("target", JSONObject().put("ownerId", nativeTarget.ownerId).put("scopeId", nativeTarget.scopeId).put("kind", nativeTarget.kind))
                .put("reference", JSONObject().put("stageId", nativeRef.stageId).put("manifestHash", nativeRef.manifestHash)).put("historyStages", 1)
            exported.put("records", JSONArray().apply { for (key in f.storage.list("").filter { it !in before }) {
                val row = f.storage.get(key)!!; put(JSONObject().put("key", key).put("serial", row.serial).put("envelope", row.envelope.toJson()))
            } })
            File(app.getExternalFilesDir(null), "source-stage336-native-vector.json").writeBytes(backupJsonUtf8(exported.toString())); vault.lock()
        } finally { f.close() }
    }
}
