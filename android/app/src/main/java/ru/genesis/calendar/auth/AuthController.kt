package ru.genesis.calendar.auth

import android.app.Activity
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.util.Log
import ru.genesis.calendar.data.withTransaction
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.GetCredentialProviderConfigurationException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import com.google.android.gms.auth.api.identity.AuthorizationRequest
import com.google.android.gms.auth.api.identity.AuthorizationResult
import com.google.android.gms.auth.api.identity.Identity
import com.google.android.gms.common.api.Scope
import com.google.android.gms.tasks.Task
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import org.json.JSONObject
import org.json.JSONArray
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.data.CloudAccountImporter
import ru.genesis.calendar.data.StoicheionDrawRepository
import ru.genesis.calendar.data.LocalPreferences
import kotlinx.coroutines.flow.first
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException
import java.util.UUID

data class AuthPanelState(
    val busy: Boolean = false,
    val ready: Boolean = false,
    val requiresSignIn: Boolean = false,
    val user: ServerIdentity? = null,
    val accountSettings: AccountSettings? = null,
    val preview: CloudWorkspacePreview.Summary? = null,
    val workspaceConflictPath: String? = null,
    val workspaceConflictPreview: WorkspaceConflictPreview? = null,
    val outgoingSyncIssue: String? = null,
    val checkedAt: Long? = null,
    val offerGoogleServices: Boolean = false,
    val message: String = "Серверная сессия ещё не проверена.",
)

private class PreferenceNotPersistedException : Exception()

/** Account entry and explicit read-only cloud inspection; local draft scope never changes here. */
class AuthController private constructor(context: Context) : SharedWorkspaceGateway {
    private val app = context.applicationContext as GenesisApplication
    private val client = AuthSessionClient(context.applicationContext)
    private var trialRefreshJob: Job? = null
    private var trialTickerJob: Job? = null
    private val trialActivationMutex = Mutex()
    private val privateVaultLifecycle=java.util.concurrent.atomic.AtomicLong()
    private val privateMigration=java.util.concurrent.atomic.AtomicReference<ru.genesis.calendar.security.E2eeProductMigrationController?>()
    private val privateMigrationSetupMutex=Mutex()
    private val privateVaultUnlockMutex=Mutex()
    private val planGuidanceLeases = java.util.concurrent.ConcurrentHashMap<String, Pair<String, Long>>()

    private fun liveAccountSettings(response: JSONObject): AccountSettings? {
        val receipt = client.liveReceipt(response)
        if (receipt?.isCurrent() == false) throw CancellationException("Authenticated profile superseded")
        val user=response.optJSONObject("user");val uid=user?.optString("uid");val accountScope=uid?.let(CloudAccountSnapshot::scopeFor)
        val settings=AccountSettings.fromResponse(response,receipt?.proof,receipt)?:return null
        return if(user?.has("privatePreferencesMode")==true&&accountScope!=null&&ru.genesis.calendar.security.NativePrivateProducts.isOpen(accountScope))
            ru.genesis.calendar.security.NativePrivateProducts.preferences(accountScope).project(settings) else settings
    }
    /** Only the independently authoritative public fields use account HTTP.
     * Category mappings, advice and layout remain inside the private vault. */
    private fun updatePreferencePayload(generation:Long,body:JSONObject):JSONObject{
        val uid=mutableState.value.user?.uid?:throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED);val accountScope=CloudAccountSnapshot.scopeFor(uid)
        if(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(accountScope))return client.updatePreferences(generation,body)
        val privateNames=setOf("advicePreferences","uiVisibility","uiLayout","syncRouting");val privatePatch=JSONObject();val publicPatch=JSONObject()
        for(key in body.keys())(if(key in privateNames)privatePatch else publicPatch).put(key,body.get(key))
        if(privatePatch.length()>0)ru.genesis.calendar.security.NativePrivateProducts.preferences(accountScope).update(privatePatch)
        return if(publicPatch.length()>0)client.updatePreferences(generation,publicPatch)else client.session(generation)
    }

    /** Activity foreground sessions are separate from persisted account entry. */
    fun onTrialForeground() {
        client.setTrialForeground(true)
        trialRefreshJob?.cancel()
        refreshTrialUi()
        val access = mutableState.value.accountSettings?.featureAccess
        if (access?.source == "trial" || access?.trial?.status == "active") refreshTrialAccess()
    }

    fun onTrialBackground() {
        privateVaultLifecycle.incrementAndGet()
        privateMigration.getAndSet(null)?.close()
        ru.genesis.calendar.security.NativePrivateProducts.lock()
        client.setTrialForeground(false)
        trialRefreshJob?.cancel()
        trialTickerJob?.cancel()
        refreshTrialUi()
    }

    fun refreshTrialAccess() {
        val initial = mutableState.value
        val uid = initial.user?.uid ?: return
        if (!client.isTrialForeground() || !initial.ready || initial.requiresSignIn || trialRefreshJob?.isActive == true) return
        val generation = client.currentGeneration()
        trialRefreshJob = scope.launch(NativeActivityVisit.requestContext()) {
            try {
                val response = withContext(Dispatchers.IO) { client.session(generation) }
                if (!client.isCurrent(generation) || mutableState.value.user?.uid != uid ||
                    app.workspaceScope != CloudAccountSnapshot.scopeFor(uid)) throw CancellationException()
                if (AuthProtocol.identity(response)?.uid != uid) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
                val settings = liveAccountSettings(response) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
                publish(generation, mutableState.value.copy(accountSettings = settings))
            } catch (cancelled: CancellationException) { throw cancelled }
            catch (failure: AuthFailure) {
                if (failure.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
                refreshTrialUi()
            } catch (_: Exception) { refreshTrialUi() }
        }
    }

    internal suspend fun startTrial(plan: String): TrialAccess = trialActivationMutex.withLock {
        require(plan in TrialAccess.plans)
        val initial = mutableState.value
        val uid = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration()
        val response = billing("POST", "/billing/trial", JSONObject().put("plan", plan))
        if (!client.isCurrent(generation) || mutableState.value.user?.uid != uid ||
            app.workspaceScope != CloudAccountSnapshot.scopeFor(uid)) throw CancellationException()
        if (AuthProtocol.identity(response)?.uid != uid) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val settings = liveAccountSettings(response) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val trial = settings.trial ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val returnedTrial = TrialAccess.fromJson(response.optJSONObject("trial"))
        require(trial.plan == plan && returnedTrial != null && trial.copy(serverNow = returnedTrial.serverNow) == returnedTrial)
        // Server already committed the one account-wide window. No order/Play call.
        publish(generation, mutableState.value.copy(accountSettings = settings))
        trial
    }

    private fun refreshTrialUi() {
        val previous = mutableState.value
        val settings = previous.accountSettings ?: return
        val access = settings.featureAccess
        if (access.trial == null) return
        val next = settings.copy(featureAccess = access.copy(trialRevision = access.trialRevision + 1))
        previous.user?.let { app.rememberFeatureAccess(CloudAccountSnapshot.scopeFor(it.uid), next.featureAccess) }
        mutableState.value = previous.copy(accountSettings = next)
    }

    private fun scheduleTrialTick() {
        trialTickerJob?.cancel()
        val initial = mutableState.value
        val uid = initial.user?.uid ?: return
        val initialAccess = initial.accountSettings?.featureAccess ?: return
        val proof = initialAccess.trialProof ?: return
        if (initialAccess.trialRemainingMillis() == null) return
        val generation = client.currentGeneration()
        trialTickerJob = scope.launch(NativeActivityVisit.requestContext()) {
            var expiredChecks = 0
            while (isActive && client.isTrialForeground() && client.isCurrent(generation) && mutableState.value.user?.uid == uid) {
                val access = mutableState.value.accountSettings?.featureAccess ?: break
                if (access.trialProof !== proof) break
                val remaining = access.trialRemainingMillis()
                if (remaining == null) { refreshTrialUi(); break }
                if (remaining == 0L) {
                    refreshTrialUi()
                    // The conservative local cutoff can precede the server boundary.
                    // Keep rights off, and retry until the server confirms expiry.
                    delay(minOf(30_000L, 1_000L shl minOf(expiredChecks, 5)))
                    refreshTrialAccess()
                    trialRefreshJob?.join()
                    expiredChecks++
                    continue
                }
                delay(minOf(remaining, 1_000L))
                if (client.isCurrent(generation) && mutableState.value.user?.uid == uid) refreshTrialUi()
            }
        }
    }
    private val sharedOffline = SharedOfflineStore(context.applicationContext)
    private val planningJournal = PlanningJournal(PlanningDraftStore(context.applicationContext))
    private val planningOperationMutex = Mutex()
    private val workflowJournal = PlanningJournal(PlanningDraftStore(context.applicationContext, "workflow"), contract = WorkflowJournalContract)
    private val workflowOperationMutex = Mutex()
    private val projectAccessJournal = PlanningJournal(PlanningDraftStore(context.applicationContext, "project-access"), contract = ProjectAccessJournalContract)
    private val projectAccessOperationMutex = Mutex()
    private val bulkJournal = PlanningJournal(PlanningDraftStore(context.applicationContext, "bulk"), contract = SharedBulkJournalContract)
    private val bulkInputStorage = PlanningDraftStore(context.applicationContext, "bulk-input")
    private val bulkInputJournal = PlanningJournal(bulkInputStorage, contract = SharedBulkInputContract)
    private val bulkOperationMutex = Mutex()
    private val templateJournal = PlanningJournal(PlanningDraftStore(context.applicationContext, "templates"), contract = SharedTemplateJournalContract)
    private val templateOperationMutex = Mutex()
    private val automationJournal = PlanningJournal(PlanningDraftStore(context.applicationContext, "automations"), contract = SharedAutomationJournalContract)
    private val automationOperationMutex = Mutex()
    private val automationEditorJournal = PlanningJournal(PlanningDraftStore(context.applicationContext, "automation-editor"), contract = SharedAutomationEditorJournalContract)
    private val automationEditorMutex = Mutex()
    private val fieldEditorJournal = PlanningJournal(PlanningDraftStore(context.applicationContext, "field-editor"), contract = CustomFieldEditorJournalContract)
    private val fieldEditorMutex = Mutex()
    private val savedViewStorage = PlanningDraftStore(context.applicationContext, "saved-views")
    private val savedViewJournal = PlanningJournal(savedViewStorage, contract = SavedViewJournalContract)
    private val savedViewMutex = Mutex()
    private val importStorage = PlanningDraftStore(context.applicationContext, "data-import")
    private val importJournal = PlanningJournal(importStorage, contract = DataImportJournalContract)
    private val importUndoJournal = DataImportUndoJournal(importStorage)
    private val importSources = DataImportBlobStore(context.applicationContext)
    private val importOperationMutex = Mutex()
    private val credentials = CredentialManager.create(context.applicationContext)
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var operation: Job? = null
    private var syncJob: Job? = null
    private var pullJob: Job? = null
    private val dataSyncMutex = Mutex()
    private val advicePreferencesMutex = Mutex()
    private val locallyDismissedAdvice = linkedSetOf<String>() // Protected by adviceNotificationGuard.
    private var pendingServicesUserId: String? = null
    private val mutableState = MutableStateFlow(AuthPanelState())
    val state = mutableState.asStateFlow()

    /** Owner/session admission for a bounded trip to a system activity. This
     * deliberately survives ordinary background vault locking; it grants no
     * vault or transport capability. The caller must require foreground again
     * before using returned material. Session/restore epochs still invalidate it. */
    internal fun privateUiOwnerGuard(uid:String,allowOffline:Boolean=false):()->Unit{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val accountScope=CloudAccountSnapshot.scopeFor(uid)
        val current={
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&(allowOffline||!mutableState.value.requiresSignIn)
                &&app.workspaceEpoch==epoch&&app.workspaceScope==accountScope){"E2EE_ACCOUNT_CHANGED"}
        }
        current();return current
    }

    internal fun privateDataExchangeOwnerGuard(uid:String):()->Unit{
        val owner=privateUiOwnerGuard(uid)
        val current={owner();(mutableState.value.accountSettings?.featureAccess?:FeatureAccess()).requireDataExchange()}
        current();return current
    }

    /** Captures the account generation once; it cannot follow a later account switch. */
    internal fun e2eeScopeTransport(uid: String): ru.genesis.calendar.security.E2eeScopeTransport {
        val generation = client.currentGeneration()
        return E2eeTransportProtocol.transport(client, generation) {
            check(client.isCurrent(generation) && mutableState.value.user?.uid == uid
                && !mutableState.value.requiresSignIn && app.workspaceScope == CloudAccountSnapshot.scopeFor(uid)) { "E2EE_ACCOUNT_CHANGED" }
        }
    }
    internal fun e2eeScopeSetupTransport(uid:String,device:ru.genesis.calendar.security.UnlockedE2eeDevice):ru.genesis.calendar.security.E2eeScopeSetupTransport{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get()
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();device.requireOpen()
            check(device.ownerId==uid&&client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn
                &&client.isTrialForeground()&&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==CloudAccountSnapshot.scopeFor(uid)){"E2EE_ACCOUNT_CHANGED"}}
        return object:ru.genesis.calendar.security.E2eeScopeSetupTransport{
            override suspend fun bootstrap(packet:JSONObject):JSONObject=withContext(Dispatchers.IO){current();check(packet.getJSONObject("command").getString("ownerId")==uid){"E2EE_SCOPE_BINDING_MISMATCH"};client.e2ee(generation,"/bootstrap",packet).also{current()}}
            override suspend fun directory(scopeId:String):JSONObject=withContext(Dispatchers.IO){current();client.e2ee(generation,"/directory",JSONObject().put("scopeId",scopeId)).also{current()}}
        }
    }
    internal suspend fun privateMigrationStatus():JSONObject{
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val generation=client.currentGeneration();val epoch=app.workspaceEpoch
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn
            &&client.isTrialForeground()&&app.workspaceEpoch==epoch&&app.workspaceScope==CloudAccountSnapshot.scopeFor(uid)){"E2EE_ACCOUNT_CHANGED"}}
        return withContext(Dispatchers.IO){current();client.e2ee(generation,"/status").also{current()}}
    }
    internal suspend fun preparePrivateMigration(secret:ByteArray,kit:JSONObject,assertEditorsFrozen:()->Unit):ru.genesis.calendar.security.E2eeProductMigrationController=privateMigrationSetupMutex.withLock{
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get()
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn
            &&client.isTrialForeground()&&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==CloudAccountSnapshot.scopeFor(uid)){"E2EE_ACCOUNT_CHANGED"}}
        current();assertEditorsFrozen();check(privateMigration.get()==null){"E2EE_MIGRATION_BUSY"}
        val account=object:ru.genesis.calendar.security.E2eeAccountTransport{
            private fun call(path:String,body:JSONObject?=null):JSONObject{current();return client.e2ee(generation,path,body).also{current()}}
            override fun status()=call("/status")
            override fun directory(scopeId:String)=call("/directory",JSONObject().put("scopeId",scopeId))
            override fun command(packet:JSONObject)=call("/command",packet)
            override fun read(packet:JSONObject)=call("/read",packet)
            override fun challenge(scopeId:String,deviceId:String,keys:JSONObject)=call("/challenge",JSONObject().put("scopeId",scopeId).put("deviceId",deviceId).put("keys",keys))
        }
        val sourceGeneration=withContext(Dispatchers.IO){current();NativeBackupEpochStore(app).accepted(CloudAccountSnapshot.scopeFor(uid))}
        var opened:ru.genesis.calendar.security.E2eeProductMigrationController?=null
        try{
            val controller=ru.genesis.calendar.security.E2eeProductMigrationController.open(app,uid,secret,kit,sourceGeneration,
                ru.genesis.calendar.security.E2eeProductMigrationController.Ports(account,{device->e2eeScopeSetupTransport(uid,device)},
                    {_,directory,ports->e2eeMountedPersonalSources(uid,directory,ports)},
                    {device,directory,sources,planning->e2eeMigrationTransport(uid,device,directory,sources,planning)},
                    {device,directory->e2eePersonalLocalFence(uid,device,directory)},::current,assertEditorsFrozen))
            opened=controller;current();check(privateMigration.compareAndSet(null,controller)){"E2EE_MIGRATION_BUSY"};current();controller
        }catch(error:Throwable){opened?.let{privateMigration.compareAndSet(it,null);it.close()};throw error}
    }
    internal fun closePrivateMigration(controller:ru.genesis.calendar.security.E2eeProductMigrationController){privateMigration.compareAndSet(controller,null);controller.close()}
    internal suspend fun prepareSharedPrivateMigration(target:ru.genesis.calendar.security.E2eeProductMigration.Target,secret:ByteArray,kit:JSONObject,assertEditorsFrozen:()->Unit):ru.genesis.calendar.security.E2eeProductMigrationController=privateMigrationSetupMutex.withLock{
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get()
        val storageScope=CloudAccountSnapshot.scopeFor(uid);val account=ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();account.requireOpen();check(target.ownerId==uid&&client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn
            &&client.isTrialForeground()&&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==storageScope
            &&ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)===account){"E2EE_ACCOUNT_CHANGED"}}
        current();assertEditorsFrozen();check(privateMigration.get()==null){"E2EE_MIGRATION_BUSY"}
        val transport=object:ru.genesis.calendar.security.E2eeAccountTransport{
            private fun call(path:String,body:JSONObject?=null):JSONObject{current();return client.e2ee(generation,path,body).also{current()}}
            override fun status()=call("/status")
            override fun directory(scopeId:String)=call("/directory",JSONObject().put("scopeId",scopeId))
            override fun command(packet:JSONObject)=call("/command",packet)
            override fun read(packet:JSONObject)=call("/read",packet)
            override fun challenge(scopeId:String,deviceId:String,keys:JSONObject)=call("/challenge",JSONObject().put("scopeId",scopeId).put("deviceId",deviceId).put("keys",keys))
        }
        var opened:ru.genesis.calendar.security.E2eeProductMigrationController?=null
        try{
            withContext(Dispatchers.IO){
                current();val rows=account.scopeSummaries();current();val known=(0 until rows.length()).map{rows.getJSONObject(it)}.filter{it.getString("kind")==target.kind&&it.getString("resourceId")==target.resourceId}
                check(known.size<=1&&(known.isEmpty()||known[0].getString("scopeId")==target.scopeId)){"E2EE_SCOPE_BINDING_MISMATCH"}
                if(known.isEmpty()){
                    val value=JSONObject().put("ownerId",uid).put("scopeId",target.scopeId).put("kind",target.kind).put("resourceId",target.resourceId)
                    val setup=ru.genesis.calendar.security.E2eeScopeSetup(account.device,value,e2eeScopeSetupTransport(uid,account.device)){current();assertEditorsFrozen()}
                    setup.prepare(secret,kit,0);current();setup.submit();current()
                }
            }
            val controller=ru.genesis.calendar.security.E2eeProductMigrationController.attach(app,account,target,
                ru.genesis.calendar.security.E2eeProductMigrationController.Ports(transport,{device->e2eeScopeSetupTransport(uid,device)},
                    {_,directory,ports->e2eeCompleteSources(uid,directory,ports,emptyList(),{ru.genesis.calendar.security.NativeMigrationMemory.localWork(uid,::current)})},
                    {device,directory,sources,planning->e2eeMigrationTransport(uid,device,directory,sources,planning)},
                    {device,directory->ru.genesis.calendar.data.NativeSharedMigrationFence(e2eePersonalLocalFence(uid,device,account.directory),uid,
                        directory.scopeId,directory.kind,directory.resourceId,{current();account.client.refresh().also{current()}},::current)},::current,assertEditorsFrozen))
            opened=controller;current();check(privateMigration.compareAndSet(null,controller)){"E2EE_MIGRATION_BUSY"};current();controller
        }catch(error:Throwable){opened?.let{privateMigration.compareAndSet(it,null);it.close()};throw error}
    }
    internal suspend fun finishSharedPrivateMigration(target:ru.genesis.calendar.security.E2eeProductMigration.Target)=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get()
        val storageScope=CloudAccountSnapshot.scopeFor(uid);val account=ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)
        fun current(){account.requireOpen();check(target.ownerId==uid&&client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn&&client.isTrialForeground()
            &&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==storageScope&&ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)===account){"E2EE_ACCOUNT_CHANGED"}}
        current();val scope=account.openSharedScope(target.scopeId,target.kind,target.resourceId,uid,account.device.authorityPin);current()
        check(scope.directory.state=="active"){"E2EE_MIGRATION_UNVERIFIED"}
        val products=ru.genesis.calendar.security.NativePrivateProducts.sharedRecords(storageScope,target.scopeId,target.kind,target.resourceId)
        products.bootstrap.prepare();current();products.bootstrap.flush();current();ru.genesis.calendar.security.E2eeSharedTrust(account).acceptOwned(scope.directory);current()
        ru.genesis.calendar.security.NativePrivateProducts.changed(storageScope)
    }
    internal fun privateSpaceCreation(uid:String,guard:()->Unit={}):ru.genesis.calendar.security.E2eePrivateResourceCreation{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get();val storageScope=CloudAccountSnapshot.scopeFor(uid)
        val account=ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)
        fun current(){guard();account.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn&&client.isTrialForeground()
            &&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==storageScope&&ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)===account){"E2EE_ACCOUNT_CHANGED"}}
        current();return ru.genesis.calendar.security.E2eePrivateResourceCreation(account,{scope->current();e2eeScopeSetupTransport(uid,account.device).directory(scope).also{current()}},::current)
    }
    internal fun privateProjectCreation(uid:String,guard:()->Unit={}):ru.genesis.calendar.security.E2eePrivateProjectCreation{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get();val storageScope=CloudAccountSnapshot.scopeFor(uid)
        val account=ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)
        fun current(){guard();account.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn&&client.isTrialForeground()
            &&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==storageScope&&ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)===account){"E2EE_ACCOUNT_CHANGED"}}
        current();return ru.genesis.calendar.security.E2eePrivateProjectCreation(app,account,{scope->current();e2eeScopeSetupTransport(uid,account.device).directory(scope).also{current()}},::current)
    }
    private fun privateDeviceAccessPorts(uid:String,guard:()->Unit):Triple<ru.genesis.calendar.security.E2eeProductAccount,ru.genesis.calendar.security.E2eeDeviceAccessPorts,()->Unit>{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get();val storageScope=CloudAccountSnapshot.scopeFor(uid)
        val account=ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid);val trust=ru.genesis.calendar.security.E2eeSharedTrust(account)
        fun current(){guard();account.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn&&client.isTrialForeground()
            &&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==storageScope&&ru.genesis.calendar.security.NativePrivateProducts.account(storageScope,uid)===account){"E2EE_ACCOUNT_CHANGED"}}
        current();val ports=object:ru.genesis.calendar.security.E2eeDeviceAccessPorts{
            private fun call(path:String,body:JSONObject):JSONObject{current();return this@AuthController.client.e2ee(generation,path,body).also{current()}}
            override fun target(scopeId:String):JSONObject{
                current();val personal=account.directory
                if(scopeId==personal.scopeId)return JSONObject().put("scopeId",scopeId).put("ownerId",uid).put("kind","personal").put("resourceId",uid).put("authority",account.device.authorityPin)
                val rows=trust.list();current();val pin=(0 until rows.length()).map{rows.getJSONObject(it)}.singleOrNull{it.get("scopeId")==scopeId}?:error("E2EE_SHARED_FINGERPRINT_REQUIRED")
                return JSONObject().put("scopeId",scopeId).put("ownerId",pin.get("ownerId")).put("kind",pin.get("kind")).put("resourceId",pin.get("resourceId")).put("authority",pin.get("authority"))
            }
            override fun client(target:JSONObject):ru.genesis.calendar.security.E2eeScopeClient{
                current();check(ru.genesis.calendar.security.E2eeProductJson.same(this.target(target.getString("scopeId")),target)){"E2EE_AUTHORITY_CHANGED"}
                if(target.get("kind")=="personal")return account.client
                val opened=trust.open(target.getString("scopeId"));current();val directory=opened.directory
                check(directory.ownerId==target.get("ownerId")&&directory.kind==target.get("kind")&&directory.resourceId==target.get("resourceId")&&ru.genesis.calendar.security.E2eeProductJson.same(directory.recoveryKit.getJSONObject("authority"),target.get("authority"))){"E2EE_AUTHORITY_CHANGED"};return opened.client
            }
            override fun directory(scopeId:String)=call("/directory",JSONObject().put("scopeId",scopeId))
            override fun challenge(target:JSONObject,deviceId:String,keys:JSONObject,requestId:String)=call("/challenge",JSONObject().put("scopeId",target.get("scopeId")).put("deviceId",deviceId).put("keys",keys).put("requestId",requestId))
            override fun command(packet:JSONObject)=call("/command",packet)
            override fun open(target:JSONObject){client(target).refresh();current();ru.genesis.calendar.security.NativePrivateProducts.changed(storageScope)}
        }
        return Triple(account,ports,::current)
    }
    private fun privateDeviceAccess(uid:String,guard:()->Unit):ru.genesis.calendar.security.E2eeDeviceAccess{
        val(account,ports,current)=privateDeviceAccessPorts(uid,guard);return ru.genesis.calendar.security.E2eeDeviceAccess(account,ports,current)
    }
    private suspend fun <T> privateDeviceAccessCall(operation:(ru.genesis.calendar.security.E2eeDeviceAccess)->T):T=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val operationJob=currentCoroutineContext().job
        operation(privateDeviceAccess(uid){operationJob.ensureActive()})
    }
    private fun privateDeviceAccessView(state:JSONObject)=JSONObject().put("state",state).put("fingerprint",if(state.isNull("request"))JSONObject.NULL else ru.genesis.calendar.security.E2eeDeviceAccessContract.fingerprint(state.getJSONObject("request")))
    private fun privateDeviceAccessInput(input:String):JSONObject{
        check(input.length<=128*1024){"E2EE_DEVICE_ACCESS_INVALID"};val bytes=input.toByteArray(Charsets.UTF_8)
        return try{check(bytes.size<=128*1024){"E2EE_DEVICE_ACCESS_INVALID"};ru.genesis.calendar.security.E2eeFileManifestJson.read(bytes)}finally{bytes.fill(0)}
    }
    internal suspend fun pendingPrivateDeviceAccess():List<JSONObject> = privateDeviceAccessCall{access->access.pending().map{row->JSONObject().put("id",row.get("id")).put("mode",row.get("mode")).put("scopeId",row.getJSONObject("target").get("scopeId")).put("complete",row.get("complete"))}}
    internal suspend fun createPrivateDeviceAccess(scopeId:String):JSONObject=privateDeviceAccessCall{access->privateDeviceAccessView(access.request(access.create(scopeId)))}
    internal suspend fun loadPrivateDeviceAccess(id:String):JSONObject=privateDeviceAccessCall{access->val state=access.inspect(id);privateDeviceAccessView(if(state.get("mode")=="request"&&state.isNull("request"))access.request(id)else state)}
    internal suspend fun approvePrivateDeviceAccess(input:String,comparedFingerprint:String):JSONObject=privateDeviceAccessCall{access->privateDeviceAccessView(access.approve(privateDeviceAccessInput(input),comparedFingerprint))}
    internal suspend fun submitPrivateDeviceAccess(id:String,input:String):JSONObject=privateDeviceAccessCall{access->if(input.isNotBlank())access.stageApproval(id,privateDeviceAccessInput(input));privateDeviceAccessView(access.submit(id))}
    private suspend fun <T> privateMembershipCall(operation:(ru.genesis.calendar.security.E2eeMembershipProduct,ru.genesis.calendar.security.E2eeMembershipOwnerReview,()->Unit)->T):T=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val job=currentCoroutineContext().job;val(account,ports,current)=privateDeviceAccessPorts(uid){job.ensureActive()};val generation=client.currentGeneration()
        val channel=object:ru.genesis.calendar.security.E2eeMembershipTransport{
            private fun call(path:String,body:JSONObject):JSONObject{current();return client.e2ee(generation,path,body).also{current()}}
            override fun membershipGraph(spaceId:String)=call("/membership-graph",JSONObject().put("spaceId",spaceId))
            override fun membershipState(targets:JSONArray)=call("/membership-state",JSONObject().put("targets",targets))
            override fun membershipPreview(intentId:String,changes:JSONArray)=call("/membership-preview",JSONObject().put("intentId",intentId).put("changes",changes))
            override fun membershipCommit(batch:JSONObject)=call("/membership",batch)
            override fun membershipAtomicBegin(input:JSONObject)=call("/membership-atomic-begin",input)
            override fun membershipAtomicPage(input:JSONObject)=call("/membership-atomic-page",input)
            override fun membershipAtomicStatus(input:JSONObject)=call("/membership-atomic-status",input)
            override fun membershipAtomicCancel(input:JSONObject)=call("/membership-atomic-cancel",input)
            override fun membershipAtomicSeal(input:JSONObject)=call("/membership-atomic-seal",input)
        }
        val peers=object:ru.genesis.calendar.security.E2eeMembershipPeerPorts{
            override fun current()=current.invoke()
            override fun target(scopeId:String)=ports.target(scopeId).also{current()}
            override fun directory(scopeId:String)=ports.directory(scopeId).also{current()}
            override fun checkpoint(scopeId:String):ru.genesis.calendar.security.E2eeDirectory.Checkpoint?{current();return account.device.savedDirectory(scopeId)?.checkpoint.also{current()}}
            override fun remember(target:JSONObject,events:JSONArray){current();val directory=account.device.rememberDirectory(target.getString("scopeId"),target.getJSONObject("authority"),events,target.getString("ownerId"));current()
                val own=directory.devices[account.device.deviceId];if(own!=null&&!own.revoked&&own.userId==uid){ports.open(target);current()}}
        }
        val product=ru.genesis.calendar.security.E2eeMembershipProduct(account.device,account.client,channel,{scopeId->val target=ports.target(scopeId);current();check(target.get("ownerId")==uid){"E2EE_OWNER_REQUIRED"};ports.client(target)},current,peers)
        val review=ru.genesis.calendar.security.E2eeMembershipOwnerReview(account,{plan->val target=ports.target(plan.getString("scopeId"));current()
            check(plan.get("ownerId")==uid&&listOf("ownerId","kind","resourceId").all{target.get(it)==plan.get(it)}){"E2EE_OWNER_REQUIRED"};ports.client(target)},current)
        operation(product,review,current).also{current()}
    }
    private fun privateMembershipInput(input:String):JSONObject{
        check(input.length<=2*1024*1024){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"};val bytes=input.toByteArray(Charsets.UTF_8)
        return try{check(bytes.size<=2*1024*1024){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"};ru.genesis.calendar.security.E2eeFileManifestJson.readMigrationHistory(bytes)}finally{bytes.fill(0)}
    }
    internal suspend fun pendingPrivateMembership():JSONObject=privateMembershipCall{product,review,current->
        val intents=JSONArray();for(id in product.pending()){val row=product.inspect(id);current();intents.put(JSONObject().put("id",id).put("scopeIds",row.get("scopeIds")).put("complete",!row.isNull("result")).put("reviewRequired",!row.has("hashFormat")||ru.genesis.calendar.security.E2eeMembershipContract.grantReviewRequired(row.getJSONArray("changes"))))}
        val reviews=JSONArray();for(row in review.list()){current();reviews.put(JSONObject().put("id",row.get("id")).put("scopeId",row.get("scopeId")).put("complete",!row.isNull("packet")))}
        JSONObject().put("intents",intents).put("ownerReviews",reviews)
    }
    internal suspend fun startPrivateMembership(changes:JSONArray,scopeIds:List<String>):JSONObject=privateMembershipCall{product,_,current->val id=product.create(changes,scopeIds);current();product.preview(id);current();product.exportReview(id)}
    internal suspend fun loadPrivateMembership(id:String):JSONObject=privateMembershipCall{product,_,current->val state=product.inspect(id);current();JSONObject().put("state",state).put("review",if(!state.isNull("preview")&&state.has("hashFormat")&&!ru.genesis.calendar.security.E2eeMembershipContract.grantReviewRequired(state.getJSONArray("changes")))product.exportReview(id)else JSONObject.NULL)}
    internal suspend fun previewPrivateMembership(id:String):JSONObject=privateMembershipCall{product,_,current->product.preview(id);current();product.exportReview(id)}
    internal suspend fun preparePrivateMembership(id:String,displayedFingerprint:String):JSONObject=privateMembershipCall{product,_,current->val view=product.exportReview(id);current();check(view.get("fingerprint")==displayedFingerprint){"E2EE_MEMBERSHIP_REVIEW_MISMATCH"}
        val plans=view.getJSONObject("request").getJSONObject("preview").getJSONArray("scopePlans");val reviews=JSONArray();for(at in 0 until plans.length()){val plan=plans.getJSONObject(at);reviews.put(JSONObject().put("scopeId",plan.get("scopeId")).put("roles",plan.get("roles")))}
        product.prepare(id,reviews).also{current()}
    }
    internal suspend fun importPrivateMembershipApproval(id:String,input:String):JSONObject=privateMembershipCall{product,_,current->product.importOwnerApproval(id,privateMembershipInput(input)).also{current()}}
    internal suspend fun approvePrivateMembershipOwner(input:String,scopeId:String,comparedFingerprint:String):JSONObject=privateMembershipCall{_,review,current->
        val request=ru.genesis.calendar.security.E2eeMembershipExchange.request(privateMembershipInput(input));val plans=request.getJSONObject("preview").getJSONArray("scopePlans");val plan=(0 until plans.length()).map{plans.getJSONObject(it)}.singleOrNull{it.get("scopeId")==scopeId}?:error("E2EE_MEMBERSHIP_REVIEW_MISMATCH")
        review.approve(request,scopeId,comparedFingerprint,JSONArray(plan.getJSONArray("roles").toString())).also{current()}
    }
    internal suspend fun exportPrivateMembershipOwner(id:String):JSONObject=privateMembershipCall{_,review,current->review.export(id).also{current()}}
    internal suspend fun submitPrivateMembership(id:String):JSONObject=privateMembershipCall{product,_,current->product.submit(id).also{current();ru.genesis.calendar.security.NativePrivateProducts.changed(app.workspaceScope)}}
    internal fun pendingPrivateCreations(uid:String):List<JSONObject> = (privateSpaceCreation(uid).pending()+privateProjectCreation(uid).pending()).map{row->
        JSONObject().put("intentId",row.get("intentId")).put("scopeId",row.get("scopeId")).put("resourceId",row.get("resourceId")).put("kind",row.get("kind"))
            .put("input",JSONObject().put("title",row.getJSONObject("input").get("title")))
    }
    internal suspend fun previewPrivateProjectCreation(id:String,refresh:Boolean=false,guard:()->Unit={}):JSONObject=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val ownerGuard=privateUiOwnerGuard(uid);val operationJob=currentCoroutineContext().job
        fun current(){operationJob.ensureActive();guard();ownerGuard()}
        val creation=privateProjectCreation(uid,::current);var intent=creation.inspect(id);current()
        if(!intent.getBoolean("started")&&(intent.isNull("topology")||refresh)){intent=creation.preview(id);current()}
        if(intent.getBoolean("started")){
            val topology=intent.getJSONObject("topology");val reviewed=topology.getJSONArray("reviewedMembers");val display=JSONArray()
            for(at in 0 until reviewed.length())display.put(JSONObject(reviewed.getJSONObject(at).toString()).put("displayName",""))
            return@withContext JSONObject().put("intent",intent).put("topologyHash",ru.genesis.calendar.security.E2eePrivateProjectCreation.topologyHash(topology)).put("members",display)
        }
        val topology=intent.getJSONObject("topology");val account=ru.genesis.calendar.security.NativePrivateProducts.account(CloudAccountSnapshot.scopeFor(uid),uid)
        val spaceId=intent.getJSONObject("input").getString("spaceId");val scopeId=topology.getJSONObject("spaceAnchor").getString("scopeId")
        ru.genesis.calendar.security.E2eeSharedTrust(account).open(scopeId);current();val response=account.sharedScope(scopeId,"space",spaceId).client.readProductContext();current()
        ru.genesis.calendar.security.E2eeKeys.exact(response,setOf("context","checkpointHash","directoryRevision"));val context=response.getJSONObject("context")
        ru.genesis.calendar.security.E2eeKeys.exact(context,setOf("ownerId","spaceId","role","spaceRole","permissions","members","invitations"))
        check(context.get("spaceId")==spaceId){"E2EE_SCOPE_BINDING_MISMATCH"};val names=mutableMapOf<String,String>();val members=context.getJSONArray("members")
        check(members.length()<=200){"E2EE_SHARED_CONTEXT_INVALID"}
        for(at in 0 until members.length()){val row=members.getJSONObject(at);val memberId=ru.genesis.calendar.security.E2eeKeys.technical(row.getString("userId"));val name=row.getString("displayName")
            check(name.length<=2000&&names.put(memberId,name)==null){"E2EE_SHARED_CONTEXT_INVALID"}}
        val reviewed=topology.getJSONArray("reviewedMembers");val display=JSONArray()
        for(at in 0 until reviewed.length()){val row=reviewed.getJSONObject(at);display.put(JSONObject(row.toString()).put("displayName",names[row.getString("userId")].orEmpty()))}
        current();JSONObject().put("intent",intent).put("topologyHash",ru.genesis.calendar.security.E2eePrivateProjectCreation.topologyHash(topology)).put("members",display)
    }
    internal suspend fun confirmPrivateProjectCreationReview(id:String,displayedHash:String,guard:()->Unit={}):JSONObject=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");privateProjectCreation(uid,guard).confirmReview(id,displayedHash);guard();previewPrivateProjectCreation(id,false,guard)
    }
    internal suspend fun resolvePrivateProjectCreation(id:String,secret:ByteArray,kit:JSONObject,guard:()->Unit):JSONObject=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");privateProjectCreation(uid,guard).resolveAndRetry(id,secret,kit).also{guard()}
    }
    internal suspend fun completePrivateSpaceCreation(id:String,secret:ByteArray,kit:JSONObject,assertEditorsFrozen:()->Unit,progress:(String)->Unit,
        controller:(ru.genesis.calendar.security.E2eeProductMigrationController?)->Unit):JSONObject=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val creation=privateSpaceCreation(uid,assertEditorsFrozen)
        val prepared=creation.prepare(id,secret,kit);assertEditorsFrozen();val intent=prepared.first;val receipt=intent.getJSONObject("preparation")
        val targets=listOf(ru.genesis.calendar.security.E2eeProductMigration.Target(uid,intent.getString("scopeId"),"space",intent.getString("resourceId")),
            ru.genesis.calendar.security.E2eeProductMigration.Target(uid,"project:${receipt.getString("inboxId")}","project",receipt.getString("inboxId")))
        for(target in targets){var opened:ru.genesis.calendar.security.E2eeProductMigrationController?=null
            try{assertEditorsFrozen();val next=prepareSharedPrivateMigration(target,secret,kit,assertEditorsFrozen);opened=next;controller(next);assertEditorsFrozen();next.run(secret,kit,progress);assertEditorsFrozen()
                closePrivateMigration(next);opened=null;controller(null);finishSharedPrivateMigration(target);assertEditorsFrozen()
            }finally{opened?.let(::closePrivateMigration);controller(null)}
        }
        creation.advance(id,"migrated");assertEditorsFrozen();val scope=CloudAccountSnapshot.scopeFor(uid)
        val products=ru.genesis.calendar.security.NativePrivateProducts.sharedRecords(scope,intent.getString("scopeId"),"space",intent.getString("resourceId"))
        creation.applyInitialValues(id,products.records);assertEditorsFrozen();creation.advance(id,"values");assertEditorsFrozen();creation.issueInvitations(id);assertEditorsFrozen()
        creation.advance(id,"invitations");assertEditorsFrozen()
        val result=ru.genesis.calendar.security.NativePrivateProducts.sharedRequest(scope,"GET","/shared/spaces/${intent.getString("resourceId")}",null);assertEditorsFrozen()
        creation.advance(id,"complete");assertEditorsFrozen();result
    }
    internal suspend fun completePrivateProjectCreation(id:String,secret:ByteArray,kit:JSONObject,assertEditorsFrozen:()->Unit,progress:(String)->Unit,
        controller:(ru.genesis.calendar.security.E2eeProductMigrationController?)->Unit):JSONObject=withContext(Dispatchers.IO){
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val creation=privateProjectCreation(uid,assertEditorsFrozen)
        val intent=creation.prepare(id,secret,kit).first;assertEditorsFrozen()
        val target=ru.genesis.calendar.security.E2eeProductMigration.Target(uid,intent.getString("scopeId"),"project",intent.getString("resourceId"))
        var opened:ru.genesis.calendar.security.E2eeProductMigrationController?=null
        try{val next=prepareSharedPrivateMigration(target,secret,kit,assertEditorsFrozen);opened=next;controller(next);assertEditorsFrozen()
            next.run(secret,kit,progress);assertEditorsFrozen();closePrivateMigration(next);opened=null;controller(null);finishSharedPrivateMigration(target);assertEditorsFrozen()
        }finally{opened?.let(::closePrivateMigration);controller(null)}
        creation.markMigrated(id);assertEditorsFrozen();creation.applyInitialValues(id);assertEditorsFrozen()
        val result=ru.genesis.calendar.security.NativePrivateProducts.sharedRequest(CloudAccountSnapshot.scopeFor(uid),"GET","/shared/projects/${intent.getString("resourceId")}",null);assertEditorsFrozen()
        creation.complete(id);assertEditorsFrozen();result
    }
    internal fun e2eeMigrationTransport(uid: String, device: ru.genesis.calendar.security.E2eeScopeDevice,
        directory: ru.genesis.calendar.security.E2eeDirectory.Verified, sources: ru.genesis.calendar.security.E2eeMigrationSource,
        planning:ru.genesis.calendar.security.E2eeMigrationSession?=null): ru.genesis.calendar.security.E2eeSignedMigrationTransport {
        val generation = client.currentGeneration()
        sources.assertBinding(directory.ownerId,directory.scopeId,directory.kind)
        check(device.ownerId == uid && directory.ownerId == uid) { "E2EE_SCOPE_BINDING_MISMATCH" }
        fun current() {
            check(client.isCurrent(generation) && mutableState.value.user?.uid == uid && !mutableState.value.requiresSignIn
                && app.workspaceScope == CloudAccountSnapshot.scopeFor(uid)) { "E2EE_ACCOUNT_CHANGED" }
        }
        suspend fun request(path:String,body:JSONObject,observation:E2eeHttpObservation?):JSONObject {
            current()
            return withContext(Dispatchers.IO) { current(); client.e2ee(generation,path,body,observation).also { current() } }.also { current() }
        }
        if(planning==null)return ru.genesis.calendar.security.E2eeSignedMigrationTransport(device,directory,sources.allowedContentDomains){path,body->request(path,body,null)}
        check(device is ru.genesis.calendar.security.UnlockedE2eeDevice){"E2EE_DEVICE_VAULT_REQUIRED"}
        return ru.genesis.calendar.security.E2eeSignedMigrationTransport(device,directory,sources.allowedContentDomains,planning,::request)
    }
    internal fun e2eeWorkspaceSource(uid: String, directory: ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport: ru.genesis.calendar.security.E2eeLegacyReadTransport,
        review: (suspend (E2eeWorkspaceReview) -> E2eeWorkspaceDecision)? = null): E2eeNativeWorkspaceSource {
        val generation=client.currentGeneration(); val accountScope=CloudAccountSnapshot.scopeFor(uid)
        check(directory.ownerId == uid && directory.kind == "personal") { "E2EE_SCOPE_BINDING_MISMATCH" }
        fun current() { check(client.isCurrent(generation) && mutableState.value.user?.uid == uid
            && !mutableState.value.requiresSignIn && app.workspaceScope == accountScope) { "E2EE_ACCOUNT_CHANGED" } }
        val cipher=ru.genesis.calendar.data.LocalCipher()
        return E2eeNativeWorkspaceSource(uid,directory.scopeId,captureRows={
            withContext(Dispatchers.IO) { app.database.withTransaction {
                current(); val dao=app.database.dao()
                val docs=listOf("cloud-base","structure","habits","trackers").mapNotNull { dao.document(accountScope,it) }
                val pending=dao.outbox(accountScope).filter { it.entityId in setOf("workspace-structure","habits","trackers") }
                val epochs=NativeBackupEpochStore(app);current(); E2eeWorkspaceRows(docs,pending,epochs.accepted(accountScope),epochs.pending(accountScope))
            } }
        },decrypt={ row -> current(); cipher.decrypt(row.encrypted,"$accountScope/${row.kind}").also { current() } },
            assertCurrent=::current,legacyWorkspace=transport::legacyWorkspace,review=review)
    }
    internal fun e2eeAuroraSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eeAuroraReconciler,
        captureMounted:suspend ()->JSONObject?):E2eeNativeAuroraSource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid)
        check(directory.ownerId==uid&&directory.kind=="personal"){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn
                &&app.workspaceScope==accountScope){"E2EE_ACCOUNT_CHANGED"}
        }
        val cipher=ru.genesis.calendar.data.LocalCipher()
        return E2eeNativeAuroraSource(uid,directory.scopeId,captureRows={
            current();val mounted=captureMounted()?.let{JSONObject(it.toString())};current()
            withContext(Dispatchers.IO){app.database.withTransaction{
                current();val dao=app.database.dao()
                val kinds=dao.documentKinds(accountScope).filter{it.startsWith("aurora-")};check(kinds.size<=1026){"E2EE_JOURNAL_LIMIT"}
                val documents=mutableListOf<ru.genesis.calendar.data.DocumentRecord>();var size=0L
                for(kind in kinds){dao.document(accountScope,kind)?.let{row->size+=row.encrypted.length;check(size<=16*1024*1024){"E2EE_SNAPSHOT_TOO_LARGE"};documents+=row}}
                val pending=dao.outbox(accountScope).filter{it.entityId.startsWith("aurora")};val epochs=NativeBackupEpochStore(app)
                current();E2eeAuroraRows(documents,pending,epochs.accepted(accountScope),epochs.pending(accountScope),mounted)
            }}
        },decrypt={row->current();val kind=if(row.kind=="aurora-account-key")"account-key" else row.kind
            cipher.decrypt(row.encrypted,"$accountScope/aurora/$uid/$kind").also{current()}},assertCurrent=::current,
            legacyAurora=transport::legacyAurora,reconciler=reconciler)
    }
    internal fun e2eeStoicheionSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        captureMounted:suspend ()->JSONObject?):E2eeNativeStoicheionSource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid)
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn
                &&app.workspaceScope==accountScope){"E2EE_ACCOUNT_CHANGED"}
        }
        val cipher=ru.genesis.calendar.data.LocalCipher()
        return E2eeNativeStoicheionSource(uid,directory.scopeId,captureRows={
            current();val mounted=captureMounted()?.let{JSONObject(it.toString())};current()
            withContext(Dispatchers.IO){app.database.withTransaction{
                current();val dao=app.database.dao()
                val kinds=dao.documentKinds(accountScope).filter{it.startsWith("stoicheion-")||it=="aurora-account-key"};check(kinds.size<=1026){"E2EE_JOURNAL_LIMIT"}
                val documents=mutableListOf<ru.genesis.calendar.data.DocumentRecord>();var size=0L
                for(kind in kinds){dao.document(accountScope,kind)?.let{row->size+=row.encrypted.length;check(size<=16*1024*1024){"E2EE_SNAPSHOT_TOO_LARGE"};documents+=row}}
                val pending=dao.outbox(accountScope).filter{it.entityId.startsWith("stoicheion")};val epochs=NativeBackupEpochStore(app)
                current();E2eeStoicheionRows(documents,pending,epochs.accepted(accountScope),epochs.pending(accountScope),mounted)
            }}
        },decrypt={row->current();val aad=if(row.kind=="aurora-account-key")"$accountScope/aurora/$uid/account-key" else "$accountScope/${row.kind}"
            cipher.decrypt(row.encrypted,aad).also{current()}},assertCurrent=::current,legacyStoicheion=transport::legacyStoicheion,reconciler=reconciler)
    }
    internal fun e2eeAdviceSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        captureMounted:suspend ()->JSONObject?):E2eeNativeAdviceSource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid)
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==accountScope){"E2EE_ACCOUNT_CHANGED"}}
        val cipher=ru.genesis.calendar.data.LocalCipher();val legacy=app.getSharedPreferences("daily_advice_day_v1",android.content.Context.MODE_PRIVATE)
        return E2eeNativeAdviceSource(uid,directory.scopeId,captureRows={
            current();val mounted=captureMounted()?.let{JSONObject(it.toString())};current()
            val preferences=requireNotNull(mutableState.value.accountSettings){"E2EE_ACCOUNT_PROFILE_REQUIRED"}.advicePreferences.toJson().toString()
            withContext(Dispatchers.IO){app.database.withTransaction{
                current();val dao=app.database.dao();val kinds=dao.documentKinds(accountScope).filter{it.startsWith("advice-")};check(kinds.size<=1026){"E2EE_JOURNAL_LIMIT"}
                val documents=mutableListOf<ru.genesis.calendar.data.DocumentRecord>();var size=0L
                for(kind in kinds){dao.document(accountScope,kind)?.let{row->size+=row.encrypted.length;check(size<=16*1024*1024){"E2EE_SNAPSHOT_TOO_LARGE"};documents+=row}}
                val pending=dao.outbox(accountScope).filter{it.entityId.startsWith("advice")};val epochs=NativeBackupEpochStore(app)
                current();E2eeAdviceRows(documents,pending,epochs.accepted(accountScope),epochs.pending(accountScope),listOf(preferences),mounted)
            }}
        },decrypt={row->current();val kind=if(row.kind.startsWith("advice-cache-history-v2:"))"advice-cache-v2" else row.kind
            cipher.decrypt(row.encrypted,"$accountScope/$kind").also{current()}},captureLegacy={known->withContext(Dispatchers.IO){
            current();val keys=legacy.all.keys.toSet();check(keys.size<=100000){"E2EE_JOURNAL_LIMIT"};val owned=linkedMapOf<String,String>();var unknown=0
            for(key in keys.sorted()){
                val match=Regex("([a-f0-9]{64})(?::seen:advice-[a-f0-9]{24})?").matchEntire(key)
                if(match!=null&&match.groupValues[1] in known)owned[key]=requireNotNull(legacy.getString(key,null)){"E2EE_ADVICE_SOURCE_CHANGED"} else unknown++
            }
            check(legacy.all.keys.toSet()==keys){"E2EE_ADVICE_SOURCE_CHANGED"};current();E2eeAdviceLegacyRows(owned,unknown)
        }},assertCurrent=::current,legacyAdvice=transport::legacyAdvice,reconciler=reconciler)
    }
    internal fun e2eeTasksSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        captureMounted:suspend ()->JSONObject?):E2eeNativeTasksSource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid);val epoch=app.workspaceEpoch
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==accountScope&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        val cipher=ru.genesis.calendar.data.LocalCipher()
        return E2eeNativeTasksSource(uid,directory.scopeId,captureRows={
            current();val mounted=captureMounted()?.let{JSONObject(it.toString())};current()
            withContext(Dispatchers.IO){app.database.withTransaction{
                current();val dao=app.database.dao();val tasks=dao.backupTasks(accountScope);val pending=dao.outbox(accountScope)
                val docs=listOfNotNull(dao.document(accountScope,"aurora-account-key"));val epochs=NativeBackupEpochStore(app)
                current();E2eeTasksRows(tasks,pending,docs,epochs.accepted(accountScope),epochs.pending(accountScope),mounted)
            }}
        },decryptTask={row->current();cipher.decrypt(row.encrypted,"$accountScope/${row.id}").also{current()}},
            decryptDocument={row->current();cipher.decrypt(row.encrypted,"$accountScope/aurora/$uid/account-key").also{current()}},
            assertCurrent=::current,legacyTasks=transport::legacyTasks,reconciler=reconciler)
    }
    internal fun e2eeDiarySource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        captureMounted:suspend ()->JSONObject?):E2eeNativeDiarySource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid);val epoch=app.workspaceEpoch
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==accountScope&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        val cipher=ru.genesis.calendar.data.LocalCipher()
        return E2eeNativeDiarySource(uid,directory.scopeId,captureRows={
            current();val mounted=captureMounted()?.let{JSONObject(it.toString())};current()
            withContext(Dispatchers.IO){app.database.withTransaction{
                current();val docs=app.database.dao().backupDocuments(accountScope).filter{it.kind.startsWith("diary-v1")||it.kind=="aurora-account-key"}
                val epochs=NativeBackupEpochStore(app);current();E2eeDiaryRows(docs,epochs.accepted(accountScope),epochs.pending(accountScope),mounted)
            }}
        },decryptCache={value->current();cipher.decrypt(value,"$accountScope/diary-v1:$uid").also{current()}},
            decryptAccountKey={row->current();cipher.decrypt(row.encrypted,"$accountScope/aurora/$uid/account-key").also{current()}},
            assertCurrent=::current,legacyDiary=transport::legacyDiary,reconciler=reconciler)
    }
    internal fun e2eeMindmapsSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        captureMounted:suspend ()->JSONObject?):E2eeNativeMindmapsSource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid);val epoch=app.workspaceEpoch
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==accountScope&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        val cipher=ru.genesis.calendar.data.LocalCipher()
        return E2eeNativeMindmapsSource(uid,directory.scopeId,captureRows={
            current();val mounted=captureMounted()?.let{JSONObject(it.toString())};current()
            withContext(Dispatchers.IO){app.database.withTransaction{current();val docs=app.database.dao().backupDocuments(accountScope).filter{it.kind.startsWith("mindmap")||it.kind=="aurora-account-key"}
                val epochs=NativeBackupEpochStore(app);current();E2eeMindmapsRows(docs,epochs.accepted(accountScope),epochs.pending(accountScope),mounted)}}
        },decrypt={row->current();cipher.decrypt(row.encrypted,if(row.kind=="aurora-account-key")"$accountScope/aurora/$uid/account-key" else "$accountScope/${row.kind}").also{current()}},
            assertCurrent=::current,legacyMindmaps={context->ru.genesis.calendar.security.E2eeLegacyPersonalPages.collect(context,"mindmaps",::current,transport::legacyMindmapsPage)},reconciler=reconciler)
    }
    internal fun e2eePhysisSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        independentUnlock:suspend (JSONObject)->E2eePhysisCredential?={null}):E2eeNativePhysisSource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid);val epoch=app.workspaceEpoch
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==accountScope&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        val cipher=ru.genesis.calendar.data.LocalCipher()
        return E2eeNativePhysisSource(uid,directory.scopeId,captureRows={withContext(Dispatchers.IO){app.database.withTransaction{
            current();val docs=app.database.dao().backupDocuments(accountScope).filter{it.kind.startsWith("physis")||it.kind=="aurora-account-key"}
            val epochs=NativeBackupEpochStore(app);current();E2eePhysisRows(docs,epochs.accepted(accountScope),epochs.pending(accountScope))
        }}},decrypt={row->current();cipher.decrypt(row.encrypted,"$accountScope/aurora/$uid/account-key").also{current()}},
            assertCurrent=::current,legacyPhysis={context->ru.genesis.calendar.security.E2eeLegacyPersonalPages.collect(context,"physis",::current,transport::legacyPhysisPage)},
            reconciler=reconciler,independentUnlock=independentUnlock)
    }
    internal fun e2eeRemindersSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        captureMounted:suspend ()->JSONObject?):E2eeNativeRemindersSource {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid);val epoch=app.workspaceEpoch
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==accountScope&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        return E2eeNativeRemindersSource(uid,directory.scopeId,captureRows={
            current();val mounted=captureMounted()?.let{JSONObject(it.toString())};current()
            withContext(Dispatchers.IO){
                val local=ru.genesis.calendar.data.LocalPreferences(app,accountScope).reminderMigrationRaw();current()
                val preferences=ru.genesis.calendar.reminders.reminderMigrationRegistries(app);current()
                val rows=app.database.withTransaction{current();app.database.dao().reminders(accountScope)};current()
                check(workspaceConflictJson(preferences)==workspaceConflictJson(ru.genesis.calendar.reminders.reminderMigrationRegistries(app))){"E2EE_REMINDER_CAPTURE_CHANGED"}
                val epochs=NativeBackupEpochStore(app);current();E2eeRemindersRows(rows,preferences,local,epochs.accepted(accountScope),epochs.pending(accountScope),mounted)
            }
        },assertCurrent=::current,legacyReminders={context->ru.genesis.calendar.security.E2eeLegacyPersonalPages.collect(context,"reminders",::current,transport::legacyRemindersPage)},reconciler=reconciler)
    }
    /** Exact protected input only; not an archives adapter or restore authority.
     * The complete coordinator must persist it under the new root before IO. */
    internal fun e2eeArchivesLocalCapture(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified):suspend ()->ByteArray {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid);val epoch=app.workspaceEpoch
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==accountScope&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        return {withContext(Dispatchers.IO){
            current();val revision=app.backupMigrationMemory.version();val forms=app.backupMigrationMemory.capture(uid,epoch)
            val history=app.getSharedPreferences("genesis.backup.history.v1",android.content.Context.MODE_PRIVATE)
            val originalHistory=history.getString(uid,null)
            val result=app.database.withTransaction{
                current();val safety=app.database.dao().backupDocuments(accountScope).filter{it.kind.startsWith("backup-safety:")}
                check(safety.size<=10000){"E2EE_SOURCE_TOO_LARGE"}
                val epochs=NativeBackupEpochStore(app)
                JSONObject().put("protocol",1).put("ownerId",uid).put("scopeId",directory.scopeId).put("capturedAt",java.time.Instant.now().toString())
                    .put("platform","android").put("inventoryVersion",1).put("generation",epochs.accepted(accountScope))
                    .put("pendingGeneration",epochs.pending(accountScope)?:JSONObject.NULL).put("history",originalHistory?:JSONObject.NULL)
                    .put("protectedState",ru.genesis.calendar.data.BackupSafetyStore(app,accountScope,::current).captureRaw().toString())
                    .put("safety",org.json.JSONArray(safety.map{row->JSONObject().put("scope",row.scope).put("kind",row.kind).put("encrypted",row.encrypted).put("revision",row.revision)}))
                    .put("forms",forms)
            }
            current();check(app.backupMigrationMemory.version()==revision&&history.getString(uid,null)==originalHistory){"E2EE_ARCHIVE_CAPTURE_CHANGED"}
            val bytes=ru.genesis.calendar.data.backupJsonUtf8(result.toString())
            try{current();check(bytes.size<=48*1024*1024){"E2EE_SNAPSHOT_TOO_LARGE"};bytes}catch(error:Throwable){bytes.fill(0);throw error}
        }}
    }
    internal fun e2eeArchivesSource(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        independentUnlock:suspend(JSONObject)->E2eePhysisCredential?={null}):E2eeNativeArchivesSource {
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val account=CloudAccountSnapshot.scopeFor(uid)
        check(directory.ownerId==uid&&directory.kind=="personal"&&directory.resourceId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        return E2eeNativeArchivesSource(uid,directory.scopeId,e2eeArchivesLocalCapture(uid,directory),::current,
            {lease->ru.genesis.calendar.security.E2eeLegacyArchiveFragments.collect(lease,::current,transport::legacyArchiveFragment)},reconciler,
            {lease->ru.genesis.calendar.security.E2eeLegacyPersonalPages.collect(lease,"physis",::current,transport::legacyPhysisPage)},independentUnlock)
    }
    internal fun e2eeRelationalSources(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,reconciler:E2eePersonalSourceReconciler,
        captureMounted:suspend()->JSONObject):List<E2eeNativeRelationalSource>{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val account=CloudAccountSnapshot.scopeFor(uid)
        check(directory.ownerId==uid){"E2EE_SCOPE_BINDING_MISMATCH"}
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        val inventory=ru.genesis.calendar.security.E2eePrivatePaths.load(app);val catalogue=ru.genesis.calendar.security.E2eePrivatePathCatalogue(app)
        return inventory.required(directory.kind).filter{directory.kind!="personal"||it.id=="personal.local-work"}.map{path->
            E2eeNativeRelationalSource(uid,directory.scopeId,directory.kind,directory.resourceId,path.id,catalogue.tables(directory.kind,path.id),{
                current()
                if(path.id.endsWith(".local-work")){
                    val mounted=JSONObject(captureMounted().toString());current()
                    withContext(Dispatchers.IO){NativeLocalWorkInventory.capture(app,app.database,uid,directory.kind,directory.resourceId,mounted,::current)}
                }else JSONObject().put("platform","android").put("inventoryVersion",1).put("entries",org.json.JSONArray()).put("editors",org.json.JSONArray())
            },::current,transport,reconciler)
        }
    }
    internal fun e2eeCompleteSources(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,existingPersonal:List<ru.genesis.calendar.security.E2eePrivatePathAdapter>,
        captureMounted:suspend()->JSONObject,independentPhysisUnlock:suspend(JSONObject)->E2eePhysisCredential?={null}):ru.genesis.calendar.security.E2eeMigrationSources{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val account=CloudAccountSnapshot.scopeFor(uid)
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(directory.ownerId==uid&&client.isCurrent(generation)&&mutableState.value.user?.uid==uid
            &&!mutableState.value.requiresSignIn&&app.workspaceScope==account&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        current();val inventory=ru.genesis.calendar.security.E2eePrivatePaths.load(app)
        val expected=inventory.required("personal").map{it.id}.filter{it !in setOf("personal.archives","personal.local-work")}.toSet()
        check(if(directory.kind=="personal")existingPersonal.size==expected.size&&existingPersonal.map{it.id}.toSet()==expected else existingPersonal.isEmpty()){"E2EE_SOURCE_ADAPTER_REQUIRED"}
        val all=existingPersonal.toMutableList()
        if(directory.kind=="personal")all+=e2eeArchivesSource(uid,directory,transport,ru.genesis.calendar.ui.NativeArchivesSourceRuntime(app),independentPhysisUnlock)
        all+=e2eeRelationalSources(uid,directory,transport,ru.genesis.calendar.ui.NativeRelationalSourceRuntime(app),captureMounted)
        val registry=ru.genesis.calendar.security.E2eeMigrationSources(uid,directory.scopeId,directory.kind,inventory)
        for(adapter in all)registry.registerIntegrated(adapter,::current)
        registry.stagedCapture();registry.stagedReconciliation();return registry
    }
    internal fun e2eeMountedPersonalSources(uid:String,directory:ru.genesis.calendar.security.E2eeDirectory.Verified,
        transport:ru.genesis.calendar.security.E2eeLegacyReadTransport,
        independentPhysisUnlock:suspend(JSONObject)->E2eePhysisCredential?={null}):ru.genesis.calendar.security.E2eeMigrationSources{
        val generation=client.currentGeneration();val epoch=app.workspaceEpoch;val lifecycle=privateVaultLifecycle.get()
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen();check(directory.kind=="personal"&&directory.ownerId==uid&&directory.resourceId==uid
            &&client.isCurrent(generation)&&mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn&&client.isTrialForeground()
            &&privateVaultLifecycle.get()==lifecycle&&app.workspaceEpoch==epoch&&app.workspaceScope==CloudAccountSnapshot.scopeFor(uid)){"E2EE_ACCOUNT_CHANGED"}}
        current()
        suspend fun mounted(kind:String)=ru.genesis.calendar.security.NativeMigrationMemory.content(uid,kind,::current)
        val adapters=listOf<ru.genesis.calendar.security.E2eePrivatePathAdapter>(
            e2eeWorkspaceSource(uid,directory,transport),
            e2eeTasksSource(uid,directory,transport,ru.genesis.calendar.ui.NativeTasksSourceRuntime(app)){mounted("tasks")},
            e2eeDiarySource(uid,directory,transport,ru.genesis.calendar.ui.NativeDiarySourceRuntime(app)){mounted("diary")},
            e2eeMindmapsSource(uid,directory,transport,ru.genesis.calendar.ui.NativeMindmapsSourceRuntime(app)){mounted("mindmaps")},
            e2eePhysisSource(uid,directory,transport,ru.genesis.calendar.ui.NativePhysisSourceRuntime(app),independentPhysisUnlock),
            e2eeRemindersSource(uid,directory,transport,ru.genesis.calendar.ui.NativeRemindersSourceRuntime(app)){mounted("reminders")},
            e2eeAuroraSource(uid,directory,transport,ru.genesis.calendar.ui.NativeAuroraSourceRuntime(app)){mounted("aurora")},
            e2eeStoicheionSource(uid,directory,transport,ru.genesis.calendar.ui.NativeStoicheionSourceRuntime(app)){mounted("stoicheion")},
            e2eeAdviceSource(uid,directory,transport,ru.genesis.calendar.ui.NativeAdviceSourceRuntime(app)){mounted("advice")},
        )
        return e2eeCompleteSources(uid,directory,transport,adapters,{ru.genesis.calendar.security.NativeMigrationMemory.localWork(uid,::current)},independentPhysisUnlock)
    }
    fun privateVaultDeviceExists(uid:String):Boolean=ru.genesis.calendar.security.E2eeDeviceVault(app,uid).exists()
    /** Called after Android's credential confirmation. Recovery input is kept
     * in this call only; the server receives signed public enrollment proofs. */
    suspend fun unlockPrivateVault(secretText:String?=null,recoveryKit:JSONObject?=null,offline:Boolean=false,restoreHardware:Boolean=false){
        val secret=secretText?.takeIf{it.isNotBlank()}?.let{ru.genesis.calendar.security.E2eeEnvelope.decode(it.trim(),32)}
        try{unlockPrivateVaultMaterial(secret,recoveryKit,offline,restoreHardware){}}finally{secret?.fill(0)}
    }
    internal suspend fun unlockPrivateVaultMaterial(recoverySecret:ByteArray?,recoveryKit:JSONObject?,offline:Boolean,restoreHardware:Boolean,assertAdmission:()->Unit)=privateVaultUnlockMutex.withLock{
        assertAdmission();check(recoverySecret==null||recoverySecret.size==32){"E2EE_RECOVERY_KIT_REQUIRED"}
        val identity=mutableState.value.user?:error("E2EE_ACCOUNT_BINDING_REQUIRED")
        check(identity.privateVault&&(offline||!mutableState.value.requiresSignIn)&&(!restoreHardware||!offline)){"E2EE_ACCOUNT_BINDING_REQUIRED"}
        val uid=identity.uid;val epoch=app.workspaceEpoch;val generation=client.currentGeneration();var opened:ru.genesis.calendar.security.E2eeProductAccount?=null
        val adopted=java.util.concurrent.atomic.AtomicBoolean(false)
        val admission=java.util.concurrent.atomic.AtomicReference<(() -> Unit)?>(assertAdmission)
        val lifecycle=privateVaultLifecycle.get()
        fun current(){admission.get()?.invoke();ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(generation)&&client.isTrialForeground()&&privateVaultLifecycle.get()==lifecycle&&mutableState.value.user?.uid==uid&&(offline||!mutableState.value.requiresSignIn)
            &&app.workspaceScope==CloudAccountSnapshot.scopeFor(uid)&&app.workspaceEpoch==epoch){"E2EE_ACCOUNT_CHANGED"}}
        val secret=recoverySecret?.copyOf()
        val transport=object:ru.genesis.calendar.security.E2eeAccountTransport{
            private fun call(path:String,body:JSONObject?=null):JSONObject{current();check(!offline){"E2EE_REFRESH_REQUIRED"};return client.e2ee(generation,path,body).also{current()}}
            override fun status()=call("/status")
            override fun directory(scopeId:String)=call("/directory",JSONObject().put("scopeId",scopeId))
            override fun command(packet:JSONObject)=call("/command",packet)
            override fun read(packet:JSONObject)=call("/read",packet)
            override fun challenge(scopeId:String,deviceId:String,keys:JSONObject)=call("/challenge",JSONObject().put("scopeId",scopeId).put("deviceId",deviceId).put("keys",keys))
            override val membership=object:ru.genesis.calendar.security.E2eeMembershipTransport{
                override fun membershipGraph(spaceId:String)=call("/membership-graph",JSONObject().put("spaceId",spaceId))
                override fun membershipState(targets:JSONArray)=call("/membership-state",JSONObject().put("targets",targets))
                override fun membershipPreview(intentId:String,changes:JSONArray)=call("/membership-preview",JSONObject().put("intentId",intentId).put("changes",changes))
                override fun membershipCommit(batch:JSONObject)=call("/membership",batch)
                override fun membershipAtomicBegin(input:JSONObject)=call("/membership-atomic-begin",input)
                override fun membershipAtomicPage(input:JSONObject)=call("/membership-atomic-page",input)
                override fun membershipAtomicStatus(input:JSONObject)=call("/membership-atomic-status",input)
                override fun membershipAtomicCancel(input:JSONObject)=call("/membership-atomic-cancel",input)
                override fun membershipAtomicSeal(input:JSONObject)=call("/membership-atomic-seal",input)
            }
        }
        try{val loaded=withContext(Dispatchers.IO){
            current();val account=if(offline)ru.genesis.calendar.security.E2eeProductAccount.openOffline(app,uid,transport,::current)
                else ru.genesis.calendar.security.E2eeProductAccount.open(app,uid,transport,::current,secret,recoveryKit,restoreHardware);opened=account
            val product=ru.genesis.calendar.security.E2eePersonalProduct(account);product.load(offline);current()
            val preferences=ru.genesis.calendar.security.E2eePrivatePreferences(app,account);preferences.load();current()
            Triple(account,product,preferences)
        };current();val settings=mutableState.value.accountSettings?:withContext(Dispatchers.IO){current();CachedAccountEntry(app).read(CloudAccountSnapshot.scopeFor(uid))?.settings.also{current()}}
        withContext(Dispatchers.Main.immediate){
            current();val projected=settings?.let(loaded.third::project);current();val prior=mutableState.value
            // No suspension between adoption and final UI publication: attaching
            // may unmount the unlock view and cancel its composition scope.
            ru.genesis.calendar.security.NativePrivateProducts.attach(loaded.first,loaded.second,loaded.third)
            client.bindPrivateProduct(generation,uid)
            mutableState.value=prior.copy(ready=true,busy=false,outgoingSyncIssue=null,accountSettings=projected)
            // Subsequent account use keeps its owner/session/lifecycle guards,
            // independent of the now-retired unlock view and one-shot request.
            adopted.set(true)
            admission.set(null)
        }
        }catch(error:Throwable){if(!adopted.get())opened?.close();throw error}finally{secret?.fill(0)}
    }
    internal fun e2eePersonalLocalFence(uid: String, device: ru.genesis.calendar.security.E2eeScopeDevice,
        directory: ru.genesis.calendar.security.E2eeDirectory.Verified): ru.genesis.calendar.data.NativeLegacyScopeFence {
        val generation=client.currentGeneration();val accountScope=CloudAccountSnapshot.scopeFor(uid)
        check(device.ownerId == uid && directory.ownerId == uid && directory.kind == "personal") { "E2EE_SCOPE_BINDING_MISMATCH" }
        return ru.genesis.calendar.data.NativeLegacyScopeFence(app.database,uid,directory.scopeId,{
            ru.genesis.calendar.security.UpdateGate.requireOpen();device.requireOpen()
            check(client.isCurrent(generation) && mutableState.value.user?.uid == uid && !mutableState.value.requiresSignIn
                && app.workspaceScope == accountScope) { "E2EE_ACCOUNT_CHANGED" }
        })
    }
    private val mutableTaskSync = MutableStateFlow(AccountTaskSyncState())
    val taskSync = mutableTaskSync.asStateFlow()
    internal fun privateDriveGateway(uid:String):PrivateDriveGateway{
        val generation=client.currentGeneration();val ownerGuard=privateUiOwnerGuard(uid)
        return object:PrivateDriveGateway{
            override fun current(){ownerGuard();check(client.isCurrent(generation)){"E2EE_ACCOUNT_CHANGED"}}
            override fun request(path:String,body:JSONObject?,call:ForegroundAccountCall?):JSONObject{
                current();return client.privateDrive(generation,uid,"/private-drive/v1/$path",body,call).also{current()}
            }
        }
    }
    internal fun backupGateway(uid: String): ru.genesis.calendar.data.BackupGateway = object : ru.genesis.calendar.data.BackupGateway {
        private val capturedGeneration=client.currentGeneration()
        private val capturedEpoch=app.workspaceEpoch
        override fun check() {
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            check(client.isCurrent(capturedGeneration)&&app.workspaceEpoch==capturedEpoch&&!mutableState.value.requiresSignIn&&
                mutableState.value.user?.uid==uid && app.workspaceScope==CloudAccountSnapshot.scopeFor(uid)) { "BACKUP_OWNER" }
        }
        override suspend fun request(method: String,path: String,body: JSONObject?): JSONObject {
            check()
            return withContext(Dispatchers.IO) { client.backup(capturedGeneration,method,path,body) }.also { check() }
        }
        override suspend fun quiesce() {
            check()
            // Retire all old HTTP clients and stop account jobs before releasing the old caches.
            NativeBackupEpoch.retireTransports();client.begin()
            syncJob?.cancelAndJoin();pullJob?.cancelAndJoin();operation?.cancelAndJoin()
            withContext(Dispatchers.IO) { app.scheduler.deactivate(app.workspaceScope) }
            withContext(Dispatchers.Main.immediate) {
                synchronized(Companion) { if(instance===this@AuthController)instance=null }
                scope.cancel()
            }
        }
    }
    private suspend fun importBackupSafe(snapshot: CloudAccountSnapshot,generation:Long): CloudAccountImporter.Result {
        val uid=mutableState.value.user?.uid?:throw AuthApiError("E2EE_ACCOUNT_CHANGED")
        fun current(){ru.genesis.calendar.security.UpdateGate.requireOpen()
            if(!client.isCurrent(generation)||mutableState.value.user?.uid!=uid||mutableState.value.requiresSignIn||snapshot.scope!=CloudAccountSnapshot.scopeFor(uid))throw AuthApiError("E2EE_ACCOUNT_CHANGED")}
        current()
        val epochs=NativeBackupEpochStore(app)
        epochs.pending(snapshot.scope)?.let { generation ->
            val safety=ru.genesis.calendar.data.BackupSafetyStore(app,snapshot.scope,::current)
            safety.protectCurrent()
            if(safety.hasLocalState())return CloudAccountImporter.Result.PENDING_LOCAL_CHANGES
            // A proven-empty installation has no queue/cache to reconcile. Existing
            // devices still require the explicit protected reset in backup settings.
            epochs.acceptAfterProtectedReset(snapshot.scope,generation)
        }
        current();return CloudAccountImporter(app.database,app.scheduler).import(snapshot,::current)
    }
    internal fun auroraGateway(uid: String): ru.genesis.calendar.data.AuroraGateway = object : ru.genesis.calendar.data.AuroraGateway {
        private val capturedGeneration=client.currentGeneration()
        private val capturedEpoch=app.workspaceEpoch
        override fun check() {
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            check(client.isCurrent(capturedGeneration)&&app.workspaceEpoch==capturedEpoch && !mutableState.value.requiresSignIn
                && mutableState.value.user?.uid == uid && app.workspaceScope == CloudAccountSnapshot.scopeFor(uid)) { "AURORA_ACCOUNT_CHANGED" }
        }
        override suspend fun workspace(): JSONObject { check(); return withContext(Dispatchers.IO) { check();client.workspace(capturedGeneration) }.also { check() } }
        override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject {
            check(); return withContext(Dispatchers.IO) { check();client.aurora(capturedGeneration, method, path, body) }.also { check() }
        }
        override suspend fun billing(method: String, path: String, body: JSONObject?): JSONObject {
            check(); require(AuroraProtocol.allowedBilling(method,path))
            return withContext(Dispatchers.IO) { check();client.billing(capturedGeneration,method,path,body) }.also { check() }
        }
    }

    internal fun mindmapTransport(uid:String):ru.genesis.calendar.data.MindmapTransport {
      val capturedGeneration=client.currentGeneration();val capturedEpoch=app.workspaceEpoch;val accountScope=CloudAccountSnapshot.scopeFor(uid)
      return object : ru.genesis.calendar.data.MindmapTransport {
        override fun check() {ru.genesis.calendar.security.UpdateGate.requireOpen();check(client.isCurrent(capturedGeneration)&&app.workspaceEpoch==capturedEpoch
            &&mutableState.value.user?.uid==uid && app.workspaceScope==accountScope) { "Сессия карт завершена. Повторите вход; черновик сохранён." } }
        override suspend fun <T> withLegacyOperation(operation:suspend ()->T):T =
            ru.genesis.calendar.data.NativeLegacyOperationPermit.run(app.database,accountScope,::check,operation)
        private suspend fun call(read: Boolean, action: (Long) -> JSONObject): JSONObject {
            check()
            if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            val generation = client.currentGeneration()
            try {
                return withContext(Dispatchers.IO) { action(generation) }.also { check() }
            } catch (failure: AuthFailure) {
                // A read can safely revalidate the session. Never repeat an uncertain write here;
                // MindmapRepository owns its durable operation ID and replay protection.
                if (read && failure.kind == AuthFailure.Kind.UNAUTHORIZED) {
                    try {
                        val session = withContext(Dispatchers.IO) { client.session(generation) }
                        check()
                        if (AuthProtocol.identity(session)?.uid == uid) {
                            // Revalidation also refreshes the live access receipt (including trials).
                            // Do not leave the UI holding an obsolete receipt after a successful read.
                            liveAccountSettings(session)?.let { settings ->
                                publish(generation, mutableState.value.copy(accountSettings = settings,
                                    checkedAt = System.currentTimeMillis()))
                            }
                            return withContext(Dispatchers.IO) { action(generation) }.also { check() }
                        }
                    } catch (revalidated: AuthFailure) {
                        if (revalidated.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
                        android.util.Log.w("GenesisMindmaps", "read revalidation failed: ${revalidated.kind}, HTTP ${revalidated.httpStatus ?: 0}")
                        throw revalidated
                    }
                    requireSignIn(generation)
                }
                android.util.Log.w("GenesisMindmaps", "${if (read) "read" else "write"} failed: ${failure.kind}, HTTP ${failure.httpStatus ?: 0}")
                throw failure
            }
        }
        override suspend fun workspace():JSONObject = call(true) { client.workspace(it) }
        override suspend fun request(path:String,body:JSONObject?):JSONObject = call(body == null) { client.mindmaps(it,path,body) }
      }
    }

    override fun checkSharedMindmapAccount(uid: String) {
        val state = mutableState.value
        if (state.user?.uid != uid || state.accountSettings?.sharedProjectsEnabled != true || app.workspaceScope != CloudAccountSnapshot.scopeFor(uid)) throw CancellationException()
    }
    override suspend fun sharedMindmapWorkspace(): JSONObject = sharedOnlineCall { api, generation -> api.workspace(generation) }
    override suspend fun sharedMindmapDocument(space: String, path: String, body: JSONObject?, method: String): JSONObject =
        sharedOnlineCall { api, generation -> api.sharedMindmapDocument(generation, space, path, body, method) }

    internal fun messagingLifetime()=client.currentGeneration() to app.workspaceEpoch
    internal fun messagingGateway(uid: String): MessagingGateway {
      val epoch=ru.genesis.calendar.security.NativePrivateProducts.custodyRevision.value
      val generation=client.currentGeneration();val restore=app.workspaceEpoch;val scope=CloudAccountSnapshot.scopeFor(uid)
      val protected=ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope)
      val account=if(protected)ru.genesis.calendar.security.NativePrivateProducts.account(scope,uid)else null
      return object : MessagingGateway {
        override val custodyEpoch=epoch
        override val sessionGeneration=generation
        override val restoreEpoch=restore
        override fun featureAccess(): FeatureAccess {check();return mutableState.value.accountSettings?.featureAccess ?: FeatureAccess()}
        override fun check() {
            if (!client.isCurrent(generation)||app.workspaceEpoch!=restore||mutableState.value.user?.uid != uid || app.workspaceScope != scope) throw CancellationException()
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(scope)!=protected||ru.genesis.calendar.security.NativePrivateProducts.custodyRevision.value!=epoch)throw CancellationException()
            account?.let{it.requireOpen();if(ru.genesis.calendar.security.NativePrivateProducts.account(scope,uid)!==it)throw CancellationException()}
        }
        override suspend fun request(method: String, path: String, body: JSONObject?): JSONObject {
            check();check(MessagingProtocol.allowedRoute(method,path)){"MESSAGING_ROUTE_BLOCKED"}
            if(!path.startsWith("/shared/messenger/")&&mutableState.value.accountSettings?.sharedProjectsEnabled!=true)throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            if(!mutableState.value.ready||mutableState.value.requiresSignIn)throw AuthFailure(AuthFailure.Kind.NETWORK)
            return withContext(Dispatchers.IO){
                currentCoroutineContext().ensureActive();check();val result=client.messaging(generation,method,path,body)
                currentCoroutineContext().ensureActive();check();result
            }
        }
    }

    }
    internal suspend fun privateGoogleCopy(uid:String,input:JSONObject,consent:ru.genesis.calendar.security.ExternalCopyConsent):JSONObject{
        val scope=CloudAccountSnapshot.scopeFor(uid);val account=ru.genesis.calendar.security.NativePrivateProducts.account(scope,uid);val epoch=app.workspaceEpoch;val generation=client.currentGeneration()
        fun current(){account.requireOpen();check(client.isCurrent(generation)&&app.workspaceEpoch==epoch&&app.workspaceScope==scope&&mutableState.value.user?.uid==uid&&ru.genesis.calendar.security.NativePrivateProducts.account(scope,uid)===account){"E2EE_ACCOUNT_CHANGED"}}
        current();val payload=consent.consume(account,input.getString("provider"),"google-copy:${input.getString("accountId")}",input).put("consentVersion",ru.genesis.calendar.security.ExternalCopyConsent.NOTICE_VERSION)
        return withContext(Dispatchers.IO){current();client.privateGoogleCopy(generation,payload).also{current()}}
    }
    internal fun assistantGateway(uid: String): AssistantGateway = object : AssistantGateway {
        override fun check() {
            val state = mutableState.value
            check(state.user?.uid == uid && app.workspaceScope == CloudAccountSnapshot.scopeFor(uid)) { "Аккаунт изменился. Откройте помощника заново." }
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(uid)))ru.genesis.calendar.security.NativePrivateProducts.account(CloudAccountSnapshot.scopeFor(uid),uid).requireOpen()
        }
        private suspend fun call(body: JSONObject?): JSONObject {
            check(); val generation = client.currentGeneration()
            check(mutableState.value.ready && !mutableState.value.requiresSignIn) { "Повторите вход для серверного помощника. Сохранённый план остаётся на устройстве." }
            return withContext(Dispatchers.IO) { client.assistant(generation, body) }.also {
                check(); if (!client.isCurrent(generation)) throw CancellationException()
            }
        }
        override suspend fun status() = call(null)
        override suspend fun plan(command: String, audio: JSONObject?, context: JSONObject):JSONObject {
            check(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(uid))){"E2EE_EXTERNAL_COPY_CONSENT_REQUIRED"}
            return call(JSONObject().put("command", command).put("audio", audio ?: JSONObject.NULL).put("context", context))
        }
        override suspend fun planWithConsent(command:String,audio:JSONObject?,context:JSONObject,provider:String,consent:ru.genesis.calendar.security.ExternalCopyConsent):JSONObject{
            check();val account=ru.genesis.calendar.security.NativePrivateProducts.account(CloudAccountSnapshot.scopeFor(uid),uid)
            val payload=consent.consume(account,provider,"assistant-plan",JSONObject().put("command",command).put("audio",audio?:JSONObject.NULL).put("context",context))
            payload.put("provider",provider).put("consentVersion",ru.genesis.calendar.security.ExternalCopyConsent.NOTICE_VERSION);val generation=client.currentGeneration()
            return withContext(Dispatchers.IO){check();client.privateAssistant(generation,payload).also{account.requireOpen();check();check(client.isCurrent(generation)){"E2EE_ACCOUNT_CHANGED"}}}
        }
    }

    internal fun diaryGateway(uid: String): DiaryGateway {
      val capturedGeneration=client.currentGeneration();val capturedEpoch=app.workspaceEpoch;val accountScope=CloudAccountSnapshot.scopeFor(uid)
      return object : DiaryGateway {
        override fun featureAccess(): FeatureAccess = mutableState.value.accountSettings?.featureAccess ?: FeatureAccess()
        override fun check() {
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            check(client.isCurrent(capturedGeneration)&&app.workspaceEpoch==capturedEpoch&&mutableState.value.user?.uid == uid && app.workspaceScope == accountScope) {
                "Сессия дневника завершена. Черновик сохранён на устройстве."
            }
        }
        override suspend fun <T> withLegacyOperation(operation:suspend ()->T):T =
            ru.genesis.calendar.data.NativeLegacyOperationPermit.run(app.database,accountScope,::check,operation)
        override suspend fun workspace(): JSONObject {
            check(); check(!mutableState.value.requiresSignIn)
            val generation = client.currentGeneration()
            return withContext(Dispatchers.IO) { client.workspace(generation) }.also { check() }
        }
        override suspend fun request(path: String, body: JSONObject?): JSONObject {
            check(); check(!mutableState.value.requiresSignIn)
            val generation = client.currentGeneration()
            return withContext(Dispatchers.IO) { client.diary(generation, path, body) }.also { check() }
        }
        override suspend fun privateService(service:String,timeZone:String?):JSONObject{
            check();check(!mutableState.value.requiresSignIn)
            val account=ru.genesis.calendar.security.NativePrivateProducts.account(accountScope,uid);account.requireOpen();check(!account.offline){"DIARY_ONLINE_REQUIRED"}
            val generation=client.currentGeneration();return withContext(Dispatchers.IO){client.privateService(generation,service,timeZone)}.also{check();account.requireOpen()}
        }
        override suspend fun remove(id: String, expectedRevision: Long): JSONObject {
            check(); check(!mutableState.value.requiresSignIn)
            val generation = client.currentGeneration()
            return withContext(Dispatchers.IO) { client.diary(generation, "/diary/$id", JSONObject().put("expectedRevision", expectedRevision), "DELETE") }.also { check() }
        }
    }

    }
    suspend fun yandexAvailable(): Boolean = withContext(Dispatchers.IO) {
        runCatching { client.providers(client.currentGeneration()).optBoolean("yandex") }.getOrDefault(false)
    }

    private suspend fun <T> adminOnlineCall(action: (AuthSessionClient, Long) -> T): T {
        val initial = mutableState.value
        val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!initial.ready || initial.requiresSignIn || initial.accountSettings?.isAdmin != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration()
        val caller = currentCoroutineContext()
        fun current() {
            caller.ensureActive()
            val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.requiresSignIn || state.user?.uid != account ||
                state.accountSettings?.isAdmin != true || app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        return withContext(Dispatchers.IO) { current(); action(client, generation).also { current() } }
    }
    internal fun adminGateway(uid: String): AdminGateway = object : AdminGateway {
        override fun check() {
            val state = mutableState.value
            if (state.user?.uid != uid || state.accountSettings?.isAdmin != true || app.workspaceScope != CloudAccountSnapshot.scopeFor(uid)) throw CancellationException()
        }
        private suspend fun request(method: String, path: String, body: JSONObject? = null): JSONObject {
            check()
            return adminOnlineCall { api, generation -> api.adminExtension(generation, method, path, body) }.also { check() }
        }
        override suspend fun ads() = request("GET", "/admin/ads")
        override suspend fun saveAd(id: String?, body: JSONObject): JSONObject = request(if (id == null) "POST" else "PUT",
            if (id == null) "/admin/ads" else "/admin/ads/${AdminProtocol.adId(id)}", body)
        override suspend fun deleteAd(id: String) = request("DELETE", "/admin/ads/${AdminProtocol.adId(id)}", JSONObject())
        override suspend fun subscription(userId: String, plan: String, expectedPlan: String): JSONObject {
            require(plan in AdminProtocol.plans && expectedPlan in AdminProtocol.plans)
            return request("PUT", "/admin/users/${AdminProtocol.userId(userId)}/subscription",
                JSONObject().put("subscriptionPlan", plan).put("expectedPlan", expectedPlan))
        }
        override suspend fun resetAccess(userId:String,expectedPlan:String,expectedRevision:Int):JSONObject = request("POST","/admin/users/${AdminProtocol.userId(userId)}/reset-access",
            JSONObject().put("expectedPlan",expectedPlan).put("expectedRevision",expectedRevision))
        override suspend fun forecastPrivilege(userId:String,enabled:Boolean,expectedRevision:Int):JSONObject = request("PUT","/admin/users/${AdminProtocol.userId(userId)}/forecast-privilege",
            JSONObject().put("enabled",enabled).put("expectedRevision",expectedRevision))
    }
    suspend fun adminStats(): JSONObject = adminOnlineCall { api, generation -> api.adminStats(generation) }
    internal suspend fun billing(method:String,path:String,body:JSONObject?=null):JSONObject {
        val initial=mutableState.value;val uid=initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if(!initial.ready || initial.requiresSignIn)throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation=client.currentGeneration()
        val result=withContext(Dispatchers.IO){client.billing(generation,method,path,body)}
        if(!client.isCurrent(generation)||mutableState.value.user?.uid!=uid||app.workspaceScope!=CloudAccountSnapshot.scopeFor(uid))throw CancellationException()
        return result
    }
    internal suspend fun referrals(method: String, path: String, body: JSONObject? = null): JSONObject {
        require(allowedReferralRoute(method, path))
        val initial = mutableState.value; val uid = initial.user?.uid
        val anonymous = path == "/referrals/invitation" && uid == null
        if (!anonymous && (uid == null || !initial.ready || initial.requiresSignIn)) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration()
        val result = withContext(Dispatchers.IO) {
            if (anonymous) client.session(generation)
            client.referrals(generation, method, path, body)
        }
        if (!client.isCurrent(generation) || mutableState.value.user?.uid != uid ||
            uid != null && app.workspaceScope != CloudAccountSnapshot.scopeFor(uid)) throw CancellationException()
        return result
    }

    internal suspend fun donationUrl(): String {
        val initial = mutableState.value
        val uid = initial.user?.uid ?: run {
            if (initial.busy) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            return publicDonationUrl
        }
        if (!initial.ready || initial.requiresSignIn || app.workspaceScope != CloudAccountSnapshot.scopeFor(uid))
            throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration()
        val response = withContext(Dispatchers.IO) { client.donationCheckout(generation) }
        val current = mutableState.value
        if (!client.isCurrent(generation) || !current.ready || current.requiresSignIn || current.user?.uid != uid ||
            app.workspaceScope != CloudAccountSnapshot.scopeFor(uid)) throw CancellationException()
        return donationCheckoutUrl(response)
    }

    suspend fun todayAds(language: String, country: String): JSONObject {
        val snapshot = mutableState.value
        check(snapshot.ready && !snapshot.requiresSignIn && snapshot.user != null)
        val generation = client.currentGeneration()
        return withContext(Dispatchers.IO) { client.todayAds(generation, language, country) }
    }

    /** Only a real foreground visit may fetch; responses cannot cross account or session generations. */
    internal suspend fun weather(uid: String, location: ru.genesis.calendar.domain.WeatherRequestV1): ru.genesis.calendar.domain.WeatherSnapshotV1 {
        val generation = client.currentGeneration()
        val visit = NativeActivityVisit.foregroundVisitId() ?: throw CancellationException("Weather requires foreground")
        fun checkCurrent() {
            val current = mutableState.value
            if (!client.isCurrent(generation) || !current.ready || current.requiresSignIn || current.user?.uid != uid ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(uid) || NativeActivityVisit.foregroundVisitId() != visit)
                throw CancellationException("Weather account or foreground visit changed")
        }
        checkCurrent()
        val response = withContext(Dispatchers.IO) {
            suspendCancellableCoroutine<JSONObject> { continuation ->
                val call = ForegroundAccountCall(visit)
                continuation.invokeOnCancellation { call.cancel() }
                try {
                    checkCurrent()
                    val value = client.weather(generation, location, call)
                    if (continuation.isActive) continuation.resumeWith(Result.success(value))
                } catch (failure: Exception) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(failure))
                }
            }
        }
        currentCoroutineContext().ensureActive()
        checkCurrent()
        return ru.genesis.calendar.domain.WeatherSnapshotV1.fromJson(response.getJSONObject("weather"))
    }

    internal suspend fun planGuidance(uid: String, path: String, body: JSONObject? = null): JSONObject {
        val generation = client.currentGeneration()
        val visit = NativeActivityVisit.foregroundVisitId() ?: throw CancellationException("Plan guidance requires foreground")
        fun checkCurrent() {
            val current = mutableState.value
            if (!client.isCurrent(generation) || !current.ready || current.requiresSignIn || current.user?.uid != uid ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(uid) || NativeActivityVisit.foregroundVisitId() != visit)
                throw CancellationException("Plan guidance account or foreground visit changed")
            val access = current.accountSettings?.featureAccess
            if (access == null || !nativePlanGuidanceEligible(access)) throw CancellationException("Plan guidance access changed")
        }
        checkCurrent()
        val response = withContext(Dispatchers.IO) {
            suspendCancellableCoroutine<JSONObject> { continuation ->
                val call = ForegroundAccountCall(visit)
                continuation.invokeOnCancellation { call.cancel() }
                try {
                    checkCurrent()
                    val value = client.planGuidance(generation, path, body, call)
                    if (continuation.isActive) continuation.resumeWith(Result.success(value))
                } catch (failure: Exception) {
                    if (continuation.isActive) continuation.resumeWith(Result.failure(failure))
                }
            }
        }
        currentCoroutineContext().ensureActive()
        checkCurrent()
        if (path == "/account/plan-guidance/claim" && response.optBoolean("show")) response.optString("token")
            .takeIf { it.matches(Regex("[a-f0-9]{48}")) }?.let { planGuidanceLeases[it] = uid to generation }
        if (path == "/account/plan-guidance/shown" && response.optBoolean("ok"))
            body?.optString("token")?.let { planGuidanceLeases.remove(it) }
        return response
    }

    /** Releasing an unseen lease may run after pause; never submit an old token under a new account. */
    internal fun releasePlanGuidance(uid: String, token: String) {
        if (!token.matches(Regex("[a-f0-9]{48}"))) return
        val binding = planGuidanceLeases.remove(token) ?: return
        val generation = binding.second
        if (binding.first != uid || mutableState.value.user?.uid != uid || !client.isCurrent(generation) ||
            app.workspaceScope != CloudAccountSnapshot.scopeFor(uid)) return
        scope.launch(NativeActivityVisit.requestContext(true)) {
            try {
                if (mutableState.value.user?.uid == uid && client.isCurrent(generation) && app.workspaceScope == CloudAccountSnapshot.scopeFor(uid))
                    withContext(Dispatchers.IO) { client.releasePlanGuidance(generation, token) }
            } catch (cancelled: CancellationException) { throw cancelled } catch (_: Exception) { /* Server leases expire after 120 seconds. */ }
        }
    }

    private fun checkAdviceAccount(uid: String) {
        val current = mutableState.value
        check(current.ready && !current.requiresSignIn && current.user?.uid == uid &&
            app.workspaceScope == CloudAccountSnapshot.scopeFor(uid))
    }

    internal suspend fun <T> withLegacyAdviceScope(accountScope:String,operation:suspend ()->T):T {
        val generation=client.currentGeneration()
        return legacyAdviceOperation(app,accountScope,{
            if(!client.isCurrent(generation))throw AuthApiError("E2EE_ACCOUNT_CHANGED")
        },operation)
    }
    private suspend fun <T> withAdvicePreferenceScope(uid:String,operation:suspend ()->T):T{
        val accountScope=CloudAccountSnapshot.scopeFor(uid)
        if(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(accountScope))return withLegacyAdviceScope(accountScope,operation)
        val account=ru.genesis.calendar.security.NativePrivateProducts.account(accountScope,uid);checkAdviceAccount(uid);account.requireOpen();return operation().also{checkAdviceAccount(uid);account.requireOpen()}
    }

    private fun privateAdviceTransport(uid:String):DailyAdviceGateway=object:DailyAdviceGateway{
        private suspend fun execute(action:String,args:JSONObject):JSONObject{checkAdviceAccount(uid);val accountScope=CloudAccountSnapshot.scopeFor(uid)
            check(app.workspaceScope==accountScope){"E2EE_ACCOUNT_CHANGED"};val products=ru.genesis.calendar.security.NativePrivateProducts
            val account=products.account(accountScope,uid);val settings=mutableState.value.accountSettings?:error("E2EE_PRODUCT_READ_REQUIRED")
            val prefs=products.preferences(accountScope).snapshot().getJSONObject("advicePreferences")
            val result=products.advice(accountScope).execute(action,args,settings.language,prefs);account.requireOpen();checkAdviceAccount(uid);return result
        }
        override suspend fun today(context:JSONObject)=execute("today",JSONObject().put("scores",context.optJSONObject("scores")?:JSONObject()).put("topics",context.optJSONObject("topics")?:JSONObject()))
        override suspend fun next(context:JSONObject,id:String,day:String)=execute("today",JSONObject().put("scores",context.optJSONObject("scores")?:JSONObject()).put("topics",context.optJSONObject("topics")?:JSONObject()).put("from",JSONObject().put("id",id).put("dayKey",day)))
        override suspend fun saved(id:String,day:String,collection:String):JSONObject{DailyAdviceProtocol.savedPath(id,day,collection);return execute("saved",JSONObject().put("id",id).put("dayKey",day).put("collection",collection))}
        override suspend fun share(id:String,day:String,collection:String)=saved(id,day,collection).also{require(DailyAdviceProtocol.parse(it).advice!=null)}
        override suspend fun pending()=ru.genesis.calendar.security.NativePrivateProducts.advice(CloudAccountSnapshot.scopeFor(uid)).hasPending()
        override suspend fun resume(){resumePrivateAdvice(uid)}
        override suspend fun record(id:String,day:String,dismiss:Boolean){DailyAdviceProtocol.record(id,day);execute("record",JSONObject().put("id",id).put("dayKey",day).put("dismiss",dismiss));if(dismiss)ru.genesis.calendar.reminders.AdviceReminderScheduler.cancelDay(app,CloudAccountSnapshot.scopeFor(uid),day)}
    }
    internal suspend fun resumePrivateAdvice(uid:String):JSONObject{checkAdviceAccount(uid);val accountScope=CloudAccountSnapshot.scopeFor(uid);val products=ru.genesis.calendar.security.NativePrivateProducts
        return products.advice(accountScope).execute("resume",JSONObject(),mutableState.value.accountSettings?.language?:"en",products.preferences(accountScope).snapshot().getJSONObject("advicePreferences"))}

    internal fun dailyAdviceTransport(uid: String): DailyAdviceGateway = if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(uid)))privateAdviceTransport(uid)else object : DailyAdviceGateway {
        override suspend fun today(context: JSONObject): JSONObject = withLegacyAdviceScope(CloudAccountSnapshot.scopeFor(uid)) {
            checkAdviceAccount(uid)
            val generation = client.currentGeneration()
            val result = withContext(Dispatchers.IO) { client.dailyAdvice(generation, context) }
            checkAdviceAccount(uid)
            withContext(Dispatchers.IO) { AdviceSnapshotStore(app).cache(CloudAccountSnapshot.scopeFor(uid), result) }
            result
        }
        override suspend fun record(id: String, day: String, dismiss: Boolean):Unit = withLegacyAdviceScope(CloudAccountSnapshot.scopeFor(uid)) {
            checkAdviceAccount(uid)
            val generation = client.currentGeneration()
            val result = withContext(Dispatchers.IO) { client.recordAdvice(generation, id, day, dismiss) }
            checkAdviceAccount(uid)
            check(result.optBoolean("ok"))
            if (dismiss) synchronized(app.adviceNotificationGuard) {
                locallyDismissedAdvice.add("${CloudAccountSnapshot.scopeFor(uid)}|$day|$id")
                while (locallyDismissedAdvice.size > 256) locallyDismissedAdvice.remove(locallyDismissedAdvice.first())
                ru.genesis.calendar.reminders.AdviceReminderScheduler.cancelDay(app, CloudAccountSnapshot.scopeFor(uid), day)
            }
            if (dismiss) withContext(Dispatchers.IO) { adviceCollections.forEach { collection ->
                AdviceSnapshotStore(app).invalidate(CloudAccountSnapshot.scopeFor(uid), id, day, collection)
            } }
        }
        override suspend fun next(context: JSONObject, id: String, day: String): JSONObject = withLegacyAdviceScope(CloudAccountSnapshot.scopeFor(uid)) {
            checkAdviceAccount(uid)
            val generation = client.currentGeneration()
            val result = withContext(Dispatchers.IO) { client.nextDailyAdvice(generation, context, id, day) }
            checkAdviceAccount(uid)
            withContext(Dispatchers.IO) { AdviceSnapshotStore(app).cache(CloudAccountSnapshot.scopeFor(uid), result) }
            result
        }
        override suspend fun saved(id: String, day: String, collection: String): JSONObject = withLegacyAdviceScope(CloudAccountSnapshot.scopeFor(uid)) {
            DailyAdviceProtocol.savedPath(id, day, collection)
            val accountScope = CloudAccountSnapshot.scopeFor(uid)
            fun current() {
                val state = mutableState.value
                check(state.ready && state.user?.uid == uid && app.workspaceScope == accountScope)
            }
            current()
            val store = AdviceSnapshotStore(app)
            val cached = withContext(Dispatchers.IO) { store.saved(accountScope, id, day, collection) }
            if (mutableState.value.requiresSignIn) return@withLegacyAdviceScope cached ?: throw AuthFailure(AuthFailure.Kind.NETWORK)
            val generation = client.currentGeneration()
            try {
                val result = withContext(Dispatchers.IO) { client.savedDailyAdvice(generation, id, day, collection) }
                current()
                if (!client.isCurrent(generation)) throw CancellationException()
                val card = DailyAdviceProtocol.parse(result).advice
                require(card == null || card.id == id && card.day == day && card.collection == collection)
                withContext(Dispatchers.IO) {
                    if (card == null) store.invalidate(accountScope, id, day, collection)
                    else store.cache(accountScope, result, current = false)
                }
                result
            } catch (error: AuthFailure) {
                current()
                if (error.kind == AuthFailure.Kind.NETWORK && cached != null) cached else throw error
            }
        }
        override suspend fun share(id: String, day: String, collection: String): JSONObject = withLegacyAdviceScope(CloudAccountSnapshot.scopeFor(uid)) {
            checkAdviceAccount(uid)
            // Export revalidates against the server and never falls back to an offline cache.
            val result = notificationSavedAdvice(CloudAccountSnapshot.scopeFor(uid), id, day, collection)
            checkAdviceAccount(uid)
            require(DailyAdviceProtocol.parse(result).advice != null)
            result
        }
    }

    internal suspend fun claimSupportNotice(uid:String,surface:String):JSONObject {
        val generation=client.currentGeneration()
        require(mutableState.value.user?.uid==uid&&!mutableState.value.requiresSignIn)
        val response=withContext(Dispatchers.IO + NativeActivityVisit.requestContext(surface == "phone")){client.claimSupportNotice(generation,surface)}
        if(!client.isCurrent(generation)||mutableState.value.user?.uid!=uid)throw CancellationException()
        return response
    }
    internal suspend fun emailVerification(uid: String, send: Boolean = false, dismiss: Boolean = false): EmailVerificationStatus {
        val generation=client.currentGeneration()
        require(mutableState.value.user?.uid==uid)
        val response=withContext(Dispatchers.IO){client.emailVerification(generation,send,dismiss)}
        val verification=EmailVerificationStatus.fromJson(response.getJSONObject("verification"))
        dataSyncMutex.withLock {
            if(!client.isCurrent(generation)||mutableState.value.user?.uid!=uid)throw CancellationException()
            val current=mutableState.value
            val settings=current.accountSettings?.copy(emailVerification=verification)?:throw CancellationException()
            publish(generation,current.copy(accountSettings=settings))
            withContext(Dispatchers.IO){CachedAccountEntry(app).save(current.user!!,settings)}
        }
        return verification
    }

    internal suspend fun saveAdvicePreferences(uid: String, patch: JSONObject): AdvicePreferences = withAdvicePreferenceScope(uid) {
        val savedPreferences=advicePreferencesMutex.withLock {
        checkAdviceAccount(uid)
        require(patch.length() > 0 && patch.keys().asSequence().all { it in setOf("enabled", "smart", "categories", "aphrodisiaAdult", "collections", "philosophersPerDay", "notifications", "psychopompia") })
        patch.optJSONObject("notifications")?.let { AdviceNotificationPreferences.fromJson(it) }
        val generation = client.currentGeneration()
        val response = withContext(Dispatchers.IO) { updatePreferencePayload(generation, JSONObject().put("advicePreferences", patch)) }
        checkAdviceAccount(uid)
        val identity = AuthProtocol.identity(response) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val settings = liveAccountSettings(response) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        require(identity.uid == uid)
        val saved = settings.advicePreferences.toJson()
        require(patch.keys().asSequence().all { key -> saved.get(key).toString() == patch.get(key).toString() })
        publish(generation, mutableState.value.copy(user = identity, accountSettings = settings, checkedAt = System.currentTimeMillis()))
        // A confirmed disable/time change must survive process death before the UI reports success.
        dataSyncMutex.withLock {
            checkAdviceAccount(uid)
            if (!client.isCurrent(generation)) throw CancellationException()
            withContext(Dispatchers.IO) { CachedAccountEntry(app).save(identity, settings) }
        }
        settings.advicePreferences
        }
        // Release the preference mutex before entering scheduler serialization.
        ru.genesis.calendar.reminders.AdviceReminderScheduler.restore(app)
        savedPreferences
    }

    /** Only a profile read: does not bootstrap/import the workspace or grant account readiness. */
    internal suspend fun adviceNotificationAccount(accountScope: String): CachedAccountEntry.Entry = withLegacyAdviceScope(accountScope) { advicePreferencesMutex.withLock {
        val generation = client.currentGeneration()
        val before = mutableState.value
        fun current() {
            if (app.workspaceScope != accountScope || !client.isCurrent(generation)) throw AuthFailure(AuthFailure.Kind.CONFLICT)
        }
        current()
        val response = withContext(Dispatchers.IO + NativeActivityVisit.requestContext(true)) { client.session(generation) }
        current()
        val identity = AuthProtocol.identity(response) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (CloudAccountSnapshot.scopeFor(identity.uid) != accountScope) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val settings = liveAccountSettings(response) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        // A concurrently saved preference or foreground refresh wins over an older GET response.
        val retained = withContext(Dispatchers.Main.immediate) {
            current()
            if (mutableState.value !== before) throw AuthFailure(AuthFailure.Kind.CONFLICT)
            if (before.ready && before.user?.uid == identity.uid) {
                publish(generation, before.copy(accountSettings = settings))
            }
            // StateFlow retains its old instance when an equal profile is published.
            mutableState.value
        }
        dataSyncMutex.withLock {
            current()
            if (mutableState.value !== retained) throw AuthFailure(AuthFailure.Kind.CONFLICT)
            withContext(Dispatchers.IO) { CachedAccountEntry(app).save(identity, settings) }
        }
        CachedAccountEntry.Entry(identity, settings)
    } }

    internal suspend fun cachedAdviceNotificationAccount(accountScope: String): CachedAccountEntry.Entry? {
        if (app.workspaceScope != accountScope) return null
        return withLegacyAdviceScope(accountScope) {
        val state = mutableState.value
        val user = state.user
        val settings = state.accountSettings
        if (state.ready && user != null && settings != null && CloudAccountSnapshot.scopeFor(user.uid) == accountScope)
            CachedAccountEntry.Entry(user, settings)
        else withContext(Dispatchers.IO) { CachedAccountEntry(app).read(accountScope) }
        }
    }

    internal suspend fun notificationDailyAdvice(accountScope: String, timeZone: String): JSONObject = withLegacyAdviceScope(accountScope) {
        val generation = client.currentGeneration()
        if (app.workspaceScope != accountScope) throw AuthFailure(AuthFailure.Kind.CONFLICT)
        val result = withContext(Dispatchers.IO + NativeActivityVisit.requestContext(true)) { client.dailyAdvice(generation, JSONObject(), timeZone) }
        if (app.workspaceScope != accountScope || !client.isCurrent(generation)) throw AuthFailure(AuthFailure.Kind.CONFLICT)
        withContext(Dispatchers.IO) { AdviceSnapshotStore(app).cache(accountScope, result) }
        result
    }

    internal suspend fun notificationSavedAdvice(accountScope: String, id: String, day: String, collection: String): JSONObject = withLegacyAdviceScope(accountScope) {
        val generation = client.currentGeneration()
        if (app.workspaceScope != accountScope) throw AuthFailure(AuthFailure.Kind.CONFLICT)
        val result = withContext(Dispatchers.IO + NativeActivityVisit.requestContext(true)) { client.savedDailyAdvice(generation, id, day, collection) }
        if (app.workspaceScope != accountScope || !client.isCurrent(generation)) throw AuthFailure(AuthFailure.Kind.CONFLICT)
        val card = DailyAdviceProtocol.parse(result).advice
        require(card == null || card.id == id && card.day == day && card.collection == collection)
        withContext(Dispatchers.IO) {
            if (card == null) AdviceSnapshotStore(app).invalidate(accountScope, id, day, collection)
            else AdviceSnapshotStore(app).cache(accountScope, result, current = false)
        }
        result
    }

    /** Called only while holding the shared scope/preference notification guard, immediately before notify(). */
    internal fun adviceNotificationStillVisible(accountScope: String, card: DailyAdvice, settings: AccountSettings): Boolean {
        val permit=ru.genesis.calendar.data.NativeLegacyOperationPermit.current()?:return false
        permit.check()
        val current = mutableState.value
        val currentSettings = current.accountSettings?.takeIf { current.user?.uid?.let(CloudAccountSnapshot::scopeFor) == accountScope } ?: settings
        return app.workspaceScope == accountScope && "$accountScope|${card.day}|${card.id}" !in locallyDismissedAdvice &&
            currentSettings.advicePreferences == settings.advicePreferences && currentSettings.language == settings.language &&
            card.collection in currentSettings.adviceCollectionsReady &&
            DailyAdviceProtocol.visible(card, currentSettings.advicePreferences) && NativeAdviceAgeAccess.notificationSafe(card)
    }

    private suspend fun sharedCall(action: (AuthSessionClient, Long) -> JSONObject): JSONObject {
        val snapshot = mutableState.value
        check(snapshot.ready && !snapshot.requiresSignIn && snapshot.user != null &&
            snapshot.accountSettings?.sharedProjectsEnabled == true &&
            snapshot.accountSettings.featureAccess.allows("shared-projects"))
        val generation = client.currentGeneration()
        return withContext(Dispatchers.IO) { action(client, generation) }
    }

    suspend fun recordFeatureUsage(features: List<String>) {
        val snapshot = mutableState.value
        if (!snapshot.ready || snapshot.requiresSignIn || snapshot.user == null || features.isEmpty()) return
        val generation = client.currentGeneration()
        withContext(Dispatchers.IO) { client.recordFeatureUsage(generation, features) }
    }

    private suspend fun sharedInvitationCall(action: (AuthSessionClient, Long) -> JSONObject): JSONObject {
        val snapshot = mutableState.value
        check(snapshot.ready && !snapshot.requiresSignIn && snapshot.user != null &&
            snapshot.accountSettings?.sharedProjectsEligible == true &&
            snapshot.accountSettings.featureAccess.allows("shared-projects"))
        val generation = client.currentGeneration()
        return withContext(Dispatchers.IO) { action(client, generation) }
    }

    private suspend fun sharedCachedCall(path: String,
        action: (AuthSessionClient, Long) -> JSONObject): JSONObject {
        val local = mutableState.value
        val privateOwner=local.user?.uid
        if(privateOwner!=null&&ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(privateOwner))){
            check(local.ready&&local.accountSettings?.sharedProjectsEnabled==true){"E2EE_SCOPE_FORBIDDEN"};val generation=client.currentGeneration()
            return withContext(Dispatchers.IO){fun current(){check(client.isCurrent(generation)&&mutableState.value.user?.uid==privateOwner&&app.workspaceScope==CloudAccountSnapshot.scopeFor(privateOwner)){"E2EE_ACCOUNT_CHANGED"};ru.genesis.calendar.security.NativePrivateProducts.account(app.workspaceScope,privateOwner).requireOpen()}
                current();action(client,generation).also{current()}}
        }
        if (local.ready && local.requiresSignIn && local.user != null &&
            local.accountSettings?.sharedProjectsEnabled == true &&
            local.accountSettings.featureAccess.allows("shared-projects")) {
            return withContext(Dispatchers.IO) {
                sharedOffline.snapshot(local.user.uid, path) ?: throw AuthFailure(AuthFailure.Kind.NETWORK)
            }
        }
        return sharedCall { api, generation ->
            val userId = mutableState.value.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            try {
                action(api, generation).also { result ->
                    runCatching { sharedOffline.saveSnapshot(userId, path, result) }
                }
            } catch (error: AuthFailure) {
                if (error.kind == AuthFailure.Kind.NETWORK) sharedOffline.snapshot(userId, path) ?: throw error
                else {
                    if (error.kind == AuthFailure.Kind.UNAUTHORIZED || error.kind == AuthFailure.Kind.NOT_DEPLOYED)
                        sharedOffline.clearSnapshots(userId)
                    throw error
                }
            }
        }
    }

    private suspend fun sharedTaskCall(action: (AuthSessionClient?, Long) -> JSONObject): JSONObject {
        val local = mutableState.value
        check(local.ready && local.user != null && local.accountSettings?.sharedProjectsEnabled == true)
        val generation = client.currentGeneration()
        return withContext(Dispatchers.IO) {
            action(client.takeUnless { local.requiresSignIn&&!ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(local.user.uid)) }, generation)
        }
    }

    override suspend fun sharedSpaceUi(spaceId: String): JSONObject =
        sharedCachedCall("ui:$spaceId") { api, generation -> api.sharedSpaceUi(generation, spaceId) }
    override suspend fun saveSharedSpaceUi(spaceId: String, ids: List<String>): JSONObject =
        sharedCall { api, generation -> api.saveSharedSpaceUi(generation, spaceId, ids) }
    override suspend fun inviteSharedSpaceMember(spaceId: String, email: String, role: String): JSONObject =
        sharedCall { api, generation -> api.inviteSharedSpaceMember(generation, spaceId, email, role) }
    override suspend fun updateSharedBoard(projectId: String, statusId: String, changes: JSONObject): JSONObject =
        sharedCall { api, generation -> api.updateSharedStatus(generation, projectId, statusId, changes) }
    override suspend fun sharedSpaces(): JSONObject = sharedCachedCall("spaces") { api, generation -> api.sharedSpaces(generation) }
    suspend fun sharedTaskLists(): JSONObject = sharedCachedCall("task-lists") { api, generation -> api.sharedTaskLists(generation) }
    suspend fun sharedCalendarTasks(from: String, to: String): JSONObject =
        sharedCachedCall("calendar:$from:$to") { api, generation -> api.sharedCalendarTasks(generation, from, to) }
    override suspend fun createSharedSpace(title:String):JSONObject{
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val storageScope=CloudAccountSnapshot.scopeFor(uid)
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(storageScope)){
            val guard=privateUiOwnerGuard(uid);val creation=privateSpaceCreation(uid)
            val intent=withContext(Dispatchers.IO){guard();val id=creation.create(JSONObject().put("title",title).put("description","").put("invitations",JSONArray())
                .put("coverImage",JSONObject.NULL).put("coverPosition",JSONObject().put("x",50).put("y",50)));guard();creation.inspect(id)}
            try{val result=ru.genesis.calendar.security.NativeMigrationUiState.waitForCreation(uid,mutableState.value.accountSettings?.language?:"en",
                ru.genesis.calendar.security.E2eeProductMigration.Target(uid,intent.getString("scopeId"),"space",intent.getString("resourceId")),intent.getString("intentId"));guard();return result
            }catch(reason:IllegalStateException){if(reason.message=="E2EE_RESOURCE_CREATION_PAUSED"){
                val all=app.assets.open("private-resource-copy-v1.json").use{JSONObject(it.readBytes().toString(Charsets.UTF_8))};val language=mutableState.value.accountSettings?.language?:"en"
                throw IllegalStateException((all.optJSONObject(language)?:all.getJSONObject("en")).getString("paused"))
            };throw reason}
        }
        return sharedCall{api,generation->api.createSharedSpace(generation,JSONObject().put("title",title))}
    }
    override suspend fun sharedProjects(spaceId: String): JSONObject =
        sharedCachedCall("projects:$spaceId") { api, generation -> api.sharedProjects(generation, spaceId) }
    override suspend fun archivedSharedProjects(spaceId: String): JSONObject =
        sharedCachedCall("archived:$spaceId") { api, generation -> api.archivedSharedProjects(generation, spaceId) }
    override suspend fun createSharedProject(spaceId: String, title: String, description: String, layout: String,
        parentId: String?, kind: String, boardStatusId: String?): JSONObject {
        val uid=mutableState.value.user?.uid?:error("E2EE_ACCOUNT_BINDING_REQUIRED");val storageScope=CloudAccountSnapshot.scopeFor(uid)
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(storageScope)){
            val guard=privateUiOwnerGuard(uid);val creation=privateProjectCreation(uid);val language=mutableState.value.accountSettings?.language?:"en"
            val intent=withContext(Dispatchers.IO){guard();val all=app.assets.open("project-creation-copy-v1.json").use{JSONObject(it.readBytes().toString(Charsets.UTF_8))}
                val statusTitles=(all.optJSONObject(language)?:all.getJSONObject("en")).getJSONObject("statusTitles")
                val id=creation.create(JSONObject().put("spaceId",spaceId).put("title",title).put("description",description).put("layout",layout).put("kind",kind)
                    .put("parentId",parentId?:JSONObject.NULL).put("categoryId",JSONObject.NULL).put("boardStatusId",boardStatusId?:JSONObject.NULL)
                    .put("tags",JSONArray()).put("labelIds",JSONArray()).put("statusTitles",statusTitles));guard();creation.inspect(id)}
            try{val result=ru.genesis.calendar.security.NativeMigrationUiState.waitForCreation(uid,language,
                ru.genesis.calendar.security.E2eeProductMigration.Target(uid,intent.getString("scopeId"),"project",intent.getString("resourceId")),intent.getString("intentId"));guard();return result
            }catch(reason:IllegalStateException){if(reason.message=="E2EE_RESOURCE_CREATION_PAUSED"){
                val all=app.assets.open("private-resource-copy-v1.json").use{JSONObject(it.readBytes().toString(Charsets.UTF_8))}
                throw IllegalStateException((all.optJSONObject(language)?:all.getJSONObject("en")).getString("paused"))
            };throw reason}
        }
        return sharedCall { api, generation -> api.createSharedProject(generation, spaceId,
            JSONObject().put("title", title).put("description", description).put("layout", layout)
                .put("parentId", parentId ?: JSONObject.NULL).put("kind", kind)
                .put("boardStatusId", boardStatusId ?: JSONObject.NULL)) }
    }
    suspend fun importSharedProject(spaceId: String, body: JSONObject): JSONObject =
        sharedCall { api, generation -> api.importSharedProject(generation, spaceId, body) }
    override suspend fun querySharedTasks(filter: JSONObject, cursor: String?): JSONObject =
        sharedCachedCall("task-page:$filter:$cursor") { api, generation -> api.querySharedTasks(generation, filter, cursor) }
    override suspend fun sortedSharedTasks(filter:JSONObject,cursor:String?,sort:String):JSONObject =
        sharedCachedCall("task-page:$sort:$filter:$cursor") { api,generation->api.querySharedTasks(generation,filter,cursor,sort) }
    override suspend fun readSharedTaskUpdates(projectId:String,taskId:String,commentIds:List<String>):JSONObject =
        sharedCall { api,generation->api.readSharedTaskUpdates(generation,projectId,taskId,commentIds) }
    override suspend fun notificationSettings():JSONObject=sharedCall { api,generation->api.notificationSettings(generation) }
    override suspend fun convertSharedChecklist(projectId:String,taskId:String,itemId:String,revision:Int,requestId:String):JSONObject =
        sharedOnlineCall { api,generation->api.convertSharedChecklist(generation,projectId,taskId,itemId,revision,requestId) }
    override suspend fun sharedTaskWatch(projectId:String,taskId:String,watching:Boolean?):JSONObject =
        sharedOnlineCall { api,generation->api.sharedTaskWatch(generation,projectId,taskId,watching) }
    override suspend fun saveNotificationSettings(settings:JSONObject,revision:Int):JSONObject=sharedCall { api,generation->api.saveNotificationSettings(generation,settings,revision) }
    override suspend fun sharedTask(projectId: String, taskId: String): JSONObject =
        sharedCachedCall("task:$projectId:$taskId") { api, generation -> api.sharedTask(generation, projectId, taskId) }
    override suspend fun sharedProject(projectId: String): JSONObject =
        sharedCachedCall("project:$projectId") { api, generation -> api.sharedProject(generation, projectId) }
    override suspend fun sharedPlanning(projectId: String): JSONObject =
        sharedCachedCall("planning:$projectId") { api, generation -> api.sharedPlanning(generation, projectId) }
    override suspend fun sharedTaskArchive(space: String, query: String, cursor: String?) = sharedOnlineCall { api, generation ->
        api.querySharedTasks(generation, JSONObject().put("spaceId", SharedTaskLifecycleProtocol.id(space)).put("archived", true).put("q", query), cursor)
    }
    override suspend fun sharedTaskTrash(space: String) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "GET", "/shared/spaces/${SharedTaskLifecycleProtocol.id(space)}/trash") }
    override suspend fun sharedTaskArchiveCommand(project: String, task: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "POST", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}/archive", command) }
    override suspend fun sharedTaskTrashCommand(project: String, task: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "DELETE", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}", command) }
    override suspend fun sharedTrashRestore(space: String, kind: String, id: String, command: JSONObject) = sharedOnlineCall { api, generation ->
        require(kind in setOf("task", "project")); api.sharedTaskExtension(generation, "PATCH", "/shared/spaces/${SharedTaskLifecycleProtocol.id(space)}/trash/$kind/${SharedTaskLifecycleProtocol.id(id)}", command)
    }
    override suspend fun sharedTrashPurge(space: String, task: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "POST", "/shared/spaces/${SharedTaskLifecycleProtocol.id(space)}/trash/task/${SharedTaskLifecycleProtocol.id(task)}/purge", command) }
    override suspend fun sharedTaskFile(task: String, file: String): ByteArray {
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope)){
            SharedTaskLifecycleProtocol.id(task);SharedTaskLifecycleProtocol.id(file);val result=ru.genesis.calendar.security.NativePrivateProducts.sharedRequest(app.workspaceScope,"GET","/shared/tasks/$task/attachments/$file",null)
            val size=ru.genesis.calendar.security.E2eeCommands.integer(result.get("size"),1);check(size<=SharedTaskFilesProtocol.limit){"INVALID_TASK_FILE"};return ru.genesis.calendar.security.E2eeEnvelope.decode(result.getString("data"),size.toInt())
        }
        return sharedOnlineCall { api, generation -> api.sharedTaskFile(generation, task, file) }
    }
    override suspend fun saveSharedTaskFiles(project: String, task: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.updateSharedTask(generation, project, task, command) }
    override suspend fun sharedTaskApprove(project: String, task: String) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "POST", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}/approve", JSONObject()) }
    override suspend fun sharedTaskApprovalPreview(project:String,task:String):JSONObject?{
        if(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope))return null
        return sharedOnlineCall{api,generation->api.sharedTaskExtension(generation,"POST","/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}/approval-preview",JSONObject())}
    }
    override suspend fun sharedTaskApproveReviewed(project:String,task:String,review:JSONObject,requestId:String):JSONObject{
        check(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope)){"E2EE_SCOPE_BINDING_MISMATCH"};SharedTaskLifecycleProtocol.id(requestId)
        val held=JSONObject(review.toString());return sharedOnlineCall{api,generation->api.sharedTaskExtension(generation,"POST","/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}/approve",JSONObject().put("review",held).put("requestId",requestId))}
    }
    override suspend fun sharedTaskReview(project: String, task: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "PATCH", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}/reviews", command) }
    override suspend fun sharedTaskApprovers(project: String, task: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.updateSharedTask(generation, project, task, command) }
    override suspend fun sharedTaskReviewSettings(project: String) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "GET", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/review-settings") }
    override suspend fun saveSharedTaskReviewSettings(project: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "PATCH", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/review-settings", command) }
    override suspend fun sharedTaskSeries(project: String, task: String) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "GET", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}/series") }
    override suspend fun sharedTaskSeriesCommand(project: String, task: String, command: JSONObject) = sharedOnlineCall { api, generation -> api.sharedTaskExtension(generation, "POST", "/shared/projects/${SharedTaskLifecycleProtocol.id(project)}/tasks/${SharedTaskLifecycleProtocol.id(task)}/series", command) }
    private suspend fun <T> sharedOnlineCall(action: (AuthSessionClient, Long) -> T): T {
        val before = mutableState.value
        val account = before.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (before.accountSettings?.sharedProjectsEnabled != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!before.ready || before.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK)
        val generation = client.currentGeneration()
        fun current() {
            val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.requiresSignIn || state.accountSettings?.sharedProjectsEnabled != true || state.user?.uid != account ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        return withContext(Dispatchers.IO) { current(); action(client, generation).also { current() } }
    }
    override suspend fun sharedFieldDefinitions(space: String, project: String, archived: Boolean) = sharedOnlineCall { api, generation -> api.sharedFieldDefinitions(generation, space, project, archived) }
    override suspend fun sharedSavedViews(cursor: String?) = sharedOnlineCall { api, generation -> api.sharedSavedViews(generation, cursor) }
    override suspend fun sharedSavedView(id: String) = sharedOnlineCall { api, generation -> api.sharedSavedView(generation, id) }
    override suspend fun sharedSavedViewFields(space: String) = sharedOnlineCall { api, generation -> api.sharedSavedViewFields(generation, space) }
    private suspend fun <T> savedViewCall(action: (SavedViewDraftService) -> T): T {
        val initial = mutableState.value; val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!initial.ready || initial.accountSettings?.sharedProjectsEnabled != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration(); val caller = currentCoroutineContext()
        fun current() {
            caller.ensureActive(); val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.user?.uid != account || state.accountSettings?.sharedProjectsEnabled != true ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : SavedViewAccess {
            override fun check() = current()
            private fun online() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun view(id: String): JSONObject { online(); return client.sharedSavedView(generation, id).also { current() } }
            override fun preview(definition: JSONObject) { online(); client.querySharedTasks(generation, JSONObject().put("viewDefinition", definition), null); current() }
            override fun send(command: JSONObject): JSONObject { online(); return client.sendSharedSavedView(generation, command).also { current() } }
        }
        return withContext(Dispatchers.IO) { savedViewMutex.withLock { current(); action(SavedViewDraftService(savedViewJournal, account, access)).also { current() } } }
    }
    override suspend fun sharedSavedViewDraft() = savedViewCall { it.load() }
    override suspend fun saveSharedSavedViewDraft(stamp: String?, edit: JSONObject) = savedViewCall { it.save(stamp, edit) }
    override suspend fun prepareSharedSavedViewDraft(stamp: String) = savedViewCall { it.prepare(stamp) }
    override suspend fun sendSharedSavedViewDraft(stamp: String) = savedViewCall { it.send(stamp) }
    override suspend fun rebaseSharedSavedViewDraft(stamp: String) = savedViewCall { it.rebase(stamp) }
    override suspend fun removeSharedSavedViewDraft(stamp: String): Unit = savedViewCall { it.remove(stamp) }
    override suspend fun sharedFieldHistory(space: String, id: String) = sharedOnlineCall { api, generation -> api.sharedFieldHistory(generation, space, id) }
    override suspend fun previewSharedFieldDefinition(space: String, project: String, body: JSONObject) = sharedOnlineCall { api, generation -> api.previewSharedFieldDefinition(generation, space, project, body) }
    private suspend fun <T> fieldEditorCall(action: (SharedFieldEditorService) -> T): T {
        val initial = mutableState.value; val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!initial.ready || initial.accountSettings?.sharedProjectsEnabled != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration(); val caller = currentCoroutineContext()
        fun current() {
            caller.ensureActive(); val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.user?.uid != account || state.accountSettings?.sharedProjectsEnabled != true ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : SharedFieldEditorAccess {
            override fun check() = current()
            private fun online() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun context(space: String, project: String): JSONObject { online(); return client.sharedFieldEditorContext(generation, space, project).also { current() } }
            override fun fields(space: String, project: String): JSONObject { online(); return client.sharedFieldDefinitions(generation, space, project, true).also { current() } }
            override fun preview(space: String, project: String, request: JSONObject): JSONObject {
                online(); return client.previewSharedFieldDefinition(generation, space, project, request).also { current() }
            }
            override fun hasTaskQueue(): Boolean { current(); return sharedOffline.queued(account).isNotEmpty() }
            override fun send(space: String, payload: JSONObject): JSONObject { online(); return client.saveSharedFieldDefinition(generation, space, payload).also { current() } }
        }
        return withContext(Dispatchers.IO) { fieldEditorMutex.withLock { current(); action(SharedFieldEditorService(fieldEditorJournal, account, access)).also { current() } } }
    }
    override suspend fun sharedFieldEditor(project: String) = fieldEditorCall { it.load(project) }
    override suspend fun saveSharedFieldEditor(project: String, stamp: String?, edit: JSONObject) = fieldEditorCall { it.save(project, stamp, edit) }
    override suspend fun previewSharedFieldEditor(project: String, stamp: String) = fieldEditorCall { it.preview(project, stamp) }
    override suspend fun prepareSharedFieldEditor(project: String, stamp: String) = fieldEditorCall { it.prepare(project, stamp) }
    override suspend fun sendSharedFieldEditor(project: String, stamp: String) = fieldEditorCall { it.send(project, stamp) }
    override suspend fun rebaseSharedFieldEditor(project: String, stamp: String) = fieldEditorCall { it.rebase(project, stamp) }
    override suspend fun removeSharedFieldEditor(project: String, stamp: String): Unit = fieldEditorCall { it.remove(project, stamp) }
    override suspend fun sharedFieldEditorCopies(project: String) = fieldEditorCall { it.copies(project) }
    override suspend fun saveSharedFieldEditorCopy(project: String, id: String, stamp: String?, edit: JSONObject) = fieldEditorCall { it.saveCopy(project, id, stamp, edit) }
    override suspend fun useSharedFieldEditorCopy(project: String, id: String, copyStamp: String, stamp: String?) = fieldEditorCall { it.useCopy(project, id, copyStamp, stamp) }
    override suspend fun removeSharedFieldEditorCopy(project: String, id: String, stamp: String): Unit = fieldEditorCall { it.removeCopy(project, id, stamp) }
    override suspend fun sharedAutomations(projectId: String, deleted: Boolean, cursor: String?) = sharedOnlineCall { api, generation -> api.sharedAutomations(generation, projectId, deleted, cursor) }
    override suspend fun sharedAutomation(projectId: String, ruleId: String) = sharedOnlineCall { api, generation -> api.sharedAutomation(generation, projectId, ruleId) }
    override suspend fun sharedAutomationRuns(projectId: String, ruleId: String, cursor: String?) = sharedOnlineCall { api, generation -> api.sharedAutomationRuns(generation, projectId, ruleId, cursor) }
    override suspend fun sharedAutomationTemplate(templateId: String, language: String) = sharedOnlineCall { api, generation -> api.sharedAutomationTemplate(generation, templateId, language) }
    private suspend fun <T> automationDraftCall(action: (SharedAutomationDraftService) -> T): T {
        val initial = mutableState.value; val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!initial.ready || initial.accountSettings?.sharedProjectsEnabled != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration(); val caller = currentCoroutineContext()
        fun current() {
            caller.ensureActive(); val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.user?.uid != account || state.accountSettings?.sharedProjectsEnabled != true ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : SharedAutomationAccess {
            override fun check() = current()
            private fun online() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun rule(project: String, rule: String): JSONObject { online(); return client.sharedAutomation(generation, project, rule).also { current() } }
            override fun send(project: String, rule: String, run: String?, body: JSONObject): JSONObject {
                online(); return client.sharedAutomationCommand(generation, project, rule, run, body).also { current() }
            }
        }
        return withContext(Dispatchers.IO) { automationOperationMutex.withLock { current(); action(SharedAutomationDraftService(automationJournal, account, access)).also { current() } } }
    }
    override suspend fun sharedAutomationDraft(projectId: String) = automationDraftCall { it.load(projectId) }
    override suspend fun saveSharedAutomationDraft(projectId: String, stamp: String?, edit: JSONObject) = automationDraftCall { it.save(projectId, stamp, edit) }
    override suspend fun prepareSharedAutomationDraft(projectId: String, stamp: String) = automationDraftCall { it.prepare(projectId, stamp) }
    override suspend fun sendSharedAutomationDraft(projectId: String, stamp: String) = automationDraftCall { it.send(projectId, stamp) }
    override suspend fun removeSharedAutomationDraft(projectId: String, stamp: String): Unit = automationDraftCall { it.remove(projectId, stamp) }
    private suspend fun <T> automationEditorCall(action: (SharedAutomationEditorService) -> T): T {
        val initial = mutableState.value; val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!initial.ready || initial.accountSettings?.sharedProjectsEnabled != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration(); val caller = currentCoroutineContext()
        fun current() {
            caller.ensureActive(); val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.user?.uid != account || state.accountSettings?.sharedProjectsEnabled != true ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : SharedAutomationEditorAccess {
            override fun check() = current()
            private fun online() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun project(project: String): JSONObject { online(); return client.sharedProject(generation, project).also { current() } }
            override fun rule(project: String, rule: String): JSONObject { online(); return client.sharedAutomation(generation, project, rule).getJSONObject("rule").also { current() } }
            override fun labels(project: String): JSONArray {
                online(); val rows = JSONArray(); var cursor: String? = null; val seen = mutableSetOf<String>()
                repeat(100) {
                    val page = client.sharedBulkOptions(generation, "labels", JSONObject().put("projectIds", JSONArray().put(project)), cursor); current()
                    val options = page.getJSONArray("options"); for (index in 0 until options.length()) rows.put(options.getJSONObject(index))
                    if (!page.getBoolean("hasMore")) return rows
                    cursor = page.getString("nextCursor"); require(seen.add(cursor!!)) { "AUTOMATION_PROTOCOL" }
                }
                error("AUTOMATION_SIZE_LIMIT")
            }
            override fun template(space: String, template: String, language: String): JSONObject {
                online(); return client.sharedTemplate(generation, space, template, language, false).also { current() }
            }
            override fun hasTaskQueue(): Boolean { current(); return sharedOffline.queued(account).isNotEmpty() }
            override fun send(project: String, rule: String?, payload: JSONObject): JSONObject {
                online(); return client.saveSharedAutomation(generation, project, rule, payload).also { current() }
            }
            override fun preview(project: String, definition: JSONObject, owner: String, task: String?): JSONObject {
                online(); return client.previewSharedAutomation(generation, project, definition, owner, task).also { current() }
            }
        }
        return withContext(Dispatchers.IO) { automationEditorMutex.withLock { current(); action(SharedAutomationEditorService(automationEditorJournal, account, access)).also { current() } } }
    }
    override suspend fun sharedAutomationEditor(project: String) = automationEditorCall { it.load(project) }
    override suspend fun saveSharedAutomationEditor(project: String, stamp: String?, edit: JSONObject) = automationEditorCall { it.save(project, stamp, edit) }
    override suspend fun prepareSharedAutomationEditor(project: String, stamp: String) = automationEditorCall { it.prepare(project, stamp) }
    override suspend fun sendSharedAutomationEditor(project: String, stamp: String) = automationEditorCall { it.send(project, stamp) }
    override suspend fun previewSharedAutomationEditor(project: String, stamp: String, task: String?) = automationEditorCall { it.preview(project, stamp, task) }
    override suspend fun removeSharedAutomationEditor(project: String, stamp: String): Unit = automationEditorCall { it.remove(project, stamp) }
    override suspend fun sharedAutomationEditorCopies(project: String) = automationEditorCall { it.copies(project) }
    override suspend fun saveSharedAutomationEditorCopy(project: String, id: String, stamp: String?, edit: JSONObject) = automationEditorCall { it.saveCopy(project, id, stamp, edit) }
    override suspend fun useSharedAutomationEditorCopy(project: String, id: String, copyStamp: String, stamp: String?) = automationEditorCall { it.useCopy(project, id, copyStamp, stamp) }
    override suspend fun removeSharedAutomationEditorCopy(project: String, id: String, stamp: String): Unit = automationEditorCall { it.removeCopy(project, id, stamp) }
    override suspend fun sharedBulkScope(selection: JSONObject, cursor: String?) = sharedOnlineCall { api, generation -> api.sharedBulkScope(generation, selection, cursor) }
    override suspend fun sharedBulkReport(id: String, after: Long) = sharedOnlineCall { api, generation -> api.sharedBulkReport(generation, id, after) }
    override suspend fun sharedBulkHistory(cursor: String?) = sharedOnlineCall { api, generation -> api.sharedBulkHistory(generation, cursor) }
    override suspend fun sharedBulkOptions(kind: String, filter: JSONObject, cursor: String?) = sharedOnlineCall { api, generation -> api.sharedBulkOptions(generation, kind, filter, cursor) }
    override suspend fun sharedBulkCommand(id: String, command: String, after: Long) = sharedOnlineCall { api, generation ->
        if (command == "confirm") {
            val account = mutableState.value.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            require(sharedOffline.queued(account).isEmpty()) { "BULK_LOCAL_QUEUE" }
        }
        api.sharedBulkCommand(generation, id, command, after)
    }
    private data class BulkDraftSession(val account: String?, val generation: Long)
    private fun bulkDraftSession() = BulkDraftSession(mutableState.value.user?.uid, client.currentGeneration())
    private suspend fun <T> bulkDraftCall(session: BulkDraftSession = bulkDraftSession(), action: (SharedBulkDraftService) -> T): T {
        val initial = mutableState.value; val account = session.account ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!initial.ready || initial.accountSettings?.sharedProjectsEnabled != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = session.generation; val caller = currentCoroutineContext()
        fun current() {
            caller.ensureActive(); val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.user?.uid != account || state.accountSettings?.sharedProjectsEnabled != true ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : SharedBulkAccess {
            override fun check() = current()
            private fun online() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun hasTaskQueue(): Boolean { current(); return sharedOffline.queued(account).isNotEmpty() }
            override fun scope(selection: JSONObject): JSONObject {
                val pages = SharedBulkScopePages()
                do { online(); val page = client.sharedBulkScope(generation, selection, pages.cursor); current() } while (!pages.add(page))
                return pages.result()
            }
            override fun preview(body: JSONObject): JSONObject { online(); return client.sharedBulkPreview(generation, body).also { current() } }
        }
        return withContext(Dispatchers.IO) { bulkOperationMutex.withLock { current(); action(SharedBulkDraftService(bulkJournal, account, access, bulkInputJournal)).also { current() } } }
    }
    override val supportsSharedBulkInput = true
    override fun captureSharedBulkInputWriter(): SharedBulkInputWriter {
        val session = bulkDraftSession()
        return SharedBulkInputWriter { context, stamp, input -> bulkDraftCall(session) { it.saveInput(context, stamp, input) } }
    }
    override suspend fun sharedBulkInput(context: String) = bulkDraftCall { it.loadInput(context) }
    override suspend fun saveSharedBulkInput(context: String, stamp: String?, input: JSONObject) = bulkDraftCall { it.saveInput(context, stamp, input) }
    override suspend fun removeSharedBulkInput(context: String, stamp: String) = bulkDraftCall { it.removeInput(context, stamp) }
    override suspend fun sharedBulkDraft(projectId: String) = bulkDraftCall { it.load(projectId) }
    override suspend fun saveSharedBulkDraft(projectId: String, stamp: String?, edit: JSONObject) = bulkDraftCall { it.save(projectId, stamp, edit) }
    override suspend fun prepareSharedBulkDraft(projectId: String, stamp: String) = bulkDraftCall { it.prepare(projectId, stamp) }
    override suspend fun sendSharedBulkDraft(projectId: String, stamp: String) = bulkDraftCall { it.send(projectId, stamp) }
    override suspend fun removeSharedBulkDraft(projectId: String, stamp: String): Unit = bulkDraftCall { it.remove(projectId, stamp) }
    override suspend fun sharedProjectAccessMembers(spaceId: String) = sharedOnlineCall { api, generation -> api.sharedProjectAccessMembers(generation, spaceId) }
    override suspend fun sharedProjectAccess(spaceId: String, userId: String) = sharedOnlineCall { api, generation -> api.sharedProjectAccess(generation, spaceId, userId) }
    private suspend fun <T> projectAccessDraftCall(action: (ProjectAccessDraftService) -> T): T {
        val initial = mutableState.value
        val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!initial.ready || initial.accountSettings?.sharedProjectsEnabled != true) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val generation = client.currentGeneration()
        fun current() {
            val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.accountSettings?.sharedProjectsEnabled != true || state.user?.uid != account ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : ProjectAccessDraftAccess {
            override fun check() = current()
            private fun network() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            private fun onlineReply() { current(); if (mutableState.value.requiresSignIn) throw CancellationException() }
            override fun state(space: String, user: String): JSONObject { network(); return client.sharedProjectAccess(generation, space, user).also { onlineReply() } }
            override fun preview(space: String, user: String, draft: JSONObject): JSONObject { network(); return client.previewSharedProjectAccess(generation, space, user, draft).also { onlineReply() } }
            override fun send(space: String, user: String, body: JSONObject): JSONObject { network(); return client.saveSharedProjectAccess(generation, space, user, body).also { onlineReply() } }
            override fun hasTaskQueue(): Boolean { current(); return sharedOffline.queued(account).isNotEmpty() }
        }
        return withContext(Dispatchers.IO) { projectAccessOperationMutex.withLock {
            current(); action(ProjectAccessDraftService(projectAccessJournal, account, access)).also { current() }
        } }
    }
    override suspend fun sharedProjectAccessDraft(spaceId: String, userId: String) = projectAccessDraftCall { it.load(spaceId, userId) }
    override suspend fun saveSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String?, edit: JSONObject) = projectAccessDraftCall { it.save(spaceId, userId, stamp, edit) }
    override suspend fun previewSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = projectAccessDraftCall { it.preview(spaceId, userId, stamp) }
    override suspend fun prepareSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = projectAccessDraftCall { it.prepare(spaceId, userId, stamp) }
    override suspend fun sendSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = projectAccessDraftCall { it.send(spaceId, userId, stamp) }
    override suspend fun rebaseSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = projectAccessDraftCall { it.rebase(spaceId, userId, stamp) }
    override suspend fun removeSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String): Unit = projectAccessDraftCall { it.remove(spaceId, userId, stamp) }
    override suspend fun sharedProjectAccessCopies(spaceId: String, userId: String) = projectAccessDraftCall { it.copies(spaceId, userId) }
    override suspend fun saveSharedProjectAccessCopy(spaceId: String, userId: String, id: String, stamp: String?, edit: JSONObject) = projectAccessDraftCall { it.saveCopy(spaceId, userId, id, stamp, edit) }
    override suspend fun useSharedProjectAccessCopy(spaceId: String, userId: String, id: String, copyStamp: String, stamp: String?) = projectAccessDraftCall { it.useCopy(spaceId, userId, id, copyStamp, stamp) }
    override suspend fun removeSharedProjectAccessCopy(spaceId: String, userId: String, id: String, stamp: String): Unit = projectAccessDraftCall { it.removeCopy(spaceId, userId, id, stamp) }
    override suspend fun sharedTeamReport(options: JSONObject) = sharedOnlineCall { api, generation -> api.sharedTeamReport(generation, options) }
    override suspend fun checkSharedTeamReport(token: String) = sharedOnlineCall { api, generation -> api.checkSharedTeamReport(generation, token) }
    override suspend fun sharedTeamReportTasks(token: String, metric: String, cursor: String?) = sharedOnlineCall { api, generation -> api.sharedTeamReportTasks(generation, token, metric, cursor) }
    private fun requireDataExchange() {
        if (!(mutableState.value.accountSettings?.featureAccess ?: FeatureAccess()).allows("data-export"))
            throw AuthApiError("FEATURE_SUBSCRIPTION_REQUIRED")
    }
    override suspend fun exportSharedData(spaceId: String, command: JSONObject): JSONObject {
        requireDataExchange()
        return sharedOnlineCall { api, generation ->
            requireDataExchange()
            api.exportSharedData(generation, spaceId, command).also { requireDataExchange() }
        }
    }
    private suspend fun <T> dataImportCall(space: String, action: (DataImportDraftService) -> T): T {
        require(PlanningLifecycle.id(space))
        val initial = mutableState.value; val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        check(initial.ready && initial.accountSettings?.sharedProjectsEnabled == true)
        val generation = client.currentGeneration(); val caller = currentCoroutineContext()
        fun current() {
            caller.ensureActive(); val state = mutableState.value
            if (!client.isCurrent(generation) || !state.ready || state.user?.uid != account || state.accountSettings?.sharedProjectsEnabled != true ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
            requireDataExchange()
        }
        val access = object : DataImportAccess {
            override fun check() = current()
            private fun online() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun hasTaskQueue(project: String): Boolean = sharedOffline.queued(account).any {
                it.optString("projectId") == project || it.optJSONObject("body")?.optString("destinationProjectId") == project
            }
            override fun preview(selection: JSONObject, content: String): JSONObject { online(); return client.previewSharedData(generation, selection, content).also { current() } }
            override fun apply(selection: JSONObject, content: String, operation: String, fingerprint: String): JSONObject {
                online(); return client.applySharedData(generation, selection, content, operation, fingerprint).also { current() }
            }
            override fun imports(space: String, cursor: String?): JSONObject { online(); return client.sharedDataImports(generation, space, cursor).also { current() } }
            override fun undo(import: String): JSONObject { online(); return client.undoSharedData(generation, import).also { current() } }
            override fun history(project: String, cursor: String?): JSONObject { online(); return client.sharedDataHistory(generation, project, cursor).also { current() } }
        }
        return withContext(Dispatchers.IO) { importOperationMutex.withLock {
            current(); action(DataImportDraftService(importJournal, importUndoJournal, importSources, account, space, access)).also { current() }
        } }
    }
    override suspend fun sharedDataImportDraft(spaceId: String, projectId: String) = dataImportCall(spaceId) { it.load(projectId) }
    override suspend fun sharedDataImportHeaders(spaceId: String, projectId: String, stamp: String, delimiter: String) = dataImportCall(spaceId) { it.headers(projectId, stamp, delimiter) }
    override suspend fun chooseSharedDataImportSource(spaceId: String, projectId: String, stamp: String?, name: String, selection: JSONObject, open: () -> java.io.InputStream) =
        dataImportCall(spaceId) { it.choose(projectId, stamp, name, open, selection) }
    override suspend fun saveSharedDataImportDraft(spaceId: String, projectId: String, stamp: String?, edit: JSONObject) = dataImportCall(spaceId) { it.save(projectId, stamp, edit) }
    override suspend fun inspectSharedDataImport(spaceId: String, projectId: String, stamp: String) = dataImportCall(spaceId) { it.inspect(projectId, stamp) }
    override suspend fun prepareSharedDataImport(spaceId: String, projectId: String, stamp: String) = dataImportCall(spaceId) { it.prepare(projectId, stamp) }
    override suspend fun sendSharedDataImport(spaceId: String, projectId: String, stamp: String) = dataImportCall(spaceId) { it.send(projectId, stamp) }
    override suspend fun removeSharedDataImportDraft(spaceId: String, projectId: String, stamp: String): Unit = dataImportCall(spaceId) { it.remove(projectId, stamp) }
    override suspend fun sharedDataImportCopies(spaceId: String, projectId: String) = dataImportCall(spaceId) { it.copies(projectId) }
    override suspend fun saveSharedDataImportCopy(spaceId: String, projectId: String, id: String, stamp: String?, edit: JSONObject) = dataImportCall(spaceId) { it.saveCopy(projectId, id, stamp, edit) }
    override suspend fun useSharedDataImportCopy(spaceId: String, projectId: String, id: String, copyStamp: String, stamp: String?) = dataImportCall(spaceId) { it.useCopy(projectId, id, copyStamp, stamp) }
    override suspend fun removeSharedDataImportCopy(spaceId: String, projectId: String, id: String, stamp: String): Unit = dataImportCall(spaceId) { it.removeCopy(projectId, id, stamp) }
    override suspend fun sharedDataImports(spaceId: String, cursor: String?) = dataImportCall(spaceId) { it.imports(cursor) }
    override suspend fun pendingSharedDataUndos(spaceId: String) = dataImportCall(spaceId) { it.pendingUndos() }
    override suspend fun sharedDataUndoOutcomes(spaceId: String) = dataImportCall(spaceId) { it.undoOutcomes() }
    override suspend fun undoSharedDataImport(spaceId: String, receipt: JSONObject) = dataImportCall(spaceId) { it.undo(receipt) }
    override suspend fun sharedDataHistory(projectId: String, cursor: String?) = sharedOnlineCall { api, generation -> api.sharedDataHistory(generation, projectId, cursor) }
    override suspend fun sharedSprintReport(projectId: String, sprintId: String, unit: String): JSONObject =
        sharedOnlineCall { api, generation -> api.sharedSprintReport(generation, projectId, sprintId, unit) }
    override suspend fun checkSharedSprintReport(projectId: String, sprintId: String, token: String): JSONObject =
        sharedOnlineCall { api, generation -> api.checkSharedSprintReport(generation, projectId, sprintId, token) }
    override suspend fun sharedSprintReportSources(projectId: String, sprintId: String, token: String, query: JSONObject, cursor: String?): JSONObject =
        sharedOnlineCall { api, generation -> api.sharedSprintReportSources(generation, projectId, sprintId, token, query, cursor) }
    override suspend fun sharedSprintSourceTask(projectId: String, taskId: String, archived: Boolean): JSONObject =
        sharedOnlineCall { api, generation -> api.sharedSprintSourceTask(generation, projectId, taskId, archived) }
    override suspend fun sharedWorkflow(projectId: String): JSONObject {
        val initial = mutableState.value
        val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        check(initial.ready && initial.accountSettings?.sharedProjectsEnabled == true)
        val generation = client.currentGeneration()
        fun current() {
            if (!client.isCurrent(generation) || mutableState.value.user?.uid != account ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        return withContext(Dispatchers.IO) {
            current()
            try {
                if (initial.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK)
                val result = WorkflowLifecycle.snapshot(projectId, client.sharedWorkflow(generation, projectId)); current()
                runCatching { sharedOffline.saveSnapshot(account, "workflow:$projectId", result) }
                current(); result
            } catch (failure: AuthFailure) {
                current()
                if (failure.kind == AuthFailure.Kind.NETWORK) {
                    val cached = sharedOffline.snapshot(account, "workflow:$projectId") ?: throw failure
                    current(); WorkflowLifecycle.snapshot(projectId, cached)
                } else {
                    if (failure.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.NOT_DEPLOYED)) sharedOffline.clearSnapshots(account)
                    throw failure
                }
            }
        }
    }
    override suspend fun sharedWorkflowHistory(projectId: String, before: Long?): JSONObject =
        sharedCall { api, generation -> api.sharedWorkflowHistory(generation, projectId, before) }
    override suspend fun sharedWorkflowRepairProjects(spaceId: String): JSONObject = sharedCall { api, generation ->
        val items = PlanningLifecycle.rows(api.sharedWorkflowRepairProjects(generation, spaceId).getJSONArray("items"))
        JSONObject().put("projects", JSONArray(items.filter { it.getString("kind") == "project" }.distinctBy { it.getString("projectId") }.map {
            JSONObject().put("id", it.getString("projectId")).put("title", it.getString("projectTitle"))
        }))
    }
    private suspend fun <T> workflowDraftCall(action: (WorkflowDraftService) -> T): T {
        val initial = mutableState.value
        val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        check(initial.ready && initial.accountSettings?.sharedProjectsEnabled == true)
        val generation = client.currentGeneration()
        fun current() {
            if (!client.isCurrent(generation) || mutableState.value.user?.uid != account ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : WorkflowDraftAccess {
            override fun check() = current()
            private fun network() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun workflow(project: String): JSONObject { network(); return client.sharedWorkflow(generation, project).also { current() } }
            override fun hasTaskQueue(project: String): Boolean { current(); return sharedOffline.queued(account).any {
                it.optString("projectId") == project || it.optJSONObject("body")?.optString("destinationProjectId") == project
            } }
            override fun send(project: String, body: JSONObject): JSONObject { network(); return client.saveSharedWorkflow(generation, project, body).also { current() } }
        }
        return withContext(Dispatchers.IO) { workflowOperationMutex.withLock {
            current(); action(WorkflowDraftService(workflowJournal, account, access)).also { current() }
        } }
    }
    override suspend fun sharedWorkflowDraft(projectId: String) = workflowDraftCall { it.load(projectId) }
    override suspend fun sharedWorkflowCopies(projectId: String) = workflowDraftCall { it.copies(projectId) }
    override suspend fun saveSharedWorkflowDraft(projectId: String, stamp: String?, edit: JSONObject) = workflowDraftCall { it.save(projectId, stamp, edit) }
    override suspend fun prepareSharedWorkflowDraft(projectId: String, stamp: String) = workflowDraftCall { it.prepare(projectId, stamp) }
    override suspend fun sendSharedWorkflowDraft(projectId: String, stamp: String) = workflowDraftCall { it.send(projectId, stamp) }
    override suspend fun rebaseSharedWorkflowDraft(projectId: String, stamp: String) = workflowDraftCall { it.rebase(projectId, stamp) }
    override suspend fun removeSharedWorkflowDraft(projectId: String, stamp: String): Unit = workflowDraftCall { it.remove(projectId, stamp) }
    override suspend fun saveSharedWorkflowCopy(projectId: String, id: String, stamp: String?, edit: JSONObject) = workflowDraftCall { it.saveCopy(projectId, id, stamp, edit) }
    override suspend fun useSharedWorkflowCopy(projectId: String, id: String, copyStamp: String, stamp: String?) = workflowDraftCall { it.useCopy(projectId, id, copyStamp, stamp) }
    override suspend fun removeSharedWorkflowCopy(projectId: String, id: String, stamp: String): Unit = workflowDraftCall { it.removeCopy(projectId, id, stamp) }
    override suspend fun sharedTemplates(space: String, language: String, deleted: Boolean, cursor: String?) =
        sharedOnlineCall { api, generation -> api.sharedTemplates(generation, space, language, deleted, cursor) }
    override suspend fun sharedTemplate(space: String, id: String, language: String, deleted: Boolean) =
        sharedOnlineCall { api, generation -> api.sharedTemplate(generation, space, id, language, deleted) }
    override suspend fun previewSharedTemplate(space: String, id: String, request: JSONObject) =
        sharedOnlineCall { api, generation -> api.previewSharedTemplate(generation, space, id, request) }
    private suspend fun <T> templateDraftCall(action: (SharedTemplateDraftService) -> T): T {
        val initial = mutableState.value
        val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        check(initial.ready && initial.accountSettings?.sharedProjectsEnabled == true)
        val generation = client.currentGeneration()
        fun current() {
            if (!client.isCurrent(generation) || mutableState.value.user?.uid != account || app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : SharedTemplateAccess {
            override fun check() = current()
            private fun online() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun project(id: String): JSONObject { online(); return client.sharedProject(generation, id).getJSONObject("project").also { current() } }
            override fun source(space: String, id: String, language: String, deleted: Boolean): JSONObject {
                online(); return client.sharedTemplate(generation, space, id, language, deleted).also { current() }
            }
            override fun preview(id: String, request: JSONObject): JSONObject {
                online(); return client.previewSharedTemplate(generation, request.getString("spaceId"), id, request).also { current() }
            }
            override fun hasTaskQueue(): Boolean { current(); return sharedOffline.queued(account).isNotEmpty() }
            override fun send(command: JSONObject): JSONObject { online(); return client.sharedTemplateCommand(generation, command).also { current() } }
        }
        return withContext(Dispatchers.IO) { templateOperationMutex.withLock {
            current(); action(SharedTemplateDraftService(templateJournal, account, access)).also { current() }
        } }
    }
    override suspend fun sharedTemplateDraft(project: String) = templateDraftCall { it.load(project) }
    override suspend fun saveSharedTemplateDraft(project: String, stamp: String?, edit: JSONObject) = templateDraftCall { it.save(project, stamp, edit) }
    override suspend fun prepareSharedTemplateDraft(project: String, stamp: String) = templateDraftCall { it.prepare(project, stamp) }
    override suspend fun sendSharedTemplateDraft(project: String, stamp: String) = templateDraftCall { it.send(project, stamp) }
    override suspend fun removeSharedTemplateDraft(project: String, stamp: String): Unit = templateDraftCall { it.remove(project, stamp) }
    override suspend fun sharedTemplateCopies(project: String) = templateDraftCall { it.copies(project) }
    override suspend fun saveSharedTemplateCopy(project: String, id: String, stamp: String?, edit: JSONObject) = templateDraftCall { it.saveCopy(project, id, stamp, edit) }
    override suspend fun useSharedTemplateCopy(project: String, id: String, copyStamp: String, stamp: String?) = templateDraftCall { it.useCopy(project, id, copyStamp, stamp) }
    override suspend fun removeSharedTemplateCopy(project: String, id: String, stamp: String): Unit = templateDraftCall { it.removeCopy(project, id, stamp) }

    private suspend fun <T> planningDraftCall(action: (PlanningDraftService) -> T): T {
        val initial = mutableState.value
        val account = initial.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        check(initial.ready && initial.accountSettings?.sharedProjectsEnabled == true)
        val generation = client.currentGeneration()
        fun current() {
            if (!client.isCurrent(generation) || mutableState.value.user?.uid != account ||
                app.workspaceScope != CloudAccountSnapshot.scopeFor(account)) throw CancellationException()
        }
        val access = object : PlanningDraftAccess {
            override fun check() = current()
            private fun network() { current(); if (mutableState.value.requiresSignIn) throw AuthFailure(AuthFailure.Kind.NETWORK) }
            override fun planning(projectId: String): JSONObject { network(); return client.sharedPlanning(generation, projectId).also { current() } }
            override fun tasks(filter: JSONObject, cursor: String?): JSONObject { network(); return client.querySharedTasks(generation, filter, cursor).also { current() } }
            override fun hasTaskQueue(projectId: String): Boolean { current(); return sharedOffline.queued(account).any { it.optString("projectId") == projectId } }
            override fun send(projectId: String, command: JSONObject): JSONObject { network(); return client.sharedPlanningCommand(generation, projectId, command).also { current() } }
        }
        return withContext(Dispatchers.IO) { planningOperationMutex.withLock {
            current(); action(PlanningDraftService(planningJournal, account, access)).also { current() }
        } }
    }
    override suspend fun sharedPlanningDraft(projectId: String): JSONObject? = planningDraftCall { it.load(projectId) }
    override suspend fun sharedPlanningCopies(projectId: String): List<JSONObject> = planningDraftCall { it.copies(projectId) }
    override suspend fun saveSharedPlanningCopy(projectId: String, id: String, stamp: String?, edit: JSONObject): JSONObject =
        planningDraftCall { it.saveCopy(projectId, id, stamp, edit) }
    override suspend fun useSharedPlanningCopy(projectId: String, id: String, copyStamp: String, stamp: String?): JSONObject =
        planningDraftCall { it.useCopy(projectId, id, copyStamp, stamp) }
    override suspend fun removeSharedPlanningCopy(projectId: String, id: String, stamp: String): Unit =
        planningDraftCall { it.removeCopy(projectId, id, stamp) }
    override suspend fun saveSharedPlanningDraft(projectId: String, stamp: String?, edit: JSONObject): JSONObject =
        planningDraftCall { it.save(projectId, stamp, edit) }
    override suspend fun prepareSharedPlanningDraft(projectId: String, stamp: String): JSONObject =
        planningDraftCall { it.prepare(projectId, stamp) }
    override suspend fun sendSharedPlanningDraft(projectId: String, stamp: String): JSONObject =
        planningDraftCall { it.send(projectId, stamp) }
    override suspend fun rebaseSharedPlanningDraft(projectId: String, stamp: String): JSONObject =
        planningDraftCall { it.rebase(projectId, stamp) }
    override suspend fun prepareSharedSprintCompletion(projectId: String, sprintId: String, stamp: String?): JSONObject =
        planningDraftCall { it.completion(projectId, sprintId, stamp) }
    override suspend fun removeSharedPlanningDraft(projectId: String, stamp: String): Unit =
        planningDraftCall { it.remove(projectId, stamp) }
    override suspend fun sharedGoogleSettings(projectId: String): JSONObject =
        sharedCall { api, generation -> api.sharedGoogleSettings(generation, projectId) }
    override suspend fun updateSharedGoogleSettings(projectId: String, tasksEnabled: Boolean, calendarEnabled: Boolean): JSONObject =
        sharedCall { api, generation -> api.updateSharedGoogleSettings(generation, projectId,
            JSONObject().put("tasksEnabled", tasksEnabled).put("calendarEnabled", calendarEnabled)) }
    override suspend fun syncSharedGoogle(projectId: String): JSONObject =
        sharedCall { api, generation -> api.syncSharedGoogle(generation, projectId) }
    override suspend fun updateSharedProject(projectId: String, changes: JSONObject): JSONObject =
        sharedCall { api, generation -> api.updateSharedProject(generation, projectId, changes) }
    override suspend fun setSharedProjectArchived(projectId: String, archived: Boolean): JSONObject =
        sharedCall { api, generation -> api.setSharedProjectArchived(generation, projectId, archived) }
    override suspend fun createSharedStatus(projectId: String, title: String, isDone: Boolean,
        requestId: String): JSONObject =
        sharedCall { api, generation -> api.createSharedStatus(generation, projectId,
            JSONObject().put("title", title).put("isDone", isDone).put("requestId", requestId)) }
    override suspend fun createSharedBoard(projectId: String, title: String, isDone: Boolean, color: String,
        requestId: String): JSONObject =
        sharedCall { api, generation -> api.createSharedStatus(generation, projectId,
            JSONObject().put("title", title).put("isDone", isDone).put("color", color).put("requestId", requestId)) }
    suspend fun updateSharedStatus(projectId: String, statusId: String, title: String, revision: Int): JSONObject =
        sharedCall { api, generation -> api.updateSharedStatus(generation, projectId, statusId,
            JSONObject().put("title", title).put("expectedRevision", revision)) }
    override suspend fun deleteSharedStatus(projectId: String, statusId: String, destinationId: String, revision: Int): JSONObject =
        sharedCall { api, generation -> api.deleteSharedStatus(generation, projectId, statusId,
            JSONObject().put("destinationStatusId", destinationId).put("expectedRevision", revision)) }
    override suspend fun createSharedCategory(projectId: String, title: String, color: String): JSONObject =
        sharedCall { api, generation -> api.createSharedCategory(generation, projectId,
            JSONObject().put("title", title).put("color", color)) }
    override suspend fun updateSharedCategory(projectId: String, categoryId: String,
        title: String, color: String, revision: Int): JSONObject =
        sharedCall { api, generation -> api.updateSharedCategory(generation, projectId, categoryId,
            JSONObject().put("title", title).put("color", color).put("expectedRevision", revision)) }
    override suspend fun deleteSharedCategory(projectId: String, categoryId: String, revision: Int): JSONObject =
        sharedCall { api, generation -> api.deleteSharedCategory(generation, projectId, categoryId,
            JSONObject().put("expectedRevision", revision)) }
    override suspend fun changeSharedMemberRole(projectId: String, userId: String, role: String): JSONObject =
        sharedCall { api, generation -> api.changeSharedMemberRole(generation, projectId, userId, role) }
    override suspend fun changeSharedSpaceRole(spaceId: String, userId: String, role: String,
        canOrganizeTasks: Boolean?): JSONObject =
        sharedCall { api, generation -> api.changeSharedSpaceRole(generation, spaceId, userId, role, canOrganizeTasks) }
    override suspend fun removeSharedMember(projectId: String, userId: String): JSONObject =
        sharedCall { api, generation -> api.removeSharedMember(generation, projectId, userId) }
    override suspend fun createSharedTask(projectId: String, title: String, statusId: String,
        categoryId: String?): JSONObject =
        createSharedTask(projectId, JSONObject().put("title", title).put("statusId", statusId)
            .put("categoryId", categoryId ?: JSONObject.NULL))
    override suspend fun createSharedTask(projectId: String, fields: JSONObject): JSONObject = sharedTaskCall { api, generation ->
        val privateOwner=mutableState.value.user?.uid?:throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(privateOwner)))return@sharedTaskCall (api?:error("E2EE_UNLOCK_REQUIRED")).createSharedTask(generation,projectId,JSONObject(fields.toString()).put("requestId",UUID.randomUUID().toString()))
        if (fields.has("sourceTaskId") || fields.has("mindmapSource")) return@sharedTaskCall api?.createSharedTask(generation, projectId, fields)
            ?: throw AuthFailure(AuthFailure.Kind.NETWORK)
        val userId = mutableState.value.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val requestId = UUID.randomUUID().toString()
        val body = JSONObject(fields.toString()).put("requestId", requestId)
        sharedOffline.enqueue(userId, JSONObject().put("requestId", requestId).put("projectId", projectId)
            .put("kind", "create")
            .put("title", fields.optString("title")).put("body", body).put("queuedAt", System.currentTimeMillis()))
        try {
            (api?.createSharedTask(generation, projectId, body)
                ?: throw AuthFailure(AuthFailure.Kind.NETWORK)).also {
                confirmedSharedReceipt("create", projectId, null, body, it)
                sharedOffline.remove(userId, requestId)
            }
        } catch (error: AuthFailure) {
            if (definiteSharedRejection(error)) {
                sharedOffline.remove(userId, requestId)
                throw error
            }
            JSONObject().put("task", JSONObject(fields.toString()).put("id", "pending:$requestId")
                .put("projectId", projectId).put("revision", 0).put("pending", true))
        }
    }
    override suspend fun queuedSharedTasks(projectId: String): List<JSONObject> = withContext(Dispatchers.IO) {
        val userId = mutableState.value.user?.uid ?: return@withContext emptyList()
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(userId)))return@withContext ru.genesis.calendar.security.NativePrivateProducts.sharedPending(CloudAccountSnapshot.scopeFor(userId),projectId).map{item->val request=item.getJSONObject("request");val body=request.getJSONObject("body");JSONObject().put("requestId",request.get("id")).put("projectId",item.get("resourceId")).put("kind",if(request.getString("method")=="POST")"create"else"update").put("title",body.optString("title")).put("body",body).put("queuedAt",java.time.Instant.parse(request.getString("createdAt")).toEpochMilli())}
        sharedOffline.queued(userId).filter { it.optString("projectId") == projectId }
    }
    fun pendingSharedMutationsCount(): Int = mutableState.value.user?.uid?.let { if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(it))) {if(ru.genesis.calendar.security.NativePrivateProducts.isOpen(CloudAccountSnapshot.scopeFor(it)))ru.genesis.calendar.security.NativePrivateProducts.sharedPendingCount(CloudAccountSnapshot.scopeFor(it))else 0}else sharedOffline.queued(it).size } ?: 0
    override suspend fun discardFailedSharedMutation(requestId: String): Unit = withContext(Dispatchers.IO) {
        val userId = mutableState.value.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        check(!ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(userId))){"E2EE_SHARED_PENDING_REVIEW_REQUIRED"}
        check(sharedOffline.queued(userId).any {
            it.optString("requestId") == requestId && it.optString("error").isNotBlank()
        }) { "SHARED_DRAFT_NOT_FOUND" }
        sharedOffline.remove(userId, requestId)
    }
    override suspend fun retryFailedSharedMutation(requestId: String): JSONObject = sharedTaskCall { api, generation ->
        val userId = mutableState.value.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(userId)))return@sharedTaskCall kotlinx.coroutines.runBlocking{ru.genesis.calendar.security.NativePrivateProducts.resumeShared(CloudAccountSnapshot.scopeFor(userId),requestId)}
        val item = sharedOffline.queued(userId).firstOrNull {
            it.optString("requestId") == requestId && it.optString("error").isNotBlank()
        } ?: throw IllegalStateException("SHARED_DRAFT_NOT_FOUND")
        val endpoint = api ?: throw AuthFailure(AuthFailure.Kind.NETWORK)
        try {
            val response = when (item.optString("kind", "create")) {
                "create" -> endpoint.createSharedTask(generation, item.getString("projectId"), item.getJSONObject("body"))
                "update" -> endpoint.updateSharedTask(generation, item.getString("projectId"), item.getString("taskId"), item.getJSONObject("body"))
                "move" -> endpoint.moveSharedTask(generation, item.getString("projectId"), item.getString("taskId"), item.getJSONObject("body"))
                else -> throw IllegalStateException("Unknown shared mutation")
            }
            confirmedSharedReceipt(item.optString("kind", "create"), item.getString("projectId"), item.optString("taskId").takeIf { it.isNotBlank() }, item.getJSONObject("body"), response)
            sharedOffline.remove(userId, requestId)
            response
        } catch (error: AuthFailure) {
            if (error.kind != AuthFailure.Kind.NETWORK) sharedOffline.markError(userId, requestId, sharedFailureCode(error))
            throw error
        }
    }
    override suspend fun flushSharedOfflineTasks(): Int = sharedCall { api, generation ->
        val userId = mutableState.value.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(userId)))return@sharedCall JSONObject().put("synced",kotlinx.coroutines.runBlocking{ru.genesis.calendar.security.NativePrivateProducts.flushShared(CloudAccountSnapshot.scopeFor(userId))})
        var synced = 0
        for (item in sharedOffline.queued(userId)) {
            if (item.optString("error").isNotBlank()) continue
            if (System.currentTimeMillis() - item.optLong("queuedAt", 0) > 89L * 24 * 60 * 60 * 1000) {
                sharedOffline.markError(userId, item.getString("requestId"), "EXPIRED_SHARED_DRAFT")
                continue
            }
            try {
                val response = when (item.optString("kind", "create")) {
                    "create" -> api.createSharedTask(generation, item.getString("projectId"), item.getJSONObject("body"))
                    "update" -> api.updateSharedTask(generation, item.getString("projectId"),
                        item.getString("taskId"), item.getJSONObject("body"))
                    "move" -> api.moveSharedTask(generation, item.getString("projectId"),
                        item.getString("taskId"), item.getJSONObject("body"))
                    else -> throw IllegalStateException("Unknown shared mutation")
                }
                confirmedSharedReceipt(item.optString("kind", "create"), item.getString("projectId"), item.optString("taskId").takeIf { it.isNotBlank() }, item.getJSONObject("body"), response)
                sharedOffline.remove(userId, item.getString("requestId"))
                synced++
            } catch (error: AuthFailure) {
                if (error.kind == AuthFailure.Kind.NETWORK) break
                sharedOffline.markError(userId, item.getString("requestId"), sharedFailureCode(error))
            }
        }
        JSONObject().put("synced", synced)
    }.optInt("synced")
    suspend fun publishPrivateTask(projectId: String, fields: JSONObject): JSONObject =
        sharedCall { api, generation -> api.createSharedTask(generation, projectId, fields) }
    private suspend fun sendSharedTaskChange(projectId: String, taskId: String, changes: JSONObject,
        kind: String): JSONObject = sharedTaskCall { api, generation ->
        val userId = mutableState.value.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(CloudAccountSnapshot.scopeFor(userId))){
            val endpoint=api?:error("E2EE_UNLOCK_REQUIRED");val body=JSONObject(changes.toString()).put("requestId",UUID.randomUUID().toString())
            return@sharedTaskCall if(kind=="move")endpoint.moveSharedTask(generation,projectId,taskId,body)else endpoint.updateSharedTask(generation,projectId,taskId,body)
        }
        check(sharedOffline.queued(userId).none {
            it.optString("taskId") == taskId
        }) { "SHARED_TASK_PENDING" }
        val requestId = UUID.randomUUID().toString()
        val body = JSONObject(changes.toString()).put("requestId", requestId)
        sharedOffline.enqueue(userId, JSONObject().put("requestId", requestId).put("projectId", projectId)
            .put("taskId", taskId).put("kind", kind).put("body", body)
            .put("title", changes.optString("title", taskId)).put("queuedAt", System.currentTimeMillis()))
        try {
            val response = if (kind == "move") api?.moveSharedTask(generation, projectId, taskId, body)
                else api?.updateSharedTask(generation, projectId, taskId, body)
            if (response == null) throw AuthFailure(AuthFailure.Kind.NETWORK)
            confirmedSharedReceipt(kind, projectId, taskId, body, response)
            sharedOffline.remove(userId, requestId)
            response
        } catch (error: AuthFailure) {
            if (definiteSharedRejection(error)) {
                sharedOffline.remove(userId, requestId)
                throw error
            }
            JSONObject().put("task", JSONObject().put("id", taskId).put("projectId",
                if (kind == "move") changes.optString("destinationProjectId", projectId) else projectId)
                .put("revision", changes.optInt("expectedRevision")).put("pending", true))
        }
    }
    override suspend fun updateSharedTask(projectId: String, taskId: String, changes: JSONObject): JSONObject =
        sendSharedTaskChange(projectId, taskId, changes, "update")
    override suspend fun moveSharedTask(projectId: String, taskId: String, changes: JSONObject): JSONObject =
        sendSharedTaskChange(projectId, taskId, changes, "move")
    suspend fun inviteSharedMember(projectId: String, email: String, role: String): JSONObject =
        sharedCall { api, generation -> api.inviteSharedMember(generation, projectId,
            JSONObject().put("email", email).put("role", role)) }
    override suspend fun sharedInvitations(): JSONObject =
        sharedInvitationCall { api, generation -> api.sharedInvitations(generation) }
    suspend fun sharedNotifications(): JSONObject = sharedCall { api, generation -> api.sharedNotifications(generation) }
    suspend fun readSharedNotifications(ids: List<String>): JSONObject = sharedCall { api, generation ->
        api.readSharedNotifications(generation, JSONArray(ids))
    }
    override suspend fun acceptSharedInvitation(id: String): JSONObject {
        val userId = mutableState.value.user?.uid
        val result = sharedInvitationCall { api, generation ->
            api.acceptSharedInvitation(generation, JSONObject().put("id", id)) }
        // The server enables shared projects on acceptance. Enable the same local gate
        // before the destination screen makes its first workspace request.
        val current = mutableState.value
        if (current.user?.uid == userId && !current.requiresSignIn) {
            mutableState.value = current.copy(accountSettings = current.accountSettings?.copy(sharedProjectsEnabled = true))
        }
        return result
    }
    override suspend fun rejectSharedInvitation(id: String): JSONObject =
        sharedInvitationCall { api, generation -> api.rejectSharedInvitation(generation, id) }
    override suspend fun sharedComments(projectId: String, taskId: String): JSONObject =
        sharedCachedCall("comments:$projectId:$taskId") { api, generation ->
            api.sharedComments(generation, projectId, taskId) }
    override suspend fun olderSharedComments(projectId: String, taskId: String, before: String): JSONObject =
        sharedCachedCall("comments:$projectId:$taskId:$before") { api, generation ->
            api.olderSharedComments(generation, projectId, taskId, before) }
    override suspend fun addSharedComment(projectId: String, taskId: String, body: String): JSONObject =
        sharedCall { api, generation -> api.addSharedComment(generation, projectId, taskId,
            JSONObject().put("body", body)) }

    suspend fun deleteAdminUser(userId: String, blacklist: Boolean): JSONObject = adminOnlineCall { api, generation -> api.deleteAdminUser(generation, userId, blacklist) }

    /** Process-start check only. Recomposition and configuration changes must not restart auth. */
    fun ensureSession() {
        if (mutableState.value.checkedAt != null || operation?.isActive == true) return
        checkSession()
    }

    fun checkSession() = checkSession(inBackground = false)

    private fun checkSession(inBackground: Boolean) = start("Проверяем серверную сессию…", inBackground) { generation ->
        if (mutableState.value.user == null) {
            val cached = withContext(Dispatchers.IO) { CachedAccountEntry(app).read(app.workspaceScope) }
            if (cached != null) publish(generation, AuthPanelState(busy = true, ready = true,
                user = cached.identity, accountSettings = cached.settings,
                message = "Открыта защищённая локальная копия. Проверяем связь с облаком…"))
        }
        val payload = withContext(Dispatchers.IO) { client.session(generation) }
        val identity = AuthProtocol.identity(payload)
        if (identity == null) {
            requireSignIn(generation)
        }
        else completeSignedIn(generation, payload, "Сессия подтверждена; зашифрованное пространство прочитано.")
    }

    fun signIn(activity: Activity, preferredLanguage: String? = null) = start("Готовим защищённый вход…") { generation ->
        AuthDiagnostics.event("GOOGLE_AUTH_STARTED")
        // A fresh server challenge must exist before any provider UI/token request.
        withContext(Dispatchers.IO) { client.session(generation) }
        // Google Play services may retain a stale provider selection after the native
        // session has expired. Reset only the provider state (never local GENESIS data)
        // so every consumer or Workspace account can be selected on each new sign-in.
        resetCredentialProvider()
        val challenge = withContext(Dispatchers.IO) { AuthProtocol.challenge(client.challenge(generation)) }
        if (!client.isCurrent(generation)) throw CancellationException()
        val option = GetSignInWithGoogleOption.Builder(challenge.serverClientId).setNonce(challenge.nonce).build()
        val result = credentials.getCredential(activity, GetCredentialRequest.Builder().addCredentialOption(option).build())
        AuthDiagnostics.event("GOOGLE_AUTH_SUCCESS")
        if (!client.isCurrent(generation)) throw CancellationException()
        val credential = result.credential
        if (credential !is CustomCredential || credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL)
            throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val token = GoogleIdTokenCredential.createFrom(credential.data).idToken
        AuthDiagnostics.event("GOOGLE_ID_TOKEN_RECEIVED")
        val payload = withContext(Dispatchers.IO) { client.authenticate(generation, token) }
        AuthDiagnostics.event("BACKEND_AUTH_SUCCESS")
        val newAccount = AuthProtocol.googleLinkAction(payload) == "created"
        when (AuthProtocol.googleLinkAction(payload)) {
            "found" -> AuthDiagnostics.event("GOOGLE_LINK_FOUND")
            "created" -> AuthDiagnostics.event("GOOGLE_LINK_CREATED")
        }
        completeSignedIn(generation, payload, "Вход подтверждён. Облачные данные расшифрованы автоматически.",
            preferredLanguage, newAccount)
    }

    fun signInWithYandex(accessToken: String, preferredLanguage: String? = null) =
        start("Проверяем вход через Яндекс…") { generation ->
            withContext(Dispatchers.IO) { client.session(generation) }
            val payload = withContext(Dispatchers.IO) { client.authenticateYandex(generation, accessToken) }
            completeSignedIn(generation, payload,
                "Вход через Яндекс подтверждён. Защищённое пространство открыто.", preferredLanguage,
                payload.optBoolean("newAccount"))
        }

    fun connectGoogleServices(activity: Activity, launchResolution: (PendingIntent) -> Unit,
        onCompletedWithoutResolution: () -> Unit = {}) =
        start("Готовим разрешения Google Calendar и Tasks…") { generation ->
            val identity = mutableState.value.user ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            val access = GoogleServiceAccess.primary(mutableState.value.accountSettings)
            val serverClientId = withContext(Dispatchers.IO) {
                AuthProtocol.serverClientId(client.googleServicesConfig(generation))
            }
            if (!client.isCurrent(generation)) throw CancellationException()
            val request = AuthorizationRequest.builder()
                .setRequestedScopes(access.scopesForConsent().map(::Scope))
                .requestOfflineAccess(serverClientId)
                // Always make the hand-off visible. SELECT_ACCOUNT also avoids an
                // immediate silent failure when the GENESIS session email is not
                // currently registered as an Android account on this device.
                .setPrompt(AuthorizationRequest.Prompt.CONSENT or AuthorizationRequest.Prompt.SELECT_ACCOUNT)
                .build()
            val authorization = try {
                Identity.getAuthorizationClient(activity).authorize(request).awaitResult()
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                throw GoogleServicesAuthorizationException()
            }
            if (!client.isCurrent(generation)) throw CancellationException()
            if (authorization.hasResolution()) {
                val pendingIntent = authorization.pendingIntent ?: throw GoogleServicesAuthorizationException()
                pendingServicesUserId = identity.uid
                publish(generation, mutableState.value.copy(busy = false,
                    message = "Подтвердите доступ к Google Calendar и Tasks в окне Google."))
                launchResolution(pendingIntent)
            } else {
                finishGoogleServicesAuthorization(generation, identity.uid, authorization)
                onCompletedWithoutResolution()
            }
        }

    fun completeGoogleServicesAuthorization(activity: Activity, data: Intent?, onCompleted: () -> Unit = {}) {
        val expectedUserId = pendingServicesUserId ?: return
        pendingServicesUserId = null
        start("Сохраняем разрешения Google…") { generation ->
            if (mutableState.value.user?.uid != expectedUserId || data == null) {
                throw GoogleServicesAuthorizationException()
            }
            val result = try {
                Identity.getAuthorizationClient(activity).getAuthorizationResultFromIntent(data)
            } catch (_: Exception) {
                throw GoogleServicesAuthorizationException()
            }
            finishGoogleServicesAuthorization(generation, expectedUserId, result)
            if (client.isCurrent(generation)) onCompleted()
        }
    }

    fun cancelGoogleServicesAuthorization() {
        pendingServicesUserId = null
        mutableState.value = mutableState.value.copy(busy = false,
            message = "Подключение Google Calendar и Tasks отменено. Данные и прежние разрешения не изменены.")
    }

    private suspend fun finishGoogleServicesAuthorization(generation: Long, expectedUserId: String,
        authorization: AuthorizationResult) {
        val code = authorization.serverAuthCode?.takeIf { it.isNotBlank() }
            ?: throw GoogleServicesAuthorizationException()
        val payload = withContext(Dispatchers.IO) { client.authorizeGoogleServices(generation, code) }
        val identity = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (identity.uid != expectedUserId) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val access = GoogleServiceAccess.primary(liveAccountSettings(payload))
        if (access.calendar) AuthDiagnostics.event("CALENDAR_SCOPE_GRANTED")
        if (access.tasks) AuthDiagnostics.event("TASKS_SCOPE_GRANTED")
        completeSignedIn(generation, payload,
            if (access.complete) "Google Calendar и Tasks подключены."
            else "Google сохранил часть разрешений. Недостающий сервис можно подключить отдельно.")
    }

    private suspend fun completeSignedIn(generation: Long, session: JSONObject, successMessage: String,
        preferredLanguage: String? = null, newAccount: Boolean = false) {
        val identity = AuthProtocol.identity(session) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        AuthDiagnostics.event("GENESIS_USER_RESOLVED")
        val settings = liveAccountSettings(session) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        if(identity.privateVault){
            ru.genesis.calendar.security.NativePrivateProducts.protect(app,identity.uid)
            if(app.workspaceScope!=CloudAccountSnapshot.scopeFor(identity.uid))app.activateAccount(identity.uid)
            withContext(Dispatchers.IO){CachedAccountEntry(app).save(identity,settings)}
            publish(generation,AuthPanelState(ready=ru.genesis.calendar.security.NativePrivateProducts.isOpen(app.workspaceScope),user=identity,accountSettings=settings,
                checkedAt=System.currentTimeMillis(),message=successMessage))
            return
        }
        val cachedState = mutableState.value.takeIf {
            it.ready && it.user?.uid == identity.uid && app.workspaceScope == CloudAccountSnapshot.scopeFor(identity.uid)
        }
        var stage = "BOOTSTRAP"
        publish(generation, AuthPanelState(busy = true, ready = cachedState != null,
            user = identity, accountSettings = settings, preview = cachedState?.preview,
            checkedAt = System.currentTimeMillis(), message = "Открываем зашифрованное пространство…"))
        try {
            AuthDiagnostics.event("SYNC_STARTED")
            val payload = withContext(Dispatchers.IO) { client.accountBootstrap(generation, session) }
            val confirmed = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
            if (confirmed.uid != identity.uid) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
            stage = "WORKSPACE_DECRYPT"
            val preview = withContext(Dispatchers.Default) { CloudWorkspacePreview.inspect(payload) }
            val snapshot = withContext(Dispatchers.Default) { CloudAccountSnapshot.fromBootstrap(payload) }
            stage = "ACCOUNT_IMPORT"
            val imported = dataSyncMutex.withLock {
                withContext(Dispatchers.IO) { importBackupSafe(snapshot,generation) }
            }
            val stoicheionPayload = try {
                withContext(Dispatchers.IO) { client.stoicheionDraws(generation) }
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { null }
            var resolvedSettings = liveAccountSettings(payload) ?: settings
            var languageWarning = false
            if (preferredLanguage in setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") && resolvedSettings.language != preferredLanguage) {
                try {
                    val updated = withContext(Dispatchers.IO) {
                        client.updatePreferences(generation, JSONObject().put("language", preferredLanguage))
                    }
                    require(AuthProtocol.identity(updated)?.uid == confirmed.uid)
                    resolvedSettings = liveAccountSettings(updated) ?: resolvedSettings
                } catch (error: CancellationException) { throw error }
                catch (_: Exception) { languageWarning = true }
            }
            if (app.workspaceScope != CloudAccountSnapshot.scopeFor(confirmed.uid)) {
                withContext(Dispatchers.IO) { app.scheduler.deactivate(app.workspaceScope) }
            }
            app.activateAccount(confirmed.uid)
            if (newAccount) withContext(Dispatchers.IO) {
                LocalPreferences(app, app.workspaceScope).initializeNewAccount()
            }
            val stoicheionWarning = if (stoicheionPayload != null) try {
                withContext(Dispatchers.IO) { StoicheionDrawRepository(app).replaceFromServer(stoicheionPayload) }
                false
            } catch (error: CancellationException) { throw error }
            catch (_: Exception) { true } else true
            // Notification permission/OEM alarm errors must not undo a completed cloud import.
            try { withContext(Dispatchers.IO) { app.scheduler.restore(recoverOverdue = true); app.scheduler.restoreHabitNotifications() } }
            catch (error: CancellationException) { throw error }
            catch (error: Exception) { logCloudFailure("REMINDER_RESTORE", error) }
            AuthDiagnostics.event("SYNC_SUCCESS")
            withContext(Dispatchers.IO) { CachedAccountEntry(app).save(confirmed, resolvedSettings) }
            publish(generation, AuthPanelState(ready = true, user = confirmed,
                offerGoogleServices = newAccount && resolvedSettings.authProvider == "google",
                accountSettings = resolvedSettings, preview = preview,
                checkedAt = System.currentTimeMillis(), message = (when (imported) {
                    CloudAccountImporter.Result.IMPORTED -> if (resolvedSettings.authProvider == "yandex")
                        "$successMessage Задачи и списки пока остаются на этом устройстве."
                        else if (snapshot.tasksDeferred) "$successMessage Загружаем задачи аккаунта…"
                        else "$successMessage Данные доступны в приложении."
                    CloudAccountImporter.Result.IMPORTED_WITH_GOOGLE_WARNING ->
                        snapshot.googleSyncIssue ?: "Пространство открыто, но Google не подтвердил обновление задач. Ранее загруженные задачи сохранены."
                    CloudAccountImporter.Result.IMPORTED_WITH_TASK_WARNING ->
                        "Часть записей не удалось прочитать. Остальные задачи загружены; сохранённые записи не удалены."
                    CloudAccountImporter.Result.PENDING_LOCAL_CHANGES ->
                        "Есть локальные изменения аккаунта, ещё не отправленные на сервер. Облачная копия не перезаписала их."
                }) + (if (languageWarning) " Выбранный язык пока не сохранён в аккаунте; повторите выбор в личном кабинете." else "") +
                    (if (stoicheionWarning) " Выбор карты пока не обновлён; нажмите «Обновить» при восстановлении сети." else "")))
        } catch (error: CancellationException) {
            AuthDiagnostics.event("SYNC_FAILED")
            throw error
        } catch (error: AuthFailure) {
            AuthDiagnostics.event("SYNC_FAILED")
            if (error.kind in setOf(AuthFailure.Kind.UNAUTHORIZED, AuthFailure.Kind.PROTOCOL)) throw error
            publish(generation, AuthPanelState(ready = cachedState != null, preview = cachedState?.preview,
                user = identity, accountSettings = settings,
                checkedAt = System.currentTimeMillis(), message = "Вход выполнен, но загрузка облачных данных пока не завершилась. Локальные записи сохранены."))
        } catch (_: CloudWorkspacePreview.RecoveryRequired) {
            AuthDiagnostics.event("SYNC_FAILED")
            publish(generation, AuthPanelState(ready = cachedState != null, preview = cachedState?.preview,
                user = identity, accountSettings = settings,
                checkedAt = System.currentTimeMillis(), message = "Вход выполнен, но для этого пространства требуется код восстановления. Данные не перезаписаны."))
        } catch (error: CloudWorkspacePreview.Unreadable) {
            AuthDiagnostics.event("SYNC_FAILED")
            logCloudFailure(stage, error)
            publish(generation, AuthPanelState(ready = cachedState != null, preview = cachedState?.preview,
                user = identity, accountSettings = settings,
                checkedAt = System.currentTimeMillis(), message = "Вход выполнен, но формат облачных данных не удалось проверить (CLOUD_FORMAT). Локальные записи сохранены."))
        } catch (error: Exception) {
            AuthDiagnostics.event("SYNC_FAILED")
            logCloudFailure(stage, error)
            publish(generation, AuthPanelState(ready = cachedState != null, preview = cachedState?.preview,
                user = identity, accountSettings = settings,
                checkedAt = System.currentTimeMillis(), message = "Вход выполнен, но импорт облачных данных не завершён (CLOUD_IMPORT). Локальные записи сохранены."))
        }
    }

    fun saveRouting(routing: SyncRouting) = start("Сохраняем маршрутизацию аккаунтов…") { generation ->
        val previous = mutableState.value
        val accounts = previous.accountSettings?.accounts ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        if (!routing.validFor(accounts)) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val payload = withContext(Dispatchers.IO) { client.updateRouting(generation, routing) }
        val settings = liveAccountSettings(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val identity = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        publish(generation, AuthPanelState(ready = previous.ready, user = identity, accountSettings = settings, preview = previous.preview,
            checkedAt = System.currentTimeMillis(), message = "Маршрутизация сохранена на сайте GENESIS."))
    }

    fun updateSharedPreference(name: String, value: String) = start("Сохраняем настройку на сервере…") { generation ->
        val previous = mutableState.value
        previous.accountSettings ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val changes = JSONObject()
        when (name) {
            "display" -> { require(value in setOf("sacred", "lunar", "profane")); changes.put("calendarMode", value) }
            "input" -> { require(value in setOf("sacred", "lunar", "profane")); changes.put("taskCalendarMode", value) }
            "time" -> { require(value in setOf("12h", "24h")); changes.put("timeFormat", value) }
            "weekStart" -> { require(value in setOf("sunday", "monday")); changes.put("weekStart", value) }
            "gregorianYearStart" -> { require(value in setOf("january", "march")); changes.put("gregorianYearStart", value) }
            "language" -> { require(value in setOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")); changes.put("language", value) }
            "darkPalette" -> { require(value in setOf("green", "burgundy", "blue", "violet") &&
                (value == "green" || previous.accountSettings.featureAccess.allows("dark-palettes"))); changes.put(name, value) }
            "theme" -> { require(value in setOf("standart", "standart-dark")); changes.put("theme", value) }
            "stoicheionDivinationDisabled" -> {
                require(value in setOf("true", "false")); changes.put("stoicheionDivinationDisabled", value.toBoolean())
            }
            "sharedProjectsEnabled" -> {
                require(value in setOf("true", "false") && (value == "false" || previous.accountSettings.sharedProjectsEligible &&
                    previous.accountSettings.featureAccess.allows("shared-projects")))
                changes.put("sharedProjectsEnabled", value.toBoolean())
            }
            else -> throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        }
        val preferences = LocalPreferences(app, app.workspaceScope)
        if (name == "theme") preferences.setPendingTheme(value, previous.accountSettings.themeRevision)
        else preferences.setPending(name, value)
        val payload = flushPendingPreferences(generation, previous.user?.uid ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED))
            ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val settings = liveAccountSettings(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val identity = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        publish(generation, AuthPanelState(ready = previous.ready, user = identity, accountSettings = settings, preview = previous.preview,
            checkedAt = System.currentTimeMillis(), message = "Настройка сохранена в аккаунте; локальная копия обновляется."))
    }

    fun updateUiVisibility(visibility: UiVisibility) = start("Сохраняем вид приложения…") { generation ->
        val previous = mutableState.value
        previous.accountSettings ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        require(visibility.enabledCalendars.isNotEmpty())
        val payload = withContext(Dispatchers.IO) { updatePreferencePayload(generation,
            JSONObject().put("uiVisibility", visibility.toJson())) }
        val settings = liveAccountSettings(payload) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val identity = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        if (settings.uiVisibility != visibility) {
            throw PreferenceNotPersistedException()
        }
        publish(generation, previous.copy(busy = false, user = identity, accountSettings = settings,
            message = "Вид приложения сохранён в аккаунте."))
    }

    fun connectYandexCalendar(accessToken: String, expiresIn: Long, accountId: String? = null) = start("Подключаем Яндекс.Календарь…") { generation ->
        val previous = mutableState.value
        require(previous.user != null && previous.accountSettings?.authProvider != "google")
        val selected = accountId ?: previous.user.uid
        require(previous.accountSettings?.accounts?.any { it.id == selected && it.provider == "yandex" } == true)
        val payload = withContext(Dispatchers.IO) { client.connectYandexCalendar(generation, accessToken, expiresIn, selected) }
        val settings = liveAccountSettings(payload) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val identity = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        publish(generation, previous.copy(busy = false, user = identity, accountSettings = settings,
            message = "Яндекс.Календарь подключён. Задачи синхронизируются как события."))
        refreshAccountData()
        syncPending()
    }

    fun disconnectYandexCalendar(accountId: String? = null) = start("Отключаем Яндекс.Календарь…") { generation ->
        val previous = mutableState.value
        require(previous.user != null && previous.accountSettings?.authProvider != "google")
        val selected = accountId ?: previous.user.uid
        require(previous.accountSettings?.accounts?.any { it.id == selected && it.provider == "yandex" } == true)
        val payload = withContext(Dispatchers.IO) { client.disconnectYandexCalendar(generation, selected) }
        val settings = liveAccountSettings(payload) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val identity = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        publish(generation, previous.copy(busy = false, user = identity, accountSettings = settings,
            message = "Яндекс.Календарь отключён. Существующие события остались в вашем календаре."))
    }

    fun removeLinkedAccount(accountId: String) = start("Отключаем дополнительный аккаунт…") { generation ->
        val previous = mutableState.value
        val account = previous.accountSettings?.accounts?.find { it.id == accountId }
        if (account == null || account.isPrimary) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        val payload = withContext(Dispatchers.IO) { client.removeLinkedAccount(generation, accountId) }
        val settings = liveAccountSettings(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val identity = AuthProtocol.identity(payload) ?: throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        publish(generation, AuthPanelState(ready = previous.ready, user = identity, accountSettings = settings, preview = previous.preview,
            checkedAt = System.currentTimeMillis(), message = "Дополнительный аккаунт отключён; существующие события Google не удалены."))
    }

    fun logout() = start("Закрываем серверную сессию…") { generation ->
        privateVaultLifecycle.incrementAndGet()
        privateMigration.getAndSet(null)?.close()
        mutableState.value.user?.uid?.let{ru.genesis.calendar.security.NativeMigrationMemory.clearOwner(it);ru.genesis.calendar.security.NativeMigrationUiState.clearOwner(it)}
        ru.genesis.calendar.security.NativePrivateProducts.lock()
        val previousScope = app.workspaceScope
        // begin() has already invalidated every in-flight response before touching stored credentials.
        var remoteClosed = false
        withContext(Dispatchers.IO) {
            val previous = client.takeForLogout(generation)
            try {
                client.revoke(generation, previous)
                remoteClosed = true
            } catch (error: CancellationException) {
                throw error
            } catch (_: Exception) {
                // Local credential is already deleted; no offline promise about server revocation.
            }
        }
        var providerCleared = true
        try {
            credentials.clearCredentialState(ClearCredentialStateRequest())
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            providerCleared = false
        }
        val message = if (remoteClosed) "Вход закрыт. Локальные черновики сохранены."
            else "Вход удалён с устройства. Отзыв серверной сессии не подтверждён; локальные черновики сохранены."
        withContext(Dispatchers.IO) {
            mutableState.value.user?.uid?.let(sharedOffline::clear)
            savedViewStorage.clear()
            bulkInputStorage.clear()
            CachedAccountEntry(app).clear(previousScope)
            app.scheduler.deactivate(previousScope)
        }
        app.activateAccount(null)
        publish(generation, AuthPanelState(message = message + if (providerCleared) "" else " Поставщик Google недоступен для очистки состояния."))
    }

    fun syncPending() = syncPending(WorkspacePatch.ConflictPolicy.STOP)

    /** A manual sync includes downloading tasks, and never cancels a pull already in progress. */
    fun refresh() {
        if (mutableState.value.ready && !mutableState.value.requiresSignIn) refreshIfReady() else checkSession()
    }

    /** Pull on resume and periodically while visible, so another device's changes arrive automatically. */
    fun refreshIfReady() {
        if (operation?.isActive == true || !mutableState.value.ready || mutableState.value.requiresSignIn) return
        syncPending()
        refreshAccountData()
        scope.launch(NativeActivityVisit.requestContext()) { runCatching { flushSharedOfflineTasks() } }
    }

    private fun refreshAccountData() {
        val identity = mutableState.value.user ?: return
        if (!mutableState.value.ready || mutableState.value.requiresSignIn || pullJob?.isActive == true) return
        val generation = client.currentGeneration()
        val accountScope = CloudAccountSnapshot.scopeFor(identity.uid)
        val previous = mutableTaskSync.value.takeIf { it.scope == accountScope } ?: AccountTaskSyncState(accountScope)
        mutableTaskSync.value = previous.copy(loading = true)
        pullJob = scope.launch(NativeActivityVisit.requestContext()) {
            try {
                syncJob?.join()
                dataSyncMutex.withLock {
                    val payload = withContext(Dispatchers.IO) { client.bootstrap(generation) }
                    if (AuthProtocol.identity(payload)?.uid != identity.uid) throw AuthFailure(AuthFailure.Kind.PROTOCOL)
                    val snapshot = withContext(Dispatchers.Default) { CloudAccountSnapshot.fromBootstrap(payload) }
                    val preview = withContext(Dispatchers.Default) { CloudWorkspacePreview.inspect(payload) }
                    val imported = withContext(Dispatchers.IO) {
                        importBackupSafe(snapshot,generation)
                    }
                    withContext(Dispatchers.IO) { ru.genesis.calendar.data.TaskListsRepository.cacheBootstrap(app.database, accountScope, payload) }
                    val available = withContext(Dispatchers.IO) { app.database.dao().accountTasks(accountScope).size }
                    val uploadPending = withContext(Dispatchers.IO) {
                        app.database.dao().outbox(accountScope).isNotEmpty() ||
                            LocalPreferences(app, accountScope).pending.first().isNotEmpty()
                    }
                    if (!client.isCurrent(generation)) return@withLock
                    val issue = when {
                        imported == CloudAccountImporter.Result.IMPORTED_WITH_TASK_WARNING ->
                            "Часть записей не удалось прочитать. Остальные задачи загружены; сохранённые записи не удалены."
                        snapshot.googleSyncWarning ->
                            if (mutableState.value.accountSettings?.authProvider == "yandex")
                                "Яндекс.Календарь не подтвердил полную загрузку. Повторите синхронизацию."
                            else snapshot.googleSyncIssue ?: "Google не подтвердил полную загрузку задач. Проверьте подключение Calendar и Tasks в настройках."
                        else -> null
                    }
                    mutableTaskSync.value = AccountTaskSyncState(accountScope, confirmed = issue == null,
                        issue = issue, received = snapshot.tasks.size + snapshot.unreadableTaskCount, available = available)
                    publish(generation, mutableState.value.copy(
                        accountSettings = liveAccountSettings(payload) ?: mutableState.value.accountSettings,
                        preview = preview, checkedAt = System.currentTimeMillis(),
                        message = mutableState.value.outgoingSyncIssue?.takeIf { uploadPending } ?: when (imported) {
                            CloudAccountImporter.Result.IMPORTED -> if (mutableState.value.accountSettings?.authProvider == "yandex")
                                "Защищённые данные GENESIS обновлены. Задачи остаются на устройстве."
                                else "Данные аккаунта и задачи Google обновлены."
                            CloudAccountImporter.Result.IMPORTED_WITH_GOOGLE_WARNING ->
                                "Пространство обновлено. Часть задач Google пока недоступна; сохранённые задачи остаются на устройстве."
                            CloudAccountImporter.Result.IMPORTED_WITH_TASK_WARNING ->
                                "Часть записей не удалось прочитать. Остальные задачи загружены; сохранённые записи не удалены."
                            CloudAccountImporter.Result.PENDING_LOCAL_CHANGES ->
                                mutableState.value.outgoingSyncIssue ?:
                                "Отправка изменений ещё не завершена. Полученные данные обновлены; изменения этого устройства сохранены и ожидают синхронизации."
                        }))
                }
                try { withContext(Dispatchers.IO) { app.scheduler.restore(recoverOverdue = true); app.scheduler.restoreHabitNotifications() } }
                catch (error: CancellationException) { throw error }
                catch (error: Exception) { logCloudFailure("REMINDER_RESTORE", error) }
            } catch (error: CancellationException) { throw error }
            catch (error: Exception) {
                logCloudFailure("BACKGROUND_PULL", error)
                if (error is AuthFailure && error.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
                if (client.isCurrent(generation)) {
                    mutableTaskSync.value = previous.copy(loading = false,
                        issue = "Не удалось загрузить задачи аккаунта. Нажмите «Обновить» для повторной попытки.")
                    publish(generation, mutableState.value.copy(
                        message = "Аккаунт открыт. Обновление задач пока не завершилось; повторим автоматически. Сохранённые записи доступны."))
                }
            } finally {
                if (client.isCurrent(generation)) mutableTaskSync.value = mutableTaskSync.value.copy(loading = false)
            }
        }
    }

    internal suspend fun createTaskList(title: String, accountId: String): ru.genesis.calendar.data.GoogleTaskList {
        val value = mutableState.value
        val uid = value.user?.uid
        require(uid != null && value.ready && !value.requiresSignIn) { "Для создания списка повторите вход." }
        if (value.accountSettings?.authProvider != "google") {
            val accountScope = CloudAccountSnapshot.scopeFor(uid)
            require(app.workspaceScope == accountScope)
            val list = ru.genesis.calendar.data.GoogleTaskList("local:${java.util.UUID.randomUUID()}", title.trim())
            withContext(Dispatchers.IO) {
                ru.genesis.calendar.data.TaskListsRepository(app, accountScope).rememberCreated(list)
                ru.genesis.calendar.data.WorkspaceStructureRepository(app).saveTaskList(list)
            }
            return list
        }
        require(value.accountSettings?.accounts?.any { it.id == accountId && it.tasksConnected } == true) {
            "Подключите Google Tasks для выбранного аккаунта в настройках."
        }
        val accountScope = CloudAccountSnapshot.scopeFor(uid)
        require(app.workspaceScope == accountScope)
        val generation = client.currentGeneration()
        try {
            return dataSyncMutex.withLock {
                val response = withContext(Dispatchers.IO) { client.createTaskList(generation, title, accountId) }
                if(!client.isCurrent(generation) || app.workspaceScope != accountScope) throw CancellationException()
                val list = ru.genesis.calendar.data.GoogleTaskList.from(response.getJSONObject("taskList"))
                require(list.accountId == accountId)
                withContext(Dispatchers.IO) { ru.genesis.calendar.data.TaskListsRepository(app, accountScope).rememberCreated(list) }
                list
            }
        } catch(error: AuthFailure) {
            if(error.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
            throw error
        }
    }

    internal suspend fun updateTaskList(list: ru.genesis.calendar.data.GoogleTaskList, title: String): ru.genesis.calendar.data.GoogleTaskList {
        val value = mutableState.value
        val uid = value.user?.uid
        require(uid != null && value.ready && !value.requiresSignIn) { "Для изменения списка повторите вход." }
        val accountScope = CloudAccountSnapshot.scopeFor(uid)
        require(app.workspaceScope == accountScope)
        val updated = if (value.accountSettings?.authProvider == "google") {
            require(!list.isDefault) { "Основной список Google Tasks нельзя изменять в GENESIS." }
            val accountId = requireNotNull(list.accountId)
            val generation = client.currentGeneration()
            dataSyncMutex.withLock {
                val response = withContext(Dispatchers.IO) { client.updateTaskList(generation,list.id,title,accountId) }
                require(client.isCurrent(generation) && app.workspaceScope == accountScope)
                ru.genesis.calendar.data.GoogleTaskList.from(response.getJSONObject("taskList"))
            }
        } else list.copy(title=title.trim())
        withContext(Dispatchers.IO) {
            ru.genesis.calendar.data.TaskListsRepository(app,accountScope).rememberCreated(updated)
            ru.genesis.calendar.data.WorkspaceStructureRepository(app).saveTaskList(updated)
        }
        return updated
    }

    internal suspend fun deleteTaskList(list: ru.genesis.calendar.data.GoogleTaskList) {
        val value = mutableState.value
        val uid = value.user?.uid
        require(uid != null && value.ready && !value.requiresSignIn) { "Для удаления списка повторите вход." }
        require(!list.isDefault) { "Основной список Google Tasks удалить нельзя." }
        val accountScope = CloudAccountSnapshot.scopeFor(uid)
        require(app.workspaceScope == accountScope)
        if (value.accountSettings?.authProvider == "google") {
            val accountId = requireNotNull(list.accountId)
            val generation = client.currentGeneration()
            dataSyncMutex.withLock {
                withContext(Dispatchers.IO) { client.deleteTaskList(generation,list.id,accountId) }
                require(client.isCurrent(generation) && app.workspaceScope == accountScope)
            }
        }
        withContext(Dispatchers.IO) {
            ru.genesis.calendar.data.TaskListsRepository(app,accountScope).rememberRemoved(list)
            ru.genesis.calendar.data.WorkspaceStructureRepository(app).removeTaskList(list.id)
        }
    }

    internal suspend fun loadStoicheionDraws(): JSONObject {
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope))return withContext(Dispatchers.IO){ru.genesis.calendar.security.NativePrivateProducts.stoicheion(app.workspaceScope).loadDraws().also{ru.genesis.calendar.security.NativePrivateProducts.changed(app.workspaceScope)}}
        val generation = client.currentGeneration()
        return try { stoicheionReadWithRetry { withContext(Dispatchers.IO) { client.stoicheionDraws(generation) } } }
        catch (error: CancellationException) { throw error }
        catch (error: AuthFailure) {
            android.util.Log.w("GenesisStoicheion", "Draw refresh failed: ${error.kind}, HTTP ${error.httpStatus ?: 0}")
            throw StoicheionSyncFailure(error.kind, error)
        }
    }

    internal suspend fun loadStoicheionTimeline(): JSONObject {
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope))return withContext(Dispatchers.IO){ru.genesis.calendar.security.NativePrivateProducts.stoicheion(app.workspaceScope).loadTimeline().also{ru.genesis.calendar.security.NativePrivateProducts.changed(app.workspaceScope)}}
        val generation = client.currentGeneration()
        return try { stoicheionReadWithRetry { withContext(Dispatchers.IO) { client.stoicheionTimeline(generation) } } }
        catch (error: CancellationException) { throw error }
        catch (error: AuthFailure) { throw StoicheionSyncFailure(error.kind, error) }
    }

    internal suspend fun changeStoicheionTimeline(position: Int, action: String, revision: Long): JSONObject {
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope))return withContext(Dispatchers.IO){ru.genesis.calendar.security.NativePrivateProducts.stoicheion(app.workspaceScope).timelineCard(position,action,revision).also{ru.genesis.calendar.security.NativePrivateProducts.changed(app.workspaceScope)}}
        val generation = client.currentGeneration()
        return try { withContext(Dispatchers.IO) { client.changeStoicheionTimeline(generation, position, action, revision) } }
        catch (error: CancellationException) { throw error }
        catch (error: AuthFailure) { throw IllegalStateException(stoicheionFailureMessage(error.kind)) }
    }

    internal suspend fun saveStoicheionDraw(kind: String, seed: Long): JSONObject {
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope))return withContext(Dispatchers.IO){ru.genesis.calendar.security.NativePrivateProducts.stoicheion(app.workspaceScope).saveDraw(kind,seed).also{ru.genesis.calendar.security.NativePrivateProducts.changed(app.workspaceScope)}}
        val generation = client.currentGeneration()
        return try { withContext(Dispatchers.IO) { client.saveStoicheionDraw(generation, kind, seed) } }
        catch (error: CancellationException) { throw error }
        catch (error: AuthFailure) { throw IllegalStateException(stoicheionFailureMessage(error.kind)) }
    }
    internal suspend fun changeStoicheionSpreadCard(position: Int, revision: Long, seed: Long, dayKey: String): JSONObject {
        if(ru.genesis.calendar.security.NativePrivateProducts.isProtected(app.workspaceScope))return withContext(Dispatchers.IO){ru.genesis.calendar.security.NativePrivateProducts.stoicheion(app.workspaceScope).spreadCard(position,revision,seed,dayKey).also{ru.genesis.calendar.security.NativePrivateProducts.changed(app.workspaceScope)}}
        val generation = client.currentGeneration()
        return try { withContext(Dispatchers.IO) { client.changeStoicheionSpreadCard(generation, position, revision, seed, dayKey) } }
        catch (error: CancellationException) { throw error }
        catch (error: AuthFailure) { throw IllegalStateException(stoicheionFailureMessage(error.kind)) }
    }

    internal suspend fun resumePrivateStoicheion(kind:String):JSONObject{val scope=app.workspaceScope;return withContext(Dispatchers.IO){ru.genesis.calendar.security.NativePrivateProducts.stoicheion(scope).resume(kind).also{ru.genesis.calendar.security.NativePrivateProducts.changed(scope)}}}

    private fun stoicheionFailureMessage(kind: AuthFailure.Kind) = when (kind) {
        AuthFailure.Kind.UNAUTHORIZED -> "Сессия аккаунта завершилась. Повторите вход и выбор карты."
        AuthFailure.Kind.RATE_LIMIT -> "Слишком много запросов. Повторите выбор карты через минуту."
        AuthFailure.Kind.NETWORK -> "Нет подтверждения от сервера. Проверьте сеть; прежний выбор карты сохранён."
        AuthFailure.Kind.CONFLICT -> "Карта уже изменилась на другом устройстве. Нажмите «Обновить»."
        AuthFailure.Kind.SERVER -> "Сервер временно не сохранил карту. Повторите позже."
        else -> "Не удалось безопасно синхронизировать карту с аккаунтом."
    }

    fun keepLocalWorkspaceChanges(userId: String, fingerprint: String) {
        if (mutableState.value.user?.uid == userId) syncPending(WorkspacePatch.ConflictPolicy.KEEP_LOCAL, fingerprint)
    }
    fun keepRemoteWorkspaceChanges(userId: String, fingerprint: String) {
        if (mutableState.value.user?.uid == userId) syncPending(WorkspacePatch.ConflictPolicy.KEEP_REMOTE, fingerprint)
    }

    private fun syncPending(conflictPolicy: WorkspacePatch.ConflictPolicy, expectedConflictFingerprint: String? = null,
        inBackground: Boolean = false) {
        val identity = mutableState.value.user ?: return
        if(identity.privateVault){
            if(inBackground||syncJob?.isActive==true||mutableState.value.requiresSignIn||ru.genesis.calendar.security.NativePrivateProducts.isOffline(CloudAccountSnapshot.scopeFor(identity.uid)))return
            syncJob=scope.launch{
                try{ru.genesis.calendar.security.NativePrivateProducts.flush(CloudAccountSnapshot.scopeFor(identity.uid))}
                catch(error:CancellationException){throw error}
                catch(_:Exception){mutableState.value=mutableState.value.copy(outgoingSyncIssue="E2EE_PRIVATE_SYNC_REQUIRED")}
            };return
        }
        val accountScope = CloudAccountSnapshot.scopeFor(identity.uid)
        if (app.workspaceScope != accountScope || mutableState.value.requiresSignIn || syncJob?.isActive == true) return
        val generation = client.currentGeneration();val workspaceEpoch=app.workspaceEpoch
        fun currentSyncOwner() {
            ru.genesis.calendar.security.UpdateGate.requireOpen()
            if(!client.isCurrent(generation)||mutableState.value.user?.uid!=identity.uid||mutableState.value.requiresSignIn
                ||app.workspaceScope!=accountScope||app.workspaceEpoch!=workspaceEpoch)throw CancellationException("E2EE_ACCOUNT_CHANGED")
        }
        syncJob = scope.launch(NativeActivityVisit.requestContext(inBackground)) {
          try { ru.genesis.calendar.data.NativeLegacyOperationPermit.run(app.database,accountScope,::currentSyncOwner) {
          dataSyncMutex.withLock {
            currentSyncOwner()
            AuthDiagnostics.event("SYNC_STARTED")
            var sentTasks = 0
            var sentWorkspace = 0
            var failure: String? = null
            var conflictPath: String? = null
            var conflictPreview: WorkspaceConflictPreview? = null
            try { flushPendingPreferences(generation, identity.uid) }
            catch (e: CancellationException) { throw e }
            catch (error: Exception) {
                logCloudFailure("PREFERENCE_PUSH", error)
                if (error is AuthFailure && error.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
                failure = if (error is AuthFailure && error.kind == AuthFailure.Kind.CONFLICT)
                    "Настройка изменилась на другом устройстве. Обновите данные и выберите тему повторно; ваш выбор сохранён на устройстве."
                    else "Настройки сохранены на устройстве и ожидают синхронизации."
            }
            try {
                sentWorkspace = withContext(Dispatchers.IO) {
                    CloudWorkspaceSync(app.database, object : CloudWorkspaceTransport {
                        override fun get() = client.workspace(generation)
                        override fun put(body: JSONObject) = client.putWorkspace(generation, body)
                        override fun habitReminderConsent() = client.habitReminderStatus(generation).optBoolean("hasDevices",false)
                    }).flush(accountScope, conflictPolicy, expectedConflictFingerprint)
                }
            } catch (error: CancellationException) { throw error }
            catch (error: WorkspacePatch.Conflict) {
                logCloudFailure("WORKSPACE_PUSH_CONFLICT", error)
                conflictPath = error.field
                conflictPreview = error.preview
                failure = "Конфликт зашифрованного пространства: данные устройства сохранены. Решите, какую версию оставить."
            }
            catch (_: CloudWorkspacePreview.RecoveryRequired) { failure = "Для синхронизации нужен код восстановления пространства." }
            catch (error: Exception) {
                logCloudFailure("WORKSPACE_PUSH", error)
                if (error is AuthFailure && error.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
                failure = "Изменения проектов или привычек пока не подтверждены сервером и сохранены на устройстве."
            }
            if (mutableState.value.accountSettings?.let { it.authProvider == "google" ||
                it.authProvider == "yandex" && it.calendarConnected } == true) {
                try {
                    sentTasks = withContext(Dispatchers.IO) {
                        CloudTaskSync(app.database, object : CloudTaskTransport {
                            override fun put(id: String, task: JSONObject) = client.putTask(generation, id, task)
                            override fun delete(id: String, task: JSONObject) = client.deleteTask(generation, id, task)
                        }).flush(accountScope,::currentSyncOwner)
                    }
                } catch (error: CancellationException) { throw error }
                catch (error: Exception) {
                    logCloudFailure("TASK_PUSH", error)
                    if (error is AuthFailure && error.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
                    failure = listOfNotNull(failure,
                        "Изменения задач пока не подтверждены сервером и сохранены на устройстве.").joinToString(" ")
                }
            }
            currentSyncOwner()
            if (client.isCurrent(generation)) mutableState.value = mutableState.value.copy(
                workspaceConflictPath = conflictPath, workspaceConflictPreview = conflictPreview, outgoingSyncIssue = failure, message = failure ?:
                if (sentTasks + sentWorkspace > 0) "Синхронизировано: $sentTasks задач, $sentWorkspace изменений пространства."
                else mutableState.value.message)
            AuthDiagnostics.event(if (failure == null) "SYNC_SUCCESS" else "SYNC_FAILED")
          }
          }}catch(error:AuthApiError) {
            if(error.code.startsWith("E2EE_"))throw CancellationException(error.code).apply{initCause(error)}
            throw error
          }
        }
    }

    private suspend fun flushPendingPreferences(generation: Long, uid: String): JSONObject? {
        val accountScope = CloudAccountSnapshot.scopeFor(uid)
        if (app.workspaceScope != accountScope) return null
        val preferences = LocalPreferences(app, accountScope)
        val changes = preferences.pending.first()
        if (changes.isEmpty()) return null
        val body = PreferencePatch.request(changes)
        val payload = withContext(Dispatchers.IO) { updatePreferencePayload(generation, body) }
        if (AuthProtocol.identity(payload)?.uid != uid || !client.isCurrent(generation)) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED)
        val settings = liveAccountSettings(payload) ?: throw AuthFailure(AuthFailure.Kind.PROTOCOL)
        preferences.acknowledge(changes)
        publish(generation, mutableState.value.copy(accountSettings = settings))
        return payload
    }

    /** Uses the same guarded session, CAS merge and outbox path as the foreground UI. */
    internal suspend fun synchronizeInBackground(): Boolean = withContext(Dispatchers.Main.immediate + NativeActivityVisit.requestContext(true)) {
        if (!app.workspaceScope.startsWith("account-")) return@withContext true
        if (operation?.isActive != true) checkSession(inBackground = true)
        operation?.join()
        if (mutableState.value.requiresSignIn) return@withContext true
        if (!mutableState.value.ready) return@withContext false
        ru.genesis.calendar.data.HabitsRepository(app).expireIdleHabits()
        syncPending(WorkspacePatch.ConflictPolicy.STOP, inBackground = true)
        syncJob?.join()
        app.database.dao().observeOutbox(app.workspaceScope).first().isEmpty() &&
            LocalPreferences(app, app.workspaceScope).pending.first().isEmpty()
    }

    private fun start(message: String, inBackground: Boolean = false, block: suspend (Long) -> Unit) {
        val generation = client.begin()
        operation?.cancel()
        syncJob?.cancel()
        pullJob?.cancel()
        val previous = mutableState.value
        // A transient refresh/provider failure must not throw an authenticated user back to Welcome.
        // Server credentials and the device's encrypted workspace have independent lifetimes.
        mutableState.value = AuthPanelState(busy = true, ready = previous.ready, user = previous.user,
            requiresSignIn = previous.requiresSignIn,
            accountSettings = previous.accountSettings, preview = previous.preview,
            workspaceConflictPath = previous.workspaceConflictPath,
            workspaceConflictPreview = previous.workspaceConflictPreview,
            checkedAt = previous.checkedAt, message = message)
        operation = scope.launch(NativeActivityVisit.requestContext(inBackground)) {
            fun failed(message: String, retainIdentity: Boolean = true) {
                // Cold startup may have opened the validated local cache after this operation began.
                // A network failure must retain that account as well as an already visible account.
                val retained = mutableState.value.takeIf { it.ready && it.user != null } ?: previous
                publish(generation, AuthPanelState(ready = retained.ready && retainIdentity,
                    requiresSignIn = retained.requiresSignIn,
                    user = retained.user.takeIf { retainIdentity },
                    accountSettings = retained.accountSettings.takeIf { retainIdentity },
                    preview = retained.preview.takeIf { retainIdentity },
                    checkedAt = retained.checkedAt.takeIf { retainIdentity }, message = message))
            }
            try {
                block(generation)
            } catch (error: CancellationException) {
                if (client.isCurrent(generation)) failed("Проверка входа отменена.")
                throw error
            } catch (_: GetCredentialCancellationException) {
                failed("Вход отменён. Локальные записи не изменены.")
            } catch (_: GetCredentialProviderConfigurationException) {
                failed("Поставщик входа Google недоступен. Проверьте наличие Google Play services; локальные функции доступны.")
            } catch (_: NoCredentialException) {
                failed("Google не предоставил данные для входа. Проверьте аккаунт и настройки OAuth. Локальные функции доступны.")
            } catch (_: CloudWorkspacePreview.RecoveryRequired) {
                failed("Данные сайта защищены кодом восстановления. Ничего не перезаписано; понадобится код из личного кабинета.")
            } catch (_: CloudWorkspacePreview.Unreadable) {
                failed("Не удалось проверить зашифрованные данные сайта. Сессия и локальные записи сохранены; ничего не перезаписано.")
            } catch (_: GoogleIdTokenParsingException) {
                failed("Google вернул ответ, который не удалось проверить. Обновите Google Play services и повторите вход.")
            } catch (_: GetCredentialException) {
                resetCredentialProvider()
                failed("Google-вход не подтверждён. Проверьте сеть, Google Play services и OAuth-регистрацию этой Android-сборки.")
            } catch (_: GoogleServicesAuthorizationException) {
                failed("Google не завершил выдачу разрешений Calendar/Tasks. Повторите подключение и выберите тот же аккаунт.")
            } catch (error: AuthFailure) {
                if (error.kind == AuthFailure.Kind.UNAUTHORIZED) requireSignIn(generation)
                failed(when (error.kind) {
                    AuthFailure.Kind.NOT_DEPLOYED -> "Нативный вход ещё не опубликован на сервере. Локальные функции доступны."
                    AuthFailure.Kind.UNAUTHORIZED -> "Повторите вход через Google для синхронизации. Данные и напоминания сохранены на устройстве."
                    AuthFailure.Kind.RATE_LIMIT -> "Слишком много попыток. Повторите вход через минуту."
                    AuthFailure.Kind.NETWORK -> "Нет подтверждения от сервера. Проверьте сеть и повторите."
                    AuthFailure.Kind.STORAGE -> "Защищённая сессия на устройстве недоступна. Повторите вход; локальные записи не изменены."
                    AuthFailure.Kind.CONFLICT -> "Данные изменились на другом устройстве. Обновите синхронизацию."
                    AuthFailure.Kind.SERVER -> "Сервер временно не может подтвердить вход. Повторите позже."
                    AuthFailure.Kind.PROTOCOL -> "Ответ сервера не прошёл проверку. Вход не подтверждён."
                })
            } catch (_: PreferenceNotPersistedException) {
                failed("Сервер ещё не поддерживает эту настройку. Повторите после обновления сервиса GENESIS.")
            } catch (error: Exception) {
                resetCredentialProvider()
                val code = error.javaClass.simpleName.filter { it.isLetterOrDigit() }.take(32).ifBlank { "Unknown" }
                failed("Не удалось безопасно завершить проверку. Состояние Google сброшено; повторите вход. Код: $code. Текущая сессия и локальные записи не изменены.")
            } finally {
                if (client.isCurrent(generation) && mutableState.value.ready) refreshAccountData()
            }
        }
    }

    private suspend fun resetCredentialProvider() {
        try {
            credentials.clearCredentialState(ClearCredentialStateRequest())
        } catch (error: CancellationException) {
            throw error
        } catch (_: Exception) {
            // The following getCredential call still has its own precise error path.
        }
    }

    private fun logCloudFailure(stage: String, error: Exception) {
        // Exception messages can contain cloud record values. Keep only the stage,
        // type and application source location for device diagnostics.
        val location = error.stackTrace.firstOrNull { it.className.startsWith("ru.genesis.calendar.") }
        val kind = (error as? AuthFailure)?.kind?.name?.let { "/$it" }.orEmpty()
        Log.e("GenesisAuth", "$stage: ${error.javaClass.simpleName}$kind at ${location?.fileName}:${location?.lineNumber}")
    }

    private suspend fun requireSignIn(generation: Long) {
        if (!client.isCurrent(generation)) return
        val cached = withContext(Dispatchers.IO) { CachedAccountEntry(app).read(app.workspaceScope) }
        // A cached identity opens only this device's encrypted copy. Every cloud operation
        // still requires fresh server authentication; explicit logout revokes local access.
        publish(generation, AuthPanelState(ready = cached != null, requiresSignIn = cached != null,
            user = cached?.identity, accountSettings = cached?.settings,
            checkedAt = System.currentTimeMillis(),
            message = if (cached != null)
                "Локальная копия открыта. Повторите вход через Google для синхронизации; напоминания продолжают работать."
            else "На сервере нет активного входа."))
    }

    private fun publish(generation: Long, value: AuthPanelState) {
        // A response may become obsolete between parsing and the UI-thread publish.
        if (value.accountSettings?.profileReceipt?.isCurrent() == false &&
            value.accountSettings.profileReceipt !== mutableState.value.accountSettings?.profileReceipt) return
        synchronized(app.adviceNotificationGuard) {
            if (client.isCurrent(generation)) {
                val previous = mutableState.value.accountSettings
                if (previous?.advicePreferences != value.accountSettings?.advicePreferences ||
                    previous?.adviceCollectionsReady != value.accountSettings?.adviceCollectionsReady ||
                    previous?.language != value.accountSettings?.language)
                    ru.genesis.calendar.reminders.AdviceReminderScheduler.cancel(app)
                if (value.user != null && value.accountSettings != null) app.rememberFeatureAccess(CloudAccountSnapshot.scopeFor(value.user.uid),value.accountSettings.featureAccess)
                mutableState.value = value
                scheduleTrialTick()
                if (value.ready && !value.busy && value.accountSettings?.featureAccess?.source == "trial" &&
                    value.accountSettings.featureAccess.trialPhase() == "verification-required") refreshTrialAccess()
                if (value.ready && value.user != null && value.accountSettings != null) scope.launch(NativeActivityVisit.requestContext()) {
                    dataSyncMutex.withLock {
                        if (client.isCurrent(generation) && mutableState.value === value && app.workspaceScope == CloudAccountSnapshot.scopeFor(value.user.uid)) {
                            try {
                                withContext(Dispatchers.IO) { CachedAccountEntry(app).save(value.user, value.accountSettings) }
                                ru.genesis.calendar.reminders.AdviceReminderScheduler.restore(app)
                            }
                            catch (error: CancellationException) { throw error }
                            catch (_: Exception) { /* Cached entry from the last successful import remains intact. */ }
                        }
                    }
                }
            }
        }
    }

    companion object {
        @Volatile private var instance: AuthController? = null
        fun get(context: Context): AuthController = instance ?: synchronized(this) {
            instance ?: AuthController(context.applicationContext).also { instance = it }
        }
    }
}

private suspend fun <T> Task<T>.awaitResult(): T = suspendCancellableCoroutine { continuation ->
    addOnSuccessListener { value -> if (continuation.isActive) continuation.resume(value) }
    addOnFailureListener { error -> if (continuation.isActive) continuation.resumeWithException(error) }
    addOnCanceledListener { if (continuation.isActive) continuation.cancel() }
}
