import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { calendarModule } from "./helpers/calendar-modules.mjs";
const reminders=calendarModule("app/habit-reminder-plan.ts"),habits=calendarModule("app/habits.ts");
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(date="2026-10-17",zone="UTC") {
  const habit=habits.defaultHabit(date,"profane");habit.title="PRIVATE TITLE — must never leave the workspace";
  habit.schedule.timezone=zone;habit.reminder={...habit.reminder,enabled:true,time:"09:00"};
  return {habit,workspace:{...habits.EMPTY_HABIT_WORKSPACE,habits:[habit]},now:new Date(`${date}T08:00:00Z`)};
}
function target(f){return reminders.habitReminderTarget(reminders.buildHabitReminderPlan(f.workspace,f.now,"UTC",1).rows.find(x=>x.kind==="habit"));}

test("shared web/native vectors preserve UTC occurrences, DST grouping, goals and privacy",()=>{
  const vectors=JSON.parse(fs.readFileSync(new URL("./fixtures/habit-reminders-vectors.json",import.meta.url),"utf8"));
  for(const item of vectors)assert.deepEqual(plain(reminders.buildHabitReminderPlan(item.workspace,new Date(item.now),item.zone,2)),item.plan,item.id);
});

test("explicit reminder input retains its civil date and is idempotent, with interval quality gated by all selected slots",()=>{
  const f=fixture("2026-10-17","Pacific/Honolulu"),now=new Date("2026-10-17T19:01:00Z");
  f.habit.measurement={kind:"quantity",unit:"pages",target:10000,quickAdd:1000};
  const t=target(f),command={kind:"measurement",id:"reminder-value-once",value:1000,note:"private local note"};
  const one=reminders.applyHabitReminderInput(f.workspace,t,command,now);
  assert.equal(one.habitMeasurements.length,1);assert.equal(one.habitMeasurements[0].date,t.date);
  assert.equal(reminders.applyHabitReminderInput(one,t,command,now),one);
  assert.throws(()=>reminders.applyHabitReminderInput(one,t,{...command,id:"tomorrow"},new Date(now.getTime()+86400000)),/stale/);
  const q=fixture();q.habit.intervalSchedule={intervalMinutes:30,startTime:"09:00",endTime:"09:30",completionMode:"each"};
  q.habit.qualityScale="ten";q.habit.scoringMode="quality-ten";
  const qt=target(q),at=new Date("2026-10-17T09:01:00Z");
  assert.throws(()=>reminders.applyHabitReminderInput(q.workspace,qt,{kind:"quality",value:8},at),/INPUT_REQUIRED/);
  const first=reminders.applyHabitReminderInput(q.workspace,qt,{kind:"interval",time:"09:00"},at);
  assert.equal(first.habitCompletions[0].completed,false);
  const all=reminders.applyHabitReminderInput(first,qt,{kind:"interval",time:"09:30"},at);
  assert.equal(all.habitCompletions[0].completed,false);
  const done=reminders.applyHabitReminderInput(all,qt,{kind:"quality",value:8},at);
  assert.equal(done.habitCompletions[0].completed,true);
  assert.equal(reminders.applyHabitReminderInput(done,qt,{kind:"quality",value:8},at),done);
});

test("background metadata has bounded UTC occurrences and no personal titles, diary, notes or measurements",()=>{
  const f=fixture(),plan=reminders.buildHabitReminderPlan(f.workspace,f.now,"UTC");
  assert.equal(plan.rows.length,45);assert.equal(plan.rows[0].at,"2026-10-17T09:00:00.000Z");
  assert.equal(JSON.stringify(plan).includes("PRIVATE TITLE"),false);
  assert.deepEqual(Object.keys(plan.rows[0]).sort(),["action","allowDuringQuietHours","at","date","habitId","id","kind","ruleId","timeZone"]);
  const disabled=reminders.buildHabitReminderPlan({...f.workspace,habitSettings:{...f.workspace.habitSettings,enabled:false}},f.now,"UTC");
  assert.equal(disabled.rows.length,0);
  f.habit.intervalSchedule={intervalMinutes:1,startTime:"08:00",endTime:"23:59",completionMode:"each"};
  const busy=reminders.buildHabitReminderPlan(f.workspace,f.now,"UTC");
  assert.equal(busy.rows.length,reminders.HABIT_REMINDER_MAX_ROWS);
  assert.ok(Date.parse(busy.expiresAt)<Date.parse(plan.expiresAt));
  assert.ok(Date.parse(busy.expiresAt)>Date.parse(busy.rows.at(-1).at));
  f.workspace.habits=Array.from({length:4},(_,index)=>({...f.habit,id:`dense-${index}`}));
  const afterLunch=new Date("2026-10-17T14:00:00Z"),dense=reminders.buildHabitReminderPlan(f.workspace,afterLunch,"UTC");
  assert.ok(dense.rows.some(row=>Date.parse(row.at)>=afterLunch.getTime()),"overdue rows must leave space for future reminders");
  assert.ok(Date.parse(dense.expiresAt)>afterLunch.getTime());
});

test("a quick action uses its original date/rule and repeated completion does not duplicate XP",()=>{
  const f=fixture(),t=target(f),now=new Date("2026-10-17T09:01:00Z");
  assert.equal(reminders.habitReminderAction(f.workspace,t,now),"complete");
  const saved=reminders.completeHabitReminder(f.workspace,t,now);
  assert.equal(saved.habitCompletions[0].xpAwarded,10);
  assert.equal(reminders.completeHabitReminder(saved,t,now),saved);
  assert.equal(reminders.habitReminderAction(f.workspace,t,new Date("2026-10-18T09:01:00Z")),"stale");
  assert.throws(()=>reminders.completeHabitReminder(f.workspace,t,f.now),/stale/);
  const root=calendarModule("app/habit-measurement.ts").habitRuleForDate(f.habit,t.date);
  const changed={...f.workspace,habits:[{...f.habit,ruleHistory:[root,{...root,id:"new-rule",recordedAt:"2026-10-17T08:30:00Z",supersedes:[root.id]}]}]};
  assert.equal(reminders.habitReminderAction(changed,t,now),"stale");
});

test("quantity, duration and quality route to input; an interval action marks only its selected occurrence",()=>{
  for(const kind of ["quantity","duration"]) {
    const f=fixture();f.habit.measurement={kind,unit:kind==="duration"?"min":"pages",target:1000,quickAdd:1000};
    assert.equal(reminders.habitReminderAction(f.workspace,target(f),new Date("2026-10-17T09:01:00Z")),"input");
  }
  const f=fixture();f.habit.intervalSchedule={intervalMinutes:30,startTime:"09:00",endTime:"10:00",completionMode:"each"};
  const t=target(f),now=new Date("2026-10-17T09:01:00Z");
  assert.equal(t.intervalTime,"09:00");assert.equal(reminders.habitReminderAction(f.workspace,t,now),"interval");
  const saved=reminders.completeHabitReminder(f.workspace,t,now);
  assert.equal(saved.habitCompletions[0].completed,false);
  assert.deepEqual(plain(saved.habitCompletions[0].completedTimes),["09:00"]);
  assert.equal(reminders.habitReminderAction(saved,t,now),"completed");
});

test("DST gaps and overlaps use the saved IANA rule zone independently of the display/device zone",()=>{
  for(const [date,zone,time,expected]of[["2026-03-29","Europe/Berlin","02:30","2026-03-29T01:30:00.000Z"],
    ["2026-11-01","America/New_York","01:30","2026-11-01T05:30:00.000Z"]]){
    const f=fixture(date,zone);f.now=new Date(`${date}T00:00:00Z`);f.habit.reminder.time=time;
    const row=reminders.buildHabitReminderPlan(f.workspace,f.now,"Pacific/Honolulu",1).rows.find(row=>row.date===date);
    assert.equal(row.at,expected);
  }
});

test("Google mirrors and reached period goals do not produce another personal reminder",()=>{
  const f=fixture();f.habit.reminder.syncToGoogleTasks=true;f.habit.reminder.googleTaskId="google-task";
  assert.equal(reminders.buildHabitReminderPlan(f.workspace,f.now,"UTC",1).rows.length,0);
  f.habit.reminder.syncToGoogleTasks=false;f.habit.reminder.googleTaskId=null;
  f.habit.measurement={kind:"quantity",unit:"pages",target:1000,quickAdd:1000};
  f.habit.periodGoal={version:1,period:"week",metric:"entries",target:1,calendar:"profane",context:{version:2,timeZone:"UTC",gregorianYearStart:"march"}};
  const recorded=habits.recordHabitMeasurement(f.workspace,f.habit,"2026-10-17",1000,{id:"entry",recordedAt:"2026-10-17T08:30:00Z"},"2026-10-17");
  assert.equal(reminders.buildHabitReminderPlan(recorded,new Date("2026-10-17T08:40:00Z"),"UTC",1).rows.length,0);
});
