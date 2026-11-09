package ru.genesis.calendar

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.Alignment
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.Instant
import java.time.LocalDate
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitCompletion
import ru.genesis.calendar.domain.habits.TrackerEntity
import ru.genesis.calendar.ui.*

/** Synthetic workspace only: never signs in, changes real draws, or writes a user's habits. */
class StoicheionRestorationFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()

    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun screenshot(name: String) {
        compose.waitForIdle()
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        device.waitForIdle()
        assertTrue(device.takeScreenshot(File(context.getExternalFilesDir(null), "restoration-$name.png")))
    }
    private fun letters(): List<StoicheionLetter> {
        val data = JSONArray(context.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
        val art = JSONObject(context.assets.open("stoicheion-art.json").bufferedReader().use { it.readText() })
        return (0 until data.length()).map { index ->
            val row = data.getJSONObject(index); val id = row.getString("id"); val image = art.getJSONObject(id)
            StoicheionLetter(id, row.getInt("order"), row.getString("name"), row.getString("symbol"),
                row.getString("lowercase"), row.getInt("value"), row.getInt("pythmen"), row.getString("tagline"),
                row.getString("content"), image.getString("body"), image.getString("bodyGreek"), image.getString("invocation"),
                Color(android.graphics.Color.parseColor(image.getString("accent"))))
        }
    }

    @Test fun sharedCatalogRetainsAllNineFieldsFiveSupportsAndFourteenUiLocalesOffline() {
        val source = TheokyklosCatalogSource.load(context)
        assertEquals(StoicheionRestoration.letters.map { it.id to it.value }, letters().map { it.id to it.value })
        for (language in listOf("ru", "en", "el", "de", "fr", "es", "it", "pt", "pl", "sr", "uk", "zh", "tr", "ja")) {
            val catalog = StoicheionRestorationCatalogSource.load(context, language)
            assertEquals(9, catalog.sectors.size); assertEquals(5, catalog.auxiliaries.size); assertEquals(24, catalog.letterFoci.size)
            assertTrue(catalog.copy("begin").isNotBlank())
            assertTrue(catalog.copy("invalidSnapshot").isNotBlank())
            assertTrue(catalog.copy("alreadyLinked").isNotBlank())
            assertTrue(catalog.copy("cycleExists").isNotBlank())
            assertEquals("14 = (8 + 1) + (3 + 2)", catalog.framework.formula)
            assertTrue(catalog.letterFoci.values.all { it.needs.size == 3 })
            assertTrue(catalog.sectors.values.all { it.needs.size == 3 && it.myth.url.startsWith("https://") })
            assertTrue(catalog.sectors.values.flatMap { it.needs.values }.all { need -> source.practices.any { it.id == need.practiceId } })
        }
    }

    private fun journey(dark: Boolean) {
        val letters = letters()
        val catalog = StoicheionRestorationCatalogSource.load(context, "ru")
        val theokyklos = TheokyklosCatalogSource.load(context)
        val sourceCards = StoicheionRestoration.letters.take(9).map { RestorationDrawCard(it.id, true) }.toMutableList().apply {
            val beta = this[1]; this[1] = this[8]; this[8] = beta
        }.toList()
        val source = RestorationSource(LocalDate.now().toString(), 42, sourceCards)
        var saved: Habit? = null
        val reflectionWrites = java.util.concurrent.atomic.AtomicInteger()
        val lastReflection = java.util.concurrent.atomic.AtomicReference<String?>(null)
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides dark) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    var workspace by remember { mutableStateOf(LocalHabitWorkspace()) }
                    val habit = workspace.habits.firstOrNull()
                    Surface(Modifier.fillMaxSize().padding(top = 28.dp, bottom = 24.dp)) { Box(contentAlignment = Alignment.TopCenter) {
                      Box(Modifier.widthIn(max = 840.dp).fillMaxSize()) {
                        if (habit == null) RestorationJourney(source, letters, catalog, theokyklos, workspace,
                            "southeast", false, null, {}, inputCalendarMode = CalendarMode.PROFANE, onSave = { created ->
                                saved = created; workspace = workspace.copy(habits = listOf(created))
                            })
                        else RestorationCycle(habit, workspace, letters, catalog, LocalDate.now(), false, null,
                            onComplete = { workspace = workspace.copy(completions = listOf(HabitCompletion(
                                TrackerEntity.create("completion", Instant.now().toString()), habit.id, LocalDate.now(), true))) },
                            onReflection = { text ->
                                reflectionWrites.incrementAndGet(); lastReflection.set(text)
                                workspace = workspace.copy(habits = listOf(habit.copy(
                                    stoicheionRestoration = habit.stoicheionRestoration!!.copy(reflection = text))))
                            }, onOpenHabits = {})
                    } } }
                }
            }
        }
        val scheme = if (dark) "dark" else "light"
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-need-deficit"))
        compose.onNodeWithTag("restoration-need-deficit").performClick()
        screenshot("$scheme-meaning")
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-next"))
        compose.onNodeWithTag("restoration-next").performClick()
        compose.onNodeWithTag("restoration-stage-1").assertExists()
        compose.onNodeWithTag("restoration-scroll").performScrollToIndex(0)
        compose.onNodeWithTag("restoration-framework-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("restoration-framework-body").assertExists()
        compose.onNodeWithTag("restoration-framework-toggle").performClick()
        screenshot("$scheme-myth")
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-next"))
        compose.onNodeWithTag("restoration-next").performClick()
        compose.onNodeWithText(catalog.copy("formula")).assertExists()
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-next"))
        compose.onNodeWithTag("restoration-next").assertIsNotEnabled()
        val support = catalog.sectors.getValue("southeast").needs.getValue("deficit").supportId
        val resource = StoicheionRestoration.equation(2, sourceCards.sumOf {
            StoicheionRestoration.lettersById.getValue(it.letterId).value }, listOf(support)).candidates.first()
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-resource-${resource.id}"))
        compose.onNodeWithTag("restoration-resource-${resource.id}").performClick()
        compose.onNodeWithTag("restoration-scroll").performScrollToIndex(0)
        compose.onNodeWithTag("restoration-stage-1").performScrollTo().performClick()
        for (id in listOf("hearth", "entrance", "zenith")) {
            compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-support-$id"))
            compose.onNodeWithTag("restoration-support-$id").performScrollTo().performClick()
        }
        compose.onNodeWithTag("restoration-scroll").performScrollToIndex(0)
        compose.onNodeWithTag("restoration-stage-2").performScrollTo().performClick()
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-next"))
        compose.onNodeWithTag("restoration-next").assertIsNotEnabled()
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-resource-${resource.id}"))
        compose.onNodeWithTag("restoration-resource-${resource.id}").performScrollTo().performClick()
        compose.onNodeWithTag("restoration-scroll").performScrollToIndex(0)
        screenshot("$scheme-arithmetic")
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-next"))
        compose.onNodeWithTag("restoration-next").performClick()
        compose.onNodeWithTag("restoration-scroll").performScrollToNode(hasTestTag("restoration-start-cycle"))
        screenshot("$scheme-practice")
        compose.onNodeWithTag("restoration-start-cycle").performClick()
        compose.waitUntil(5_000) { saved != null }
        assertEquals(sourceCards, saved!!.stoicheionRestoration!!.cards)
        assertEquals("southeast", saved!!.stoicheionRestoration!!.sectorId)
        assertEquals(LocalDate.now().toString(), saved!!.stoicheionRestoration!!.startedDate)
        assertEquals("classic", saved!!.schedule.recurrence.mode)
        assertTrue(saved!!.schedule.recurrence.enabled)
        val engine = ru.genesis.calendar.domain.habits.HabitEngine(GenesisCalendar())
        assertTrue(engine.isScheduled(saved!!, LocalDate.now().plusDays(1)))
        assertFalse(engine.isScheduled(saved!!, LocalDate.now().plusDays(10)))
        assertEquals(1,saved!!.practiceGoal!!.requiredCompletions)
        assertEquals(listOf("entrance", "zenith"), saved!!.stoicheionRestoration!!.supportIds)
        for (id in saved!!.stoicheionRestoration!!.supportIds) {
            val helper = theokyklos.practices.first { it.id == catalog.auxiliaries.first { it.id == id }.practiceId }
            assertTrue(saved!!.stoicheionRestoration!!.action.contains(helper.title.ru))
            assertTrue(saved!!.stoicheionRestoration!!.action.contains(helper.description.ru))
        }
        assertTrue(saved!!.stoicheionRestoration!!.practiceText.contains(catalog.letterFoci.getValue(resource.id).quality))
        compose.onNodeWithTag("restoration-cycle-scroll").performScrollToNode(hasTestTag("restoration-complete-today"))
        compose.onNodeWithTag("restoration-complete-today").performClick()
        compose.onNodeWithTag("restoration-cycle-scroll").performScrollToIndex(0)
        compose.onNodeWithText("Выполнено · 1/1").assertExists()
        compose.onNodeWithTag("restoration-complete-today").assertDoesNotExist()
        screenshot("$scheme-cycle")
        compose.onNodeWithTag("restoration-cycle-scroll").performScrollToNode(hasTestTag("restoration-reflection"))
        val note = "Сделан один посильный шаг"
        compose.onNodeWithTag("restoration-reflection").performTextInput(note)
        compose.onNodeWithTag("restoration-reflection").assertTextContains(note)
        // The real IME can resize the viewport after text entry. Dismiss it only
        // when present, so the following touch targets the settled save button.
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val keyboard = android.provider.Settings.Secure.getString(context.contentResolver,
            android.provider.Settings.Secure.DEFAULT_INPUT_METHOD)?.substringBefore('/')
        if (keyboard != null && device.hasObject(androidx.test.uiautomator.By.pkg(keyboard))) {
            device.pressBack()
            assertTrue("The real keyboard must close before the save touch", device.wait(
                androidx.test.uiautomator.Until.gone(androidx.test.uiautomator.By.pkg(keyboard)), 5_000))
        }
        try {
            compose.onNodeWithTag("restoration-save-reflection").performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(10_000) {
                lastReflection.get() == note && compose.onAllNodesWithText(catalog.copy("saved"))
                    .fetchSemanticsNodes().isNotEmpty()
            }
            assertEquals(1, reflectionWrites.get())
            assertEquals(note, lastReflection.get())
            compose.onNodeWithText("Наблюдение сохранено").assertExists()
        } catch (failure: Throwable) {
            runCatching {
                val proof = JSONObject().put("scheme", scheme).put("expectedNote", note)
                    .put("callbackWrites", reflectionWrites.get()).put("callbackNote", lastReflection.get())
                    .put("saveButton", runCatching { compose.onNodeWithTag("restoration-save-reflection")
                        .printToString() }.getOrElse { it.javaClass.simpleName })
                    .put("input", runCatching { compose.onNodeWithTag("restoration-reflection")
                        .printToString() }.getOrElse { it.javaClass.simpleName })
                File(context.getExternalFilesDir(null), "restoration-reflection313-failure.json").writeText(proof.toString(2))
                captureNativeWindow(File(context.getExternalFilesDir(null), "restoration-reflection313-failure.png"))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        }
    }

    @Test fun lightJourneyKeepsTheDrawAndCompletesThePracticeOnce() = journey(false)
    @Test fun darkJourneyKeepsTheDrawAndCompletesThePracticeOnce() = journey(true)
}
