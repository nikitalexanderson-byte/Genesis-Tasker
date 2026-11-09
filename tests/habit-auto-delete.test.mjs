import assert from 'node:assert/strict';
import test from 'node:test';
import { calendarModule } from './helpers/calendar-modules.mjs';
const auto=calendarModule('app/habit-auto-delete.ts');
const habits=calendarModule('app/habits.ts');
const lifecycle=calendarModule('app/habit-lifecycle.ts');
const sync=calendarModule('app/workspace-sync-state.ts');
const rewards=calendarModule('app/rewards.ts');
const policy={version:1,id:'31400000-0000-4000-8000-000000000001',count:3,unit:'days',points:'keep',startOn:'2026-10-01'};
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(points='keep') {
  const habit=habits.defaultHabit('2026-10-01','profane');
  habit.title='Automatic habit';
  habit.schedule.timezone='UTC';habit.schedule.recurrence.pattern='daily';habit.autoDeletePolicy={...policy,points};
  const other=habits.defaultHabit('2026-10-01','profane');other.title='Other habit';other.schedule.timezone='UTC';
  const completion=(id,habitId)=>({id,habitId,date:'2026-10-01',completed:true,qualityValue:null,score:10,xpAwarded:10,
    note:'retained',createdAt:'2026-10-01T12:00:00.000Z',updatedAt:'2026-10-01T12:00:00.000Z',version:1,syncState:'local'});
  return {...plain(habits.EMPTY_HABIT_WORKSPACE),habits:[habit,other],habitCompletions:[completion('a',habit.id),completion('b',other.id)],
    rewardTransactions:[rewards.createRewardTransaction({amount:100,reason:'daily-goal',sourceId:'seed',idempotencyKey:'seed',createdAt:'2026-10-01T12:00:00Z'})],
    userProgress:{...plain(habits.EMPTY_HABIT_WORKSPACE.userProgress),lifetimeXp:20,laurelsBalance:100}};
}
const status=()=>({status:'active',conflict:false});
test('expiry waits for closed consecutive civil days, with completion and scheduled first-miss resets',()=>{
  assert.equal(auto.habitAutoDeleteDue(policy,'2026-10-01','2026-10-03',[],status,()=>true),null);
  assert.equal(auto.habitAutoDeleteDue(policy,'2026-10-01','2026-10-04',[],status,()=>true).deadline,'2026-10-04');
  assert.equal(auto.habitAutoDeleteDue(policy,'2026-10-01','2026-10-04',[{date:'2026-10-03',completed:true}],status,()=>true),null);
  assert.equal(auto.habitAutoDeleteDue(policy,'2026-10-01','2026-10-04',[{date:'2026-10-04',completed:true}],status,()=>true),null);
  assert.equal(auto.habitAutoDeleteDue(policy,'2026-10-01','2026-10-04',[],status,day=>day>='2026-10-03'),null);
  assert.equal(auto.habitAutoDeleteDue(policy,'2026-10-01','2026-10-04',[],day=>({...status(),status:day==='2026-10-02'?'paused':'active'}),()=>true),null);
  assert.equal(auto.habitAutoDeleteDue(policy,'2026-10-01','2026-10-04',[],day=>({...status(),conflict:day==='2026-10-02'}),()=>true),null);
});
test('weeks and calendar months handle short February, leap years and year boundaries',()=>{
  for(const [start,count,unit,end] of [['2027-01-31',1,'months','2027-02-28'],['2028-01-31',1,'months','2028-02-29'],
    ['2026-12-31',2,'months','2027-02-28'],['2026-12-31',2,'weeks','2027-01-14']])
    assert.equal(auto.habitAutoDeleteDeadline(start,{count,unit}),end);
});
test('an achieved weekly target resets inactivity before the period has closed',()=>{
  const source=fixture(),habit=source.habits[0];
  habit.autoDeletePolicy={...policy,count:1};
  habit.periodGoal={version:1,period:'week',metric:'days',target:1,calendar:'profane',context:{version:2,timeZone:'UTC',gregorianYearStart:'january'}};
  source.habitCompletions.push({...source.habitCompletions[0],id:'weekly',date:'2026-10-13'});
  const next=habits.applyHabitAutoDeletion(source,'2026-10-14T12:00:00.000Z');
  assert.equal(lifecycle.habitLifecycleState(next.habits[0]).status,'active');
});
test('malformed policies fail closed and enabling or changing a rule starts a fresh period',()=>{
  for(const patch of [{count:0},{count:1.5},{count:366},{unit:'years'},{points:'all'},{startOn:'2027-02-31'},{id:'bad'}])
    assert.throws(()=>auto.normalizeHabitAutoDelete({...policy,...patch}),/INVALID_HABIT_AUTO_DELETE/);
  assert.deepEqual(auto.prepareHabitAutoDelete(policy,policy,'2026-11-01'),policy);
  const changed=auto.prepareHabitAutoDelete({...policy,count:7},policy,'2026-11-01');
  assert.equal(changed.startOn,'2026-11-01');assert.notEqual(changed.id,policy.id);
  assert.equal(auto.prepareHabitAutoDelete(null,policy,'2026-11-01'),null);
});
test('automatic keep preserves all XP, Laurels and evidence, and is idempotent',()=>{
  const original=fixture(),next=habits.applyHabitAutoDeletion(original,'2026-10-05T12:00:00.000Z');
  assert.equal(lifecycle.habitLifecycleState(next.habits[0]).status,'deleted');
  assert.equal(next.userProgress.lifetimeXp,20);assert.equal(next.userProgress.laurelsBalance,100);
  assert.deepEqual(next.habitCompletions,original.habitCompletions);assert.deepEqual(next.rewardTransactions,original.rewardTransactions);
  assert.equal(lifecycle.habitLifecycleState(next.habits[1]).status,'active');
  assert.deepEqual(habits.applyHabitAutoDeletion(next,'2026-10-06T12:00:00.000Z'),next);
});
test('remove deducts only this habit credits once, preserves history and survives normalization',()=>{
  const original=fixture('remove'),next=habits.applyHabitAutoDeletion(original,'2026-10-05T12:00:00.000Z');
  assert.equal(next.userProgress.grossLifetimeXp,20);assert.equal(next.userProgress.forfeitedHabitXp,10);
  assert.equal(next.userProgress.lifetimeXp,10);assert.equal(next.userProgress.laurelsBalance,100);
  assert.deepEqual(next.habitCompletions,original.habitCompletions);
  assert.equal(habits.normalizeHabitWorkspace(plain(next),'profane').userProgress.lifetimeXp,10);
  assert.equal(habits.reconcileHabitAutoDeletePoints(next),next);
  const habit=next.habits[0],restored=habits.applyHabitLifecycleToWorkspace(next,{id:'manual-restore',habitId:habit.id,action:'restore',
    at:'2026-10-06T12:00:00.000Z',heads:lifecycle.habitLifecycleState(habit).heads.map(row=>row.id)});
  assert.equal(habits.reconcileHabitAutoDeletePoints(restored).userProgress.lifetimeXp,10);
});
test('a late offline completion cancels a disproved automatic expiry and refunds its deduction',()=>{
  const original=fixture('remove'),next=habits.applyHabitAutoDeletion(original,'2026-10-05T12:00:00.000Z');
  const late={...original.habitCompletions[0],id:'offline',date:'2026-10-04',createdAt:'2026-10-04T12:00:00.000Z',updatedAt:'2026-10-04T12:00:00.000Z'};
  const repaired=habits.applyHabitAutoDeletion({...next,habitCompletions:[...next.habitCompletions,late]},'2026-10-05T13:00:00.000Z');
  assert.equal(lifecycle.habitLifecycleState(repaired.habits[0]).status,'active');
  assert.equal(repaired.userProgress.forfeitedHabitXp,0);assert.equal(repaired.userProgress.lifetimeXp,30);
  assert.ok(repaired.habits[0].lifecycleHistory.some(row=>row.action==='delete'));
  assert.deepEqual(habits.applyHabitAutoDeletion(repaired,'2026-10-05T14:00:00.000Z'),repaired);
});
test('stale XP totals cannot reverse deductions after a three-way account merge',()=>{
  const base=fixture('remove'),deleted=habits.applyHabitAutoDeletion(base,'2026-10-05T12:00:00.000Z');
  const clock={version:1,updatedAt:'2026-10-05T12:00:00.000Z',deviceId:'a'};
  const merged=sync.mergeWorkspaceDocuments({base,left:deleted,right:base,leftFallback:clock,rightFallback:{...clock,deviceId:'b'}});
  const result=habits.normalizeHabitWorkspace(merged.document ?? merged.workspace ?? merged,'profane');
  assert.equal(result.userProgress.lifetimeXp,10);assert.equal(result.userProgress.grossLifetimeXp,20);
});
