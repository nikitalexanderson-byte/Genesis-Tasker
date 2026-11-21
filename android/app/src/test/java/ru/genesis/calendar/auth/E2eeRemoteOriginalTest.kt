package ru.genesis.calendar.auth

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.security.*
import java.io.ByteArrayInputStream
import java.io.InputStream
import java.io.IOException
import kotlinx.coroutines.CancellationException
import java.security.MessageDigest
import java.util.UUID

class E2eeRemoteOriginalTest {
    private class Storage : E2eeRecordStorage {
        var rows = mutableMapOf<String, E2eeLocalRecord>(); var full = false
        var bodyGets=0;var afterGet:((String)->Unit)?=null
        override fun get(key: String):E2eeLocalRecord? {val value=rows[key];if(key.contains(":p:"))bodyGets++;afterGet?.invoke(key);return value}
        override fun list(prefix: String) = rows.keys.filter { it.startsWith(prefix) }
        override fun commit(changes: List<E2eeStorageChange>, requireOpen: () -> Unit) {
            requireOpen(); check(!full) { "E2EE_SYNTHETIC_STORAGE_FULL" }; for (row in changes) check(rows[row.key]?.serial == row.expected) { "E2EE_LOCAL_CONFLICT" }
            val next = rows.toMutableMap(); for (row in changes) if (row.value == null) next.remove(row.key) else next[row.key] = row.value
            requireOpen(); rows = next
        }
        fun snapshot() = rows.entries.sortedBy { it.key }.joinToString("\n") { "${it.key}:${it.value.serial}:${it.value.envelope.toJson()}" }
    }
    private class Rig {
        val storage = Storage(); val keys = E2eeKeys.generateDeviceKeys()
        private val root = E2eeKeys.freshSecret().let { try { E2eeEnvelope.importRoot(it) } finally { it.fill(0) } }
        val scope = UnlockedE2eeVault.Scope("owner", "device:remote-original", "remote-device", 1, 1, 1, "independent-local-root", keys.signing.private, mapOf("independent-local-root" to root)) { if (it == "remote-device") keys.signing.public else null }
        val target = E2eeRemoteOriginal.Target("owner", "personal:owner", "personal")
        val vault = UnlockedE2eeVault(storage, scope); var live = true; var durable = 0; var hook: (() -> Unit)? = null
        val admissions = mutableListOf<E2eeRemoteOriginal.Admission>()
        val command = JSONObject().put("protocol", 1).put("ownerId", target.ownerId).put("scopeId", target.scopeId).put("deviceId", scope.deviceId)
            .put("action", "legacy-mindmaps").put("expectedRevision", 1).put("checkpointHash", E2eeEnvelope.encode(ByteArray(32))).put("securityEpoch", 1).put("operationId", UUID.randomUUID().toString())
            .put("payload", JSONObject().put("migrationId", UUID.randomUUID().toString()).put("fence", 1).put("sourceHash", E2eeEnvelope.encode(ByteArray(32) { 7 })).put("table", "maps").put("offset", 0))
        val packet = E2eeCommands.sign(command, keys.signing.private)
        val options = E2eeRemoteOriginal.Options(vault, target, E2eeRemoteOriginal.Capacity(16L * 1024 * 1024, 128, 16, 256, 2 * 1024 * 1024), packet,
            keys.signing.public, 2, { check(live) { "E2EE_ACCOUNT_CHANGED" } }, { durable++ }, { admissions += it; hook?.invoke() })
        fun read(vault: UnlockedE2eeVault = this.vault) = E2eeRemoteOriginal.ReadOptions(vault, target, options.capacity, options.assertCurrent)
        fun registered(): E2eeRemoteOriginal = E2eeRemoteOriginal.create(options).also { it.prepare(E2eeHttpObservation.Request("/e2ee/v1/read", "POST", packet.toString())) }
        fun complete(raw: ByteArray = "\ufeff {\"private\":\"SYNTHETIC-PRIVATE-RAW-CANARY α😀\"}\r\n".toByteArray()): Pair<E2eeRemoteOriginal.Reference, ByteArray> {
            val capture = registered()
            val parsed = E2eeHttpResponseJson.read(ByteArrayInputStream(raw), "/e2ee/v1/read", 200, "application/json", raw.size.toLong(), options.assertCurrent, capture)
            assertNotNull(parsed); return capture.reference() to raw
        }
    }
    private val header = E2eeHttpBodyObservation.Response("/e2ee/v1/read", 200, "application/json", null)
    private fun rejects(operation: () -> Unit) { try { operation(); fail("Invalid original accepted") } catch (error: Exception) { assertTrue(error.message.orEmpty(), error.message.orEmpty().contains("E2EE_")) } }
    private fun hash(bytes: ByteArray) = E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private fun readAll(options: E2eeRemoteOriginal.ReadOptions, id: String, allowIncomplete: Boolean = false): Pair<E2eeRemoteOriginal.Receipt, ByteArray> {
        var bytes = byteArrayOf(); val receipt = E2eeRemoteOriginal.withOriginal(options, id, allowIncomplete) { input -> bytes = input.readBytes() }; return receipt to bytes
    }
    @Test fun signedAeadQuarantineColdReadsExactRawBytesWithoutAPlaintextStore() {
        val f = Rig(); val (reference, raw) = f.complete(); assertEquals(hash(raw), reference.rawHash); assertEquals(raw.size.toLong(), reference.size); assertEquals(1, f.durable)
        val before = f.storage.snapshot(); assertFalse(before.contains("SYNTHETIC-PRIVATE-RAW-CANARY")); f.vault.lock(); val cold = UnlockedE2eeVault(f.storage, f.scope)
        val (receipt, bytes) = readAll(f.read(cold), reference.id); assertArrayEquals(raw, bytes); assertTrue(receipt.complete); assertEquals(hash(raw), receipt.rawHash); assertEquals(before, f.storage.snapshot())
    }
    @Test fun rawDuplicateResponseIsCompleteBeforeAndroidJsonProjectionRefusesIt() {
        val f = Rig(); val capture = f.registered(); val raw = "\ufeff {\"sourceHash\":\"first\", \"sourceHash\":\"second\"}\r\n".toByteArray()
        rejects { E2eeHttpResponseJson.read(ByteArrayInputStream(raw), "/e2ee/v1/read", 200, "application/json", -1, f.options.assertCurrent, capture) }
        val reference = capture.reference(); val (receipt, restored) = readAll(f.read(), reference.id); assertTrue(receipt.complete); assertArrayEquals(raw, restored)
    }
    @Test fun aCrashedPrefixIsNotCompleteAndAFreshAttemptRetainsEveryOldRow() {
        val f = Rig(); val capture = f.registered(); capture.begin(header); capture.append("prefix".toByteArray()); capture.close(); val old = E2eeRemoteOriginal.listOriginals(f.read()).single()
        assertEquals("receiving", old.phase); rejects { readAll(f.read(), old.id) }; val partial = readAll(f.read(), old.id, true); assertFalse(partial.first.complete); assertEquals("prefix", partial.second.toString(Charsets.UTF_8))
        val retained = f.storage.rows.toMap(); f.complete(); assertEquals(2, E2eeRemoteOriginal.listOriginals(f.read()).size)
        for ((key, row) in retained) if (!key.contains("remote-original-catalog:")) assertEquals(row.envelope.toJson().toString(), f.storage.rows[key]!!.envelope.toJson().toString())
    }
    @Test fun quotaAndSwallowedWriteFailureNeverPublishEofOrEraseAnAcknowledgedPrefix() {
        val f = Rig(); val capture = f.registered(); capture.begin(header); capture.append("first".toByteArray()); val before = f.storage.snapshot(); f.storage.full = true
        rejects { capture.append("second".toByteArray()) }; f.storage.full = false; rejects { capture.finish() }; capture.close(); assertEquals(before, f.storage.snapshot())
        val item = E2eeRemoteOriginal.listOriginals(f.read()).single(); assertEquals("receiving", item.phase); assertEquals("first", readAll(f.read(), item.id, true).second.toString(Charsets.UTF_8))
    }
    @Test fun retirementDuringAdmissionAndChangedRequestBindingsRefuseBeforePrivateContent() {
        val f = Rig(); val capture = f.registered(); val before = f.storage.snapshot(); f.hook = { f.live = false }; rejects { capture.begin(header) }; assertEquals(before, f.storage.snapshot()); capture.close()
        val other = Rig(); val next = E2eeRemoteOriginal.create(other.options); val changed = JSONObject(other.command.toString()); changed.getJSONObject("payload").put("fence", 2)
        rejects { next.prepare(E2eeHttpObservation.Request("/e2ee/v1/read", "POST", E2eeCommands.sign(changed, other.keys.signing.private).toString())) }; assertTrue(other.storage.rows.isEmpty()); next.close()
    }
    @Test fun capacityIncludesPartialOriginalsAndRequestJournalRecordCosts() {
        val f = Rig(); val capture = f.registered(); capture.begin(header); capture.append("old".toByteArray()); capture.close(); val before = f.storage.snapshot()
        val next = E2eeRemoteOriginal.create(f.options.copy(capacity = f.options.capacity.copy(maximumObservations = 1)))
        rejects { next.prepare(E2eeHttpObservation.Request("/e2ee/v1/read", "POST", f.packet.toString())) }; assertEquals(before, f.storage.snapshot()); assertTrue(f.admissions.all { it.records >= 3 && it.metadataBytes > 0 }); next.close()
    }
    @Test fun localStorageFailuresUseAnInertHttpCodeWhileCancellationKeepsItsIdentity() {
        val f = Rig(); val before = f.storage.snapshot()
        for (cancel in listOf(false, true)) {
            val failure = if (cancel) CancellationException("synthetic-retired") else IOException("SYNTHETIC-PRIVATE-STORAGE-CANARY")
            val capture = E2eeRemoteOriginal.create(f.options.copy(admit = { throw failure }))
            try { capture.prepare(E2eeHttpObservation.Request("/e2ee/v1/read", "POST", f.packet.toString())); fail("Local failure accepted") }
            catch (error: Exception) { if (cancel) assertSame(failure, error) else { assertTrue(error.javaClass.name, error is AuthApiError); assertEquals("E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE", error.message) } }
            capture.close(); assertEquals(before, f.storage.snapshot())
        }
    }
    @Test fun missingOrForgedBodyPartsAndUnknownRolesRefuseWithoutChangingAnyRow() {
        for (mode in listOf("missing", "serial", "tag", "role")) {
            val f = Rig(); val (reference, _) = f.complete(); val key = f.storage.rows.keys.single { it.contains(":p:00000") }; val old = f.storage.rows.getValue(key)
            when (mode) {
                "missing" -> f.storage.rows.remove(key)
                "serial" -> f.storage.rows[key] = E2eeLocalRecord(2, old.envelope)
                "tag" -> { val value = old.envelope.toJson(); val cipher = value.getString("ciphertext"); value.put("ciphertext", (if (cipher[0] == 'A') "B" else "A") + cipher.substring(1)); f.storage.rows[key] = E2eeLocalRecord(old.serial, E2eeEnvelope.Envelope.fromJson(value)) }
                else -> f.storage.rows[key.replace(":p:00000", ":x:00000")] = old
            }
            val before = f.storage.snapshot(); rejects { readAll(f.read(), reference.id) }; assertEquals(before, f.storage.snapshot())
        }
    }
    @Test fun incompleteConsumersAreClosedAndCannotContinueReadingAnEscapedCapability() {
        val f = Rig(); val (reference, _) = f.complete(); var escaped: InputStream? = null
        rejects { E2eeRemoteOriginal.withOriginal(f.read(), reference.id) { input -> escaped = input; assertTrue(input.read() >= 0) } }
        val target = ByteArray(64) { 31 }; rejects { escaped!!.read(target) }; assertTrue(target.all { it == 0.toByte() })
        val (receipt, _) = readAll(f.read(), reference.id); assertTrue(receipt.complete)
        val closed = E2eeRemoteOriginal.withOriginal(f.read(), reference.id) { input -> input.use { it.readBytes() } }; assertTrue(closed.complete)
    }
    @Test fun aCatalogueChangeAfterConsumerEofCannotYieldASourceReceipt() {
        val f = Rig(); val (reference, _) = f.complete()
        rejects { E2eeRemoteOriginal.withOriginal(f.read(), reference.id) { input -> input.readBytes(); f.registered().close() } }
    }
    @Test fun validlySealedPartialMetadataCannotRebindItsOriginalSignedSourceHash() {
        val f = Rig(); val capture = f.registered(); capture.begin(header); capture.append("prefix".toByteArray()); capture.close(); val original = E2eeRemoteOriginal.listOriginals(f.read()).single()
        val jid = f.vault.listLocal("local-snapshot", "remote-original:").single { it.endsWith(":j:00000") }; val row = f.vault.read("local-snapshot", jid)!!
        val metadata = try { E2eeCommands.decodeCanonical(row.bytes) as JSONObject } finally { row.bytes.fill(0) }; metadata.getJSONObject("binding").put("sourceHash", E2eeEnvelope.encode(ByteArray(32) { 9 }))
        val bytes = E2eeCommands.canonical(metadata); try { f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot", jid, bytes, row.serial))) } finally { bytes.fill(0) }
        val before = f.storage.snapshot(); rejects { readAll(f.read(), original.id, true) }; assertEquals(before, f.storage.snapshot())
    }
    @Test fun registrationIsImmutableInertIdentityBeforeDurableWritesAndAfterRetirement() {
        val f=Rig();val capture=E2eeRemoteOriginal.create(f.options);val registered=capture.registration()
        assertEquals(1,registered.protocol);assertEquals("remote-original/v1",registered.purpose)
        assertEquals(hash(E2eeCommands.canonical(f.packet)),registered.binding.packetHash)
        assertEquals(f.scope.ownerId,registered.context.actorId);assertEquals(2L,registered.binding.generation)
        assertTrue(f.storage.rows.isEmpty());assertEquals(0,f.durable);assertTrue(f.admissions.isEmpty())
        rejects{E2eeRemoteOriginal.describeOriginal(f.read(),registered.id)}
        capture.close();f.live=false;f.vault.lock();assertEquals(registered,capture.registration())
        assertTrue(registered.toString().contains("[redacted]"));assertFalse(registered.toString().contains(registered.id))
    }
    @Test fun descriptorAuthenticatesRegisteredAndPartialRequestWithoutOpeningResponseBodies() {
        val f=Rig();val capture=f.registered();val registration=capture.registration()
        var descriptor=E2eeRemoteOriginal.describeOriginal(f.read(),registration.id)
        assertEquals(registration,descriptor.registration);assertFalse(descriptor.bodyVerified);assertEquals("registered",descriptor.phase);assertNull(descriptor.response)
        assertEquals(hash(f.packet.toString().toByteArray()),descriptor.request.hash)
        capture.begin(header);capture.append("prefix".toByteArray());capture.close();val before=f.storage.snapshot();f.storage.bodyGets=0
        descriptor=E2eeRemoteOriginal.describeOriginal(f.read(),registration.id)
        assertEquals("receiving",descriptor.phase);assertEquals(6L,descriptor.size);assertEquals(1,descriptor.parts);assertFalse(descriptor.bodyVerified)
        assertNull(descriptor.rawHash);assertNull(descriptor.manifestHash);assertEquals(0,f.storage.bodyGets);assertEquals(before,f.storage.snapshot())
        rejects{E2eeRemoteOriginal.describeOriginal(f.read().copy(capacity=f.options.capacity.copy(maximumBytes=1)),registration.id)}
        assertEquals(0,f.storage.bodyGets);assertTrue(descriptor.toString().contains("[redacted]"))
    }
    @Test fun completeDescriptorIsMetadataAndDoesNotAuthenticateATamperedBody() {
        val f=Rig();val (reference,_)=f.complete();val key=f.storage.rows.keys.single{it.contains(":p:00000")};val old=f.storage.rows.getValue(key)
        val value=old.envelope.toJson();val cipher=value.getString("ciphertext");value.put("ciphertext",(if(cipher[0]=='A')"B" else "A")+cipher.substring(1))
        f.storage.rows[key]=E2eeLocalRecord(old.serial,E2eeEnvelope.Envelope.fromJson(value));val before=f.storage.snapshot();f.storage.bodyGets=0
        val descriptor=E2eeRemoteOriginal.describeOriginal(f.read(),reference.id)
        assertEquals("complete",descriptor.phase);assertFalse(descriptor.bodyVerified);assertEquals(reference.rawHash,descriptor.rawHash);assertEquals(0,f.storage.bodyGets)
        rejects{readAll(f.read(),reference.id)};assertEquals(before,f.storage.snapshot())
    }
    @Test fun descriptorRejectsSourceRebindingCatalogueDriftAndPreservesExactCancellationBeforeBodyRead() {
        for(mode in listOf("binding","catalog","retire")){
            val f=Rig();val capture=f.registered();capture.begin(header);capture.append("prefix".toByteArray());capture.close();val id=capture.registration().id
            if(mode=="binding"){
                val jid=f.vault.listLocal("local-snapshot","remote-original:").single{it.endsWith(":j:00000")};val row=f.vault.read("local-snapshot",jid)!!
                val metadata=try{E2eeCommands.decodeCanonical(row.bytes) as JSONObject}finally{row.bytes.fill(0)}
                metadata.getJSONObject("binding").put("sourceHash",E2eeEnvelope.encode(ByteArray(32){9}));val bytes=E2eeCommands.canonical(metadata)
                try{f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",jid,bytes,row.serial)))}finally{bytes.fill(0)}
            }
            val before=f.storage.rows.toMap();var changed=false;var retired=false;val cancellation=CancellationException("synthetic-descriptor-retired")
            val read=f.read().copy(assertCurrent={if(retired)throw cancellation;f.options.assertCurrent()})
            f.storage.bodyGets=0;f.storage.afterGet={key->if(key.contains(":r:")&&!changed){changed=true;if(mode=="catalog")f.registered().close();if(mode=="retire")retired=true}}
            try{E2eeRemoteOriginal.describeOriginal(read,id);fail("Invalid descriptor accepted")}catch(error:Exception){if(mode=="retire")assertSame(cancellation,error)else assertTrue(error.message.orEmpty().startsWith("E2EE_"))}
            assertEquals(0,f.storage.bodyGets)
            for((key,row)in before)if(!key.contains("remote-original-catalog:"))assertEquals(row.envelope.toJson().toString(),f.storage.rows.getValue(key).envelope.toJson().toString())
        }
    }
    @Test fun descriptorAndBodyReaderRejectPhysicalRequestBomEvenAfterValidLocalResealing() {
        val f=Rig();val capture=f.registered();capture.close();val id=capture.registration().id
        val rid=f.vault.listLocal("local-snapshot","remote-original:").single{it.endsWith(":r:00000")};val request=f.vault.read("local-snapshot",rid)!!
        val bytes=try{byteArrayOf(0xef.toByte(),0xbb.toByte(),0xbf.toByte())+request.bytes}finally{request.bytes.fill(0)}
        val key=f.storage.rows.keys.single{it.endsWith(rid)};val old=f.storage.rows.getValue(key)
        f.storage.rows[key]=E2eeLocalRecord(1,E2eeEnvelope.seal(f.scope.roots.getValue(f.scope.keyId),f.keys.signing.private,old.envelope.context,bytes))
        val jid=f.vault.listLocal("local-snapshot","remote-original:").single{it.endsWith(":j:00000")};val journal=f.vault.read("local-snapshot",jid)!!
        val metadata=try{E2eeCommands.decodeCanonical(journal.bytes) as JSONObject}finally{journal.bytes.fill(0)}
        metadata.put("request",JSONObject().put("size",bytes.size).put("hash",hash(bytes)));val encoded=E2eeCommands.canonical(metadata)
        try{f.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",jid,encoded,journal.serial)))}finally{encoded.fill(0);bytes.fill(0)}
        val before=f.storage.snapshot();rejects{E2eeRemoteOriginal.describeOriginal(f.read(),id)};rejects{readAll(f.read(),id,true)};assertEquals(before,f.storage.snapshot())
    }
}
