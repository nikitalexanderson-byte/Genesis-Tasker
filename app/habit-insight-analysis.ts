import type { CalendarMode } from "./calendar-data";
import type { Habit, HabitWorkspace } from "./habits";
import { addCivilDays, calendarContext, civilDayNumber, type CalendarContext } from "./calendar-context.ts";
import { habitGoalPeriod } from "./habit-period-goal.ts";
import { analyzeHabitRange, currentHabitCompletions } from "./habit-goal-analysis.ts";
import { buildHabitPersonalRecord, type HabitPersonalRecord } from "./habit-insights.ts";

/** Compare equally elapsed closed civil dates; an open weekly/monthly goal is never a failure. */
export function buildHabitGoalComparison(workspace: HabitWorkspace, today: string, mode: CalendarMode, context?: CalendarContext, now = new Date()) {
  const ctx = calendarContext(context), definition = { version: 1 as const, period: "week" as const, metric: "days" as const, target: 1, calendar: mode, context: ctx };
  const period = habitGoalPeriod(definition, today), previousPeriod = habitGoalPeriod(definition, addCivilDays(period.start, -1));
  const elapsed = Math.min(civilDayNumber(today) - civilDayNumber(period.start), civilDayNumber(previousPeriod.end) - civilDayNumber(previousPeriod.start));
  const aggregate = (start: string, end: string) => {
    const reports = start < end ? workspace.habits.map(habit => analyzeHabitRange(workspace, habit, { start, end }, now)) : [];
    const completed = reports.reduce((sum, row) => sum + row.completedCount, 0), planned = reports.reduce((sum, row) => sum + row.closedCount, 0);
    return { completed, planned, percent: planned ? completed / planned * 100 : null,
      unknown: reports.reduce((sum, row) => sum + row.unknownDays, 0), conflicts: reports.reduce((sum, row) => sum + row.unresolvedCount, 0) };
  };
  const current = aggregate(period.start, addCivilDays(period.start, elapsed));
  const previous = aggregate(previousPeriod.start, addCivilDays(previousPeriod.start, elapsed));
  const open = workspace.habits.flatMap(habit => analyzeHabitRange(workspace, habit, { start: period.start, end: addCivilDays(today, 1) }, now).open).length;
  return { current, previous, elapsed, start: period.start, previousStart: previousPeriod.start,
    previousEnd: elapsed ? addCivilDays(previousPeriod.start, elapsed - 1) : null, open,
    absoluteChange: current.completed - previous.completed,
    changePercent: current.planned && previous.planned && previous.completed && !current.conflicts && !previous.conflicts
      ? (current.completed - previous.completed) / previous.completed * 100 : null };
}

/** Personal percentages use the same opportunities as the detailed report, preserving all source completions. */
export function buildAnalyzedHabitPersonalRecord(workspace: HabitWorkspace, habit: Habit, today: string, mode: CalendarMode,
  monthPresentation: (date: string) => { key: string; label: string }, now = new Date()): HabitPersonalRecord {
  if (habit.createdDate > today) return buildHabitPersonalRecord(habit, [], today, mode, () => false, monthPresentation);
  const report = analyzeHabitRange(workspace, habit, { start: habit.createdDate, end: addCivilDays(today, 1) }, now);
  const hasPeriods = report.opportunities.some(row => row.period !== "day");
  const completions = hasPeriods ? report.opportunities.filter(row => row.completed && !row.conflict).map(row => ({
    habitId: habit.id, date: row.deadline ?? row.start, completed: true,
  })).filter(row => row.date <= today) : [...currentHabitCompletions(workspace, habit.id).values()];
  const eligible = report.opportunities.filter(row => row.eligible);
  const slots = new Set(eligible.map(row => row.deadline ?? row.start));
  const base = buildHabitPersonalRecord(habit, completions, today, mode, (_habit, date) => slots.has(date), monthPresentation);
  let run = 0, best = 0;
  for (const row of report.opportunities.filter(row => row.eligible || !row.closed && row.completed && row.availabilityKnown && !row.conflict).sort((a, b) => a.start.localeCompare(b.start))) {
    run = row.completed ? run + 1 : 0; best = Math.max(best, run);
  }
  return { ...base, periodUnit: hasPeriods ? habit.periodGoal?.period ?? undefined : undefined, unknownDays: report.unknownDays,
    currentStreak: run, longestStreak: best, scheduledCount: report.closedCount, scheduledCompletedCount: report.completedCount,
    completionRate: report.completionPercent === null ? null : Math.round(report.completionPercent),
    unscheduledCompletions: Math.max(0, base.totalCompletions - report.completedCount) };
}
