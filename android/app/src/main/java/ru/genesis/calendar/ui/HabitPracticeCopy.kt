package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import org.json.JSONObject
import androidx.compose.material3.MaterialTheme
import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.habits.HabitCompletion
import ru.genesis.calendar.domain.habits.HabitPracticeGoals
import java.time.LocalDate
import ru.genesis.calendar.domain.habits.HabitLifecycle

@Composable internal fun habitPracticeCopy(): JSONObject {
    val context = LocalContext.current
    val language = LocalGenesisLanguage.current
    val document = remember(context) { JSONObject(context.assets.open("originals/i18n/habit-practice-copy.json").bufferedReader().use { it.readText() }) }
    return document.optJSONObject(language) ?: document.getJSONObject("en")
}

@Composable internal fun HabitPracticeStatus(habit: Habit, entries: List<HabitCompletion>) {
    val progress = HabitPracticeGoals.progress(habit,entries,LocalDate.now()) ?: return
    val copy = habitPracticeCopy()
    val state = when(progress.status) { "completed" -> copy.getString("completed"); "missed" -> copy.getString("missed")
        else -> copy.getString("progress") + ": ${progress.dates.size}/${progress.goal.requiredCompletions}" }
    UntranslatedText(state + " · " + copy.getString("deadline") + ": ${progress.deadline}",
        style=MaterialTheme.typography.bodySmall,color=if(progress.status=="missed") MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant)
}

internal fun habitPracticeLibraryStatus(habit: Habit, entries: List<HabitCompletion>): String {
    val life=HabitLifecycle.state(habit)
    if(life.status!="active" || life.conflict) return life.status
    val progress=HabitPracticeGoals.progress(habit,entries,LocalDate.now())
    return if(progress?.status in setOf("completed","missed")) progress!!.status else life.status
}
