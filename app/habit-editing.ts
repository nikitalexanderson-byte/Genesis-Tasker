import type { Habit, HabitWorkspace } from "./habits";
import type { TrackerSyncState } from "./tracker-core";
import { addCivilDays, momentCivilDate } from "./calendar-context.ts";
import { normalizeHabitMeasurement, habitRuleForDate, normalizeHabitRuleHistory } from "./habit-measurement.ts";
import { habitGoalPeriod, normalizeHabitPeriodGoal } from "./habit-period-goal.ts";
import { habitRuleFrontier } from "./habit-rule-history.ts";
import { normalizePracticeGoal } from "./habit-practice-policy.ts";
import { prepareHabitAutoDelete } from "./habit-auto-delete.ts";

/** Selects the first tracking day before the habit is saved for the first time. */
export function setNewHabitStartDate(habit: Habit, startDate: string, earliestDate: string): Habit {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || startDate < earliestDate) return habit;
  const rangeEnd = habit.schedule.recurrence.rangeEnd;
  const endDate = habit.schedule.endDate;
  return {
    ...habit,
    createdDate: startDate,
    ...(habit.practiceGoal ? { practiceGoal: { ...habit.practiceGoal, startDate } } : {}),
    schedule: {
      ...habit.schedule,
      startDate,
      endDate: endDate && endDate < startDate ? startDate : endDate,
      recurrence: {
        ...habit.schedule.recurrence,
        rangeStart: startDate,
        rangeEnd: rangeEnd && rangeEnd < startDate ? startDate : rangeEnd,
      },
    },
  };
}

/**
 * Applies user-editable habit settings while preserving the fields that define
 * scoring, ownership of the original template/practice and the first tracking
 * day. This guard belongs in the domain layer so a stale or modified client
 * cannot silently change the XP formula after a habit has been created.
 */
export function applyEditableHabitUpdate(previous: Habit, candidate: Habit): Habit {
  if (previous.practiceGoal && (!candidate.schedule.endDate || candidate.schedule.endDate < candidate.schedule.startDate
    || previous.schedule.endDate && momentCivilDate(new Date(), previous.schedule.timezone) > previous.schedule.endDate
      && JSON.stringify(previous.schedule) !== JSON.stringify(candidate.schedule)))
    throw new RangeError("PRACTICE_CLOSED_OR_DEADLINE_REQUIRED");
  const frontier = habitRuleFrontier(previous);
  if (frontier.length > 1) throw new RangeError("HABIT_RULE_CONFLICT");
  const measurement = normalizeHabitMeasurement(candidate.measurement);
  const periodGoal = normalizeHabitPeriodGoal(candidate.periodGoal);
  if (periodGoal?.metric === "sum" && !measurement) throw new RangeError("HABIT_PERIOD_MEASUREMENT_REQUIRED");
  const ruleChanged = JSON.stringify(previous.measurement ?? null) !== JSON.stringify(measurement)
    || JSON.stringify(previous.schedule) !== JSON.stringify(candidate.schedule)
    || JSON.stringify(previous.periodGoal ?? null) !== JSON.stringify(periodGoal);
  const previousRules = previous.ruleHistory ?? [];
  const baseline = habitRuleForDate(previous, previous.createdDate);
  const schedule = { ...candidate.schedule, startDate: previous.schedule.startDate,
    recurrence: { ...candidate.schedule.recurrence, rangeStart: previous.schedule.recurrence.rangeStart } };
  const transitionGoal = habitRuleForDate(previous, momentCivilDate(new Date(), previous.schedule.timezone)).periodGoal ?? periodGoal;
  const effectiveDate = transitionGoal
    ? habitGoalPeriod(transitionGoal, momentCivilDate(new Date(), transitionGoal.context.timeZone)).end
    : previous.practiceGoal ? momentCivilDate(new Date(), previous.schedule.timezone)
    : addCivilDays(momentCivilDate(new Date(), previous.schedule.timezone), 1);
  const ruleHistory = ruleChanged ? normalizeHabitRuleHistory([
    ...(previousRules.length ? previousRules : [baseline]),
    { id: `rule:${crypto.randomUUID()}`,
      effectiveDate, recordedAt: candidate.updatedAt, schedule, measurement,
      supersedes: (frontier.length ? frontier : [baseline]).map(rule => rule.id), ...(periodGoal ? { periodGoal } : {}) },
  ]) : previousRules;
  return {
    ...candidate,
    autoDeletePolicy: prepareHabitAutoDelete(candidate.autoDeletePolicy, previous.autoDeletePolicy,
      momentCivilDate(new Date(), previous.schedule.timezone)),
    measurement,
    periodGoal,
    ruleHistory,
    id: previous.id,
    active: previous.active,
    lifecycleHistory: previous.lifecycleHistory,
    createdAt: previous.createdAt,
    createdDate: previous.createdDate,
    sourceTemplateId: previous.sourceTemplateId,
    sacredPracticeId: previous.sacredPracticeId,
    sacredSectorId: previous.sacredSectorId,
    stoicheionRestoration: previous.stoicheionRestoration,
    ...(previous.practiceGoal ? { practiceGoal: normalizePracticeGoal(previous.practiceGoal) } : { practiceGoal: null }),
    scoringMode: previous.scoringMode,
    qualityScale: previous.qualityScale,
    schedule,
  };
}

/** An explicit causal choice retains both alternatives and the selected event rule IDs. */
export function resolveHabitRuleConflict(previous: Habit, chosenId: string, expectedHeads: readonly string[],
  operationId = `rule-choice:${crypto.randomUUID()}`, timestamp = new Date().toISOString()): Habit {
  const replay = previous.ruleHistory?.find(rule => rule.id === operationId);
  if (replay) {
    if (replay.selectedRuleId !== chosenId || JSON.stringify(replay.supersedes) !== JSON.stringify([...expectedHeads].sort()))
      throw new RangeError("HABIT_RULE_ID_CONFLICT");
    return previous;
  }
  const frontier = habitRuleFrontier(previous), chosen = frontier.find(rule => rule.id === chosenId);
  if (frontier.length < 2 || !chosen || JSON.stringify(frontier.map(rule => rule.id).sort()) !== JSON.stringify([...expectedHeads].sort()))
    throw new RangeError("HABIT_RULE_EDIT_CONFLICT");
  const selected = { ...chosen, id: operationId, recordedAt: timestamp,
    effectiveDate: frontier.map(rule => rule.effectiveDate).sort().at(-1)!,
    supersedes: frontier.map(rule => rule.id).sort(), selectedRuleId: chosen.id };
  return { ...previous, measurement: chosen.measurement, schedule: chosen.schedule, periodGoal: chosen.periodGoal ?? null,
    ruleHistory: normalizeHabitRuleHistory([...(previous.ruleHistory ?? []), selected]),
    updatedAt: timestamp, version: previous.version + 1, syncState: "pending" };
}

export function applyHabitReminderSyncResult(
  workspace: HabitWorkspace,
  habitId: string,
  external: Pick<Habit["reminder"], "googleTaskId" | "googleEventId">,
  updatedAt: string,
): HabitWorkspace {
  return {
    ...workspace,
    habits: workspace.habits.map((habit) => habit.id === habitId ? {
      ...habit,
      reminder: { ...habit.reminder, ...external },
      updatedAt,
      version: habit.version + 1,
      syncState: "pending" as TrackerSyncState,
    } : habit),
  };
}
