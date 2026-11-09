import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const r=calendarModule('app/rewards.ts');
const credit=(key,createdAt,amount=25)=>r.createRewardTransaction({amount,reason:'comeback',sourceId:key,idempotencyKey:key,createdAt});
const at='2026-10-18T12:00:00.000Z';

test('two binary clients and legacy duplicate snapshots can earn only one daily credit; a stale edit retains earned XP',()=>{
 const h=calendarModule('app/habits.ts'),sync=calendarModule('app/workspace-sync-state.ts'),progress=calendarModule('app/habit-progress.ts');
 const habit={...h.defaultHabit('2026-10-18','profane'),id:'binary-once',title:'Binary once'};
 const base={...structuredClone(h.EMPTY_HABIT_WORKSPACE),habits:[habit]};
 const a=h.updateHabitCompletion(base,habit,'2026-10-18',{completed:true},'2026-10-18');
 const b=h.updateHabitCompletion(base,habit,'2026-10-18',{completed:true},'2026-10-18');
 assert.equal(a.habitCompletions[0].id,'habit-completion:binary-once:2026-10-18');
 const clock={version:2,updatedAt:at,deviceId:'a'};
 let merged=h.normalizeHabitWorkspace(sync.mergeWorkspaceDocuments({left:a,right:b,leftFallback:clock,rightFallback:{...clock,deviceId:'b'}}).document,'profane');
 assert.equal(merged.habitCompletions.length,1);assert.equal(merged.userProgress.lifetimeXp,10);
 const duplicate={...merged.habitCompletions[0],id:'legacy-second-client'};
 assert.equal(progress.reconcileUserProgress({...merged.userProgress,lifetimeXp:0},[...merged.habitCompletions,duplicate]).lifetimeXp,10);
 assert.equal(progress.reconcileUserProgress({...merged.userProgress,lifetimeXp:80},[...merged.habitCompletions,duplicate]).lifetimeXp,80);
 const stale={...b,userProgress:{...b.userProgress,lifetimeXp:0},habitCompletions:b.habitCompletions.map(row=>({...row,xpAwarded:0,completed:false,version:3}))};
 merged=h.normalizeHabitWorkspace(sync.mergeWorkspaceDocuments({left:merged,right:stale,leftFallback:clock,rightFallback:{...clock,version:3,deviceId:'b'}}).document,'profane');
 assert.equal(merged.habitCompletions[0].xpAwarded,10);assert.equal(merged.userProgress.lifetimeXp,10);
 const reset=calendarModule('app/habit-reset.ts').resetHabitWorkspace(merged,'2026-10-19T12:00:00.000Z');
 const stamped=sync.prepareWorkspaceForSync({current:reset,base:merged,clock:{...clock,version:4,updatedAt:'2026-10-19T12:00:00.000Z'}});
 const replay=h.normalizeHabitWorkspace(sync.mergeWorkspaceDocuments({left:stamped.document,right:stale,leftFallback:{...clock,version:4},rightFallback:clock}).document,'profane');
 assert.equal(replay.userProgress.lifetimeXp,0);
 assert.equal(replay.habitCompletions.length,0);
});

test('explicit early-deletion reset wins over credits at the same instant regardless of keys, timezone notation or arrival order',()=>{
 for(const timestamp of [at,'2026-10-18T12:00:00Z','2026-10-18T15:00:00+03:00']) {
  const earned=credit('zz-credit',timestamp);
  const ledger=r.resetLaurelsBalance([earned],'habit-deleted-reset','habit','aa-deletion',at);
  assert.equal(r.calculateLaurelsBalance(ledger),0);
  assert.equal(r.calculateLaurelsBalance([...ledger].reverse()),0);
  assert.equal(r.calculateLaurelsBalance([...ledger,...ledger]),0);
 }
});
test('a reward earned after a deletion remains valid while an offline replay cannot reissue older credits',()=>{
 const earned=credit('zz-credit','2026-10-18T11:59:59Z');
 const ledger=r.resetLaurelsBalance([earned],'habit-deleted-reset','habit','deletion',at);
 const next=[...ledger,credit('later','2026-10-18T12:00:00.001Z',5),earned];
 assert.equal(r.calculateLaurelsBalance(next),5);
 assert.equal(r.normalizeRewardTransactions(next).filter(row=>row.idempotencyKey==='zz-credit').length,1);
});
