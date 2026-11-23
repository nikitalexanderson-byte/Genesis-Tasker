package ru.genesis.calendar.auth

import android.content.Context
import android.os.Bundle
import android.os.SystemClock
import androidx.activity.compose.setContent
import androidx.compose.runtime.CompositionLocalProvider
import androidx.test.ext.junit.rules.ActivityScenarioRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.data.GenesisProject
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.WorkspaceStructureRepository
import ru.genesis.calendar.security.*
import ru.genesis.calendar.ui.LocalGenesisLanguage
import ru.genesis.calendar.ui.RecoveryCredentialActivity
import java.io.ByteArrayInputStream
import java.io.File
import java.net.URL
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.util.Base64
import java.util.UUID
import java.util.regex.Pattern
import javax.net.ssl.HttpsURLConnection
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory

/** Real native owner controller, actual feature adapters, Keystore/Room and
 * loopback PHP/SQLite. Only identity delivery and the localhost CA are fixtures.
 * Credential presence is verified by the owned platform runner before this
 * case. This is controller acceptance, not a claim of SAF/Google-provider UI. */
class NativePrivateProductHttpsTest {
    @get:Rule val host=ActivityScenarioRule(PagerTestActivity::class.java)
    @Before fun keepTheControllerFixtureVisible(){
        // Keep actual WebView/application visibility during the long source
        // transfer. The trial owner flag alone cannot resume renderer timers.
        host.scenario.onActivity{it.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)}
    }
    private val app get()=InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
    private var cookie=""
    private var csrf=""
    private fun request(path:String,method:String="GET",body:JSONObject?=null,expected:Int=200):JSONObject {
        check(path.startsWith("/api/")&&!path.contains(".."))
        val connection=URL("$AUTH_ORIGIN$path").openConnection() as HttpsURLConnection
        try {
            connection.instanceFollowRedirects=false;connection.connectTimeout=15000;connection.readTimeout=120000;connection.requestMethod=method
            connection.setRequestProperty("Origin",AUTH_ORIGIN)
            if(cookie.isNotEmpty())connection.setRequestProperty("Cookie","$SESSION_COOKIE=$cookie")
            if(body!=null){connection.setRequestProperty("X-CSRF-Token",csrf);connection.setRequestProperty("Content-Type","application/json; charset=utf-8")
                connection.doOutput=true;connection.outputStream.use{it.write(body.toString().toByteArray(Charsets.UTF_8))}}
            assertEquals("Owned fixture HTTP $path",expected,connection.responseCode)
            connection.getHeaderField("Set-Cookie")?.substringBefore(';')?.let{header->
                check(header.startsWith("$SESSION_COOKIE="));cookie=header.substringAfter('=');check(cookie.matches(Regex("[A-Za-z0-9,-]{16,256}")))
            }
            return JSONObject((if(expected in 200..299)connection.inputStream else connection.errorStream).bufferedReader().use{it.readText()})
        }finally{connection.disconnect()}
    }
    @Test fun personalAndSharedControllerMigrationRetainsNormalEditsThroughLockAndColdUnlock()=runBlocking {
        val args=InstrumentationRegistry.getArguments()
        check(args.getString("genesisFullQaHttps")=="true"&&BuildConfig.DEBUG&&app.packageName=="ru.genesis.calendar.qa1103.debug"&&AUTH_ORIGIN=="https://localhost:4443")
        val certificate=CertificateFactory.getInstance("X.509").generateCertificate(ByteArrayInputStream(Base64.getDecoder().decode(requireNotNull(args.getString("genesisFixtureCa")))))
        val trust=KeyStore.getInstance(KeyStore.getDefaultType()).apply{load(null);setCertificateEntry("owned-loopback",certificate)}
        val managers=TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply{init(trust)}
        val previous=HttpsURLConnection.getDefaultSSLSocketFactory()
        HttpsURLConnection.setDefaultSSLSocketFactory(SSLContext.getInstance("TLS").apply{init(null,managers.trustManagers,null)}.socketFactory)
        var recovery:E2eeKeys.RecoveryState?=null
        var controller:AuthController?=null
        try {
            assertTrue(request("/api/qa/login?tier=business").getBoolean("synthetic"))
            val session=request("/api/session");val user=session.getJSONObject("user");val owner=user.getString("uid")
            assertTrue(user.getString("email").endsWith("@example.invalid"));assertFalse(user.optBoolean("isAdmin"));csrf=AuthProtocol.csrf(session.getString("csrf"))
            val saved=JSONObject().put("cookie",cookie).put("csrf",csrf).put("expiresAt",System.currentTimeMillis()+3600000)
            check(app.getSharedPreferences("genesis.native.auth.v1",Context.MODE_PRIVATE).edit().putString("session",LocalCipher().encrypt(saved.toString(),"genesis.native.auth.v2")).commit())
            val canary="NATIVE PRIVATE ${UUID.randomUUID()}"
            val space=request("/api/shared/spaces","POST",JSONObject().put("title","SPACE $canary"),expected=201).getJSONObject("space")
            val project=request("/api/shared/spaces/${space.getString("id")}/projects","POST",JSONObject().put("title","PROJECT $canary").put("layout","board"),expected=201).getJSONObject("project")
            val detail=request("/api/shared/projects/${project.getString("id")}")
            val statuses=detail.getJSONArray("statuses");val status=(0 until statuses.length()).map{statuses.getJSONObject(it)}.first{it.getInt("isDone")==0}
            val sharedTask=request("/api/shared/projects/${project.getString("id")}/tasks","POST",JSONObject().put("title","TASK $canary").put("description","Private shared body $canary")
                .put("statusId",status.getString("id")).put("requestId",UUID.randomUUID().toString()),expected=201).getJSONObject("task")
            val auth=AuthController.get(app);controller=auth;auth.onTrialForeground();auth.checkSession()
            withTimeout(120000){auth.state.first{it.user?.uid==owner&&it.ready&&!it.busy&&!it.requiresSignIn}}
            val accountScope=CloudAccountSnapshot.scopeFor(owner);assertEquals(accountScope,app.workspaceScope)
            val repository=WorkspaceStructureRepository(app)
            val localProject=GenesisProject(UUID.randomUUID().toString(),null,"personal","LOCAL $canary","Retained offline input",emptyList(),"active",0)
            repository.saveProject(localProject)
            assertTrue(repository.workspace.first().projects.any{it.id==localProject.id})
            val material=E2eeKeys.createRecoveryKit(owner);recovery=material
            var coldAttempt=0
            suspend fun coldUnlock(){
                val attempt=++coldAttempt;val outcome=CompletableDeferred<Exception?>()
                val credential=NativeMigrationCredential.captureVault(owner,"controller-cold-$attempt",attempt.toLong(),E2eeEnvelope.encode(material.secret),material.kit,
                    false,false,SystemClock.elapsedRealtime(),auth.privateUiOwnerGuard(owner))
                host.scenario.onActivity{activity->activity.setContent{
                    CompositionLocalProvider(LocalGenesisLanguage provides "en"){
                        RecoveryCredentialActivity(credential,"GENESIS cold unlock QA","Unlock the retained private account",
                            operation={_,held,admit->admit();auth.unlockPrivateVault(E2eeEnvelope.encode(held.secret),held.kit);admit()},
                            finished={_,error->outcome.complete(error)})
                    }
                }}
                val ui=UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                val pin=By.text(Pattern.compile(Pattern.quote("Use device screen lock"),Pattern.CASE_INSENSITIVE or Pattern.UNICODE_CASE))
                assertTrue("Explicit production credential prompt",ui.wait(Until.hasObject(pin),20000));requireNotNull(ui.findObject(pin)).click()
                ui.wait(Until.findObject(By.res("com.android.systemui:id/button_use_credential")),5000)?.click()
                assertTrue("Observed system PIN field",ui.wait(Until.hasObject(By.pkg(Pattern.compile("com\\.android\\.(settings|systemui)")).clazz(Pattern.compile(".*(EditText|PasswordTextView)"))),20000))
                ui.dumpWindowHierarchy(File(app.getExternalFilesDir(null),"genesis-owned-unlock-prompt.xml"))
                val fingerprint=java.security.MessageDigest.getInstance("SHA-256").digest(certificate.encoded).joinToString(""){"%02X".format(it)}
                File(app.getExternalFilesDir(null),"genesis-controller-pin-ready.json").writeText(JSONObject().put("fixture",fingerprint).put("request",attempt).toString())
                try{withTimeout(120000){outcome.await()}?.let{throw it}}
                finally{credential.close();host.scenario.onActivity{it.setContent{}}}
            }
            NativeMigrationUiState.show(owner,"en",false)
            val intent=requireNotNull(NativeMigrationUiState.state.value)
            assertFalse("A periodic worker must defer before changing the migration's authentication generation",auth.synchronizeInBackground())
            // Read-only diagnostics distinguish the refusing predicate without
            // printing account IDs, session material or any private content.
            val diagnosticClient=AuthController::class.java.getDeclaredField("client").apply{isAccessible=true}.get(auth) as AuthSessionClient
            val diagnosticLifecycle=AuthController::class.java.getDeclaredField("privateVaultLifecycle").apply{isAccessible=true}.get(auth) as java.util.concurrent.atomic.AtomicLong
            val diagnosticGeneration=diagnosticClient.currentGeneration()
            val diagnosticEpoch=app.workspaceEpoch
            val diagnosticBackup=NativeBackupEpoch.current()
            val diagnosticLife=diagnosticLifecycle.get()
            fun diagnose(phase:String){
                val value=JSONObject().put("phase",phase)
                    .put("sameGeneration",diagnosticClient.currentGeneration()==diagnosticGeneration)
                    .put("currentTransport",diagnosticClient.isCurrent(diagnosticGeneration))
                    .put("sameBackupEpoch",NativeBackupEpoch.current()==diagnosticBackup)
                    .put("sameWorkspaceEpoch",app.workspaceEpoch==diagnosticEpoch)
                    .put("sameLifecycle",diagnosticLifecycle.get()==diagnosticLife)
                    .put("foreground",diagnosticClient.isTrialForeground())
                    .put("sameOwner",auth.state.value.user?.uid==owner)
                    .put("requiresSignIn",auth.state.value.requiresSignIn)
                    .put("sameScope",app.workspaceScope==accountScope)
                InstrumentationRegistry.getInstrumentation().sendStatus(2,Bundle().apply{putString("stream","GENESIS_MIGRATION_GUARD:$value\n")})
                android.util.Log.i("Genesis336QaGuard",value.toString())
            }
            val diagnosticPhase=java.util.concurrent.atomic.AtomicReference("setup")
            fun progress(phase:String){
                check(phase in setOf("snapshot","sources","reconciliation","uploading","active"))
                diagnosticPhase.set(phase)
                android.util.Log.i("Genesis336QaPhase",phase)
                InstrumentationRegistry.getInstrumentation().sendStatus(2,Bundle().apply{putString("stream","GENESIS_MIGRATION_PHASE:$phase\n")})
            }
            val ownerGuard=auth.privateUiOwnerGuard(owner)
            val guard={check(NativeMigrationUiState.state.value?.id==intent.id){"E2EE_SOURCE_CAPTURE_CHANGED"};ownerGuard()}
            diagnose("before-personal")
            val migration=auth.preparePrivateMigration(material.secret,material.kit,guard)
            val sourceDiagnostic=launch(Dispatchers.IO){
                // Bounded read-only stacks, with method names only. No heap,
                // account state, URLs, arguments, keys or row values are logged.
                val sampled=mutableMapOf<String,Int>()
                repeat(40){
                    delay(30000)
                    val phase=diagnosticPhase.get();val count=sampled[phase]?:0
                    if(count>=3)return@repeat
                    sampled[phase]=count+1
                    val stacks=Thread.getAllStackTraces().entries.filter{(thread,frames)->thread.name=="main"||frames.any{it.className.startsWith("ru.genesis.calendar.")}}
                        .map{(thread,frames)->JSONObject().put("main",thread.name=="main").put("state",thread.state.name).put("phase",phase)
                            .put("methods",org.json.JSONArray(frames.take(18).map{it.className+"."+it.methodName}))}
                    android.util.Log.i("Genesis336QaThreads",org.json.JSONArray(stacks).toString())
                }
            }
            try{withTimeout(1200000){migration.run(material.secret,material.kit,::progress)}}catch(error:Throwable){diagnose("personal-refusal");throw error}finally{sourceDiagnostic.cancel();auth.closePrivateMigration(migration)}
            assertEquals("E2EE_UPGRADE_REQUIRED",request("/api/bootstrap",expected=409).getString("error"))
            val privateSession=request("/api/session")
            assertTrue("The actual identity endpoint declares private routing",requireNotNull(AuthProtocol.identity(privateSession)).privateVault)
            assertNotNull("The actual locked public profile is independently parseable",AccountSettings.fromResponse(privateSession))
            NativeMigrationUiState.close(intent.id);auth.checkSession()
            // Identity is adopted before unlocking. A locked private account is
            // deliberately not ready; waiting for ready here prevents the actual
            // production credential UI below from ever being reached.
            try{withTimeout(120000){auth.state.first{it.user?.uid==owner&&it.user?.privateVault==true&&!it.busy&&!it.requiresSignIn}}}
            catch(error:kotlinx.coroutines.TimeoutCancellationException){
                val panel=auth.state.value
                throw AssertionError("Private identity checkpoint: sameOwner=${panel.user?.uid==owner}, privateVault=${panel.user?.privateVault==true}, ready=${panel.ready}, busy=${panel.busy}, requiresSignIn=${panel.requiresSignIn}",error)
            }
            assertFalse("The migrated account still requires a cold credential unlock",NativePrivateProducts.isOpen(accountScope))
            assertFalse("The locked private identity must not expose ready content",auth.state.value.ready)
            coldUnlock()
            withTimeout(120000){repository.workspace.first{row->row.projects.any{it.id==localProject.id&&it.title==localProject.title}}}
            val uiPreferences=ru.genesis.calendar.data.LocalPreferences(app,accountScope)
            val retainedUiOriginal=uiPreferences.backupRaw().toString()
            uiPreferences.set("weatherTemperatureUnit","fahrenheit")
            assertEquals("fahrenheit",uiPreferences.values.first().weatherTemperatureUnit)
            uiPreferences.setPending("time","12h")
            uiPreferences.setRemote("time","24h")
            assertFalse("A delayed public projection cannot overwrite a pending preference",uiPreferences.values.first().use24)
            uiPreferences.setPending("time","24h")
            uiPreferences.acknowledge(mapOf("time" to "12h"))
            assertEquals("24h",uiPreferences.pending.first()["time"])
            uiPreferences.acknowledge(mapOf("time" to "24h"))
            assertTrue(uiPreferences.pending.first().isEmpty())
            auth.updateSharedPreference("time","12h")
            withTimeout(120000){auth.state.first{!it.busy&&it.ready&&it.user?.uid==owner&&it.accountSettings?.timeFormat=="12h"}}
            assertTrue("The real public profile write acknowledged its encrypted pending entry",uiPreferences.pending.first().isEmpty())
            assertFalse(uiPreferences.values.first().use24)
            assertEquals("Private UI writes retain the exact legacy DataStore source",retainedUiOriginal,uiPreferences.backupRaw().toString())
            repository.saveProject(localProject.copy(title="EDITED $canary"));NativePrivateProducts.flush(accountScope)
            auth.onTrialBackground();assertFalse(NativePrivateProducts.isOpen(accountScope));auth.onTrialForeground()
            coldUnlock()
            assertEquals("fahrenheit",uiPreferences.values.first().weatherTemperatureUnit)
            assertFalse("The acknowledged public preference survives a real cold PIN entry",uiPreferences.values.first().use24)
            assertTrue(uiPreferences.pending.first().isEmpty())
            assertEquals(retainedUiOriginal,uiPreferences.backupRaw().toString())
            withTimeout(120000){repository.workspace.first{row->row.projects.any{it.id==localProject.id&&it.title=="EDITED $canary"}}}
            for((kind,resource)in listOf("project" to project,"space" to space)){
                // Only provider delivery is synthetic. Refresh its confirmation
                // before each new scope; the real five-minute server guard,
                // signed bootstrap, keys, source adapters and storage remain live.
                assertTrue(request("/api/qa/identity-confirmation","POST",JSONObject().put("confirmed",true)).getBoolean("synthetic"))
                val resourceId=resource.getString("id");val target=E2eeProductMigration.Target(owner,"$kind:$resourceId",kind,resourceId)
                NativeMigrationUiState.show(owner,"en",true,target);val transfer=requireNotNull(NativeMigrationUiState.state.value)
                val sharedOwnerGuard=auth.privateUiOwnerGuard(owner)
                val bound={check(NativeMigrationUiState.state.value?.id==transfer.id){"E2EE_SOURCE_CAPTURE_CHANGED"};sharedOwnerGuard()}
                val shared=auth.prepareSharedPrivateMigration(target,material.secret,material.kit,bound)
                try{withTimeout(1200000){shared.run(material.secret,material.kit,::progress)}}
                catch(error:AuthFailure){throw AssertionError("Shared controller HTTP refusal: kind=${error.kind}, status=${error.httpStatus}, retryAfterSeconds=${error.retryAfterSeconds}",error)}
                finally{auth.closePrivateMigration(shared)}
                auth.finishSharedPrivateMigration(target);NativeMigrationUiState.close(transfer.id)
            }
            val statusResponse=auth.privateMigrationStatus().getJSONArray("scopes")
            assertEquals(3,(0 until statusResponse.length()).count{statusResponse.getJSONObject(it).getString("state")=="active"})
            assertEquals("E2EE_UPGRADE_REQUIRED",request("/api/shared/projects/${project.getString("id")}",expected=409).getString("error"))
            val opened=withContext(Dispatchers.IO){auth.sharedProject(project.getString("id"))}.getJSONArray("tasks")
            assertTrue((0 until opened.length()).any{opened.getJSONObject(it).getString("id")==sharedTask.getString("id")&&opened.getJSONObject(it).getString("title")==sharedTask.getString("title")})
        } finally {
            NativeMigrationUiState.state.value?.let{NativeMigrationUiState.close(it.id)}
            controller?.onTrialBackground();recovery?.secret?.fill(0);HttpsURLConnection.setDefaultSSLSocketFactory(previous)
        }
    }
}
