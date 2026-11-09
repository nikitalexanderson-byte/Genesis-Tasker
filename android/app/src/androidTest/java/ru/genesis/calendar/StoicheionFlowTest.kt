package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.data.StoicheionDrawRepository
import ru.genesis.calendar.domain.StoicheionReading
import ru.genesis.calendar.domain.TheokyklosCatalogSource

class StoicheionFlowTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private fun openOracle() {
        compose.waitUntil(15_000) {
            compose.onAllNodesWithTag("workspace-menu").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithTag("navigation-Сакральное").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithTag("navigation-Сакральное").fetchSemanticsNodes().isNotEmpty())
            compose.onNodeWithTag("navigation-Сакральное").performClick()
        else {
            compose.onNodeWithTag("workspace-menu").performClick()
            compose.onNodeWithTag("drawer-Сакральное-root").performScrollTo().performClick()
        }
    }

    @Test fun allAuthoredLettersAndArtAreAvailableOffline() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val letters = JSONArray(app.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
        val art = JSONObject(app.assets.open("stoicheion-art.json").bufferedReader().use { it.readText() })
        assertEquals(24, letters.length())
        assertEquals(24, art.length())
        for (index in 0 until letters.length()) {
            val letter = letters.getJSONObject(index)
            assertTrue(letter.getString("content").length > 200)
            assertTrue(art.getJSONObject(letter.getString("id")).getString("invocation").isNotBlank())
            app.assets.open("originals/stoicheion-cards/${letter.getString("id")}.webp").use {
                assertTrue(it.read() >= 0)
            }
        }
        openOracle()
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("stoicheion-catalog-block", useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("stoicheion-letter-alpha"))
        compose.onNodeWithTag("stoicheion-face-alpha", useUnmergedTree = true).assertExists()
        val screenshot = File(app.getExternalFilesDir(null), "stoicheion-cards-after.png")
        assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(screenshot))
        compose.onNodeWithTag("stoicheion-letter-alpha").performClick()
        compose.onAllNodesWithText("ГОЛОВА").onLast().assertExists()
        compose.onNodeWithText("Метафизика изначального истока").assertExists()
        compose.onNodeWithContentDescription("Закрыть").performClick()
    }

    @Test fun dailyAndNineCardDrawsPersistLocallyAndRespectVisibilitySetting() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val preferences = LocalPreferences(app, app.workspaceScope)
        val originalDisabled = runBlocking { preferences.values.first().divinationDisabled }
        val repository = StoicheionDrawRepository(app)
        try {
            runBlocking { preferences.set("stoicheionDivinationDisabled", "false") }
            openOracle()
            if (runBlocking { repository.today.first().daily } == null) {
                compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                    .performScrollToNode(hasTestTag("stoicheion-draw-daily"))
                compose.onNodeWithTag("stoicheion-draw-daily").performClick()
                compose.onNodeWithTag("stoicheion-accessible-draw").performClick()
                compose.waitUntil(10_000) { runBlocking { repository.today.first().daily != null } }
            }
            compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                .performScrollToNode(hasTestTag("stoicheion-daily-result"))
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("stoicheion-daily-result").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("stoicheion-daily-result").assertExists()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "stoicheion-daily-after.png")))
            if (runBlocking { repository.today.first().spread } == null) {
                compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                    .performScrollToNode(hasTestTag("stoicheion-draw-spread"))
                compose.onNodeWithTag("stoicheion-draw-spread").performClick()
                compose.onNodeWithTag("stoicheion-accessible-draw").performClick()
                compose.waitUntil(10_000) { runBlocking { repository.today.first().spread != null } }
            }
            compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                .performScrollToNode(hasTestTag("stoicheion-spread-center"))
            compose.onNodeWithTag("stoicheion-spread-center").assertExists()
            compose.onNodeWithTag("stoicheion-isopsephy").assertExists()
            compose.onNodeWithTag("stoicheion-spread-center").performClick()
            compose.onNodeWithText("Центр · сектор расклада").assertExists()
            val centerGuidance = TheokyklosCatalogSource.load(app).guidanceById.getValue("center")
            val centerReversed = StoicheionReading.reversed(
                runBlocking { repository.today.first().spread!! }.seed, 5)
            compose.onNodeWithText((if (centerReversed) centerGuidance.reversed else centerGuidance.upright).ru)
                .assertExists()
            compose.onNodeWithContentDescription("Закрыть").performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithContentDescription("Закрыть").fetchSemanticsNodes().isEmpty()
            }
            val draws = runBlocking { repository.today.first() }
            assertTrue((draws.daily?.attempts ?: 0) in 1..2)
            assertTrue((draws.spread?.attempts ?: 0) in 1..2)
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "stoicheion-nine-after.png")))
            compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                .performScrollToNode(hasTestTag("stoicheion-isopsephy"))
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "stoicheion-isopsephy-after.png")))
            compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                .performScrollToNode(hasTestTag("stoicheion-restoration-begin"))
            compose.onNodeWithTag("stoicheion-restoration-begin").assertIsEnabled()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "stoicheion-restoration-entry-after.png")))
            runBlocking { preferences.set("stoicheionDivinationDisabled", "true") }
            compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true).performScrollToIndex(0)
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Гадания по картам выключены").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                .performScrollToNode(hasTestTag("stoicheion-letter-alpha"))
            compose.onNodeWithTag("stoicheion-letter-alpha").assertExists()
            runBlocking { preferences.set("stoicheionDivinationDisabled", "false") }
            compose.onNodeWithTag("stoicheion-grid", useUnmergedTree = true)
                .performScrollToNode(hasTestTag("stoicheion-spread-center"))
            compose.onNodeWithTag("stoicheion-spread-center").performClick()
            compose.onNodeWithText("Открыть сектор Теокиклоса →").performScrollTo().performClick()
            compose.waitForIdle()
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).waitForIdle()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "stoicheion-theokyklos-link-after.png")))
            compose.waitUntil(10_000) {
                compose.onAllNodesWithText("Заклинания Божеств").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Заклинания Божеств").assertExists()
            compose.onAllNodesWithText("Дионис и Ариадна").onLast().assertExists()
        } finally {
            runBlocking { preferences.set("stoicheionDivinationDisabled", originalDisabled.toString()) }
        }
    }
}
