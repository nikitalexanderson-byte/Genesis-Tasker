package ru.genesis.calendar.ui

import ru.genesis.calendar.domain.habits.Habit
import ru.genesis.calendar.domain.TheokyklosPractice

/** A reading keeps its own saved habit; it never occupies a default catalog practice slot. */
internal fun standardSacredHabit(habits: List<Habit>, practiceId: String): Habit? = habits.firstOrNull {
    it.sacredPracticeId == practiceId && it.stoicheionRestoration == null
}

internal fun canRestoreSacredHabit(habit: Habit, practice: TheokyklosPractice): Boolean =
    habit.sacredPracticeId == practice.id && habit.stoicheionRestoration == null &&
        (habit.title !in listOf(practice.title.ru, practice.title.en) + practice.previousTitles ||
            habit.description !in listOf(practice.description.ru, practice.description.en) ||
            habit.emoji != practice.emoji || !habit.color.equals(practice.color, ignoreCase = true))

/** Identity, schedule, lifecycle, goals and all completion records stay unchanged. */
internal fun restoreSacredHabitContent(habit: Habit, practice: TheokyklosPractice, english: Boolean): Habit {
    if (!canRestoreSacredHabit(habit, practice)) return habit
    return habit.copy(title = if (english) practice.title.en else practice.title.ru,
        description = if (english) practice.description.en else practice.description.ru,
        emoji = practice.emoji, color = practice.color)
}
