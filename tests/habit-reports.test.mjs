import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const reports=calendarModule('app/habit-insights.ts');
const calendar=calendarModule('app/calendar-context.ts');
const periods=calendarModule('app/habit-period-goal.ts');
const fixture=(entries=[])=>({habits:[{id:'h',title:'Original habit'}],habitCompletions:entries,
 habitMeasurements:[],dailyGoalRecords:[],rewardTransactions:[]});
const entry=(date,completed=true)=>({id:date,habitId:'h',date,completed,xpAwarded:completed?10:0});
const context={version:2,timeZone:'UTC',gregorianYearStart:'january'};

test('an unfinished week is compared with the same elapsed days, excluding last weekend',()=>{
 const result=reports.buildWeeklyHabitSummary(fixture([entry('2026-10-12'),entry('2026-10-11')]),'2026-10-12','profane',context);
 assert.equal(result.completed,1);assert.equal(result.previousCompleted,0);
 assert.equal(result.previousStartDate,'2026-10-05');assert.equal(result.previousEndDate,'2026-10-05');
 assert.equal(result.comparedDays,1);assert.equal(result.changePercent,null);assert.equal(result.absoluteChange,1);
 const equal=reports.buildWeeklyHabitSummary(fixture([entry('2026-10-12'),entry('2026-10-05'),entry('2026-10-11')]),'2026-10-13','profane',context);
 assert.equal(equal.previousEndDate,'2026-10-06');assert.equal(equal.changePercent,0);
});

test('zero entries, no data and positive baselines remain distinguishable without a fabricated percentage',()=>{
 const absent=reports.buildWeeklyHabitSummary(fixture([entry('2026-10-12')]),'2026-10-12','profane',context);
 assert.equal(absent.previousHasData,false);assert.equal(absent.changePercent,null);
 const zero=reports.buildWeeklyHabitSummary(fixture([entry('2026-10-12'),entry('2026-10-05',false)]),'2026-10-12','profane',context);
 assert.equal(zero.previousHasData,true);assert.equal(zero.previousCompleted,0);assert.equal(zero.changePercent,null);
 const measured=fixture([entry('2026-10-12')]);measured.habitMeasurements=[{habitId:'h',date:'2026-10-05',value:500}];
 assert.equal(reports.buildWeeklyHabitSummary(measured,'2026-10-12','profane',context).previousHasData,true);
 const missed=fixture();missed.dailyGoalRecords=[{date:'2026-10-05',status:'missed'}];
 assert.equal(reports.buildWeeklyHabitSummary(missed,'2026-10-12','profane',context).previousHasData,true);
 const reduction=reports.buildWeeklyHabitSummary(fixture([entry('2026-10-05')]),'2026-10-12','profane',context);
 assert.equal(reduction.changePercent,-100);assert.equal(reduction.absoluteChange,-1);
});

test('duplicate daily rows do not inflate marks or XP and future rows are excluded',()=>{
 const result=reports.buildWeeklyHabitSummary(fixture([entry('2026-10-12'),{...entry('2026-10-12'),id:'duplicate'},entry('2026-10-13')]),'2026-10-12','profane',context);
 assert.equal(result.completed,1);assert.equal(result.xp,10);assert.equal(result.bestHabitCompleted,1);
});

test('civil, lunar and sacred comparisons use saved boundaries and equal day counts across year configurations and DST',()=>{
 for(const mode of ['profane','lunar','sacred'])for(const gregorianYearStart of ['january','march'])
 for(const today of ['2026-03-08','2026-03-20','2027-03-19','2027-03-20','2026-10-25','2026-11-01']) {
  const ctx={...context,gregorianYearStart,timeZone:'America/New_York'};
  const definition={version:1,period:'week',metric:'days',target:1,calendar:mode,context:ctx};
  const period=periods.habitGoalPeriod(definition,today);
  const previous=periods.habitGoalPeriod(definition,calendar.addCivilDays(period.start,-1));
  const result=reports.buildWeeklyHabitSummary(fixture(),today,mode,ctx);
  assert.equal(result.startDate,period.start);assert.equal(result.previousStartDate,previous.start);
  assert.equal(result.comparedDays,calendar.civilDayNumber(result.previousEndDate)-calendar.civilDayNumber(result.previousStartDate)+1);
  assert.ok(result.previousEndDate<period.start);assert.ok(result.comparedDays>0);
 }
});

test('reward timestamps follow the report timezone instead of their UTC calendar date',()=>{
 const workspace=fixture();workspace.rewardTransactions=[{amount:5,sourceId:'quest-id',createdAt:'2026-11-02T03:00:00Z'}];
 const west=reports.buildWeeklyHabitSummary(workspace,'2026-11-02','profane',{...context,timeZone:'America/Los_Angeles'});
 const utc=reports.buildWeeklyHabitSummary(workspace,'2026-11-02','profane',context);
 assert.equal(west.laurels,0);assert.equal(utc.laurels,5);
});

test('report projections never change economy, saved entries or rules',()=>{
 const workspace=fixture([entry('2026-10-12')]),before=JSON.stringify(workspace);
 for(const mode of ['profane','sacred','lunar'])reports.buildWeeklyHabitSummary(workspace,'2026-10-12',mode,context);
 assert.equal(JSON.stringify(workspace),before);
});
