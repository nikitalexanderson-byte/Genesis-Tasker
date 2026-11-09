package ru.genesis.calendar

import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.Density
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.ui.*

class UnifiedPersonalAffairsTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private var clearFieldFocus: () -> Unit = {}

    private fun hideKeyboardForCapture() {
        compose.runOnIdle {
            clearFieldFocus()
            val activity = compose.activity
            val input = activity.getSystemService(android.content.Context.INPUT_METHOD_SERVICE)
                as android.view.inputmethod.InputMethodManager
            input.hideSoftInputFromWindow(activity.window.decorView.windowToken, 0)
        }
        if (android.os.Build.VERSION.SDK_INT >= 30) compose.waitUntil(5_000) {
            compose.activity.window.decorView.rootWindowInsets
                ?.isVisible(android.view.WindowInsets.Type.ime()) != true
        }
        // The platform IME animation continues after its target visibility changes.
        // It is driven by wall time, outside Compose's test clock.
        android.os.SystemClock.sleep(500)
        compose.waitForIdle()
    }

    @Test fun requiredUpdateCannotBeDismissedWithLaterOrBack() {
        var dismissed = false
        compose.setContent { MaterialTheme(colorScheme = standart) {
            AndroidUpdateDialog(compose.activity, AndroidRelease(77, "2.7.1", "a".repeat(64), required = true)) {
                dismissed = true
            }
        } }
        compose.onNodeWithTag("android-update-dialog").assertExists()
        compose.onNodeWithText("Позже").assertDoesNotExist()
        androidx.test.uiautomator.UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.waitForIdle()
        compose.onNodeWithTag("android-update-dialog").assertExists()
        assertFalse(dismissed)
    }

    @Test fun chaosListsExpandInPlaceAndCreateInTheOriginalAccount() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        val list = GoogleTaskList("qa-unified-list", "План чтения", "qa-google", "qa@example.invalid")
        val listed = LocalTask("qa-listed-task", "Прочитать главу", date = LocalDate.now().toString(),
            sourceFieldsJson = listTaskFields(list, CalendarMode.LUNAR).toString())
        val loose = LocalTask("qa-loose-task", "Записать идею", date = LocalDate.now().toString())
        val dark = InstrumentationRegistry.getArguments().getString("genesisEvening") == "true"
        val width = InstrumentationRegistry.getArguments().getString("genesisWidth")?.toIntOrNull() ?: 390
        var selectedList: GoogleTaskList? = null
        var requestedTaskProject: String? = "unset"
        var listRequested = false
        var openedTask: String? = null
        compose.setContent {
            val focus = LocalFocusManager.current
            SideEffect { clearFieldFocus = { focus.clearFocus(force = true) } }
            val density = Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width,
                LocalDensity.current.fontScale)
            CompositionLocalProvider(LocalEveningTheme provides dark, LocalDensity provides density) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                        ProjectsScreen(app, listOf(listed, loose), true,
                            onOpenTask = { openedTask = it }, onCreateTask = { requestedTaskProject = it },
                            taskLists = listOf(list), onCreateList = { listRequested = true },
                            onCreateListTask = { selectedList = it })
                    }
                }
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("projects-screen").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("personal-create-task").assertDoesNotExist()
        compose.onNodeWithTag("personal-actions").performClick()
        val createTaskTop = compose.onNodeWithTag("personal-create-task").fetchSemanticsNode().boundsInRoot.top
        val createListTop = compose.onNodeWithTag("personal-create-list").fetchSemanticsNode().boundsInRoot.top
        val createProjectTop = compose.onNodeWithTag("create-project").fetchSemanticsNode().boundsInRoot.top
        assertTrue(createTaskTop < createListTop && createListTop < createProjectTop)
        compose.onNodeWithTag("personal-create-task").performClick()
        assertNull(requestedTaskProject)
        compose.onNodeWithTag("personal-actions").performClick()
        compose.onNodeWithTag("personal-create-list").performClick()
        assertTrue(listRequested)
        val screen = compose.onNodeWithTag("projects-screen")
        screen.performScrollToNode(hasTestTag("personal-task-list-${list.id}"))
        compose.onNodeWithTag("personal-task-list-${list.id}")
            .assert(hasAnyAncestor(hasTestTag("project-inbox")))
        compose.onNodeWithTag("task-${listed.id}").assertDoesNotExist()
        compose.onNodeWithTag("toggle-task-list-${list.id}").performClick()
        compose.onAllNodesWithText(listed.title).assertCountEquals(1)
        compose.onNodeWithTag("task-${listed.id}").assertExists()
        compose.onNodeWithTag("add-list-task-${list.id}").performScrollTo().performClick()
        assertEquals(list, selectedList)
        compose.onNodeWithTag("task-title-${listed.id}", useUnmergedTree = true).performScrollTo().performClick()
        assertEquals(listed.id, openedTask)
        screen.performScrollToIndex(0)
        compose.onNodeWithTag("personal-task-search").performTextInput("План чтения")
        compose.onNodeWithTag("task-${listed.id}").assertExists()
        compose.onNodeWithTag("task-${loose.id}").assertDoesNotExist()
        compose.onNodeWithContentDescription("Очистить поиск").performClick()
        screen.performScrollToNode(hasTestTag("personal-task-list-${list.id}"))
        compose.onNodeWithTag("task-${listed.id}").assertExists()
        compose.onNodeWithTag("add-list-task-${list.id}").performScrollTo().performClick()
        assertEquals(list, selectedList)
        screen.performScrollToIndex(0)
        hideKeyboardForCapture()
        val label = InstrumentationRegistry.getArguments().getString("qaLabel") ?: "phone"
        File(app.getExternalFilesDir(null), "android-270-$label-${if (dark) "dark" else "light"}-chaos-list.png")
            .outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }

    @Test fun personalSearchOpensCompletesAndClearsWithoutChangingTheTaskOrigin() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug"))
        app.activateAccount(null)
        val args = InstrumentationRegistry.getArguments()
        val dark = args.getString("genesisEvening") == "true"
        val width = args.getString("genesisWidth")?.toIntOrNull() ?: 390
        val scale = args.getString("genesisFontScale")?.toFloatOrNull() ?: 1f
        val target = LocalTask("qa-search-a", "Подготовить материалы для встречи с редакцией",
            description = "Собрать черновики обзора", date = LocalDate.now().toString())
        val unrelated = LocalTask("qa-search-b", "Записать идею", date = LocalDate.now().toString())
        var opened: String? = null
        var completed: LocalTask? = null
        compose.setContent {
            val focus = LocalFocusManager.current
            SideEffect { clearFieldFocus = { focus.clearFocus(force = true) } }
            var rows by remember { mutableStateOf(listOf(target, unrelated)) }
            CompositionLocalProvider(LocalEveningTheme provides dark,
                LocalDensity provides Density(compose.activity.resources.displayMetrics.widthPixels.toFloat() / width, scale)) {
                MaterialTheme(colorScheme = if (dark) evening else standart) {
                    Surface(Modifier.fillMaxSize().safeDrawingPadding()) {
                        ProjectsScreen(app, rows, true, onOpenTask = { opened = it }, onCreateTask = {},
                            onCompleteTask = { task -> completed = task; rows = rows.map {
                                if (it.id == task.id) it.copy(done = !it.done) else it
                            } })
                    }
                }
            }
        }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("projects-screen").fetchSemanticsNodes().isNotEmpty() }
        val search = compose.onNodeWithTag("personal-task-search")
        search.performTextInput("черновики")
        compose.onNodeWithTag("task-${target.id}").assertExists()
        compose.onNodeWithTag("task-${unrelated.id}").assertDoesNotExist()
        compose.onNodeWithTag("task-title-${target.id}", useUnmergedTree = true).performScrollTo().performClick()
        assertEquals(target.id, opened)
        compose.onNode(isToggleable() and hasAnyAncestor(hasTestTag("task-${target.id}")))
            .performScrollTo().performClick().assertIsOn()
        assertEquals(target, completed)
        compose.onNodeWithTag("projects-screen").performScrollToIndex(0)
        search.performTextReplacement("Нет такой задачи")
        compose.onNodeWithTag("personal-search-empty").assertExists()
        compose.onNodeWithContentDescription("Очистить поиск").performClick()
        compose.onNodeWithTag("project-inbox").assertExists()
        search.performTextInput("редакцией")
        compose.onNodeWithTag("task-${target.id}").assertExists()
        hideKeyboardForCapture()
        val label = args.getString("qaLabel") ?: "phone"
        File(app.getExternalFilesDir(null), "ui290-personal-search-$label-${if (dark) "dark" else "light"}.png")
            .outputStream().use { compose.onRoot().captureToImage().asAndroidBitmap()
                .compress(android.graphics.Bitmap.CompressFormat.PNG, 100, it) }
    }
}
