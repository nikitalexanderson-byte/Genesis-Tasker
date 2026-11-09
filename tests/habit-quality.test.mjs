import assert from "node:assert/strict";
import test from "node:test";
import {readFileSync,existsSync} from "node:fs";
import {createRequire} from "node:module";
import {dirname,resolve,extname} from "node:path";
import {fileURLToPath} from "node:url";
import vm from "node:vm";
const root=resolve(dirname(fileURLToPath(import.meta.url)),"..");
const require=createRequire(resolve(root,"package.json"));const ts=require("typescript");const cache=new Map();
function load(path){
  if(path.endsWith("?raw"))return readFileSync(path.slice(0,-4),"utf8");
  if(!extname(path))path += ".ts";
  if(path.endsWith(".json"))return JSON.parse(readFileSync(path,"utf8"));
  if(cache.has(path))return cache.get(path).exports;
  const loaded={exports:{}};cache.set(path,loaded);
  const source=ts.transpileModule(readFileSync(path,"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInNewContext(source,{module:loaded,exports:loaded.exports,process:{env:{}},crypto:globalThis.crypto,Date,Math,Map,Set,Intl,URL,TextEncoder,TextDecoder,
    require:id=>id.startsWith(".")&&existsSync(resolve(dirname(path),id.split("?")[0])+(extname(id.split("?")[0]) ? "" : ".ts")) ? load(resolve(dirname(path),id)) : require(id)}, {filename:path});
  return loaded.exports;
}
const habits=load(resolve(root,"app/habits.ts"));
const intervals=load(resolve(root,"app/habit-interval.ts"));
const reminderTimes=load(resolve(root,"app/habit-reminder-time.ts"));
const sacred=load(resolve(root,"app/sacred-practices.ts"));

test("every sacred practice defaults to one completion in a two-day window and keeps its calendar anchor",()=>{
  const start="2026-10-15";
  for(const mode of ["profane","sacred","lunar"]) for(const practice of sacred.SACRED_PRACTICES){
    const habit=habits.createHabitFromSacredPractice(practice,start,mode);
    assert.equal(habit.practiceGoal.requiredCompletions,1);
    assert.equal(habit.sacredSectorId,practice.sectorId);
    assert.equal(habit.schedule.startDate,start);
    for(const display of ["profane","sacred","lunar"]){
      assert.equal(habits.isHabitScheduledForDate(habit,start,display),true);
      assert.equal(habits.isHabitScheduledForDate(habit,"2026-10-16",display),true);
      assert.equal(habits.isHabitScheduledForDate(habit,"2026-10-14",display),false);
    }
  }
});

test("normalization preserves an existing recurring sacred practice and its completion history",()=>{
  const habit=habits.createHabitFromSacredPractice(sacred.SACRED_PRACTICES[0],"2026-10-15","profane");
  habit.schedule.recurrence.enabled=true;
  const workspace=habits.normalizeHabitWorkspace({habits:[habit],habitCompletions:[{id:"saved-completion",habitId:habit.id,date:"2026-10-15",completed:true,xpAwarded:10}]},"profane");
  assert.equal(workspace.habits[0].schedule.recurrence.enabled,true);
  assert.equal(workspace.habits[0].id,habit.id);
  assert.equal(workspace.habitCompletions[0].id,"saved-completion");
  assert.equal(workspace.habitCompletions[0].xpAwarded,10);
});

test("intraday intervals respect both window limits, do not overshoot, and reject invalid input",()=>{
  const config={intervalMinutes:30,startTime:"09:00",endTime:"18:00",completionMode:"each"};
  assert.equal(intervals.habitIntervalTimes(config).length,19);
  assert.equal(intervals.habitIntervalTimes(config).at(-1),"18:00");
  assert.deepEqual([...intervals.habitIntervalTimes({...config,startTime:"09:10",endTime:"10:00"})],["09:10","09:40"]);
  assert.equal(intervals.normalizeHabitInterval({...config,intervalMinutes:0}),null);
  assert.equal(intervals.normalizeHabitInterval({...config,endTime:"08:00"}),null);
  assert.equal(intervals.normalizeHabitInterval({...config,startTime:"24:00"}),null);
  assert.equal(intervals.habitIntervalTimes({...config,intervalMinutes:1,startTime:"00:00",endTime:"23:59"}).length,1440);
});

test("separate interval marks survive reload, complete one daily habit, and award XP only once",()=>{
  const today="2026-10-12";
  let workspace=habits.normalizeHabitWorkspace({habits:[{id:"interval",title:"Squats",createdDate:today,scoringMode:"binary",
    intervalSchedule:{intervalMinutes:30,startTime:"09:00",endTime:"10:00",completionMode:"each"}}]},"profane");
  const habit=workspace.habits[0];
  assert.equal(habits.updateHabitIntervalCompletion(workspace,habit,today,"12:00",true,today),workspace);
  assert.equal(habits.updateHabitIntervalCompletion(workspace,habit,"2026-10-11","09:00",true,today),workspace);
  workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,"09:00",true,today);
  assert.equal(workspace.habitCompletions[0].completed,false);assert.equal(workspace.habitCompletions[0].xpAwarded,0);
  workspace=habits.normalizeHabitWorkspace(JSON.parse(JSON.stringify(workspace)),"profane");
  assert.deepEqual([...workspace.habitCompletions[0].completedTimes],["09:00"]);
  workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,"09:30",true,today);
  workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,"10:00",true,today);
  assert.equal(workspace.habitCompletions[0].completed,true);assert.equal(workspace.habitCompletions[0].xpAwarded,10);
  workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,"09:30",false,today);
  assert.equal(workspace.habitCompletions[0].completed,false);
  workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,"09:30",true,today);
  assert.equal(workspace.habitCompletions.length,1);assert.equal(workspace.habitCompletions[0].xpAwarded,10);
});

test("a daily mark and interval reminders can be configured independently",()=>{
  const today="2026-10-12";
  let workspace=habits.normalizeHabitWorkspace({habits:[{id:"day",title:"Movement",createdDate:today,scoringMode:"binary",
    intervalSchedule:{intervalMinutes:30,startTime:"09:00",endTime:"10:00",completionMode:"day"},
    reminder:{enabled:true,timing:"habit",time:"08:00"}}]},"profane");
  const habit=workspace.habits[0];
  assert.deepEqual([...reminderTimes.habitReminderTimes(habit)],["09:00","09:30","10:00"]);
  assert.deepEqual([...reminderTimes.habitReminderTimes({...habit,reminder:{...habit.reminder,timing:"custom",time:"11:00"}})],["11:00"]);
  assert.equal(habits.updateHabitIntervalCompletion(workspace,habit,today,"09:00",true,today),workspace);
  workspace=habits.updateHabitCompletion(workspace,habit,today,{completed:true},today);
  assert.equal(workspace.habitCompletions[0].completed,true);
  assert.equal(habits.normalizeHabitWorkspace(JSON.parse(JSON.stringify(workspace)),"profane").habits[0].intervalSchedule.completionMode,"day");
});

test("quality-rated intervals await a confirmed daily rating before awarding XP",()=>{
  const today="2026-10-12";
  let workspace=habits.normalizeHabitWorkspace({habits:[{id:"quality-interval",title:"Focus",createdDate:today,scoringMode:"quality-ten",
    intervalSchedule:{intervalMinutes:30,startTime:"09:00",endTime:"09:30",completionMode:"each"}}]},"profane");
  const habit=workspace.habits[0];
  for(const time of ["09:00","09:30"])workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,time,true,today);
  assert.equal(workspace.habitCompletions[0].completed,false);assert.equal(workspace.habitCompletions[0].xpAwarded,0);
  workspace=habits.updateHabitCompletion(workspace,habit,today,{completed:true,qualityValue:8,qualityConfirmedAt:"2026-10-12T09:30:00Z"},today);
  workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,"09:00",false,today);
  workspace=habits.updateHabitIntervalCompletion(workspace,habit,today,"09:00",true,today);
  assert.equal(workspace.habitCompletions[0].xpAwarded,8);
});
test("Confirmed quality survives reload and cannot be changed or award repeated XP",()=>{
  const today="2026-10-10";
  let workspace=habits.normalizeHabitWorkspace({habits:[{id:"habit",title:"Test",createdDate:today,kind:"positive",qualityScale:"ten",scoringMode:"quality-ten"}]},"profane");
  const habit=workspace.habits[0];
  workspace=habits.updateHabitCompletion(workspace,habit,today,{completed:true,qualityValue:8,qualityConfirmedAt:"2026-10-10T09:00:00Z"},today);
  const original=workspace.habitCompletions[0];assert.equal(original.score,8);
  workspace=habits.normalizeHabitWorkspace(JSON.parse(JSON.stringify(workspace)),"profane");
  workspace=habits.updateHabitCompletion(workspace,habit,today,{qualityValue:10,qualityConfirmedAt:null},today);
  assert.equal(workspace.habitCompletions[0].qualityValue,8);
  assert.equal(workspace.habitCompletions[0].qualityConfirmedAt,original.qualityConfirmedAt);
  workspace=habits.updateHabitCompletion(workspace,habit,today,{completed:false},today);
  assert.equal(workspace.habitCompletions[0].score,0);
  workspace=habits.updateHabitCompletion(workspace,habit,today,{completed:true,qualityValue:1},today);
  assert.equal(workspace.habitCompletions[0].score,8);
  assert.equal(workspace.habitCompletions[0].xpAwarded,original.xpAwarded);
  assert.strictEqual(habits.updateHabitCompletion(workspace,habit,"2026-10-09",{completed:true},today),workspace);
});
