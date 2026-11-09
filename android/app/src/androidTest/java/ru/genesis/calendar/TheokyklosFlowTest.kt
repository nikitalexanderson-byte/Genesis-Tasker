package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import kotlin.math.abs
import org.junit.Assert.assertTrue
import org.junit.Assert.assertEquals
import org.json.JSONObject
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.domain.TheokyklosCatalogSource

class TheokyklosFlowTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun everyLanguageHasBundledTheokyklosStoicheionAndYearCopy() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val languages = listOf("en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")
        languages.forEach { language ->
            val catalog = TheokyklosCatalogSource.load(app, language)
            assertEquals(language, 14, catalog.sectors.size)
            assertTrue(language, catalog.sectors.all { it.title.ru.isNotBlank() && it.description.ru.isNotBlank() })
            val letterCopy = JSONObject(app.assets.open("originals/i18n/catalog-translations/$language.json")
                .bufferedReader().use { it.readText() }).getJSONObject("stoicheion")
            assertEquals(language, 24, letterCopy.length())
            val yearCopy = JSONObject(app.assets.open("originals/i18n/year-translations/$language.json")
                .bufferedReader().use { it.readText() })
            assertTrue(language, yearCopy.length() >= 46)
        }
    }

    @Test fun allFourAxisAndThresholdMarkersOpenNativeDetails() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        compose.onNodeWithTag("navigation-Сакральное").performClick()
        compose.onNodeWithTag("submenu-theokyklos").performClick()
        compose.onNodeWithTag("theokyklos-mandala").assertIsDisplayed()
        val entranceCenter = compose.onNodeWithTag("theokyklos-sector-entrance")
            .fetchSemanticsNode().boundsInRoot.center
        val exitCenter = compose.onNodeWithTag("theokyklos-sector-exit")
            .fetchSemanticsNode().boundsInRoot.center
        val mandalaCenter = compose.onNodeWithTag("theokyklos-sector-center")
            .fetchSemanticsNode().boundsInRoot.center
        assertTrue("Вход должен находиться рядом с восточным сектором", entranceCenter.x > mandalaCenter.x)
        assertTrue("Выход должен находиться рядом с западным сектором", exitCenter.x < mandalaCenter.x)
        TheokyklosCatalogSource.ids.forEach { id ->
            compose.onNodeWithTag("theokyklos-sector-$id").assertExists()
        }
        compose.onNodeWithText("Центр · Дионис и Ариадна →").assertDoesNotExist()
        compose.onNodeWithTag("theokyklos-card-center").assertExists()
        compose.onNodeWithTag("theokyklos-card-hearth").assertExists()
        for (direction in listOf("Север", "Северо-восток", "Восток", "Юго-восток",
            "Юг", "Юго-запад", "Запад", "Северо-запад")) {
            compose.onNodeWithText(direction).assertExists()
        }
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        compose.onAllNodes(hasTestTag("app-theme-Standart") or hasTestTag("app-theme-Evening")).onFirst().assertExists()
        compose.onNodeWithTag("theokyklos-mandala").assertIsDisplayed()
        device.waitForIdle()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "theokyklos-standart-mandala.png")))
        compose.onNodeWithTag("theokyklos-card-hearth").performScrollTo()
        val centerTop = compose.onNodeWithTag("theokyklos-card-center").fetchSemanticsNode().boundsInRoot.top
        val hearthTop = compose.onNodeWithTag("theokyklos-card-hearth").fetchSemanticsNode().boundsInRoot.top
        assertTrue("Центр и Очаг должны стоять в одном ряду", abs(centerTop - hearthTop) < 2f)
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "theokyklos-cards-after.png")))
        compose.onNodeWithTag("theokyklos-card-northwest").performScrollTo()
        assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "theokyklos-directions-after.png")))
        compose.onNodeWithTag("theokyklos-mandala").performScrollTo()
        for (id in listOf("zenith", "nadir", "entrance", "exit", "center", "hearth")) {
            compose.onNodeWithTag("theokyklos-sector-$id").performScrollTo().assertIsDisplayed()
            if (id == "hearth") compose.onNodeWithTag("theokyklos-sector-hearth")
                .performTouchInput { click(Offset(width / 2f, height * .16f)) }
            else compose.onNodeWithTag("theokyklos-sector-$id").performClick()
            val sector = TheokyklosCatalogSource.load(app).byId.getValue(id)
            compose.onNodeWithText(sector.title.ru).assertExists()
            compose.onNodeWithText("Заклинания Божеств").assertExists()
            if (id == "zenith") {
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithContentDescription("${sector.patrons.ru} — ${sector.title.ru}")
                        .fetchSemanticsNodes().isNotEmpty()
                }
                device.waitForIdle()
                Thread.sleep(600)
                assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null), "theokyklos-zenith-detail.png")))
            }
            compose.onNodeWithText("×").performClick()
        }
    }
}
