import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const h=calendarModule('app/habits.ts'), b=calendarModule('app/habit-backup.ts'), r=calendarModule('app/habit-backup-restore.ts');
const l=calendarModule('app/habit-lifecycle.ts'), timers=calendarModule('app/habit-timer.ts'), history=calendarModule('app/habit-history.ts');
const retention=calendarModule('app/habit-laurel-retention.ts');
const at='2026-10-18T10:00:00.000Z', date='2026-10-17', clone=value=>JSON.parse(JSON.stringify(value));
function fixture() {
 const habit=h.defaultHabit(date,'profane'); habit.id='habit-water';habit.title='Моя вода';habit.schedule.timezone='UTC';
 habit.measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};
 return h.normalizeHabitWorkspace(h.recordHabitMeasurement({...clone(h.EMPTY_HABIT_WORKSPACE),habits:[habit]},habit,date,100125,{id:'water-value',recordedAt:'2026-10-17T12:00:00.000Z'},date),'profane');
}
const backup=async workspace=>JSON.stringify(await b.createHabitBackup(workspace,at));

test('clock-skewed snapshot timestamps cannot invent earlier parent transitions or partially apply data',async()=>{
 const source=fixture();source.habits[0]=l.applyHabitLifecycleCommand(source.habits[0],{id:'future-observation',habitId:'habit-water',at:'2026-10-18T11:00:00.000Z',action:'observe',heads:[]});
 const empty=clone(h.EMPTY_HABIT_WORKSPACE),before=JSON.stringify(empty),preview=await r.previewHabitRestore(empty,await backup(source));
 await assert.rejects(()=>r.applyHabitRestore(empty,{preview,choices:{}},'2026-10-18T12:00:00.000Z'),/CLOCK_CONFLICT/);
 assert.equal(JSON.stringify(empty),before);
});

test('two clients restoring the same file at different times produce identical causal records and merge without ID conflicts',async()=>{
 const source=fixture(),text=await backup(source),sync=calendarModule('app/workspace-sync-state.ts');
 for(const recover of [true,false]){
  const local=recover?clone(h.EMPTY_HABIT_WORKSPACE):{...clone(source),habits:source.habits.map(row=>({...row,title:'Keep mine'}))};
  const preview=await r.previewHabitRestore(local,text),choices=recover?{}:{'habit-water':'copy'};
  const left=await r.applyHabitRestore(local,{preview,choices},'2026-10-18T12:00:00.000Z');
  const right=await r.applyHabitRestore(local,{preview,choices},'2026-10-19T12:00:00.000Z');
  assert.deepEqual(left.habits,right.habits);assert.deepEqual(left.habitHistory,right.habitHistory);
  const clock={version:2,updatedAt:at,deviceId:'a'};
  const merged=h.normalizeHabitWorkspace(sync.mergeWorkspaceDocuments({left,right,leftFallback:clock,rightFallback:{...clock,deviceId:'b'}}).document,'profane');
  assert.equal(merged.habits.length,recover?1:2);
  assert.equal(merged.habitMeasurements.length,recover?1:2);
  assert.equal(merged.userProgress.lifetimeXp,local.userProgress.lifetimeXp||source.userProgress.lifetimeXp);
  assert.equal((await r.previewHabitRestore(merged,text)).habits[0].kind,'restored');
 }
});

test('clean recovery restores original IDs, values and the ledger while preserving unrelated private modules',async()=>{
 const source=fixture(), empty={...clone(h.EMPTY_HABIT_WORKSPACE),sleepPlans:[{id:'keep-private-sleep'}]};
 const preview=await r.previewHabitRestore(empty,await backup(source));
 assert.equal(preview.empty,true);assert.equal(preview.habits[0].kind,'new');
 const next=await r.applyHabitRestore(empty,{preview,choices:{}},at);
 assert.equal(next.habits[0].id,source.habits[0].id);assert.equal(l.habitLifecycleState(next.habits[0]).status,'paused');
 assert.equal(next.habitMeasurements[0].value,100125);assert.equal(next.habitMeasurements[0].id,'water-value');
 assert.deepEqual(next.rewardTransactions,source.rewardTransactions);assert.deepEqual(next.userProgress,source.userProgress);
 assert.deepEqual(next.sleepPlans,empty.sleepPlans);
 const normalized=h.normalizeHabitWorkspace(next,'profane');
 assert.equal(normalized.userProgress.lifetimeXp,source.userProgress.lifetimeXp);
 assert.equal(normalized.userProgress.laurelsBalance,source.userProgress.laurelsBalance);
 assert.equal(normalized.habitCompletions[0].xpAwarded,source.habitCompletions[0].xpAwarded);
});

test('conflicts require an explicit choice; keeping current data is a no-op and a separate copy grants no rewards',async()=>{
 const source=fixture(), local=clone(source);local.habits[0].title='Текущее название';
 const text=await backup(source), before=JSON.stringify(local),preview=await r.previewHabitRestore(local,text);
 assert.equal(JSON.stringify(local),before);assert.equal(preview.habits[0].kind,'conflict');
 await assert.rejects(()=>r.applyHabitRestore(local,{preview,choices:{}},at),/CHOICE_REQUIRED/);
 assert.equal(await r.applyHabitRestore(local,{preview,choices:{'habit-water':'keep'}},at),local);
 const next=await r.applyHabitRestore(local,{preview,choices:{'habit-water':'copy'}},at);
 assert.equal(next.habits.length,2);assert.equal(next.habits[0].title,'Текущее название');
 assert.equal(next.habits[1].title,'Моя вода');assert.notEqual(next.habits[1].id,source.habits[0].id);
 assert.deepEqual(next.userProgress,local.userProgress);assert.deepEqual(next.rewardTransactions,local.rewardTransactions);
 const normalized=h.normalizeHabitWorkspace(next,'profane');
 assert.equal(normalized.userProgress.lifetimeXp,local.userProgress.lifetimeXp);
 assert.equal(normalized.habitCompletions.find(row=>row.habitId===next.habits[1].id).xpAwarded,0);
 assert.equal(history.habitEconomyHistory(next).habitCompletions.some(row=>row.habitId===next.habits[1].id),false);
 const repeated=await r.previewHabitRestore(next,text);assert.equal(repeated.habits[0].kind,'restored');
 assert.equal(await r.applyHabitRestore(next,{preview:repeated,choices:{}},at),next);
});

test('a second file application after clean recovery is idempotent and cannot duplicate XP or entries',async()=>{
 const source=fixture(),empty=clone(h.EMPTY_HABIT_WORKSPACE),text=await backup(source);
 const next=await r.applyHabitRestore(empty,{preview:await r.previewHabitRestore(empty,text),choices:{}},at);
 const again=await r.applyHabitRestore(next,{preview:await r.previewHabitRestore(next,text),choices:{}},at);
 assert.equal(again,next);
});

test('a stale preview cannot overwrite edits made by another tab or after a workspace reset',async()=>{
 const source=fixture(),empty=clone(h.EMPTY_HABIT_WORKSPACE),preview=await r.previewHabitRestore(empty,await backup(source));
 const changed={...empty,hiddenDefaultTemplates:['recent-user-choice']};
 await assert.rejects(()=>r.applyHabitRestore(changed,{preview,choices:{}},at),/STALE/);
 assert.deepEqual(changed.hiddenDefaultTemplates,['recent-user-choice']);assert.equal(changed.habits.length,0);
});

test('running timers stop at the backup timestamp and never count the time spent outside the application',async()=>{
 let source=fixture();const habit=source.habits[0];habit.measurement={kind:'duration',unit:'min',target:60000,quickAdd:1000};
 const rule=calendarModule('app/habit-measurement.ts').habitRuleForDate(habit,date);
 source.habitTimers=timers.startHabitTimer([],habit.id,'original-device',{mode:'stopwatch',workMinutes:25,breakMinutes:5,timeZone:'UTC',calendarMode:'profane',context:{version:1,timeZone:'UTC',gregorianYearStart:'january'},habitTitle:habit.title,ruleId:rule.id},'2026-10-18T09:59:00.000Z','clock');
 const empty=clone(h.EMPTY_HABIT_WORKSPACE),preview=await r.previewHabitRestore(empty,await backup(source));
 const next=await r.applyHabitRestore(empty,{preview,choices:{}},'2026-10-19T10:00:00.000Z');
 const session=timers.habitTimerSessions(next.habitTimers)[0];assert.equal(session.state.status,'paused');
 assert.equal(session.state.head.at,at);assert.equal(timers.habitTimerReading(session.state,Date.parse('2026-10-19T10:00:00.000Z')).workMs,60000);
});

test('new imported history in a populated workspace cannot bypass the 50 unique-day deletion threshold',async()=>{
 const source=fixture(),habit=source.habits[0],template=source.habitCompletions[0];habit.createdDate='2026-01-01';habit.schedule.startDate='2026-01-01';
 source.habitCompletions=Array.from({length:50},(_,index)=>({...template,id:'completion-'+index,date:new Date(Date.UTC(2026,0,index+1)).toISOString().slice(0,10)}));
 source.habitMeasurements=[];
 const other=h.defaultHabit(date,'profane');other.id='unrelated';const local={...clone(h.EMPTY_HABIT_WORKSPACE),habits:[other]};
 const next=await r.applyHabitRestore(local,{preview:await r.previewHabitRestore(local,await backup(source)),choices:{}},at);
 assert.equal(retention.habitCompletionCount(history.habitEconomyHistory(next).habitCompletions,habit.id),0);
 assert.equal(next.habitCompletions.filter(row=>row.habitId===habit.id).length,50);
 assert.equal(next.userProgress.lifetimeXp,0);
});

test('a reset generation is an existing workspace and cannot restore old credits or reuse a stale preview',async()=>{
 const source=fixture(),empty=clone(h.EMPTY_HABIT_WORKSPACE),text=await backup(source);
 const old=await r.previewHabitRestore(empty,text),reset={...empty,habitTimerEpoch:timers.nextHabitTimerEpoch('')};
 await assert.rejects(()=>r.applyHabitRestore(reset,{preview:old,choices:{}},at),/STALE/);
 const preview=await r.previewHabitRestore(reset,text);assert.equal(preview.empty,false);
 const next=await r.applyHabitRestore(reset,{preview,choices:{}},at);
 assert.equal(next.userProgress.lifetimeXp,0);assert.deepEqual(next.rewardTransactions,[]);
 assert.equal(retention.habitCompletionCount(history.habitEconomyHistory(next).habitCompletions,source.habits[0].id),0);
});

test('restore retains the full history beyond one thousand dates without a hidden page or month limit',async()=>{
 const source=fixture(),habit=source.habits[0],row=source.habitCompletions[0];habit.createdDate='2023-01-01';habit.schedule.startDate='2023-01-01';
 source.habitMeasurements=[];source.habitCompletions=Array.from({length:1001},(_,index)=>({...row,id:'history-'+index,
  date:new Date(Date.UTC(2023,0,index+1)).toISOString().slice(0,10),xpAwarded:0}));source.userProgress.lifetimeXp=0;
 const empty=clone(h.EMPTY_HABIT_WORKSPACE),text=await backup(source);
 const next=await r.applyHabitRestore(empty,{preview:await r.previewHabitRestore(empty,text),choices:{}},at);
 assert.equal(next.habitCompletions.length,1001);assert.equal(next.habitHistory.length,1001);
 assert.equal(next.habitCompletions[0].id,'history-0');assert.equal(next.habitCompletions.at(-1).id,'history-1000');
 assert.equal(next.userProgress.lifetimeXp,0);
});
