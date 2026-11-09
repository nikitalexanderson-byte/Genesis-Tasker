import type { CalendarMode } from "./calendar-data.ts";
import type { Habit, HabitCompletion } from "./habits.ts";
import type { TrackerSchedule } from "./tracker-core.ts";

export type HabitRitualId = "none" | "morning" | "day" | "evening" | "custom";

export type HabitRitualGroup = {
  id: string;
  title: string;
  habits: Habit[];
};

export type AdaptiveHabitSuggestion = {
  habit: Habit;
  scheduledCount: number;
  completedCount: number;
  completionRate: number;
  windowDays: number;
};

export const HABIT_RITUAL_OPTIONS: readonly { id: HabitRitualId; title: string; titleEn: string }[] = [
  { id: "none", title: "Без ритуала", titleEn: "No ritual" },
  { id: "morning", title: "Утро", titleEn: "Morning" },
  { id: "day", title: "День", titleEn: "Day" },
  { id: "evening", title: "Вечер", titleEn: "Evening" },
  { id: "custom", title: "Своя группа", titleEn: "Custom group" },
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, days: number) {
  const date = localDate(value);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

export function normalizeHabitRitualId(value: unknown): HabitRitualId {
  return HABIT_RITUAL_OPTIONS.some((option) => option.id === value) ? value as HabitRitualId : "none";
}

export function normalizeHabitRitualName(value: unknown) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").slice(0, 60) : "";
}

export function normalizeKeyHabitSelection<T extends { id: string; isKeyHabit: boolean; updatedAt?: string; version?: number }>(habits: readonly T[]) {
  const selected = [...habits]
    .filter((habit) => habit.isKeyHabit)
    .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "") || (right.version ?? 0) - (left.version ?? 0) || left.id.localeCompare(right.id))[0];
  if (!selected) return [...habits];
  return habits.map((habit) => habit.id === selected.id || !habit.isKeyHabit ? habit : { ...habit, isKeyHabit: false });
}

export function suggestedHabitRitual(time: string): HabitRitualId {
  const hour = Number(time.slice(0, 2));
  if (!Number.isFinite(hour)) return "none";
  if (hour < 12) return "morning";
  if (hour >= 18) return "evening";
  return "day";
}

export function habitRitualLabel(habit: Pick<Habit, "ritualId" | "ritualName">, isEnglish: boolean) {
  if (habit.ritualId === "custom") return normalizeHabitRitualName(habit.ritualName) || (isEnglish ? "Custom ritual" : "Свой ритуал");
  const option = HABIT_RITUAL_OPTIONS.find((item) => item.id === habit.ritualId) ?? HABIT_RITUAL_OPTIONS[0];
  return isEnglish ? option.titleEn : option.title;
}

export function groupHabitsByRitual(habits: readonly Habit[], isEnglish: boolean): HabitRitualGroup[] {
  const groups = new Map<string, HabitRitualGroup>();
  habits.forEach((habit) => {
    const customName = habit.ritualId === "custom" ? normalizeHabitRitualName(habit.ritualName).toLocaleLowerCase() : "";
    const id = habit.ritualId === "custom" ? `custom:${customName || "default"}` : habit.ritualId;
    const group = groups.get(id) ?? { id, title: habitRitualLabel(habit, isEnglish), habits: [] };
    group.habits.push(habit);
    groups.set(id, group);
  });
  const order = new Map(["morning", "day", "evening", "none"].map((id, index) => [id, index]));
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      habits: [...group.habits].sort((left, right) => Number(right.isKeyHabit) - Number(left.isKeyHabit) || right.priority - left.priority || left.title.localeCompare(right.title)),
    }))
    .sort((left, right) => (order.get(left.id) ?? 3) - (order.get(right.id) ?? 3) || left.title.localeCompare(right.title));
}

export function buildAdaptiveHabitSuggestions(input: {
  habits: readonly Habit[];
  completions: readonly HabitCompletion[];
  today: string;
  calendarMode: CalendarMode;
  isScheduledForDate: (schedule: TrackerSchedule, date: string, calendarMode: CalendarMode) => boolean;
  windowDays?: number;
  minimumOccurrences?: number;
  threshold?: number;
}) {
  const windowDays = Math.max(14, Math.min(90, Math.round(input.windowDays ?? 28)));
  const minimumOccurrences = Math.max(4, Math.round(input.minimumOccurrences ?? 6));
  const threshold = Math.max(10, Math.min(70, Math.round(input.threshold ?? 40)));
  const end = addDays(input.today, -1);
  const start = addDays(input.today, -windowDays);
  const completed = new Set(input.completions
    .filter((entry) => entry.completed && entry.date >= start && entry.date <= end)
    .map((entry) => `${entry.habitId}:${entry.date}`));

  return input.habits.flatMap((habit): AdaptiveHabitSuggestion[] => {
    if (!habit.active || !DATE_PATTERN.test(habit.createdDate) || habit.createdDate > end) return [];
    let scheduledCount = 0;
    let completedCount = 0;
    for (let date = habit.createdDate > start ? habit.createdDate : start; date <= end; date = addDays(date, 1)) {
      if (!input.isScheduledForDate(habit.schedule, date, input.calendarMode)) continue;
      scheduledCount += 1;
      if (completed.has(`${habit.id}:${date}`)) completedCount += 1;
    }
    if (scheduledCount < minimumOccurrences) return [];
    const completionRate = Math.round(completedCount / scheduledCount * 100);
    return completionRate < threshold ? [{ habit, scheduledCount, completedCount, completionRate, windowDays }] : [];
  }).sort((left, right) => left.completionRate - right.completionRate || right.scheduledCount - left.scheduledCount);
}
