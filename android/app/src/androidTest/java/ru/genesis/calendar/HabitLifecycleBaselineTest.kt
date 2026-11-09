package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.Instant
import java.time.LocalDate
import kotlinx.coroutines.runBlocking
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

/** Opt-in visual reference of the incumbent full habits screen before lifecycle controls. */
class HabitLifecycleBaselineTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    @Test fun captureIncumbentHabitScreen() {
        val arguments = InstrumentationRegistry.getArguments()
        assumeTrue(arguments.getString("genesisHabitBaseline") == "true")
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        val width = arguments.getString("genesisWidth")?.toInt() ?: 390
        val dark = arguments.getString("genesisDark") == "true"
        val today = LocalDate.now(); val at = Instant.now().minusSeconds(60).toString()
        val original = runBlocking { app.database.dao().document(app.workspaceScope, "habits") }
        val cipher = LocalCipher()
        val habits = listOf("active", "paused", "archived", "deleted").map { status ->
            val habit = Habit(TrackerEntity.create("habit", id = "e4-baseline-$status"),
                "Сохранённая практика · $status", today.minusDays(60),
                HabitEngine(GenesisCalendar()).defaultSchedule(today.minusDays(60), CalendarMode.PROFANE))
            if (status == "active") habit else HabitLifecycle.apply(habit,
                HabitLifecycleCommand("e4-baseline-event-$status", habit.id, at,
                    mapOf("paused" to "pause", "archived" to "archive", "deleted" to "delete").getValue(status), emptyList()))
        }
        try {
            runBlocking { app.database.withTransaction {
                val workspace = LocalHabitWorkspace(habits = habits, revision = 1)
                app.database.dao().putDocument(DocumentRecord(app.workspaceScope, "habits",
                    cipher.encrypt(HabitDocument.encode(workspace), "${app.workspaceScope}/habits"), 1))
            } }
            compose.setContent {
                val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, 1f)
                CompositionLocalProvider(LocalDensity provides density, LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                    MaterialTheme(colorScheme = if (dark) evening else standart) {
                        Surface(Modifier.fillMaxSize().testTag("e4-baseline-root")) {
                            Column(Modifier.safeDrawingPadding()) { HabitsScreen(app, true) }
                        }
                    }
                }
            }
            compose.waitUntil(30_000) { compose.onAllNodesWithText(habits.first().title).fetchSemanticsNodes().isNotEmpty() }
            compose.onNodeWithText(habits.first().title).performScrollTo(); compose.waitForIdle()
            val name = "e4-before-$width-${if (dark) "dark" else "light"}"
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
                .takeScreenshot(File(app.getExternalFilesDir(null), "$name.png")))
            val root = compose.onNodeWithTag("e4-baseline-root").fetchSemanticsNode().boundsInRoot
            File(app.getExternalFilesDir(null), "$name.metrics.json").writeText(JSONObject()
                .put("screenWidthDp", width).put("fontScale", 1).put("dark", dark).put("root", root.toString())
                .put("capture", "screencap-physical-display").toString())
        } finally {
            runBlocking { app.database.withTransaction {
                if (original == null) app.database.dao().deleteDocument(app.workspaceScope, "habits")
                else app.database.dao().putDocument(original)
            } }
        }
    }
}
