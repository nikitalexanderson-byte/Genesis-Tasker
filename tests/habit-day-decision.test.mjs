import test from 'node:test';import assert from 'node:assert/strict';import {calendarModule} from './helpers/calendar-modules.mjs';
const h=calendarModule('app/habits.ts'),d=calendarModule('app/habit-day-decision.ts'),his=calendarModule('app/habit-history.ts'),correction=calendarModule('app/habit-history-workspace.ts');
const at='2026-05-04T12:00:00.000Z',date='2026-05-04',now=new Date(at);
function fixture(){const habit=h.defaultHabit(date,'profane');habit.id='decision-habit';habit.title='Decision';habit.schedule.timezone='UTC';return {...structuredClone(h.EMPTY_HABIT_WORKSPACE),habits:[habit]};}
const command={id:'skip-once',habitId:'decision-habit',date,at,heads:[],skipped:true};

test('a stale skip cannot overwrite a completed day',()=>{
 const source=fixture(),done=h.updateHabitCompletion(source,source.habits[0],date,{completed:true},date);
 assert.throws(()=>d.applyHabitDayDecision(done,command,now),/ALREADY_COMPLETED/);
 assert.equal(done.habitCompletions[0].completed,true);
});

test('explicit skip has a causal receipt, changes no rewards and replays safely after the day changes',()=>{
 const source=fixture(),next=d.applyHabitDayDecision(source,command,now);
 assert.equal(next.habitCompletions[0].skippedAt,at);assert.equal(next.habitCompletions[0].completed,false);assert.equal(next.habitCompletions[0].xpAwarded,0);
 assert.deepEqual(next.userProgress,source.userProgress);assert.deepEqual(next.rewardTransactions,source.rewardTransactions);
 assert.equal(next.habitTimerEpoch,'lifecycle7:');assert.equal(d.applyHabitDayDecision(next,command,new Date('2026-05-05T12:00:00Z')),next);
 assert.throws(()=>d.applyHabitDayDecision(next,{...command,skipped:false},now),/ID_CONFLICT/);
 assert.throws(()=>d.applyHabitDayDecision(source,{...command,date:'2026-05-03'},now),/UNAVAILABLE/);
});
test('later actual completion supersedes a skip, survives repeated normalization and keeps its original economic evidence',()=>{
 let workspace=d.applyHabitDayDecision(fixture(),command,now);
 workspace=h.updateHabitCompletion(workspace,workspace.habits[0],date,{completed:true},date);
 workspace.habitCompletions[0].updatedAt='2026-05-04T12:01:00.000Z';
 for(let n=0;n<3;n++)workspace=h.normalizeHabitWorkspace(workspace,'profane');
 assert.equal(workspace.habitCompletions[0].completed,true);assert.equal(Boolean(workspace.habitCompletions[0].skippedAt),false);
 assert.equal(his.habitEconomyHistory(workspace).habitCompletions[0].completed,true);assert.equal(workspace.userProgress.lifetimeXp,10);
 const rule=calendarModule('app/habit-measurement.ts').habitRuleForDate(workspace.habits[0],date);
 const value=correction.habitHistoryInitialValue(workspace,workspace.habits[0].id,date);value.completed=false;
 workspace=correction.applyHabitHistoryCommand(workspace,{id:'later-correction',habitId:workspace.habits[0].id,date,ruleId:rule.id,at:'2026-05-05T12:00:00.000Z',heads:['skip-once'],value},'profane',new Date('2026-05-05T12:00:00Z'));
 assert.equal(workspace.habitCompletions[0].completed,false);assert.equal(his.habitEconomyHistory(workspace).habitCompletions[0].completed,true);
});
test('later measured activity clears the decision without freezing new real rewards or deleting the receipt',()=>{
 const base=fixture();base.habits[0].measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};
 let next=d.applyHabitDayDecision(base,command,now);
 next=h.recordHabitMeasurement(next,next.habits[0],date,100000,{id:'actual-after-skip',recordedAt:'2026-05-04T12:01:00.000Z'},date);
 next=h.normalizeHabitWorkspace(next,'profane');next=h.normalizeHabitWorkspace(next,'profane');
 assert.equal(next.habitCompletions[0].completed,true);assert.equal(Boolean(next.habitCompletions[0].skippedAt),false);
 assert.equal(next.habitHistory[0].id,'skip-once');assert.equal(his.habitEconomyHistory(next).habitMeasurements.length,1);assert.equal(next.userProgress.lifetimeXp,10);
});
test('concurrent decisions stay conflicted until a command explicitly replaces both heads',()=>{
 const base=fixture(),left=d.applyHabitDayDecision(base,command,now),right=d.applyHabitDayDecision(base,{...command,id:'other-skip',skipped:false},now);
 const history=his.mergeHabitHistoryEdits(left.habitHistory,right.habitHistory);assert.equal(his.habitHistoryState(history,'decision-habit',date).conflict,true);
 const mixed={...left,habitHistory:history};assert.throws(()=>d.applyHabitDayDecision(mixed,{...command,id:'stale'},now),/EDIT_CONFLICT/);
 const resolved=d.applyHabitDayDecision(mixed,{...command,id:'resolve',heads:['skip-once','other-skip'],at:'2026-05-04T12:01:00.000Z'},new Date('2026-05-04T12:01:00Z'));
 assert.equal(his.habitHistoryState(resolved.habitHistory,'decision-habit',date).conflict,false);
});
