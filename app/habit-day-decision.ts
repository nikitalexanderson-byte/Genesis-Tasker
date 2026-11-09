import { isCivilDate, momentCivilDate } from "./calendar-context.ts";
import { habitHistoryInitialValue } from "./habit-history-workspace.ts";
import { habitEconomyHistory, habitHistoryState, mergeHabitHistoryEdits, projectHabitHistory, type HabitHistoryEdit } from "./habit-history.ts";
import { habitRuleState } from "./habit-rule-history.ts";
import { habitLifecycleState } from "./habit-lifecycle.ts";
import { isTrackerScheduledForDate } from "./tracker-core.ts";
import { habitTimerEpoch, habitWorkspaceEpoch } from "./habit-timer.ts";
import type { HabitWorkspace } from "./habits.ts";

export type HabitDayDecisionCommand = { id: string; at: string; habitId: string; date: string; heads: string[]; skipped: boolean };
const heads = (value: readonly string[]) => JSON.stringify([...new Set(value)].sort());

/** An explicit decision for today shares the causal journal, but never becomes retrospective reward evidence. */
export function applyHabitDayDecision(workspace: HabitWorkspace, command: HabitDayDecisionCommand, now = new Date()): HabitWorkspace {
  const habit = workspace.habits.find(row => row.id === command.habitId);
  if (!habit || isCivilDate(command.date) && command.date < habit.createdDate) throw Error("HABIT_HISTORY_DATE_UNAVAILABLE");
  if (!isCivilDate(command.date) || typeof command.skipped !== "boolean"
    || !command.id || command.id.length > 512 || !Number.isFinite(Date.parse(command.at)) || !Array.isArray(command.heads)) throw Error("INVALID_HABIT_HISTORY");
  const replay = workspace.habitHistory.find(row => row.id === command.id);
  if (replay) {
    if (replay.source !== "decision" || replay.habitId !== command.habitId || replay.date !== command.date || replay.createdAt !== command.at
      || replay.value.skippedAt !== (command.skipped ? command.at : undefined) || heads(replay.replaces) !== heads(command.heads)) throw Error("HABIT_HISTORY_ID_CONFLICT");
    return workspace;
  }
  const { rule, conflicts } = habitRuleState(habit, command.date), life = habitLifecycleState(habit, command.date);
  if (command.date !== momentCivilDate(now, rule.schedule.timezone) || momentCivilDate(new Date(command.at), rule.schedule.timezone) !== command.date
    || Date.parse(command.at) > now.getTime() + 1000 || conflicts.length || life.status !== "active" || life.conflict
    || !isTrackerScheduledForDate(rule.schedule, command.date, rule.periodGoal?.calendar ?? "profane")) throw Error("HABIT_HISTORY_DATE_UNAVAILABLE");
  const state = habitHistoryState(workspace.habitHistory, habit.id, command.date);
  if (heads(state.heads.map(row => row.id)) !== heads(command.heads)) throw Error("HABIT_HISTORY_EDIT_CONFLICT");
  const value = habitHistoryInitialValue(workspace, habit.id, command.date);
  if (command.skipped && value.completed) throw Error("HABIT_HISTORY_ALREADY_COMPLETED");
  if (command.skipped) value.skippedAt = command.at; else delete value.skippedAt;
  const row: HabitHistoryEdit = { id: command.id, createdAt: command.at, updatedAt: command.at, version: 1, syncState: "local",
    habitId: habit.id, date: command.date, ruleId: rule.id, epoch: habitTimerEpoch(workspace.habitTimerEpoch), source: "decision",
    replaces: [...command.heads], value, baseline: habitEconomyHistory(workspace).habitCompletions.find(item => item.habitId === habit.id && item.date === command.date) ?? null };
  const history = mergeHabitHistoryEdits(workspace.habitHistory, [row]);
  return { ...workspace, habitHistory: history, habitTimerEpoch: habitWorkspaceEpoch(workspace.habitTimerEpoch, true, true),
    habitCompletions: projectHabitHistory(workspace.habits, history, workspace.habitCompletions, workspace.habitMeasurements) };
}
