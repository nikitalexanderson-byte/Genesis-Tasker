package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import org.junit.Rule
import org.junit.Test
import org.junit.Before
import androidx.test.uiautomator.UiDevice
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.semantics.SemanticsActions
import androidx.compose.ui.semantics.SemanticsProperties
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import java.util.UUID
import ru.genesis.calendar.ui.dismissValidationKeyboard

class NativeUiTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    @Before fun requireIsolatedDebug() {
        check(BuildConfig.DEBUG && compose.activity.packageName.endsWith(".debug"))
        compose.runOnUiThread { compose.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    }
    private fun selectHabitCalendar(tag: String) {
        val viewport = compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
            and hasAnyDescendant(hasTestTag(tag)))
        viewport.performScrollToNode(hasTestTag(tag))
        val chip = compose.onNodeWithTag(tag)
        chip.performScrollTo() // Reveal the option in its independent horizontal row.
        val bounds = chip.getUnclippedBoundsInRoot()
        val frame = viewport.getUnclippedBoundsInRoot()
        val delta = when {
            bounds.bottom > frame.bottom -> (bounds.bottom - frame.bottom).value
            bounds.top < frame.top -> (bounds.top - frame.top).value
            else -> 0f
        }
        if (delta != 0f) viewport.performSemanticsAction(SemanticsActions.ScrollBy) {
            it(0f, delta * compose.activity.resources.displayMetrics.density)
        }
        chip.assertIsDisplayed().performClick()
        compose.waitUntil(5_000) { runCatching { chip.assertIsSelected() }.isSuccess }
    }
    @Test fun nativeTaskFormPersistsEntry() {
        val title = "UI synthetic validation ${UUID.randomUUID()}"
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        compose.runOnUiThread { compose.activity.window.addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
        compose.scrollToTodayNode(hasTestTag("create-task"))
        compose.onNodeWithTag("create-task").performClick()
        compose.onNodeWithTag("task-title").performTextInput(title)
        compose.onNodeWithTag("task-title").assertTextContains(title)
        compose.dismissValidationKeyboard()
        compose.onNodeWithTag("save-task").assertIsDisplayed().assertIsEnabled().performClick()
        compose.waitUntil(10_000) {
            runBlocking { app.repository.tasks.first().any { it.title == title } }
        }
        compose.scrollToTodayNode(hasText(title))
        compose.onNodeWithText(title).assertIsDisplayed()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(compose.activity.getExternalFilesDir(null),"native-ui-validation.png"))
    }

    @Test fun nativeHabitFormPersistsEntry() {
        val title = "UI synthetic habit ${UUID.randomUUID()}"
        compose.openWorkspacePage("Привычки", "Привычки")
        compose.onNodeWithTag("habit-create").assertIsEnabled().performClick()
        compose.onAllNodes(hasSetTextAction()).onFirst().performTextInput(title)
        compose.onNodeWithTag("habit-emoji-picker-open").performScrollTo().performClick()
        compose.onNodeWithText("Животные и природа").performScrollTo().performClick()
        compose.onNodeWithTag("habit-emoji-choice-🦋").performScrollTo().performClick()
        compose.onNodeWithTag("habit-emoji").assertTextContains("🦋")
        compose.onNodeWithText("Сохранить").performScrollTo().performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodesWithText(title,substring=true).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onAllNodesWithText(title,substring=true).onFirst().assertExists()
    }

    @Test fun nativeMoodFormPersistsSelection() {
        compose.openWorkspacePage("Привычки", "Сон и настроение")
        val label=ru.genesis.calendar.domain.trackers.MoodTracker.option(1.0).label
        compose.onNode(hasText("Выбрать настроение") or hasText("Изменить настроение")).performScrollTo().performClick()
        compose.onNode(hasText(label,substring=true) and hasClickAction()).performScrollTo().performClick()
        compose.onNodeWithText("Сохранить").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Изменить настроение").fetchSemanticsNodes().isNotEmpty() }
        // The selected mood is shown in both the summary metric and its detail card.
        compose.onAllNodesWithText(label,substring=true).onFirst().assertExists()
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        compose.waitUntil(10_000) {
            runBlocking { ru.genesis.calendar.data.TrackersRepository(app).workspace.first()
                .moodEntries.any { it.date == java.time.LocalDate.now() && it.moodValue == 1 } }
        }
    }

    @Test fun customMoodNameAndEmojiCanBePickedOnDevice() {
        compose.openWorkspacePage("Привычки", "Сон и настроение")
        compose.onNode(hasText("Выбрать настроение") or hasText("Изменить настроение")).performScrollTo().performClick()
        compose.onNodeWithTag("custom-mood-choice").performScrollTo().performClick()
        compose.onNodeWithTag("custom-mood-label").performTextClearance()
        compose.onNodeWithTag("custom-mood-label").performTextInput("Вдохновение")
        compose.onNodeWithTag("mood-emoji-😌").performScrollTo().performClick()
        compose.dismissValidationKeyboard()
        compose.onNodeWithText("Сохранить").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("custom-mood-choice").fetchSemanticsNodes().isEmpty() }
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        compose.waitUntil(10_000) {
            runBlocking { ru.genesis.calendar.data.TrackersRepository(app).workspace.first()
                .moodEntries.any { it.customLabel == "Вдохновение" && it.customEmoji == "😌" } }
        }
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(app.getExternalFilesDir(null),"mood-custom-2.6.2.png"))
    }

    @Test fun monthReturnTodayButtonKeepsCalendarMonthOpen() {
        compose.openWorkspacePage("Календарь")
        compose.onNodeWithTag("calendar-month-next").performScrollTo().performClick()
        compose.onNodeWithTag("calendar-month-today").performScrollTo().performClick()
        compose.onNodeWithTag("calendar-month").assertExists()
        compose.onNodeWithTag("calendar-view-switch").assertExists()
        // The return action disappears once the current month is reached.
        compose.onNodeWithTag("calendar-month-today").assertDoesNotExist()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(compose.activity.getExternalFilesDir(null),"calendar-month-today-2.6.0.png"))
    }

    @Test fun lunarHabitEditorShowsNewCadencesAndFramedFields() {
        compose.openWorkspacePage("Привычки", "Привычки")
        compose.onNodeWithTag("habit-create").assertIsDisplayed().performClick()
        compose.onNodeWithText("Календарь и срок").assertExists()
        compose.onNodeWithText("Повторение").assertExists()
        selectHabitCalendar("habit-calendar-lunar")
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "full-qa-lunar-habit-choice.png"))
        compose.waitUntil(5_000) { runCatching { compose.onNodeWithTag("habit-calendar-lunar").assertIsSelected() }.isSuccess }
        compose.onNodeWithText("Повторение по лунному календарю").assertExists()
        selectHabitCalendar("habit-lunar-cadence-lunar-phases")
        // The cadence row is now at the viewport edge; reveal its phase controls.
        compose.onNode(SemanticsMatcher.keyIsDefined(SemanticsProperties.VerticalScrollAxisRange)
            and hasAnyDescendant(hasTestTag("habit-lunar-cadence-lunar-phases")))
            .performSemanticsAction(SemanticsActions.ScrollBy) {
                it(0f, 220f * compose.activity.resources.displayMetrics.density)
            }
        compose.onNodeWithText("Полнолуние").performScrollTo().assertIsDisplayed().performClick()
        compose.onNodeWithText("Полнолуние").assertIsSelected()
        captureNativeWindow(File(compose.activity.getExternalFilesDir(null), "full-qa-lunar-phase-choice.png"))
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).takeScreenshot(
            File(compose.activity.getExternalFilesDir(null),"habit-lunar-editor-2.6.0.png"))
    }

    @Test fun prioritySupportsImmediateHorizontalDragAndTap() {
        compose.scrollToTodayNode(hasTestTag("create-task"))
        compose.onNodeWithTag("create-task").performClick()
        compose.onNodeWithTag("priority-scale").performScrollTo().performTouchInput {
            down(Offset(center.x * .24f, center.y))
            advanceEventTime(30)
            moveTo(Offset(center.x * 1.82f, center.y))
            advanceEventTime(50)
            up()
        }
        compose.onNodeWithText("Приоритет · Горит · 10 из 10").assertExists()
        compose.onNodeWithTag("priority-scale").performTouchInput {
            click(Offset(center.x * .24f, center.y))
        }
        compose.onNodeWithText("Приоритет · Низкий · 2 из 10").assertExists()
        compose.onNodeWithText("Отмена").assertIsDisplayed().performClick()
    }

    @Test fun accountSettingsAlwaysShowThreeExternalLinks() {
        compose.openWorkspacePage("Настройки", "links")
        compose.onNodeWithTag("account-link-telegram").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("account-link-donate").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("account-link-web").performScrollTo().assertIsDisplayed()
    }

    @Test fun settingsExposeWebsiteHabitControlsAsSeparateCards() {
        compose.openWorkspacePage("Настройки", "habits")
        compose.onNodeWithTag("habit-tracking-settings").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("habit-notification-settings").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("habit-feedback-settings").performScrollTo().assertIsDisplayed()
    }

    @Test fun weekStartSettingAppearsOnlyForGregorianDisplayAndPersists() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = ru.genesis.calendar.data.LocalPreferences(app, app.workspaceScope)
        val initial = runBlocking { preferences.values.first() }
        try {
            runBlocking { preferences.set("display", "sacred") }
            compose.openWorkspacePage("Настройки", "appearance")
            compose.onNodeWithTag("gregorian-week-start-setting").assertDoesNotExist()
            runBlocking { preferences.set("display", "profane") }
            compose.waitUntil(5_000) {
                compose.onAllNodesWithTag("gregorian-week-start-setting").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("gregorian-week-start-setting").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("week-start-monday").performClick()
            compose.waitUntil(5_000) { !runBlocking { preferences.values.first().weekStartsOnSunday } }
            compose.onNodeWithTag("week-start-monday").assertIsSelected()
        } finally {
            runBlocking {
                preferences.set("display", initial.display.wireValue)
                preferences.set("weekStart", if (initial.weekStartsOnSunday) "sunday" else "monday")
            }
        }
    }

    @Test fun detailsOnlyContainSacredKnowledgeInSacredMode() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = ru.genesis.calendar.data.LocalPreferences(app, app.workspaceScope)
        val initial = runBlocking { preferences.values.first().display }
        try {
            runBlocking { preferences.set("display", "sacred") }
            compose.openWorkspacePage("Сегодня")
            compose.scrollToTodayNode(hasTestTag("today-day-details"))
            compose.scrollToTodayNode(hasTestTag("three-rhythms-content"))
            compose.onAllNodesWithTag("three-rhythms-content").assertCountEquals(1)
            compose.onAllNodesWithTag("sacred-calendar-card").assertCountEquals(0)
            compose.onAllNodesWithTag("gregorian-calendar-card").assertCountEquals(0)
            compose.onAllNodesWithTag("lunar-calendar-card").assertCountEquals(0)
            runBlocking { preferences.set("display", "profane") }
            compose.waitUntil(5_000) { compose.onAllNodesWithTag("today-day-details").fetchSemanticsNodes().isEmpty() }
        } finally { runBlocking { preferences.set("display", initial.wireValue) } }
    }

    @Test fun settingsLanguageSwitchesWithoutLeavingWorkspace() {
        val app = InstrumentationRegistry.getInstrumentation().targetContext.applicationContext as GenesisApplication
        val preferences = ru.genesis.calendar.data.LocalPreferences(app, app.workspaceScope)
        val initial = runBlocking { preferences.values.first().language }
        try {
            runBlocking { preferences.set("language", "ru") }
            compose.openWorkspacePage("Настройки", "appearance")
            compose.onNodeWithTag("appearance-language-toggle").performScrollTo().performClick()
            compose.onNodeWithTag("language-en").performScrollTo().performClick()
            compose.waitUntil(5_000) { runBlocking { preferences.values.first().language == "en" } }
            compose.onNodeWithTag("appearance-language-toggle").assertTextContains("Hide languages")
            compose.onNodeWithTag("workspace-title").assertExists()
            compose.onNodeWithTag("language-ru").performScrollTo().performClick()
            compose.waitUntil(5_000) { runBlocking { preferences.values.first().language == "ru" } }
            compose.onNodeWithTag("appearance-language-toggle").assertTextContains("Свернуть выбор языка")
            compose.onNodeWithTag("workspace-title").assertExists()
        } finally {
            runBlocking { preferences.set("language", initial) }
        }
    }
}
