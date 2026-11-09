import { calendarContext, momentCivilDate } from "./calendar-context.ts";
import { habitTimerPreferences } from "./habit-timer-preferences.ts";
import { habitMeasurementProgress, habitRuleForDate } from "./habit-measurement.ts";
import { habitRuleState } from "./habit-rule-history.ts";
import { calendarModeForRecurrence } from "./task-recurrence.ts";
import { normalizeHabitWorkspace, isHabitScheduledForDate, recordHabitMeasurement,
  type HabitWorkspace } from "./habits.ts";
import { appendHabitTimerOperation, habitTimerDayAllocations, habitTimerSessions, startHabitTimer,
  type HabitTimerAllocation, type HabitTimerOperation, type HabitTimerPlan, type HabitTimerSession } from "./habit-timer.ts";

export type HabitTimerCommand = {
  action: HabitTimerOperation["action"];
  owner: string;
  at: string;
  id: string;
  sessionId?: string;
  habitId?: string;
  mode?: HabitTimerPlan["mode"];
  workMinutes?: number;
  breakMinutes?: number;
  branchId?: string;
  timeOnly?: boolean;
};

/** Keep elapsed time when an editor removes a timer, without leaving a hidden active session. */
export function finishDisabledHabitTimers(workspace: HabitWorkspace, owner: string, at: string): HabitWorkspace {
  let operations = workspace.habitTimers ?? [];
  for (const session of habitTimerSessions(operations)) {
    if (session.root.owner !== owner || !session.state) continue;
    const habit = workspace.habits.find(item => item.id === session.root.habitId);
    if (!habit || habit.timerEnabled !== false && habitTimerPreferences(habit).modes.includes(session.root.plan!.mode)) continue;
    const state = session.state;
    if (state.status === "running" || state.status === "paused") {
      const finishedAt = new Date(Math.max(Date.parse(at), Date.parse(state.head.at ?? session.root.at!))).toISOString();
      const allocations: HabitTimerAllocation[] = habitTimerDayAllocations(state, Date.parse(finishedAt))
        .map(row => ({...row,ruleId:session.root.plan!.ruleId,reason:"not-duration"}));
      operations = appendHabitTimerOperation(operations,session.id,owner,"finish",{at:finishedAt,allocations});
    }
    if (habitTimerSessions(operations).find(item => item.id === session.id)?.state?.status === "finished")
      operations = appendHabitTimerOperation(operations,session.id,owner,"save",{timeOnly:true});
  }
  return operations === workspace.habitTimers ? workspace : {...workspace,habitTimers:operations};
}

/** The preview and commit share the same current-data projection. Nothing is written here. */
function plannedHabitTimerAllocations(workspace: HabitWorkspace, session: HabitTimerSession, at: string): HabitTimerAllocation[] {
  const habit = workspace.habits.find(item => item.id === session.root.habitId);
  let completions = [...workspace.habitCompletions];
  return habitTimerDayAllocations(session.state!, Date.parse(at)).map(row => {
    const rule = habit ? habitRuleForDate(habit, row.date) : null;
    const reason = !habit || !habit.active || rule?.id !== session.root.plan!.ruleId
      || habitRuleState(habit, row.date).conflicts.length ? "rule-conflict"
      : !isHabitScheduledForDate(habit, row.date, "sacred", completions) ? "not-scheduled"
        : rule?.measurement?.kind === "duration" && habit.timerPreferences?.progress !== "time-only" ? "duration" : "not-duration";
    // A timely completion closes a finite practice before the next allocation,
    // while all elapsed time stays in the session.
    if (reason === "duration" && habit?.practiceGoal && row.value > 0) {
      const progress = habitMeasurementProgress(habit, row.date, workspace.habitMeasurements);
      const prior = completions.find(entry => entry.habitId === habit.id && entry.date === row.date);
      if (!progress.conflicts.length && !progress.ruleConflicts.length && !progress.incompatible
        && progress.total + row.value >= progress.target
        && (habit.qualityScale === "none" || prior?.qualityConfirmedAt)) {
        completions = completions.filter(entry => entry.habitId !== habit.id || entry.date !== row.date);
        completions.push({ id: `timer-preview:${session.id}:${row.date}`, habitId: habit.id, date: row.date,
          createdAt: at, updatedAt: at, version: 1, syncState: "local", completed: true,
          qualityValue: prior?.qualityValue ?? null, qualityConfirmedAt: prior?.qualityConfirmedAt,
          score: 0, xpAwarded: 0, note: "" });
      }
    }
    return { ...row, ruleId: rule?.id ?? session.root.plan!.ruleId, reason };
  });
}

/** One pure mutation is queued durably by the existing workspace adapter before the UI closes. */
export function applyHabitTimerCommand(workspace: HabitWorkspace, command: HabitTimerCommand, now = new Date()): HabitWorkspace {
  const operations = workspace.habitTimers ?? [];
  if (command.action === "start") {
    const habit = workspace.habits.find(item => item.id === command.habitId);
    if (!habit) throw new RangeError("HABIT_TIMER_GOAL_CHANGED");
    if (habit.timerEnabled === false || !habitTimerPreferences(habit).modes.includes(command.mode ?? "stopwatch")) throw new RangeError("HABIT_TIMER_DISABLED");
    const date = momentCivilDate(new Date(command.at), habit.periodGoal?.context.timeZone ?? habit.schedule.timezone);
    if (!isHabitScheduledForDate(habit, date, "sacred", workspace.habitCompletions)) throw new RangeError("HABIT_TIMER_DATE_UNAVAILABLE");
    const rule = habitRuleForDate(habit, date);
    const context = calendarContext({ ...(rule.periodGoal?.context ?? rule.schedule.recurrence.calendarContext),
      timeZone: rule.periodGoal?.context.timeZone ?? rule.schedule.timezone });
    const plan: HabitTimerPlan = { mode: command.mode ?? "stopwatch", workMinutes: command.workMinutes ?? 25,
      breakMinutes: command.breakMinutes ?? 5, timeZone: context.timeZone, context,
      calendarMode: rule.periodGoal?.calendar ?? calendarModeForRecurrence(rule.schedule.recurrence.mode),
      habitTitle: habit.title, ruleId: rule.id };
    return { ...workspace, habitTimers: startHabitTimer(operations, habit.id, command.owner, plan, command.at, command.id, workspace.habitTimerEpoch) };
  }
  const session = habitTimerSessions(operations).find(item => item.id === command.sessionId);
  if (!session || session.root.owner !== command.owner) throw new RangeError("HABIT_TIMER_OTHER_DEVICE");
  if (!session.state && command.action !== "resolve") throw new RangeError("HABIT_TIMER_CONFLICT");
  const state = session.state;
  if (command.action === "resume" && !workspace.habits.find(habit => habit.id === session.root.habitId)?.active)
    throw new RangeError("HABIT_TIMER_DATE_UNAVAILABLE");
  if (command.action === "resume") {
    const habit = workspace.habits.find(item => item.id === session.root.habitId)!;
    if (habit.timerEnabled === false || !habitTimerPreferences(habit).modes.includes(session.root.plan!.mode))
      throw new RangeError("HABIT_TIMER_DISABLED");
  }
  if (command.action === "finish") {
    if (state?.status === "finished" || state?.status === "saved") return workspace;
    const allocations = plannedHabitTimerAllocations(workspace, session, command.at);
    return { ...workspace, habitTimers: appendHabitTimerOperation(operations, session.id, command.owner,
      "finish", { at: command.at, id: command.id, allocations }) };
  }
  if (command.action === "save") {
    if (state?.status === "saved") return workspace;
    if (state?.status !== "finished") throw new RangeError("HABIT_TIMER_NOT_FINISHED");
    let next = workspace;
    if (!command.timeOnly) {
      const latest = plannedHabitTimerAllocations(workspace, session, state.finishedAt!);
      if (JSON.stringify(latest) !== JSON.stringify(state.allocations)) throw new RangeError("HABIT_TIMER_GOAL_CHANGED");
      if (state.allocations?.some(row => row.reason === "rule-conflict")) throw new RangeError("HABIT_TIMER_GOAL_CHANGED");
      const habit = workspace.habits.find(item => item.id === session.root.habitId);
      const today = momentCivilDate(now, session.root.plan!.timeZone);
      for (const row of state.allocations ?? []) {
        if (row.reason !== "duration" || row.value === 0) continue;
        if (!habit || !isHabitScheduledForDate(habit, row.date, "sacred", next.habitCompletions)
          || habitRuleForDate(habit, row.date).id !== row.ruleId
          || habitRuleForDate(habit, row.date).measurement?.kind !== "duration")
          throw new RangeError("HABIT_TIMER_GOAL_CHANGED");
        next = recordHabitMeasurement(next, habit, row.date, row.value,
          { id: `timer-value:${session.id}:${row.date}`, source: "timer",
            recordedAt: state.finishedAt, historical: row.date < today }, today);
      }
    }
    return normalizeHabitWorkspace({ ...next, habitTimers: appendHabitTimerOperation(operations, session.id,
      command.owner, "save", { timeOnly: command.timeOnly }) });
  }
  return { ...workspace, habitTimers: appendHabitTimerOperation(operations, session.id, command.owner,
    command.action, { at: command.at, id: command.id, branchId: command.branchId }) };
}
