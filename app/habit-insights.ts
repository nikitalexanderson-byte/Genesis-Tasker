import type { CalendarMode } from "./calendar-data";
import type { DailyGoalRecord } from "./daily-goal";
import type { Habit, HabitCompletion, HabitWorkspace } from "./habits";
import { addCivilDays, calendarContext, civilDayNumber, isCivilDate, momentCivilDate, type CalendarContext } from "./calendar-context.ts";
import { habitGoalPeriod } from "./habit-period-goal.ts";
import { currentHabitCompletions } from "./habit-completion-state.ts";

type InsightCompletion = Pick<HabitCompletion, "habitId" | "date" | "completed">;

export const HABIT_MASTERY_MILESTONES = [7, 30, 50, 100, 365, 500, 1_000] as const;

export type HabitWeeklySummary = {
  startDate: string;
  endDate: string;
  completed: number;
  dailyGoals: number;
  perfectDays: number;
  xp: number;
  laurels: number;
  bestHabitTitle: string | null;
  bestHabitId: string | null;
  bestHabitCompleted: number;
  previousCompleted: number;
  changePercent: number | null;
  absoluteChange: number;
  currentComparableCompleted: number;
  previousStartDate: string;
  previousEndDate: string;
  comparedDays: number;
  previousHasData: boolean;
};

export type HabitPersonalRecord = {
  unknownDays?: number;
  periodUnit?: "week" | "month";
  habitId: string;
  currentStreak: number;
  longestStreak: number;
  totalCompletions: number;
  scheduledCount: number;
  scheduledCompletedCount: number;
  unscheduledCompletions: number;
  completionRate: number | null;
  bestMonth: string | null;
  bestMonthCompletions: number;
  startedAt: string;
  reachedMilestone: number;
  nextMilestone: number | null;
  milestoneProgress: number;
};

export type HabitYearMosaicCell = {
  date: string;
  status: "future" | "none" | "partial" | "qualified" | "perfect" | "rest";
  completed: number;
  scheduled: number;
  week: number;
  weekday: number;
};

function localDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day, 12);
}

function dateKey(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

function addDays(value: string, amount: number) {
  const date = localDate(value);
  date.setDate(date.getDate() + amount);
  return dateKey(date);
}

function datesBetween(start: string, end: string, maximum = 20_000) {
  const values: string[] = [];
  for (let date = start; date <= end && values.length < maximum; date = addDays(date, 1)) values.push(date);
  return values;
}

function rewardDate(transaction: HabitWorkspace["rewardTransactions"][number], timeZone: string) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(transaction.sourceId)) return transaction.sourceId;
  return Number.isFinite(Date.parse(transaction.createdAt)) ? momentCivilDate(new Date(transaction.createdAt), timeZone) : "";
}

function weekMetrics(workspace: HabitWorkspace, startDate: string, endDate: string, timeZone: string) {
  const entries = workspace.habitCompletions.filter(entry => entry.date >= startDate && entry.date <= endDate);
  const unique = new Map<string, HabitCompletion>();
  for (const entry of entries) {
    const key = `${entry.habitId}:${entry.date}`, previous = unique.get(key);
    if (!previous || entry.completed && !previous.completed || entry.completed === previous.completed && entry.xpAwarded > previous.xpAwarded) unique.set(key, entry);
  }
  const latest = workspace.habits.flatMap(habit => [...currentHabitCompletions(workspace, habit.id).values()]);
  const completions = latest.filter(entry => entry.date >= startDate && entry.date <= endDate && entry.completed);
  const perHabit = new Map<string, number>();
  completions.forEach((entry) => perHabit.set(entry.habitId, (perHabit.get(entry.habitId) ?? 0) + 1));
  const best = Array.from(perHabit.entries()).sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0];
  const records = workspace.dailyGoalRecords.filter((record) => record.date >= startDate && record.date <= endDate);
  return {
    completed: completions.length,
    hasData: entries.length > 0 || records.length > 0 || (workspace.habitMeasurements ?? []).some(entry => entry.date >= startDate && entry.date <= endDate),
    dailyGoals: records.filter((record) => record.status === "qualified" || record.status === "perfect").length,
    perfectDays: records.filter((record) => record.status === "perfect").length,
    xp: [...unique.values()].reduce((total, entry) => total + Math.max(0, entry.xpAwarded), 0),
    laurels: workspace.rewardTransactions
      .filter((transaction) => transaction.amount > 0 && rewardDate(transaction, timeZone) >= startDate && rewardDate(transaction, timeZone) <= endDate)
      .reduce((total, transaction) => total + transaction.amount, 0),
    bestHabitTitle: best ? workspace.habits.find((habit) => habit.id === best[0])?.title ?? null : null,
    bestHabitId: best?.[0] ?? null,
    bestHabitCompleted: best?.[1] ?? 0,
  };
}

export function buildWeeklyHabitSummary(workspace: HabitWorkspace, today: string, mode: CalendarMode = "profane", context?: CalendarContext): HabitWeeklySummary {
  const savedContext = calendarContext(context);
  const definition = { version: 1 as const, period: "week" as const, metric: "days" as const, target: 1, calendar: mode, context: savedContext };
  const period = habitGoalPeriod(definition, today);
  const startDate = period.start;
  const endDate = today;
  const previousPeriod = habitGoalPeriod(definition, addCivilDays(startDate, -1));
  const comparedDays = Math.min(civilDayNumber(today) - civilDayNumber(startDate) + 1,
    civilDayNumber(previousPeriod.end) - civilDayNumber(previousPeriod.start));
  const previousStartDate = previousPeriod.start, previousEndDate = addCivilDays(previousStartDate, comparedDays - 1);
  const current = weekMetrics(workspace, startDate, endDate, savedContext.timeZone);
  const comparable = weekMetrics(workspace, startDate, addCivilDays(startDate, comparedDays - 1), savedContext.timeZone);
  const previous = weekMetrics(workspace, previousStartDate, previousEndDate, savedContext.timeZone);
  const absoluteChange = comparable.completed - previous.completed;
  const changePercent = previous.completed ? Math.round(absoluteChange / previous.completed * 100) : null;
  return { ...current, startDate, endDate, previousCompleted: previous.completed, changePercent,
    absoluteChange, currentComparableCompleted: comparable.completed, previousStartDate, previousEndDate, comparedDays, previousHasData: previous.hasData };
}

function completionSet(completions: readonly InsightCompletion[], habitId: string) {
  return new Set(completions.filter((entry) => entry.habitId === habitId && entry.completed).map((entry) => entry.date));
}

export function buildHabitPersonalRecord(
  habit: Habit,
  completions: readonly InsightCompletion[],
  today: string,
  calendarMode: CalendarMode,
  isScheduledForDate: (habit: Habit, date: string, calendarMode: CalendarMode) => boolean,
  monthPresentation: (date: string) => { key: string; label: string } = (date) => ({ key: date.slice(0, 7), label: date.slice(0, 7) }),
): HabitPersonalRecord {
  const endDate = habit.schedule.endDate && habit.schedule.endDate < today ? habit.schedule.endDate : today;
  const dates = endDate >= habit.createdDate ? datesBetween(habit.createdDate, endDate) : [];
  const completedDates = completionSet(completions.filter(entry => entry.habitId === habit.id && isCivilDate(entry.date)
    && entry.date >= habit.createdDate && entry.date <= today), habit.id);
  const scheduledDates = dates.filter((date) => isScheduledForDate(habit, date, calendarMode));
  const scheduledCompletedCount = scheduledDates.filter(date => completedDates.has(date)).length;
  let currentStreak = 0;
  let longestStreak = 0;
  let run = 0;
  scheduledDates.forEach((date) => {
    if (completedDates.has(date)) {
      run += 1;
      longestStreak = Math.max(longestStreak, run);
      currentStreak = run;
    } else if (date !== today) {
      run = 0;
      currentStreak = 0;
    }
  });
  const byMonth = new Map<string, { count: number; label: string }>();
  completedDates.forEach((date) => {
    const presentation = monthPresentation(date);
    const key = presentation.key;
    const current = byMonth.get(key);
    byMonth.set(key, {
      count: (current?.count ?? 0) + 1,
      label: current?.label ?? presentation.label,
    });
  });
  const bestMonth = Array.from(byMonth.entries()).sort((left, right) => right[1].count - left[1].count || right[0].localeCompare(left[0]))[0];
  const totalCompletions = completedDates.size;
  const reachedMilestone = [...HABIT_MASTERY_MILESTONES].reverse().find((milestone) => totalCompletions >= milestone) ?? 0;
  const nextMilestone = HABIT_MASTERY_MILESTONES.find((milestone) => totalCompletions < milestone) ?? null;
  const milestoneSpan = nextMilestone ? nextMilestone - reachedMilestone : 1;
  const milestoneProgress = nextMilestone
    ? Math.max(0, Math.min(100, Math.round((totalCompletions - reachedMilestone) / milestoneSpan * 100)))
    : 100;
  return {
    habitId: habit.id,
    currentStreak,
    longestStreak,
    totalCompletions,
    scheduledCount: scheduledDates.length,
    scheduledCompletedCount,
    unscheduledCompletions: totalCompletions - scheduledCompletedCount,
    completionRate: scheduledDates.length ? Math.round(scheduledCompletedCount / scheduledDates.length * 100) : null,
    bestMonth: bestMonth?.[1].label ?? null,
    bestMonthCompletions: bestMonth?.[1].count ?? 0,
    startedAt: habit.createdDate,
    reachedMilestone,
    nextMilestone,
    milestoneProgress,
  };
}

function mosaicStatus(record: DailyGoalRecord | undefined, future: boolean): HabitYearMosaicCell["status"] {
  if (future) return "future";
  if (!record || record.status === "missed" || record.status === "protected") return "none";
  if (record.status === "rest" || record.status === "neutral" || record.status === "timezone-shift") return "rest";
  if (record.status === "perfect") return "perfect";
  if (record.status === "qualified") return "qualified";
  return record.completedCount > 0 ? "partial" : "none";
}

export function buildHabitYearMosaic(records: readonly DailyGoalRecord[], today: string, range?: { start: string; end: string }): HabitYearMosaicCell[] {
  const year = today.slice(0, 4);
  const start = range?.start ?? `${year}-01-01`;
  const end = range?.end ?? `${year}-12-31`;
  const firstWeekday = (localDate(start).getDay() + 6) % 7;
  const byDate = new Map(records.map((record) => [record.date, record]));
  return datesBetween(start, end).map((date, dayIndex) => {
    const record = byDate.get(date);
    return {
      date,
      status: mosaicStatus(record, date > today),
      completed: record?.completedCount ?? 0,
      scheduled: record?.scheduledCount ?? 0,
      week: Math.floor((firstWeekday + dayIndex) / 7) + 1,
      weekday: (firstWeekday + dayIndex) % 7 + 1,
    };
  });
}
