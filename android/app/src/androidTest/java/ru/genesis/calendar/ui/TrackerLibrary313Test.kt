package ru.genesis.calendar.ui

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.json.JSONObject
import ru.genesis.calendar.BuildConfig
import ru.genesis.calendar.GenesisApplication
import ru.genesis.calendar.PagerTestActivity
import ru.genesis.calendar.captureNativeWindow
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.domain.trackers.SleepPlan
import java.io.File
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit
import java.util.UUID

/** Real native components and encrypted Room only, in the guarded synthetic debug workspace. */
class TrackerLibrary313Test {
    @get:Rule val compose = createAndroidComposeRule<PagerTestActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private val preferences get() = LocalPreferences(app, app.workspaceScope)
    private var mounted by mutableStateOf(true)
    private var mount by mutableIntStateOf(0)
    private var screen by mutableStateOf("trackers")
    private var initialPlan: SleepPlan? = null
    private val ownedPlans = mutableSetOf<String>()
    private val ownedMoodMarkers = mutableSetOf<String>()
    private val ownedBehaviorMarkers = mutableSetOf<String>()
    private val dark get() = InstrumentationRegistry.getArguments().let {
        it.getString("genesisEvening") == "true" || it.getString("genesisDark") == "true"
    }
    private fun guard() = check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
    // A fresh repository decodes the actual Room document on every read.
    private fun saved() = runBlocking { TrackersRepository(app).workspace.first() }
    private fun content() {
        guard()
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart, typography = GenesisTypography, shapes = GenesisShapes) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                        if (mounted) key(mount) {
                            val scope = rememberCoroutineScope()
                            var busy by remember { mutableStateOf(false) }
                            var error by remember { mutableStateOf<String?>(null) }
                            when (screen) {
                                "create-sleep" -> SleepPlanEditor(requireNotNull(initialPlan), true, busy, error,
                                    onDismiss = { screen = "trackers" }) { next ->
                                    scope.launch {
                                        busy = true
                                        try { TrackersRepository(app).savePlan(next); screen = "trackers" }
                                        catch (failure: Exception) { error = failure.message ?: "Synthetic plan save failed" }
                                        finally { busy = false }
                                    }
                                }
                                "abstinence" -> AbstinenceScreen(app, onBack = {})
                                else -> TrackersScreen(app, experimental = true)
                            }
                        }
                    }
                }
            }
        }
    }
    private fun click(matcher: SemanticsMatcher, scroll: Boolean = true) {
        compose.waitUntil(15000) { compose.onAllNodes(matcher and isEnabled()).fetchSemanticsNodes().size == 1 }
        val node = compose.onNode(matcher).assertIsEnabled()
        if (scroll) node.performScrollTo()
        node.performClick()
    }
    private fun clickTag(tag: String) {
        if (tag == "mood-entry-save" || tag == "mood-editor-close") {
            val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
            val keyboard = android.provider.Settings.Secure.getString(app.contentResolver,
                android.provider.Settings.Secure.DEFAULT_INPUT_METHOD)?.substringBefore('/')
            if (keyboard != null && device.hasObject(By.pkg(keyboard))) {
                assertTrue(device.pressBack())
                assertTrue("The keyboard must close before the editor action", device.wait(Until.gone(By.pkg(keyboard)), 5000))
            }
        }
        click(hasTestTag(tag))
    }
    private fun clickText(text: String, scroll: Boolean = true) = click(hasText(text) and hasClickAction(), scroll)
    private fun replace(label: String, value: String) = compose.onNode(hasText(label) and hasSetTextAction())
        .performScrollTo().assertIsEnabled().performTextReplacement(value)
    private fun gone(tag: String) = compose.waitUntil(15000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty() }
    private fun remount() { compose.runOnIdle { mount++ }; compose.waitForIdle() }
    private fun capture(name: String) {
        compose.waitForIdle()
        captureNativeWindow(File(app.getExternalFilesDir(null), "tracker-library313-${if (dark) "dark" else "light"}-$name.png"))
    }
    private fun openPlan(title: String) {
        clickTag("sleep-plan-header")
        compose.waitUntil(10000) {
            compose.onAllNodesWithTag("sleep-plan-close").fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithText("Выберите план сна").fetchSemanticsNodes().isNotEmpty()
        }
        if (compose.onAllNodesWithTag("sleep-plan-close").fetchSemanticsNodes().isEmpty()) clickText(title, scroll = false)
        compose.onNode(hasText("Название") and hasSetTextAction()).assertTextContains(title)
    }
    private fun adjustHour(tag: String, direction: String) {
        clickTag(tag); clickText(direction); clickText("Готово")
        gone("author-time-close")
    }
    private fun openMood() = click((hasText("Выбрать настроение") or hasText("Изменить настроение")) and hasClickAction())
    private fun assertOtherRowsUnchanged(before: LocalTrackersWorkspace, after: LocalTrackersWorkspace) {
        val moodIds = after.moodEntries.filter { row -> ownedMoodMarkers.any { row.note.startsWith(it) } }.map { it.entity.id }.toSet()
        val trackerIds = after.addictionTrackers.filter { row -> ownedBehaviorMarkers.any { row.trackedBehavior.startsWith(it) } }.map { it.id }.toSet()
        assertEquals(before.sleepPlans, after.sleepPlans.filterNot { it.id in ownedPlans })
        assertEquals(before.sleepEntries, after.sleepEntries.filterNot { it.planId in ownedPlans })
        assertEquals(before.moodEntries, after.moodEntries.filterNot { it.entity.id in moodIds })
        assertEquals(before.addictionTrackers, after.addictionTrackers.filterNot { it.id in trackerIds })
        assertEquals(before.addictionEntries, after.addictionEntries.filterNot { it.trackerId in trackerIds })
    }
    /** Remove exact UUID-owned rows and dependents; never reset a document, collection or database. */
    private fun cleanup() {
        compose.runOnIdle { mounted = false }; compose.waitForIdle(); guard()
        runBlocking { app.database.withTransaction {
            val row = app.database.dao().document(app.workspaceScope, "trackers") ?: return@withTransaction
            val cipher = LocalCipher()
            val current = TrackersDocument.decode(cipher.decrypt(row.encrypted, "${app.workspaceScope}/trackers"), row.revision)
            val moodIds = current.moodEntries.filter { entry -> ownedMoodMarkers.any { entry.note.startsWith(it) } }.map { it.entity.id }.toSet()
            val trackerIds = current.addictionTrackers.filter { tracker -> ownedBehaviorMarkers.any { tracker.trackedBehavior.startsWith(it) } }.map { it.id }.toSet()
            val next = current.copy(sleepPlans = current.sleepPlans.filterNot { it.id in ownedPlans },
                sleepEntries = current.sleepEntries.filterNot { it.planId in ownedPlans },
                moodEntries = current.moodEntries.filterNot { it.entity.id in moodIds },
                addictionTrackers = current.addictionTrackers.filterNot { it.id in trackerIds },
                addictionEntries = current.addictionEntries.filterNot { it.trackerId in trackerIds })
            if (next != current) {
                val revision = current.revision + 1
                app.database.dao().putDocument(DocumentRecord(app.workspaceScope, "trackers",
                    cipher.encrypt(TrackersDocument.encode(next), "${app.workspaceScope}/trackers"), revision))
            }
        } }
    }

    @Test fun sleepPlanCreateEditPauseAndLibraryReopenUseOnePersistedPlan() {
        guard()
        val before = saved()
        val marker = "QA313 сон ${UUID.randomUUID()}"
        val plan = SleepPlan(TrackerEntity.create("sleep-plan", id = "qa313-sleep-${UUID.randomUUID()}"),
            dailySleepSchedule(LocalDate.now(), CalendarMode.PROFANE), title = marker)
        ownedPlans += plan.id
        initialPlan = plan; screen = "create-sleep"
        try {
            assertTrue(saved().sleepPlans.none { it.id == plan.id })
            content()
            replace("Название", marker)
            adjustHour("sleep-plan-bedtime", "Час −")
            adjustHour("sleep-plan-wake", "Час +")
            clickTag("sleep-plan-save"); gone("sleep-plan-close")
            val created = saved().sleepPlans.single { it.id == plan.id }
            assertEquals(marker, created.title); assertTrue(created.active)
            assertEquals(LocalTime.of(22, 0), created.targetBedtime)
            assertEquals(LocalTime.of(8, 0), created.targetWakeTime)

            openPlan(marker)
            replace("Название", "$marker · изменён")
            adjustHour("sleep-plan-bedtime", "Час +")
            adjustHour("sleep-plan-wake", "Час −")
            compose.onNodeWithText("План активен").assertExists()
            // The editor declares active first, followed by quality/reminder/scoring controls.
            compose.onAllNodes(isToggleable()).onFirst().performScrollTo().assertIsOn().performClick().assertIsOff()
            clickTag("sleep-plan-save"); gone("sleep-plan-close")
            val edited = saved().sleepPlans.single { it.id == plan.id }
            assertEquals("$marker · изменён", edited.title); assertFalse(edited.active)
            assertEquals(LocalTime.of(23, 0), edited.targetBedtime)
            assertEquals(LocalTime.of(7, 0), edited.targetWakeTime)
            assertTrue(edited.entity.version > created.entity.version)
            assertEquals(created.schedule, edited.schedule)

            remount(); openPlan(edited.title)
            compose.onAllNodes(isToggleable()).onFirst().performScrollTo().assertIsOff()
            val use24 = runBlocking { preferences.values.first().use24 }
            compose.onNodeWithTag("sleep-plan-bedtime").performScrollTo().assertTextEquals(timeLabel("23:00", use24))
            compose.onNodeWithTag("sleep-plan-wake").assertTextEquals(timeLabel("07:00", use24))
            capture("sleep-plan-reopened")
            clickTag("sleep-plan-close"); gone("sleep-plan-close")
            assertEquals(edited, saved().sleepPlans.single { it.id == plan.id })
            assertOtherRowsUnchanged(before, saved())
        } finally { cleanup() }
    }

    @Test fun pastMoodCreateCancelEditDisplayChangeAndHistoryReopenKeepTheCanonicalDay() {
        guard()
        val before = saved()
        val previousDisplay = runBlocking { preferences.values.first().display }
        val marker = "QA313 настроение ${UUID.randomUUID()}"
        ownedMoodMarkers += marker
        var date = LocalDate.now().minusDays(1)
        while (before.moodEntries.any { it.date == date }) date = date.minusDays(1)
        check(ChronoUnit.DAYS.between(date, LocalDate.now()) < 60) { "No unused recent synthetic mood date" }
        val calendar = GenesisCalendar()
        try {
            runBlocking { preferences.set("display", CalendarMode.PROFANE.wireValue) }
            content(); openMood()
            clickTag("mood-editor-date")
            val monthSteps = ChronoUnit.MONTHS.between(date.withDayOfMonth(1), LocalDate.now().withDayOfMonth(1)).toInt()
            repeat(monthSteps) { clickText("←") }
            click(hasContentDescription(calendar.formatDate(date, CalendarMode.PROFANE)))
            compose.onNodeWithTag("mood-editor-date").assertTextEquals(compactDreamDate(date, CalendarMode.PROFANE, calendar))
            clickTag("mood-value-2")
            replace("Заметка и контекст", "$marker · первая запись")
            clickTag("mood-entry-save"); gone("mood-editor-close")
            val created = saved().moodEntries.single { it.note.startsWith(marker) }
            assertEquals(date, created.date); assertEquals(2, created.moodValue)

            openMood()
            compose.onNodeWithTag("mood-value-2").performScrollTo().assertIsSelected()
            clickTag("mood-value--2")
            replace("Заметка и контекст", "$marker · отменённый черновик")
            clickTag("mood-editor-close"); gone("mood-editor-close")
            assertEquals(created, saved().moodEntries.single { it.entity.id == created.entity.id })

            openMood()
            for (mode in listOf(CalendarMode.LUNAR, CalendarMode.SACRED, CalendarMode.PROFANE)) {
                runBlocking { preferences.set("display", mode.wireValue) }
                val label = compactDreamDate(date, mode, calendar)
                compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("mood-editor-date").assertTextEquals(label) }.isSuccess }
                assertEquals(created, saved().moodEntries.single { it.entity.id == created.entity.id })
            }
            clickTag("mood-value-4")
            replace("Заметка и контекст", "$marker · изменённая запись")
            clickTag("mood-entry-save"); gone("mood-editor-close")
            val edited = saved().moodEntries.single { it.entity.id == created.entity.id }
            assertEquals(date, edited.date); assertEquals(4, edited.moodValue)
            assertTrue(edited.entity.version > created.entity.version)
            assertEquals(1, saved().moodEntries.count { it.date == date })

            remount()
            clickText("История наблюдений")
            click(hasText("$date ·", substring = true) and hasClickAction())
            openMood()
            compose.onNodeWithTag("mood-editor-date").assertTextEquals(compactDreamDate(date, CalendarMode.PROFANE, calendar))
            compose.onNodeWithTag("mood-value-4").performScrollTo().assertIsSelected()
            compose.onNode(hasText("Заметка и контекст") and hasSetTextAction()).performScrollTo()
                .assertTextContains("$marker · изменённая запись")
            capture("past-mood-reopened")
            clickTag("mood-editor-close"); gone("mood-editor-close")
            assertEquals(edited, saved().moodEntries.single { it.entity.id == created.entity.id })
            assertOtherRowsUnchanged(before, saved())
        } catch (failure: Throwable) {
            runCatching {
                capture("past-mood-failure")
                File(app.getExternalFilesDir(null), "tracker-library313-mood-failure.json").writeText(JSONObject()
                    .put("expectedDate", date.toString())
                    .put("failure", failure.stackTraceToString())
                    .put("saveButton", runCatching { compose.onNodeWithTag("mood-entry-save").printToString() }
                        .getOrElse { it.javaClass.simpleName })
                    .put("storedOwnEntries", saved().moodEntries.filter { it.note.startsWith(marker) }.toString())
                    .toString(2))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        } finally {
            try { cleanup() } finally { runBlocking { preferences.set("display", previousDisplay.wireValue) } }
        }
    }

    @Test fun abstinenceCreateEditPauseActivateDeleteCancelAndReopenRetainOneTracker() {
        guard()
        val before = saved()
        val marker = "QA313 воздержание ${UUID.randomUUID()}"
        ownedBehaviorMarkers += marker
        screen = "abstinence"
        try {
            content(); clickTag("abstinence-add")
            compose.onNodeWithTag("abstinence-name").performTextReplacement(marker)
            replace("Описание", "Синтетическое описание")
            clickTag("abstinence-tracker-save"); gone("abstinence-editor-close")
            val created = saved().addictionTrackers.single { it.trackedBehavior == marker }
            assertEquals("active", created.status)
            clickTag("abstinence-edit-${created.id}")
            compose.onNodeWithTag("abstinence-name").performTextReplacement("$marker · изменён")
            replace("Описание", "Изменённое синтетическое описание")
            clickTag("abstinence-tracker-save"); gone("abstinence-editor-close")
            val edited = saved().addictionTrackers.single { it.id == created.id }
            assertEquals("$marker · изменён", edited.trackedBehavior)
            assertEquals("Изменённое синтетическое описание", edited.description)
            assertTrue(edited.entity.version > created.entity.version)
            assertEquals(created.schedule, edited.schedule)
            val ownCard = hasAnyAncestor(hasTestTag("abstinence-tracker-${created.id}"))
            val paused = hasText("На паузе") and hasClickAction() and ownCard
            val active = hasText("Активен") and hasClickAction() and ownCard
            click(paused)
            compose.waitUntil(10000) { saved().addictionTrackers.single { it.id == created.id }.status == "paused" }
            compose.waitUntil(10000) { runCatching { compose.onNode(active).assertIsEnabled() }.isSuccess }
            compose.onNodeWithTag("abstinence-record-${created.id}").assertIsNotEnabled()
            remount()
            compose.waitUntil(10000) { compose.onAllNodesWithTag("abstinence-tracker-${created.id}").fetchSemanticsNodes().isNotEmpty() }
            compose.onNode(paused).performScrollTo().assertIsSelected()
            click(active)
            compose.waitUntil(10000) { saved().addictionTrackers.single { it.id == created.id }.status == "active" }
            compose.waitUntil(10000) { runCatching { compose.onNodeWithTag("abstinence-record-${created.id}").assertIsEnabled() }.isSuccess }
            val activated = saved().addictionTrackers.single { it.id == created.id }
            click(hasContentDescription("Удалить") and hasClickAction() and ownCard)
            clickText("Отмена", scroll = false)
            compose.waitUntil(10000) { compose.onAllNodesWithText("Отмена").fetchSemanticsNodes().isEmpty() }
            assertEquals(activated, saved().addictionTrackers.single { it.id == created.id })
            remount(); clickTag("abstinence-edit-${created.id}")
            compose.onNodeWithTag("abstinence-name").assertTextContains("$marker · изменён")
            compose.onNode(hasText("Описание") and hasSetTextAction()).assertTextContains("Изменённое синтетическое описание")
            capture("abstinence-reopened")
            clickTag("abstinence-editor-close"); gone("abstinence-editor-close")
            assertEquals(activated, saved().addictionTrackers.single { it.id == created.id })
            assertOtherRowsUnchanged(before, saved())
        } finally { cleanup() }
    }
}
