package ru.genesis.calendar.security

import kotlinx.coroutines.*
import org.json.JSONObject
import ru.genesis.calendar.auth.E2eeHttpObservation
import ru.genesis.calendar.auth.E2eeRemoteOriginal
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

internal data class E2eeMigrationPlanningBinding(val ownerId:String,val scopeId:String,val deviceId:String,
    val checkpointHash:String,val directoryRevision:Long,val securityEpoch:Long) {
    override fun toString()="E2eeMigrationPlanningBinding([redacted])"
}
/** Protocol fixtures may model this port. The authenticated product factory
 * requires the concrete coordinator-owned session and actual device below. */
internal interface E2eeMigrationPlanningPort {
    val context:E2eeMigrationSourceContext
    fun assertBinding(value:E2eeMigrationPlanningBinding)
    suspend fun requestLegacy(source:E2eeMigrationSourceContext,action:String,page:JSONObject?,
        send:suspend(JSONObject,E2eeHttpObservation)->JSONObject):JSONObject
    suspend fun requestLegacyChecked(source:E2eeMigrationSourceContext,action:String,page:JSONObject?,validate:()->Unit,
        send:suspend(JSONObject,E2eeHttpObservation)->JSONObject):JSONObject {validate();return requestLegacy(source,action,page,send)}
}

/** One awaited/revocable scope owns request reservation, complete platform HTTP
 * observation, authenticated original EOF and durable ownership binding. The
 * coordinator already holds the whole-job fence; no public lock-taking method
 * is called recursively, and no child can outlive that exclusion. */
internal class E2eeMigrationSession private constructor(private val hooks:Hooks<*>,private val scope:CoroutineScope) : E2eeMigrationPlanningPort {
    internal class Hooks<T>(val context:E2eeMigrationSourceContext,val binding:E2eeMigrationPlanningBinding,val assertCurrent:()->Unit,
        val packet:suspend(String,JSONObject?,()->Unit)->JSONObject,
        val original:(JSONObject,()->Unit)->E2eeRemoteOriginal.Options,
        val reserve:suspend(E2eeRemoteOriginal.Registration,JSONObject,()->Unit)->Unit,
        val complete:suspend(E2eeRemoteOriginal.Registration,JSONObject,E2eeRemoteOriginal.Reference,()->Unit)->Unit,
        val finish:suspend()->T)
    override val context=hooks.context.let{E2eeMigrationSourceContext(it.ownerId,it.scopeId,it.migrationId,it.fence,it.sourceHash,it.generation)}
    private val live=AtomicBoolean(true);private val accepting=AtomicBoolean(true);private val busy=AtomicBoolean(false)
    private val failure=AtomicReference<Throwable?>(null)
    private val pending=mutableSetOf<Deferred<JSONObject>>();private val observers=mutableSetOf<E2eeRemoteOriginal>()
    private fun current(){hooks.assertCurrent();check(live.get()){"E2EE_STREAMED_SESSION_CLOSED"}}
    private fun available(){current();check(accepting.get()){"E2EE_STREAMED_SESSION_CLOSED"}}
    private fun remember(error:Throwable){failure.compareAndSet(null,error)}
    override fun assertBinding(value:E2eeMigrationPlanningBinding){
        try{available();check(value==hooks.binding){"E2EE_SCOPE_BINDING_MISMATCH"}}catch(error:Throwable){remember(error);throw error}
    }
    override suspend fun requestLegacy(source:E2eeMigrationSourceContext,action:String,page:JSONObject?,send:suspend(JSONObject,E2eeHttpObservation)->JSONObject):JSONObject =
        requestLegacyChecked(source,action,page,{},send)
    override suspend fun requestLegacyChecked(source:E2eeMigrationSourceContext,action:String,page:JSONObject?,validate:()->Unit,send:suspend(JSONObject,E2eeHttpObservation)->JSONObject):JSONObject {
        val requestPage:JSONObject?;var entered=false
        try{
            available();check(busy.compareAndSet(false,true)){"E2EE_STREAMED_REQUEST_BUSY"};entered=true;validate()
            check(source.ownerId==context.ownerId&&source.scopeId==context.scopeId&&source.migrationId==context.migrationId&&source.fence==context.fence
                &&source.sourceHash==context.sourceHash&&source.generation==context.generation&&action in actions){"E2EE_SCOPE_BINDING_MISMATCH"}
            requestPage=page?.let{JSONObject(it.toString())}
        }catch(error:Throwable){if(entered)busy.set(false);remember(error);throw error}
        val task=scope.async(start=CoroutineStart.LAZY){
            val requestJob=currentCoroutineContext().job
            val requireCurrent:()->Unit={current();requestJob.ensureActive()}
            requireCurrent();val packet=JSONObject(hooks.packet(action,requestPage,requireCurrent).toString());requireCurrent()
            check(packet.getJSONObject("command").get("action")==action){"E2EE_SCOPE_BINDING_MISMATCH"}
            val options=hooks.original(packet,requireCurrent).copy(assertCurrent=requireCurrent)
            val capture=E2eeRemoteOriginal.create(options);synchronized(observers){observers+=capture}
            try{
                requireCurrent();val registration=capture.registration();hooks.reserve(registration,packet,requireCurrent);requireCurrent()
                var value:JSONObject?=null;var sendFailure:Throwable?=null
                try{value=send(JSONObject(packet.toString()),capture)}catch(error:Throwable){sendFailure=error}
                requireCurrent();val read=E2eeRemoteOriginal.ReadOptions(options.vault,options.target,options.capacity,requireCurrent)
                val descriptor=try{E2eeRemoteOriginal.describeOriginal(read,registration.id)}catch(error:Exception){
                    requireCurrent();if(sendFailure!=null&&error.message=="E2EE_REMOTE_ORIGINAL_MISSING")throw sendFailure;throw error
                };requireCurrent()
                check(descriptor.registration==registration){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
                if(descriptor.phase=="complete"){
                    val buffer=ByteArray(65536)
                    val proof=try{E2eeRemoteOriginal.withOriginal(read,registration.id){input->while(true){requireCurrent();val count=input.read(buffer);if(count<0)break;buffer.fill(0,0,count)}}}finally{buffer.fill(0)}
                    requireCurrent();check(proof.complete&&proof.manifestHash!=null&&proof.size==descriptor.size&&proof.rawHash==descriptor.rawHash&&proof.manifestHash==descriptor.manifestHash){"E2EE_CORRUPT_STREAMED_OWNERSHIP"}
                    hooks.complete(registration,packet,E2eeRemoteOriginal.Reference(proof.id,requireNotNull(proof.manifestHash),proof.rawHash,proof.size),requireCurrent);requireCurrent()
                }else check(sendFailure!=null){"E2EE_REMOTE_ORIGINAL_INCOMPLETE"}
                sendFailure?.let{throw it};JSONObject(requireNotNull(value){"E2EE_INVALID_RESPONSE"}.toString())
            }finally{capture.close();synchronized(observers){observers.remove(capture)}}
        }
        synchronized(pending){pending+=task}
        task.invokeOnCompletion{error->if(error!=null)remember(error);busy.set(false);synchronized(pending){pending.remove(task)}}
        task.start()
        try{return task.await()}catch(error:Throwable){remember(error);task.cancel();throw error}
    }
    private suspend fun close(){
        accepting.set(false);live.set(false)
        for(observer in synchronized(observers){observers.toList()})observer.close()
        val tasks=synchronized(pending){pending.toList()};tasks.forEach{it.cancel()}
        withContext(NonCancellable){for(task in tasks)try{task.await()}catch(_:Throwable){};scope.coroutineContext.job.cancelAndJoin()}
    }
    override fun toString()="E2eeMigrationSession([redacted])"
    companion object {
        private val actions=setOf("legacy-workspace","legacy-aurora","legacy-stoicheion","legacy-advice","legacy-tasks","legacy-diary","legacy-mindmaps","legacy-physis","legacy-reminders","legacy-archives","legacy-shared-mindmaps","legacy-private-path")
        suspend fun<T> use(hooks:Hooks<T>,consume:suspend(E2eeMigrationSession)->Unit):T {
            val parent=currentCoroutineContext();val owner=SupervisorJob(parent.job);val session=E2eeMigrationSession(hooks,CoroutineScope(parent+owner))
            try{
                session.current();consume(session);session.accepting.set(false);session.current()
                check(synchronized(session.pending){session.pending.isEmpty()}){"E2EE_STREAMED_REQUEST_NOT_AWAITED"}
                session.failure.get()?.let{throw it}
                val result=hooks.finish();session.current();return result
            }finally{session.close()}
        }
    }
}
