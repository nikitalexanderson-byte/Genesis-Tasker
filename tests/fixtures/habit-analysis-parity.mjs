import {calendarModule} from '../helpers/calendar-modules.mjs';
const h=calendarModule('app/habits.ts'),a=calendarModule('app/habit-goal-analysis.ts'),l=calendarModule('app/habit-lifecycle.ts'),i=calendarModule('app/habit-insight-analysis.ts');
const clone=value=>JSON.parse(JSON.stringify(value));
function habit(id,zone='UTC') {
 const row=h.defaultHabit('2026-10-01','profane');Object.assign(row,{id,title:'Собственная практика '+id,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z'});
 row.schedule.timezone=zone;return l.applyHabitLifecycleCommand(row,{id:'initial-'+id,habitId:id,at:'2026-10-01T00:00:00.000Z',action:'observe',heads:[]});
}
function snapshot(row,date,completed,version=1) {return {id:`${row.id}-${date}-${version}`,habitId:row.id,date,completed,qualityValue:null,note:'',score:completed?10:0,xpAwarded:0,
 createdAt:date+'T12:00:00.000Z',updatedAt:date+'T12:00:00.000Z',version,syncState:'local',completedTimes:[],qualityConfirmedAt:null};}
export function habitAnalysisParityCases(){
 const now='2026-10-22T12:00:00.000Z',range={start:'2026-10-19',end:'2026-10-23'},context={version:1,timeZone:'UTC',gregorianYearStart:'january'};
 const cases=[];const add=(name,workspace,period=range,time=now)=>{
  const row=workspace.habits[0],report=a.analyzeHabitRange(workspace,row,period,new Date(time)),comparison=i.buildHabitGoalComparison(workspace,time.slice(0,10),'profane',context,new Date(time));
  cases.push({name,workspace,range:period,now:time,context,expected:{report,comparison}});
 };
 const binary=habit('binary');add('duplicate snapshots select the current revision',{...clone(h.EMPTY_HABIT_WORKSPACE),habits:[binary],habitCompletions:[snapshot(binary,'2026-10-19',true),snapshot(binary,'2026-10-19',false,2),snapshot(binary,'2026-10-20',true)]});
 const measured=habit('volume');measured.measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};
 let volume={...clone(h.EMPTY_HABIT_WORKSPACE),habits:[measured]};
 for(const [date,value,id] of [['2026-10-19',150000,'v1'],['2026-10-19',150000,'v2'],['2026-10-20',50000,'v3']]) volume=h.recordHabitMeasurement(volume,measured,date,value,{id,recordedAt:date+'T12:00:00.000Z'},date);
 add('volume and goal-day denominators remain separate',volume);
 const weekly=clone(measured);weekly.id='weekly';weekly.title='Гибкая недельная цель';weekly.lifecycleHistory=[];weekly.periodGoal={version:1,period:'week',metric:'sum',target:300000,calendar:'profane',context};
 const weeklyKnown=l.applyHabitLifecycleCommand(weekly,{id:'initial-weekly',habitId:weekly.id,at:'2026-10-01T00:00:00.000Z',action:'observe',heads:[]});
 let flexible={...clone(h.EMPTY_HABIT_WORKSPACE),habits:[weeklyKnown]};
 flexible=h.recordHabitMeasurement(flexible,weeklyKnown,'2026-10-17',350000,{id:'closed-goal',recordedAt:'2026-10-17T12:00:00.000Z'},'2026-10-17');
 flexible=h.recordHabitMeasurement(flexible,weeklyKnown,'2026-10-21',50000,{id:'open-goal',recordedAt:'2026-10-21T12:00:00.000Z'},'2026-10-21');
 add('open weekly goals are separate from closed goals',flexible,{start:'2026-10-01',end:'2026-11-01'});
 const archived=l.applyHabitLifecycleCommand(binary,{id:'archive-binary',habitId:binary.id,at:'2026-10-20T12:00:00.000Z',action:'archive',heads:binary.lifecycleHistory.map(row=>row.id)});
 add('archive retains previous scheduled history',{...clone(h.EMPTY_HABIT_WORKSPACE),habits:[archived],habitCompletions:[snapshot(binary,'2026-10-19',true)]});
 const legacy={...clone(binary),id:'legacy',lifecycleHistory:[]};add('legacy availability is explicitly unknown',{...clone(h.EMPTY_HABIT_WORKSPACE),habits:[legacy],habitCompletions:[snapshot(legacy,'2026-10-19',true)]});
 const skipped=snapshot(binary,'2026-10-20',false);skipped.skippedAt='2026-10-20T12:00:00.000Z';
 add('missing and conscious skip stay distinct',{...clone(h.EMPTY_HABIT_WORKSPACE),habits:[binary],habitCompletions:[skipped]});
 return cases;
}
