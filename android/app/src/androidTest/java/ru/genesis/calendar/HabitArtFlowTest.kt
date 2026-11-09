package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import androidx.test.uiautomator.UiDevice
import ru.genesis.calendar.data.HabitsRepository

class HabitArtFlowTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun originalRanksAchievementsAndRewardsHaveNativeSlots() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val habits = HabitsRepository(app)
        val originalSettings = runBlocking { habits.workspace.first().settings }
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        val originals = app.assets.list("originals/achievement-art").orEmpty()
            .filter { it.endsWith(".webp") }
        assertEquals(18, originals.size)
        originals.forEach { filename -> app.assets.open("originals/achievement-art/$filename").use {
            assertTrue(it.read() >= 0)
        } }
        listOf("habit-reward-art/hestia-spark.png", "habit-reward-art/comeback.png",
            "hero-path/256/01_tantal.webp", "hero-path/256/16_risen_from_the_abyss.webp").forEach { path ->
            app.assets.open("originals/$path").use { assertTrue(it.read() >= 0) }
        }
        try {
            val deterministicSettings = originalSettings.copy(enabled = true,
                feedback = originalSettings.feedback.copy(questsEnabled = true, gamificationWidgets = true))
            if (deterministicSettings != originalSettings) runBlocking {
                habits.updateSettings(deterministicSettings)
            }
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("navigation-Привычки").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("navigation-Привычки").performClick()
            compose.onNodeWithTag("habit-workspace-menu").performClick()
            compose.onNodeWithTag("habit-open-development").performClick()
            compose.onNodeWithTag("habit-hero-path-toggle").assertDoesNotExist()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("achievement-gallery").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("achievement-gallery").assertExists()
            compose.onNodeWithTag("habit-quest-panel", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null), "habits-quests-after.png")))
            compose.onNodeWithTag("all-achievements").performScrollTo().performClick()
            compose.onNodeWithTag("achievement-first-step").assertExists()
            compose.onNodeWithTag("achievement-consistency").assertExists()
            compose.onNodeWithTag("achievement-first-step").performScrollTo().assertIsDisplayed()
            val image = File(app.getExternalFilesDir(null), "habits-achievements-after.png")
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(image))
            compose.onNodeWithText("Все ранги").performScrollTo().performClick()
            compose.onNodeWithTag("hero-rank-path").assertExists()
            compose.onNodeWithTag("hero-rank-tree", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("hero-tree-rank-tantalus").performScrollTo().assertIsDisplayed()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null), "hero-rank-tree-after.png")))
            compose.onNodeWithTag("hero-tree-rank-tantalus").performClick()
            compose.onNodeWithText("Ступень 1 · Тантал").assertExists()
            compose.onNodeWithText("Закрыть").performClick()
            compose.onNodeWithTag("amphora-icarus", useUnmergedTree = true).assertExists()
            compose.onNodeWithTag("streak-reward-ladder", useUnmergedTree = true).assertExists()
            compose.onNodeWithText("Все рубежи").performScrollTo().performClick()
            compose.onAllNodesWithText("Первая нить", substring = true).onLast().assertExists()
            compose.onNodeWithTag("streak-reward-ladder", useUnmergedTree = true).performScrollTo()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null), "habits-streak-rewards-after.png")))
            compose.onNodeWithTag("hestia-spark-card", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("comeback-card", useUnmergedTree = true).performScrollTo().assertIsDisplayed()
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
                File(app.getExternalFilesDir(null), "habits-resilience-after.png")))
        } finally {
            if (runBlocking { habits.workspace.first().settings } != originalSettings) {
                runBlocking { habits.updateSettings(originalSettings) }
            }
        }
    }
}
