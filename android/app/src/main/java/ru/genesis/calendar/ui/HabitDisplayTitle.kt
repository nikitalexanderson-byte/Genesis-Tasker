package ru.genesis.calendar.ui

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import java.util.concurrent.ConcurrentHashMap
import ru.genesis.calendar.domain.TheokyklosCatalogSource
import ru.genesis.calendar.domain.TheokyklosPractice
import ru.genesis.calendar.domain.habits.Habit

private val renamedPractices = ConcurrentHashMap<String, Map<String, TheokyklosPractice>>()

/** Display renamed defaults by stable practice ID; never rewrite saved or custom text. */
@Composable
internal fun habitDisplayTitle(habit: Habit): String {
    if (habit.stoicheionRestoration != null) return restorationHabitDisplay(habit).first
    val practiceId = habit.sacredPracticeId ?: return habit.title
    val context = LocalContext.current.applicationContext
    val language = LocalGenesisLanguage.current
    val practices = remember(context, language) {
        renamedPractices.getOrPut(language) {
            TheokyklosCatalogSource.load(context, language).practices
                .filter { it.previousTitles.isNotEmpty() }.associateBy { it.id }
        }
    }
    return practices[practiceId]?.displayTitle(habit.title, language == "en") ?: habit.title
}
