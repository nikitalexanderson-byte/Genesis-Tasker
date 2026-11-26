package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.yield
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import java.io.File
import java.io.InputStream
import java.security.MessageDigest
import java.util.UUID

/** Synthetic lazy peer ports backed by owned real encrypted SQLite, not a
 * live HTTP/backend account, product migration or authority handoff. */
class E2eeContentPlanReadbackDeviceTest {
    private class Generated(private val size:Int):InputStream() {
        private var position=0
        override fun read():Int=error("UNBOUNDED_READ_NOT_USED")
        override fun read(out:ByteArray,offset:Int,length:Int):Int {if(position==size)return -1;val count=minOf(length,size-position,65536);for(index in 0 until count)out[offset+index]=((position+index)*31).toByte();position+=count;return count}
    }
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(app.noBackupFilesDir,"plan-readback-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=directory}
        val keys=E2eeKeys.generateDeviceKeys();val root=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}}
        val local=E2eeKeys.freshSecret().let{try{E2eeEnvelope.importRoot(it)}finally{it.fill(0)}};val actor=UnlockedE2eeVault.LocalIdentity("readback-actor","device:plan-readback","readback-device")
        val scope=UnlockedE2eeVault.Scope(actor.ownerId,actor.scopeId,actor.deviceId,1,1,1,"local-root",keys.signing.private,mapOf("local-root" to local)){if(it==actor.deviceId)keys.signing.public else null}
        var storage=E2eeSqliteStorage(context,true);var vault=UnlockedE2eeVault(storage,scope);var live=true;var gets=0;var walks=0
        val inventory=E2eePrivatePaths.load(app);val paths=inventory.required("personal").map{it.id};val target=E2eeSourceStage.Target("content-owner","personal:plan-readback","personal")
        val base=E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId",target.ownerId).put("scopeId",target.scopeId).put("domain","workspace").put("objectId","plan-context")
            .put("schemaVersion",1).put("dataGeneration",2).put("writerProtocol",9).put("cryptoEpoch",1).put("securityEpoch",1).put("revision",1).put("keyId","content-root").put("deviceId",actor.deviceId).put("operationId",UUID.randomUUID().toString()))
        val migrationId=UUID.randomUUID().toString();val sourceHash=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(byteArrayOf(7)))
        init{check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))}
        fun read()=E2eeContentPlan.ReadOptions(vault,root,keys.signing.public,base,target,migrationId,sourceHash,paths,inventory){check(live){"E2EE_ACCOUNT_CHANGED"}}
        fun build(size:Int):E2eeContentPlan.Reference {
            val writer=E2eeContentPlan.create(E2eeContentPlan.Options(read(),keys.signing.private,E2eeContentPlan.Capacity(128L*1024*1024,8000,8000),{check(directory.usableSpace>it.additionalStorageBytes){"E2EE_NO_SPACE"}},{},{}))
            writer.append("personal.workspace",E2eeContentPlan.Record("remote","workspace","payload",size,Generated(size),"\uFEFF\uD800-\uDFFF-α","application/octet-stream"))
            writer.append("personal.local-work",E2eeContentPlan.Record("local","workspace","local",3,byteArrayOf(9,8,7).inputStream()));return writer.finish(paths.map{it to true})
        }
        fun cold(){vault.lock();storage.close();storage=E2eeSqliteStorage(context);vault=UnlockedE2eeVault(storage,scope)}
        fun envelope(recordId:String):E2eeEnvelope.Envelope {val row=requireNotNull(vault.read("outbox",recordId));try{return E2eeEnvelope.Envelope.fromJson(JSONObject(row.bytes.toString(Charsets.UTF_8)))}finally{row.bytes.fill(0)}}
        fun peer(manifest:JSONObject):E2eeBoundedMigrationReadback {
            val plan=manifest.getJSONArray("plan");val lookup=(0 until plan.length()).associate{plan.getJSONObject(it).let{row->row.getString("domain")+"\u0000"+row.getString("objectId") to row.getString("recordId")}}
            return object:E2eeBoundedMigrationReadback {
                override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {walks++;for(index in 0 until plan.length()){yield();consume(envelope(plan.getJSONObject(index).getString("recordId")))};return plan.length()}
                override suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope? {gets++;yield();return lookup["$domain\u0000$objectId"]?.let(::envelope)}
            }
        }
        override fun close(){live=false;vault.lock();storage.close();check(directory.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&directory.name.startsWith("plan-readback-synthetic-"));check(directory.deleteRecursively())}
    }
    private suspend fun refuses(body:suspend()->Unit){try{body()}catch(error:Exception){assertTrue(error.message.orEmpty().contains("E2EE_"));return};fail("Invalid readback accepted")}
    private fun proof(value:JSONObject){val app=InstrumentationRegistry.getInstrumentation().targetContext;val directory=requireNotNull(app.getExternalFilesDir(null));File(directory,"content-plan-readback336-proof.json").outputStream().use{it.write(value.toString().toByteArray());it.fd.sync()}}
    @Test fun coldSqlitePlanAndLazyPeerVerifyEveryByteOfTheGeneratedFile() {runBlocking{
        Rig().use{f->val start=SystemClock.elapsedRealtime();val size=9*1024*1024+7;val reference=f.build(size);f.cold();val manifest=E2eeContentPlan.open(f.read(),reference).manifest
            val before=f.storage.list("").toSet();val receipt=E2eeContentPlan.verifyReadback(f.read(),reference,f.peer(manifest));assertEquals(reference,receipt.reference);assertEquals(38,receipt.envelopes);assertEquals(1,receipt.remoteRecords);assertEquals(1,receipt.localRecords);assertEquals(38,f.gets);assertEquals(1,f.walks);assertEquals(before,f.storage.list("").toSet())
            proof(JSONObject().put("synthetic",true).put("componentOnly",true).put("coldSqlite",true).put("lazyPeer",true).put("fileBytes",size).put("localBytes",3).put("envelopes",receipt.envelopes).put("gets",f.gets).put("walks",f.walks)
                .put("sha256",manifest.getJSONArray("logical").getJSONObject(0).getString("plaintextHash")).put("elapsedMs",SystemClock.elapsedRealtime()-start).put("maxHeap",Runtime.getRuntime().maxMemory()))
        }
    }}
    @Test fun omittedForgedDuplicateMissingAndRetiredRepliesCannotYieldReceipts() {runBlocking{
        Rig().use{f->val reference=f.build(3);val manifest=E2eeContentPlan.open(f.read(),reference).manifest;val peer=f.peer(manifest);val first=f.envelope(manifest.getJSONArray("plan").getJSONObject(0).getString("recordId"))
            refuses{E2eeContentPlan.verifyReadback(f.read(),reference,object:E2eeBoundedMigrationReadback by peer {override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit)=0})}
            refuses{E2eeContentPlan.verifyReadback(f.read(),reference,object:E2eeBoundedMigrationReadback by peer {override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {val count=peer.forEachEnvelope(consume);consume(first);return count+1}})}
            refuses{E2eeContentPlan.verifyReadback(f.read(),reference,object:E2eeBoundedMigrationReadback by peer {override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {val bad=first.toJson();val signature=bad.getString("signature");bad.put("signature",(if(signature[0]=='A')"B" else "A")+signature.substring(1));try{consume(E2eeEnvelope.Envelope.fromJson(bad))}catch(_:Exception){};return 2}})}
            refuses{E2eeContentPlan.verifyReadback(f.read(),reference,object:E2eeBoundedMigrationReadback by peer {override suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope?=null})}
            var late:(suspend(E2eeEnvelope.Envelope)->Unit)?=null;E2eeContentPlan.verifyReadback(f.read(),reference,object:E2eeBoundedMigrationReadback by peer {override suspend fun forEachEnvelope(consume:suspend(E2eeEnvelope.Envelope)->Unit):Int {late=consume;return peer.forEachEnvelope(consume)}});refuses{requireNotNull(late)(first)}
            refuses{E2eeContentPlan.verifyReadback(f.read(),reference,object:E2eeBoundedMigrationReadback by peer {override suspend fun getEnvelope(domain:String,objectId:String):E2eeEnvelope.Envelope? {val value=peer.getEnvelope(domain,objectId);f.live=false;return value}})};f.live=true;assertEquals(2,E2eeContentPlan.open(f.read(),reference).manifest.getJSONArray("plan").length())
        }
    }}
    @Test fun suspendedFileAckPreventsPrefetchAndCancellationWipesTheBorrowedBuffer() {runBlocking{
        Rig().use{f->val reference=f.build(E2eeFiles.CHUNK_BYTES*2+17);val manifest=E2eeContentPlan.open(f.read(),reference).manifest;val plan=manifest.getJSONArray("plan");val byId=(0 until plan.length()).associate{plan.getJSONObject(it).let{row->row.getString("objectId") to row.getString("recordId")}}
            val envelope=f.envelope(manifest.getJSONArray("logical").getJSONObject(0).getString("manifestRecordId"));val entered=CompletableDeferred<Unit>();val blocked=CompletableDeferred<Unit>();var borrowed:ByteArray?=null;var gets=0
            val task=async {E2eeFiles.openStreamSuspending(f.root,f.keys.signing.public,envelope.context,envelope,{id->yield();gets++;f.envelope(requireNotNull(byId[id]))},{check(f.live){"E2EE_ACCOUNT_CHANGED"}},{bytes->borrowed=bytes;entered.complete(Unit);blocked.await()})}
            entered.await();assertEquals(1,gets);assertTrue(requireNotNull(borrowed).any{it!=0.toByte()});task.cancelAndJoin();assertEquals(1,gets);assertTrue(requireNotNull(borrowed).all{it==0.toByte()});assertEquals(4,E2eeContentPlan.open(f.read(),reference).manifest.getJSONArray("plan").length())
        }
    }}
}
