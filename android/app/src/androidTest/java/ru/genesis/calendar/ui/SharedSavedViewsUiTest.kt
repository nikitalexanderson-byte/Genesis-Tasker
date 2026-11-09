package ru.genesis.calendar.ui

import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.StateRestorationTester
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.auth.*
import ru.genesis.calendar.data.UiPreferences
import java.io.File

class SharedSavedViewsUiTest {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val fixture = SavedViewHttpsFixture()
    private var language by mutableStateOf("ru")
    private var dark by mutableStateOf(false)
    private var epoch by mutableIntStateOf(0)
    private lateinit var saved: JSONObject
    @Before fun open() {
        fixture.open()
        val base = fixture.base
        val status = base.client.sharedProject(base.generation, base.project).getJSONArray("statuses").getJSONObject(0).getString("id")
        for (index in 1..3) base.client.createSharedTask(base.generation, base.project, JSONObject().put("title", "Проверить удобство на смартфоне • $index").put("statusId", status).put("priority", index))
        saved = fixture.save(fixture.edit("Моя подборка 🌿 • Следующий этап"))
    }
    @After fun close() = fixture.close()
    @Composable private fun Content() { key(epoch) {
        CompositionLocalProvider(LocalGenesisLanguage provides language, LocalEveningTheme provides dark, LocalGenesisUserId provides fixture.base.actor) {
            MaterialTheme(colorScheme = if (dark) evening else standart) { Surface(Modifier.fillMaxSize()) {
                SharedSavedViewsScreen(fixture.gateway, listOf(JSONObject().put("id", fixture.base.space).put("title", "Моя команда 🌿").put("role", "owner")), UiPreferences(), {}, { _, _ -> })
            } }
        }
    } }
    private fun await(tag: String) {
        try {
            compose.waitUntil(30_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("saved-view-progress").fetchSemanticsNodes().isEmpty() }
        } catch (failure: Exception) {
            val record = runCatching { fixture.service().load() }.getOrNull()
            val errors = compose.onAllNodesWithTag("saved-view-error").fetchSemanticsNodes().map { it.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Text).toString() }
            throw AssertionError("Await $tag; phase=${record?.optString("phase")}; library=${fixture.readFailure}; UI=$errors", failure)
        }
        compose.waitForIdle()
    }
    private fun click(tag: String, scroll: Boolean = true) {
        if (scroll) compose.onNodeWithTag(tag).performScrollTo()
        compose.onNodeWithTag(tag).performClick()
    }
    private fun select() { await("saved-view-open-${saved.getString("id")}"); click("saved-view-open-${saved.getString("id")}"); await("saved-view-count") }
    @Test fun selectEditConfirmAndLostReplySurviveRecreationWithoutASecondView() {
        val restoration = StateRestorationTester(compose)
        restoration.setContent { Content() }; select()
        compose.onNodeWithTag("saved-view-count").assertTextEquals("Показано: 3 из 3")
        click("saved-view-conditions"); await("saved-view-name")
        compose.onNodeWithTag("saved-view-name").performScrollTo().performTextReplacement("Мой сохранённый ввод 🌿")
        click("saved-view-save"); await("saved-view-send")
        assertEquals(0, fixture.service().load()!!.getInt("attempts"))
        fixture.loseReply = true; click("saved-view-send")
        compose.waitUntil(30_000) { fixture.service().load()?.optInt("attempts") == 1 }
        await("saved-view-error")
        val pending = fixture.service().load()!!.getString("command")
        restoration.emulateSavedInstanceStateRestore(); await("saved-view-send")
        assertEquals(pending, fixture.service().load()!!.getString("command")); click("saved-view-send"); await("saved-view-finish")
        assertEquals(fixture.commands[fixture.commands.size - 2], fixture.commands.last())
        click("saved-view-finish"); await("saved-view-name")
        assertEquals("Мой сохранённый ввод 🌿", fixture.base.client.sharedSavedView(fixture.base.generation, saved.getString("id")).getJSONObject("definition").getString("title"))
        assertEquals(2, fixture.base.client.sharedSavedView(fixture.base.generation, saved.getString("id")).getInt("revision"))
    }
    @Test fun preparedCreateCanReturnToEditingAndAnInvalidZoneNeverAppliesAnEmptyFilter() {
        compose.setContent { Content() }; await("saved-view-new"); click("saved-view-new", false); await("saved-view-name")
        compose.onNodeWithTag("saved-view-name").performScrollTo().performTextReplacement("B5 Android новое")
        click("saved-view-save"); await("saved-view-send")
        compose.onNode(hasText("Вернуться к редактированию") and hasClickAction()).performScrollTo().performClick(); await("saved-view-name")
        assertEquals("editing", fixture.service().load()!!.getString("phase"))
        click("saved-view-period"); await("saved-view-zone")
        compose.onNodeWithTag("saved-view-zone").performScrollTo().performTextReplacement("Broken zone")
        click("saved-view-apply"); await("saved-view-error")
        compose.onNodeWithTag("saved-view-count").assertDoesNotExist()
        compose.onNodeWithTag("saved-view-zone").assertTextContains("Broken zone")
    }
    @Test fun customDateInputCalendarPersistsWithoutChangingTheViewsRelativeCalendar() {
        val base = fixture.base; val id = java.util.UUID.randomUUID().toString()
        val field = JSONObject().put("id", id).put("title", "Дата согласования 🌿").put("type", "date").put("projectId", base.project)
            .put("options", org.json.JSONArray()).put("position", 0).put("required", false).put("showCard", true).put("showList", true).put("archived", false).put("expectedRevision", 0)
        val review = base.client.previewSharedFieldDefinition(base.generation, base.space, base.project, field)
        base.client.saveSharedFieldDefinition(base.generation, base.space, field.put("fingerprint", review.getString("fingerprint")).put("operationId", java.util.UUID.randomUUID().toString()).put("replaceType", false))
        val restoration = StateRestorationTester(compose); restoration.setContent { Content() }; select(); click("saved-view-conditions")
        await("field-filter-block"); click("field-filter-block"); await("field-filter-choice"); click("field-filter-choice")
        click("field-filter-choice-$id", false); await("shared-custom-$id-calendar"); click("shared-custom-$id-calendar")
        // The chip lives in a horizontal scroller. Its performScrollTo only handles
        // that nearest ancestor, so position it in the vertical viewport separately.
        compose.onNodeWithTag("shared-custom-$id-mode-sacred").performScrollTo()
        val chip = compose.onNodeWithTag("shared-custom-$id-mode-sacred").fetchSemanticsNode()
        val viewport = compose.onNodeWithTag("saved-view-detail-scroll").fetchSemanticsNode().boundsInRoot
        compose.onNodeWithTag("saved-view-detail-scroll").performSemanticsAction(androidx.compose.ui.semantics.SemanticsActions.ScrollBy) {
            it(0f, chip.positionInRoot.y + chip.size.height / 2f - viewport.center.y)
        }
        compose.onNodeWithTag("shared-custom-$id-mode-sacred").assertIsDisplayed()
        compose.onNodeWithTag("shared-custom-$id-mode-sacred").assertIsEnabled()
        click("shared-custom-$id-mode-sacred", false)
        try { compose.waitUntil(30_000) { fixture.service().load()?.getJSONObject("edit")?.optJSONObject("inputCalendar")?.optString("mode") == "sacred" } }
        catch (failure: Throwable) {
            val record = fixture.service().load()
            val selected = compose.onAllNodesWithTag("shared-custom-$id-mode-sacred").fetchSemanticsNodes().map { it.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Selected) }
            val errors = compose.onAllNodesWithTag("saved-view-error").fetchSemanticsNodes().map { it.config.getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Text).toString() }
            throw AssertionError("Input calendar: stored=${record?.getJSONObject("edit")?.optJSONObject("inputCalendar")}; selected=$selected; errors=$errors", failure)
        }
        compose.onNodeWithTag("shared-custom-$id-mode-sacred").assertIsSelected()
        val before = fixture.service().load()!!.getJSONObject("edit")
        assertEquals("lunar", before.getJSONObject("definition").getString("calendarMode"))
        assertEquals("Europe/Moscow", before.getJSONObject("definition").getJSONObject("calendarContext").getString("timeZone"))
        restoration.emulateSavedInstanceStateRestore(); await("saved-view-name")
        val after = fixture.service().load()!!.getJSONObject("edit")
        assertEquals("sacred", after.getJSONObject("inputCalendar").getString("mode")); assertEquals("lunar", after.getJSONObject("definition").getString("calendarMode"))
    }
    @Test fun workspaceMenuOpensSavedViewsAndReturnsToTheOriginalTaskCard() {
        val base = fixture.base
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalGenesisUserId provides base.actor) {
            MaterialTheme(colorScheme = standart) { Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                SharedProjectsScreen(fixture.gateway, "ru", SharedInvitationDestination(base.space, base.project))
            } }
        } }
        await("shared-work-actions"); click("shared-work-actions", false); await("shared-saved-views-open"); click("shared-saved-views-open", false)
        select()
        val id = fixture.query(JSONObject().put("savedViewId", saved.getString("id"))).getJSONArray("tasks").getJSONObject(0).getString("id")
        click("saved-view-task-$id"); await("shared-task-title-input")
        compose.onNodeWithTag("shared-task-title-input").assertTextContains("Проверить удобство на смартфоне", substring = true)
        compose.onNodeWithTag("saved-views-screen").assertDoesNotExist()
    }
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val bytes = ParcelFileDescriptor.AutoCloseInputStream(InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand("screencap -p")).use { it.readBytes() }
        val bitmap = requireNotNull(android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size))
        try {
            val root = compose.onNodeWithTag("saved-views-screen").fetchSemanticsNode().boundsInWindow
            val close = compose.onNodeWithTag("saved-views-close").fetchSemanticsNode().boundsInWindow
            val metrics = compose.activity.resources.displayMetrics; val density = metrics.density
            assertTrue(root.left >= 0 && root.top >= 0 && root.right <= metrics.widthPixels + 1 && root.bottom <= metrics.heightPixels + 1)
            assertTrue(close.width >= 48 * density - 1 && close.height >= 48 * density - 1 && close.left >= root.left && close.right <= root.right)
            File(fixture.base.app.filesDir, "views-$name.png").writeBytes(bytes)
            File(fixture.base.app.filesDir, "views-$name.metrics.json").writeText(JSONObject().put("width", bitmap.width).put("height", bitmap.height)
                .put("density", density.toDouble()).put("root", root.toString()).put("close", close.toString()).put("fontScale", compose.activity.resources.configuration.fontScale.toDouble())
                .put("screenWidthDp", compose.activity.resources.configuration.screenWidthDp).put("capture", "screencap-physical-display").toString())
        } finally { bitmap.recycle() }
    }
    @Test fun captureSavedViews() {
        val args = InstrumentationRegistry.getArguments(); assumeTrue(args.getString("genesisSavedViewsCapture") == "true")
        val width = args.getString("genesisFieldWidth") ?: "390"
        val conditionsOnly = args.getString("genesisSavedViewsConditionsOnly") == "true"
        val languages = if (args.getString("genesisFieldLanguages") == "true") SharedTemplateProtocol.languages else setOf("ru")
        compose.setContent { Content() }
        for (locale in languages) for (night in listOf(false, true)) {
            fixture.service().load()?.let { fixture.service().remove(it.getString("stamp")) }
            compose.runOnIdle { language = locale; dark = night; epoch++ }; await("saved-view-new")
            val name = "$width-$locale-${if (night) "dark" else "light"}"
            if (!conditionsOnly) screenshot("$name-library")
            select(); if (!conditionsOnly) screenshot("$name-results")
            click("saved-view-conditions"); await("saved-view-name")
            if (locale != "ru") {
                compose.onAllNodesWithText("Пространство", useUnmergedTree = true).assertCountEquals(0)
                compose.onAllNodesWithText("Сортировка", useUnmergedTree = true).assertCountEquals(0)
            }
            screenshot("$name-conditions")
        }
    }
}
