package ru.genesis.calendar.ui

import android.os.Build
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.AdminGateway
import ru.genesis.calendar.auth.AdminProtocol
import ru.genesis.calendar.data.AdminDraftRepository
import java.io.IOException
import java.util.UUID

/** All mutations use an in-process fake. No administrative endpoint is contacted. */
class NativeAdminParityTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val token = UUID.randomUUID().toString()
    private val uid = "admin-test-$token"
    private var active = false
    private var sent = 0
    private var deleted = 0
    private val gateway = object : AdminGateway {
        override fun check() = Unit
        override suspend fun ads() = JSONObject().put("ads", JSONArray())
        override suspend fun saveAd(id: String?, body: JSONObject): JSONObject { sent++; throw IOException("synthetic lost response") }
        override suspend fun deleteAd(id: String) = error("No ad deletion in this fixture")
        override suspend fun subscription(userId: String, plan: String, expectedPlan: String) =
            JSONObject().put("userId", userId).put("subscriptionPlan", plan)
    }
    @Before fun guard() = runBlocking {
        assumeTrue(BuildConfig.DEBUG && (Build.HARDWARE == "ranchu" || Build.HARDWARE == "goldfish"))
        assumeTrue(app.workspaceScope == "internal-validation-v1")
        assumeTrue(app.database.dao().document(app.workspaceScope, "admin-ad-draft-v1") == null)
        active = true
    }
    @After fun cleanup() = runBlocking {
        if (!active || app.workspaceScope != "internal-validation-v1") return@runBlocking
        val own = AdminDraftRepository(app, uid, gateway).load()
        if (own?.optString("draftId") == token) app.database.dao().deleteDocument(app.workspaceScope, "admin-ad-draft-v1")
    }
    @Composable private fun Theme(content: @Composable () -> Unit) {
        CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalGenesisUserId provides uid, LocalEveningTheme provides false) {
            MaterialTheme(colorScheme = standart, typography = GenesisTypography, shapes = GenesisShapes) { Surface(Modifier.fillMaxSize(), content = content) }
        }
    }
    @Test fun lostCreateReplyStaysEncryptedAndIsNeverReplayedWhenEditorReopens() {
        val png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7WQAAAAASUVORK5CYII="
        val form = AdminProtocol.emptyForm().put("title", "Синтетический черновик").put("description", "Проверка неопределённого ответа")
            .put("imageData", png).put("linkUrl", "https://example.test/ad")
        runBlocking { AdminDraftRepository(app, uid, gateway).save(JSONObject().put("schemaVersion", 1).put("draftId", token).put("generation", 1)
            .put("form", form).put("editingId", "").put("baseline", "").put("zoneId", "Europe/Moscow").put("sentBody", JSONObject.NULL)) }
        var visible by mutableStateOf(true)
        compose.setContent { Theme { if (visible) AdminAdsScreen(gateway) {} } }
        compose.waitUntil(15000) { compose.onAllNodes(hasTestTag("admin-ad-save") and isEnabled()).fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("admin-ad-save").assertIsEnabled().performClick()
        compose.onNodeWithTag("admin-ad-confirm-save").performClick()
        compose.waitUntil(15000) { sent == 1 && compose.onAllNodesWithTag("admin-ad-reconcile").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("admin-ad-save").assertIsNotEnabled()
        runBlocking {
            val state = AdminDraftRepository(app, uid, gateway).load()!!
            assertEquals(token, state.getJSONObject("sentBody").getString("draftId"))
            assertFalse(app.database.dao().document(app.workspaceScope, "admin-ad-draft-v1")!!.encrypted.contains("Синтетический"))
        }
        compose.runOnIdle { visible = false }; compose.waitForIdle(); compose.runOnIdle { visible = true }
        compose.waitUntil(15000) { compose.onAllNodesWithTag("admin-ad-reconcile").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("admin-ad-save").assertIsNotEnabled()
        compose.onNodeWithTag("admin-ad-reconcile").performScrollTo().performClick()
        compose.waitForIdle(); assertEquals(1, sent)
    }
    @Test fun deletingUserRequiresEmailAndProtectedAdminHasNoDeleteAction() {
        val user = JSONObject().put("id", "user-test").put("email", "user@example.test").put("displayName", "Тестовый пользователь")
            .put("isAdmin", false).put("subscriptionPlan", "free")
        val admin = JSONObject().put("id", "protected-admin").put("email", "admin@example.test").put("displayName", "Администратор")
            .put("isAdmin", true).put("subscriptionPlan", "free")
        fun data() = JSONObject().put("users", JSONArray().apply { if (deleted == 0) put(user); put(admin) })
        compose.setContent { Theme { NativeAdminPanel({}, { data() }, { _, _ -> deleted++; JSONObject() }, gateway) } }
        compose.waitUntil(15000) { compose.onAllNodesWithText("Удалить пользователя").fetchSemanticsNodes().isNotEmpty() }
        assertEquals(1, compose.onAllNodesWithText("Удалить пользователя").fetchSemanticsNodes().size)
        compose.onNodeWithText("Удалить пользователя").performScrollTo().performClick()
        compose.onNodeWithTag("admin-delete-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("admin-delete-email").performTextInput("other@example.test")
        compose.onNodeWithTag("admin-delete-confirm").assertIsNotEnabled()
        compose.onNodeWithTag("admin-delete-email").performTextReplacement("USER@example.test")
        compose.onNodeWithTag("admin-delete-confirm").assertIsEnabled().performClick()
        compose.waitUntil(15000) { deleted == 1 }
        assertEquals(1, deleted)
    }
}
