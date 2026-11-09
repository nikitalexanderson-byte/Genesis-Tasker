import { addCivilDays, isCivilDate, momentCivilDate, resolveCalendarWallTime } from "./calendar-context.ts";
import { habitIntervalMarks } from "./habit-interval.ts";
import { effectiveHabitMeasurement, habitRuleForDate, habitMeasurementProgress } from "./habit-measurement.ts";
import { habitPeriodProgress } from "./habit-period-progress.ts";
import { habitReminderTimes } from "./habit-reminder-time.ts";
import { habitIntervalTimes } from "./habit-interval.ts";
import { habitRuleState } from "./habit-rule-history.ts";
import { dailyGoalForDate, isHabitScheduledForDate, updateHabitCompletion, updateHabitIntervalCompletion, recordHabitMeasurement,
  type Habit, type HabitWorkspace } from "./habits.ts";

export type HabitReminderTarget = {
  habitId: string; date: string; at: string; ruleId: string; intervalTime?: string;
};
export type HabitReminderRow = {
  id: string; kind: "habit" | "goal"; date: string; at: string; timeZone: string; allowDuringQuietHours: boolean;
  habitId?: string; ruleId?: string; intervalTime?: string; localTime?: string; action?: "complete" | "input" | "interval";
};
export type HabitReminderPlan = {
  version: 1; generatedAt: string; expiresAt: string; timeZone: string;
  tone: "calm" | "heroic" | "ironic"; quietHoursStart: string; quietHoursEnd: string; rows: HabitReminderRow[];
};
export const HABIT_REMINDER_MAX_ROWS = 2048;
const timePattern = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function normalizeHabitReminderTarget(input: unknown): HabitReminderTarget {
  const value = input as HabitReminderTarget;
  if (!value || typeof value !== "object" || typeof value.habitId !== "string" || !value.habitId || value.habitId.length > 256
    || !isCivilDate(value.date) || typeof value.at !== "string" || !Number.isFinite(Date.parse(value.at))
    || typeof value.ruleId !== "string" || !value.ruleId || value.ruleId.length > 256
    || value.intervalTime !== undefined && !timePattern.test(value.intervalTime)) throw new RangeError("INVALID_HABIT_REMINDER_TARGET");
  return { habitId: value.habitId, date: value.date, at: new Date(value.at).toISOString(), ruleId: value.ruleId,
    ...(value.intervalTime ? { intervalTime: value.intervalTime } : {}) };
}

function occurrence(habit: Habit, date: string, time: string) {
  const rule = habitRuleForDate(habit, date);
  const instant = resolveCalendarWallTime(date, time, rule.schedule.timezone).instant;
  return new Date(instant.getTime() - Math.min(1440, Math.max(0, Math.trunc(habit.reminder.minutesBefore ?? 0))) * 60_000);
}

/** The same exact-day/rule check is used by notification opening and by the durable write. */
export function habitReminderAction(workspace: Pick<HabitWorkspace, "habits" | "habitCompletions" | "habitMeasurements">,
  input: HabitReminderTarget, now = new Date()): "unavailable" | "stale" | "completed" | "input" | "interval" | "complete" {
  const target = normalizeHabitReminderTarget(input), habit = workspace.habits.find(item => item.id === target.habitId);
  if (!habit || !habit.active) return "unavailable";
  const rule = habitRuleForDate(habit, target.date);
  if (target.date !== momentCivilDate(now, rule.schedule.timezone) || Date.parse(target.at) > now.getTime() + 1000
    || target.ruleId !== rule.id || habitRuleState(habit, target.date).conflicts.length
    || !isHabitScheduledForDate(habit, target.date, "sacred", workspace.habitCompletions)
    || !habitReminderTimes(habit).some(time => (!target.intervalTime || time === target.intervalTime)
      && occurrence(habit, target.date, time).getTime() === Date.parse(target.at))) return "stale";
  const entry = workspace.habitCompletions.find(item => item.habitId === habit.id && item.date === target.date);
  if (entry?.completed || habitPeriodProgress(habit, target.date, workspace, now)?.completed) return "completed";
  if (effectiveHabitMeasurement(rule) || habit.qualityScale !== "none") return "input";
  if (habit.intervalSchedule?.completionMode === "each") {
    if (!target.intervalTime || habit.reminder.timing === "custom") return "input";
    return habitIntervalMarks(habit.intervalSchedule, entry).includes(target.intervalTime) ? "completed" : "interval";
  }
  return "complete";
}

export function completeHabitReminder(workspace: HabitWorkspace, target: HabitReminderTarget, now = new Date()) {
  const action = habitReminderAction(workspace, target, now);
  if (action === "completed") return workspace;
  if (action !== "complete" && action !== "interval") throw new RangeError(`HABIT_REMINDER_${action}`);
  const habit = workspace.habits.find(item => item.id === target.habitId)!;
  return action === "interval" ? updateHabitIntervalCompletion(workspace, habit, target.date, target.intervalTime!, true, target.date)
    : updateHabitCompletion(workspace, habit, target.date, { completed: true }, target.date);
}

export type HabitReminderInput = {kind:"measurement";id:string;value:number;note:string}
  | {kind:"interval";time:string} | {kind:"quality";value:number};
export function applyHabitReminderInput(workspace: HabitWorkspace,target: HabitReminderTarget,input: HabitReminderInput,now=new Date()) {
  const action=habitReminderAction(workspace,target,now);
  if(action==="completed")return workspace;
  if(action!=="input"&&action!=="interval")throw new RangeError(`HABIT_REMINDER_${action}`);
  const habit=workspace.habits.find(item=>item.id===target.habitId)!;
  const rule=habitRuleForDate(habit,target.date);
  if(input.kind==="measurement") {
    if(!effectiveHabitMeasurement(rule))throw new RangeError("HABIT_REMINDER_INPUT_REQUIRED");
    return recordHabitMeasurement(workspace,habit,target.date,input.value,{id:input.id,note:input.note},target.date);
  }
  const entry=workspace.habitCompletions.find(item=>item.habitId===habit.id&&item.date===target.date);
  if(input.kind==="interval") {
    if(effectiveHabitMeasurement(rule)||habit.intervalSchedule?.completionMode!=="each"
      ||!habitIntervalTimes(habit.intervalSchedule).includes(input.time))throw new RangeError("HABIT_REMINDER_INPUT_REQUIRED");
    if(habitIntervalMarks(habit.intervalSchedule,entry).includes(input.time))return workspace;
    return updateHabitIntervalCompletion(workspace,habit,target.date,input.time,true,target.date);
  }
  if(habit.qualityScale==="none"||!Number.isFinite(input.value)
    ||input.value<(habit.qualityScale==="ten"?1:-5)||input.value>(habit.qualityScale==="ten"?10:5)
    ||effectiveHabitMeasurement(rule)&&!habitMeasurementProgress(habit,target.date,workspace.habitMeasurements).completed
    ||habit.intervalSchedule?.completionMode==="each"&&!habitIntervalTimes(habit.intervalSchedule).every(time=>habitIntervalMarks(habit.intervalSchedule,entry).includes(time)))
    throw new RangeError("HABIT_REMINDER_INPUT_REQUIRED");
  return updateHabitCompletion(workspace,habit,target.date,{completed:true,qualityValue:input.value,qualityConfirmedAt:now.toISOString()},target.date);
}

export function habitReminderTarget(row: HabitReminderRow): HabitReminderTarget | null {
  return row.kind === "habit" ? normalizeHabitReminderTarget({ habitId: row.habitId, date: row.date, at: row.at,
    ruleId: row.ruleId, ...(row.intervalTime ? { intervalTime: row.intervalTime } : {}) }) : null;
}

/** This is the entire optional server projection: no names, notes, amounts, diary or workspace document. */
export function buildHabitReminderPlan(workspace: HabitWorkspace, now = new Date(), timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone,
  horizonDays = 45): HabitReminderPlan {
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 45) throw new RangeError("INVALID_HABIT_REMINDER_HORIZON");
  const settings = workspace.habitSettings.notifications;
  const generatedAt = now.toISOString(), horizon = now.getTime() + horizonDays * 86_400_000;
  const rows: HabitReminderRow[] = [];
  const firstDay = momentCivilDate(now, timeZone);
  if (workspace.habitSettings.enabled) for (let offset = -2; offset <= horizonDays + 2; offset++) {
    const date = addCivilDays(firstDay, offset);
    for (const habit of workspace.habits) {
      if (!habit.active || !habit.reminder.enabled || !isHabitScheduledForDate(habit, date, "sacred", workspace.habitCompletions)
        || habit.reminder.syncToGoogleTasks && habit.reminder.googleTaskId
        || habit.reminder.showInGoogleCalendar && habit.reminder.googleEventId
        || workspace.habitCompletions.some(item => item.habitId === habit.id && item.date === date && item.completed)
        || habitPeriodProgress(habit, date, workspace, now)?.completed) continue;
      const rule = habitRuleForDate(habit, date);
      if (habitRuleState(habit, date).conflicts.length) continue;
      const marks = habitIntervalMarks(habit.intervalSchedule,
        workspace.habitCompletions.find(item => item.habitId === habit.id && item.date === date));
      for (const time of habitReminderTimes(habit)) {
        if (habit.reminder.timing !== "custom" && habit.intervalSchedule?.completionMode === "each" && marks.includes(time)) continue;
        const at = occurrence(habit, date, time);
        if (at.getTime() < now.getTime() - 2 * 60 * 60_000 || at.getTime() >= horizon) continue;
        rows.push({ id: `habit-reminder:${habit.id}:${date}:${at.getTime()}`, kind: "habit", date, at: at.toISOString(),
          habitId: habit.id, ruleId: rule.id, timeZone: rule.schedule.timezone, allowDuringQuietHours: habit.reminder.allowDuringQuietHours === true,
          action: effectiveHabitMeasurement(rule) || habit.qualityScale !== "none" ? "input"
            : habit.intervalSchedule?.completionMode === "each" ? "interval" : "complete",
          ...(habit.reminder.timing !== "custom" && habit.intervalSchedule?.completionMode === "each" ? { intervalTime: time } : {}) });
      }
    }
    if (settings.enabled && settings.motivational) {
      const goal = dailyGoalForDate(workspace, date, "profane", firstDay);
      const remaining = Math.max(0, goal.targetCount - goal.completedCount);
      const perfectRemaining = goal.scheduledCount - goal.completedCount;
      if (goal.targetCount > 0 && !["rest","neutral","protected"].includes(goal.status) && (remaining > 0 || perfectRemaining === 1)) {
        const at = resolveCalendarWallTime(date, settings.dailyGoalTime, timeZone).instant;
        if (at.getTime() >= now.getTime() - 5 * 60_000 && at.getTime() < horizon)
          rows.push({ id: `habit-goal:${date}:${settings.dailyGoalTime}`, kind: "goal", date, at: at.toISOString(),
            localTime: settings.dailyGoalTime, timeZone, allowDuringQuietHours: false });
      }
    }
    // All IANA offsets fit within this two-day margin. Stop expanding dense interval plans once
    // later civil dates cannot precede the retained UTC prefix; the advertised expiry shortens.
    if (rows.length > HABIT_REMINDER_MAX_ROWS) {
      const prefix = rows.filter(row=>Date.parse(row.at)>=now.getTime()).sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
      if(prefix.length>=HABIT_REMINDER_MAX_ROWS){const cutoff = momentCivilDate(new Date(prefix[HABIT_REMINDER_MAX_ROWS - 1].at), timeZone);
        if (date > addCivilDays(cutoff, 2)) break;}
    }
  }
  const unique = new Map<string, HabitReminderRow>();
  for (const row of rows) {
    const previous = unique.get(row.id);
    // A DST gap may shift two local interval slots to one instant. Deliver one reminder and
    // open the slot chooser; a quick mark must not silently choose or complete both slots.
    if (previous && previous.intervalTime !== row.intervalTime) {
      const shared = { ...previous, action: "input" as const }; delete shared.intervalTime;
      unique.set(row.id, shared);
    } else if (!previous) unique.set(row.id, row);
  }
  const ordered = [...unique.values()].sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
  // Keep a small recent tail for snoozes without letting a dense overdue morning consume every future slot.
  const recent=ordered.filter(row=>Date.parse(row.at)<now.getTime()).slice(-256);
  const future=ordered.filter(row=>Date.parse(row.at)>=now.getTime());
  const selected=[...recent,...future.slice(0,HABIT_REMINDER_MAX_ROWS-recent.length)];
  const truncated=future.length>HABIT_REMINDER_MAX_ROWS-recent.length;
  return { version: 1, generatedAt, expiresAt: new Date(truncated ? Math.max(now.getTime()+60_000,Date.parse(selected.at(-1)!.at) + 60_000) : horizon).toISOString(),
    timeZone, tone: settings.tone, quietHoursStart: settings.quietHoursStart, quietHoursEnd: settings.quietHoursEnd, rows: selected };
}
