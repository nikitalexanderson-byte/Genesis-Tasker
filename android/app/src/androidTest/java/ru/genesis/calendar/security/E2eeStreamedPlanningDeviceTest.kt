package ru.genesis.calendar.security

import android.content.ContextWrapper
import android.content.Context
import android.content.SharedPreferences
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.auth.E2eeRemoteOriginal
import ru.genesis.calendar.auth.E2eeHttpObservation
import ru.genesis.calendar.auth.E2eeHttpBodyObservation
import ru.genesis.calendar.auth.AuthSessionClient
import ru.genesis.calendar.auth.AuthProtocol
import ru.genesis.calendar.auth.AuthApiError
import ru.genesis.calendar.data.LocalCipher
import java.io.File
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.net.URL
import java.security.cert.Certificate
import javax.net.ssl.HttpsURLConnection
import java.security.MessageDigest
import java.util.UUID

/** Actual provisioned Keystore device and SQLite. Only original content and
 * the server transport are synthetic. No account restoration or product cutover. */
@RunWith(AndroidJUnit4::class)
class E2eeStreamedPlanningDeviceTest {
    private fun hash(bytes:ByteArray)=E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(bytes))
    private class Reply(private val raw:ByteArray,private val status:Int=200):HttpsURLConnection(URL("https://example.invalid/")) {
        private val input=ByteArrayInputStream(raw);private val sent=ByteArrayOutputStream();var closed=false
        override fun connect()=Unit
        override fun disconnect(){closed=true;raw.fill(0);sent.reset()}
        override fun usingProxy()=false
        override fun getCipherSuite()="TLS_SYNTHETIC_SESSION_PORT"
        override fun getLocalCertificates():Array<Certificate>?=null
        override fun getServerCertificates():Array<Certificate> = emptyArray()
        override fun getResponseCode()=status
        override fun getContentType()="application/json; charset=utf-8"
        override fun getContentLengthLong()=-1L
        override fun getHeaderFields():Map<String,List<String>> = emptyMap()
        override fun getInputStream()=input
        override fun getErrorStream()=input
        override fun getOutputStream()=sent
    }
    private class Rig:AutoCloseable {
        val app=InstrumentationRegistry.getInstrumentation().targetContext
        private val folder=File(app.noBackupFilesDir,"synthetic-streamed-${UUID.randomUUID()}").apply{check(mkdir())}
        private val stores=mutableSetOf<String>()
        private val context=object:ContextWrapper(app){override fun getApplicationContext()=this;override fun getNoBackupFilesDir()=folder
            override fun getSharedPreferences(name:String,mode:Int):SharedPreferences {val scoped="${folder.name}.$name";stores+=scoped;return app.getSharedPreferences(scoped,mode)}}
        val owner="streamed-${UUID.randomUUID()}";val scope="personal:$owner"
        val recovery=E2eeKeys.createRecoveryKit(owner)
        var device=UnlockedE2eeDevice.provision(context,owner,recovery.secret,recovery.kit)
        private val raw=E2eeKeys.freshSecret()
        private val root=try{E2eeEnvelope.importRoot(raw)}finally{raw.fill(0)}
        val inventory=E2eePrivatePaths.load(context);val required=inventory.required("personal").map{it.id}
        val target=E2eeSourceStage.Target(owner,scope,"personal")
        val sourceHash=E2eeEnvelope.encode(ByteArray(32){29})
        val directory:E2eeDirectory.Verified
        val commands=mutableListOf<JSONObject>();var discoveries=0;var fence=1L;var lost:String?=null;var didLose=false
        var expire=false;var changedSource=false;var live=true;var durable=true;var refusedAdmission=false
        var onSource:(()->Unit)?=null;var onCommand:((JSONObject,JSONObject)->Unit)?=null;var onAdmission:(()->Unit)?=null
        var inFence=false;var fenceEntries=0;var httpCalls=0;var reply=Reply("{}".toByteArray());val client:AuthSessionClient;val generation:Long
        private val receipts=mutableMapOf<String,Pair<String,JSONObject>>()
        private val sources=object:E2eeMigrationSource {
            override val requiredCoverage=required
            override val allowedContentDomains=inventory.required("personal").flatMap{it.domains}.toSet()
            override fun assertBinding(owner:String,scope:String,kind:String){check(owner==this@Rig.owner&&scope==this@Rig.scope&&kind=="personal")}
            override suspend fun captureLocal():ByteArray=error("AGGREGATE_CAPTURE_FORBIDDEN")
            override suspend fun reconcile(snapshot:ByteArray,previousSnapshots:List<ByteArray>):E2eeMigrationReconciliation=error("AGGREGATE_PLAN_FORBIDDEN")
        }
        private val transport=object:E2eeMigrationTransport {
            override suspend fun sourceHash():String {discoveries++;assertEquals(4,migration.status()!!.protocol);onSource?.invoke();return sourceHash}
            override suspend fun command(packet:JSONObject):JSONObject {
                val command=E2eeCommands.verify(packet,device.keys().signing.public);commands+=JSONObject(packet.toString())
                val id=command.getString("operationId");val hash=E2eeCommands.hash(command);onCommand?.invoke(command,packet)
                receipts[id]?.let{assertEquals(it.first,hash);return JSONObject(it.second.toString())}
                if(lost=="before"&&!didLose){didLose=true;error("SYNTHETIC_PROCESS_DEATH")}
                val result=when(command.getString("action")){
                    "migration-start"->JSONObject().put("fence",fence).put("generation",2).put("leaseUntil",System.currentTimeMillis()/1000+if(expire)-1 else 3600)
                    "migration-resume"->{check(!changedSource){"E2EE_SOURCE_CHANGED"};assertEquals(fence,command.getJSONObject("payload").getLong("fence"));fence++
                        JSONObject().put("fence",fence).put("generation",2).put("leaseUntil",System.currentTimeMillis()/1000+3600).put("pendingReceipt",JSONObject.NULL)}
                    else->error("UNEXPECTED_UPLOAD_OR_ACTIVATION")
                }
                receipts[id]=hash to JSONObject(result.toString())
                if(lost=="after"&&!didLose){didLose=true;error("SYNTHETIC_PROCESS_DEATH")};return result
            }
            override suspend fun readAll():List<E2eeEnvelope.Envelope> = error("AGGREGATE_READ_FORBIDDEN")
        }
        var migration:E2eeMigration
        init {
            check(BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug")
            val rawRoot=E2eeKeys.freshSecret();val publicKeys=E2eeKeys.publicKeys(device.keys());val keyId="streamed-root"
            val payload=JSONObject().put("kind","personal").put("resourceId",owner).put("keyId",keyId).put("generation",1).put("recoveryKit",recovery.kit).put("deviceKeys",publicKeys)
                .put("deviceCapsule",E2eeKeys.sealRoot(rawRoot,publicKeys.getString("receivingKey"),E2eeKeys.RootRecipient(owner,scope,1,keyId,device.deviceId)))
                .put("recoveryCapsule",E2eeKeys.sealRoot(rawRoot,recovery.kit.getJSONObject("authority").getString("receivingKey"),E2eeKeys.RootRecipient(owner,scope,1,keyId,"recovery")))
            rawRoot.fill(0)
            val command=JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("deviceId",device.deviceId).put("action","bootstrap")
                .put("expectedRevision",0).put("checkpointHash","genesis").put("securityEpoch",1).put("operationId",UUID.randomUUID().toString()).put("payload",payload)
            payload.put("selfProof",E2eeCommands.sign(command,device.keys().signing.private).get("signature"))
            directory=E2eeDirectory.verify(owner,scope,recovery.kit.getJSONObject("authority"),JSONArray().put(E2eeCommands.sign(command,recovery.keys.signing.private)))
            val session=JSONObject().put("cookie","syntheticCookie0123456789").put("csrf",AuthProtocol.csrf("a".repeat(48))).put("expiresAt",System.currentTimeMillis()+3600000)
            check(context.getSharedPreferences("genesis.native.auth.v1",Context.MODE_PRIVATE).edit().putString("session",LocalCipher().encrypt(session.toString(),"genesis.native.auth.v2")).commit())
            client=AuthSessionClient(context,openConnection={url->
                assertEquals("/api/e2ee/v1/read",url.path);assertTrue(inFence)
                val entry=state().getJSONObject("ownership").getJSONArray("originals").let{it.getJSONObject(it.length()-1)}
                assertTrue(entry.isNull("completion"));val id=entry.getJSONObject("registration").getString("id")
                assertEquals("registered",E2eeRemoteOriginal.listOriginals(readOptions()).first{it.id==id}.phase);httpCalls++;reply
            });generation=client.begin()
            migration=make()
        }
        private fun make()=E2eeMigration(device.vault,directory,device.deviceId,device.keys().signing.private,device.keys().signing.public,root,transport,sources,
            {check(durable){"SYNTHETIC_KEYS_NOT_DURABLE"};device.ensureDurableKeys()},object:E2eeMigrationFence{override suspend fun <T> withFence(operation:suspend()->T):T{check(!inFence){"SYNTHETIC_NONREENTRANT_FENCE"};inFence=true;fenceEntries++;try{return operation()}finally{inFence=false}}},
            {error("RECOVERY_NOT_PART_OF_PREPARATION")})
        fun options()=E2eeStreamedPlanningOptions(device,inventory,E2eeMigrationHistory.Capacity(32L*1024*1024,2000,8*1024*1024),
            E2eeRemoteOriginal.Capacity(8L*1024*1024,1000,100,4000,4*1024*1024),{check(live){"SYNTHETIC_RETIRED"}},{onAdmission?.invoke();check(!refusedAdmission){"SYNTHETIC_ADMISSION_REFUSAL"}})
        fun readOptions()=E2eeRemoteOriginal.ReadOptions(device.vault,E2eeRemoteOriginal.Target(owner,scope,"personal"),options().originalCapacity,{check(live){"SYNTHETIC_RETIRED"}})
        suspend fun stage(){migration.prepareStaged(E2eeStagedMigrationCapture(target,required){path,out->out.write("SYNTHETIC LOCAL ORIGINAL $path".toByteArray())},
            E2eeStagedMigrationOptions(E2eeSourceStage.Capacity(16L*1024*1024,1000),{},{}))}
        private fun stateId()="migration:"+E2eeEnvelope.encode(MessageDigest.getInstance("SHA-256").digest(scope.toByteArray()))
        fun row()=requireNotNull(device.vault.read("local-snapshot",stateId()))
        fun state():JSONObject {val row=row();return try{JSONObject(row.bytes.toString(Charsets.UTF_8))}finally{row.bytes.fill(0)}}
        fun snapshot():List<String> {val storage=E2eeSqliteStorage(context);return try{storage.list("").sorted().map{key->val row=requireNotNull(storage.get(key));"$key:${row.serial}:${row.envelope.toJson()}"}}finally{storage.close()}}
        fun cold(){device.lock();device=UnlockedE2eeDevice.unlock(context,owner);migration=make()}
        fun http(packet:JSONObject,observation:E2eeHttpObservation?,raw:ByteArray,status:Int=200):JSONObject {
            assertNotNull(observation);val entries=state().getJSONObject("ownership").getJSONArray("originals")
            assertTrue((0 until entries.length()).any{E2eeCommands.hash(entries.getJSONObject(it).getJSONObject("packet").getJSONObject("command"))==E2eeCommands.hash(packet.getJSONObject("command"))})
            reply=Reply(raw.copyOf(),status);return client.e2ee(generation,"/read",packet,observation)
        }
        fun capture(ticket:E2eeStreamedPlanningTicket,foreign:Boolean=false):Pair<JSONObject,E2eeRemoteOriginal> {
            val keys=if(foreign)E2eeKeys.generateDeviceKeys()else device.keys()
            val packet=E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",scope).put("deviceId",device.deviceId)
                .put("action","legacy-workspace").put("expectedRevision",directory.checkpoint.revision).put("checkpointHash",directory.checkpoint.hash).put("securityEpoch",directory.securityEpoch)
                .put("operationId",UUID.randomUUID().toString()).put("payload",JSONObject().put("migrationId",ticket.migrationId).put("fence",ticket.fence).put("sourceHash",ticket.sourceHash)),keys.signing.private)
            return packet to E2eeRemoteOriginal.create(E2eeRemoteOriginal.Options(device.vault,readOptions().target,options().originalCapacity,packet,keys.signing.public,ticket.generation,
                {check(live){"SYNTHETIC_RETIRED"}},device::ensureDurableKeys,{}))
        }
        override fun close(){client.begin();device.lock();recovery.secret.fill(0);for(store in stores)check(app.deleteSharedPreferences(store));check(folder.canonicalFile.parentFile==app.noBackupFilesDir.canonicalFile);check(folder.deleteRecursively())}
    }
    private suspend fun refused(code:String,operation:suspend()->Unit){try{operation();fail("Unprotected continuation accepted")}catch(error:Exception){assertTrue(error.message.orEmpty(),error.message.orEmpty().contains(code))}}
    private fun response(f:Rig,large:Boolean=false):ByteArray=("\uFEFF {\r\n\"checkpointHash\":\"${f.directory.checkpoint.hash}\",\"directoryRevision\":${f.directory.checkpoint.revision},\"rows\":[],\"private\":\"SYNTHETIC ORIGINAL α😀"+
        "a".repeat(if(large)512*1024+7 else 17)+"\"}\r\n").toByteArray()
    @Test fun actualAuthenticatedClientOwnsAllLegacyActionsAndColdReadsEveryBoundOriginal()=runBlocking {
        Rig().use{f->f.stage();val entries=f.fenceEntries;val actions=mutableListOf<String>();val expected=mutableListOf<Pair<String,Long>>()
            var escaped:E2eeSignedMigrationTransport?=null;var context:E2eeMigrationSourceContext?=null
            val receipt=f.migration.withStreamedPlanning(f.options()){session->
                context=session.context
                val port=E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace"),session){path,packet,observation->
                    assertEquals("/read",path);val command=E2eeCommands.verify(packet,f.device.keys().signing.public);actions+=command.getString("action")
                    val bytes=response(f,actions.size==1);expected+=hash(bytes) to bytes.size.toLong()
                    try{withContext(Dispatchers.IO){f.http(packet,observation,bytes)}}finally{bytes.fill(0)}
                };escaped=port
                port.legacyWorkspace(session.context);port.legacyAurora(session.context);port.legacyStoicheion(session.context);port.legacyAdvice(session.context)
                port.legacyTasks(session.context);port.legacyDiary(session.context);port.legacyMindmaps(session.context);port.legacyMindmapsPage(session.context,"versions",128)
                port.legacyPhysisPage(session.context,"records",128);port.legacyRemindersPage(session.context,"habitDevices",128);port.legacyArchiveFragment(session.context,"safety",0,65536)
            }
            assertEquals(entries+1,f.fenceEntries);assertFalse(f.inFence);assertEquals(11,f.httpCalls);assertEquals(10,actions.toSet().size);assertEquals(11,receipt.originals.size)
            for((index,entry)in receipt.originals.withIndex()){val ref=requireNotNull(entry.completion);assertEquals(entry.registration.id,ref.id);assertEquals(expected[index].first,ref.rawHash);assertEquals(expected[index].second,ref.size)}
            assertEquals(2,f.state().getJSONObject("ownership").getInt("protocol"));assertFalse(f.state().getBoolean("planned"));assertTrue(f.reply.closed)
            val saved=f.state();val actor=f.device.vault.localIdentity();val ownership=saved.getJSONObject("ownership");val canonical=E2eeCommands.canonical(ownership)
            val ownershipHash=try{hash(canonical)}finally{canonical.fill(0)}
            File(f.app.getExternalFilesDir(null),"streamed-session336-native-ownership.json").writeText(JSONObject().put("synthetic",true).put("metadataOnly",true)
                .put("warning","Generated fixture; no product recovery or activation proof").put("ownership",ownership).put("ownershipCanonicalHash",ownershipHash)
                .put("expected",JSONObject().put("migrationId",saved.get("migrationId")).put("target",JSONObject().put("ownerId",f.owner).put("scopeId",f.scope).put("kind","personal"))
                    .put("actor",JSONObject().put("ownerId",actor.ownerId).put("scopeId",actor.scopeId).put("deviceId",actor.deviceId)).put("sourceHash",saved.get("sourceHash"))
                    .put("lease",saved.get("lease")).put("checkpointHash",saved.get("checkpointHash")).put("directoryRevision",saved.get("directoryRevision")))
                .put("rawFixture",JSONObject().put("checkpointHash",f.directory.checkpoint.hash).put("directoryRevision",f.directory.checkpoint.revision).put("largePadding",512*1024+7).put("smallPadding",17)).toString(2))
            val before=f.snapshot();refused("E2EE_STREAMED_SESSION_CLOSED"){escaped!!.legacyWorkspace(requireNotNull(context))};assertEquals(11,f.httpCalls);assertEquals(before,f.snapshot())
            f.cold();assertEquals(receipt.ticket,f.migration.prepareStreamedPlanning(f.options()));assertEquals(before,f.snapshot())
            val plain=E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace")){_,_->error("UNOWNED_HTTP")}
            refused("E2EE_STREAMED_CAPTURE_REQUIRED"){plain.legacyWorkspace(requireNotNull(context))};assertEquals(11,f.httpCalls)
        }
    }
    @Test fun actualJsonAndHttpRefusalsStillHaveCompleteDurableOriginalBindings()=runBlocking {
        Rig().use{f->f.stage()
            for(mode in listOf("duplicate","http")){
                val bytes=if(mode=="duplicate")"\uFEFF {\"rows\":1,\"rows\":2}\r\n".toByteArray()else" {\"error\":\"E2EE_SOURCE_CHANGED\"}\r\n".toByteArray()
                val expected=hash(bytes);var callbackCaught=false
                try{
                    f.migration.withStreamedPlanning(f.options()){session->
                        val port=E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace"),session){_,packet,observation->withContext(Dispatchers.IO){f.http(packet,observation,bytes,if(mode=="http")409 else 200)}}
                        try{port.legacyWorkspace(session.context);fail("Refused response adopted")}catch(_:AuthApiError){callbackCaught=true}
                    };fail("Caught transport refusal cleared session failure")
                }catch(_:AuthApiError){}
                assertTrue(callbackCaught);val originals=f.state().getJSONObject("ownership").getJSONArray("originals");val completion=originals.getJSONObject(originals.length()-1).getJSONObject("completion")
                assertEquals(expected,completion.getString("rawHash"));assertEquals(bytes.size.toLong(),completion.getLong("size"));assertTrue(f.reply.closed);bytes.fill(0)
            }
            val before=f.snapshot();f.cold();f.migration.prepareStreamedPlanning(f.options());assertEquals(before,f.snapshot());assertEquals(2,f.httpCalls)
        }
    }
    @Test fun actualStateCasLossWithholdsDerivedDataAndColdRepairsTheExactRetainedResponse()=runBlocking {
        Rig().use{f->f.stage();var raced=false;var adopted=false
            f.onAdmission={
                val state=f.state();val originals=state.optJSONObject("ownership")?.optJSONArray("originals")
                if(!raced&&originals!=null&&originals.length()>0){
                    val owned=originals.getJSONObject(originals.length()-1);val id=owned.getJSONObject("registration").getString("id")
                    if(owned.isNull("completion")&&E2eeRemoteOriginal.listOriginals(f.readOptions()).any{it.id==id&&it.phase=="complete"}){
                        raced=true;val row=f.row();try{val stateId="migration:"+hash(f.scope.toByteArray());f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",stateId,row.bytes,row.serial)))}finally{row.bytes.fill(0)}
                    }
                }
            }
            refused("E2EE_LOCAL_CONFLICT"){f.migration.withStreamedPlanning(f.options()){session->
                val port=E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace"),session){_,packet,observation->val bytes=response(f);try{withContext(Dispatchers.IO){f.http(packet,observation,bytes)}}finally{bytes.fill(0)}}
                port.legacyWorkspace(session.context);adopted=true
            }}
            assertTrue(raced);assertFalse(adopted);assertTrue(f.state().getJSONObject("ownership").getJSONArray("originals").getJSONObject(0).isNull("completion"))
            val kept=f.snapshot().filter{it.contains("remote-original")};f.onAdmission=null;f.cold()
            val repaired=f.migration.withStreamedPlanning(f.options()){};assertNotNull(repaired.originals.single().completion);assertEquals(kept,f.snapshot().filter{it.contains("remote-original")});assertEquals(1,f.httpCalls)
        }
    }
    @Test fun changedCompletionMetadataCannotAuthorizeAnotherAuthenticatedRequest()=runBlocking {
        Rig().use{f->f.stage();f.migration.withStreamedPlanning(f.options()){session->
                val port=E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace"),session){_,packet,observation->val bytes=response(f);try{withContext(Dispatchers.IO){f.http(packet,observation,bytes)}}finally{bytes.fill(0)}}
                port.legacyWorkspace(session.context)
            }
            val state=f.state();state.getJSONObject("ownership").getJSONArray("originals").getJSONObject(0).getJSONObject("completion").put("rawHash",hash("different original".toByteArray()))
            val row=f.row();val changed=state.toString().toByteArray();try{f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot","migration:"+hash(f.scope.toByteArray()),changed,row.serial)))}finally{row.bytes.fill(0);changed.fill(0)}
            val before=f.snapshot();var entered=false;refused("E2EE_CORRUPT_STREAMED_OWNERSHIP"){f.migration.withStreamedPlanning(f.options()){entered=true}}
            assertFalse(entered);assertEquals(1,f.httpCalls);assertEquals(before,f.snapshot())
        }
    }
    @Test fun caughtPublicValidationErrorsCannotCompleteAnOwnedSession()=runBlocking {
        for(mode in listOf("directory","page"))Rig().use{f->f.stage();var caught=false
            val code=if(mode=="directory")"E2EE_DIRECTORY_CONFLICT"else"E2EE_LEGACY_PAGE_INVALID"
            refused(code){f.migration.withStreamedPlanning(f.options()){session->
                val port=E2eeSignedMigrationTransport(f.device,f.directory,setOf("workspace"),session){_,packet,observation->
                    val bytes=response(f).toString(Charsets.UTF_8).replace("\"directoryRevision\":${f.directory.checkpoint.revision}","\"directoryRevision\":${f.directory.checkpoint.revision+1}").toByteArray()
                    try{withContext(Dispatchers.IO){f.http(packet,observation,bytes)}}finally{bytes.fill(0)}
                }
                try{if(mode=="directory")port.legacyWorkspace(session.context)else port.legacyMindmapsPage(session.context,"users",0);fail("Invalid legacy result accepted")}
                catch(error:Exception){assertEquals(code,error.message);caught=true}
            }}
            assertTrue(caught);assertEquals(if(mode=="directory")1 else 0,f.httpCalls)
            val entries=f.state().getJSONObject("ownership").getJSONArray("originals");assertEquals(if(mode=="directory")1 else 0,entries.length())
            if(mode=="directory")assertFalse(entries.getJSONObject(0).isNull("completion"))
        }
    }
    @Test fun exactState3IsRetainedBeforeLeaseAndNormalRunAndCancelStayClosed()=runBlocking {
        Rig().use{f->f.stage();val before=f.row();val ticket=f.migration.prepareStreamedPlanning(f.options());val state=f.state()
            assertEquals(4,f.migration.status()!!.protocol);assertEquals("preparing",state.get("phase"));assertFalse(state.getBoolean("planned"))
            val raw=requireNotNull(f.device.vault.read("local-snapshot",state.getJSONObject("ownership").getJSONObject("sourceState").getString("objectId")))
            try{assertArrayEquals(before.bytes,raw.bytes);assertEquals(hash(raw.bytes),state.getJSONObject("ownership").getJSONObject("sourceState").get("hash"))}finally{before.bytes.fill(0);raw.bytes.fill(0)}
            assertEquals(ticket.attemptId,state.getJSONObject("ownership").get("attemptId"));val kept=f.snapshot();val calls=f.commands.size
            refused("STREAMED_PLANNER_REQUIRED"){f.migration.run()};refused("STREAMED_PLANNER_REQUIRED"){f.migration.cancel()};refused("STREAMED_SOURCE_REQUIRED"){f.migration.restart()}
            assertEquals(kept,f.snapshot());assertEquals(calls,f.commands.size)
        }
    }
    @Test fun coldLostStartBeforeAndAfterAcknowledgementRetriesExactSignedPacket()=runBlocking {
        for(loss in listOf("before","after"))Rig().use{f->f.stage();f.lost=loss;refused("SYNTHETIC_PROCESS_DEATH"){f.migration.prepareStreamedPlanning(f.options())}
            val state=f.state();val pending=state.getJSONObject("pending").toString();val attempt=state.getJSONObject("ownership").getString("attemptId");f.cold()
            val ticket=f.migration.prepareStreamedPlanning(f.options());assertEquals(attempt,ticket.attemptId);assertEquals(listOf(pending,pending),f.commands.map{it.toString()});assertTrue(f.state().isNull("pending"))
        }
    }
    @Test fun reservationPrecedesCaptureAndColdPartialDoesNotBecomeBodyProof()=runBlocking {
        Rig().use{f->f.stage();val ticket=f.migration.prepareStreamedPlanning(f.options());val (packet,capture)=f.capture(ticket)
            f.migration.reserveStreamedRemoteOriginal(capture.registration().toJson(),packet,f.options());assertTrue(E2eeRemoteOriginal.listOriginals(f.readOptions()).isEmpty())
            capture.prepare(ru.genesis.calendar.auth.E2eeHttpObservation.Request("/e2ee/v1/read","POST",packet.toString()))
            capture.begin(ru.genesis.calendar.auth.E2eeHttpBodyObservation.Response("/e2ee/v1/read",200,"application/json",null))
            capture.append("ONLY ORIGINAL PREFIX".toByteArray());capture.close();val kept=f.snapshot();f.cold()
            assertEquals(ticket,f.migration.prepareStreamedPlanning(f.options()));assertEquals(kept,f.snapshot())
            val marker=E2eeRemoteOriginal.listOriginals(f.readOptions()).single();assertEquals("receiving",marker.phase)
            assertFalse(E2eeRemoteOriginal.describeOriginal(f.readOptions(),marker.id).bodyVerified)
        }
    }
    @Test fun foreignSignerUnownedCaptureAndDuplicateReservationRefuseWithoutWrites()=runBlocking {
        for(mode in listOf("signer","unowned","duplicate"))Rig().use{f->f.stage();val ticket=f.migration.prepareStreamedPlanning(f.options());val (packet,capture)=f.capture(ticket,mode=="signer")
            val reg=capture.registration().toJson()
            if(mode=="unowned")capture.prepare(ru.genesis.calendar.auth.E2eeHttpObservation.Request("/e2ee/v1/read","POST",packet.toString()))
            if(mode=="duplicate")f.migration.reserveStreamedRemoteOriginal(reg,packet,f.options())
            val before=f.snapshot();val calls=f.commands.size
            refused(if(mode=="signer")"UNTRUSTED_COMMAND"else if(mode=="unowned")"ORIGINAL_REVIEW_REQUIRED"else"ALREADY_RESERVED"){
                if(mode=="unowned")f.migration.prepareStreamedPlanning(f.options())else f.migration.reserveStreamedRemoteOriginal(reg,packet,f.options())}
            assertEquals(before,f.snapshot());assertEquals(calls,f.commands.size);capture.close()
        }
    }
    @Test fun missingOrChangedRetainedStateNeverBecomesEmptyPreparation()=runBlocking {
        Rig().use{f->f.stage();f.migration.prepareStreamedPlanning(f.options());val state=f.state();val id=state.getJSONObject("ownership").getJSONObject("sourceState").getString("objectId")
            val row=requireNotNull(f.device.vault.read("local-snapshot",id));row.bytes.fill(0);f.device.vault.write(listOf(UnlockedE2eeVault.Write("local-snapshot",id,"{}".toByteArray(),row.serial)))
            val before=f.snapshot();val calls=f.commands.size;refused("SOURCE_HISTORY_INVALID"){f.migration.prepareStreamedPlanning(f.options())};assertEquals(before,f.snapshot());assertEquals(calls,f.commands.size)
        }
    }
    @Test fun failedKeysAndAdmissionKeepExactSourceAndRefuseBeforeNetworking()=runBlocking {
        for(mode in listOf("keys","admission"))Rig().use{f->f.stage();val before=f.snapshot();if(mode=="keys")f.durable=false else f.refusedAdmission=true
            refused(if(mode=="keys")"KEYS_NOT_DURABLE"else"ADMISSION_REFUSAL"){f.migration.prepareStreamedPlanning(f.options())}
            assertEquals(before,f.snapshot());assertEquals(0,f.discoveries);assertTrue(f.commands.isEmpty())
        }
    }
    @Test fun lateSourceStartAndRenewalRepliesDoNotAdvanceRetiredAttempt()=runBlocking {
        for(action in listOf("source","migration-start","migration-resume"))Rig().use{f->f.stage();f.expire=action=="migration-resume";var before:List<String>?=null
            if(action=="source")f.onSource={before=f.snapshot();f.live=false}else f.onCommand={command,_->if(command.get("action")==action){before=f.snapshot();f.live=false}}
            refused("SYNTHETIC_RETIRED"){f.migration.prepareStreamedPlanning(f.options())};assertEquals(before,f.snapshot());f.live=true;f.onSource=null;f.onCommand=null
            val state=f.state();val pending=if(action=="source")null else state.getJSONObject(if(action=="migration-start")"pending"else"resuming").toString();f.cold()
            f.migration.prepareStreamedPlanning(f.options());if(pending!=null)assertEquals(listOf(pending,pending),f.commands.filter{it.getJSONObject("command").get("action")==action}.map{it.toString()})
        }
    }
    @Test fun mutableTransportCannotRewriteDurableStartAndSourceChangedRenewalStaysExact()=runBlocking {
        for(mode in listOf("mutation","source-change"))Rig().use{f->f.stage()
            if(mode=="mutation"){f.lost="after";f.onCommand={_,packet->packet.getJSONObject("command").getJSONObject("payload").put("sourceHash","MUTATED");packet.put("signature","MUTATED")}}
            else{f.expire=true;f.changedSource=true}
            refused(if(mode=="mutation")"SYNTHETIC_PROCESS_DEATH"else"SOURCE_CHANGED"){f.migration.prepareStreamedPlanning(f.options())}
            val state=f.state();val name=if(mode=="mutation")"pending"else"resuming";val pending=state.getJSONObject(name).toString();val before=f.snapshot();f.onCommand=null;f.cold()
            if(mode=="mutation")f.migration.prepareStreamedPlanning(f.options())else{refused("SOURCE_CHANGED"){f.migration.prepareStreamedPlanning(f.options())};assertEquals(before,f.snapshot())}
            val action=if(mode=="mutation")"migration-start"else"migration-resume"
            assertEquals(listOf(pending,pending),f.commands.filter{it.getJSONObject("command").get("action")==action}.map{it.toString()})
        }
    }
}
