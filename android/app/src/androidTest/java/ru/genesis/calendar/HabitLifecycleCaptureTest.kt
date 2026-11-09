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
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

/** Same native phone/tablet renderer as the app, in a guarded synthetic workspace. */
class HabitLifecycleCaptureTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    @Test fun captureControlsArchiveAndConfirmation() {
        val args=InstrumentationRegistry.getArguments()
        assumeTrue(args.getString("genesisE4Capture")=="true")
        val app=compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope=="internal-validation-v1")
        val accountScope=app.workspaceScope
        val width=args.getString("genesisWidth")?.toInt() ?: 390
        val language=args.getString("genesisLanguage") ?: "ru"
        val font=args.getString("genesisFontScale")?.toFloat() ?: 1f
        val dark=args.getString("genesisDark")=="true"
        val onlyConfirm=args.getString("genesisE4OnlyConfirm")=="true"
        val longTitle=args.getString("genesisE4LongTitle")=="true"
        val density=app.resources.displayMetrics.widthPixels.toFloat()/width
        val original=runBlocking { app.database.dao().document(accountScope,"habits") }
        val at=Instant.now().minusSeconds(60).toString();val today=LocalDate.now()
        val habits=habitLifecycleLabels.keys.map { status ->
            val title=if(longTitle && status=="active") ("Сохранённое собственное название — "+"практика с длинным названием · ".repeat(17)).take(500)
                else "Сохранённая практика · $status"
            val habit=Habit(TrackerEntity("e4-capture-$status",at,at),title,today.minusDays(60),
                HabitEngine(GenesisCalendar()).defaultSchedule(today.minusDays(60),CalendarMode.PROFANE))
            if(status=="active") habit else HabitLifecycle.apply(habit,HabitLifecycleCommand("e4-capture-event-$status",habit.id,at,
                mapOf("paused" to "pause","archived" to "archive","deleted" to "delete").getValue(status),emptyList()))
        }
        val folder=File(app.getExternalFilesDir(null),"e4-captures").apply { mkdirs() }
        fun click(tag: String) {
            if (tag.startsWith("habit-state-")) {
                compose.onNodeWithTag("habit-state-choice").performScrollTo().performClick()
                compose.onNodeWithTag(tag).performClick()
            } else compose.onNodeWithTag(tag).performScrollTo().performClick()
            compose.waitForIdle()
        }
        val problems=mutableListOf<String>()
        fun capture(scene: String, tags: List<String>, dialog: Boolean=false) {
            compose.waitForIdle()
            val name="e4-$width-$language-${if(dark) "dark" else "light"}-font${(font*100).toInt()}-${if(longTitle) "long-" else ""}$scene"
            assertTrue(UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(File(folder,"$name.png")))
            val roots=compose.onAllNodes(isRoot()).fetchSemanticsNodes()
            val root=if(dialog) roots.last().boundsInRoot else compose.onNodeWithTag("e4-capture-root").fetchSemanticsNode().boundsInRoot
            val metrics=JSONArray()
            for(tag in tags) {
                val node=compose.onNodeWithTag(tag);node.assertIsDisplayed()
                val semantic=node.fetchSemanticsNode()
                val box=semantic.boundsInRoot
                // Android dialogs establish their own window density; use the rendered node's
                // density rather than the simulated density of the content behind that window.
                val renderedDensity=semantic.layoutInfo.density.density
                if(box.width+1<48*renderedDensity || box.height+1<48*renderedDensity || box.left<root.left-1 || box.top<root.top-1 || box.right>root.right+1 || box.bottom>root.bottom+1)
                    problems+="$name $tag: $box outside $root or below 48dp"
                metrics.put(JSONObject().put("tag",tag).put("bounds",box.toString()).put("density",renderedDensity).put("widthDp",box.width/renderedDensity).put("heightDp",box.height/renderedDensity))
            }
            File(folder,"$name.metrics.json").writeText(JSONObject().put("widthDp",width).put("fontScale",font).put("language",language)
                .put("dark",dark).put("density",density).put("root",root.toString()).put("controls",metrics)
                .put("capture","screencap-physical-display").toString())
        }
        try {
            val workspace=LocalHabitWorkspace(habits=habits,settings=HabitSettings(feedback=HabitFeedbackSettings(
                animations=false,achievementPopups=false,questsEnabled=false,gamificationWidgets=false)))
            runBlocking { app.database.withTransaction { app.database.dao().putDocument(DocumentRecord(accountScope,"habits",
                LocalCipher().encrypt(HabitDocument.encode(workspace),"$accountScope/habits"),1)) } }
            compose.setContent {
                CompositionLocalProvider(LocalDensity provides Density(density,font),LocalGenesisLanguage provides language,LocalEveningTheme provides dark) {
                    MaterialTheme(colorScheme=if(dark) evening else standart) { Surface(Modifier.fillMaxSize().testTag("e4-capture-root")) {
                        Column(Modifier.safeDrawingPadding()) { HabitsScreen(app,true,CalendarMode.PROFANE,CalendarMode.PROFANE) }
                    } }
                }
            }
            compose.waitUntil(30_000) { compose.onAllNodesWithTag("delete-habit-e4-capture-active").fetchSemanticsNodes().isNotEmpty() }
            if(!onlyConfirm) {
                compose.onNodeWithTag("delete-habit-e4-capture-active").performScrollTo()
                capture("controls",listOf("edit-habit-e4-capture-active","toggle-habit-e4-capture-active","archive-habit-e4-capture-active","habit-timer-open-e4-capture-active","delete-habit-e4-capture-active"))
                click("habit-state-archived");compose.onNodeWithTag("restore-habit-e4-capture-archived").performScrollTo()
                capture("archive",listOf("restore-habit-e4-capture-archived","delete-habit-e4-capture-archived"))
                click("habit-state-active")
            }
            click("delete-habit-e4-capture-active")
            capture("confirmation",listOf("confirm-delete-habit","cancel-delete-habit"),true)
            UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
            compose.waitUntil(10_000) { compose.onAllNodesWithTag("confirm-delete-habit").fetchSemanticsNodes().isEmpty() }
            assertTrue(problems.joinToString("\n"),problems.isEmpty())
        } finally {
            runBlocking { app.database.withTransaction { if(original==null) app.database.dao().deleteDocument(accountScope,"habits") else app.database.dao().putDocument(original) } }
        }
    }
}
