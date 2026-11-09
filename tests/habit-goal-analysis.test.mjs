import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const h=calendarModule('app/habits.ts'),a=calendarModule('app/habit-goal-analysis.ts'),l=calendarModule('app/habit-lifecycle.ts');
const p=calendarModule('app/habit-period-progress.ts'),astro=calendarModule('app/calendar-astronomy.ts');
const context={version:1,timeZone:'UTC',gregorianYearStart:'january'},endNow=new Date('2026-05-11T12:00:00.000Z');
function fixture(metric=null,target=3){
 let habit={...h.defaultHabit('2026-05-04','profane'),id:'analyzed',title:'Analysis',active:false,createdAt:'2026-05-04T00:00:00.000Z'};
 habit.schedule.timezone='UTC';habit=l.applyHabitLifecycleCommand(habit,{id:'birth',habitId:habit.id,action:'resume',at:habit.createdAt,heads:[]});
 if(metric)habit.periodGoal={version:1,period:'week',metric,target,calendar:'profane',context};
 return {habit,workspace:{...structuredClone(h.EMPTY_HABIT_WORKSPACE),habits:[habit]}};
}
function add(f,date,value,id){f.workspace=h.recordHabitMeasurement(f.workspace,f.habit,date,value,{id,recordedAt:date+'T12:00:00.000Z'},date);return f;}
const range={start:'2026-05-04',end:'2026-05-11'};

test('personal records and comparison share the closed-goal denominator and leave an unfinished weekly goal open',()=>{
 const f=fixture('sum',120000),reports=calendarModule('app/habit-insight-analysis.ts');
 f.habit.measurement={kind:'duration',unit:'min',target:60000,quickAdd:1000};
 add(f,'2026-05-04',20000,'partial');
 const today='2026-05-06',now=new Date(today+'T12:00:00Z'),before=JSON.stringify(f.workspace);
 const comparison=reports.buildHabitGoalComparison(f.workspace,today,'profane',context,now);
 assert.equal(comparison.current.planned,0);assert.equal(comparison.current.completed,0);
 assert.equal(comparison.changePercent,null);assert.equal(comparison.open,1);
 const record=reports.buildAnalyzedHabitPersonalRecord(f.workspace,f.habit,today,'profane',date=>({key:date.slice(0,7),label:date.slice(0,7)}),now);
 assert.equal(record.totalCompletions,0);assert.equal(record.completionRate,null);
 const closed=reports.buildAnalyzedHabitPersonalRecord(f.workspace,f.habit,'2026-05-11','profane',date=>({key:date.slice(0,7),label:date.slice(0,7)}),endNow);
 assert.equal(closed.scheduledCount,1);assert.equal(closed.scheduledCompletedCount,0);assert.equal(closed.completionRate,0);
 assert.equal(JSON.stringify(f.workspace),before);
});

test('legacy completed days remain in mastery but cannot fabricate a historical percentage',()=>{
 const f=fixture(),reports=calendarModule('app/habit-insight-analysis.ts');f.habit.lifecycleHistory=[];
 f.workspace.habitCompletions=[{id:'old',habitId:f.habit.id,date:'2026-05-04',completed:true,version:1,updatedAt:'2026-05-04T12:00:00Z',xpAwarded:10}];
 const record=reports.buildAnalyzedHabitPersonalRecord(f.workspace,f.habit,'2026-05-11','profane',date=>({key:date.slice(0,7),label:date.slice(0,7)}),endNow);
 assert.equal(record.totalCompletions,1);assert.equal(record.scheduledCount,0);assert.equal(record.completionRate,null);assert.ok(record.unknownDays>0);
});

test('volume above 100% is separate from unique successful closed days and the open day',()=>{
 const f=fixture();f.habit.measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};
 add(f,'2026-05-04',50000,'partial');add(f,'2026-05-05',100000,'first');add(f,'2026-05-05',100000,'second');add(f,'2026-05-05',100000,'third');add(f,'2026-05-06',75000,'open');
 const before=JSON.stringify(f.workspace),report=a.analyzeHabitRange(f.workspace,f.habit,range,new Date('2026-05-06T13:00:00Z'));
 assert.equal(report.closedCount,2);assert.equal(report.completedCount,1);assert.equal(report.completionPercent,50);
 assert.equal(report.volumes[0].actual,350000);assert.equal(report.volumes[0].target,200000);assert.equal(report.volumes[0].percent,175);
 assert.equal(report.volumes[0].openActual,75000);assert.equal(report.days[0].activity,'partial');assert.equal(report.days[3].future,true);
 assert.equal(JSON.stringify(f.workspace),before);
});
test('weekly entries and distinct days remain different metrics with one closed goal each',()=>{
 const f=fixture('entries');for(let i=0;i<3;i++)add(f,'2026-05-04',1000,'entry-'+i);
 const entries=a.analyzeHabitRange(f.workspace,f.habit,range,endNow);
 assert.equal(entries.closedCount,1);assert.equal(entries.completedCount,1);assert.equal(entries.opportunities[0].value,3);
 assert.equal(entries.days[0].activity,'activity');assert.equal(entries.completionPercent,100);
 const habit={...f.habit,periodGoal:{...f.habit.periodGoal,metric:'days'}};
 const days=a.analyzeHabitRange(f.workspace,habit,range,endNow);
 assert.equal(days.opportunities[0].value,1);assert.equal(days.completedCount,0);assert.equal(days.completionPercent,0);
});
test('positive daily activity never becomes a successful weekly duration goal',()=>{
 const f=fixture('sum',120000);f.habit.measurement={kind:'duration',unit:'min',target:60000,quickAdd:15000};add(f,'2026-05-04',20000,'minutes');
 assert.equal(f.workspace.habitCompletions[0].completed,true);
 const report=a.analyzeHabitRange(f.workspace,f.habit,range,endNow);
 assert.equal(report.days[0].activity,'activity');assert.equal(report.closedCount,1);assert.equal(report.completedCount,0);assert.equal(report.completionPercent,0);
 assert.equal(report.volumes[0].actual,20000);assert.equal(report.volumes[0].target,120000);
});
test('pausing partway through an unfinished goal is neutral; a goal already achieved remains in history',()=>{
 for(const amount of [20000,120000]){
  const f=fixture('sum',120000);f.habit.measurement={kind:'duration',unit:'min',target:60000,quickAdd:15000};add(f,'2026-05-04',amount,'minutes');
  f.habit=l.applyHabitLifecycleCommand(f.habit,{id:'pause',habitId:f.habit.id,at:'2026-05-06T12:00:00.000Z',action:'pause',heads:['birth']});
  const progress=p.habitPeriodProgress(f.habit,'2026-05-05',f.workspace,endNow);
  assert.equal(progress.partial,true);assert.equal(progress.status,amount===120000?'completed':'neutral');
  const report=a.analyzeHabitRange(f.workspace,f.habit,range,endNow);assert.equal(report.closedCount,amount===120000?1:0);
 }
});
test('an archive after a closed period cannot turn that past missed goal into a neutral period',()=>{
 const f=fixture('sum',120000);f.habit.measurement={kind:'duration',unit:'min',target:60000,quickAdd:15000};add(f,'2026-05-04',20000,'minutes');
 f.habit=l.applyHabitLifecycleCommand(f.habit,{id:'archive',habitId:f.habit.id,at:'2026-05-12T12:00:00.000Z',action:'archive',heads:['birth']});
 assert.equal(p.habitPeriodProgress(f.habit,'2026-05-10',f.workspace,new Date('2026-05-13T12:00:00Z')).status,'missed');
});
test('unrecorded legacy pause history is unknown rather than a fabricated denominator',()=>{
 const f=fixture();f.habit.lifecycleHistory=[];f.habit.measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};add(f,'2026-05-04',100000,'value');
 const report=a.analyzeHabitRange(f.workspace,f.habit,range,endNow);
 assert.equal(report.completionPercent,null);assert.equal(report.unknownDays,7);assert.equal(report.volumes[0].percent,null);
 assert.equal(report.volumes[0].unknownActual,100000);assert.equal(report.days[0].completed,true);
});
test('the actual long lunar year determines the full cell count and retains its final dates',()=>{
 let year=null;for(let n=2020;n<2040;n++){const candidate=astro.calendarPeriod(n+'-07-01','lunar','year',context);
  if((Date.parse(candidate.end)-Date.parse(candidate.start))/86400000>370){year=candidate;break;}}
 assert.ok(year);const f=fixture();f.habit.createdDate=year.start;f.habit.schedule.startDate=year.start;f.habit.lifecycleHistory=[];
 const report=a.analyzeHabitRange(f.workspace,f.habit,year,new Date(year.end+'T12:00:00Z'));
 assert.equal(report.days.length,(Date.parse(year.end)-Date.parse(year.start))/86400000);assert.ok(report.days.length>370);
 assert.equal(report.days.at(-1).date,new Date(Date.parse(year.end)-86400000).toISOString().slice(0,10));
});
