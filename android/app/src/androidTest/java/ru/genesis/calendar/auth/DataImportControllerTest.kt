package ru.genesis.calendar.auth

import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.ui.importInitialSelection
import java.util.UUID
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Real controller/Keystore/draft path with a synthetic offline identity; no session or network is used. */
class DataImportControllerTest {
    private fun inAccount(block: suspend (AuthController, GenesisApplication, MutableStateFlow<AuthPanelState>, String, String) -> Unit) = runBlocking {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        assumeTrue("Separate import QA installation required", context.packageName.endsWith(".c5qa.debug"))
        val app = context.applicationContext as GenesisApplication; val controller = AuthController.get(app)
        @Suppress("UNCHECKED_CAST")
        val state = AuthController::class.java.getDeclaredField("mutableState").apply { isAccessible = true }.get(controller) as MutableStateFlow<AuthPanelState>
        val previous = state.value; require(previous.user == null) { "Synthetic test requires an unsigned QA installation" }
        val account = "controller-import-qa-${UUID.randomUUID()}"; val space = UUID.randomUUID().toString(); val project = UUID.randomUUID().toString()
        val settings = AccountSettings(emptyList(), SyncRouting("fixed", emptyList(), emptyMap()), false, "STANDART", 0, "profane", "lunar", "24h", false, "ru",
            sharedProjectsEligible = true, sharedProjectsEnabled = true)
        app.activateAccount(account)
        state.value = AuthPanelState(ready = true, requiresSignIn = true, user = ServerIdentity(account, "Synthetic QA", "import-qa@example.invalid"), accountSettings = settings)
        val synthetic = state.value
        try { block(controller, app, state, space, project) }
        finally {
            app.activateAccount(account); state.value = synthetic
            runCatching {
                controller.sharedDataImportDraft(space, project)?.let { controller.removeSharedDataImportDraft(space, project, it.getString("stamp")) }
                controller.sharedDataImportCopies(space, project).forEach { controller.removeSharedDataImportCopy(space, project, it.getString("id"), it.getString("stamp")) }
                controller.sharedProjectAccessDraft(space, project)?.let { controller.removeSharedProjectAccessDraft(space, project, it.getString("stamp")) }
            }
            state.value = previous; app.activateAccount(null)
        }
    }
    private fun selection(space: String) = importInitialSelection(space, null, "Synthetic import", "Open", "Done", "profane", "UTC", false)
    @Test fun offlineProjectAccessDraftIsScopedAndNeverStartsAPermissionWrite() = inAccount { controller, app, state, space, user ->
        val raw = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("project-access/state.json").bufferedReader().use { it.readText() }).put("spaceId", space).put("userId", user)
        val saved = controller.saveSharedProjectAccessDraft(space, user, null, ProjectAccessProtocol.newEdit(raw))
        assertEquals(saved.toString(), controller.sharedProjectAccessDraft(space, user)!!.toString())
        val calls: List<suspend () -> Unit> = listOf({ controller.sharedProjectAccessMembers(space); Unit }, { controller.sharedProjectAccess(space, user); Unit },
            { controller.previewSharedProjectAccessDraft(space, user, saved.getString("stamp")); Unit })
        for (call in calls) assertEquals(AuthFailure.Kind.NETWORK, (runCatching { call() }.exceptionOrNull() as? AuthFailure)?.kind)
        val account = state.value.user!!.uid
        app.activateAccount("other-access-scope")
        assertTrue(runCatching { controller.saveSharedProjectAccessDraft(space, user, saved.getString("stamp"), saved.getJSONObject("edit")) }.exceptionOrNull() is CancellationException)
        app.activateAccount(account)
        assertEquals(saved.getString("stamp"), controller.sharedProjectAccessDraft(space, user)!!.getString("stamp"))
        state.value = state.value.copy(accountSettings = state.value.accountSettings!!.copy(sharedProjectsEnabled = false))
        assertEquals(AuthFailure.Kind.UNAUTHORIZED, (runCatching { controller.sharedProjectAccessDraft(space, user) }.exceptionOrNull() as? AuthFailure)?.kind)
    }
    @Test fun readOnlyReportRoutesRejectOfflineAndRevokedAccessBeforeAnyRequest() = inAccount { controller, _, state, space, project ->
        val options = JSONObject().put("filter", JSONObject().put("projectIds", org.json.JSONArray().put(project)))
            .put("from", "2026-10-01").put("to", "2026-10-31").put("calendarMode", "profane")
            .put("calendarContext", selection(space).getJSONObject("parse").getJSONObject("calendarContext")).put("cycleStartStatusIds", org.json.JSONArray())
        val calls: List<suspend () -> Unit> = listOf(
            { controller.sharedTeamReport(options); Unit }, { controller.checkSharedTeamReport("synthetic-token"); Unit },
            { controller.sharedTeamReportTasks("synthetic-token", "all", null); Unit })
        for (call in calls) assertEquals(AuthFailure.Kind.NETWORK, (runCatching { call() }.exceptionOrNull() as? AuthFailure)?.kind)
        state.value = state.value.copy(accountSettings = state.value.accountSettings!!.copy(sharedProjectsEnabled = false))
        for (call in calls) assertEquals(AuthFailure.Kind.UNAUTHORIZED, (runCatching { call() }.exceptionOrNull() as? AuthFailure)?.kind)
    }
    @Test fun offlineControllerKeepsEncryptedDraftsAndBlocksPreviewBeforeAnyRequest() = inAccount { controller, _, _, space, project ->
        val chosen = controller.chooseSharedDataImportSource(space, project, null, "offline.json", selection(space)) { "{\"synthetic\":true}".byteInputStream() }
        val edit = JSONObject(chosen.getJSONObject("edit").toString())
        edit.getJSONObject("selection").getJSONObject("fieldDefaults").put("effort:legacy", 0).put("approved", false)
        val saved = controller.saveSharedDataImportDraft(space, project, chosen.getString("stamp"), edit)
        val restored = controller.sharedDataImportDraft(space, project)!!
        assertEquals(saved.toString(), restored.toString())
        val result = runCatching { controller.inspectSharedDataImport(space, project, restored.getString("stamp")) }
        assertEquals(AuthFailure.Kind.NETWORK, (result.exceptionOrNull() as? AuthFailure)?.kind)
        assertEquals(saved.getString("stamp"), controller.sharedDataImportDraft(space, project)!!.getString("stamp"))
        assertTrue(controller.pendingSharedDataUndos(space).isEmpty())
    }
    @Test fun accountScopeAndPermissionChangesCancelAnOpenSourceBeforeItCanReplaceTheDraft() = inAccount { controller, app, state, space, project ->
        val original = controller.chooseSharedDataImportSource(space, project, null, "kept.json", selection(space)) { "{\"keep\":true}".byteInputStream() }
        val synthetic = state.value; val account = synthetic.user!!.uid
        for (change in listOf("account", "scope", "permission")) {
            supervisorScope {
                val opened = CountDownLatch(1); val release = CountDownLatch(1)
                val replacement = async(Dispatchers.IO) {
                    controller.chooseSharedDataImportSource(space, project, original.getString("stamp"), "late.json", selection(space)) {
                        opened.countDown(); check(release.await(10, TimeUnit.SECONDS)); "{\"late\":true}".byteInputStream()
                    }
                }
                try {
                    assertTrue(opened.await(10, TimeUnit.SECONDS))
                    when (change) {
                        "account" -> state.value = synthetic.copy(user = ServerIdentity("another-synthetic-account", "QA", "other@example.invalid"))
                        "scope" -> app.activateAccount("another-synthetic-scope")
                        else -> state.value = synthetic.copy(accountSettings = synthetic.accountSettings!!.copy(sharedProjectsEnabled = false))
                    }
                    release.countDown()
                    assertTrue("$change must cancel the source write", runCatching { replacement.await() }.exceptionOrNull() is CancellationException)
                } finally { release.countDown(); replacement.cancelAndJoin(); app.activateAccount(account); state.value = synthetic }
            }
            val kept = controller.sharedDataImportDraft(space, project)!!
            assertEquals(original.getString("stamp"), kept.getString("stamp"))
            assertEquals("kept.json", kept.getJSONObject("edit").getJSONObject("source").getString("name"))
        }
    }
}
