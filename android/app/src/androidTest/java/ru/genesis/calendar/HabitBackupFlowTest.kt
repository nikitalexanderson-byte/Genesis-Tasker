package ru.genesis.calendar

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.room.withTransaction
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.By
import androidx.test.uiautomator.UiDevice
import androidx.test.uiautomator.Until
import java.util.UUID
import java.io.File
import org.json.JSONObject
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

class HabitBackupFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    private lateinit var app: GenesisApplication
    private lateinit var scope: String
    private fun file() = InstrumentationRegistry.getInstrumentation().context.assets.open("habit-backup-web.json").bufferedReader().use { it.readText() }
    private fun source() = HabitBackups.parse(file()).workspace()
    private fun write(value: LocalHabitWorkspace) = runBlocking { app.database.withTransaction {
        app.database.dao().putDocument(DocumentRecord(scope, "habits", LocalCipher().encrypt(HabitDocument.encode(value), "$scope/habits"), 1))
    } }
    @Before fun setup() {
        app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        app.activateAccount(UUID.randomUUID().toString()); scope = app.workspaceScope
        app.rememberFeatureAccess(scope, validationDataExchangeAccess())
        check(scope.startsWith("account-"))
    }
    @After fun cleanup() {
        runBlocking { app.database.withTransaction {
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM documents WHERE scope=?", arrayOf(scope))
            app.database.openHelper.writableDatabase.execSQL("DELETE FROM outbox WHERE scope=?", arrayOf(scope))
        } }
        app.activateAccount(null)
    }
    @Test fun cleanWebRestoreIsAtomicRetainsLedgerAndColdReplayDoesNotRewriteOutbox() = runBlocking {
        val service = HabitBackupService(app); val draft = service.prepare(file(), "web.json")
        assertNull(app.database.dao().document(scope, "habits")); service.apply(draft.id)
        val result = service.current(); assertEquals(2, result.habits.size)
        assertEquals("paused", HabitLifecycle.state(result.habits.first()).status)
        assertEquals("archived", HabitLifecycle.state(result.habits.last()).status)
        assertEquals(source().rewards, result.rewards); assertEquals(source().progress, result.progress)
        val record = app.database.dao().document(scope, "habits")!!; val outbox = app.database.dao().outbox(scope)
        assertEquals(1, outbox.size); assertNull(HabitBackupService(app).load())
        HabitBackupService(app).apply(draft.id)
        assertEquals(record, app.database.dao().document(scope, "habits")); assertEquals(outbox, app.database.dao().outbox(scope))
    }
    @Test fun expiryAfterPreviewBlocksApplyAndPreservesTheDraftAndWorkspace() = runBlocking {
        val service = HabitBackupService(app)
        val draft = service.prepare(file(), "preview-before-expiry.json")
        val storedDraft = app.database.dao().document(scope, "habit-restore-draft")
        val before = app.database.dao().document(scope, "habits")
        val queue = app.database.dao().outbox(scope)
        app.rememberFeatureAccess(scope, validationDataExchangeAccess().copy(validUntil = java.time.Instant.EPOCH))
        val failure = assertThrows(IllegalArgumentException::class.java) { runBlocking { service.apply(draft.id) } }
        assertEquals("FEATURE_SUBSCRIPTION_REQUIRED", failure.message)
        assertEquals(storedDraft, app.database.dao().document(scope, "habit-restore-draft"))
        assertEquals(before, app.database.dao().document(scope, "habits"))
        assertEquals(queue, app.database.dao().outbox(scope))
        assertEquals(draft.id, service.load()?.id)
        service.cancel(draft.id)
        assertNull(service.load())
    }
    @Test fun paidImportCannotBypassTheHabitQuotaAndKeepsItsPreview() = runBlocking {
        app.rememberFeatureAccess(scope, validationDataExchangeAccess().copy(limits = mapOf("habits" to 2)))
        write(source().copy(habits = source().habits.map { it.copy(title = "Текущая " + it.title) }))
        val service = HabitBackupService(app)
        var draft = service.prepare(file(), "would-exceed-quota.json")
        for (row in draft.preview.habits.filter { it.kind == "conflict" }) draft = service.choose(draft.id, row.id, "copy")
        val before = app.database.dao().document(scope, "habits")
        val queue = app.database.dao().outbox(scope)
        val failure = assertThrows(IllegalArgumentException::class.java) { runBlocking { service.apply(draft.id) } }
        assertTrue(failure.message.orEmpty().startsWith("Достигнут лимит тарифа."))
        assertEquals(before, app.database.dao().document(scope, "habits"))
        assertEquals(queue, app.database.dao().outbox(scope))
        assertEquals(draft.id, service.load()?.id)
    }
    @Test fun downgradeKeepsRestoreBlockedButAllowsCancellingItsSavedPreview() {
        val service = HabitBackupService(app)
        val draft = runBlocking { service.prepare(file(), "before-downgrade.json") }
        val before = runBlocking { app.database.dao().document(scope, "habits") }
        val queue = runBlocking { app.database.dao().outbox(scope) }
        var access by mutableStateOf(validationDataExchangeAccess())
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides false,
            LocalFeatureAccess provides access) {
            MaterialTheme(colorScheme = standart) { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState())) {
                    HabitBackupPanel(app, LocalHabitWorkspace(), inDialog = true)
                }
            } }
        } }
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("habit-restore-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("habit-restore-apply").performScrollTo().assertIsEnabled()
        compose.runOnIdle {
            access = access.copy(effectivePlan = "free", allowedFeatures = emptySet())
            app.rememberFeatureAccess(scope, access)
        }
        compose.onNodeWithTag("habit-restore-apply").assertIsNotEnabled()
        compose.onNodeWithTag("habit-restore-refresh").assertIsNotEnabled()
        assertEquals(draft.id, runBlocking { service.load()?.id })
        compose.onNodeWithTag("habit-restore-cancel").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(15_000) {
            runBlocking { service.load() == null } &&
                compose.onAllNodesWithTag("habit-restore-preview").fetchSemanticsNodes().isEmpty()
        }
        assertEquals(before, runBlocking { app.database.dao().document(scope, "habits") })
        assertEquals(queue, runBlocking { app.database.dao().outbox(scope) })
    }
    @Test fun encryptedDraftAndExplicitChoicesSurviveRepositoryReopening() = runBlocking {
        val source = source(); write(source.copy(habits = source.habits.map { it.copy(title = "Current " + it.title) }))
        val service = HabitBackupService(app); var draft = service.prepare(file(), "Собственное имя.json")
        for (row in draft.preview.habits) draft = service.choose(draft.id, row.id, "copy")
        val cold = HabitBackupService(app).load()!!
        assertEquals(draft.id, cold.id); assertEquals(draft.choices, cold.choices); assertEquals(draft.filename, cold.filename)
        assertFalse(app.database.dao().document(scope, "habit-restore-draft")!!.encrypted.contains("Собственное имя"))
        HabitBackupService(app).apply(cold.id)
        val result = service.current(); assertEquals(4, result.habits.size); assertEquals(source.progress, result.progress)
        assertEquals(source.rewards, result.rewards); assertEquals(0, result.completions.last().xpAwarded)
        val again = service.prepare(file(), "again.json"); assertTrue(again.preview.habits.all { it.kind == "restored" })
        service.cancel(again.id)
    }
    @Test fun changedDataRejectsOldPreviewPreservesDraftAndNeedsExplicitRenewal() = runBlocking {
        val service = HabitBackupService(app); val draft = service.prepare(file(), "web.json")
        write(source()); val before = app.database.dao().document(scope, "habits")!!
        assertThrows(IllegalArgumentException::class.java) { runBlocking { service.apply(draft.id) } }
        assertEquals(before, app.database.dao().document(scope, "habits")); assertTrue(service.load()!!.stale)
        val refreshed = service.refresh(draft.id); assertFalse(refreshed.stale); assertTrue(refreshed.choices.isEmpty())
    }
    @Test fun damagedFileKeepsAnExistingValidDraftAndCurrentEncryptedDocument() = runBlocking {
        write(source()); val service = HabitBackupService(app); val draft = service.prepare(file(), "valid.json")
        val before = app.database.dao().document(scope, "habits")!!
        assertThrows(Exception::class.java) { runBlocking { service.prepare("{bad", "broken.json") } }
        assertEquals(draft.id, service.load()!!.id); assertEquals(before, app.database.dao().document(scope, "habits"))
    }
    @Test fun failedTransactionRetainsAllDraftChunksAndDoesNotCreatePartialHistoryOrOutbox() = runBlocking {
        val service = HabitBackupService(app); val draft = service.prepare(file(), "valid.json")
        assertThrows(IllegalStateException::class.java) { runBlocking { HabitBackupService(app) { error("injected durable write failure") }.apply(draft.id) } }
        assertNull(app.database.dao().document(scope, "habits")); assertTrue(app.database.dao().outbox(scope).isEmpty())
        assertEquals(draft.id, HabitBackupService(app).load()!!.id)
        service.apply(draft.id); assertEquals(2, service.current().habits.size)
    }
    @Test fun portableFileLargerThanCursorWindowSurvivesEncryptedChunkRecovery() = runBlocking {
        val service = HabitBackupService(app); val text = " ".repeat(2_200_000) + file()
        val draft = service.prepare(text, "large.json"); val cold = HabitBackupService(app).load()!!
        assertEquals(draft.preview.backup.checksum, cold.preview.backup.checksum)
        assertEquals(draft.id, cold.id); service.apply(cold.id); assertEquals(2, service.current().habits.size)
    }
    @Test fun actualNativeScreenShowsSavedConflictsAndAppliesChosenCopies() {
        val source = source(); write(source.copy(habits = source.habits.map { it.copy(title = "Current " + it.title) },
            settings = HabitSettings(feedback = HabitFeedbackSettings(animations = false, achievementPopups = false, questsEnabled = false, gamificationWidgets = false))))
        val service = HabitBackupService(app); val draft = runBlocking { service.prepare(file(), "web.json") }
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides false,
            LocalFeatureAccess provides validationDataExchangeAccess()) {
            MaterialTheme(colorScheme = standart) { Surface(Modifier.fillMaxSize()) {
                Column { HabitsScreen(app, true, CalendarMode.PROFANE, CalendarMode.PROFANE) }
            } }
        } }
        compose.waitUntil(10_000) { compose.onAllNodesWithTag("habit-workspace-menu").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("habit-workspace-menu").performClick()
        compose.onNodeWithTag("habit-open-data").performClick()
        compose.onNodeWithTag("habit-data-dialog").assertIsDisplayed()
        compose.waitUntil(30_000) { compose.onAllNodesWithTag("habit-restore-preview").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("habit-restore-apply").performScrollTo().assertIsNotEnabled()
        // Opening the workspace may finish its normal reconciliation after this draft was
        // prepared. Renew that preview explicitly, as the user does after a real sync.
        compose.onNodeWithTag("habit-restore-refresh").performScrollTo().performClick()
        compose.waitUntil(15_000) { runBlocking { service.load()?.stale == false } }
        for (row in draft.preview.habits) {
            compose.waitUntil(15_000) { compose.onNodeWithTag("habit-restore-copy-${row.id}").fetchSemanticsNode().config
                .getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Disabled) == null }
            compose.onNodeWithTag("habit-restore-copy-${row.id}").performScrollTo().performClick()
            compose.waitUntil(15_000) { compose.onNodeWithTag("habit-restore-copy-${row.id}").fetchSemanticsNode().config
                .getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Selected) == true }
        }
        compose.waitUntil(15_000) { compose.onNodeWithTag("habit-restore-apply").fetchSemanticsNode().config
            .getOrNull(androidx.compose.ui.semantics.SemanticsProperties.Disabled) == null }
        compose.onNodeWithTag("habit-restore-apply").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(30_000) { runBlocking { service.current().habits.size == 4 } }
        assertNull(runBlocking { service.load() }); assertEquals(source.rewards, runBlocking { service.current().rewards })
    }

    @Test fun systemFilePickerCancelExportAndRestoreKeepTheOwnedEncryptedHistory() {
        val original = source()
        write(original)
        val service = HabitBackupService(app)
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        val filename = "QA313-${UUID.randomUUID()}.json"
        compose.setContent { CompositionLocalProvider(LocalGenesisLanguage provides "ru", LocalEveningTheme provides false,
            LocalFeatureAccess provides validationDataExchangeAccess()) {
            MaterialTheme(colorScheme = standart) { Surface(Modifier.fillMaxSize()) {
                Column(Modifier.fillMaxSize().safeDrawingPadding().verticalScroll(rememberScrollState())) {
                    HabitBackupPanel(app, original, inDialog = true)
                }
            } }
        } }
        fun ready(tag: String) {
            compose.waitUntil(15_000) { runCatching { compose.onNodeWithTag(tag).assertIsEnabled() }.isSuccess }
        }
        fun picker() {
            assertTrue("A real Android document picker must open", device.wait(Until.hasObject(
                By.pkg(java.util.regex.Pattern.compile("com\\.(google\\.)?android\\.documentsui"))), 15_000))
        }
        fun cancelPicker() {
            val documents = By.pkg(java.util.regex.Pattern.compile("com\\.(google\\.)?android\\.documentsui"))
            device.pressBack()
            // CreateDocument may first consume Back to dismiss its filename keyboard.
            if (device.hasObject(documents)) device.pressBack()
            assertTrue("Cancel must return from the document picker", device.wait(Until.gone(documents), 10_000))
        }
        ready("habit-export-json")
        compose.onNodeWithTag("habit-export-json").performClick()
        picker()
        cancelPicker()
        ready("habit-export-json")
        assertEquals(original.habits, runBlocking { service.current().habits })
        assertNull(runBlocking { service.load() })
        compose.onNodeWithTag("habit-restore-file").performClick()
        picker()
        cancelPicker()
        ready("habit-export-json")
        assertNull(runBlocking { service.load() })
        compose.onNodeWithTag("habit-export-json").performClick()
        picker()
        val nameField = device.wait(Until.findObject(By.clazz("android.widget.EditText")), 10_000)
        assertNotNull("CreateDocument must expose its filename", nameField)
        nameField.text = filename
        val save = device.wait(Until.findObject(By.res("android:id/button1")), 10_000)
        assertNotNull("CreateDocument must expose Save", save)
        save.click()
        compose.waitUntil(15_000) { compose.onAllNodesWithTag("habit-backup-result").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("habit-backup-result").assertTextEquals("Экспорт завершён.")
        // Only this test's UUID account is emptied to exercise the actual file restore path.
        write(LocalHabitWorkspace())
        compose.onNodeWithTag("habit-restore-file").performClick()
        picker()
        val exported = device.wait(Until.findObject(By.text(filename)), 15_000)
        assertNotNull("OpenDocument must offer the actual exported file", exported)
        exported.click()
        compose.waitUntil(20_000) { runBlocking { service.load() != null } }
        val draft = requireNotNull(runBlocking { service.load() })
        assertEquals(filename, draft.filename)
        assertEquals(original.habits, draft.preview.backup.workspace().habits)
        compose.onNodeWithTag("habit-restore-apply").performScrollTo().assertIsEnabled().performClick()
        compose.waitUntil(20_000) { runBlocking { service.load() == null && service.current().habits.size == original.habits.size } }
        val restored = runBlocking { service.current() }
        assertEquals(original.habits.map { it.id }.toSet(), restored.habits.map { it.id }.toSet())
        for (expected in original.habits) {
            val actual = restored.habits.single { it.id == expected.id }
            // Restore deliberately pauses active habits and removes Google bindings.
            // Every other authored field must survive the exported file unchanged.
            assertEquals(expected, actual.copy(active = expected.active,
                lifecycleHistory = expected.lifecycleHistory, reminder = expected.reminder))
            val status = HabitLifecycle.state(expected).status
            assertEquals(if (status == "active") "paused" else status, HabitLifecycle.state(actual).status)
            assertEquals(HabitLifecycle.state(actual).status == "active", actual.active)
            assertFalse(actual.reminder.syncToGoogleTasks)
            assertFalse(actual.reminder.showInGoogleCalendar)
            assertNull(actual.reminder.googleTaskId)
            assertNull(actual.reminder.googleEventId)
        }
        assertEquals(original.completions, restored.completions)
        assertEquals(original.rewards, restored.rewards)
        assertEquals(restored.habits, runBlocking { HabitBackupService(app).current().habits })
        captureNativeWindow(File(app.getExternalFilesDir(null), "backup-picker313-restored.png"))
        File(app.getExternalFilesDir(null), "backup-picker313-proof.json").writeText(JSONObject()
            .put("exportedFilename", filename).put("habitCount", original.habits.size)
            .put("cancelledBothPickersWithoutChanges", true).put("actualExportAndOpenDocument", true)
            .put("freshServiceRestoredHabitsMatch", true).put("rewardsUnchanged", true).toString(2))
    }
}
