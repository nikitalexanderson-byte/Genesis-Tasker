package ru.genesis.calendar.auth

import android.content.Context
import android.content.ContextWrapper
import android.content.SharedPreferences
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CancellationException
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.security.*
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.File
import java.io.IOException
import java.io.InputStream
import java.net.URL
import java.security.MessageDigest
import java.security.cert.Certificate
import java.util.UUID
import javax.net.ssl.HttpsURLConnection

/** Actual authenticated client, JCA, Keystore session and ciphertext SQLite.
 * Only generated fixtures and the HTTPS connection factory are synthetic.
 * This proves same-actor retention, not TLS/backend or recovery handoff. */
class E2eeRemoteOriginalDeviceTest {
    private class Reply(raw: ByteArray, private val status: Int = 200) : HttpsURLConnection(URL("https://example.invalid/")) {
        var closed = false; var streamClosed = false; var reads = 0
        val loans = mutableListOf<ByteArray>(); private val sent = ByteArrayOutputStream()
        private val input = object : ByteArrayInputStream(raw) {
            override fun read(target: ByteArray, offset: Int, length: Int): Int {
                assertTrue(loans.all { buffer -> buffer.all { it == 0.toByte() } }); loans += target; reads++
                return super.read(target, offset, length)
            }
            override fun close() { streamClosed = true; super.close() }
        }
        override fun connect() = Unit
        override fun disconnect() { closed = true; sent.reset() }
        override fun usingProxy() = false
        override fun getCipherSuite() = "TLS_SYNTHETIC_ORIGINAL_PORT"
        override fun getLocalCertificates(): Array<Certificate>? = null
        override fun getServerCertificates(): Array<Certificate> = emptyArray()
        override fun getResponseCode() = status
        override fun getContentType() = "application/json; charset=utf-8"
        override fun getContentLengthLong() = -1L
        override fun getHeaderFields(): Map<String, List<String>> = emptyMap()
        override fun getInputStream() = input
        override fun getErrorStream() = input
        override fun getOutputStream() = sent
    }
    private class Rig : AutoCloseable {
        val app = InstrumentationRegistry.getInstrumentation().targetContext
        private val namespace = "synthetic-remote-original-${UUID.randomUUID()}"
        private val folder = File(app.noBackupFilesDir, namespace).apply { check(mkdir()) }
        private val stores = mutableSetOf<String>()
        private val context = object : ContextWrapper(app) {
            override fun getApplicationContext() = this
            override fun getNoBackupFilesDir() = folder
            override fun getSharedPreferences(name: String, mode: Int): SharedPreferences {
                val scoped = "$namespace.$name"; stores += scoped; return app.getSharedPreferences(scoped, mode)
            }
        }
        val preferences = context.getSharedPreferences("genesis.native.auth.v1", Context.MODE_PRIVATE)
        val keys = E2eeKeys.generateDeviceKeys()
        private val root = E2eeKeys.freshSecret().let { try { E2eeEnvelope.importRoot(it) } finally { it.fill(0) } }
        val scope = UnlockedE2eeVault.Scope("remote-native-owner", "device:remote-native", "remote-native-device", 1, 1, 1, "local-root", keys.signing.private, mapOf("local-root" to root)) { if (it == "remote-native-device") keys.signing.public else null }
        val target = E2eeRemoteOriginal.Target(scope.ownerId, "personal:${scope.ownerId}", "personal")
        var storage = E2eeSqliteStorage(context, true); var failAfter: Int? = null; var commits = 0
        var bodyGets=0;var bodyTransform:((E2eeLocalRecord)->E2eeLocalRecord)?=null;var beforeCommit:(()->Unit)?=null
        private val port = object : E2eeRecordStorage {
            override fun get(key: String):E2eeLocalRecord? {
                val row=storage.get(key);if(!key.contains(":p:"))return row
                bodyGets++;return row?.let{bodyTransform?.invoke(it)?:it}
            }
            override fun list(prefix: String) = storage.list(prefix)
            override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
                if (failAfter?.let { commits >= it } == true) throw IOException("SYNTHETIC-PRIVATE-QUOTA-CANARY")
                beforeCommit?.invoke()
                storage.commit(changes, requireOpen); commits++
            }
        }
        var vault = UnlockedE2eeVault(port, scope); var live = true; var admission: (() -> Unit)? = null
        val packet = E2eeCommands.sign(JSONObject().put("protocol", 1).put("ownerId", target.ownerId).put("scopeId", target.scopeId).put("deviceId", scope.deviceId)
            .put("action", "legacy-mindmaps").put("expectedRevision", 1).put("checkpointHash", E2eeEnvelope.encode(ByteArray(32))).put("securityEpoch", 1).put("operationId", UUID.randomUUID().toString())
            .put("payload", JSONObject().put("migrationId", UUID.randomUUID().toString()).put("fence", 1).put("sourceHash", E2eeEnvelope.encode(ByteArray(32) { 7 })).put("table", "maps").put("offset", 0)), keys.signing.private)
        fun options() = E2eeRemoteOriginal.Options(vault, target, E2eeRemoteOriginal.Capacity(8L * 1024 * 1024, 256, 16, 512, 4 * 1024 * 1024), packet, keys.signing.public, 2,
            { if (!live) throw CancellationException("synthetic-retired") }, {}, { admission?.invoke() })
        fun read() = E2eeRemoteOriginal.ReadOptions(vault, target, options().capacity, options().assertCurrent)
        var reply = Reply("{}".toByteArray()); var calls = 0
        val client: AuthSessionClient; val generation: Long
        init {
            check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.qa1103.debug")
            val session = JSONObject().put("cookie", "syntheticCookie0123456789").put("csrf", AuthProtocol.csrf("a".repeat(48))).put("expiresAt", System.currentTimeMillis() + 3600000)
            check(preferences.edit().putString("session", LocalCipher().encrypt(session.toString(), "genesis.native.auth.v2")).putString("pending-private-canary", "retained-synthetic-work").commit())
            client = AuthSessionClient(context, { url -> assertEquals("/api/e2ee/v1/read", url.path); assertTrue(commits >= 1); calls++; reply }); generation = client.begin()
        }
        fun call(capture: E2eeRemoteOriginal) = client.e2ee(generation, "/read", packet, capture)
        fun cold() { vault.lock(); storage.close(); storage = E2eeSqliteStorage(context); vault = UnlockedE2eeVault(port, scope) }
        fun snapshot() = storage.list("").sorted().map { key -> val row = storage.get(key)!!; "$key:${row.serial}:${row.envelope.toJson()}" }
        fun clean() { assertTrue(reply.closed); assertTrue(reply.streamClosed); assertTrue(reply.loans.all { value -> value.all { it == 0.toByte() } }); assertEquals("retained-synthetic-work", preferences.getString("pending-private-canary", null)) }
        override fun close() { client.begin(); vault.lock(); storage.close(); for (store in stores) check(app.deleteSharedPreferences(store)); check(folder.deleteRecursively()) }
    }
    private fun raw() = ("\ufeff {\r\n\"sourceHash\":\"synthetic\", \"private\":\"SYNTHETIC-RAW-CANARY α😀" + "a".repeat(512 * 1024 + 7) + "\"}\r\n").toByteArray()
    private fun hash(bytes: ByteArray) = E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun proof(options: E2eeRemoteOriginal.ReadOptions, id: String, partial: Boolean = false): E2eeRemoteOriginal.Receipt = E2eeRemoteOriginal.withOriginal(options, id, partial) { input ->
        val buffer = ByteArray(65536); try { while (input.read(buffer) >= 0) buffer.fill(0) } finally { buffer.fill(0) }
    }
    private fun refused(operation: () -> Unit) { try { operation(); fail("Incomplete original accepted") } catch (error: Exception) { assertTrue(error.message.orEmpty(), error.message.orEmpty().startsWith("E2EE_")) } }

    @Test fun actualAuthenticatedFetchColdReadsEveryLargeOriginalByteWithoutChangingCiphertext() {
        Rig().use { f ->
            val bytes = raw(); f.reply = Reply(bytes); val capture = E2eeRemoteOriginal.create(f.options())
            val value = f.call(capture); val reference = capture.reference(); assertTrue(value.getString("private").startsWith("SYNTHETIC-RAW-CANARY α😀")); assertEquals(524370L, reference.size); assertEquals(hash(bytes), reference.rawHash)
            assertTrue(f.reply.reads > 64); f.clean(); val before = f.snapshot(); assertFalse(before.joinToString().contains("SYNTHETIC-RAW-CANARY")); f.cold()
            val receipt = proof(f.read(), reference.id); assertTrue(receipt.complete); assertEquals(reference.rawHash, receipt.rawHash); assertEquals(reference.size, receipt.size); assertEquals(before, f.snapshot())
            var escaped: InputStream? = null; refused { E2eeRemoteOriginal.withOriginal(f.read(), reference.id) { input -> escaped = input; input.read() } }
            val loan = ByteArray(64) { 7 }; refused { escaped!!.read(loan) }; assertTrue(loan.all { it == 0.toByte() }); assertEquals(before, f.snapshot())
        }
    }
    @Test fun duplicateProjectionRefusesAfterProtectedRawEofAndQuotaRefusesBeforeNetwork() {
        Rig().use { f ->
            val bytes = "\ufeff {\"sourceHash\":\"first\", \"sourceHash\":\"second\"}\r\n".toByteArray(); f.reply = Reply(bytes); val capture = E2eeRemoteOriginal.create(f.options()); val session = f.preferences.all.toMap()
            try { f.call(capture); fail("Duplicate projection accepted") } catch (error: AuthApiError) { assertEquals("E2EE_INVALID_RESPONSE", error.code) }
            f.clean(); val reference = capture.reference(); f.cold(); val receipt = proof(f.read(), reference.id); assertTrue(receipt.complete); assertEquals(hash(bytes), receipt.rawHash); assertEquals(session, f.preferences.all)
            val before = f.snapshot(); val calls = f.calls; val next = E2eeRemoteOriginal.create(f.options().let { it.copy(capacity = it.capacity.copy(maximumObservations = 1)) })
            try { f.call(next); fail("Quota accepted") } catch (error: AuthApiError) { assertEquals("E2EE_REMOTE_ORIGINAL_CAPACITY", error.code) }
            assertEquals(calls, f.calls); assertEquals(before, f.snapshot())
        }
    }
    @Test fun storageFailureRetainsPrefixAndIsReportedAsALocalRefusalWithNoPrivateException() {
        Rig().use { f ->
            f.reply = Reply(raw()); f.failAfter = 3; val capture = E2eeRemoteOriginal.create(f.options()); val session = f.preferences.all.toMap()
            try { f.call(capture); fail("Failed original accepted") } catch (error: AuthApiError) { assertEquals("E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE", error.code); assertFalse(error.message.orEmpty().contains("CANARY")) }
            f.clean(); f.failAfter = null; f.cold(); val marker = E2eeRemoteOriginal.listOriginals(f.read()).single(); assertEquals("receiving", marker.phase); assertEquals(8192L, marker.size)
            refused { proof(f.read(), marker.id) }; val receipt = proof(f.read(), marker.id, true); assertFalse(receipt.complete); assertEquals(8192L, receipt.size); assertEquals(session, f.preferences.all)
        }
    }
    @Test fun cancellationDuringAdmissionNeverOpensAConnectionAndDoesNotDeleteEarlierOriginals() {
        Rig().use { f ->
            val old = E2eeRemoteOriginal.create(f.options()); old.prepare(E2eeHttpObservation.Request("/e2ee/v1/read", "POST", f.packet.toString())); old.close(); val before = f.snapshot()
            f.admission = { f.live = false }; val next = E2eeRemoteOriginal.create(f.options())
            try { f.call(next); fail("Retired admission accepted") } catch (_: CancellationException) { }
            assertEquals(0, f.calls); f.live = true; assertEquals(before, f.snapshot()); assertEquals("registered", E2eeRemoteOriginal.listOriginals(f.read()).single().phase)
        }
    }
    @Test fun retirementAtPhysicalCommitLeavesEarlierOriginalAndOpenVaultUntouched() {
        Rig().use { f ->
            val old=E2eeRemoteOriginal.create(f.options());old.prepare(E2eeHttpObservation.Request("/e2ee/v1/read","POST",f.packet.toString()));old.close()
            val before=f.snapshot();val next=E2eeRemoteOriginal.create(f.options())
            f.beforeCommit={f.beforeCommit=null;f.live=false}
            try{f.call(next);fail("Retired physical commit accepted")}catch(_:CancellationException){}
            f.vault.assertOpen();assertEquals(0,f.calls);assertEquals(before,f.snapshot())
        }
    }
    @Test fun observerClosedAtPhysicalCommitCannotPublishOrOpenHttpConnection() {
        Rig().use { f ->
            val old=E2eeRemoteOriginal.create(f.options());old.prepare(E2eeHttpObservation.Request("/e2ee/v1/read","POST",f.packet.toString()));old.close()
            val before=f.snapshot();val next=E2eeRemoteOriginal.create(f.options())
            f.beforeCommit={f.beforeCommit=null;next.close()}
            try{f.call(next);fail("Closed physical commit accepted")}catch(error:AuthApiError){assertEquals("E2EE_REMOTE_ORIGINAL_CLOSED",error.code)}
            f.vault.assertOpen();assertEquals(0,f.calls);assertEquals(before,f.snapshot())
        }
    }
    @Test fun inertRegistrationAndPartialDescriptorSurviveColdSqliteReadWithoutBodyAccess() {
        Rig().use{f->
            val capture=E2eeRemoteOriginal.create(f.options());val registration=capture.registration()
            assertEquals(0,f.calls);assertEquals(0,f.commits);assertTrue(f.snapshot().isEmpty())
            assertEquals(f.scope.ownerId,registration.context.actorId);assertEquals(2L,registration.binding.generation)
            capture.prepare(E2eeHttpObservation.Request("/e2ee/v1/read","POST",f.packet.toString()))
            val registered=E2eeRemoteOriginal.describeOriginal(f.read(),registration.id)
            assertEquals(registration,registered.registration);assertEquals("registered",registered.phase);assertNull(registered.response);assertFalse(registered.bodyVerified)
            capture.begin(E2eeHttpBodyObservation.Response("/e2ee/v1/read",200,"application/json",null));capture.append("prefix".toByteArray());capture.close()
            val before=f.snapshot();f.cold();f.bodyGets=0
            val partial=E2eeRemoteOriginal.describeOriginal(f.read(),registration.id)
            assertEquals(registration,partial.registration);assertEquals("receiving",partial.phase);assertEquals(6L,partial.size);assertEquals(1,partial.parts)
            assertFalse(partial.bodyVerified);assertNull(partial.rawHash);assertNull(partial.manifestHash);assertEquals(0,f.bodyGets);assertEquals(before,f.snapshot())
            refused{capture.reference()};f.live=false;assertEquals(registration,capture.registration())
            try{E2eeRemoteOriginal.describeOriginal(f.read(),registration.id);fail("Retired descriptor accepted")}catch(_:CancellationException){}
        }
    }
    @Test fun completeColdDescriptorNeverSubstitutesForBodyAuthenticationOrChangesStoredCiphertext() {
        Rig().use{f->
            val bytes=raw();f.reply=Reply(bytes);val capture=E2eeRemoteOriginal.create(f.options());val registration=capture.registration()
            f.call(capture);f.clean();val reference=capture.reference();val before=f.snapshot();f.cold();f.bodyGets=0
            f.bodyTransform={old->
                val value=old.envelope.toJson();val cipher=value.getString("ciphertext")
                value.put("ciphertext",(if(cipher[0]=='A')"B" else "A")+cipher.substring(1))
                E2eeLocalRecord(old.serial,E2eeEnvelope.Envelope.fromJson(value))
            }
            val descriptor=E2eeRemoteOriginal.describeOriginal(f.read(),reference.id)
            assertEquals(registration,descriptor.registration);assertEquals("complete",descriptor.phase);assertFalse(descriptor.bodyVerified)
            assertEquals(reference.rawHash,descriptor.rawHash);assertEquals(0,f.bodyGets)
            refused{proof(f.read(),reference.id)};assertTrue(f.bodyGets>0);assertEquals(before,f.snapshot())
            f.bodyTransform=null;val receipt=proof(f.read(),reference.id);assertTrue(receipt.complete);assertEquals(reference.rawHash,receipt.rawHash);assertEquals(before,f.snapshot())
        }
    }
}
