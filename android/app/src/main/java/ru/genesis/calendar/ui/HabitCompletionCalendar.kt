package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import java.time.LocalDate
import ru.genesis.calendar.data.HabitDayDecisionCommand
import ru.genesis.calendar.data.LocalHabitWorkspace
import ru.genesis.calendar.domain.CalendarMode

/** The selected report date never becomes the application's actual-today date. */
@Composable internal fun HabitCompletionCalendar(workspace: LocalHabitWorkspace, today: LocalDate,
    initialMode: CalendarMode, onOpenHistory: (String, LocalDate) -> Unit = { _, _ -> },
    onDecision: suspend (HabitDayDecisionCommand) -> Unit = { error("HABIT_HISTORY_STORAGE_UNAVAILABLE") }) {
    HabitAnalysisPanel(workspace, today, initialMode, onOpenHistory, onDecision)
}
