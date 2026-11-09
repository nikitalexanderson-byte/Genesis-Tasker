package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.time.Instant
import java.time.LocalDate
import java.util.UUID
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.Assert.*
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

class HabitLifecycleFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private lateinit var app: GenesisApplication
    private lateinit var repository: HabitsRepository
    private lateinit var localScope: String
    private var original: DocumentRecord? = null

    @Before fun setup() {
        app=compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope=="internal-validation-v1")
        localScope=app.workspaceScope; repository=HabitsRepository(app)
        original=runBlocking { app.database.dao().document(localScope,"habits") }
    }
    @After fun cleanup() {
        app.activateAccount(null)
        runBlocking { app.database.withTransaction {
            original?.let { app.database.dao().putDocument(it) } ?: app.database.dao().deleteDocument(localScope,"habits")
        } }
    }
    private fun read()=runBlocking { repository.workspace.first() }
    private fun write(workspace: LocalHabitWorkspace, scope: String=localScope) = runBlocking {
        app.database.withTransaction { app.database.dao().putDocument(DocumentRecord(scope,"habits",
            LocalCipher().encrypt(HabitDocument.encode(workspace),"$scope/habits"),1)) }
    }
    private fun fixture(days: Int): Habit {
        val today=LocalDate.now();val at=Instant.now().minusSeconds(120).toString()
        val habit=Habit(TrackerEntity("e4-ui-${UUID.randomUUID()}",at,at),"Сохранённая практика · $days",
            today.minusDays(70),HabitEngine(GenesisCalendar()).defaultSchedule(today.minusDays(70),CalendarMode.PROFANE))
        val entries=(1..days).map { index -> HabitCompletion(TrackerEntity("${habit.id}:day:$index",at,at),
            habit.id,today.minusDays(index.toLong()),completed=true,score=10) }
        write(LocalHabitWorkspace(habits=listOf(habit),completions=entries,
            rewards=listOf(Rewards.create(25.0,"comeback","seed","${habit.id}:seed",at)),progress=UserProgress(lifetimeXp=200,laurelsBalance=25),
            settings=HabitSettings(feedback=HabitFeedbackSettings(animations=false,achievementPopups=false,questsEnabled=false,gamificationWidgets=false))))
        return habit
    }
    private fun render(habit: Habit) {
        compose.setContent {
            CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalEveningTheme provides false) {
                MaterialTheme(colorScheme=standart) { Surface(Modifier.fillMaxSize()) {
                    Column(Modifier.safeDrawingPadding()) { HabitsScreen(app,true,CalendarMode.PROFANE,CalendarMode.PROFANE) }
                } }
            }
        }
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("habit-view-library").fetchSemanticsNodes().isNotEmpty() && read().revision>=2 }
        compose.onNodeWithTag("habit-view-library").performScrollTo().performClick().assertIsSelected()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("habit-actions-${habit.id}").fetchSemanticsNodes().isNotEmpty() }
        check(app.workspaceScope==localScope)
    }
    private fun click(tag: String) {
        if (tag.startsWith("habit-state-")) {
            compose.onNodeWithTag("habit-state-choice").performScrollTo().performClick()
            compose.onNodeWithTag(tag).assertIsEnabled().performClick()
        } else {
            val actionPrefix = listOf("toggle-habit-", "archive-habit-", "delete-habit-").firstOrNull { tag.startsWith(it) }
            if (actionPrefix != null && compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isEmpty())
                compose.onNodeWithTag("habit-actions-${tag.removePrefix(actionPrefix)}").performScrollTo().assertIsEnabled().performClick()
            val action = compose.onNodeWithTag(tag)
            if (!action.isDisplayed()) action.performScrollTo()
            action.assertIsEnabled().performClick()
        }
    }
    private fun awaitState(habit: Habit, state: String) {
        compose.waitUntil(30_000) { read().habits.firstOrNull { it.id==habit.id }?.let { HabitLifecycle.state(it).status==state } == true }
        compose.waitForIdle()
    }

    @Test fun pauseArchiveDeleteRestoreKeepIdentityHistoryAndEarlierPenalty() {
        val habit=fixture(49);render(habit);val before=read()
        click("toggle-habit-${habit.id}");awaitState(habit,"paused")
        assertEquals(before.rewards,read().rewards)
        click("habit-state-paused");click("archive-habit-${habit.id}");awaitState(habit,"archived")
        assertEquals(before.rewards,read().rewards)
        click("habit-state-archived");click("restore-habit-${habit.id}");awaitState(habit,"paused")
        click("habit-state-paused");click("toggle-habit-${habit.id}");awaitState(habit,"active")
        click("habit-state-active");click("delete-habit-${habit.id}")
        compose.onNodeWithText("Удаление до 50 уникальных дней выполнения",substring=true).assertIsDisplayed()
        UiDevice.getInstance(InstrumentationRegistry.getInstrumentation()).pressBack()
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("confirm-delete-habit").fetchSemanticsNodes().isEmpty() }
        assertEquals("active",HabitLifecycle.state(read().habits.single()).status)
        click("delete-habit-${habit.id}");compose.onNodeWithTag("confirm-delete-habit").performClick();awaitState(habit,"deleted")
        val deleted=read();assertEquals(0,Rewards.balance(deleted.rewards))
        assertEquals(49,deleted.completions.count { it.habitId==habit.id });assertEquals(before.progress.lifetimeXp,deleted.progress.lifetimeXp)
        click("habit-state-deleted");click("restore-habit-${habit.id}");awaitState(habit,"paused")
        val restored=read();assertEquals(habit.id,restored.habits.single().id);assertEquals(deleted.rewards,restored.rewards)
        assertEquals(before.progress.lifetimeXp,restored.progress.lifetimeXp);assertEquals(before.completions,restored.completions)
        val event=deleted.habits.single().lifecycleHistory.single { it.action=="delete" }
        runBlocking { repository.lifecycle(HabitLifecycleCommand(event.id,habit.id,event.at,event.action,event.replaces,event.selectedId)) }
        assertEquals(restored.habits.single().lifecycleHistory,read().habits.single().lifecycleHistory)
        assertEquals(deleted.rewards,read().rewards)
    }

    @Test fun fiftyDistinctDatesRetainLaurelsThroughDeleteAndRestore() {
        val habit=fixture(50);render(habit);val before=read()
        click("delete-habit-${habit.id}")
        compose.onNodeWithText("Рубеж 50 дней достигнут",substring=true).assertIsDisplayed()
        compose.onNodeWithTag("confirm-delete-habit").performClick();awaitState(habit,"deleted")
        val deleted=read();assertEquals(Rewards.balance(before.rewards),Rewards.balance(deleted.rewards))
        click("habit-state-deleted");click("restore-habit-${habit.id}");awaitState(habit,"paused")
        assertEquals(deleted.rewards,read().rewards);assertEquals(before.completions,read().completions)
        assertEquals(before.progress.lifetimeXp,read().progress.lifetimeXp)
    }

    @Test fun accountArchivePausesTimerAndColdReplayRetainsEncryptedBytesAndOutboxIdentity() {
        app.activateAccount(UUID.randomUUID().toString())
        val accountScope=app.workspaceScope;val accountRepository=HabitsRepository(app)
        check(accountScope.startsWith("account-") && accountScope!=localScope)
        val today=LocalDate.now();val at=Instant.now().minusSeconds(30).toString()
        val habit=Habit(TrackerEntity("e4-storage-${UUID.randomUUID()}",at,at),"Минуты без повторного начисления",today,
            HabitEngine(GenesisCalendar()).defaultSchedule(today,CalendarMode.PROFANE),measurement=HabitMeasurement("duration","min",60000,1000))
        var source=LocalHabitWorkspace(habits=listOf(habit),rewards=listOf(Rewards.create(25.0,"comeback","seed","${habit.id}:seed",at)))
        source=HabitTimerWorkspace.apply(source,HabitTimerCommand("start",accountRepository.timerOwner,at,"${habit.id}:clock",habitId=habit.id))
        try {
            write(source,accountScope)
            val command=HabitLifecycleCommand("e4-archive-${UUID.randomUUID()}",habit.id,Instant.now().toString(),"archive",emptyList())
            runBlocking { accountRepository.lifecycle(command) }
            val after=runBlocking { accountRepository.workspace.first() }
            val document=runBlocking { app.database.dao().document(accountScope,"habits")!! }
            val outbox=runBlocking { app.database.dao().outbox(accountScope) }.single()
            assertEquals("habits",outbox.entityId);assertEquals(document.revision,outbox.revision)
            assertEquals("archived",HabitLifecycle.state(after.habits.single()).status)
            assertEquals("paused",HabitTimers.sessions(after.timers).single().state!!.status)
            assertEquals(source.rewards,after.rewards);assertTrue(after.measurements.isEmpty())
            val cold=HabitsRepository(app)
            runBlocking { cold.lifecycle(command) }
            assertTrue("Known replay keeps encrypted bytes",document.encrypted==runBlocking { app.database.dao().document(accountScope,"habits")!! }.encrypted)
            assertEquals(outbox,runBlocking { app.database.dao().outbox(accountScope) }.single())
            assertEquals(after.habits.single().lifecycleHistory,runBlocking { cold.workspace.first() }.habits.single().lifecycleHistory)
        } finally {
            runBlocking { app.database.withTransaction {
                app.database.dao().deleteDocument(accountScope,"habits")
                app.database.openHelper.writableDatabase.execSQL("DELETE FROM outbox WHERE scope=?",arrayOf(accountScope))
            } }
            app.activateAccount(null)
        }
    }
}
