package ru.genesis.calendar

import androidx.compose.ui.graphics.toPixelMap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.ui.AppearanceSettings

/** Exercises the full workspace shell, independently of isolated screen screenshot hosts. */
class BrandHeaderFooterTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun identityStaysAboveNavigationAndAccountStatusStaysBelowContent() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        val habits = HabitsRepository(app)
        val originalAppearance = AppearanceSettings.read(runBlocking { habits.workspace.first().settings.rawJson }).json()
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        try {
            for (dark in listOf(false, true)) for (labels in listOf("icons", "text")) {
                runBlocking {
                    habits.updateAppearance(AppearanceSettings(mode = if (dark) "evening" else "light").json())
                    preferences.set("navigationLabels", labels)
                    preferences.set("language", "ru")
                }
                compose.waitUntil(10_000) { compose.onAllNodesWithTag(if (dark) "app-theme-Evening" else "app-theme-Standart").fetchSemanticsNodes().isNotEmpty() }
                for (page in listOf("Сегодня", "Проекты", "Календарь", "Привычки", "Настройки")) {
                    val nav = compose.onNodeWithTag("navigation-$page")
                    if (!nav.isDisplayed()) nav.performScrollTo()
                    nav.performClick()
                    compose.waitForIdle()
                    val header = compose.onNodeWithTag("app-header").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
                    val brand = compose.onNodeWithTag("genesis-brand-name").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
                    val content = compose.onNodeWithTag("main-content").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
                    val footer = compose.onNodeWithTag("app-account-status").assertIsDisplayed().fetchSemanticsNode().boundsInRoot
                    assertTrue("Brand must stay inside the header", brand.top >= header.top && brand.bottom <= header.bottom)
                    assertTrue("Header overlaps content", header.bottom <= content.top)
                    assertTrue("Account status belongs at the bottom", footer.top >= content.bottom)
                    val pixels = compose.onNodeWithTag("genesis-round-logo").captureToImage().toPixelMap()
                    var gold = 0
                    for (y in 0 until pixels.height step 2) for (x in 0 until pixels.width step 2) {
                        val color = pixels[x, y]
                        if (color.red > .5f && color.green > .28f && color.blue < .5f) gold++
                    }
                    assertTrue("The original golden symbol must be rendered, rather than an empty circle", gold > 20)
                }
                assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),
                    "ui290-brand-${if (dark) "dark" else "light"}-$labels.png")))
            }
        } finally {
            runBlocking {
                habits.updateAppearance(originalAppearance)
                preferences.set("navigationLabels", if (original.navigationLabels) "text" else "icons")
                preferences.set("language", original.language)
            }
        }
    }
}
