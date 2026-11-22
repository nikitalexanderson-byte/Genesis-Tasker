package ru.genesis.calendar.security

import android.content.Context
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import ru.genesis.calendar.auth.E2eeRemoteOriginal
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean
import java.util.concurrent.atomic.AtomicReference

/** Actual native owner/device composition; no activation flags or legacy
 * cleanup. The OS credential flow precedes access to E2eeDeviceVault. */
internal class E2eeProductMigrationController private constructor(private val context:Context,val device:UnlockedE2eeDevice,
    private var directory:E2eeDirectory.Verified,private val ports:Ports,private val ownsDevice:Boolean=true):java.io.Closeable{
    class Ports(val account:E2eeAccountTransport,val setup:(UnlockedE2eeDevice)->E2eeScopeSetupTransport,
        val sources:(UnlockedE2eeDevice,E2eeDirectory.Verified,E2eeLegacyReadTransport)->E2eeMigrationSources,
        val transport:(UnlockedE2eeDevice,E2eeDirectory.Verified,E2eeMigrationSources,E2eeMigrationSession?)->E2eeSignedMigrationTransport,
        val fence:(UnlockedE2eeDevice,E2eeDirectory.Verified)->E2eeProductMigrationFence,val assertCurrent:()->Unit,val assertEditorsFrozen:()->Unit)
    val target=E2eeProductMigration.Target(directory.ownerId,directory.scopeId,directory.kind,directory.resourceId)
    private val closed=AtomicBoolean();private val running=AtomicBoolean();private val operation=AtomicReference<Job?>(null)
    private fun current(){check(!closed.get()){"E2EE_UNLOCK_REQUIRED"};device.requireOpen();ports.assertCurrent();ports.assertEditorsFrozen()}
    override fun close(){if(closed.compareAndSet(false,true)){operation.get()?.cancel();if(ownsDevice)device.lock()}}
    /** A pause preserves the remote lease, journal and exact pending requests.
     * Wait for the whole-job fence before admitting another operation. */
    suspend fun stop(){operation.get()?.let{it.cancel();it.join()}}
    suspend fun run(secret:ByteArray,savedKit:JSONObject,progress:(String)->Unit={})=execute(secret,savedKit,progress,false)
    suspend fun cancel(secret:ByteArray,savedKit:JSONObject)=execute(secret,savedKit,{},true)
    private suspend fun execute(secret:ByteArray,savedKit:JSONObject,progress:(String)->Unit,cancelling:Boolean){
        val held=secret.copyOf();check(running.compareAndSet(false,true)){held.fill(0);"E2EE_MIGRATION_BUSY"}
        try{val kit=JSONObject(savedKit.toString());withContext(Dispatchers.IO){
            val job=currentCoroutineContext()[Job]?:error("E2EE_MIGRATION_JOB_REQUIRED")
            check(operation.compareAndSet(null,job)){"E2EE_MIGRATION_BUSY"}
            fun current(){job.ensureActive();this@E2eeProductMigrationController.current()}
            try{
            current();val frame=directory;val router=E2eeMigrationSourceReadRouter();val sources=ports.sources(device,frame,router);current()
            val own=frame.devices[device.deviceId];check(own!=null&&!own.revoked&&own.userId==device.ownerId&&own.role=="owner"){"E2EE_REVOKED_DEVICE"}
            val root=E2eeKeys.openRoot(own.capsule,device.keys().receiving,E2eeKeys.RootRecipient(frame.ownerId,frame.scopeId,frame.cryptoEpoch,frame.keyId,device.deviceId));current()
            E2eeScopeSetup.verifyRecovery(device,frame,root,held,kit,::current);current();val fence=ports.fence(device,frame)
            val migration=E2eeMigration(device.vault,frame,device.deviceId,device.keys().signing.private,device.keys().signing.public,root,
                ports.transport(device,frame,sources,null),sources,{current();device.ensureDurableKeys();current()},fence,
                {key->E2eeScopeSetup.verifyRecovery(device,frame,key,held,kit,::current)})
            fun admit(){current();E2eeStorageAdmission.admit(E2eeStorageAdmission.measure(device,::current),E2eeStorageAdmission.Growth(0,0,0,0),E2eeStorageAdmission.providerBudget)}
            val maximum=128L*1024*1024;val inventory=E2eePrivatePaths.load(context)
            val planning=E2eeStreamedPlanningOptions(device,inventory,E2eeMigrationHistory.Capacity(maximum,10000,maximum.toInt()),
                E2eeRemoteOriginal.readCapacity(),::current,{admit()})
            if(cancelling){
                migration.cancelStreamed(planning);current();val response=ports.setup(device).directory(frame.scopeId);current()
                val cancelled=device.rememberDirectory(frame.scopeId,device.authorityPin,response.getJSONArray("events"),device.ownerId);current()
                check(cancelled.state=="preparing"&&cancelled.kind==target.kind&&cancelled.resourceId==target.resourceId){"E2EE_DOWNGRADE_FORBIDDEN"}
                val token=fence.token()?:error("E2EE_LOCAL_FENCE_REQUIRED");current()
                fence.releaseCancelled(token,cancelled,migration::status);current();directory=cancelled;return@withContext
            }
            val content=E2eeStreamedContentPlanningOptions(planning,E2eeContentPlan.Capacity(maximum,8000,8000)){admit()}
            val options=E2eeProductMigration.Options(target,migration,sources,router,
                E2eeStagedMigrationOptions(E2eeSourceStage.Capacity(maximum,10000),::current){admit()},planning,content,
                {session->ports.transport(device,frame,sources,session)},::current,{
                    current();val response=ports.setup(device).directory(frame.scopeId);current()
                    val active=device.rememberDirectory(frame.scopeId,device.authorityPin,response.getJSONArray("events"),device.ownerId);current()
                    check(active.state=="active"&&active.kind==target.kind&&active.resourceId==target.resourceId){"E2EE_MIGRATION_UNVERIFIED"}
                    fence.activate(active);current();directory=active
                },progress)
            E2eeProductMigration.run(options,E2eePrivatePathCatalogue(context));current()
            }finally{operation.compareAndSet(job,null)}
        }}finally{held.fill(0);try{withContext(NonCancellable+Dispatchers.Main.immediate){NativeMigrationMemory.finishPrepared(device.ownerId)}}finally{running.set(false)}}
    }
    companion object{
        /** Reuse the approved owner device. Identity/status alone cannot grant
         * a migration capability; pin and device keys come from the open vault. */
        suspend fun attach(context:Context,account:E2eeProductAccount,target:E2eeProductMigration.Target,ports:Ports):E2eeProductMigrationController=withContext(Dispatchers.IO){
            fun current(){ports.assertCurrent();ports.assertEditorsFrozen();account.requireOpen();check(!account.offline&&target.ownerId==account.ownerId){"E2EE_ONLINE_REQUIRED"}}
            listOf(target.ownerId,target.scopeId,target.resourceId).forEach{E2eeKeys.technical(it)};check(target.kind in setOf("space","project")){"E2EE_SCOPE_BINDING_MISMATCH"};current()
            check(account.directory.state=="active"&&account.directory.kind=="personal"&&account.directory.ownerId==account.ownerId&&account.directory.resourceId==account.ownerId){"E2EE_PERSONAL_SCOPE_REQUIRED"}
            val scopes=account.scopeSummaries();current();check((0 until scopes.length()).map{scopes.getJSONObject(it)}.count{it.getString("scopeId")==target.scopeId&&it.getString("kind")==target.kind&&it.getString("resourceId")==target.resourceId}==1){"E2EE_SCOPE_BINDING_MISMATCH"}
            val device=account.device;val response=ports.setup(device).directory(target.scopeId);current()
            val directory=device.rememberDirectory(target.scopeId,device.authorityPin,response.getJSONArray("events"),account.ownerId);current()
            check(directory.ownerId==account.ownerId&&directory.kind==target.kind&&directory.resourceId==target.resourceId&&directory.state in setOf("preparing","uploading","verified","active")){"E2EE_SCOPE_BINDING_MISMATCH"}
            val own=directory.devices[device.deviceId];val keys=E2eeKeys.publicKeys(device.keys());current()
            check(own!=null&&!own.revoked&&own.userId==account.ownerId&&own.role=="owner"&&own.signingKey==keys.getString("signingKey")&&own.receivingKey==keys.getString("receivingKey")){"E2EE_OWNER_REQUIRED"}
            val bound=Ports(ports.account,ports.setup,ports.sources,ports.transport,ports.fence,::current,ports.assertEditorsFrozen)
            E2eeProductMigrationController(context.applicationContext,device,directory,bound,false)
        }
        private fun status(value:JSONObject,owner:String):Pair<Boolean,List<JSONObject>>{
            E2eeKeys.exact(value,setOf("pilotAllowed","cryptoProtocol","scopes"));check(value.get("pilotAllowed") is Boolean&&value.getInt("cryptoProtocol")==1){"E2EE_INVALID_RESPONSE"}
            val scopes=value.getJSONArray("scopes");check(scopes.length()<=4096){"E2EE_INVALID_RESPONSE"};val seen=mutableSetOf<String>();val personal=mutableListOf<JSONObject>()
            for(at in 0 until scopes.length()){val row=scopes.getJSONObject(at);E2eeKeys.exact(row,setOf("scopeId","kind","resourceId","state"))
                check(seen.add(E2eeKeys.technical(row.getString("scopeId")))&&row.getString("kind") in setOf("personal","project","space")
                    &&row.getString("state") in setOf("preparing","uploading","verified","active","retirement")){"E2EE_INVALID_RESPONSE"};E2eeKeys.technical(row.getString("resourceId"))
                if(row.getString("kind")=="personal"&&row.getString("resourceId")==owner)personal+=JSONObject(row.toString())
            };return Pair(value.getBoolean("pilotAllowed"),personal)
        }
        suspend fun open(context:Context,owner:String,secret:ByteArray,savedKit:JSONObject,sourceGeneration:Long,ports:Ports):E2eeProductMigrationController{
            E2eeKeys.technical(owner);val held=secret.copyOf();var device:UnlockedE2eeDevice?=null
            fun current(){ports.assertCurrent();ports.assertEditorsFrozen()}
            try{return withContext(Dispatchers.IO){
                val kit=JSONObject(savedKit.toString());current();val (pilot,personal)=status(ports.account.status(),owner);current()
                check(personal.size<=1&&(personal.isNotEmpty()||pilot)){"E2EE_PILOT_DISABLED"}
                val existed=E2eeDeviceVault(context,owner).exists();check(existed||personal.isEmpty()){"E2EE_ORIGINAL_MIGRATION_DEVICE_REQUIRED"}
                val opened=if(existed)UnlockedE2eeDevice.unlock(context,owner)else UnlockedE2eeDevice.provision(context,owner,held,kit);device=opened;current()
                fun bound(){current();opened.requireOpen()}
                val store=E2eeDeviceDocument(opened,"product-migration-setup-v1",{value->
                    E2eeKeys.exact(value,setOf("protocol","target","sourceGeneration"));val target=value.getJSONObject("target");E2eeKeys.exact(target,setOf("ownerId","scopeId","kind","resourceId"))
                    check(value.getInt("protocol")==1&&target.getString("ownerId")==owner&&target.getString("kind")=="personal"&&target.getString("resourceId")==owner
                        &&E2eeCommands.integer(value.get("sourceGeneration"))<9_007_199_254_740_991L){"E2EE_SCOPE_SETUP_INVALID"};E2eeKeys.technical(target.getString("scopeId"));JSONObject(value.toString())
                },::bound)
                var intent=store.load();bound()
                if(intent==null){
                    check(personal.isEmpty()&&pilot){"E2EE_ORIGINAL_MIGRATION_DEVICE_REQUIRED"};check(sourceGeneration in 0 until 9_007_199_254_740_991L){"E2EE_INVALID_GENERATION"}
                    val value=JSONObject().put("protocol",1).put("target",JSONObject().put("ownerId",owner).put("scopeId","personal:${UUID.randomUUID()}").put("kind","personal").put("resourceId",owner)).put("sourceGeneration",sourceGeneration)
                    store.save(value,null);bound();intent=store.load()?:error("E2EE_SCOPE_SETUP_UNVERIFIED")
                }
                val saved=requireNotNull(intent).value;check(personal.isEmpty()||personal[0].getString("scopeId")==saved.getJSONObject("target").getString("scopeId")){"E2EE_SCOPE_BINDING_MISMATCH"}
                opened.retainDeviceRecovery(held,kit,::bound);bound();val setup=E2eeScopeSetup(opened,saved.getJSONObject("target"),ports.setup(opened),::bound)
                setup.prepare(held,kit,saved.getLong("sourceGeneration"));bound();val directory=setup.submit();bound()
                E2eeProductMigrationController(context.applicationContext,opened,directory,ports)
            }}catch(error:Throwable){device?.lock();throw error}finally{held.fill(0)}
        }
    }
    override fun toString()="E2eeProductMigrationController([redacted])"
}
