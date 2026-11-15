package ru.genesis.calendar

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.test.platform.app.InstrumentationRegistry
import java.io.File
import java.time.LocalDate
import java.time.LocalTime
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.CalendarMode
import ru.genesis.calendar.domain.GenesisCalendar
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.domain.trackers.*
import ru.genesis.calendar.ui.dailySleepSchedule
import ru.genesis.calendar.auth.*
import kotlinx.coroutines.flow.MutableStateFlow
import org.json.JSONObject

/** Actual application shell and repositories; exclusively synthetic data in the 3.3.3 QA app. */
class StoreListing333CaptureTest {
    @get:Rule val compose = createAndroidComposeRule<TestWorkspaceActivity>()
    private val app get() = compose.activity.application as GenesisApplication
    private fun await(tag: String) = compose.waitUntil(15_000) {
        compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
    }
    private fun open(page: String, section: String? = null) {
        compose.onNodeWithTag("workspace-menu").performClick()
        val suffix = if (page in listOf("Календарь", "Сакральное", "Проекты")) "root" else section ?: "root"
        compose.onNodeWithTag("drawer-$page-$suffix").performScrollTo().performClick()
        compose.waitUntil(5_000) { !compose.onNodeWithTag("workspace-drawer").isDisplayed() }
        if (page in listOf("Календарь", "Сакральное") && section != null)
            compose.onNodeWithTag("submenu-$section").performClick()
    }

    @Test fun capturePlannerScreensWithSyntheticData() = runBlocking {
        check(BuildConfig.DEBUG && app.packageName == "ru.genesis.calendar.debug" && app.workspaceScope == "internal-validation-v1")
        val args = InstrumentationRegistry.getArguments()
        val language = args.getString("genesisStoreLanguage", "ru")
        require(language in setOf("ru", "en"))
        val english = language == "en"
        fun copy(ru: String, en: String) = if (english) en else ru
        val auth=AuthController.get(app)
        val field=AuthController::class.java.getDeclaredField("mutableState").apply {isAccessible=true}
        @Suppress("UNCHECKED_CAST") val authState=field.get(auth) as MutableStateFlow<AuthPanelState>
        val originalAuth=authState.value
        val settings=AccountSettings(emptyList(),SyncRouting("fixed",emptyList(),emptyMap()),false,
            "standart",1,"profane","profane","24",true,language,uiVisibility=UiVisibility(sacredFeaturesEnabled=false))
        authState.value=AuthPanelState(ready=true,accountSettings=settings)
        val prefs = LocalPreferences(app, app.workspaceScope)
        val original = prefs.values.first()
        val dao = app.database.dao()
        val originalTaskRows = dao.accountTasks(app.workspaceScope)
        val kinds = listOf("habits", "trackers", "stoicheion-draws", "structure")
        val documents = kinds.associateWith { dao.document(app.workspaceScope, it) }
        val documentOutboxIds = setOf("habits", "trackers", "stoicheion-draws", "workspace-structure")
        val documentOutbox = dao.outbox(app.workspaceScope).filter { it.entityId in documentOutboxIds }
        val token = "store333-${UUID.randomUUID()}"
        val project = "$token-project"
        val ownedTasks = listOf("$token-read", "$token-plan", "$token-walk")
        val folder = File(app.getExternalFilesDir(null), "store-333-$language").apply { mkdirs() }
        fun capture(name: String) {
            compose.waitForIdle()
            val target = File(folder, "tasker-333-$name.png")
            captureNativeWindow(target)
            val bitmap = android.graphics.BitmapFactory.decodeFile(target.absolutePath)
            try {
                assertTrue(bitmap.width in 320..3840 && bitmap.height in 320..3840)
                assertTrue(target.length() < 8 * 1024 * 1024)
            } finally { bitmap.recycle() }
        }
        try {
            // Only the QA documents are temporarily replaced. Their exact encrypted rows are restored below.
            kinds.forEach { dao.deleteDocument(app.workspaceScope, it) }
            originalTaskRows.forEach { dao.putTask(it.copy(deleted = true)) }
            prefs.set("language", language); prefs.set("theme", "standart")
            prefs.set("display", "profane"); prefs.set("input", "profane")
            prefs.set("settingsSubmenuEnabled", "true")
            prefs.set("stoicheionDivinationDisabled", "false")
            val date = LocalDate.now()
            val structure = WorkspaceStructureRepository(app)
            structure.saveProject(GenesisProject(project, null, null, copy("Личные планы", "Personal plans"), "", emptyList(), "active", 0))
            app.repository.save(LocalTask(ownedTasks[0], copy("Прочитать 10 страниц", "Read 10 pages"), date = date.toString(), projectId = project))
            app.repository.save(LocalTask(ownedTasks[1], copy("Подготовить план недели", "Plan the week"), date = date.toString(), projectId = project))
            app.repository.save(LocalTask(ownedTasks[2], copy("Прогулка 20 минут", "Walk for 20 minutes"), date = date.toString(), projectId = project))
            val habits = HabitsRepository(app)
            val initialHabits = habits.workspace.first()
            habits.updateSettings(initialHabits.settings.copy(enabled = true))
            suspend fun setCaptureTheme(dark: Boolean) {
                val current = habits.workspace.first().settings
                val raw = org.json.JSONObject(current.rawJson)
                val appearance = raw.optJSONObject("nativeAppearance") ?: org.json.JSONObject()
                raw.put("nativeAppearance", appearance.put("mode", if (dark) "evening" else "light"))
                habits.updateSettings(current.copy(rawJson = raw.toString()))
                prefs.set("theme", if (dark) "standart-dark" else "standart")
                val tag = if (dark) "app-theme-Evening" else "app-theme-Standart"
                compose.waitUntil(10_000) { compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty() }
                compose.onNodeWithTag(tag).assertIsDisplayed()
            }
            // A saved automatic schedule overrides the account colour preference.
            // Set the real appearance mode and assert it before taking store assets.
            setCaptureTheme(false)
            habits.save(Habit(TrackerEntity.create("habit", id = "$token-habit"), copy("Читать каждый день", "Read every day"),
                date, HabitEngine(GenesisCalendar()).defaultSchedule(date, CalendarMode.PROFANE),
                emoji = "📖", timerEnabled = true))
            habits.save(Habit(TrackerEntity.create("habit", id = "$token-water"),copy("Пить воду", "Drink water"),
                date,HabitEngine(GenesisCalendar()).defaultSchedule(date,CalendarMode.PROFANE),emoji="💧"))
            val trackers = TrackersRepository(app)
            val schedule = dailySleepSchedule(date.minusDays(7), CalendarMode.PROFANE)
            trackers.savePlan(SleepPlan(TrackerEntity.create("sleep-plan", id = "$token-sleep"), schedule,
                copy("Спокойный сон", "Restful sleep")))
            trackers.saveSleep("$token-sleep", date, LocalTime.of(23, 0), LocalTime.of(7, 0), 8.0, "", 0)
            trackers.saveAddiction(AddictionTracker(TrackerEntity.create("addiction", id = "$token-abstinence"), schedule,
                copy("Меньше сахара", "Less sugar")))
            await("workspace-menu")
            open("Сегодня"); await("today-list"); Thread.sleep(1000); capture("today")
            compose.onNodeWithTag("task-${ownedTasks[0]}").performScrollTo().performClick()
            await("task-editor-scroll")
            compose.onNodeWithTag("task-options-toggle").performScrollTo().performClick()
            compose.onNodeWithTag("custom-reminder-toggle").performScrollTo()
            capture("reminders")
            compose.onNodeWithTag("close-task-editor").performClick()
            open("Проекты"); await("projects-screen"); capture("projects")
            open("Календарь", "month"); await("calendar-month"); capture("calendar-month")
            compose.onNodeWithTag("submenu-year").performClick(); await("calendar-year")
            // OriginalImage adds its image semantics only after the bundled bitmap has decoded.
            // Compose being idle alone does not wait for that IO work.
            for (month in listOf("01", "02")) {
                val art = hasAnyAncestor(hasTestTag("gregorian-year-art-${date.year}-$month-01")) and
                    SemanticsMatcher.keyIsDefined(SemanticsProperties.ContentDescription)
                compose.waitUntil(15_000) {
                    compose.onAllNodes(art, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
                }
            }
            capture("calendar-year")
            open("Привычки", "Привычки"); await("habit-view-today")
            setCaptureTheme(true)
            compose.waitForIdle(); capture("habits-dark")
            setCaptureTheme(false)
            open("Привычки", "Сон и настроение"); await("sleep-plan-header"); capture("sleep")
        } finally {
            authState.value=originalAuth
            ownedTasks.forEach { id ->
                app.repository.delete(id)
                dao.deleteTaskReminders(app.workspaceScope, id)
                dao.outbox(app.workspaceScope).filter { it.entityId == id }.forEach {
                    dao.acknowledgeOutbox(app.workspaceScope, it.entityId, it.revision, it.operationId)
                }
                dao.deleteCachedTask(app.workspaceScope, id)
            }
            originalTaskRows.forEach { dao.putTask(it) }
            documents.forEach { (kind, row) -> if (row == null) dao.deleteDocument(app.workspaceScope, kind) else dao.putDocument(row) }
            dao.outbox(app.workspaceScope).filter { it.entityId in documentOutboxIds }.forEach {
                dao.acknowledgeOutbox(app.workspaceScope, it.entityId, it.revision, it.operationId)
            }
            documentOutbox.forEach { dao.putOutbox(it) }
            prefs.set("language", original.language); prefs.set("theme", original.theme ?: "")
            prefs.set("display", original.display.wireValue); prefs.set("input", original.input.wireValue)
            prefs.set("settingsSubmenuEnabled", original.settingsSubmenuEnabled.toString())
            prefs.set("stoicheionDivinationDisabled", original.divinationDisabled.toString())
            app.scheduler.restoreHabitNotifications()
            ru.genesis.calendar.reminders.SleepReminderScheduler.restore(app)
        }
    }
}
