package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import java.io.File

internal fun accessUiFile(name: String) = JSONObject(InstrumentationRegistry.getInstrumentation().context.assets.open("project-access/$name.json").bufferedReader().use { it.readText() })

internal class AccessUiFixture(spaceOverride: String? = null) : SharedWorkspaceGateway {
    val snapshot = accessUiFile("state").apply { if (spaceOverride != null) put("spaceId", spaceOverride) }
    val space = snapshot.getString("spaceId"); val user = snapshot.getString("userId")
    val members = accessUiFile("members").apply { getJSONObject("space").put("id", space) }
    private val storage = object : PlanningJournalStorage {
        val values = mutableMapOf<String, String>()
        override fun <T> locked(block: () -> T) = synchronized(this, block)
        override fun read(key: String) = values[key]
        override fun write(key: String, value: String) { values[key] = value }
        override fun remove(key: String) { values.remove(key) }
    }
    var revoked = false; var offline = false; var blocked = false; var lose = false
    var sends = 0; var previews = 0; val bodies = mutableListOf<String>(); val receipts = mutableMapOf<String, JSONObject>()
    private fun check() { if (revoked) throw AuthFailure(AuthFailure.Kind.UNAUTHORIZED); if (offline) throw AuthFailure(AuthFailure.Kind.NETWORK) }
    private fun target(user: String) = JSONObject(snapshot.toString()).put("userId", user).apply {
        val member = importRows(members.getJSONArray("members")).first { it.getString("userId") == user }
        put("memberRole", member.getString("role"))
    }
    private val access = object : ProjectAccessDraftAccess {
        override fun check() = Unit
        override fun state(space: String, user: String): JSONObject { this@AccessUiFixture.check(); return target(user) }
        override fun preview(space: String, user: String, draft: JSONObject): JSONObject {
            this@AccessUiFixture.check(); previews++
            return accessUiFile("preview").put("desired", draft).put("fingerprint", snapshot.getString("fingerprint")).put("revision", snapshot.getLong("revision")).apply {
                if (blocked) getJSONArray("blockers").put(JSONObject().put("projectId", getJSONArray("projects").getJSONObject(0).getString("id")).put("code", "LAST_OWNER"))
            }
        }
        override fun send(space: String, user: String, body: JSONObject): JSONObject {
            this@AccessUiFixture.check(); sends++; bodies += body.toString()
            val receipt = receipts.getOrPut(body.getString("operationId")) {
                snapshot.put("revision", snapshot.getLong("revision") + 1).put("fingerprint", "d".repeat(64)).put("allProjects", body.getBoolean("allProjects")).put("grants", body.getJSONArray("grants"))
                JSONObject().put("operationId", body.getString("operationId")).put("revision", snapshot.getLong("revision")).put("changed", 3)
                    .put("allProjects", body.getBoolean("allProjects")).put("grants", body.getJSONArray("grants"))
            }
            if (lose) { lose = false; throw AuthFailure(AuthFailure.Kind.NETWORK) }; return JSONObject(receipt.toString())
        }
        override fun hasTaskQueue() = false
    }
    private fun service() = ProjectAccessDraftService(PlanningJournal(storage, contract = ProjectAccessJournalContract), "native-access-ui", access)
    init { service().save(space, user, null, ProjectAccessProtocol.newEdit(snapshot).put("draft", accessUiFile("preview").getJSONObject("desired"))) }
    fun stored() = service().load(space, user)!!
    fun storedCopies() = service().copies(space, user)
    fun peerSave() { val old = stored(); service().save(space, user, old.getString("stamp"), old.getJSONObject("edit")) }
    override suspend fun sharedProjectAccessMembers(spaceId: String): JSONObject { check(); return JSONObject(members.toString()) }
    override suspend fun sharedProjectAccess(spaceId: String, userId: String): JSONObject { check(); return target(userId) }
    override suspend fun sharedProjectAccessDraft(spaceId: String, userId: String) = service().load(spaceId, userId)
    override suspend fun sharedProjectAccessCopies(spaceId: String, userId: String) = service().copies(spaceId, userId)
    override suspend fun saveSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String?, edit: JSONObject) = service().save(spaceId, userId, stamp, edit)
    override suspend fun previewSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().preview(spaceId, userId, stamp)
    override suspend fun prepareSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().prepare(spaceId, userId, stamp)
    override suspend fun sendSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().send(spaceId, userId, stamp)
    override suspend fun rebaseSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().rebase(spaceId, userId, stamp)
    override suspend fun removeSharedProjectAccessDraft(spaceId: String, userId: String, stamp: String) = service().remove(spaceId, userId, stamp)
    override suspend fun saveSharedProjectAccessCopy(spaceId: String, userId: String, id: String, stamp: String?, edit: JSONObject) = service().saveCopy(spaceId, userId, id, stamp, edit)
    override suspend fun useSharedProjectAccessCopy(spaceId: String, userId: String, id: String, copyStamp: String, stamp: String?) = service().useCopy(spaceId, userId, id, copyStamp, stamp)
    override suspend fun removeSharedProjectAccessCopy(spaceId: String, userId: String, id: String, stamp: String) = service().removeCopy(spaceId, userId, id, stamp)
}

class SharedProjectAccessUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private var fixture by mutableStateOf<AccessUiFixture?>(null); private var epoch by mutableIntStateOf(0)
    private var dark by mutableStateOf(false); private var language by mutableStateOf("ru")
    private var installed = false; private var density: Density? = null; private var closed = false; private var notices = 0
    private fun show(value: AccessUiFixture, editing: Boolean = true) {
        if (!installed) {
            compose.setContent { fixture?.let { current -> key(epoch) {
                val actual = LocalDensity.current; SideEffect { density = actual }
                CompositionLocalProvider(LocalGenesisUserId provides "native-access-ui-account", LocalGenesisLanguage provides language, LocalEveningTheme provides dark) {
                    MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize().testTag("access-test-window")) {
                        SharedProjectAccessScreen(current, current.space, { closed = true }, { closed = true }, { notices++ })
                    } }
                }
            } } }; installed = true
        }
        compose.runOnIdle { fixture = value; epoch++; closed = false; notices = 0 }
        compose.waitUntil(10000) { if (editing) runCatching { compose.onNodeWithTag("access-review").assertIsEnabled() }.isSuccess
            else compose.onAllNodesWithTag("access-copy-list").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun click(tag: String) {
        val node = compose.onNodeWithTag(tag, useUnmergedTree = true)
        if (runCatching { node.assertIsDisplayed() }.isFailure) node.performScrollTo()
        node.assertIsEnabled().performClick(); compose.waitForIdle()
    }
    @Test fun allProjectsCanBeEditedInBatchesAndSearchNeverDropsHiddenRulesBeforeConfirmation() {
        val f = AccessUiFixture(); show(f)
        assertEquals(3, f.stored().getJSONObject("edit").getJSONObject("draft").getJSONArray("grants").length())
        click("access-more-projects"); val id = f.snapshot.getJSONArray("projects").getJSONObject(7).getString("id")
        click("access-role-$id"); click("access-role-$id-commenter")
        compose.onNodeWithTag("access-search").performScrollTo().performTextReplacement("Контроль")
        click("access-review"); compose.onNodeWithTag("access-change-count").assertExists(); assertEquals(0, f.sends)
        assertTrue(importRows(f.stored().getJSONObject("edit").getJSONObject("draft").getJSONArray("grants")).any { it.getString("projectId") == id && it.getString("role") == "commenter" })
        click("access-apply"); compose.waitUntil(10000) { notices == 1 }; assertEquals(1, f.sends)
        compose.onNodeWithTag("access-saved").assertExists()
    }
    @Test fun lastOwnerBlockerDisablesApplyAndKeepsTheChosenRules() {
        val f = AccessUiFixture().apply { blocked = true }; show(f); click("access-review")
        compose.onNodeWithTag("access-last-owner").assertExists(); compose.onNodeWithTag("access-apply").assertIsNotEnabled()
        assertEquals(0, f.sends); assertEquals(3, f.stored().getJSONObject("edit").getJSONObject("draft").getJSONArray("grants").length())
    }
    @Test fun anUnknownResultHasNoDiscardAndManualRetryReplaysTheSameBody() {
        val f = AccessUiFixture().apply { lose = true }; show(f); click("access-review"); click("access-apply")
        compose.waitUntil(10000) { compose.onAllNodesWithTag("access-error").fetchSemanticsNodes().isNotEmpty() }
        assertEquals("pending", f.stored().getString("phase")); compose.onNodeWithTag("access-discard").assertDoesNotExist()
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("access-retry").assertIsEnabled() }.isSuccess }
        click("access-retry"); compose.waitUntil(10000) { notices == 1 }
        assertEquals(2, f.sends); assertEquals(f.bodies[0], f.bodies[1]); assertEquals(1, f.receipts.size)
    }
    @Test fun revokedOwnerAccessPurgesProjectNamesAndCancelsTheWrite() {
        val f = AccessUiFixture(); show(f); click("access-review"); compose.runOnIdle { f.revoked = true }; click("access-apply")
        compose.waitUntil(10000) { closed }; compose.onNodeWithTag("access-change-count").assertDoesNotExist()
        compose.onNodeWithText("Проверка проектного доступа").assertDoesNotExist(); assertEquals(0, f.sends)
    }
    @Test fun switchingTargetAndSystemBackPreserveTheSelectedMembersDraft() {
        val f = AccessUiFixture(); show(f)
        val owner = importRows(f.members.getJSONArray("members")).first { it.getString("role") == "owner" }.getString("userId")
        click("access-member"); click("access-member-$owner")
        compose.waitUntil(10000) { compose.onAllNodesWithText("Ограничения по проектам доступны для участников и гостей.").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("access-review").assertDoesNotExist()
        click("access-member"); click("access-member-${f.user}")
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("access-review").assertIsEnabled() }.isSuccess }
        assertEquals(3, f.stored().getJSONObject("edit").getJSONObject("draft").getJSONArray("grants").length())
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack(); compose.waitForIdle(); assertTrue(closed)
    }
    @Test fun aCompetingSavedCopyIsVisibleAfterReopeningAndCanBeChosenExplicitly() {
        val f = AccessUiFixture(); show(f); f.peerSave(); click("access-all-projects")
        compose.waitUntil(10000) { f.storedCopies().size == 1 }; show(f, editing = false); click("access-copy-list")
        val id = f.storedCopies().single().getString("id"); click("access-use-$id")
        compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("access-review").assertIsEnabled() }.isSuccess }
        assertTrue(f.stored().getJSONObject("edit").getJSONObject("draft").getBoolean("allProjects")); assertEquals(2, f.storedCopies().size)
    }
    @Test fun captureProjectAccess() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisAccessCapture") == "true")
        val all = args.getString("genesisAccessLanguages") == "true"
        val languages = if (all) listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja") else listOf("ru")
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()); val rotate = args.getString("genesisAccessRotateLeft") == "true"
        if (rotate) device.setOrientationLeft()
        fun capture(name: String) {
            compose.waitForIdle(); val actual = requireNotNull(density)
            val width = compose.onNodeWithTag("access-test-window").fetchSemanticsNode().boundsInRoot.width / actual.density
            assertEquals(args.getString("genesisAccessWidth")!!.toFloat(), width, 1f)
            assertEquals(args.getString("genesisAccessFontScale")!!.toFloat(), actual.fontScale, .01f)
            val phase = args.getString("genesisAccessPhase") ?: "initial"
            val file = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "access-$phase-${args.getString("genesisAccessWidth")}-${actual.fontScale}-${if (dark) "dark" else "light"}-$language-$name.png")
            assertTrue(device.takeScreenshot(file)); println("QA access width=$width font=${actual.fontScale} locale=$language pane=$name")
        }
        try {
            for (locale in languages) for (night in listOf(false, true)) {
                compose.runOnIdle { language = locale; dark = night }
                var f = AccessUiFixture(); show(f); capture("rules")
                if (!all) {
                    compose.onNodeWithTag("access-search").performScrollTo().performTextReplacement("Контроль"); capture("search")
                    click("access-review"); capture("preview")
                    f = AccessUiFixture().apply { blocked = true }; show(f); click("access-review"); capture("blocked")
                    f = AccessUiFixture().apply { lose = true }; show(f); click("access-review"); click("access-apply")
                    compose.waitUntil(10000) { compose.onAllNodesWithTag("access-error").fetchSemanticsNodes().isNotEmpty() }; capture("pending")
                    f = AccessUiFixture(); show(f); compose.runOnIdle { f.offline = true }; click("access-refresh")
                    compose.waitUntil(10000) { compose.onAllNodesWithTag("access-directory-error").fetchSemanticsNodes().isNotEmpty() }; capture("offline")
                    f = AccessUiFixture(); show(f); f.peerSave(); click("access-all-projects")
                    compose.waitUntil(10000) { f.storedCopies().size == 1 }; capture("conflict")
                    show(f, editing = false); click("access-copy-list"); capture("versions")
                }
            }
        } finally { if (rotate) device.setOrientationNatural() }
    }
}
