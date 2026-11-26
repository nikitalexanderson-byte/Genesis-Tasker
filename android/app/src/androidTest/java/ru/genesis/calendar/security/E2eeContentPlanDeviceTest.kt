package ru.genesis.calendar.security

import android.content.Context
import android.content.ContextWrapper
import android.os.SystemClock
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.data.LocalCipher
import java.io.File
import java.io.InputStream
import java.security.KeyFactory
import java.security.KeyStore
import java.security.MessageDigest
import java.security.PublicKey
import java.security.spec.X509EncodedKeySpec
import java.util.UUID
import javax.crypto.SecretKey

/** Synthetic component/custody fixtures only. No real account, device keys,
 * source adapter, coordinator lease, product recovery or activation is used. */
class E2eeContentPlanDeviceTest {
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        val directory=File(app.noBackupFilesDir,"content-plan-synthetic-${UUID.randomUUID()}").apply{check(mkdir())}
        val context=object:ContextWrapper(app){override fun getApplicationContext():Context=this;override fun getNoBackupFilesDir()=directory}
        val alias="genesis.qa.content-plan.${UUID.randomUUID()}";val legacy=LocalCipher(alias);val secret=E2eeKeys.freshSecret()
        val localRaw=E2eeKeys.freshSecret();val contentRaw=E2eeKeys.freshSecret();val localRoot=E2eeEnvelope.importRoot(localRaw);val contentRoot=E2eeEnvelope.importRoot(contentRaw);val keys=E2eeKeys.generateDeviceKeys()
        val publicSpki=E2eeKeys.publicKeys(keys).getString("signingKey");val localKeyId="plan-local-root";val actor=UnlockedE2eeVault.LocalIdentity("plan-actor","device:plan-source","plan-device")
        var storage=E2eeSqliteStorage(context,true);var live=true;var originalComplete=true;var beforeCommit:(()->Unit)?=null
        val current:()->Unit={check(live){"E2EE_ACCOUNT_CHANGED"}}
        private val port=object:E2eeRecordStorage {
            override fun get(key:String)=storage.get(key)
            override fun list(prefix:String)=storage.list(prefix)
            override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){beforeCommit?.invoke();storage.commit(changes,requireOpen)}
        }
        val vault=UnlockedE2eeVault(port,UnlockedE2eeVault.Scope(actor.ownerId,actor.scopeId,actor.deviceId,1,1,1,localKeyId,keys.signing.private,mapOf(localKeyId to localRoot)){if(it==actor.deviceId)keys.signing.public else null})
        val inventory=E2eePrivatePaths.load(app);val paths=inventory.required("personal").map{it.id};val target=E2eeSourceStage.Target("content-owner","personal:content-plan","personal")
        val base=E2eeEnvelope.Context.fromJson(JSONObject().put("cryptoProtocol",1).put("suite",E2eeEnvelope.SUITE).put("ownerId",target.ownerId).put("scopeId",target.scopeId)
            .put("domain","workspace").put("objectId","plan-context").put("schemaVersion",1).put("dataGeneration",2).put("writerProtocol",9).put("cryptoEpoch",1).put("securityEpoch",1)
            .put("revision",1).put("keyId","content-root").put("deviceId",actor.deviceId).put("operationId",UUID.randomUUID().toString()))
        val migrationId=UUID.randomUUID().toString();val sourceHash=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(byteArrayOf(7)))
        val coverage=paths.map{it to true}
        init{
            check(BuildConfig.DEBUG&&app.packageName.endsWith(".qa1103.debug"))
            val bundle=JSONObject().put("local",E2eeKeys.protectBundle(actor.ownerId,"synthetic-plan-local",secret,localRaw)).put("content",E2eeKeys.protectBundle(actor.ownerId,"synthetic-plan-content",secret,contentRaw))
            save(File(directory,"independent-roots.bundle"),bundle)
            val old=JSONObject().put("localRoot",E2eeEnvelope.encode(localRaw)).put("contentRoot",E2eeEnvelope.encode(contentRaw)).put("keys",E2eeKeys.exportPrivateKeys(keys))
            val bytes=legacy.encrypt(old.toString(),"synthetic-plan-old-device").toByteArray();try{File(directory,"old-device.bundle").outputStream().use{it.write(bytes);it.fd.sync()}}finally{bytes.fill(0)}
        }
        fun read(vault:E2eeSourceReadVault=this.vault,root:SecretKey=contentRoot,signer:PublicKey=keys.signing.public)=E2eeContentPlan.ReadOptions(vault,root,signer,base,target,migrationId,sourceHash,paths,inventory,current)
        fun options(admit:(E2eeContentPlan.Admission)->Unit={request->check(directory.usableSpace>request.additionalStorageBytes){"E2EE_NO_SPACE"}})=
            E2eeContentPlan.Options(read(),keys.signing.private,E2eeContentPlan.Capacity(128L*1024*1024,8000,8000),admit,{}, {check(originalComplete){"E2EE_SOURCE_STAGE_EOF_REQUIRED"}})
        fun removeOnlyOldAlias(){vault.lock();storage.close();localRaw.fill(0);contentRaw.fill(0);val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};assertTrue(store.containsAlias(alias));store.deleteEntry(alias);assertFalse(store.containsAlias(alias));storage=E2eeSqliteStorage(context)}
        fun recovered():Pair<SecretKey,SecretKey>{val value=JSONObject(File(directory,"independent-roots.bundle").readText());val local=E2eeKeys.openBundle(actor.ownerId,"synthetic-plan-local",secret,value.getJSONObject("local"));val content=E2eeKeys.openBundle(actor.ownerId,"synthetic-plan-content",secret,value.getJSONObject("content"));return try{E2eeEnvelope.importRoot(local) to E2eeEnvelope.importRoot(content)}finally{local.fill(0);content.fill(0)}}
        fun signer()=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(publicSpki,1,8192)))
        override fun close(){live=false;vault.lock();localRaw.fill(0);contentRaw.fill(0);secret.fill(0);storage.close();val store=KeyStore.getInstance("AndroidKeyStore").apply{load(null)};if(store.containsAlias(alias))store.deleteEntry(alias)
            check(directory.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile&&directory.name.startsWith("content-plan-synthetic-"));check(directory.deleteRecursively())}
    }
    private class ReadOnly(private val f:Rig,private val attempt:String,private val root:SecretKey,private val signer:PublicKey):E2eeSourceReadVault {
        override fun assertOpen()=f.current()
        override fun localIdentity():UnlockedE2eeVault.LocalIdentity {assertOpen();return f.actor}
        override fun read(domain:String,objectId:String):UnlockedE2eeVault.Opened? {
            assertOpen();E2eeKeys.technical(objectId);check(domain=="outbox"&&objectId.startsWith("$attempt:upload:")||domain=="local-snapshot"&&(objectId.startsWith("content-plan:$attempt:")||objectId.startsWith("$attempt:private:"))){"E2EE_TEST_PLAN_NAMESPACE"}
            val key=listOf(f.actor.ownerId,f.actor.scopeId,domain,objectId).joinToString(""){"${it.length}:$it"};val row=f.storage.get(key);assertOpen();if(row==null)return null
            val ctx=row.envelope.context.toJson();check(ctx.get("ownerId")==f.actor.ownerId&&ctx.get("scopeId")==f.actor.scopeId&&ctx.get("deviceId")==f.actor.deviceId&&ctx.get("domain")==domain&&ctx.get("objectId")==objectId
                &&E2eeCommands.integer(ctx.get("revision"),1)==row.serial&&E2eeCommands.integer(ctx.get("schemaVersion"),1)==1L&&E2eeCommands.integer(ctx.get("dataGeneration"),1)==1L
                &&E2eeCommands.integer(ctx.get("cryptoEpoch"),1)==1L&&E2eeCommands.integer(ctx.get("securityEpoch"),1)==1L&&ctx.get("keyId")==f.localKeyId){"E2EE_TEST_PLAN_CONTEXT"}
            val bytes=E2eeEnvelope.open(root,signer,row.envelope.context,row.envelope);try{assertOpen();return UnlockedE2eeVault.Opened(row.serial,bytes)}catch(error:Exception){bytes.fill(0);throw error}
        }
        override fun listLocal(domain:String,objectPrefix:String):List<String>{
            assertOpen();check(domain in setOf("outbox","local-snapshot")&&(objectPrefix=="$attempt:"||objectPrefix=="content-plan:$attempt:")){"E2EE_TEST_PLAN_NAMESPACE"}
            val frame=listOf(f.actor.ownerId,f.actor.scopeId,domain).joinToString(""){"${it.length}:$it"};val keys=f.storage.list(frame);assertOpen();check(keys.size<=10000&&keys.toSet().size==keys.size){"E2EE_TEST_PLAN_LIMIT"}
            return keys.map{key->check(key.startsWith(frame));val rest=key.substring(frame.length);val colon=rest.indexOf(':');check(colon>0&&rest.substring(0,colon).matches(Regex("[1-9][0-9]{0,2}")));val id=rest.substring(colon+1);E2eeKeys.technical(id);check(rest.substring(0,colon).toInt()==id.length);id}.filter{it.startsWith(objectPrefix)}
        }
    }
    private class Generated(private val size:Int,private val path:Int):InputStream(){var at=0;var eof=false
        override fun read():Int {val one=ByteArray(1);return try{if(read(one,0,1)<0)-1 else one[0].toInt() and 255}finally{one.fill(0)}}
        override fun read(bytes:ByteArray,offset:Int,length:Int):Int {if(at==size){eof=true;return -1};val count=minOf(length,65536,size-at);for(index in 0 until count)bytes[offset+index]=((at+index)*31+path*17).toByte();at+=count;return count}}
    companion object {private fun save(file:File,value:JSONObject){file.outputStream().use{out->out.write(value.toString().toByteArray());out.fd.sync()}}}
    @Test fun retiredPlanCreationCannotCommitWhileTheVaultRemainsOpen(){
        Rig().use{f->
            f.vault.write(listOf(UnlockedE2eeVault.Write("draft","accepted-original","SYNTHETIC ACCEPTED ORIGINAL".toByteArray(),null)))
            fun snapshot()=f.storage.list("").sorted().map{key->val row=requireNotNull(f.storage.get(key));"$key:${row.serial}:${row.envelope.toJson()}"}
            val before=snapshot();f.beforeCommit={f.beforeCommit=null;f.live=false}
            val error=assertThrows(IllegalStateException::class.java){E2eeContentPlan.create(f.options())}
            assertEquals("E2EE_ACCOUNT_CHANGED",error.message);f.vault.assertOpen();assertEquals(before,snapshot())
        }
    }
    @Test fun boundedPlanColdReadChecksAllEightyMiBAfterOnlyTheSyntheticOldAliasIsDeleted(){
        Rig().use{f->val started=SystemClock.elapsedRealtime();val writer=E2eeContentPlan.create(f.options());val size=40*1024*1024;val sources=mutableListOf<Generated>()
            for(path in 0..1){val source=Generated(size,path);sources+=source;writer.append("personal.workspace",E2eeContentPlan.Record("remote","workspace","payload-$path",size,source,"\uFEFF\uD800-\uDFFF-α/$path","application/octet-stream"));assertTrue(source.eof)}
            writer.append("personal.local-work",E2eeContentPlan.Record("local","workspace","local-value",3,byteArrayOf(9,8,7).inputStream()))
            val reference=writer.finish(f.coverage);f.removeOnlyOldAlias();val recovered=f.recovered();val signer=f.signer();val port=ReadOnly(f,reference.attemptId,recovered.first,signer);val result=E2eeContentPlan.open(f.read(port,recovered.second,signer),reference).manifest
            assertEquals(322,result.getJSONArray("plan").length());val plan=result.getJSONArray("plan");val byId=(0 until plan.length()).associate{plan.getJSONObject(it).let{row->row.getString("objectId") to row.getString("recordId")}}
            fun envelope(id:String):E2eeEnvelope.Envelope {val row=requireNotNull(port.read("outbox",id));try{return E2eeEnvelope.Envelope.fromJson(JSONObject(row.bytes.toString(Charsets.UTF_8)))}finally{row.bytes.fill(0)}}
            val hashes=JSONArray();var total=0L;var expired=true
            for(path in 0..1){val logical=result.getJSONArray("logical").getJSONObject(path);val manifest=envelope(logical.getString("manifestRecordId"));val hash=MessageDigest.getInstance("SHA-256");var at=0;var previous:ByteArray?=null
                val metadata=E2eeFiles.openStream(recovered.second,signer,manifest.context,manifest,{id->envelope(byId.getValue(id))},f.current,{bytes->if(previous!=null)expired=expired&&previous!!.all{it==0.toByte()};for(index in bytes.indices)if(bytes[index]!=((at+index)*31+path*17).toByte())error("SYNTHETIC_PLAN_BYTE_MISMATCH");hash.update(bytes);at+=bytes.size;previous=bytes})
                assertEquals(size,at);assertEquals("\uFEFF\uD800-\uDFFF-α/$path",metadata.filename);expired=expired&&previous!!.all{it==0.toByte()};total+=at;hashes.put(E2eeEnvelope.encode(hash.digest()))}
            assertTrue(expired);assertEquals(2L*size,total)
            save(File(f.app.getExternalFilesDir(null),"content-plan336-large-proof.json"),JSONObject().put("synthetic",true).put("componentOnly",true).put("oldAliasRemoved",true).put("readOnlyPublicSigner",true)
                .put("logicalBytes",total).put("fileBytes",size).put("files",2).put("localBytes",3).put("envelopes",plan.length()).put("sha256",hashes).put("borrowedWiped",expired)
                .put("maxHeap",Runtime.getRuntime().maxMemory()).put("elapsedMs",SystemClock.elapsedRealtime()-started))
        }
    }
    @Test fun actualProviderRefusesLateInputAndQuotaAndExportsOnlyPublicSyntheticPlanInterop(){
        Rig().use{f->
            val partial=E2eeContentPlan.create(f.options());val bytes=ByteArray(E2eeFiles.CHUNK_BYTES+1){7};val delegate=bytes.inputStream()
            val source=object:InputStream(){override fun read():Int=error("UNUSED_READ");override fun read(out:ByteArray,offset:Int,length:Int):Int{val count=delegate.read(out,offset,length);if(count<0)error("E2EE_OLD_TAG_INVALID");return count}}
            assertThrows(Exception::class.java){partial.append("personal.workspace",E2eeContentPlan.Record("remote","workspace","late",bytes.size,source))};assertThrows(Exception::class.java){partial.finish(f.coverage)};bytes.fill(0)
            var calls=0;val quota=E2eeContentPlan.create(f.options{if(++calls==4)error("E2EE_NO_SPACE")});assertThrows(Exception::class.java){quota.append("personal.workspace",E2eeContentPlan.Record("remote","workspace","no-space",512*1024,Generated(512*1024,0)))};assertThrows(Exception::class.java){quota.finish(f.coverage)}
            val writer=E2eeContentPlan.create(f.options());writer.append("personal.workspace",E2eeContentPlan.Record("remote","workspace","vector-file",3,byteArrayOf(1,2,3).inputStream(),"\uFEFF\uD800-\uDFFF-α","application/octet-stream"))
            writer.append("personal.workspace",E2eeContentPlan.Record("remote","workspace","empty-file",0,byteArrayOf().inputStream()));writer.append("personal.local-work",E2eeContentPlan.Record("local","workspace","local-value",3,byteArrayOf(9,8,7).inputStream()))
            val reference=writer.finish(f.coverage);val result=E2eeContentPlan.open(f.read(),reference).manifest;val allowed=mutableSetOf(id(reference.attemptId,"journal"),id(reference.attemptId,"manifest"))
            val plan=result.getJSONArray("plan");for(index in 0 until plan.length())allowed+=plan.getJSONObject(index).getString("recordId");allowed+="${reference.attemptId}:private:0:0"
            val records=JSONArray();for(domain in listOf("outbox","local-snapshot")){val frame=listOf(f.actor.ownerId,f.actor.scopeId,domain).joinToString(""){"${it.length}:$it"};for(key in f.storage.list(frame)){
                val rest=key.substring(frame.length);val objectId=rest.substring(rest.indexOf(':')+1);if(objectId !in allowed)continue;val row=requireNotNull(f.storage.get(key));records.put(JSONObject().put("key",key).put("serial",row.serial).put("envelope",row.envelope.toJson()))}}
            val vector=JSONObject().put("synthetic",true).put("warning","PUBLIC TEST KEYS; DO NOT USE FOR USER DATA").put("producer","Android/JCA API${android.os.Build.VERSION.SDK_INT} content plan")
                .put("actor",JSONObject().put("ownerId",f.actor.ownerId).put("scopeId",f.actor.scopeId).put("deviceId",f.actor.deviceId)).put("localKeyId",f.localKeyId).put("localRootKey",E2eeEnvelope.encode(f.localRaw)).put("contentRootKey",E2eeEnvelope.encode(f.contentRaw)).put("publicKeySpki",f.publicSpki)
                .put("context",f.base.toJson()).put("target",JSONObject().put("ownerId",f.target.ownerId).put("scopeId",f.target.scopeId).put("kind",f.target.kind)).put("migrationId",f.migrationId).put("sourceHash",f.sourceHash).put("paths",JSONArray(f.paths))
                .put("reference",JSONObject().put("attemptId",reference.attemptId).put("manifestHash",reference.manifestHash)).put("records",records)
            save(File(f.app.getExternalFilesDir(null),"content-plan336-native-vector.json"),vector);f.live=false;assertThrows(Exception::class.java){E2eeContentPlan.open(f.read(),reference)}
        }
    }
    @Test fun actualProviderOpensPublicWebPlanWithSeparateRootsAndNoPrivateSignerInTheReadPort(){
        val fixture=InstrumentationRegistry.getInstrumentation().context.assets.open("e2ee/content-plan-web-v1.json").bufferedReader().use{JSONObject(it.readText())}
        assertTrue(fixture.getBoolean("synthetic"));assertEquals("PUBLIC TEST KEYS; DO NOT USE FOR USER DATA",fixture.getString("warning"))
        Rig().use{f->
            val actor=fixture.getJSONObject("actor");assertEquals(f.actor.ownerId,actor.get("ownerId"));assertEquals(f.actor.scopeId,actor.get("scopeId"));assertEquals(f.actor.deviceId,actor.get("deviceId"));assertEquals(f.localKeyId,fixture.get("localKeyId"))
            val records=fixture.getJSONArray("records");assertEquals(6,records.length());f.storage.commit((0 until records.length()).map{index->val row=records.getJSONObject(index);E2eeStorageChange(row.getString("key"),null,E2eeLocalRecord(E2eeCommands.integer(row.get("serial"),1),E2eeEnvelope.Envelope.fromJson(row.getJSONObject("envelope"))))},f.current)
            val publicKey=KeyFactory.getInstance("EC").generatePublic(X509EncodedKeySpec(E2eeEnvelope.decode(fixture.getString("publicKeySpki"),1,8192)))
            val localRaw=E2eeEnvelope.decode(fixture.getString("localRootKey"),32);val contentRaw=E2eeEnvelope.decode(fixture.getString("contentRootKey"),32)
            val roots=try{E2eeEnvelope.importRoot(localRaw) to E2eeEnvelope.importRoot(contentRaw)}finally{localRaw.fill(0);contentRaw.fill(0)}
            val reference=fixture.getJSONObject("reference").let{E2eeContentPlan.Reference(it.getString("attemptId"),it.getString("manifestHash"))};val port=ReadOnly(f,reference.attemptId,roots.first,publicKey)
            val target=fixture.getJSONObject("target").let{E2eeSourceStage.Target(it.getString("ownerId"),it.getString("scopeId"),it.getString("kind"))};val paths=fixture.getJSONArray("paths")
            val read=E2eeContentPlan.ReadOptions(port,roots.second,publicKey,E2eeEnvelope.Context.fromJson(fixture.getJSONObject("context")),target,fixture.getString("migrationId"),fixture.getString("sourceHash"),(0 until paths.length()).map{paths.getString(it)},f.inventory,f.current)
            val opened=E2eeContentPlan.open(read,reference).manifest;val logical=opened.getJSONArray("logical");assertEquals(2,logical.length());assertEquals(3L,E2eeCommands.integer(logical.getJSONObject(0).get("size")));assertEquals(0L,E2eeCommands.integer(logical.getJSONObject(1).get("size")))
            assertEquals(E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(byteArrayOf(1,2,3))),logical.getJSONObject(0).getString("plaintextHash"));assertEquals("\uFEFF\uD800-\uDFFF-α",logical.getJSONObject(0).getString("filename"))
            val entry=opened.getJSONArray("local").getJSONObject(0);val bytes=requireNotNull(port.read("local-snapshot",entry.getString("recordId")+":0")).bytes;try{assertArrayEquals(byteArrayOf(9,8,7),bytes)}finally{bytes.fill(0)}
        }
    }
    private fun id(attempt:String,suffix:String)="content-plan:$attempt:$suffix"
}
