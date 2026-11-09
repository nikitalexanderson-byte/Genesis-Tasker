import fs from 'node:fs';
import {calendarModule} from './calendar-modules.mjs';
const habits=calendarModule('app/habits.ts'),model=calendarModule('app/habit-history-workspace.ts'),history=calendarModule('app/habit-history.ts'),measure=calendarModule('app/habit-measurement.ts');
const date='2026-10-16',at='2026-10-17T12:00:00.000Z',clone=value=>JSON.parse(JSON.stringify(value));
const configs=[{id:'binary',values:[true,false,true]},{id:'credited-quality',credited:true,quality:true,values:[false,true]},
 {id:'quantity',measured:true,amounts:[2000,500,null,2000]},
 {id:'interval',interval:true,values:[false,true]},
 {id:'quality',quality:true,values:[true,true]}];
const cases=configs.map(config=>{
 const habit=habits.defaultHabit('2026-10-01','profane');Object.assign(habit,{id:'habit-history-'+config.id,title:'PRIVATE synthetic history',createdAt:'2026-10-01T00:00:00.000Z',updatedAt:'2026-10-01T00:00:00.000Z'});
 habit.schedule.timezone='UTC';if(habit.schedule.recurrence.calendarContext)habit.schedule.recurrence.calendarContext.timeZone='UTC';
 if(config.measured)habit.measurement={kind:'quantity',unit:'pages',target:2000,quickAdd:1000};
 if(config.quality){habit.qualityScale='ten';habit.scoringMode='quality-ten';}
 if(config.interval)habit.intervalSchedule={intervalMinutes:30,startTime:'09:00',endTime:'09:30',completionMode:'each'};
 const workspace={...clone(habits.EMPTY_HABIT_WORKSPACE),habits:[habit]};
 if(config.credited)workspace.habitCompletions=[{id:'credited-original',habitId:habit.id,date,completed:true,qualityValue:10,qualityConfirmedAt:'2026-10-16T10:00:00.000Z',score:10,xpAwarded:10,note:'original',completedTimes:[],version:1,syncState:'local',createdAt:'2026-10-16T10:00:00.000Z',updatedAt:'2026-10-16T10:00:00.000Z'}];
 let current=clone(workspace);const commands=[];
 const count=config.amounts?.length??config.values.length;
 for(let index=0;index<count;index++){
  const id=config.id+'-'+index,command={id,at,habitId:habit.id,date,ruleId:measure.habitRuleForDate(habit,date).id,heads:index?[config.id+'-'+(index-1)]:[],value:{completed:config.values?.[index]??true,completedTimes:config.interval?(index?['09:00','09:30']:['09:00']):[],qualityValue:config.quality?(index?3:8):null,qualityConfirmedAt:config.quality?at:null,note:'history '+index}};
  if(config.amounts)command.measurement={value:config.amounts[index],note:'measurement '+index,...(index?{entryId:config.id+'-0:value',replaces:[config.id+'-'+(index-1)+':value']}:{})};
  current=model.applyHabitHistoryCommand(current,command,'profane',new Date(at));commands.push(command);
 }
 const completion=current.habitCompletions.find(row=>row.habitId===habit.id&&row.date===date),economy=history.habitEconomyHistory(current);
 return{id:config.id,now:at,workspace,commands,expected:{completion,historyIds:current.habitHistory.map(row=>row.id),measurementCount:current.habitMeasurements.length,
  economyCompletionCount:economy.habitCompletions.length,economyMeasurementCount:economy.habitMeasurements.length}};
});
fs.writeFileSync(new URL('../fixtures/habit-history-vectors.json',import.meta.url),JSON.stringify(cases,null,2)+'\n');
console.log('Created '+cases.length+' shared history vectors.');
