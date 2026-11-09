package ru.genesis.calendar

import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.*
import androidx.room.withTransaction
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.state.ToggleableState
import androidx.compose.ui.unit.dp
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import androidx.test.platform.app.InstrumentationRegistry
import androidx.test.uiautomator.UiDevice
import java.io.File
import java.time.*
import java.util.UUID
import java.util.concurrent.atomic.AtomicReference
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import ru.genesis.calendar.data.*
import ru.genesis.calendar.domain.*
import ru.genesis.calendar.domain.habits.*
import ru.genesis.calendar.ui.*

class HabitHistoryFlowTest {
    @get:Rule val compose = createAndroidComposeRule<StoicheionGestureActivity>()
    @Test fun explicitHistoricalPreviewSavesItsOriginalDayWithoutRewardAndMeasuredInputIsDurable() {
        val app = compose.activity.application as GenesisApplication
        check(BuildConfig.DEBUG && app.packageName.endsWith(".debug") && app.workspaceScope == "internal-validation-v1")
        val repository = HabitsRepository(app)
        fun saved() = runBlocking { repository.workspace.first() }
        val today = LocalDate.now(); val day = today.minusDays(1)
        fun habit(title: String, measured: Boolean = false) = Habit(TrackerEntity.create("habit", id = "e3-${UUID.randomUUID()}"),title,
            today.minusDays(3),HabitEngine(GenesisCalendar()).defaultSchedule(today.minusDays(3),CalendarMode.PROFANE),
            measurement = if(measured) HabitMeasurement("quantity","pages",1000,1000) else null)
        val binary = habit("E3 · Прошлая практика");val quantity = habit("E3 · Страницы в прошлом",true)
        val ids = setOf(binary.id,quantity.id)
        val rendered = AtomicReference<Pair<LocalHabitWorkspace, LocalHabitWorkspace>?>(null)
        val syntheticNote = "Синтетическая историческая запись"
        var render by mutableStateOf(true)
        val device = UiDevice.getInstance(InstrumentationRegistry.getInstrumentation())
        fun hideImeBeforePreview() {
            compose.dismissValidationKeyboard()
        }
        fun previewEnvironment(action: SemanticsNodeInteraction): JSONObject = runCatching {
            val node = action.fetchSemanticsNode()
            JSONObject().put("actionEnabled", !node.config.contains(SemanticsProperties.Disabled))
                .put("actionBoundsInRoot", node.boundsInRoot.toString())
                .put("actionBoundsInWindow", node.boundsInWindow.toString())
                .put("actionSize", node.size.toString())
                .put("window", compose.runOnIdle {
                    val decor = compose.activity.window.decorView
                    val insets = ViewCompat.getRootWindowInsets(decor)
                    val frame = android.graphics.Rect().also { decor.getWindowVisibleDisplayFrame(it) }
                    JSONObject().put("imeInsetsAvailable", insets != null)
                        .put("imeVisible", insets?.isVisible(WindowInsetsCompat.Type.ime()) ?: JSONObject.NULL)
                        .put("imeBottom", insets?.getInsets(WindowInsetsCompat.Type.ime())?.bottom ?: JSONObject.NULL)
                        .put("visibleDisplayFrame", frame.toShortString())
                        .put("decorWidth", decor.width).put("decorHeight", decor.height)
                        .put("windowHasFocus", decor.hasWindowFocus())
                        .put("focusedViewClass", decor.findFocus()?.javaClass?.name ?: JSONObject.NULL)
                        .put("softInputMode", compose.activity.window.attributes.softInputMode)
                })
        }.getOrElse { JSONObject().put("probeFailureClass", it.javaClass.simpleName) }
        // Seed an older imported practice only in the guarded synthetic debug workspace.
        // Production creation correctly refuses a start date in the past.
        try {
        runBlocking { app.database.withTransaction {
            val record=app.database.dao().document(app.workspaceScope,"habits")
            val existing=if(record==null) LocalHabitWorkspace() else HabitDocument.decode(LocalCipher().decrypt(record.encrypted,"${app.workspaceScope}/habits"),record.revision)
            val next=existing.copy(habits=existing.habits+listOf(binary,quantity),revision=existing.revision+1)
            app.database.dao().putDocument(DocumentRecord(app.workspaceScope,"habits",
                LocalCipher().encrypt(HabitDocument.encode(next),"${app.workspaceScope}/habits"),next.revision))
        } }
        val before = saved()
        var dark by mutableStateOf(false)
            // Match MainActivity and MobileWorkspaceShell rather than testing a different window/IME host.
            compose.activityRule.scenario.onActivity { it.enableEdgeToEdge() }
            compose.setContent {
                val all by repository.workspace.collectAsState(initial = LocalHabitWorkspace())
                val complete = all
                val shown = complete.copy(habits = complete.habits.filter { it.id in ids })
                SideEffect { rendered.set(complete to shown) }
                if (render) MaterialTheme(colorScheme = if(dark) evening else standart) {
                    CompositionLocalProvider(LocalGenesisLanguage provides "ru",LocalEveningTheme provides dark) {
                        Surface(Modifier.fillMaxSize().safeDrawingPadding().imePadding()) {
                            Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(16.dp)) {
                                HabitHistoryPanel(shown,repository,CalendarMode.PROFANE)
                            }
                        }
                    }
                }
            }
            compose.onNodeWithTag("habit-history-content").assertDoesNotExist()
            compose.onNodeWithText("Исправить историю").assertDoesNotExist()
            compose.onNodeWithTag("habit-history-disclosure").performClick()
            compose.onNodeWithText("Исправить историю").performClick()
            compose.onAllNodes(isToggleable()).onFirst().performScrollTo().performClick()
            compose.onNodeWithText("Заметка").performScrollTo().performTextReplacement(syntheticNote)
            compose.onNodeWithText("Заметка").assertTextContains(syntheticNote)
            hideImeBeforePreview()
            val previewAction = compose.onNodeWithText("Предпросмотр изменений").performScrollTo().assertIsDisplayed()
            val previewSource = compose.runOnIdle { rendered.get() }
            val previewInstant = Instant.now()
            val inForm = hasAnyAncestor(hasTestTag("habit-history-form"))
            fun formHas(text: String) = compose.onAllNodes(hasText(text) and inForm, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
            val selectedBefore = listOf(binary, quantity).filter { formHas(it.title) }.map { it.id }
            val checkedBefore = compose.onAllNodes(isToggleable() and inForm, useUnmergedTree = true)
                .fetchSemanticsNodes().mapNotNull { it.config.getOrNull(SemanticsProperties.ToggleableState) }
            val noteMatchesBefore = formHas(syntheticNote)
            val sourceHabit = previewSource?.second?.habits?.firstOrNull { it.id == binary.id }
            val sourceRule = sourceHabit?.let { HabitMeasurements.rule(it, it.createdDate) }
            val defaultDay = sourceRule?.let { previewInstant.atZone(ZoneId.of(it.schedule.timezone)).toLocalDate().minusDays(1) }
            val observedDay = sourceHabit?.let { habit -> listOfNotNull(day, defaultDay).distinct().singleOrNull { candidate ->
                val rule = HabitMeasurements.rule(habit, candidate)
                formHas(GenesisCalendar(ZoneId.of(rule.schedule.timezone)).formatDate(candidate, CalendarMode.PROFANE) + " · " + rule.schedule.timezone)
            } }
            val previewEnvironmentBefore = previewEnvironment(previewAction)
            previewAction.performClick()
            assertTrue(saved().history.none { it.habitId in ids })
            // Observe the failure without changing the scenario, retrying, or writing either probe to the repository.
            if (compose.onAllNodesWithText("Сохранить").fetchSemanticsNodes().isEmpty()) runCatching {
                fun counts(value: LocalHabitWorkspace): JSONObject {
                    val habitIds = value.habits.map { it.id }.toSet()
                    return JSONObject().put("revision", value.revision).put("habits", value.habits.size)
                        .put("completions", value.completions.size).put("measurements", value.measurements.size)
                        .put("history", value.history.size).put("rewards", value.rewards.size)
                        .put("goals", value.goals.size).put("quests", value.quests.size).put("timers", value.timers.size)
                        .put("orphanCompletions", value.completions.count { it.habitId !in habitIds })
                        .put("orphanMeasurements", value.measurements.count { it.habitId !in habitIds })
                        .put("orphanHistory", value.history.count { it.habitId !in habitIds })
                }
                val proof = JSONObject().put("checkpoint", "after-preview-before-original-save-assert")
                    .put("snapshotCaptured", previewSource != null).put("syntheticHabitIds", JSONArray(ids.toList()))
                    .put("probeInstant", previewInstant.toString()).put("systemZone", ZoneId.systemDefault().id)
                    .put("ruleZone", sourceRule?.schedule?.timezone ?: JSONObject.NULL).put("saveNodes", 0)
                    .put("selectedBefore", JSONArray(selectedBefore)).put("selectedAfter", JSONArray(listOf(binary, quantity).filter { formHas(it.title) }.map { it.id }))
                    .put("checkedBefore", JSONArray(checkedBefore.map { it.name })).put("syntheticNote", syntheticNote)
                    .put("noteMatchesBefore", noteMatchesBefore).put("noteMatchesAfter", formHas(syntheticNote))
                    .put("testExpectedDay", day.toString()).put("defaultRuleDay", defaultDay?.toString() ?: JSONObject.NULL)
                    .put("observedDay", observedDay?.toString() ?: JSONObject.NULL)
                    .put("formNodes", compose.onAllNodesWithTag("habit-history-form").fetchSemanticsNodes().size)
                    .put("previewActionNodes", compose.onAllNodes(hasText("Предпросмотр изменений") and hasClickAction()).fetchSemanticsNodes().size)
                    .put("previewErrorVisible", formHas("В этот день запись недоступна. Проверьте дату, значение и действующее правило."))
                    .put("freshSaved", counts(saved())).put("probeWritesToDatabase", false)
                    .put("probeCommandIsReconstruction", true)
                    .put("environmentBeforeClick", previewEnvironmentBefore)
                    .put("environmentAfterClick", previewEnvironment(previewAction))
                rendered.get()?.let { proof.put("renderedAfterClick", counts(it.second)) }
                previewSource?.let { (complete, shown) ->
                    proof.put("renderedFilteredInput", counts(shown)).put("completeSameRevisionInput", counts(complete))
                    val exactBinaryInput = selectedBefore == listOf(binary.id) && checkedBefore == listOf(ToggleableState.On) &&
                        noteMatchesBefore && observedDay != null && sourceHabit != null && sourceHabit.qualityScale == "none" &&
                        sourceHabit.intervalSchedule == null && HabitMeasurements.effective(HabitMeasurements.rule(sourceHabit, observedDay)) == null
                    proof.put("binaryInputProvenBySemantics", exactBinaryInput)
                    if (exactBinaryInput) {
                        val date = requireNotNull(observedDay); val habit = requireNotNull(sourceHabit)
                        val command = HabitHistoryCommand("diagnostic-history-${UUID.randomUUID()}", previewInstant.toString(), habit.id, date,
                            HabitMeasurements.rule(habit, date).id, HabitHistory.state(shown.history, habit.id, date).heads.map { it.entity.id },
                            HabitHistoryValue(completed = true, note = syntheticNote))
                        val exceptionClasses = setOf("java.lang.IllegalArgumentException", "java.lang.IllegalStateException", "java.lang.ArithmeticException",
                            "java.lang.IndexOutOfBoundsException", "java.util.NoSuchElementException", "java.time.DateTimeException", "java.time.format.DateTimeParseException")
                        val domainCodes = setOf("HABIT_HISTORY_DATE_UNAVAILABLE", "INVALID_HABIT_HISTORY", "HABIT_HISTORY_ID_CONFLICT",
                            "HABIT_HISTORY_EDIT_CONFLICT", "INVALID_HABIT_RULE_HISTORY", "HABIT_RULE_ID_CONFLICT", "INVALID_HABIT_MEASUREMENT",
                            "HABIT_MEASUREMENT_ID_CONFLICT", "INVALID_HABIT_PERIOD_GOAL")
                        fun status(error: Throwable?) = JSONObject().put("ok", error == null)
                            .put("exceptionClass", error?.javaClass?.name?.let { if (it in exceptionClasses) it else "OTHER" } ?: JSONObject.NULL)
                            .put("domainCode", error?.message?.takeIf { it in domainCodes } ?: JSONObject.NULL)
                        fun probe(value: LocalHabitWorkspace): JSONObject {
                            val applied = runCatching { HabitHistory.apply(value, command, previewInstant) }
                            val result = JSONObject().put("apply", status(applied.exceptionOrNull()))
                            applied.getOrNull()?.let { next ->
                                val reconciled = runCatching { reconcileHabitWorkspace(next, previewInstant.atZone(ZoneId.systemDefault()).toLocalDate(),
                                    ZoneId.systemDefault().id, previewInstant.toString()) }
                                result.put("reconcile", status(reconciled.exceptionOrNull()))
                            }
                            return result
                        }
                        proof.put("probeRenderedFiltered", probe(shown)).put("probeCompleteSameRevision", probe(complete))
                    }
                }
                val png = File(app.getExternalFilesDir(null), "e3-history-preview-missing-save.png")
                proof.put("screenshotSaved", runCatching { device.takeScreenshot(png) }.getOrDefault(false))
                File(app.getExternalFilesDir(null), "e3-history-preview-missing-save.json").writeText(proof.toString(2))
            }.onFailure { android.util.Log.e("GENESIS_HISTORY_DIAG", "Passive preview diagnostic failed: ${it.javaClass.simpleName}") }
            compose.onNodeWithText("Сохранить").performScrollTo();compose.waitForIdle()
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),"e3-history-preview-light.png")))
            compose.runOnIdle { dark=true };compose.waitForIdle()
            assertTrue(device.takeScreenshot(File(app.getExternalFilesDir(null),"e3-history-preview-dark.png")))
            compose.onNodeWithText("Сохранить").performClick()
            compose.waitUntil(15_000) { saved().history.any { it.habitId == binary.id } }
            val first = saved().history.single { it.habitId == binary.id }
            assertEquals(day,first.date);assertTrue(saved().completions.single { it.habitId == binary.id && it.date == day }.completed)
            assertEquals(before.progress.lifetimeXp,saved().progress.lifetimeXp)
            assertEquals(before.rewards,saved().rewards);assertEquals(before.streakFreezeTransactions,saved().streakFreezeTransactions)
            val replay = HabitHistoryCommand(first.entity.id,first.entity.createdAt,first.habitId,first.date,first.ruleId,first.replaces,first.value)
            runBlocking { repository.correctHistory(replay) }
            assertEquals(1,saved().history.count { it.habitId == binary.id })
            compose.onNode(hasText(binary.title) and hasClickAction()).performScrollTo().performClick()
            compose.onNodeWithText(quantity.title).performClick()
            assertTrue(saved().measurements.none { it.habitId == quantity.id })
            compose.onNodeWithText("Значение").performScrollTo().performTextReplacement("1")
            compose.onNodeWithText("Значение").assertTextContains("1")
            hideImeBeforePreview()
            val measuredAction = compose.onNodeWithText("Предпросмотр изменений").performScrollTo().assertIsDisplayed()
            val measuredSource = compose.runOnIdle { rendered.get() }
            val measuredInstant = Instant.now()
            val measuredHabit = measuredSource?.second?.habits?.firstOrNull { it.id == quantity.id }
            val measuredRule = measuredHabit?.let { HabitMeasurements.rule(it, it.createdDate) }
            fun editableFormValue(label: String) = compose.onAllNodes(hasText(label) and hasSetTextAction() and inForm)
                .fetchSemanticsNodes().singleOrNull()?.config?.getOrNull(SemanticsProperties.EditableText)?.text
            fun editableFormFocused(label: String) = compose.onAllNodes(hasText(label) and hasSetTextAction() and inForm)
                .fetchSemanticsNodes().singleOrNull()?.config?.getOrNull(SemanticsProperties.Focused)
            val amountBefore = editableFormValue("Значение")
            val measuredNoteBefore = editableFormValue("Заметка")
            val amountFocusedBefore = editableFormFocused("Значение")
            val measuredNoteFocusedBefore = editableFormFocused("Заметка")
            val measuredSelectedBefore = listOf(binary, quantity).filter { formHas(it.title) }.map { it.id }
            val measuredDefaultDay = measuredRule?.let { measuredInstant.atZone(ZoneId.of(it.schedule.timezone)).toLocalDate().minusDays(1) }
            val measuredDay = measuredHabit?.let { habit -> listOfNotNull(day, measuredDefaultDay).distinct().singleOrNull { candidate ->
                val rule = HabitMeasurements.rule(habit, candidate)
                formHas(GenesisCalendar(ZoneId.of(rule.schedule.timezone)).formatDate(candidate, CalendarMode.PROFANE) + " · " + rule.schedule.timezone)
            } }
            val measuredEnvironmentBefore = previewEnvironment(measuredAction)
            measuredAction.performClick()
            // The original failure is in this second, measured preview; observe it without a retry or write.
            if (compose.onAllNodesWithText("Сохранить").fetchSemanticsNodes().isEmpty()) runCatching {
                fun shape(value: LocalHabitWorkspace): JSONObject {
                    val habitIds = value.habits.map { it.id }.toSet()
                    return JSONObject().put("revision", value.revision).put("habits", value.habits.size)
                        .put("history", value.history.size).put("measurements", value.measurements.size)
                        .put("completions", value.completions.size).put("goals", value.goals.size).put("quests", value.quests.size)
                        .put("orphanCompletions", value.completions.count { it.habitId !in habitIds })
                        .put("orphanMeasurements", value.measurements.count { it.habitId !in habitIds })
                        .put("orphanHistory", value.history.count { it.habitId !in habitIds })
                }
                val proof = JSONObject().put("checkpoint", "measured-preview-before-original-save-assert")
                    .put("probeInstant", measuredInstant.toString()).put("probeWritesToDatabase", false)
                    .put("probeCommandIsReconstruction", true).put("syntheticHabitId", quantity.id)
                    .put("environmentBeforeClick", measuredEnvironmentBefore)
                    .put("environmentAfterClick", previewEnvironment(measuredAction))
                    .put("selectedBefore", JSONArray(measuredSelectedBefore))
                    .put("selectedAfter", JSONArray(listOf(binary, quantity).filter { formHas(it.title) }.map { it.id }))
                    .put("amountMatchesBefore", amountBefore == "1").put("amountMatchesAfter", editableFormValue("Значение") == "1")
                    .put("emptyNoteBefore", measuredNoteBefore == "").put("emptyNoteAfter", editableFormValue("Заметка") == "")
                    .put("amountFocusedBefore", amountFocusedBefore ?: JSONObject.NULL)
                    .put("amountFocusedAfter", editableFormFocused("Значение") ?: JSONObject.NULL)
                    .put("noteFocusedBefore", measuredNoteFocusedBefore ?: JSONObject.NULL)
                    .put("noteFocusedAfter", editableFormFocused("Заметка") ?: JSONObject.NULL)
                    .put("observedDay", measuredDay?.toString() ?: JSONObject.NULL).put("testExpectedDay", day.toString())
                    .put("ruleZone", measuredRule?.schedule?.timezone ?: JSONObject.NULL)
                    .put("formNodes", compose.onAllNodesWithTag("habit-history-form").fetchSemanticsNodes().size)
                    .put("previewActionNodes", compose.onAllNodes(hasText("Предпросмотр изменений") and hasClickAction()).fetchSemanticsNodes().size)
                    .put("previewErrorVisible", formHas("В этот день запись недоступна. Проверьте дату, значение и действующее правило."))
                    .put("freshSaved", shape(saved()))
                rendered.get()?.let { proof.put("renderedAfterClick", shape(it.second)) }
                measuredSource?.let { (complete, shown) ->
                    proof.put("renderedFilteredInput", shape(shown)).put("completeSameRevisionInput", shape(complete))
                    val exactInput = measuredSelectedBefore == listOf(quantity.id) && amountBefore == "1" && measuredNoteBefore == "" &&
                        measuredDay != null && measuredHabit != null && measuredHabit.qualityScale == "none" && measuredHabit.intervalSchedule == null &&
                        measuredRule?.measurement?.kind == "quantity" && shown.measurements.none { it.habitId == quantity.id } &&
                        shown.completions.none { it.habitId == quantity.id } && shown.history.none { it.habitId == quantity.id }
                    proof.put("measuredInputProvenBySemantics", exactInput)
                    if (exactInput) {
                        val date = requireNotNull(measuredDay); val habit = requireNotNull(measuredHabit)
                        val command = HabitHistoryCommand("diagnostic-measured-${UUID.randomUUID()}", measuredInstant.toString(), habit.id, date,
                            HabitMeasurements.rule(habit, date).id, emptyList(), HabitHistoryValue(false), HabitHistoryMeasurement(1000L))
                        fun probe(value: LocalHabitWorkspace): JSONObject {
                            val applied = runCatching { HabitHistory.apply(value, command, measuredInstant) }
                            val reconciled = applied.mapCatching { reconcileHabitWorkspace(it, measuredInstant.atZone(ZoneId.systemDefault()).toLocalDate(),
                                ZoneId.systemDefault().id, measuredInstant.toString()) }
                            val failure = reconciled.exceptionOrNull()
                            return JSONObject().put("applyOk", applied.isSuccess).put("reconcileOk", reconciled.isSuccess)
                                .put("exceptionClass", failure?.javaClass?.name ?: JSONObject.NULL)
                                .put("domainCode", failure?.message?.takeIf { it.matches(Regex("(?:INVALID_HABIT|HABIT_HISTORY|HABIT_MEASUREMENT|HABIT_RULE|HABIT_PERIOD)_[A-Z_]+")) } ?: JSONObject.NULL)
                        }
                        proof.put("probeRenderedFiltered", probe(shown)).put("probeCompleteSameRevision", probe(complete))
                    }
                }
                proof.put("screenshotSaved", device.takeScreenshot(File(app.getExternalFilesDir(null), "e3-history-measured-preview-missing-save.png")))
                File(app.getExternalFilesDir(null), "e3-history-measured-preview-missing-save.json").writeText(proof.toString(2))
            }.onFailure { android.util.Log.e("GENESIS_HISTORY_DIAG", "Passive measured preview diagnostic failed: ${it.javaClass.simpleName}") }
            compose.onNodeWithText("Сохранить").performScrollTo().performClick()
            compose.waitUntil(15_000) { saved().measurements.any { it.habitId == quantity.id } }
            val value = saved().measurements.single { it.habitId == quantity.id }
            assertEquals(day,value.date);assertEquals(1000L,value.value);assertTrue(value.historical)
            assertEquals(before.progress.lifetimeXp,saved().progress.lifetimeXp);assertEquals(before.rewards,saved().rewards)
            val reloaded = HabitDocument.decode(HabitDocument.encode(saved()),saved().revision)
            assertEquals(saved().history,reloaded.history);assertEquals(saved().measurements,reloaded.measurements)
        } finally {
            compose.runOnIdle { render = false }; compose.waitForIdle()
            cleanupOwnedHabitFixtureRows(app, ids)
        }
    }
}
