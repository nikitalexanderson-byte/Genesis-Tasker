import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarModule } from './helpers/calendar-modules.mjs';
const lifecycle=calendarModule('app/habit-lifecycle.ts');
const fixture=()=>({id:'habit-original',title:'Original private title',active:true,
 schedule:{timezone:'Europe/Moscow'},rewards:[{id:'credit-1',amount:10}],notes:['Keep me']});
const plain=value=>JSON.parse(JSON.stringify(value));
const habits=calendarModule('app/habits.ts'),sync=calendarModule('app/workspace-sync-state.ts');
const timers=calendarModule('app/habit-timer.ts'),storage=calendarModule('app/habit-timer-storage.ts');
const history=calendarModule('app/habit-history-workspace.ts'),rewards=calendarModule('app/rewards.ts');
const now='2026-10-17T12:00:00.000Z';

test('concurrent availability observations agree, remain historically honest and permit one real transition',()=>{
 const source=workspaceFixture(),habit=source.habits[0];
 const observe=(id,at)=>lifecycle.applyHabitLifecycleCommand(habit,{id,habitId:habit.id,action:'observe',at,heads:[]});
 const a=observe('observed-a',now),b=observe('observed-b','2026-10-17T12:01:00.000Z');
 const merged=lifecycle.projectHabitLifecycle({...habit,lifecycleHistory:lifecycle.mergeHabitLifecycleEvents(a.lifecycleHistory,b.lifecycleHistory)});
 assert.equal(lifecycle.habitLifecycleState(merged).conflict,false);
 const next=lifecycle.applyHabitLifecycleCommand(merged,command(merged,'pause','real-pause','2026-10-17T12:02:00.000Z'));
 assert.equal(lifecycle.habitLifecycleState(next).status,'paused');
 const analysis=calendarModule('app/habit-goal-analysis.ts');
 assert.equal(analysis.habitAvailabilityKnown(next,'2026-10-16','2026-10-18'),false);
 assert.equal(analysis.habitAvailabilityKnown(next,'2026-10-17','2026-10-18'),true);
 const edited={...source,habits:[{...habit,title:'Edited'}]};
 const observed=habits.observeChangedHabitAvailability(source,edited,now);
 assert.equal(observed.habits[0].lifecycleHistory[0].action,'observe');
 assert.deepEqual(observed.rewardTransactions,source.rewardTransactions);
 assert.equal(habits.observeChangedHabitAvailability(observed,observed,now),observed);
 assert.equal(habits.observeChangedHabitAvailability(source,source,now),source);
});
function workspaceFixture(days=0) {
 const habit=habits.defaultHabit('2026-08-01','profane');habit.schedule.timezone='UTC';habit.title='Original habit';
 const habitCompletions=Array.from({length:days},(_,index)=>({id:'completion-'+index,habitId:habit.id,
  date:new Date(Date.UTC(2026,7,1+index)).toISOString().slice(0,10),completed:true,qualityValue:null,score:10,xpAwarded:10,
  note:'original note',createdAt:new Date(Date.UTC(2026,7,1+index,12)).toISOString(),updatedAt:now,version:1,syncState:'local'}));
 const rewardTransactions=[rewards.createRewardTransaction({amount:100,reason:'daily-goal',sourceId:'original',idempotencyKey:'original',createdAt:'2026-10-01T12:00:00Z'})];
 return {...plain(habits.EMPTY_HABIT_WORKSPACE),habits:[habit],habitCompletions,rewardTransactions,
  userProgress:{...plain(habits.EMPTY_HABIT_WORKSPACE.userProgress),lifetimeXp:days*10,laurelsBalance:100}};
}
const change=(workspace,action,id,at=now,selectedId)=>habits.applyHabitLifecycleToWorkspace(workspace,command(workspace.habits[0],action,id,at,selectedId));
const command=(habit,action,id,at='2026-10-17T12:00:00.000Z',selectedId)=>({id,habitId:habit.id,action,at,
 heads:lifecycle.habitLifecycleState(habit).heads.map(row=>row.id),...(selectedId?{selectedId}:{})});

test('pause, archive, delete and restore retain identity and payload while restore waits for explicit resume',()=>{
 let habit=fixture();const original=plain(habit);
 for(const [index,action]of ['pause','archive','delete','restore','resume'].entries()){
  const before=plain(habit);habit=lifecycle.applyHabitLifecycleCommand(habit,command(habit,action,'op-'+index));
  assert.equal(habit.id,original.id);assert.equal(habit.title,original.title);assert.deepEqual(plain(habit.rewards),original.rewards);
  assert.deepEqual(plain(habit.notes),original.notes);assert.deepEqual(plain(habit.schedule),original.schedule);
  assert.equal(habit.active,action==='resume');assert.equal(habit.lifecycleHistory.length,index+1);
  assert.equal(before.lifecycleHistory?.length??0,index);
 }
 assert.equal(lifecycle.habitLifecycleState(habit).status,'active');
});

test('past availability is retained after a current pause and transitions use the saved timezone',()=>{
 const habit=lifecycle.applyHabitLifecycleCommand(fixture(),command(fixture(),'pause','pause','2026-10-16T22:30:00Z'));
 assert.equal(habit.lifecycleHistory[0].date,'2026-10-17');
 assert.equal(lifecycle.habitLifecycleState(habit,'2026-10-16').status,'active');
 assert.equal(lifecycle.habitLifecycleState(habit,'2026-10-17').status,'paused');
 assert.equal(habit.lifecycleHistory[0].at,'2026-10-16T22:30:00.000Z');
});

test('independent offline lifecycle transitions remain explicit and resolution preserves both branches',()=>{
 const base=lifecycle.applyHabitLifecycleCommand(fixture(),command(fixture(),'pause','base','2026-10-17T08:00:00Z'));
 const archived=lifecycle.applyHabitLifecycleCommand(base,command(base,'archive','archive','2026-10-17T09:00:00Z'));
 const resumed=lifecycle.applyHabitLifecycleCommand(base,command(base,'resume','resume','2026-10-17T09:00:00Z'));
 const merged=lifecycle.projectHabitLifecycle({...base,lifecycleHistory:lifecycle.mergeHabitLifecycleEvents(archived.lifecycleHistory,resumed.lifecycleHistory)});
 const state=lifecycle.habitLifecycleState(merged);assert.equal(state.conflict,true);assert.equal(state.status,'archived');assert.equal(merged.active,false);
 assert.throws(()=>lifecycle.applyHabitLifecycleCommand(merged,command(merged,'resume','implicit')),/TRANSITION_UNAVAILABLE/);
 const resolved=lifecycle.applyHabitLifecycleCommand(merged,command(merged,'resolve','explicit','2026-10-17T10:00:00Z','resume'));
 assert.equal(resolved.active,true);assert.equal(lifecycle.habitLifecycleState(resolved).conflict,false);
 assert.deepEqual(plain(resolved.lifecycleHistory.map(row=>row.id)),['base','archive','resume','explicit']);
 assert.deepEqual(plain(resolved.rewards),plain(base.rewards));
});

test('same-ID retry is idempotent while changed meaning and stale heads are rejected',()=>{
 const initial=fixture(),input=command(initial,'archive','archive');
 const saved=lifecycle.applyHabitLifecycleCommand(initial,input);
 assert.strictEqual(lifecycle.applyHabitLifecycleCommand(saved,input),saved);
 assert.throws(()=>lifecycle.applyHabitLifecycleCommand(saved,{...input,action:'delete'}),/ID_CONFLICT/);
 assert.throws(()=>lifecycle.applyHabitLifecycleCommand(saved,{...input,id:'stale'}),/EDIT_CONFLICT/);
 assert.throws(()=>lifecycle.applyHabitLifecycleCommand(saved,command(saved,'restore','clock','2026-10-16T12:00:00Z')),/CLOCK_CONFLICT/);
});

test('malformed journals, missing parents and cycles cannot silently enable scheduling',()=>{
 const saved=lifecycle.applyHabitLifecycleCommand(fixture(),command(fixture(),'pause','a'));
 const row=plain(saved.lifecycleHistory[0]);
 assert.throws(()=>lifecycle.mergeHabitLifecycleEvents([{...row,replaces:['missing']}]),/INVALID_HABIT_LIFECYCLE/);
 assert.throws(()=>lifecycle.mergeHabitLifecycleEvents([{...row,replaces:['b']},{...row,id:'b',replaces:['a']}]),/INVALID_HABIT_LIFECYCLE/);
 assert.throws(()=>lifecycle.projectHabitLifecycle({...fixture(),lifecycleHistory:[{...row,habitId:'other'}]}),/INVALID_HABIT_LIFECYCLE/);
 assert.throws(()=>lifecycle.mergeHabitLifecycleEvents([{...row,status:'running'}]),/INVALID_HABIT_LIFECYCLE/);
 assert.throws(()=>lifecycle.mergeHabitLifecycleEvents([{...row,status:'active'}]),/INVALID_HABIT_LIFECYCLE/);
});

test('archive and restore survive full normalization without dropping history, identity or any earned currency',()=>{
 const base=workspaceFixture(49),archived=change(base,'archive','archive');
 assert.deepEqual(plain(archived.habitCompletions),plain(base.habitCompletions));
 assert.deepEqual(plain(archived.rewardTransactions),plain(base.rewardTransactions));
 assert.equal(archived.userProgress.lifetimeXp,base.userProgress.lifetimeXp);
 const saved=habits.normalizeHabitWorkspace(plain(archived),'profane');
 assert.equal(saved.habits[0].lifecycleHistory.length,1);assert.equal(saved.habits[0].active,false);
 assert.equal(saved.habitTimerEpoch,'lifecycle7:');
 assert.equal(habits.isHabitScheduledForDate(saved.habits[0],'2026-10-16','profane'),true);
 assert.equal(habits.isHabitScheduledForDate(saved.habits[0],'2026-10-17','profane'),false);
 const restored=change(saved,'restore','restore');assert.equal(restored.habits[0].id,base.habits[0].id);
 assert.equal(restored.habits[0].active,false);assert.equal(restored.habitCompletions.length,49);
 assert.equal(change(restored,'resume','resume').habits[0].active,true);
});

test('deletion keeps recoverable evidence and the original 49/50 unique-day economy; replay and restore do not refund it',()=>{
 for(const days of [49,50]) {
  const base=workspaceFixture(days),deleted=change(base,'delete','delete');
  assert.equal(deleted.habits.length,1);assert.equal(deleted.habitCompletions.length,days);
  assert.equal(deleted.userProgress.laurelsBalance,days===50?100:0);
  assert.equal(change(deleted,'restore','restore').userProgress.laurelsBalance,days===50?100:0);
  assert.equal(habits.applyHabitLifecycleToWorkspace(deleted,command(base.habits[0],'delete','delete')),deleted);
 }
 const many=workspaceFixture(50);many.habitCompletions=many.habitCompletions.map(row=>({...row,date:'2026-10-16'}));
 assert.equal(change(many,'delete','delete').userProgress.laurelsBalance,0);
 const initial=workspaceFixture(0),date='2026-10-16',habit=initial.habits[0];
 const corrected=history.applyHabitHistoryCommand(initial,{id:'backfill',at:now,habitId:habit.id,date,
  ruleId:calendarModule('app/habit-measurement.ts').habitRuleForDate(habit,date).id,heads:[],
  value:{completed:true,completedTimes:[],qualityValue:null,qualityConfirmedAt:null,note:''}},'profane',new Date(now));
 assert.equal(change(corrected,'delete','delete').userProgress.laurelsBalance,0);
 const restored=change(change(initial,'delete','first'),'restore','restore');
 restored.rewardTransactions.push(rewards.createRewardTransaction({amount:20,reason:'daily-goal',sourceId:'later',idempotencyKey:'later',createdAt:'2026-10-18T08:00:00Z'}));
 const second=change(restored,'delete','second','2026-10-18T12:00:00Z');
 assert.equal(rewards.calculateLaurelsBalance(second.rewardTransactions),0);
 assert.equal(second.rewardTransactions.filter(row=>row.reason==='habit-deleted-reset').length,2);
});

test('offline state branches and full stale workspace writes retain lifecycle, evidence and conflicts',()=>{
 const base=workspaceFixture(2),a=change(base,'archive','a'),b=change(base,'pause','b');
 const clock={version:1,updatedAt:now,deviceId:'a'};
 const merged=habits.normalizeHabitWorkspace(sync.mergeWorkspaceDocuments({left:a,right:b,leftFallback:clock,rightFallback:{...clock,deviceId:'b'}}).document,'profane');
 assert.equal(lifecycle.habitLifecycleState(merged.habits[0]).conflict,true);
 assert.equal(merged.habits[0].active,false);
 const stale=storage.preserveHabitTimerRecords({...base,habits:[],habitCompletions:[]},merged);
 assert.equal(stale.habits.length,1);assert.equal(stale.habitCompletions.length,2);
 assert.equal(stale.habits[0].lifecycleHistory.length,2);assert.equal(stale.habitTimerEpoch,'lifecycle7:');
 const resolved=change(merged,'resolve','resolved',now,'a');
 assert.equal(lifecycle.habitLifecycleState(resolved.habits[0]).conflict,false);
 assert.equal(resolved.habits[0].active,false);
 assert.equal(storage.preserveHabitTimerRecords(base,resolved).habits[0].lifecycleHistory.length,3);
});

test('pause preserves a running timer, blocks stale quick actions and permits a time-only recovery',()=>{
 const base=workspaceFixture(),habit=base.habits[0];habit.measurement={kind:'duration',unit:'min',target:1000,quickAdd:1000};
 const timerCommands=calendarModule('app/habit-timer-workspace.ts');
 const running=timerCommands.applyHabitTimerCommand(base,{action:'start',owner:'owner',habitId:habit.id,id:'timer',at:'2026-10-17T11:00:00Z'});
 const paused=change(running,'pause','pause');
 assert.equal(timers.habitTimerSessions(paused.habitTimers)[0].state.status,'paused');
 assert.equal(habits.updateHabitCompletion(paused,habit,'2026-10-17',{completed:true},'2026-10-17'),paused);
 assert.throws(()=>habits.recordHabitMeasurement(paused,habit,'2026-10-17',1000,{},'2026-10-17'),/DATE_UNAVAILABLE/);
 assert.throws(()=>timerCommands.applyHabitTimerCommand(paused,{action:'resume',owner:'owner',sessionId:'timer',id:'resume',at:now}),/DATE_UNAVAILABLE/);
 const finished=timerCommands.applyHabitTimerCommand(paused,{action:'finish',owner:'owner',sessionId:'timer',id:'finish',at:now});
 const saved=timerCommands.applyHabitTimerCommand(finished,{action:'save',owner:'owner',sessionId:'timer',id:'save',at:now,timeOnly:true});
 assert.equal(timers.habitTimerSessions(saved.habitTimers)[0].state.status,'saved');
 assert.equal(saved.habitMeasurements.length,0);
});

test('protocol-6 offline readers preserve original bytes and current reset advances the generation',async()=>{
 const legacy=await import('./fixtures/habit-epoch-v6.mjs');
 const archived=change(workspaceFixture(),'archive','archive');
 assert.throws(()=>legacy.habitTimerEpoch(archived.habitTimerEpoch),/INVALID_HABIT_TIMER/);
 const bytes=JSON.stringify(archived),values=new Map([['workspace',bytes]]),local={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
 const protectedStorage=calendarModule('app/workspace-storage.ts');
 assert.throws(()=>protectedStorage.readProtectedWorkspace(local,'workspace',raw=>({...raw,habitTimerEpoch:legacy.habitTimerEpoch(raw.habitTimerEpoch)}),()=>workspaceFixture()),/RECOVERY_REQUIRED/);
 assert.throws(()=>protectedStorage.writeProtectedWorkspace(local,'workspace',workspaceFixture()),/RECOVERY_REQUIRED/);
 assert.equal(values.get('workspace'),bytes);
 const reset=calendarModule('app/habit-reset.ts').resetHabitWorkspace(archived);
 assert.doesNotThrow(()=>legacy.habitTimerEpoch(reset.habitTimerEpoch));
 assert.throws(()=>storage.preserveHabitTimerRecords(archived,reset),/HABIT_TIMER_RESET/);
});
