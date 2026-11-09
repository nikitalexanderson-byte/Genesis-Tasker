package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.LocalPreferences
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import java.time.LocalDate
import java.util.UUID

/** The actual Today action, task editor, picker and encrypted repository; only UUID-owned QA tasks. */
class TodayTaskDate314Test {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()

    @Test fun choosingFebruary2027FromTodayKeepsTheEditorAliveAndSavesTheCivilDate() =
        verifyDate("Сегодня", listOf(CalendarMode.PROFANE, CalendarMode.SACRED, CalendarMode.LUNAR))

    @Test fun choosingFebruary2027FromPersonalAffairsKeepsTheEditorAliveAndSavesTheCivilDate() =
        verifyDate("Проекты", listOf(CalendarMode.PROFANE))

    private fun verifyDate(route: String, modes: List<CalendarMode>) {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && !app.workspaceScope.startsWith("account-"))
        val preferences = LocalPreferences(app, app.workspaceScope)
        val original = runBlocking { preferences.values.first() }
        val ownedIds = mutableListOf<String>()
        val calendar = GenesisCalendar()
        val today = LocalDate.now()
        val target = LocalDate.of(2027, 2, 28)
        check(today < target && today.year == 2026)
        try {
            android.util.Log.i("Date314", "set language")
            runBlocking { preferences.set("language", "ru") }
            for (mode in modes) {
                android.util.Log.i("Date314", "set input $mode")
                runBlocking { preferences.set("input", mode.wireValue) }
                compose.waitUntil(15_000) { compose.onAllNodesWithTag("workspace-menu").fetchSemanticsNodes().isNotEmpty() }
                android.util.Log.i("Date314", "open Today $mode")
                compose.onNodeWithTag("workspace-menu").performClick()
                compose.onNodeWithTag("drawer-$route-root").performScrollTo().performClick()
                android.util.Log.i("Date314", "create task $mode")
                if (route == "Проекты") {
                    compose.onNodeWithTag("personal-actions").performClick()
                    compose.onNodeWithTag("personal-create-task").performClick()
                } else compose.onNodeWithTag("create-task").performScrollTo().performClick()
                val title = "QA314-February-${UUID.randomUUID()}"
                compose.onNodeWithTag("task-title").performTextReplacement(title)
                // The editor owns a dialog window. Hiding the activity's IME can
                // leave the dialog keyboard moving over the next touch on realme.
                androidx.test.espresso.Espresso.closeSoftKeyboard()
                compose.waitForIdle()
                val details=compose.onNodeWithTag("task-options-toggle").performScrollTo()
                if(details.fetchSemanticsNode().config[androidx.compose.ui.semantics.SemanticsProperties.StateDescription]!="Развернуто")details.performClick()
                details.assert(SemanticsMatcher.expectValue(androidx.compose.ui.semantics.SemanticsProperties.StateDescription,"Развернуто"))
                compose.onNodeWithTag("task-form-calendar-${mode.wireValue}").performScrollTo().assertIsSelected()
                android.util.Log.i("Date314", "open date picker $mode")
                compose.onNode(hasText(calendar.formatDate(today, mode)) and hasClickAction()).performScrollTo().performClick()
                var shown = today
                var turns = 0
                while (target !in calendar.monthRange(shown, mode).let { it.start..it.end }) {
                    check(turns++ < 12)
                    android.util.Log.i("Date314", "next period $mode $shown")
                    compose.onNodeWithText("→").performScrollTo().performClick()
                    shown = calendar.monthRange(shown, mode).end.plusDays(1)
                }
                android.util.Log.i("Date314", "choose $mode $target")
                compose.onNodeWithContentDescription(calendar.formatDate(target, mode)).performScrollTo().performClick()
                compose.onNodeWithTag("author-date-close").assertDoesNotExist()
                compose.onNodeWithTag("task-title").assertExists()
                compose.onNode(hasText(calendar.formatDate(target, mode)) and hasClickAction()).assertExists()
                androidx.test.espresso.Espresso.closeSoftKeyboard()
                compose.waitForIdle()
                compose.onNodeWithTag("save-task").assertIsDisplayed().assertIsEnabled().performClick()
                android.util.Log.i("Date314", "save $mode $target")
                compose.waitUntil(15_000) {
                    runBlocking { app.repository.tasks.first().firstOrNull { it.title == title } }?.also {
                        if (it.id !in ownedIds) ownedIds += it.id
                    } != null
                }
                val saved = runBlocking { app.repository.tasks.first().first { it.title == title } }
                assertEquals(target.toString(), saved.date)
            }
        } finally {
            runBlocking {
                ownedIds.forEach { app.repository.delete(it) }
                preferences.set("input", original.input.wireValue)
                preferences.set("language", original.language)
            }
        }
    }
}
