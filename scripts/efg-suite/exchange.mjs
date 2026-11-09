// Real web domain modules + current encrypted HTTP API; only the loopback synthetic account.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {webcrypto} from 'node:crypto';
import {calendarModule} from '../../tests/helpers/calendar-modules.mjs';

if (process.env.GENESIS_IMPROVEMENTS_TEST !== 'isolated') throw Error('Explicit isolated environment required');
const runtime = new URL('../../output/efg-suite/https/', import.meta.url);
const h = calendarModule('app/habits.ts'), lifecycle = calendarModule('app/habit-lifecycle.ts');
const backup = calendarModule('app/habit-backup.ts'), restore = calendarModule('app/habit-backup-restore.ts');
const analysis = calendarModule('app/habit-insight-analysis.ts');
const calendar = calendarModule('app/calendar-context.ts');
let cookie = '', csrf = '';
async function request(path, body) {
  const response = await fetch('http://127.0.0.1:4338' + path, {redirect:'manual', headers:{Cookie:cookie,
    ...(body ? {'Content-Type':'application/json','X-CSRF-Token':csrf} : {})}, ...(body ? {method:'PUT',body:JSON.stringify(body)} : {})});
  if (path.startsWith('/__fixture/sign-in')) { assert.equal(response.status,302); cookie=response.headers.get('set-cookie').split(';')[0]; return; }
  assert.equal(response.status,200,`Synthetic request ${path}: ${response.status}`); return response.json();
}
await request('/__fixture/sign-in?actor=editor'); csrf=(await request('/api/session')).csrf;
async function read() {
  const {workspace}=await request('/api/workspace');
  assert.equal(workspace.keyMode,'account');
  const key=await webcrypto.subtle.importKey('raw',Buffer.from(workspace.key,'base64'),'AES-GCM',false,['encrypt','decrypt']);
  const document=workspace.envelope ? JSON.parse(Buffer.from(await webcrypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(workspace.envelope.iv,'base64')},key,Buffer.from(workspace.envelope.ciphertext,'base64'))).toString('utf8')) : null;
  return {key,document,version:workspace.envelope?.version||0};
}
async function write(document) {
  const {key,version}=await read(),iv=webcrypto.getRandomValues(new Uint8Array(12));
  const ciphertext=await webcrypto.subtle.encrypt({name:'AES-GCM',iv},key,Buffer.from(JSON.stringify(document)));
  const result=await request('/api/workspace',{ciphertext:Buffer.from(ciphertext).toString('base64'),iv:Buffer.from(iv).toString('base64'),expectedVersion:version,writerProtocol:7,minimumWriterProtocol:7});
  assert.equal(result.workspace.version,version+1);
}
const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Moscow'}).format(new Date());
const start=calendar.addCivilDays(today,-21), at=new Date().toISOString();
const context={version:2,timeZone:'Europe/Moscow',gregorianYearStart:'march'};
const file=(name,value)=>fs.writeFileSync(new URL(name,runtime),typeof value==='string'?value:JSON.stringify(value,null,2));
const get=name=>JSON.parse(fs.readFileSync(new URL(name,runtime),'utf8'));
if (process.argv[2]==='seed') {
  assert.equal((await read()).document,null,'Fresh isolated workspace required');
  let workspace=structuredClone(h.EMPTY_HABIT_WORKSPACE);
  workspace.habitSettings.feedback={...workspace.habitSettings.feedback,questsEnabled:false,achievementPopups:false,animations:false};
  workspace.habits=['binary','quantity','duration','period'].map(kind=>{
    let habit={...h.defaultHabit(start,'profane'),id:'efg-'+kind,title:'EFG '+kind,active:false,createdAt:start+'T00:00:00.000Z',updatedAt:at};
    habit.schedule.timezone=context.timeZone;
    if(kind==='quantity'||kind==='period')habit.measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};
    if(kind==='duration')habit.measurement={kind:'duration',unit:'min',target:60000,quickAdd:1000};
    if(kind==='period')habit.periodGoal={version:1,period:'week',metric:'sum',target:300000,calendar:'lunar',context};
    habit=lifecycle.applyHabitLifecycleCommand(habit,{id:'birth-'+kind,habitId:habit.id,at:start+'T00:00:00.000Z',action:'resume',heads:[]});
    return habit;
  });
  for(const habit of workspace.habits) {
    if(habit.measurement) {
      workspace=h.recordHabitMeasurement(workspace,habit,today,habit.id==='efg-duration'?30000:125000,{id:'web-'+habit.id,recordedAt:at},today);
      const past=calendar.addCivilDays(today,-8);
      workspace=h.recordHabitMeasurement(workspace,habit,past,25000,{id:'past-'+habit.id,recordedAt:past+'T12:00:00.000Z'},past);
    } else workspace=h.updateHabitCompletion(workspace,habit,today,{completed:true},today);
  }
  workspace=h.normalizeHabitWorkspace(workspace,'profane');
  const text=JSON.stringify(await backup.createHabitBackup(workspace,at));
  file('web-state.json',{today,start,at,context,backup:text,xp:workspace.userProgress.lifetimeXp,balance:workspace.userProgress.laurelsBalance});
  await write({...workspace,projects:[],categories:[],taskListLinks:[],taskLists:[],sleepPlans:[],sleepEntries:[],moodEntries:[]});
  file('seed-receipt.json',{habits:4,measurements:workspace.habitMeasurements.length,version:(await read()).version,xp:workspace.userProgress.lifetimeXp});
  console.log('Seeded four habit types through the actual encrypted workspace API.');
} else if(process.argv[2]==='verify') {
  const state=get('web-state.json'),native=get('../native-backup.json'),metrics=get('../native-metrics.json');
  const parsed=await backup.parseHabitBackup(JSON.stringify(native));
  const workspace=h.normalizeHabitWorkspace((await read()).document,'profane');
  assert.equal(lifecycle.habitLifecycleState(workspace.habits.find(x=>x.id==='efg-quantity')).status,'archived');
  assert.equal(lifecycle.habitLifecycleState(workspace.habits.find(x=>x.id==='efg-duration')).status,'paused');
  assert.equal(workspace.habitMeasurements.filter(x=>x.id==='native-volume').length,1);
  assert.equal(workspace.habitMeasurements.filter(x=>x.id==='native-duration').length,1);
  assert.equal(workspace.userProgress.lifetimeXp,metrics.xp); assert.equal(workspace.userProgress.laurelsBalance,metrics.balance);
  assert.equal(workspace.habits.length,5); assert.equal(new Set(workspace.habitCompletions.map(x=>x.id)).size,workspace.habitCompletions.length);
  const clean=structuredClone(h.EMPTY_HABIT_WORKSPACE),text=JSON.stringify(native);
  const recovered=await restore.applyHabitRestore(clean,{preview:await restore.previewHabitRestore(clean,text),choices:{}},new Date().toISOString());
  assert.equal(recovered.habits.length,workspace.habits.length);
  assert.deepEqual(recovered.rewardTransactions,parsed.data.rewardTransactions);
  const repeated=await restore.applyHabitRestore(recovered,{preview:await restore.previewHabitRestore(recovered,text),choices:{}});
  assert.equal(repeated,recovered);
  const csv=backup.buildHabitHistoryCsv(workspace); assert.ok(csv.includes('past-efg-duration')); assert.ok(csv.includes('native-volume'));
  const nativeCsv=fs.readFileSync(new URL('../native-history.csv',runtime),'utf8');
  assert.ok(nativeCsv.includes('past-efg-duration')); assert.ok(nativeCsv.includes('native-volume'));
  for(const mode of ['profane','sacred','lunar']) {
    const result=analysis.buildHabitGoalComparison(workspace,state.today,mode,context,new Date(metrics.now));
    const actual=metrics.comparisons[mode];
    for(const key of ['elapsed','open','absoluteChange','changePercent']) assert.equal(actual[key],result[key],mode+':'+key);
    for(const period of ['current','previous']) for(const key of ['completed','planned','unknown','conflicts']) assert.equal(actual[period][key],result[period][key],mode+':'+period+':'+key);
  }
  file('exchange-receipt.json',{webToNative:true,nativeToWeb:true,cleanRecovery:true,replayNoop:true,fullCsvBothClients:true,comparisonParity:['profane','sacred','lunar'],xp:metrics.xp,version:(await read()).version});
  console.log('Verified actual encrypted round-trip, complete backups/CSV, no repeated rewards, all-calendar report parity.');
} else if(process.argv[2]==='race') {
  const raw=(await read()).document;
  let workspace={projects:[],categories:[],taskListLinks:[],taskLists:[],sleepPlans:[],sleepEntries:[],moodEntries:[],...raw,...h.normalizeHabitWorkspace(raw,'profane')};
  assert.ok(!workspace.habitCompletions.some(x=>x.habitId.startsWith('efg-race-')),'Fresh race required');
  for(const kind of ['binary','quantity']) {
    if(workspace.habits.some(x=>x.id==='efg-race-'+kind))continue;
    let habit={...h.defaultHabit(today,'profane'),id:'efg-race-'+kind,title:'EFG concurrent '+kind,active:false,createdAt:at,updatedAt:at};
    habit.schedule.timezone=context.timeZone;
    if(kind==='quantity')habit.measurement={kind:'quantity',unit:'ml',target:100000,quickAdd:25000};
    habit=lifecycle.applyHabitLifecycleCommand(habit,{id:'birth-race-'+kind,habitId:habit.id,at,action:'resume',heads:[]});
    workspace.habits.push(habit);
  }
  await write(workspace);
  const baseXp=workspace.userProgress.lifetimeXp;
  workspace=h.updateHabitCompletion(workspace,workspace.habits.find(x=>x.id==='efg-race-binary'),today,{completed:true},today);
  workspace=h.recordHabitMeasurement(workspace,workspace.habits.find(x=>x.id==='efg-race-quantity'),today,100000,{id:'web-race-volume',recordedAt:at},today);
  workspace.habits=workspace.habits.map(habit=>habit.id==='efg-binary'?lifecycle.applyHabitLifecycleCommand(habit,
    {id:'web-race-archive',habitId:habit.id,at,action:'archive',heads:lifecycle.habitLifecycleState(habit).heads.map(row=>row.id)}):habit);
  file('web-state.json',{...get('web-state.json'),webRace:workspace,baseXp});
  console.log('Prepared a concurrent website branch; Android will retain an independent offline branch before the CAS merge.');
} else if(process.argv[2]==='verify-race') {
  const workspace=h.normalizeHabitWorkspace((await read()).document,'profane'),state=get('web-state.json');
  assert.equal(workspace.userProgress.lifetimeXp,state.baseXp+20);
  for(const id of ['efg-race-binary','efg-race-quantity'])assert.equal(workspace.habitCompletions.filter(x=>x.habitId===id).length,1);
  assert.equal(workspace.habitMeasurements.filter(x=>x.habitId==='efg-race-quantity').length,2);
  const availability=lifecycle.habitLifecycleState(workspace.habits.find(x=>x.id==='efg-binary'));
  assert.equal(availability.conflict,false);assert.equal(availability.status,'archived');
  assert.equal(workspace.rewardTransactions.length,new Set(workspace.rewardTransactions.map(x=>x.idempotencyKey)).size);
  file('race-receipt.json',{twoActualClients:true,binaryXpOnce:true,doubleQuantityXpOnce:true,lifecycleConflictExplicitlyResolved:true,xp:workspace.userProgress.lifetimeXp});
  console.log('Verified two-client merge: daily XP once, both quantity records, explicit pause/archive resolution and unique reward events.');
} else throw Error('Use seed, verify, race or verify-race');
