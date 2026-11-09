import type { CalendarMode } from "./calendar-data";
import type { Language } from "./i18n";
import type { SacredPractice } from "./sacred-practices";
import type { RestorationSnapshot } from "./stoicheion-restoration-state";
import { createHabitFromSacredPractice, type Habit } from "./habits";
import { habitLifecycleState } from "./habit-lifecycle";
import { convertTrackerRecurrenceCalendar } from "./task-recurrence";
import { addCivilDays } from "./calendar-context";

/** The default window belongs to the original divination, not to the day it is reopened. */
export function createRestorationHabit(practice: SacredPractice, snapshot: RestorationSnapshot,
  calendarMode: CalendarMode, language: Language, title: string): Habit {
  const habit = createHabitFromSacredPractice(practice, snapshot.startedDate, calendarMode, language);
  const deadline = addCivilDays(snapshot.sourceDate, 1);
  if (snapshot.startedDate < snapshot.sourceDate || snapshot.startedDate > deadline) throw new RangeError("PRACTICE_DIVINATION_EXPIRED");
  const recurrence = convertTrackerRecurrenceCalendar({ ...habit.schedule.recurrence,
    enabled: true, mode: "classic", pattern: "daily", days: [1], interval: 1, months: [], pyatas: [],
  }, calendarMode, snapshot.startedDate);
  return { ...habit, title, description: `${snapshot.intention}\n\n${snapshot.practiceText}\n\n${snapshot.action}`,
    schedule: { ...habit.schedule, endDate: deadline, recurrence: { ...recurrence, rangeEnd: deadline } }, stoicheionRestoration: snapshot };
}

export function isEligibleRestorationHabit(habit: Habit): boolean {
  return habit.active && habitLifecycleState(habit).status === "active" && habit.schedule.recurrence.enabled
    && !habit.stoicheionRestoration && !habit.sacredPracticeId && !habit.practiceGoal && !habit.measurement && !habit.intervalSchedule && !habit.periodGoal
    && ["none", "binary"].includes(habit.scoringMode);
}
