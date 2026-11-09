package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.trackers.*
import java.io.File
import java.time.LocalDate

class TodayTrackers312Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val repo get() = TrackersRepository(app)
    private val today = LocalDate.now()
    private val args get() = InstrumentationRegistry.getArguments()
    private val width get() = args.getString("genesisWidth")?.toIntOrNull() ?: 390
    private val dark get() = args.getString("genesisDark") == "true"
    @Before fun seedOnlyDebugWorkspace() {
        check(BuildConfig.DEBUG && app.workspaceScope == "internal-validation-v1")
        runBlocking {
            repo.resetTracking()
            val schedule = dailySleepSchedule(today, CalendarMode.PROFANE)
            repo.savePlan(SleepPlan(TrackerEntity.create("plan", id="sleep312"), schedule, "План сна", qualityEnabled=true))
            repo.saveAddiction(AddictionTracker(TrackerEntity.create("tracker", id="abstinence312"), schedule, "Личная практика"))
        }
    }
    private fun content() {
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides (args.getString("genesisLanguage") ?: "ru"),
                LocalEveningTheme provides dark, LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat()/width,
                    args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f)) {
                MaterialTheme(colorScheme=if(dark)evening else standart,typography=GenesisTypography,shapes=GenesisShapes) {
                    Surface(Modifier.fillMaxSize()) { Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState())) {
                        TodayTrackersContent(app, today, UiPreferences(input=CalendarMode.PROFANE))
                    } }
                }
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("today-observations").fetchSemanticsNodes().isNotEmpty() }
    }
    private fun capture(name:String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null),"312-$width-${if(dark)"dark" else "light"}-$name.png"))
    }
    @Test fun actualTodayMoodSleepAndAbstinencePersistThroughTheirEditors() {
        content(); capture("today-trackers")
        compose.onNodeWithTag("today-mood-edit").performScrollTo().performClick()
        compose.onNodeWithTag("mood-editor-date").assertDoesNotExist()
        compose.onNodeWithTag("mood-value-2").performScrollTo().performClick()
        compose.onNodeWithTag("mood-entry-save").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("mood-entry-save").fetchSemanticsNodes().isEmpty() }
        assertEquals(today, runBlocking { repo.workspace.first().moodEntries.single().date })
        assertEquals(2, runBlocking { repo.workspace.first().moodEntries.single().moodValue })

        compose.onNodeWithTag("today-sleep-edit-sleep312").performScrollTo().performClick()
        compose.onNodeWithText("7", substring=false).performScrollTo().performClick()
        compose.onNodeWithTag("sleep-entry-save").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("sleep-entry-save").fetchSemanticsNodes().isEmpty() }
        assertEquals(7, runBlocking { repo.workspace.first().sleepEntries.single().quality })

        compose.onNodeWithTag("today-abstinence-edit-abstinence312").performScrollTo().performClick()
        compose.onNodeWithTag("abstinence-clean").performClick()
        compose.onNodeWithTag("abstinence-save").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("abstinence-save").fetchSemanticsNodes().isEmpty() }
        val clean = runBlocking { repo.workspace.first().addictionEntries.single() }
        assertTrue(clean.cleanDay); assertFalse(clean.relapse); assertEquals(today, clean.date)
        compose.onNodeWithTag("today-abstinence-edit-abstinence312").performScrollTo().performClick()
        compose.onNodeWithTag("abstinence-relapse").performClick(); capture("abstinence-editor")
        compose.onNodeWithTag("abstinence-save").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("abstinence-save").fetchSemanticsNodes().isEmpty() }
        val relapse = runBlocking { repo.workspace.first().addictionEntries.single() }
        assertEquals(clean.entity.id, relapse.entity.id)
        assertFalse(relapse.cleanDay); assertTrue(relapse.relapse); assertEquals(0, relapse.score)
        capture("today-trackers-saved")
    }
    @Test fun staleObservationCannotOverwriteSavedData() {
        runBlocking {
            repo.saveAbstinence("abstinence312", today, true, false, 3, "context", "first", 0)
            assertThrows(IllegalArgumentException::class.java) { runBlocking {
                repo.saveAbstinence("abstinence312", today, false, true, 8, "changed", "stale", 0)
            } }
            val saved = repo.workspace.first().addictionEntries.single()
            assertTrue(saved.cleanDay); assertEquals("first", saved.note); assertEquals(3, saved.cravingIntensity)
        }
    }

    @Test fun inlineTodayCravingAndOutcomePreserveTheEntryNotesAndIdentity() {
        runBlocking { repo.saveAbstinence("abstinence312", today, true, false, 3, "context", "original note", 0) }
        val initial = runBlocking { repo.workspace.first().addictionEntries.single() }
        content()
        compose.onNodeWithTag("today-mood-edit").assertHasClickAction().assertHeightIsAtLeast(48.dp)
        compose.onNodeWithTag("today-abstinence-craving-abstinence312").performScrollTo().performTouchInput {
            click(androidx.compose.ui.geometry.Offset(center.x * 1.6f, center.y))
        }
        compose.waitUntil(10_000) { runBlocking { repo.workspace.first().addictionEntries.single().cravingIntensity != 3 } }
        val measured = runBlocking { repo.workspace.first().addictionEntries.single() }
        assertEquals(initial.entity.id, measured.entity.id)
        assertEquals("context", measured.trigger); assertEquals("original note", measured.note)
        compose.onNodeWithTag("today-abstinence-relapse-abstinence312").performScrollTo().performClick()
        compose.waitUntil(10_000) { runBlocking { repo.workspace.first().addictionEntries.single().relapse } }
        val relapse = runBlocking { TrackersRepository(app).workspace.first().addictionEntries.single() }
        assertEquals(initial.entity.id, relapse.entity.id); assertFalse(relapse.cleanDay)
        assertEquals(measured.cravingIntensity, relapse.cravingIntensity)
        assertEquals("context", relapse.trigger); assertEquals("original note", relapse.note)
        capture("today-inline-trackers")
    }
}
