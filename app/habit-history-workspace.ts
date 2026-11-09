import { momentCivilDate, isCivilDate } from "./calendar-context.ts";
import { habitEconomyHistory, habitHistoryState, habitHistoryValue, mergeHabitHistoryEdits, projectHabitHistory, type HabitHistoryValue } from "./habit-history.ts";
import { effectiveHabitMeasurement, habitMeasurementProgress, mergeHabitMeasurementEvents, newHabitMeasurementEvent } from "./habit-measurement.ts";
import { habitRuleState } from "./habit-rule-history.ts";
import { habitIntervalTimes } from "./habit-interval.ts";
import { isTrackerScheduledForDate } from "./tracker-core.ts";
import { refreshDailyGoalProgress, type HabitWorkspace } from "./habits.ts";
import type { CalendarMode } from "./calendar-data";
import { habitTimerEpoch, habitWorkspaceEpoch } from "./habit-timer.ts";

export type HabitHistoryCommand = {
  id:string;at:string;habitId:string;date:string;ruleId:string;heads:string[];value:HabitHistoryValue;
  measurement?:{value:number|null;entryId?:string;replaces?:string[];note:string};
};
const sorted=(rows:readonly string[])=>JSON.stringify([...new Set(rows)].sort());

/** A dated correction is a separate explicit command, never a relaxation of today's quick action. */
export function applyHabitHistoryCommand(workspace:HabitWorkspace,command:HabitHistoryCommand,
  calendarMode:CalendarMode="sacred",now=new Date()):HabitWorkspace {
  const habit=workspace.habits.find(row=>row.id===command.habitId);
  if(!habit||!isCivilDate(command.date)||command.date<habit.createdDate)throw Error("HABIT_HISTORY_DATE_UNAVAILABLE");
  const ruleState=habitRuleState(habit,command.date),rule=ruleState.rule;
  const today=momentCivilDate(now,rule.schedule.timezone);
  if(command.date>=today||!isTrackerScheduledForDate(rule.schedule,command.date,calendarMode)
    ||ruleState.conflicts.length||command.ruleId!==rule.id)throw Error("HABIT_HISTORY_DATE_UNAVAILABLE");
  const state=habitHistoryState(workspace.habitHistory??[],habit.id,command.date);
  const value=habitHistoryValue(command.value),measured=effectiveHabitMeasurement(rule);
  const replay=workspace.habitHistory?.find(row=>row.id===command.id);
  if(replay){
    const event=workspace.habitMeasurements.find(row=>row.id===`${command.id}:value`),measurement=command.measurement;
    if(replay.habitId!==command.habitId||replay.date!==command.date||replay.ruleId!==command.ruleId
      ||replay.createdAt!==command.at||JSON.stringify(replay.value)!==JSON.stringify(value)||sorted(replay.replaces)!==sorted(command.heads)
      ||Boolean(event)!==Boolean(measurement)||event&&measurement&&(event.value!==measurement.value||event.note!==measurement.note
        ||event.entryId!==(measurement.entryId??event.id)||sorted(event.replaces)!==sorted(measurement.replaces??[])))throw Error("HABIT_HISTORY_ID_CONFLICT");
    return workspace;
  }
  if(sorted(state.heads.map(row=>row.id))!==sorted(command.heads))throw Error("HABIT_HISTORY_EDIT_CONFLICT");
  if(habit.qualityScale==="none"&&value.qualityValue!==null||habit.qualityScale!=="none"&&value.qualityValue!==null
    &&(!Number.isInteger(value.qualityValue)||value.qualityValue<(habit.qualityScale==="ten"?1:-5)||value.qualityValue>(habit.qualityScale==="ten"?10:5))
    ||value.completed&&habit.qualityScale!=="none"&&(value.qualityValue===null||!value.qualityConfirmedAt))throw Error("INVALID_HABIT_HISTORY");
  const times=habit.intervalSchedule?.completionMode==="each"?habitIntervalTimes(habit.intervalSchedule):[];
  if(value.completedTimes.some(time=>!times.includes(time))||!measured&&times.length&&value.completed!==times.every(time=>value.completedTimes.includes(time)))
    throw Error("INVALID_HABIT_HISTORY");
  let measurements=workspace.habitMeasurements;
  if(command.measurement){
    if(!measured)throw Error("INVALID_HABIT_HISTORY");
    const input=command.measurement,current=habitMeasurementProgress(habit,command.date,measurements);
    if(!rule.measurement&&input.value!==null&&input.value!==1000)throw Error("INVALID_HABIT_MEASUREMENT_EVENT");
    if(input.entryId){
      const entry=current.entries.find(row=>row.id===input.entryId);
      if(!entry||sorted(entry.heads.map(row=>row.id))!==sorted(input.replaces??[]))throw Error("HABIT_MEASUREMENT_EDIT_CONFLICT");
    }else if(input.value===null||input.replaces?.length)throw Error("INVALID_HABIT_MEASUREMENT_EVENT");
    const event=newHabitMeasurementEvent(habit,command.date,input.value,{id:`${command.id}:value`,entryId:input.entryId,
      replaces:input.replaces,note:input.note,source:"correction",historical:true,recordedAt:command.at});
    measurements=mergeHabitMeasurementEvents(measurements,[event]);habitMeasurementProgress(habit,command.date,measurements);
  }
  const baseline=habitEconomyHistory(workspace).habitCompletions.find(row=>row.habitId===habit.id&&row.date===command.date)??null;
  const edit={id:command.id,createdAt:command.at,updatedAt:command.at,version:1,syncState:"local" as const,
    habitId:habit.id,date:command.date,ruleId:rule.id,epoch:habitTimerEpoch(workspace.habitTimerEpoch),replaces:command.heads,value,baseline,source:"history" as const};
  const habitHistory=mergeHabitHistoryEdits(workspace.habitHistory??[],[edit]);
  const projected={...workspace,habitHistory,habitTimerEpoch:habitWorkspaceEpoch(workspace.habitTimerEpoch,true),habitMeasurements:measurements,
    habitCompletions:projectHabitHistory(workspace.habits,habitHistory,workspace.habitCompletions,measurements)};
  const refreshed=refreshDailyGoalProgress(projected,[command.date],calendarMode,momentCivilDate(now,Intl.DateTimeFormat().resolvedOptions().timeZone));
  // Correcting the past cannot spend a protection or mutate any existing economy journal.
  return {...refreshed,rewardTransactions:workspace.rewardTransactions,streakFreezeTransactions:workspace.streakFreezeTransactions,
    achievementUnlocks:workspace.achievementUnlocks,quests:workspace.quests,userProgress:{...refreshed.userProgress,
      lifetimeXp:workspace.userProgress.lifetimeXp,laurelsBalance:workspace.userProgress.laurelsBalance,streakFreezeCount:workspace.userProgress.streakFreezeCount}};
}

export function habitHistoryInitialValue(workspace:HabitWorkspace,habitId:string,date:string):HabitHistoryValue {
  const entry=workspace.habitCompletions.find(row=>row.habitId===habitId&&row.date===date);
  return {completed:entry?.completed??false,completedTimes:entry?.completedTimes??[],qualityValue:entry?.qualityValue??null,
    qualityConfirmedAt:entry?.qualityConfirmedAt??null,note:entry?.note??"",...(entry?.skippedAt?{skippedAt:entry.skippedAt}:{})};
}
