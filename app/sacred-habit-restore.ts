import type { Habit, HabitWorkspace } from "./habits";
import { habitDisplayText } from "./habit-display-text";
import { SACRED_PRACTICES } from "./sacred-practices";
import { catalogText } from "./catalog-i18n";
import type { Language } from "./i18n";
import { markTrackerEntityChanged } from "./tracker-core";

/** Reading cycles are separate habits and must never be converted into catalog defaults. */
export function canRestoreSacredHabit(habit: Habit): boolean {
  const practice = !habit.stoicheionRestoration && SACRED_PRACTICES.find(row => row.id === habit.sacredPracticeId);
  if (!practice) return false;
  const text = habitDisplayText(habit, "ru");
  return text.title !== practice.title.ru || text.description !== practice.description.ru
    || habit.emoji !== practice.emoji || habit.color.toLowerCase() !== practice.color.toLowerCase();
}

/** Restore catalog content on the same record, preserving all tracking and scheduling data. */
export function restoreSacredHabit(workspace: HabitWorkspace, habitId: string, language: Language): HabitWorkspace {
  const habit = workspace.habits.find(row => row.id === habitId);
  if (!habit || !canRestoreSacredHabit(habit)) return workspace;
  const practice = SACRED_PRACTICES.find(row => row.id === habit.sacredPracticeId)!;
  return { ...workspace, habits: workspace.habits.map(row => row.id === habitId ? markTrackerEntityChanged({
    ...row, title: catalogText(practice.title, language), description: catalogText(practice.description, language),
    emoji: practice.emoji, color: practice.color,
  }) : row) };
}
