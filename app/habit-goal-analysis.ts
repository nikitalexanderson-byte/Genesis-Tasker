import { addCivilDays, isCivilDate, momentCivilDate } from "./calendar-context.ts";
import { effectiveHabitMeasurement, habitMeasurementProgress } from "./habit-measurement.ts";
import { habitRuleState } from "./habit-rule-history.ts";
import { habitLifecycleState } from "./habit-lifecycle.ts";
import { habitHistoryState } from "./habit-history.ts";
import { habitPeriodProgress } from "./habit-period-progress.ts";
import { habitGoalPeriod } from "./habit-period-goal.ts";
import { isTrackerScheduledForDate } from "./tracker-core.ts";
import type { Habit, HabitCompletion, HabitWorkspace } from "./habits.ts";
import { currentHabitCompletions } from "./habit-completion-state.ts";
export { currentHabitCompletions } from "./habit-completion-state.ts";

type Workspace = Pick<HabitWorkspace, "habitCompletions" | "habitMeasurements" | "habitHistory">;
export type HabitActivityStatus = "completed" | "activity" | "partial" | "quality-pending" | "skipped" | "unmarked" | "missing" | "conflict";
export type HabitAnalysisDay = {
  date: string; today: string; scheduled: boolean; availabilityKnown: boolean; future: boolean; beforeCreation: boolean;
  availability: "active" | "paused" | "archived" | "deleted"; activity: HabitActivityStatus;
  volume: number; target: number | null; unit: string | null; kind: "quantity" | "duration" | "binary";
  period: "week" | "month" | null; metric: "day" | "days" | "entries" | "sum"; ruleId: string; completed: boolean; hasRecord: boolean; completion: HabitCompletion | null;
  recordIds: string[]; periodKey: string | null;
};
export type HabitGoalOpportunity = { key: string; start: string; end: string; deadline: string | null; period: "day" | "week" | "month";
  metric: "days" | "entries" | "sum"; value: number; target: number; completed: boolean; closed: boolean; eligible: boolean;
  qualityPending: boolean; conflict: boolean; partial: boolean; availabilityKnown: boolean; ruleId: string };
export type HabitVolumeAnalysis = { kind: "quantity" | "duration"; unit: string; actual: number; target: number;
  openActual: number; extraActual: number; unknownActual: number; hasPlan: boolean; plan: "fixed" | "flexible"; conflicts: number; percent: number | null };

/** Old active flags do not document when historical pauses started. Today is observed; older availability needs a journal. */
export function habitAvailabilityKnown(habit: Habit, date: string, today: string) {
  if (date >= today) return true;
  const first = habit.lifecycleHistory?.map(row => row.date).sort()[0];
  return Boolean(first && date >= first && !habitLifecycleState(habit, date).unknown);
}

export function analyzeHabitDay(workspace: Workspace, habit: Habit, date: string, now = new Date(), index?: Map<string, HabitCompletion>): HabitAnalysisDay {
  if (!isCivilDate(date)) throw Error("INVALID_CALENDAR_DATE");
  const { rule, conflicts: ruleConflicts } = habitRuleState(habit, date), definition = effectiveHabitMeasurement(rule);
  const today = momentCivilDate(now, rule.periodGoal?.context.timeZone ?? rule.schedule.timezone), lifecycle = habitLifecycleState(habit, date);
  const completion = (index ?? currentHabitCompletions(workspace, habit.id)).get(date) ?? null;
  const measured = definition ? habitMeasurementProgress(habit, date, workspace.habitMeasurements) : null;
  const history = habitHistoryState(workspace.habitHistory, habit.id, date);
  const beforeCreation = date < habit.createdDate, future = date > today;
  const scheduled = !beforeCreation && !ruleConflicts.length && lifecycle.status === "active" && !lifecycle.conflict
    && isTrackerScheduledForDate(rule.schedule, date, rule.periodGoal?.calendar ?? "profane");
  const qualityPending = Boolean(definition && measured!.total > 0 && habit.qualityScale !== "none" && !completion?.qualityConfirmedAt);
  const conflict = lifecycle.conflict || ruleConflicts.length > 0 || history.conflict || Boolean(measured && (measured.conflicts.length || measured.incompatible));
  const completed = definition ? Boolean(measured?.completed && !qualityPending) : Boolean(completion?.completed);
  const hasActivity = Boolean(measured?.total || completion?.completed), flexibleActivity = rule.periodGoal && rule.periodGoal.metric !== "days";
  const activity: HabitActivityStatus = conflict ? "conflict" : completed && !flexibleActivity ? "completed"
    : completion?.skippedAt ? "skipped" : qualityPending ? "quality-pending" : hasActivity ? flexibleActivity ? "activity" : "partial"
      : completion || measured?.entries.length ? "unmarked" : "missing";
  const period = rule.periodGoal ? habitGoalPeriod(rule.periodGoal, date) : null;
  return { date, today, scheduled, availabilityKnown: habitAvailabilityKnown(habit, date, today), future, beforeCreation,
    availability: lifecycle.status, activity, volume: measured?.total ?? Number(completed),
    target: rule.periodGoal && rule.periodGoal.metric !== "days" ? null : definition?.target ?? 1,
    unit: definition?.unit ?? null, kind: definition?.kind ?? "binary", period: rule.periodGoal?.period ?? null, metric: rule.periodGoal?.metric ?? "day",
    ruleId: rule.id, completed, hasRecord: Boolean(completion || measured?.entries.length || history.rows.length), completion,
    recordIds: [...workspace.habitCompletions.filter(row => row.habitId === habit.id && row.date === date).map(row => row.id),
      ...(measured?.entries.flatMap(row => row.revisions.map(item => item.id)) ?? []), ...history.rows.map(row => row.id)],
    periodKey: period ? `${rule.id}:${period.start}:${period.end}` : null };
}

/** Closed goals and volume use separate denominators. No stored row or award is changed by a report. */
export function analyzeHabitRange(workspace: Workspace, habit: Habit, range: { start: string; end: string }, now = new Date()) {
  if (!isCivilDate(range.start) || !isCivilDate(range.end) || range.end <= range.start) throw Error("INVALID_CALENDAR_DATE");
  const current = currentHabitCompletions(workspace, habit.id), projected: Workspace = { ...workspace, habitCompletions: [...current.values()] };
  const days: HabitAnalysisDay[] = [], opportunities: HabitGoalOpportunity[] = [], periods = new Map<string, string>();
  const volumes = new Map<string, HabitVolumeAnalysis>();
  const volume = (day: HabitAnalysisDay) => {
    if (day.kind === "binary" || !day.unit) return null;
    const plan = day.period && day.metric !== "sum" ? "flexible" : "fixed", key = `${day.kind}:${day.unit}:${plan}`;
    if (!volumes.has(key)) volumes.set(key, { kind: day.kind, unit: day.unit, plan, actual: 0, target: 0, openActual: 0, extraActual: 0, unknownActual: 0, conflicts: 0, hasPlan: false, percent: null });
    return volumes.get(key)!;
  };
  for (let date = range.start; date < range.end; date = addCivilDays(date, 1)) {
    const day = analyzeHabitDay(projected, habit, date, now, current); days.push(day);
    if (day.beforeCreation || day.future) continue;
    const data = volume(day);
    if (data && day.activity === "conflict") data.conflicts++;
    if (!day.scheduled) { if (data) data.extraActual += day.volume; continue; }
    if (day.periodKey) { periods.set(day.periodKey, date); continue; }
    const closed = date < day.today, eligible = closed && day.availabilityKnown && day.activity !== "conflict";
    opportunities.push({ key: date, start: date, end: addCivilDays(date, 1), deadline: date, period: "day", metric: day.kind === "binary" ? "days" : "sum",
      value: day.volume, target: day.target!, completed: day.completed, closed, eligible, qualityPending: day.activity === "quality-pending",
      conflict: day.activity === "conflict", partial: false, availabilityKnown: day.availabilityKnown, ruleId: day.ruleId });
    if (data) {
      if (closed && day.availabilityKnown && day.activity !== "conflict") { data.actual += day.volume; data.target += day.target!; data.hasPlan = true; }
      else if (closed) data.unknownActual += day.volume;
      else data.openActual += day.volume;
    }
  }
  for (const [key, date] of periods) {
    const period = habitPeriodProgress(habit, date, projected, now)!;
    const today = momentCivilDate(now, period.goal.context.timeZone), closed = Boolean(period.deadline && period.deadline < today);
    const availabilityKnown = period.allowedDays.every(day => habitAvailabilityKnown(habit, day, today));
    const withinRange = period.start >= range.start && period.end <= range.end;
    const eligible = closed && availabilityKnown && withinRange && !period.conflicts && period.status !== "neutral";
    opportunities.push({ key, start: period.start, end: period.end, deadline: period.deadline, period: period.goal.period,
      metric: period.goal.metric, value: period.value, target: period.goal.target, completed: period.completed, closed, eligible,
      qualityPending: period.qualityPending, conflict: period.conflicts, partial: period.partial || !withinRange,
      availabilityKnown, ruleId: period.rule.id });
    const sample = days.find(day => day.periodKey === key)!, data = volume(sample);
    if (data) {
      const amount = days.filter(day => day.periodKey === key && day.scheduled && !day.future).reduce((sum, day) => sum + day.volume, 0);
      if (closed) {
        if (!availabilityKnown) data.unknownActual += amount;
        else if (eligible) { data.actual += amount; if (period.goal.metric === "sum") { data.target += period.goal.target; data.hasPlan = true; } }
        else data.extraActual += amount;
      } else data.openActual += amount;
      if (period.conflicts) data.conflicts++;
    }
  }
  const eligible = opportunities.filter(row => row.eligible), completed = eligible.filter(row => row.completed).length;
  const unresolvedCount = days.filter(row => row.date < row.today && row.activity === "conflict").length;
  for (const row of volumes.values()) row.percent = row.hasPlan && row.target > 0 && !row.conflicts ? row.actual / row.target * 100 : null;
  return { habitId: habit.id, ...range, days, opportunities, closedCount: eligible.length, completedCount: completed,
    completionPercent: eligible.length && !unresolvedCount ? completed / eligible.length * 100 : null, unresolvedCount,
    unknownDays: days.filter(day => !day.future && !day.beforeCreation && !day.availabilityKnown).length,
    open: opportunities.filter(row => !row.closed && !row.conflict), volumes: [...volumes.values()] };
}
