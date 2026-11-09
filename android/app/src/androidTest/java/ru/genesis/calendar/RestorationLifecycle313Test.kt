package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.v2.createAndroidComposeRule
import java.io.File
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.HabitsRepository
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.data.StoicheionRestorationCodec
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

/** One real stored cycle and its actual habit actions, isolated from accounts and network. */
class RestorationLifecycle313Test {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private val app get() = compose.activity.application as GenesisApplication

    private fun letters(): List<StoicheionLetter> {
        val rows = JSONArray(app.assets.open("stoicheion.json").bufferedReader().use { it.readText() })
        val art = JSONObject(app.assets.open("stoicheion-art.json").bufferedReader().use { it.readText() })
        return (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val id = row.getString("id")
            val image = art.getJSONObject(id)
            StoicheionLetter(id, row.getInt("order"), row.getString("name"), row.getString("symbol"),
                row.getString("lowercase"), row.getInt("value"), row.getInt("pythmen"), row.getString("tagline"),
                row.getString("content"), image.getString("body"), image.getString("bodyGreek"),
                image.getString("invocation"), Color(android.graphics.Color.parseColor(image.getString("accent"))))
        }
    }

    @Test fun linkedHabitPauseResumeAndFreshCycleViewRetainSourceAndProgress() {
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.v313.debug" &&
            app.workspaceScope == "internal-validation-v1")
        val scope = app.workspaceScope
        val dao = app.database.dao()
        val original = runBlocking { dao.document(scope, "habits") }
        val initial = runBlocking { HabitsRepository(app).workspace.first() }
        val today = LocalDate.now()
        val token = UUID.randomUUID().toString()
        val id = "restoration-lifecycle313-$token"
        val seed = token.hashCode().toUInt().toLong()
        val startedAt = Instant.now().minusSeconds(60).toString()
        val cards = StoicheionRestoration.letters.take(9).map { RestorationDrawCard(it.id, true) }
        val snapshot = StoicheionRestorationSnapshot(
            cycleId = StoicheionRestoration.cycleId(today.toString(), seed, "north", "beta"),
            startedAt = startedAt, startedDate = today.toString(), sourceDate = today.toString(), sourceSeed = seed,
            cards = cards, sectorId = "north", letterId = "beta", need = "conflict", supportIds = listOf("hearth"),
            resourceLetterId = "theta", practiceId = "athena-three-intentions", spreadTotal = 49, pythmen = 4,
            intention = "Намерение $token", action = "Сделать один посильный шаг",
            practiceText = "Спокойно осмыслить меру", reflection = "Сохранённое наблюдение $token")
        assertEquals(snapshot, StoicheionRestorationCodec.decode(StoicheionRestorationCodec.encode(snapshot)))
        val base = HabitEngine(GenesisCalendar()).defaultSchedule(today, CalendarMode.PROFANE)
        val daily = StoicheionRestoration.dailySchedule(base)
        val habit = Habit(TrackerEntity.create("habit", startedAt, id), "Практика цикла $token", today,
            daily.copy(recurrence = daily.recurrence.copy(rangeStart = today.toString(), rangeEnd = today.plusDays(9).toString())),
            sacredPracticeId = snapshot.practiceId, sacredSectorId = snapshot.sectorId,
            stoicheionRestoration = snapshot, practiceGoal = HabitPracticeGoal(requiredCompletions = 3, startDate = today))
        val catalog = StoicheionRestorationCatalogSource.load(app, "ru")
        val theokyklos = TheokyklosCatalogSource.load(app)
        val authoredLetters = letters()
        var page by mutableStateOf("cycle")
        val checkpoints = JSONArray()
        val proof = JSONObject().put("scope", scope).put("habitId", id).put("sourceSeed", seed)
            .put("cycleId", snapshot.cycleId).put("checkpoints", checkpoints).put("completed", false)
        var observedFailure: Throwable? = null

        fun fresh(): LocalHabitWorkspace = runBlocking { withTimeout(3_000) {
            HabitsRepository(app).workspace.first()
        } }

        fun stored() = fresh().habits.single { it.id == id }

        fun assertRetained(expectedStatus: String, completed: LocalHabitWorkspace) {
            val value = fresh()
            val saved = value.habits.single { it.id == id }
            assertEquals(expectedStatus, HabitLifecycle.state(saved).status)
            assertEquals(snapshot, saved.stoicheionRestoration)
            assertEquals(cards, saved.stoicheionRestoration!!.cards)
            assertEquals(completed.completions, value.completions)
            assertEquals(completed.rewards, value.rewards)
            assertEquals(completed.progress.lifetimeXp, value.progress.lifetimeXp)
            assertEquals(listOf(today), StoicheionRestoration.completionDates(snapshot, id, value.completions, today))
            assertEquals(1, HabitPracticeGoals.progress(saved, value.completions, today)!!.dates.size)
            assertEquals(3, saved.practiceGoal!!.requiredCompletions)
            checkpoints.put("fresh-repository:$expectedStatus:source-and-one-completion-retained")
        }

        fun cycleView(phase: String) {
            compose.runOnIdle { page = "cycle" }
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("restoration-cycle-scroll").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("restoration-cycle-scroll").performScrollToIndex(0)
            compose.onNodeWithText("${catalog.copy("progress")} · 1/3").assertExists()
            compose.onNodeWithTag("restoration-cycle-scroll")
                .performScrollToNode(hasText(catalog.copy("original")))
            compose.onNodeWithText(catalog.copy("original")).performScrollTo().assertIsEnabled().performClick()
            cards.forEachIndexed { index, card ->
                val letter = authoredLetters.first { it.id == card.letterId }
                val sector = catalog.sectors.getValue(StoicheionRestoration.positions[index]).title.substringBefore(" · ")
                compose.onNodeWithText("$sector · ${letter.symbol} ${letter.name} ↓").assertExists()
            }
            compose.onNodeWithText("49 → 4").assertExists()
            captureNativeWindow(File(app.getExternalFilesDir(null), "restoration-lifecycle313-$phase.png"))
            checkpoints.put("actual-cycle-view:$phase:one-of-three-and-nine-original-cards")
        }

        fun library(filter: String) {
            compose.runOnIdle { page = "habits" }
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("habit-view-library").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("habit-view-library").performScrollTo().performClick().assertIsSelected()
            compose.onNodeWithTag("habit-state-choice").performScrollTo().performClick()
            compose.onNodeWithTag("habit-state-$filter").assertIsEnabled().performClick()
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("habit-actions-$id").fetchSemanticsNodes().isNotEmpty()
            }
        }

        fun toggle(expectedStatus: String) {
            val tag = "toggle-habit-$id"
            if (compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty())
                compose.onNodeWithTag("habit-actions-$id").performScrollTo().assertIsEnabled().performClick()
            compose.onNodeWithTag(tag).performScrollTo().assertIsEnabled().performClick()
            compose.waitUntil(15_000) { HabitLifecycle.state(stored()).status == expectedStatus }
        }

        try {
            runBlocking {
                val repository = HabitsRepository(app)
                repository.updateSettings(initial.settings.copy(enabled = true,
                    feedback = initial.settings.feedback.copy(animations = false, sound = false, haptics = false,
                        achievementPopups = false, questsEnabled = false, gamificationWidgets = false)))
                repository.save(habit)
            }
            compose.setContent {
                CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides false) {
                    MaterialTheme(colorScheme = standart) { Surface(Modifier.fillMaxSize()) {
                        key(page) {
                            val repository = remember { HabitsRepository(app) }
                            val workspace by repository.workspace.collectAsState(LocalHabitWorkspace())
                            Column(Modifier.fillMaxSize().safeDrawingPadding()) {
                                when (page) {
                                    "cycle" -> StoicheionRestorationScreen(null, authoredLetters, catalog, theokyklos,
                                        workspace, repository, null, id, CalendarMode.PROFANE,
                                        onBack = { page = "habits" }, onOpenHabits = { page = "habits" },
                                        onOpenTheokyklos = { error("Saved cycle must not start a new Theokyklos journey") })
                                    "habits" -> HabitsScreen(app, true, CalendarMode.PROFANE, CalendarMode.PROFANE)
                                    else -> Unit
                                }
                            }
                        }
                    } }
                }
            }
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("restoration-complete-today").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("restoration-cycle-scroll")
                .performScrollToNode(hasTestTag("restoration-complete-today"))
            compose.onNodeWithTag("restoration-complete-today").assertIsEnabled().performClick()
            compose.waitUntil(15_000) { fresh().completions.count { it.habitId == id && it.completed && it.date == today } == 1 }
            val completed = fresh()
            val historyBeforePause = completed.habits.single { it.id == id }.lifecycleHistory
            assertRetained("active", completed)
            // Reopen the actual saved-cycle route with a new screen/repository below.
            library("active")
            toggle("paused")
            assertRetained("paused", completed)
            cycleView("paused")
            library("paused")
            toggle("active")
            assertRetained("active", completed)
            cycleView("resumed")
            val after = fresh()
            assertEquals(initial.habits, after.habits.filterNot { it.id == id })
            assertEquals(initial.completions, after.completions.filterNot { it.habitId == id })
            val historyAfterResume = stored().lifecycleHistory
            assertEquals(historyBeforePause, historyAfterResume.take(historyBeforePause.size))
            val newTransitions = historyAfterResume.drop(historyBeforePause.size)
            assertEquals(2, newTransitions.size)
            assertEquals(listOf("pause", "resume"), newTransitions.map { it.action })
            assertEquals(listOf(newTransitions.first().id), newTransitions.last().replaces)
            proof.put("retainedLifecyclePrefixCount", historyBeforePause.size)
                .put("newLifecycleTransitions", JSONArray(newTransitions.map { it.action }))
            proof.put("completed", true)
        } catch (failure: Throwable) {
            observedFailure = failure
            proof.put("failure", failure.javaClass.simpleName + ": " + failure.message)
            runCatching {
                val value = fresh()
                proof.put("storedStatus", value.habits.firstOrNull { it.id == id }?.let { HabitLifecycle.state(it).status })
                    .put("storedCycleId", value.habits.firstOrNull { it.id == id }?.stoicheionRestoration?.cycleId)
                    .put("completionCount", value.completions.count { it.habitId == id && it.completed })
                captureNativeWindow(File(app.getExternalFilesDir(null), "restoration-lifecycle313-failure.png"))
            }.exceptionOrNull()?.let(failure::addSuppressed)
            throw failure
        } finally {
            val cleanupFailure = runCatching {
                compose.runOnIdle { page = "done" }
                compose.waitForIdle()
                runBlocking {
                    check(app.workspaceScope == scope)
                    if (original == null) dao.deleteDocument(scope, "habits") else dao.putDocument(original)
                    app.scheduler.restoreHabitNotifications()
                    assertEquals(original, dao.document(scope, "habits"))
                }
            }.exceptionOrNull()
            proof.put("cleanupRestoredExactDocument", cleanupFailure == null)
            cleanupFailure?.let { proof.put("cleanupFailure", it.javaClass.simpleName + ": " + it.message) }
            File(app.getExternalFilesDir(null), "restoration-lifecycle313-proof.json").writeText(proof.toString(2))
            cleanupFailure?.let { observedFailure?.addSuppressed(it) ?: throw it }
        }
    }
}
