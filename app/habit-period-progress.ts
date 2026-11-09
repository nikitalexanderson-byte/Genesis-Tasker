import { addCivilDays, momentCivilDate } from "./calendar-context.ts";
import { habitGoalPeriod } from "./habit-period-goal.ts";
import { effectiveHabitMeasurement, habitMeasurementProgress, habitRuleForDate } from "./habit-measurement.ts";
import { isTrackerScheduledForDate } from "./tracker-core.ts";
import type { Habit, HabitCompletion, HabitWorkspace } from "./habits";
import { habitRuleState } from "./habit-rule-history.ts";
import { habitLifecycleState } from "./habit-lifecycle.ts";

type PeriodWorkspace = Pick<HabitWorkspace, "habitMeasurements" | "habitCompletions">;

/** Projection only: never manufactures a completion, XP, or reward transaction. */
export function habitPeriodProgress(habit: Habit, date: string, workspace: PeriodWorkspace, now = new Date()) {
  const ruleState = habitRuleState(habit, date), rule = ruleState.rule, goal = rule.periodGoal;
  if (!goal) return null;
  const period = habitGoalPeriod(goal, date);
  const today = momentCivilDate(now, goal.context.timeZone);
  const effectiveStart = [period.start, habit.createdDate, rule.effectiveDate].sort().at(-1)!;
  const days: string[] = [], allowedDays: string[] = [];
  const measurements = (workspace.habitMeasurements ?? []).filter(event => event.habitId === habit.id
    && event.date >= effectiveStart && event.date < period.end);
  const completions = workspace.habitCompletions.filter(entry => entry.habitId === habit.id
    && entry.date >= effectiveStart && entry.date < period.end);
  let value = 0, qualifiedValue = 0, rewardValue = 0, conflicts = Boolean(ruleState.conflicts.length), interrupted = false;
  for (let day = effectiveStart; day < period.end; day = addCivilDays(day, 1)) {
    const applied = habitRuleForDate(habit, day);
    const lifecycle = habitLifecycleState(habit, day);
    if (isTrackerScheduledForDate(rule.schedule, day, goal.calendar) && (applied.id !== rule.id || lifecycle.status !== "active" || lifecycle.conflict)) interrupted = true;
    if (applied.id !== rule.id || lifecycle.status !== "active" || lifecycle.conflict || !isTrackerScheduledForDate(rule.schedule, day, goal.calendar)) continue;
    allowedDays.push(day);
    if (day > today) continue;
    days.push(day);
    const entry = completions.find(item => item.date === day);
    const definition = effectiveHabitMeasurement(applied);
    const measured = definition ? habitMeasurementProgress(habit, day, measurements) : null;
    if (measured && (measured.conflicts.length || measured.incompatible)) conflicts = true;
    const qualityReady = habit.qualityScale === "none" || Boolean(entry?.qualityConfirmedAt);
    if (goal.metric === "sum") {
      if (!definition) throw new RangeError("HABIT_PERIOD_MEASUREMENT_REQUIRED");
      value += measured!.total;
      if (qualityReady) { qualifiedValue += measured!.total; rewardValue += measured!.rewardTotal; }
    } else if (goal.metric === "entries") {
      for (const item of measured?.entries ?? []) {
        if (!item.current?.value || item.current.ruleId !== rule.id) continue;
        value++;
        if (qualityReady) qualifiedValue++;
        const root = item.revisions.find(event => event.id === item.id && !event.replaces.length);
        if (qualityReady && root && !root.historical && root.source !== "import" && !item.current.historical
          && item.current.source !== "import") rewardValue++;
      }
    } else if (entry?.completed) {
      value++;
      qualifiedValue++;
      if (measured ? measured.rewardTotal >= measured.target
        : momentCivilDate(new Date(entry.createdAt), goal.context.timeZone) === day) rewardValue++;
    }
    if (!Number.isSafeInteger(value) || value > 1_000_000_000_000)
      throw new RangeError("HABIT_MEASUREMENT_TOTAL_TOO_LARGE");
  }
  const deadline = allowedDays.at(-1) ?? null;
  const partial = interrupted || effectiveStart > period.start || Boolean(rule.schedule.endDate && rule.schedule.endDate < addCivilDays(period.end, -1));
  const unattainable = goal.metric === "days" && allowedDays.length < goal.target;
  const completed = qualifiedValue >= goal.target && !conflicts;
  return { goal, rule, ...period, effectiveStart, deadline, allowedDays, elapsedDays: days,
    value, qualifiedValue, rewardValue, remaining: Math.max(0, goal.target - value), completed,
    qualityPending: value >= goal.target && qualifiedValue < goal.target,
    rewardEligible: rewardValue >= goal.target && !conflicts && (!ruleState.appliedVersion.selectedRuleId || !deadline
      || momentCivilDate(new Date(ruleState.appliedVersion.recordedAt), goal.context.timeZone) <= deadline),
    conflicts, partial, unattainable,
    status: ruleState.conflicts.length || partial && !completed || unattainable && !completed || !deadline ? "neutral" as const
      : completed ? "completed" as const : today > deadline ? "missed" as const : "open" as const };
}

/** Periodic goals settle once on their final allowed day. Intermediate days are neutral. */
export function habitPeriodSettlement(habit: Habit, date: string, workspace: PeriodWorkspace, now = new Date()) {
  const progress = habitPeriodProgress(habit, date, workspace, now);
  if (!progress || progress.deadline !== date || progress.status === "neutral") return null;
  return { ...progress, completed: progress.completed };
}

/** A streak of periods, independent of the account's display calendar. Open periods do not break it. */
export function habitPeriodStreak(habit: Habit, date: string, workspace: PeriodWorkspace, now = new Date()) {
  let count = 0, cursor = date;
  for (let index = 0; index < 750; index++) {
    const progress = habitPeriodProgress(habit, cursor, workspace, now);
    if (!progress || progress.end <= habit.createdDate) break;
    if (progress.status === "completed" && progress.deadline && progress.deadline <= date) count++;
    else if (progress.status === "missed") break;
    cursor = addCivilDays(progress.start, -1);
    if (cursor < habit.createdDate) break;
  }
  return count;
}

/** Quest projection uses one settlement per periodic goal; the stored event/history remain intact. */
export function habitQuestCompletions(habits: readonly Habit[], workspace: PeriodWorkspace, start: string, end: string, now = new Date(), rewardsOnly = true) {
  const output: Pick<HabitCompletion, "habitId" | "date" | "completed">[] = [];
  for (const habit of habits) for (let date = start; date <= end;) {
    if (habitRuleForDate(habit, date).periodGoal) {
      const result = habitPeriodProgress(habit, date, workspace, now)!;
      if (result.deadline && result.deadline >= start && result.deadline <= end && result.status !== "neutral")
        output.push({ habitId: habit.id, date: result.deadline, completed: result.completed && (!rewardsOnly || result.rewardEligible) });
      const nextRule = habit.ruleHistory?.find(rule => rule.effectiveDate > date && rule.effectiveDate < result.end);
      date = nextRule?.effectiveDate ?? result.end;
    } else {
      output.push(...workspace.habitCompletions.filter(entry => entry.habitId === habit.id && entry.date === date));
      date = addCivilDays(date, 1);
    }
  }
  return output;
}
