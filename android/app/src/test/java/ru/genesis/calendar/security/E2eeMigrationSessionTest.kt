package ru.genesis.calendar.security

import kotlinx.coroutines.*
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import ru.genesis.calendar.auth.E2eeHttpBodyObservation
import ru.genesis.calendar.auth.E2eeHttpObservation
import ru.genesis.calendar.auth.E2eeRemoteOriginal
import java.util.UUID

/** Memory/JCA callback fixtures only. These do not prove coordinator CAS,
 * authenticated HTTP, device custody or provider durability. */
class E2eeMigrationSessionTest {
    private class Rig:AutoCloseable {
        val rows=linkedMapOf<String,E2eeLocalRecord>();val keys=E2eeKeys.generateDeviceKeys()
        private val raw=E2eeKeys.freshSecret();private val root=try{E2eeEnvelope.importRoot(raw)}finally{raw.fill(0)}
        val owner="session-unit-owner";val device="session-unit-device";val digest=E2eeEnvelope.encode(ByteArray(32))
        val context=E2eeMigrationSourceContext(owner,"personal:$owner",UUID.randomUUID().toString(),1,digest,2)
        val binding=E2eeMigrationPlanningBinding(owner,context.scopeId,device,digest,1,1)
        val vault=UnlockedE2eeVault(object:E2eeRecordStorage {
            override fun get(key:String)=rows[key]
            override fun list(prefix:String)=rows.keys.filter{it.startsWith(prefix)}
            override fun commit(changes:List<E2eeStorageChange>,requireOpen:()->Unit){
                requireOpen();for(change in changes)check(rows[change.key]?.serial==change.expected){"E2EE_LOCAL_CONFLICT"}
                requireOpen();for(change in changes)if(change.value==null)rows.remove(change.key)else rows[change.key]=change.value
            }
        },UnlockedE2eeVault.Scope(owner,"device:$device",device,1,1,1,"session-local-root",keys.signing.private,mapOf("session-local-root" to root)){if(it==device)keys.signing.public else null})
        val target=E2eeRemoteOriginal.Target(owner,context.scopeId,"personal")
        val capacity=E2eeRemoteOriginal.Capacity(8L*1024*1024,1000,100,4000,4*1024*1024)
        val reservations=mutableListOf<E2eeRemoteOriginal.Registration>();val completions=mutableListOf<E2eeRemoteOriginal.Reference>()
        var finished=false;var bindFailure:Exception?=null
        fun read()=E2eeRemoteOriginal.ReadOptions(vault,target,capacity,{vault.assertOpen()})
        fun hooks()=E2eeMigrationSession.Hooks(context,binding,{vault.assertOpen()},
            packet={action,page,current->current();E2eeCommands.sign(JSONObject().put("protocol",1).put("ownerId",owner).put("scopeId",context.scopeId).put("deviceId",device)
                .put("action",action).put("expectedRevision",1).put("checkpointHash",digest).put("securityEpoch",1).put("operationId",UUID.randomUUID().toString())
                .put("payload",JSONObject().put("migrationId",context.migrationId).put("fence",1).put("sourceHash",digest).apply{page?.let{value->value.keys().forEach{put(it,value.get(it))}}}),keys.signing.private)},
            original={packet,current->E2eeRemoteOriginal.Options(vault,target,capacity,packet,keys.signing.public,2,current,{}, {})},
            reserve={registration,_,current->current();reservations+=registration},
            complete={_,_,reference,current->current();bindFailure?.let{throw it};completions+=reference},
            finish={finished=true;completions.map{it.id}})
        suspend fun receive(packet:JSONObject,observation:E2eeHttpObservation):JSONObject {
            observation.prepare(E2eeHttpObservation.Request("/e2ee/v1/read","POST",packet.toString()))
            observation.begin(E2eeHttpBodyObservation.Response("/e2ee/v1/read",200,"application/json",null))
            val bytes=" {\"private\":\"SYNTHETIC ORIGINAL\"} ".toByteArray();try{observation.append(bytes)}finally{bytes.fill(0)}
            observation.finish();observation.close();return JSONObject().put("ok",true)
        }
        fun snapshot()=rows.map{(key,row)->"$key:${row.serial}:${row.envelope.toJson()}"}
        override fun close(){vault.lock()}
    }
    private suspend fun refused(work:suspend()->Unit):Throwable {try{work()}catch(error:Throwable){return error};throw AssertionError("Invalid capture accepted")}
    // Deferred.await may add a coroutine stack-trace recovery copy. Require
    // the exact original instance either directly or as that copy's cause;
    // matching only a public error message would accept an unrelated refusal.
    private fun assertRefusal(expected:Throwable,actual:Throwable){
        assertEquals(expected.javaClass,actual.javaClass);assertEquals(expected.message,actual.message)
        assertTrue("Original refusal identity missing",actual===expected||actual.cause===expected)
    }
    @Test fun completeRawOriginalBindsBeforeAParserOrHttpFailureAndCaughtFailuresStaySticky()=runBlocking {
        Rig().use{f->val failure=IllegalStateException("E2EE_INVALID_RESPONSE")
            val error=refused{E2eeMigrationSession.use(f.hooks()){session->
                session.assertBinding(f.binding)
                assertRefusal(failure,refused{session.requestLegacy(f.context,"legacy-workspace",null){packet,observation->f.receive(packet,observation);throw failure}})
            }}
            assertRefusal(failure,error);assertEquals(1,f.completions.size);assertEquals(1,f.reservations.size);assertFalse(f.finished)
            assertEquals("complete",E2eeRemoteOriginal.listOriginals(f.read()).single().phase)
        }
    }
    @Test fun failedOwnershipNeverReturnsDerivedContentEvenWhenTheConsumerCatchesItsError()=runBlocking {
        Rig().use{f->val failure=IllegalStateException("E2EE_LOCAL_CONFLICT");f.bindFailure=failure;var adopted=false
            val error=refused{E2eeMigrationSession.use(f.hooks()){session->try{session.requestLegacy(f.context,"legacy-workspace",null,f::receive);adopted=true}catch(error:Exception){assertRefusal(failure,error)}}}
            assertRefusal(failure,error);assertFalse(adopted);assertFalse(f.finished);assertEquals("complete",E2eeRemoteOriginal.listOriginals(f.read()).single().phase)
        }
    }
    @Test fun unawaitedBlockedHttpIsDrainedBeforeScopeReturnAndCannotPublishAfterRevocation()=runBlocking {
        Rig().use{f->supervisorScope{
            val external=CoroutineScope(SupervisorJob()+Dispatchers.Default);val entered=CompletableDeferred<Unit>();val release=CompletableDeferred<Unit>()
            var child:Deferred<Throwable>?=null
            try{
                val parent=async{refused{E2eeMigrationSession.use(f.hooks()){session->
                    child=external.async{refused{session.requestLegacy(f.context,"legacy-workspace",null){packet,observation->
                        observation.prepare(E2eeHttpObservation.Request("/e2ee/v1/read","POST",packet.toString()));entered.complete(Unit)
                        withContext(NonCancellable){release.await()}
                        observation.begin(E2eeHttpBodyObservation.Response("/e2ee/v1/read",200,"application/json",null));JSONObject()
                    }}};entered.await()
                }}}
                entered.await();delay(20);assertFalse(parent.isCompleted);val before=f.snapshot();release.complete(Unit)
                assertEquals("E2EE_STREAMED_REQUEST_NOT_AWAITED",parent.await().message);assertNotNull(child!!.await());assertEquals(before,f.snapshot())
                assertFalse(f.finished);assertEquals("registered",E2eeRemoteOriginal.listOriginals(f.read()).single().phase)
            }finally{release.complete(Unit);external.cancel()}
        }}
    }
    @Test fun successfulSessionReturnsTechnicalReferencesAndRevokesEscapedPorts()=runBlocking {
        Rig().use{f->var escaped:E2eeMigrationSession?=null
            val references=E2eeMigrationSession.use(f.hooks()){session->escaped=session;assertTrue(session.requestLegacy(f.context,"legacy-workspace",null,f::receive).getBoolean("ok"))}
            assertEquals(1,references.size);val before=f.snapshot()
            assertEquals("E2EE_STREAMED_SESSION_CLOSED",refused{escaped!!.requestLegacy(f.context,"legacy-workspace",null,f::receive)}.message)
            assertEquals(before,f.snapshot());assertEquals(1,f.reservations.size)
        }
    }
    @Test fun transportFailureBeforePhysicalObservationKeepsItsOriginalRefusal()=runBlocking {
        Rig().use{f->val failure=IllegalStateException("E2EE_STORAGE_CAPACITY")
            val error=refused{E2eeMigrationSession.use(f.hooks()){session->session.requestLegacy(f.context,"legacy-workspace",null){_,_->throw failure}}}
            assertRefusal(failure,error);assertEquals(1,f.reservations.size);assertTrue(f.completions.isEmpty());assertTrue(f.rows.isEmpty());assertFalse(f.finished)
        }
    }
    @Test fun caughtForeignBindingStillRefusesTheWholeSessionWithoutAnOriginalWrite()=runBlocking {
        Rig().use{f->val error=refused{E2eeMigrationSession.use(f.hooks()){session->assertEquals("E2EE_SCOPE_BINDING_MISMATCH",refused{session.assertBinding(f.binding.copy(deviceId="other-device"))}.message)}}
            assertEquals("E2EE_SCOPE_BINDING_MISMATCH",error.message);assertTrue(f.rows.isEmpty());assertFalse(f.finished)
        }
    }
    @Test fun caughtInputPreflightStillRefusesTheWholeSessionBeforePacketOrHttp()=runBlocking {
        Rig().use{f->val error=refused{E2eeMigrationSession.use(f.hooks()){session->
                assertEquals("E2EE_LEGACY_PAGE_INVALID",refused{session.requestLegacyChecked(f.context,"legacy-mindmaps",null,{throw IllegalStateException("E2EE_LEGACY_PAGE_INVALID")},f::receive)}.message)
            }}
            assertEquals("E2EE_LEGACY_PAGE_INVALID",error.message);assertTrue(f.rows.isEmpty());assertTrue(f.reservations.isEmpty());assertFalse(f.finished)
        }
    }
}
