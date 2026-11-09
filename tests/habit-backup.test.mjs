import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
const h=calendarModule('app/habits.ts'),b=calendarModule('app/habit-backup.ts');
const date='2026-10-17',at='2026-10-17T12:00:00.000Z';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(){
 const habit=h.defaultHabit(date,'profane');habit.title='Water';habit.schedule.timezone='UTC';
 habit.measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};
 const base={...plain(h.EMPTY_HABIT_WORKSPACE),habits:[habit]};
 return h.recordHabitMeasurement(base,habit,date,60125,{id:'value',recordedAt:at},date);
}

test('versioned backup preserves full tracking data without credentials, unrelated modules or Google links',async()=>{
 const workspace=fixture(),habit=workspace.habits[0];
 habit.reminder={...habit.reminder,syncToGoogleTasks:true,showInGoogleCalendar:true,googleTaskId:'external-task',googleEventId:'external-event'};
 workspace.sleepPlans=[{id:'private-sleep-module'}];workspace.tasks=[{id:'private-task'}];workspace.accessToken='never-export';
 const before=JSON.stringify(workspace),backup=await b.createHabitBackup(workspace,at),text=JSON.stringify(backup);
 assert.doesNotMatch(text,/external-task|external-event|private-sleep-module|private-task|never-export/);
 const parsed=await b.parseHabitBackup(text);
 assert.equal(parsed.data.habits[0].id,habit.id);assert.equal(parsed.data.habitMeasurements[0].value,60125);
 assert.equal(parsed.data.habitMeasurements[0].id,'value');assert.equal(parsed.data.habits[0].reminder.syncToGoogleTasks,false);
 assert.equal(JSON.stringify(workspace),before);assert.equal(parsed.checksum,backup.checksum);
});

test('corrupted, unknown-version, duplicate and dangerous documents fail before any source can change',async()=>{
 const workspace=fixture(),before=JSON.stringify(workspace),backup=await b.createHabitBackup(workspace,at);
 const corrupt=plain(backup);corrupt.data.habits[0].title='Changed';
 await assert.rejects(()=>b.parseHabitBackup(JSON.stringify(corrupt)),/INTEGRITY/);
 await assert.rejects(()=>b.parseHabitBackup(JSON.stringify({...backup,version:999})),/VERSION/);
 await assert.rejects(()=>b.parseHabitBackup('{bad json'),/INVALID/);
 const duplicate=plain(backup);duplicate.data.habits.push(duplicate.data.habits[0]);
 await assert.rejects(()=>b.parseHabitBackup(JSON.stringify(duplicate)),/INVALID/);
 await assert.rejects(()=>b.parseHabitBackup(JSON.stringify(backup).replace('"data":{','"data":{"__proto__":{},')),/INVALID/);
 assert.equal(JSON.stringify(workspace),before);
});

test('CSV exports exact fractional values, stable IDs, every revision and explicit history provenance',()=>{
 const workspace=fixture(),habit=workspace.habits[0];
 const corrected=h.recordHabitMeasurement(workspace,habit,date,40125,{id:'edit',entryId:'value',replaces:['value'],source:'correction',recordedAt:at},date);
 const csv=b.buildHabitHistoryCsv(corrected,{label:source=>'label:'+source});
 assert.ok(csv.startsWith('\uFEFF'));assert.match(csv,/record_id \[label:/);
 assert.match(csv,/"60\.125"/);assert.match(csv,/"60125"/);assert.match(csv,/"40\.125"/);assert.match(csv,/"40125"/);
 assert.match(csv,/"value"/);assert.match(csv,/"edit"/);assert.match(csv,/"correction"/);
 assert.equal(csv.split('"measurement"').length-1,2);
});

test('CSV includes all history by default and applies only the explicitly requested date range',()=>{
 const workspace=fixture(),habit=workspace.habits[0];habit.createdDate='2025-01-01';habit.schedule.startDate='2025-01-01';
 workspace.habitCompletions.push({...workspace.habitCompletions[0],id:'old-entry',date:'2025-02-03'});
 assert.match(b.buildHabitHistoryCsv(workspace),/old-entry/);
 assert.doesNotMatch(b.buildHabitHistoryCsv(workspace,{start:date,end:date}),/old-entry/);
 assert.throws(()=>b.buildHabitHistoryCsv(workspace,{start:date,end:'2025-01-01'}),/RANGE_INVALID/);
});

test('spreadsheet formulas, quotes, commas and line breaks in user text remain inert and intact',()=>{
 const workspace=fixture();workspace.habits[0].title='=HYPERLINK("https://example.test")';
 workspace.habitCompletions[0].note='first, "quoted"\nnext line';
 const csv=b.buildHabitHistoryCsv(workspace);
 assert.match(csv,/"'=HYPERLINK\(""https:\/\/example\.test""\)"/);
 assert.match(csv,/"first, ""quoted""\nnext line"/);
 for(const prefix of ['', ' ', '\t', '\u0000', '\r\n']) {
  workspace.habits[0].title=prefix+'+SUM(1,2)';
  assert.ok(b.buildHabitHistoryCsv(workspace).includes(`"'${prefix}+SUM(1,2)"`));
 }
});

test('full-history CSV contains more than a thousand dates without a hidden month or row cutoff',()=>{
 const workspace=fixture(),habit=workspace.habits[0];habit.createdDate='2023-01-01';habit.schedule.startDate='2023-01-01';
 const template=workspace.habitCompletions[0];workspace.habitMeasurements=[];
 workspace.habitCompletions=Array.from({length:1001},(_,index)=>({...template,id:'full-'+index,
  date:new Date(Date.UTC(2023,0,1+index)).toISOString().slice(0,10)}));
 const csv=b.buildHabitHistoryCsv(workspace);
 assert.equal(csv.split('\r\n').filter(Boolean).length,1002);assert.match(csv,/full-0"/);assert.match(csv,/full-1000"/);
});
