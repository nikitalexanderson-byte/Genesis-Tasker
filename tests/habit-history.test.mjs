import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { habitTimerEpoch as legacyEpoch } from "./fixtures/habit-epoch-v5.mjs";
import { calendarModule } from "./helpers/calendar-modules.mjs";
const habits=calendarModule("app/habits.ts"),history=calendarModule("app/habit-history.ts"),commands=calendarModule("app/habit-history-workspace.ts");
const sync=calendarModule("app/workspace-sync-state.ts"),storage=calendarModule("app/habit-timer-storage.ts");
const protection=calendarModule("app/workspace-storage.ts"),timers=calendarModule("app/habit-timer.ts");
const plain=value=>JSON.parse(JSON.stringify(value));
const now=new Date("2026-10-17T12:00:00Z"),date="2026-10-16";
test("shared web/native history vectors retain the same original day, marks, values and credit",()=>{
 const vectors=JSON.parse(fs.readFileSync(new URL("./fixtures/habit-history-vectors.json",import.meta.url),"utf8"));
 for(const item of vectors){
  let workspace=item.workspace;for(const command of item.commands)workspace=commands.applyHabitHistoryCommand(workspace,command,"profane",new Date(item.now));
  const expected=item.expected,actual=workspace.habitCompletions.find(row=>row.habitId===expected.completion.habitId&&row.date===expected.completion.date);
  for(const field of ["completed","completedTimes","qualityValue","score","xpAwarded","note"])assert.deepEqual(plain(actual[field]),expected.completion[field],item.id+" "+field);
  assert.deepEqual(plain(workspace.habitHistory.map(row=>row.id)),expected.historyIds,item.id);
  const economy=history.habitEconomyHistory(workspace);
  assert.equal(economy.habitCompletions.length,expected.economyCompletionCount,item.id);
  assert.equal(economy.habitMeasurements.length,expected.economyMeasurementCount,item.id);
 }
});
function fixture(){
 const habit=habits.defaultHabit("2026-10-01","profane");habit.title="History practice";habit.schedule.timezone="UTC";
 const workspace={...plain(habits.EMPTY_HABIT_WORKSPACE),habits:[habit]};
 return {habit,workspace};
}
function command(f,id="history-once",patch={}){
 return {id,at:now.toISOString(),habitId:f.habit.id,date,ruleId:calendarModule("app/habit-measurement.ts").habitRuleForDate(f.habit,date).id,
  heads:[],value:{completed:true,completedTimes:[],qualityValue:null,qualityConfirmedAt:null,note:"actual practice, entered later"},...patch};
}
test("historical binary add/edit/remove/restore corrects statistics and retains original credits without new rewards",()=>{
 const f=fixture(),first=commands.applyHabitHistoryCommand(f.workspace,command(f),"profane",now);
 assert.equal(first.habitCompletions[0].completed,true);assert.equal(first.habitCompletions[0].date,date);assert.equal(first.habitCompletions[0].xpAwarded,0);
 assert.equal(first.habitHistory[0].baseline,null);assert.equal(first.habitHistory[0].source,"history");
 assert.deepEqual(plain(first.rewardTransactions),[]);assert.equal(first.userProgress.lifetimeXp,0);
 assert.equal(commands.applyHabitHistoryCommand(first,command(f),"profane",now),first);
 const normalized=habits.normalizeHabitWorkspace(first,"profane");assert.equal(normalized.userProgress.lifetimeXp,0);
 assert.equal(normalized.habitCompletions[0].completed,true);assert.equal(normalized.habitHistory.length,1);
 assert.deepEqual(plain(normalized.rewardTransactions),[]);assert.deepEqual(plain(normalized.achievementUnlocks),[]);
 const remove=command(f,"history-remove",{heads:["history-once"],value:{...command(f).value,completed:false}});
 const removed=commands.applyHabitHistoryCommand(first,remove,"profane",now);
 const restore=commands.applyHabitHistoryCommand(removed,command(f,"history-restore",{heads:["history-remove"]}),"profane",now);
 assert.equal(restore.habitHistory.length,3);assert.equal(restore.habitCompletions[0].completed,true);
 assert.equal(habits.normalizeHabitWorkspace(restore,"profane").userProgress.lifetimeXp,0);
 const credited={...f.workspace,habitCompletions:[{id:"original",habitId:f.habit.id,date,completed:true,score:10,xpAwarded:10,note:"original",
  qualityValue:null,createdAt:"2026-10-16T10:00:00Z",updatedAt:"2026-10-16T10:00:00Z",version:1,syncState:"local"}]};
 const changed=commands.applyHabitHistoryCommand(credited,command(f,"remove-credited",{value:{...command(f).value,completed:false}}),"profane",now);
 assert.equal(changed.habitCompletions[0].xpAwarded,10);
 assert.equal(history.habitEconomyHistory(changed).habitCompletions[0].completed,true);
});
test("history date guards reject future, today, before-start, unscheduled and changed-rule inputs",()=>{
 const f=fixture();for(const candidate of ["2026-10-17","2026-10-18","2026-09-30","2026-02-30"])
  assert.throws(()=>commands.applyHabitHistoryCommand(f.workspace,command(f,"bad",{date:candidate}),"profane",now),/DATE_UNAVAILABLE/);
 assert.throws(()=>commands.applyHabitHistoryCommand(f.workspace,command(f,"bad",{ruleId:"changed"}),"profane",now),/DATE_UNAVAILABLE/);
 f.habit.schedule.endDate="2026-10-15";
 assert.throws(()=>commands.applyHabitHistoryCommand(f.workspace,command(f),"profane",now),/DATE_UNAVAILABLE/);
});
test("an old offline reader blocks writes to the new journal, while current timers and explicit reset retain their meaning",()=>{
 const f=fixture(),first=commands.applyHabitHistoryCommand(f.workspace,command(f),"profane",now);
 assert.ok(first.habitTimerEpoch.startsWith("history6:"));assert.equal(timers.habitTimerEpoch(first.habitTimerEpoch),"");
 assert.throws(()=>legacyEpoch(first.habitTimerEpoch),/INVALID_HABIT_TIMER/);
 const bytes=JSON.stringify(first),values=new Map([["workspace",bytes]]),saved={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 assert.throws(()=>protection.readProtectedWorkspace(saved,"workspace",raw=>({...raw,habitTimerEpoch:legacyEpoch(raw.habitTimerEpoch)}),()=>f.workspace),/LOCAL_WORKSPACE_RECOVERY_REQUIRED/);
 assert.throws(()=>protection.writeProtectedWorkspace(saved,"workspace",f.workspace),/LOCAL_WORKSPACE_RECOVERY_REQUIRED/);
 assert.equal(values.get("workspace"),bytes);
 const advanced=calendarModule("app/habit-reset.ts").resetHabitWorkspace(first,now.toISOString());
 assert.equal(advanced.habitHistory.length,0);assert.doesNotThrow(()=>legacyEpoch(advanced.habitTimerEpoch));
 assert.throws(()=>storage.preserveHabitTimerRecords(first,advanced),/HABIT_TIMER_RESET/);
 const normalized=habits.normalizeHabitWorkspace(first,"profane");assert.equal(normalized.habitTimerEpoch,first.habitTimerEpoch);
 assert.equal(normalized.habitHistory.length,1);
 const running=calendarModule("app/habit-timer-workspace.ts").applyHabitTimerCommand(f.workspace,{action:"start",owner:"device",id:"running-today",at:now.toISOString(),habitId:f.habit.id});
 const corrected=habits.normalizeHabitWorkspace(commands.applyHabitHistoryCommand(running,command(f,"while-running"),"profane",now),"profane");
 assert.equal(corrected.habitTimers.length,1);assert.equal(timers.habitTimerSessions(corrected.habitTimers)[0].state.status,"running");
});
test("measured history records original day and audit time, and corrections never become reward-eligible",()=>{
 const f=fixture();f.habit.measurement={kind:"quantity",unit:"pages",target:2000,quickAdd:1000};
 const first=commands.applyHabitHistoryCommand(f.workspace,command(f,"measured",{measurement:{value:2000,note:"private"}}),"profane",now);
 assert.equal(first.habitMeasurements[0].date,date);assert.equal(first.habitMeasurements[0].historical,true);
 assert.equal(first.habitMeasurements[0].createdAt,now.toISOString());assert.equal(first.habitCompletions[0].completed,true);
 const changed=commands.applyHabitHistoryCommand(first,command(f,"corrected",{heads:["measured"],measurement:{value:1000,entryId:"measured:value",replaces:["measured:value"],note:"fixed"}}),"profane",now);
 assert.equal(changed.habitCompletions[0].completed,false);assert.equal(changed.habitMeasurements.length,2);
 assert.equal(history.habitEconomyHistory(changed).habitMeasurements.length,0);
 assert.equal(habits.normalizeHabitWorkspace(changed,"profane").userProgress.lifetimeXp,0);
 assert.throws(()=>commands.applyHabitHistoryCommand(first,command(f,"negative",{heads:["measured"],measurement:{value:-1,note:""}}),"profane",now));
});
test("offline concurrent corrections remain visible as heads, resolve explicitly and survive stale forms",()=>{
 const f=fixture();const a=commands.applyHabitHistoryCommand(f.workspace,command(f,"a"),"profane",now);
 const b=commands.applyHabitHistoryCommand(f.workspace,command(f,"b",{value:{...command(f).value,completed:false,note:"other device"}}),"profane",now);
 const clock={version:1,updatedAt:now.toISOString(),deviceId:"test"};
 const merged=sync.mergeWorkspaceDocuments({left:a,right:b,leftFallback:clock,rightFallback:{...clock,deviceId:"second"}}).document;
 const normalized=habits.normalizeHabitWorkspace(merged,"profane");
 assert.equal(normalized.habits[0].id,f.habit.id);
 assert.equal(calendarModule("app/habit-measurement.ts").habitRuleForDate(normalized.habits[0],date).id,command(f).ruleId);
 assert.equal(history.habitHistoryState(normalized.habitHistory,f.habit.id,date).conflict,true);
 assert.throws(()=>commands.applyHabitHistoryCommand(normalized,command(f,"stale",{heads:["a"]}),"profane",now),/EDIT_CONFLICT/);
 const resolved=commands.applyHabitHistoryCommand(normalized,command(f,"resolution",{heads:["a","b"]}),"profane",now);
 assert.equal(history.habitHistoryState(resolved.habitHistory,f.habit.id,date).conflict,false);
 const retained=habits.normalizeHabitWorkspace(storage.preserveHabitTimerRecords(f.workspace,resolved),"profane");
 assert.equal(retained.habitHistory.length,3);assert.equal(retained.habitCompletions[0].completed,true);
 assert.throws(()=>history.mergeHabitHistoryEdits(resolved.habitHistory,[{...resolved.habitHistory[0],value:{...resolved.habitHistory[0].value,note:"mutated"}}]),/ID_CONFLICT/);
});
