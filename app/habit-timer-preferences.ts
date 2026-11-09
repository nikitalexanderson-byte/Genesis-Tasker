export type HabitTimerPreferences = {
  modes: ("stopwatch" | "pomodoro")[];
  workMinutes: number;
  breakMinutes: number;
  progress: "duration" | "time-only";
};

export const DEFAULT_HABIT_TIMER_PREFERENCES: HabitTimerPreferences = {
  modes: ["stopwatch", "pomodoro"], workMinutes: 25, breakMinutes: 5, progress: "duration",
};

export function normalizeHabitTimerPreferences(value: unknown): HabitTimerPreferences | null {
  if (value === undefined || value === null) return null;
  const row = value as HabitTimerPreferences;
  if (!Array.isArray(row.modes) || !row.modes.length || new Set(row.modes).size !== row.modes.length
    || row.modes.some(mode => mode !== "stopwatch" && mode !== "pomodoro")
    || !Number.isInteger(row.workMinutes) || row.workMinutes < 1 || row.workMinutes > 180
    || !Number.isInteger(row.breakMinutes) || row.breakMinutes < 0 || row.breakMinutes > 120
    || !["duration", "time-only"].includes(row.progress)) throw new RangeError("INVALID_HABIT_TIMER_PREFERENCES");
  return { modes: DEFAULT_HABIT_TIMER_PREFERENCES.modes.filter(mode => row.modes.includes(mode)),
    workMinutes: row.workMinutes, breakMinutes: row.breakMinutes, progress: row.progress };
}

export function habitTimerPreferences(habit?: { timerPreferences?: HabitTimerPreferences | null }) {
  return habit?.timerPreferences ?? DEFAULT_HABIT_TIMER_PREFERENCES;
}
