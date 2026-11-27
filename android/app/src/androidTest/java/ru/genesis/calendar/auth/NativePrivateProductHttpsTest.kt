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
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.data.GenesisBackupContainer
import ru.genesis.calendar.data.GenesisProject
import ru.genesis.calendar.data.LocalCipher
import ru.genesis.calendar.data.LocalTask
import ru.genesis.calendar.data.MindmapDocument
import ru.genesis.calendar.data.MindmapRepository
import ru.genesis.calendar.data.PrivateSharedMapBinding
import ru.genesis.calendar.data.SharedMindmapTransport
import ru.genesis.calendar.data.TaskOccurrences
import ru.genesis.calendar.data.WorkspaceStructureRepository
import ru.genesis.calendar.domain.RecurrenceConfig
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
    private var cookieExpiresAt = 0L
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
            val cookieHeaders = connection.headerFields.filterKeys { it?.equals("Set-Cookie", true) == true }.values.flatten()
            val update = AuthProtocol.cookie(cookieHeaders, System.currentTimeMillis())
            if (update.present) {
                cookie = update.value
                cookieExpiresAt = update.expiresAt
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
            check(cookie.isNotBlank() && cookieExpiresAt > System.currentTimeMillis())
            val saved=JSONObject().put("cookie",cookie).put("csrf",csrf).put("expiresAt",cookieExpiresAt)
            check(app.getSharedPreferences("genesis.native.auth.v1",Context.MODE_PRIVATE).edit().putString("session",LocalCipher().encrypt(saved.toString(),"genesis.native.auth.v2")).commit())
            val canary="NATIVE PRIVATE ${UUID.randomUUID()}"
            val verifySharedRecords = args.getString("genesisVerifyRetainedSharedRecords") == "true"
            val fixtureFile = if (verifySharedRecords) ByteArray(1300 * 1024) { (32 + it % 90).toByte() } else null
            val fixtureImage = if (verifySharedRecords) Base64.getDecoder().decode(
                "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6lWQAAAAASUVORK5CYII="
            ) else null
            val space=request("/api/shared/spaces","POST",JSONObject().put("title","SPACE $canary"),expected=201).getJSONObject("space")
            val project=request("/api/shared/spaces/${space.getString("id")}/projects","POST",JSONObject().put("title","PROJECT $canary").put("layout","board"),expected=201).getJSONObject("project")
            val detail=request("/api/shared/projects/${project.getString("id")}")
            val statuses=detail.getJSONArray("statuses");val status=(0 until statuses.length()).map{statuses.getJSONObject(it)}.first{it.getInt("isDone")==0}
            val taskInput = JSONObject().put("title", "TASK $canary").put("description", "Private shared body $canary")
                .put("statusId", status.getString("id")).put("requestId", UUID.randomUUID().toString())
            if (fixtureFile != null && fixtureImage != null) {
                taskInput.put("attachments", JSONArray().put(JSONObject().put("name", "retained-private-file.txt")
                    .put("data", "data:text/plain;base64," + Base64.getEncoder().encodeToString(fixtureFile))))
                taskInput.put("imageData", "data:image/png;base64," + Base64.getEncoder().encodeToString(fixtureImage))
            }
            val sharedTask = request("/api/shared/projects/${project.getString("id")}/tasks", "POST", taskInput,
                expected = 201).getJSONObject("task")
            val fixtureMaps = if (verifySharedRecords) seedSharedMaps(space.getString("id"), project.getString("id"), canary)
                else emptyList()
            val auth=AuthController.get(app);controller=auth;auth.onTrialForeground();auth.checkSession()
            withTimeout(120000){auth.state.first{it.user?.uid==owner&&it.ready&&!it.busy&&!it.requiresSignIn}}
            val accountScope=CloudAccountSnapshot.scopeFor(owner);assertEquals(accountScope,app.workspaceScope)
            val projectId = project.getString("id")
            val spaceId = space.getString("id")
            val savedDrafts = if (args.getString("genesisVerifySharedDraftArchive") == "true") {
                val workflow = WorkflowLifecycle.newEdit(auth.sharedWorkflow(projectId))
                workflow.getJSONObject("draft").getJSONArray("statuses").getJSONObject(0).put("wipLimit", 7)
                val access = ProjectAccessProtocol.newEdit(auth.sharedProjectAccess(spaceId, owner))
                access.getJSONObject("draft").put("allProjects", false).put("grants", JSONArray().put(
                    JSONObject().put("projectId", projectId).put("role", "viewer").put("includeDescendants", false)
                ))
                val savedWorkflow = auth.saveSharedWorkflowDraft(projectId, null, workflow)
                val savedAccess = auth.saveSharedProjectAccessDraft(spaceId, owner, null, access)
                assertTrue(E2eeProductJson.same(savedWorkflow, auth.sharedWorkflowDraft(projectId)))
                assertTrue(E2eeProductJson.same(savedAccess, auth.sharedProjectAccessDraft(spaceId, owner)))
                mapOf("project.local-work" to savedWorkflow, "space.local-work" to savedAccess)
            } else emptyMap()
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
                val credentialField = By.pkg(Pattern.compile("com\\.android\\.(settings|systemui)"))
                    .clazz(Pattern.compile(".*(EditText|PasswordTextView)"))
                // Without an enrolled biometric Android opens the credential field directly.
                if (ui.wait(Until.findObject(credentialField), 1500) == null) {
                    ui.wait(Until.findObject(pin), 10000)?.click()
                    ui.wait(Until.findObject(By.res("com.android.systemui:id/button_use_credential")),5000)?.click()
                }
                assertTrue("Observed system PIN field",ui.wait(Until.hasObject(credentialField),20000))
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
            val privateTask = verifyPrivateTaskEdits(accountScope)
            verifyPrivateTaskSync(auth, accountScope, privateTask)
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
            assertEquals(privateTask.title, app.repository.get(privateTask.id)?.title)
            assertEquals("fahrenheit",uiPreferences.values.first().weatherTemperatureUnit)
            assertFalse("The acknowledged public preference survives a real cold PIN entry",uiPreferences.values.first().use24)
            assertTrue(uiPreferences.pending.first().isEmpty())
            assertEquals(retainedUiOriginal,uiPreferences.backupRaw().toString())
            withTimeout(120000){repository.workspace.first{row->row.projects.any{it.id==localProject.id&&it.title=="EDITED $canary"}}}
            if (args.getString("genesisPersonalTasksOnly") == "true") return@runBlocking
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
                // The retained fixture also migrates and verifies each chunk of a 1.3 MiB attachment.
                val sharedTimeout = if (verifySharedRecords) 45 * 60_000L else 20 * 60_000L
                try{withTimeout(sharedTimeout){shared.run(material.secret,material.kit,::progress)}}
                catch(error:AuthFailure){throw AssertionError("Shared controller HTTP refusal: kind=${error.kind}, status=${error.httpStatus}, retryAfterSeconds=${error.retryAfterSeconds}",error)}
                finally{auth.closePrivateMigration(shared)}
                auth.finishSharedPrivateMigration(target);NativeMigrationUiState.close(transfer.id)
            }
            val statusResponse=auth.privateMigrationStatus().getJSONArray("scopes")
            assertEquals(3,(0 until statusResponse.length()).count{statusResponse.getJSONObject(it).getString("state")=="active"})
            assertEquals("E2EE_UPGRADE_REQUIRED",request("/api/shared/projects/${project.getString("id")}",expected=409).getString("error"))
            val opened=withContext(Dispatchers.IO){auth.sharedProject(project.getString("id"))}.getJSONArray("tasks")
            assertTrue((0 until opened.length()).any{opened.getJSONObject(it).getString("id")==sharedTask.getString("id")&&opened.getJSONObject(it).getString("title")==sharedTask.getString("title")})
            if (savedDrafts.isNotEmpty() || verifySharedRecords) {
                auth.onTrialBackground()
                assertFalse(NativePrivateProducts.isOpen(accountScope))
                auth.onTrialForeground()
                coldUnlock()
                withContext(Dispatchers.IO) {
                    val spaces = auth.sharedSpaces().getJSONArray("spaces")
                    assertTrue((0 until spaces.length()).any { spaces.getJSONObject(it).getString("id") == spaceId })
                    val snapshot = auth.sharedProject(projectId)
                    assertEquals(projectId, snapshot.getJSONObject("project").getString("id"))
                    if (savedDrafts.isNotEmpty()) {
                        val archive = E2eeContentArchive(NativePrivateProducts.account(accountScope, owner)).capture()
                        val recoveryKey = GenesisBackupContainer.newRecoveryKey()
                        val reopened = GenesisBackupContainer.open(GenesisBackupContainer.seal(archive, recoveryKey), recoveryKey)
                        assertRetainedDrafts(reopened, owner, mapOf("project" to projectId, "space" to spaceId), savedDrafts)
                    }
                    if (fixtureFile != null && fixtureImage != null) {
                        val tasks = snapshot.getJSONArray("tasks")
                        val retained = (0 until tasks.length()).map(tasks::getJSONObject)
                            .single { it.getString("id") == sharedTask.getString("id") }
                        val attachment = retained.getJSONArray("attachments").getJSONObject(0)
                        assertEquals("retained-private-file.txt", attachment.getString("name"))
                        assertArrayEquals(fixtureFile, auth.sharedTaskFile(retained.getString("id"), attachment.getString("id")))
                        val image = NativePrivateProducts.sharedRequest(accountScope, "GET", "/shared/tasks/${retained.getString("id")}/image", null)
                        assertArrayEquals(fixtureImage, E2eeEnvelope.decode(image.getString("data"), image.getInt("size")))
                        verifySharedMaps(auth, accountScope, owner, spaceId, fixtureMaps)
                        val created = auth.createSharedTask(projectId, JSONObject().put("title", "NEW $canary").put("statusId", ""))
                        assertEquals("chaos-open:$projectId", created.getJSONObject("task").getString("statusId"))
                    }
                }
            }
        } finally {
            NativeMigrationUiState.state.value?.let{NativeMigrationUiState.close(it.id)}
            controller?.onTrialBackground();recovery?.secret?.fill(0);HttpsURLConnection.setDefaultSSLSocketFactory(previous)
        }
    }

    private fun seedSharedMaps(spaceId: String, projectId: String, canary: String): List<Pair<MindmapDocument, MindmapDocument>> =
        listOf(projectId, null).map { project ->
            val first = MindmapDocument.new("MAP ${if (project == null) "SPACE" else "PROJECT"} $canary", project)
            val second = first.copy(nodes = first.nodes.map { it.copy(text = "Edited ${it.text}") })
            for ((revision, map) in listOf(first, second).withIndex()) {
                val result = request("/api/shared/spaces/$spaceId/mindmaps/${map.id}", "PUT", JSONObject()
                    .put("expectedRevision", revision).put("schemaVersion", 1)
                    .put("operationId", UUID.randomUUID().toString()).put("document", map.json()))
                assertEquals(revision + 1, result.getInt("revision"))
            }
            first to second
        }

    private suspend fun verifyPrivateTaskEdits(scope: String): LocalTask {
        val tasks = app.repository
        assertEquals(scope, tasks.scope)
        assertEquals("active", app.database.dao().legacyScopeFence(scope)?.phase)
        val webId = "web:${UUID.randomUUID()}"
        NativePrivateProducts.mutate(scope) { snapshot ->
            snapshot.getJSONArray("tasks").put(JSONObject().put("id", webId).put("title", "Undated web task")
                .put("customLabel", "preserved"))
            snapshot to Unit
        }
        val webTask = requireNotNull(tasks.get(webId))
        assertEquals("", webTask.date)
        assertEquals(5, webTask.priority)
        val updatedWebTask = tasks.save(webTask.copy(description = "Edited on Android"))
        assertEquals("preserved", JSONObject(updatedWebTask.sourceFieldsJson).getString("customLabel"))
        tasks.delete(webId, updatedWebTask.revision)
        val series = tasks.save(LocalTask(title = "Private task series", date = "2026-11-26",
            recurrence = RecurrenceConfig(enabled = true, mode = "classic", pattern = "daily", rangeEnd = "2026-11-27")))
        val occurrence = tasks.saveOccurrence(TaskOccurrences.standaloneDraft(series, "2026-11-27"))
        assertTrue("Detached date is removed from the parent series",
            "2026-11-27" in requireNotNull(tasks.get(series.id)).recurrenceExcludedDates)
        val edited = tasks.save(occurrence.copy(title = "Updated private task"))
        tasks.complete(edited.id)
        assertTrue(requireNotNull(tasks.get(edited.id)).done)
        val currentSeries = requireNotNull(tasks.get(series.id))
        tasks.delete(currentSeries.id, currentSeries.revision)
        assertNull(tasks.get(series.id))
        assertNull("Private edits never write to the retired task table", app.database.dao().task(scope, edited.id))
        assertNull(app.database.dao().task(scope, series.id))
        return edited
    }

    private suspend fun verifyPrivateTaskSync(auth: AuthController, scope: String, task: LocalTask) {
        val pending = ru.genesis.calendar.data.PrivatePersonalDocuments.observePendingWrites(
            scope, app.database.dao().observePendingOutbox(scope)
        )
        assertTrue("The drawer observes the encrypted edit before acknowledgement", pending.first())
        withContext(Dispatchers.Main) { auth.syncPending() }
        withTimeout(120_000) { pending.first { !it } }
        val remoteDescription = "Confirmed in a second product view"
        withContext(Dispatchers.IO) {
            val other = E2eePersonalProduct(NativePrivateProducts.currentAccount(scope))
            val confirmed = other.load()
            val rows = confirmed.getJSONArray("tasks")
            val row = (0 until rows.length()).map(rows::getJSONObject).single { it.getString("id") == task.id }
            assertTrue(row.getBoolean("done"))
            row.put("description", remoteDescription)
            other.stageSnapshot(confirmed)
            other.flush()
            assertFalse(other.hasPendingChanges())
        }
        assertNotEquals(remoteDescription, app.repository.get(task.id)?.description)
        // Use the ordinary foreground refresh. A previous flush can still be returning from IO
        // after its acknowledgement has become visible in the pending flow.
        withTimeout(120_000) {
            while (app.repository.get(task.id)?.description != remoteDescription) {
                withContext(Dispatchers.Main) { auth.refreshIfReady() }
                delay(250)
            }
            auth.taskSync.first { it.scope == scope && it.confirmed && !it.loading }
        }
        assertFalse(pending.first())
        assertNull(auth.state.value.outgoingSyncIssue)
    }

    private suspend fun verifySharedMaps(
        auth: AuthController,
        accountScope: String,
        owner: String,
        spaceId: String,
        expected: List<Pair<MindmapDocument, MindmapDocument>>,
    ) {
        val maps = MindmapRepository(app.database, SharedMindmapProtocol.scope(accountScope, spaceId),
            SharedMindmapProtocol.uid(owner, spaceId), SharedMindmapTransport(auth, owner, spaceId),
            privateShared = PrivateSharedMapBinding(accountScope, owner, spaceId))
        maps.refresh()
        for ((first, second) in expected) {
            val opened = maps.records.value.single { it.document.id == second.id }
            assertTrue(E2eeProductJson.same(second.json(), opened.document.json()))
            val history = maps.history(second.id).associateBy { it.revision }
            assertEquals(setOf(1L, 2L), history.keys)
            assertTrue(E2eeProductJson.same(first.json(), history.getValue(1L).document.json()))
            assertTrue(E2eeProductJson.same(second.json(), history.getValue(2L).document.json()))
            val edited = second.copy(nodes = second.nodes.map { it.copy(note = "Edited after migration") })
            maps.save(edited)
            assertTrue(E2eeProductJson.same(edited.json(), maps.serverVersion(edited.id).document.json()))
        }
    }

    private fun assertRetainedDrafts(
        archive: JSONObject,
        owner: String,
        resources: Map<String, String>,
        savedDrafts: Map<String, JSONObject>,
    ) {
        fun rows(array: JSONArray) = (0 until array.length()).map(array::getJSONObject)
        val section = rows(archive.getJSONArray("sections")).single { it.getString("id") == "shared-drafts" }
        val data = section.getJSONObject("data")
        assertEquals("history-only", data.getString("execution"))
        val appearances = mutableListOf<Pair<String, String>>()
        for (entry in rows(data.getJSONArray("entries"))) {
            val scope = entry.optJSONObject("scope") ?: continue
            val snapshot = entry.getJSONObject("current")
            if (snapshot.getString("mediaType") != "application/json" || snapshot.getInt("size") == 0) continue
            val bytes = E2eeEnvelope.decode(snapshot.getString("bytes"), snapshot.getInt("size"))
            try {
                val document = org.json.JSONTokener(bytes.toString(Charsets.UTF_8)).nextValue() as? JSONObject ?: continue
                if (document.optString("format") != "genesis-private-local-work-v1") continue
                val path = document.getString("pathId")
                assertEquals("history-only", document.getString("execution"))
                val kind = path.substringBefore('.')
                assertEquals(owner, scope.getString("ownerId"))
                assertEquals(kind, scope.getString("kind"))
                assertEquals(resources.getValue(kind), scope.getString("resourceId"))
                for (row in rows(document.getJSONArray("entries"))) {
                    val value = row.getJSONObject("content")
                    assertEquals("history-only", value.getString("execution"))
                    val record = org.json.JSONTokener(value.getString("rawDocument")).nextValue() as? JSONObject ?: continue
                    for ((expectedPath, expectedRecord) in savedDrafts) {
                        if (E2eeProductJson.same(expectedRecord, record)) appearances.add(expectedPath to path)
                    }
                }
            } finally {
                bytes.fill(0)
            }
        }
        assertEquals(savedDrafts.keys.map { it to it }.toSet(), appearances.toSet())
        assertEquals("Each unsent record must occur exactly once in its own scope", savedDrafts.size, appearances.size)
    }
}
