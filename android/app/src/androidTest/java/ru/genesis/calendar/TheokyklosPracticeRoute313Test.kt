package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import java.io.File
import java.time.LocalDate
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.TheokyklosCatalogSource
import ru.genesis.calendar.domain.habits.HabitLifecycle
import ru.genesis.calendar.ui.standardSacredHabit

/** One shipped sector -> practice -> sacred-habit route, using the local debug workspace. */
class TheokyklosPracticeRoute313Test {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private val app get() = compose.activity.application as GenesisApplication

    @Test fun actualSectorPracticeCreatesOneStoredHabitAndAllHabitsReopensTheSamePractice() {
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" &&
            app.workspaceScope == "internal-validation-v1")
        val scope = app.workspaceScope
        val dao = app.database.dao()
        val preferences = LocalPreferences(app, scope)
        val originalPreferences = runBlocking { preferences.values.first() }
        val original = runBlocking { dao.document(scope, "habits") }
        val initial = runBlocking { HabitsRepository(app).workspace.first() }
        val initialIds = initial.habits.mapTo(hashSetOf()) { it.id }
        val catalog = TheokyklosCatalogSource.load(app, "ru")
        val sectorId = (listOf("north") + catalog.sectors.map { it.id }.filterNot { it == "north" })
            .firstOrNull { id -> catalog.practicesFor(id).size == 2 && catalog.practicesFor(id).all {
                standardSacredHabit(initial.habits, it.id) == null
            } }
        check(sectorId != null) { "This synthetic route needs one sector with two unstarted standard practices" }
        val sector = catalog.byId.getValue(sectorId)
        val practice = catalog.practicesFor(sectorId).first()
        var createdId: String? = null
        val checkpoints = JSONArray()
        val proof = JSONObject().put("scope", scope).put("sectorId", sectorId)
            .put("practiceId", practice.id).put("checkpoints", checkpoints).put("completed", false)
        var observedFailure: Throwable? = null

        fun fresh() = runBlocking { withTimeout(3_000) { HabitsRepository(app).workspace.first() } }

        fun awaitMain() {
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("workspace-menu").fetchSemanticsNodes().isNotEmpty()
            }
        }

        fun openSector() {
            compose.openWorkspacePage("Сакральное", "theokyklos")
            compose.waitUntil(10_000) {
                compose.onAllNodes(hasTestTag("workspace-title") and hasText("Оракул · Теокиклос"))
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("theokyklos-mandala").assertExists()
            TheokyklosCatalogSource.ids.forEach { id ->
                compose.onNodeWithTag("theokyklos-sector-$id").assertExists()
            }
            compose.onNodeWithTag("theokyklos-card-$sectorId").performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(15_000) {
                compose.onAllNodesWithContentDescription("${sector.patrons.ru} — ${sector.title.ru}")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText(sector.description.ru).assertExists()
            compose.onNodeWithText(practice.description.ru).assertExists()
        }

        fun openHabitRoute(phase: String) {
            compose.onNodeWithText("Все привычки →").performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("habit-workspace-sacred").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("sacred-habits-block").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("sacred-sector-$sectorId").performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("sacred-practice-${practice.id}").fetchSemanticsNodes().isNotEmpty()
            }
            val ownCard = hasAnyAncestor(hasTestTag("sacred-practice-${practice.id}"))
            compose.onNode(hasText(practice.title.ru, substring = true) and ownCard)
                .performScrollTo().assertIsDisplayed()
            compose.onNode(hasText("Изменить") and ownCard).assertIsEnabled()
            val stored = fresh().habits.single { it.id == createdId }
            assertEquals(practice.id, stored.sacredPracticeId)
            assertEquals(sectorId, stored.sacredSectorId)
            assertEquals(practice.title.ru, stored.title)
            assertEquals(practice.description.ru, stored.description)
            assertEquals("active", HabitLifecycle.state(stored).status)
            assertNull("A catalog practice must not replace a saved reading cycle", stored.stoicheionRestoration)
            assertEquals(1, stored.practiceGoal!!.requiredCompletions)
            assertEquals(1, fresh().habits.count { it.sacredPracticeId == practice.id && it.stoicheionRestoration == null })
            captureNativeWindow(File(app.getExternalFilesDir(null), "theokyklos-practice313-$phase.png"))
            checkpoints.put("$phase:actual-sacred-habit-route-and-fresh-room-identity")
            compose.onNodeWithTag("sacred-sector-close").performScrollTo().performClick()
        }

        try {
            runBlocking {
                preferences.set("language", "ru")
                HabitsRepository(app).updateSettings(initial.settings.copy(enabled = true,
                    feedback = initial.settings.feedback.copy(animations = false, sound = false, haptics = false,
                        achievementPopups = false, questsEnabled = false, gamificationWidgets = false)))
            }
            awaitMain()
            openSector()
            compose.onAllNodesWithText("Начать").assertCountEquals(2)
            compose.onAllNodesWithText("Начать").onFirst().performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(15_000) { fresh().habits.any {
                it.id !in initialIds && it.sacredPracticeId == practice.id && it.stoicheionRestoration == null
            } }
            val created = fresh().habits.single { it.id !in initialIds && it.sacredPracticeId == practice.id }
            createdId = created.id
            proof.put("createdHabitId", created.id)
            assertEquals(LocalDate.now(), created.createdDate)
            assertEquals(practice.id, created.sacredPracticeId)
            assertEquals(sectorId, created.sacredSectorId)
            checkpoints.put("actual-sector-begin:one-native-room-habit")
            openHabitRoute("created")

            compose.activityRule.scenario.recreate()
            awaitMain()
            openSector()
            // Only the other unstarted practice offers Begin after a fresh screen/repository.
            compose.onAllNodesWithText("Начать").assertCountEquals(1)
            compose.onNodeWithText("Отметить сегодня").performScrollTo().assertIsEnabled()
            assertEquals(created.id, standardSacredHabit(fresh().habits, practice.id)!!.id)
            openHabitRoute("recreated")
            val after = fresh()
            assertEquals(initialIds + created.id, after.habits.mapTo(hashSetOf()) { it.id })
            assertEquals(initial.completions, after.completions)
            assertEquals(originalPreferences.input, runBlocking { preferences.values.first().input })
            proof.put("completed", true)
        } catch (failure: Throwable) {
            observedFailure = failure
            proof.put("failure", failure.javaClass.simpleName + ": " + failure.message)
            runCatching {
                proof.put("matchingHabitIds", JSONArray(fresh().habits.filter { it.sacredPracticeId == practice.id }.map { it.id }))
                captureNativeWindow(File(app.getExternalFilesDir(null), "theokyklos-practice313-failure.png"))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        } finally {
            val cleanupFailure = runCatching { runBlocking {
                check(app.workspaceScope == scope)
                if (original == null) dao.deleteDocument(scope, "habits") else dao.putDocument(original)
                preferences.set("language", originalPreferences.language)
                app.scheduler.restoreHabitNotifications()
                assertEquals(original, dao.document(scope, "habits"))
                assertEquals(originalPreferences, preferences.values.first())
            } }.exceptionOrNull()
            proof.put("cleanupRestoredExactDocumentAndPreferences", cleanupFailure == null)
            cleanupFailure?.let { proof.put("cleanupFailure", it.javaClass.simpleName + ": " + it.message) }
            File(app.getExternalFilesDir(null), "theokyklos-practice313-proof.json").writeText(proof.toString(2))
            cleanupFailure?.let { observedFailure?.addSuppressed(it) ?: throw it }
        }
    }
}
