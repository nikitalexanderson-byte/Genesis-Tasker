import assert from 'node:assert/strict';
import test from 'node:test';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage,cloudSyncClient} from './helpers/cloud-sync-client.mjs';
const {PersonalTasksSource,readMigratedPersonalTasks,validateMigrationTask}=calendarModule('app/e2ee/tasks-source.ts');
const NOW='2026-11-19T09:00:00Z',DAY='2026-11-19',PENDING='genesis-pending-mutations-v2';
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const decode=bytes=>JSON.parse(new TextDecoder().decode(bytes));
const task=(id='private-2026-11-19',fields={})=>({id,title:'Synthetic private task',description:'Private original text',dueDate:DAY,done:false,updatedAt:Date.parse(NOW),...fields});
const sql=(id='private-2026-11-19',fields={})=>({id,project_id:'project-one',category_id:null,sacred_year:2026,month_index:8,sacred_day:1,due_date:DAY,title:'Synthetic SQL task',description:'Exact description',time_value:'09:20',
 project_label:'Original project',tags_json:'[ "private tag" ]',done:0,completed_at:null,reminder_minutes:null,recurrence:'daily',recurrence_interval:1,sync_to_google:1,google_event_id:'old-event',created_at:NOW,updated_at:NOW,...fields});
function fixture(){
 const memory={ownerId:'owner',legacyKey:'',generation:0,reconciliationRequired:false,tasks:[],editors:[]};
 const remote={protocol:1,ownerId:'owner',scopeId:context.scopeId,migrationId:context.migrationId,fence:7,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
  tasks:[],deletions:[],links:[],recovered:[],recoveredDeletions:[],creations:[],creationTargets:[],legacyKey:{keyMode:'empty',key:null},
  providerCaches:[{kind:'primary',accountId:'owner',slot:'current',version:null,presence:'missing',provenance:'none',calendar:null,tasks:null}]};
 const storage=new MemoryStorage();let captured=false,live=true,calls=0;const check=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const ports={storage,memory:()=>memory,assertCurrent:check,legacyTasks:async actual=>{assert.ok(captured);assert.deepEqual(actual,context);calls++;return structuredClone(remote);}};
 const source=new PersonalTasksSource('owner',context.scopeId,ports);
 return{memory,remote,storage,ports,source,lock(){live=false;},get calls(){return calls;},cache(tasks){storage.setItem('genesis-calendar-v2:owner',JSON.stringify({tasks,projects:[]}));},
  pending(rows){storage.setItem(`${PENDING}:owner`,JSON.stringify(rows));},async capture(){const bytes=await source.captureLocal();captured=true;return bytes;},
  async run(previous=[]){return source.reconcile(await this.capture(),previous,context);}};
}
const queue=(value,method='PUT')=>({key:'task:'+value.id,path:'/tasks/'+encodeURIComponent(value.id),method,body:JSON.stringify(value)});
const provider=(accountId='owner',kind='primary',fields={})=>({kind,accountId,slot:'current',version:'b'.repeat(64),presence:'stored',provenance:'current-grant',calendar:null,
 tasks:{items:[task('from-file',{createdIn:'google-tasks',googleTaskId:'native-only',googleTaskListId:'list-only',googleTaskListTitle:'Private list from file'})],
  lists:[{id:'list-only',title:'Private list from file',updatedAt:NOW,isDefault:true}],checkedAt:123,nextAttempt:456,warning:null},...fields});
async function logical(result,owner='owner'){
 const rows=new Map(result.content.map(row=>[row.objectId,row.bytes]));return readMigratedPersonalTasks(owner,async id=>rows.has(id)?new Uint8Array(rows.get(id)):null,()=>{});
}

test('provider-only private task and list survive under the new root with actual legacy account identity decoration',async()=>{
 const f=fixture();f.remote.providerCaches=[provider()];const before=structuredClone(f.remote),result=await f.run(),read=await logical(result);
 const prefix=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('owner'))).toString('hex').slice(0,10);
 assert.equal(read.tasks.length,1);assert.equal(read.tasks[0].id,`account-${prefix}-from-file`);assert.equal(read.tasks[0].googleAccountId,'owner');
 assert.equal(read.tasks[0].googleTaskListTitle,'Private list from file');assert.equal(read.tasks[0].syncToGoogle,false);assert.deepEqual(read.tasks[0].syncAccountIds,[]);
 const history=decode(result.content.find(row=>row.objectId==='personal-task-history-v1').bytes);assert.deepEqual(history.providerCaches,before.providerCaches);assert.deepEqual(f.remote,before);
 assert.ok(result.content.every(row=>!row.objectId.includes('from-file')&&!row.objectId.includes('list-only')));
});

test('same raw provider ID in primary and linked accounts cannot collapse two unrelated private tasks',async()=>{
 const f=fixture();f.remote.providerCaches=[provider(),provider('linked-one','linked')];
 const read=await logical(await f.run());assert.equal(read.tasks.length,2);assert.notEqual(read.tasks[0].id,read.tasks[1].id);
 assert.deepEqual(new Set(read.tasks.map(row=>row.googleAccountId)),new Set(['owner','linked-one']));
});

test('retained or historical grant requires exact new review; retain-only still preserves the complete private history',async()=>{
 for(const changed of [{provenance:'historical-grant'},{slot:'retained:'+'b'.repeat(64)}]){
  const f=fixture(),missing=f.remote.providerCaches[0];f.remote.providerCaches=changed.slot?[missing,provider('owner','primary',changed)]:[provider('owner','primary',changed)];
  const before=structuredClone(f.remote);await assert.rejects(f.run(),/PROVIDER_HISTORY_REVIEW_REQUIRED/);assert.deepEqual(f.remote,before);
  let source='';f.ports.reviewProviderHistory=async rows=>{assert.equal(rows.length,1);source=rows[0].source;assert.equal(rows[0].tasks.items[0].title,'Synthetic private task');return{[source]:'retain-only'};};
  const retained=await f.run();assert.equal((await logical(retained)).tasks.length,0);assert.deepEqual(decode(retained.content.find(row=>row.objectId==='personal-task-history-v1').bytes).providerCaches,before.providerCaches);
  f.ports.reviewProviderHistory=async()=>({[source]:'include'});assert.equal((await logical(await f.run())).tasks.length,1);
  for(const decisions of [{},{foreign:'include'},{[source]:'legacy-receipt'},{[source]:'include',foreign:'retain-only'}]){f.ports.reviewProviderHistory=async()=>decisions;await assert.rejects(f.run(),/PROVIDER_HISTORY_REVIEW_REQUIRED/);}
 }
 const changed=fixture();changed.remote.providerCaches=[provider('owner','primary',{provenance:'historical-grant'})];changed.ports.reviewProviderHistory=async rows=>{changed.lock();return{[rows[0].source]:'include'};};
 await assert.rejects(changed.run(),/ACCOUNT_CHANGED/);
});

test('provider inventory cannot silently omit its primary or a retained linked current slot, import credentials or project future content',async()=>{
 for(const modify of [f=>f.remote.providerCaches=[],f=>delete f.remote.providerCaches,
  f=>f.remote.providerCaches=[provider('foreign')],f=>f.remote.providerCaches.push(provider('linked','linked',{slot:'retained:'+'b'.repeat(64)})),
  f=>f.remote.providerCaches=[provider(),provider()],f=>f.remote.providerCaches=[provider('owner','primary',{version:'bad'})],
  f=>f.remote.providerCaches=[provider('owner','primary',{slot:'retained:'+'a'.repeat(64)})],
  f=>{const row=provider();row.tasks.syncToken='credential-must-not-migrate';f.remote.providerCaches=[row];},
  f=>{const row=provider();row.tasks.items[0].unknownPrivateField='Do not discard';f.remote.providerCaches=[row];},
  f=>{const row=provider();row.tasks.items.push(structuredClone(row.tasks.items[0]));f.remote.providerCaches=[row];},
  f=>{const row=provider();row.tasks.lists[0].futureField='Do not discard';f.remote.providerCaches=[row];}]){
  const f=fixture();modify(f);const before=structuredClone(f.remote);await assert.rejects(f.run(),/E2EE_/);assert.deepEqual(f.remote,before);
 }
});

test('a provider cache cannot resurrect a GENESIS tombstone and an unsent edit requires conflict review',async()=>{
 const f=fixture();f.remote.providerCaches=[provider('owner','primary',{tasks:{items:[task('removed',{createdIn:'genesis'})]}})];
 f.remote.deletions=[{task_id:'removed',deleted_at:NOW}];assert.deepEqual((await logical(await f.run())).deletedIds,['removed']);
 f.pending([queue(task('removed',{title:'New unsent change'}))]);await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);
 f.ports.review=async()=>({removed:'queued'});assert.equal((await logical(await f.run())).tasks[0].title,'New unsent change');
});

test('task capture keeps exact owner cache, outbox, tombstones and all mounted editor bytes without IO or attribution',async()=>{
 const f=fixture();f.cache([task()]);f.pending([queue(task())]);f.storage.setItem(`${PENDING}-deleted:owner`,'[ "removed" ]');f.memory.editors=[{id:'editor-new',base:null,current:task('editor-new')}];
 f.storage.setItem('genesis-calendar-v2:foreign','FOREIGN PRIVATE CANARY');const before=[...f.storage.data],capture=await f.capture();
 assert.equal(f.calls,0);assert.ok(!new TextDecoder().decode(capture).includes('FOREIGN PRIVATE CANARY'));assert.deepEqual([...f.storage.data],before);
 const original=decode(capture);assert.equal(original.entries.find(row=>row.key===`${PENDING}-deleted:owner`).value,'[ "removed" ]');assert.deepEqual(original.memory.editors,f.memory.editors);
 const result=await f.source.reconcile(capture,[],context),read=await logical(result);assert.equal(result.complete,true);assert.deepEqual(read.tasks.map(row=>row.id).sort(),['editor-new','private-2026-11-19']);assert.deepEqual(read.deletedIds,['removed']);
 assert.ok(result.content.every(row=>row.domain==='workspace'&&!row.objectId.includes(DAY)&&!row.objectId.includes('removed')));assert.deepEqual([...f.storage.data],before);
 const index=decode(result.content.find(row=>row.objectId==='personal-task-index-v1').bytes);assert.ok(index.tasks.every(row=>/^personal-task-record:[a-f0-9-]{36}$/.test(row.objectId)));
 for(const row of result.content){const raw=new TextDecoder().decode(row.bytes);assert.ok(!raw.includes('"path":')&&!raw.includes('"method":')&&!raw.includes('"legacyKey":'));}
});

test('relational tasks, exact dependency/creation journals and attempted provider history survive as inert encrypted content',async()=>{
 const f=fixture();f.remote.tasks=[sql()];f.remote.links=[{task_id:'private-2026-11-19',depends_on_task_id:'missing-historical-parent',created_at:NOW}];
 const state=' { "unknownProviderOutcome" : true, "taskId" : "private-2026-11-19" } ';
 f.remote.creations=[{task_id:'private-2026-11-19',state}];f.remote.creationTargets=[{task_id:'private-2026-11-19',target_key:'old-target',recovery_token:'old-marker',attempted:1,provider_id:null,provider_key:'opaque-old-operation'}];
 const before=structuredClone(f.remote),result=await f.run(),read=await logical(result);assert.equal(read.tasks[0].projectId,'project-one');assert.deepEqual(read.tasks[0].dependsOnIds,['missing-historical-parent']);
 assert.equal(read.tasks[0].recurrence,'daily');assert.equal(read.tasks[0].syncToGoogle,false);assert.deepEqual(read.tasks[0].syncAccountIds,[]);assert.equal(read.tasks[0].googleEventId,'old-event');
 const history=decode(result.content.find(row=>row.objectId==='personal-task-history-v1').bytes);assert.equal(history.tasks[0].tags_json,'[ "private tag" ]');assert.equal(history.creations[0].state,state);assert.equal(history.creationTargets[0].attempted,1);assert.deepEqual(f.remote,before);
});

test('queued local edit replaces its older display cache, preserves detached identity and never executes an old creation',async()=>{
 const f=fixture(),base=task('detached',{title:'Old title',recurrenceSeriesId:'series',recurrenceOriginalDate:DAY,recurrenceExcludedDates:['2026-11-20'],recurrenceMode:'lunar',recurrencePattern:'lunar-days',recurrenceDays:[3,8],
  recurrenceMonths:[1],recurrencePyatas:[2],recurrenceContext:{version:2,timeZone:'Europe/Moscow',gregorianYearStart:'march'},reminders:[{kind:'absolute',at:'2026-11-20T09:00:00+03:00'}]});
 const changed={...base,title:'Unsent edit',mindmapCreateOnly:true,mindmapCreationPayload:{...base,title:'Uncertain original creation'}};
 f.cache([base]);f.memory.tasks=[base];f.pending([queue(changed)]);const result=await f.run(),read=await logical(result),value=read.tasks[0];
 assert.equal(value.title,'Unsent edit');assert.equal(value.recurrenceOriginalDate,DAY);assert.deepEqual(value.reminders,base.reminders);assert.deepEqual(value.recurrenceContext,base.recurrenceContext);assert.equal(value.mindmapCreateOnly,false);
 const record=decode(result.content.find(row=>row.objectId.startsWith('personal-task-record:')).bytes);assert.equal(record.variants.find(row=>row.source==='cache').value.title,'Old title');assert.equal(record.variants.find(row=>row.source==='queued').value.mindmapCreateOnly,true);
});

test('server or local tombstone suppresses a clean cache without resurrecting it',async()=>{
 for(const kind of ['server','local','recovered']){
  const f=fixture();f.cache([task('removed')]);if(kind==='server')f.remote.deletions=[{task_id:'removed',deleted_at:NOW}];
  if(kind==='local')f.storage.setItem(`${PENDING}-deleted:owner`,'["removed"]');if(kind==='recovered')f.remote.recoveredDeletions=[{id:'removed',revision:4,updated_at:NOW}];
  const result=await f.run(),read=await logical(result);assert.equal(read.tasks.length,0);assert.deepEqual(read.deletedIds,['removed']);assert.equal(decode(result.content.find(row=>row.objectId.startsWith('personal-task-record:')).bytes).variants.find(row=>row.source==='cache').value.title,task().title);
 }
});

test('unsent edit versus deletion blocks until exact review, preserving all alternatives',async()=>{
 const f=fixture();f.cache([task('conflict')]);f.pending([queue(task('conflict',{title:'Unsent change'}))]);f.remote.deletions=[{task_id:'conflict',deleted_at:NOW}];const before=[...f.storage.data];
 await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);assert.deepEqual([...f.storage.data],before);
 f.ports.review=async conflicts=>{assert.equal(conflicts[0].id,'conflict');return{conflict:'server-deletion'};};const result=await f.run();assert.deepEqual((await logical(result)).deletedIds,['conflict']);
 const record=decode(result.content.find(row=>row.objectId.startsWith('personal-task-record:')).bytes);assert.equal(record.variants.find(row=>row.source==='queued').value.title,'Unsent change');
 for(const choices of [{},{conflict:'anything'},{conflict:'queued',foreign:'queued'}]){f.ports.review=async()=>choices;await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);}
});

test('independent mounted field edits use a real base while divergent edits and deleted identity require review',async()=>{
 const f=fixture(),base=task('edited',{description:'Base description'});f.cache([{...base,description:'Remote description'}]);f.memory.editors=[{id:'edited',base,current:{...base,title:'Mounted new title'}}];
 const value=(await logical(await f.run())).tasks[0];assert.equal(value.title,'Mounted new title');assert.equal(value.description,'Remote description');
 f.memory.editors[0].current.description='Divergent local description';await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);
 const deleted=fixture();deleted.remote.deletions=[{task_id:'collision',deleted_at:NOW}];deleted.memory.editors=[{id:'collision',base:null,current:task('collision')}];await assert.rejects(deleted.run(),/CONFLICT_REVIEW_REQUIRED/);
 const absent=fixture();absent.memory.editors=[{id:'lost-base',base:task('lost-base'),current:task('lost-base',{title:'Changed'})}];await assert.rejects(absent.run(),/LOCAL_BASE_REVIEW_REQUIRED/);
});

test('remote and queued independent versions are never chosen only by an untrusted timestamp',async()=>{
 const f=fixture();f.remote.tasks=[sql('same',{title:'Remote change'})];f.pending([queue(task('same',{title:'Local change',updatedAt:Number.MAX_SAFE_INTEGER-2}))]);
 await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);f.ports.review=async()=>({same:'queued'});assert.equal((await logical(await f.run())).tasks[0].title,'Local change');
});

test('unknown provenance, corrupt owned queues and stale generations fail before source IO without empty fallback',async()=>{
 for(const mutate of [f=>f.storage.setItem(PENDING,'[]'),f=>f.storage.setItem('genesis-calendar-v1','{}'),f=>f.storage.setItem('genesis-calendar-v2:owner','{damaged'),
  f=>f.storage.setItem(`${PENDING}:owner`,'{"not":"an array"}'),f=>f.pending([{...queue(task()),path:'/tasks/foreign'}]),f=>f.cache([task('duplicate'),task('duplicate')]),
  f=>f.memory.reconciliationRequired=true,f=>f.storage.setItem('genesis-data-generation-v1:owner','1')]){
  const f=fixture();mutate(f);const before=[...f.storage.data];await assert.rejects(f.run(),/E2EE_/);assert.equal(f.calls,0);assert.deepEqual([...f.storage.data],before);
 }
 const changed=fixture();changed.cache([task()]);const old=await changed.capture();changed.cache([]);await assert.rejects(changed.run([old]),/HISTORY_REVIEW_REQUIRED/);assert.equal(changed.calls,0);
});

test('no 2000-item writer limit truncates the captured task queue',async()=>{
 const f=fixture(),rows=Array.from({length:2001},(_,i)=>queue(task('draft-'+i)));f.pending(rows);const capture=await f.capture();assert.equal(JSON.parse(decode(capture).entries.find(row=>row.key===`${PENDING}:owner`).value).length,2001);
 const result=await f.source.reconcile(capture,[],context),read=await logical(result);assert.equal(read.tasks.length,2001);assert.equal(f.storage.getItem(`${PENDING}:owner`),JSON.stringify(rows));
});

test('owner, lease, generation, session switch and malformed server rows cannot cross the new-root boundary',async()=>{
 for(const field of ['ownerId','scopeId','migrationId','sourceHash','fence']){const f=fixture();f.remote[field]=field==='fence'?8:'foreign';await assert.rejects(f.run(),/SCOPE_BINDING_MISMATCH/);}
 const epoch=fixture();epoch.remote.legacyGeneration=1;await assert.rejects(epoch.run(),/GENERATION_REVIEW_REQUIRED/);
 const late=fixture();late.ports.legacyTasks=async()=>{late.lock();return late.remote;};await assert.rejects(late.run(),/ACCOUNT_CHANGED/);
 for(const mutate of [f=>f.remote.tasks=[sql('bad',{done:2})],f=>f.remote.tasks=[sql('bad',{tags_json:'[9]'})],f=>f.remote.links=[{task_id:'bad',depends_on_task_id:'other',created_at:'bad'}],
  f=>f.remote.tasks=[sql('bad'),sql('bad')],f=>f.remote.deletions=[{task_id:'bad',deleted_at:NOW},{task_id:'bad',deleted_at:NOW}],f=>f.remote.creations=[{task_id:'old',state:42}]]){
  const f=fixture();mutate(f);await assert.rejects(f.run(),/E2EE_/);
 }
});

test('actual target fingerprints and opaque older creation states are retained as inert history without fabricating a task',async()=>{
 const f=fixture(),fingerprint=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode('synthetic-account:tasks:synthetic-list'))).toString('hex');
 const states=[fingerprint,'old-opaque-state-bytes',' { "originalUnknownState" : true } '];f.remote.creations=states.map((state,i)=>({task_id:'creation-'+i,state}));
 const result=await f.run(),read=await logical(result);assert.equal(read.tasks.length,0);const history=decode(result.content.find(row=>row.objectId==='personal-task-history-v1').bytes);
 assert.deepEqual(history.creations.map(row=>row.state),states);assert.deepEqual(f.remote.creations,history.creations);
});

test('actual AES-GCM recovered task uses captured historical keys and exact owner-purpose AAD',async()=>{
 const f=fixture(),raw=crypto.getRandomValues(new Uint8Array(32)),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);f.memory.legacyKey=Buffer.from(raw).toString('base64');raw.fill(0);
 const id='restored-'+ 'a'.repeat(32),plain=task(id,{restoredFrom:{sourceId:'old-source',accountId:null,taskListId:null,taskId:'old-task',backupId:'old-backup'}}),iv=crypto.getRandomValues(new Uint8Array(12));
 const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode(`genesis-mindmap-v1:owner:recovered-task:v1:${id}`)},key,new TextEncoder().encode(JSON.stringify(plain))));
 f.remote.recovered=[{id,revision:4,iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64'),updated_at:NOW}];f.remote.legacyKey={keyMode:'client',key:null};
 const result=await f.run();assert.equal((await logical(result)).tasks[0].restoredRevision,4);assert.ok(result.content.every(row=>!new TextDecoder().decode(row.bytes).includes(f.memory.legacyKey)));
 const valid=f.memory.legacyKey;f.memory.legacyKey='';await assert.rejects(f.run(),/LEGACY_KEY_UNAVAILABLE/);f.memory.legacyKey=Buffer.alloc(32,9).toString('base64');await assert.rejects(f.run(),/LEGACY_TASK_CORRUPT/);f.memory.legacyKey=valid;
 f.remote.recovered[0].id='restored-'+'b'.repeat(32);await assert.rejects(f.run(),/LEGACY_TASK_CORRUPT/);
});

test('task validation preserves actual web/native reminder and calendar fields and rejects lossy future formats',()=>{
 const value=task('retained',{recurrenceContext:{version:2,timeZone:'UTC',gregorianYearStart:'january'},reminders:[{kind:'absolute',at:'2026-11-19T09:00:00+03:00'}],zoneId:'UTC',reminderAt:12345});
 assert.deepEqual(validateMigrationTask(value),value);for(const changed of [{futurePrivateField:'retain'}, {reminders:[{kind:'future',payload:'preserve'}]},{recurrenceContext:{version:3,timeZone:'UTC',gregorianYearStart:'january'}},{dueDate:'2026-02-30'}])assert.throws(()=>validateMigrationTask({...value,...changed}),/E2EE_/);
});

test('native legacy-opening port accepts only a keyless capture and parses exact recovered plaintext without duplicate-key projection',async()=>{
 const id='restored-'+'a'.repeat(32),value=task(id,{restoredFrom:{sourceId:'source',accountId:null,taskListId:null,taskId:'old-task',backupId:'backup'}});
 const f=fixture();f.remote.legacyKey={keyMode:'account',key:null};f.remote.recovered=[{id,revision:1,iv:Buffer.alloc(12).toString('base64'),ciphertext:Buffer.alloc(32).toString('base64'),updated_at:NOW}];let opens=0;
 f.ports.openLegacy=async(envelope,purpose)=>{assert.equal(purpose,'recovered-task:v1:'+id);assert.equal(envelope.iv,f.remote.recovered[0].iv);opens++;return JSON.stringify(value);};
 const result=await f.run();assert.equal(opens,1);assert.equal((await logical(result)).tasks[0].id,id);
 f.memory.legacyKey=Buffer.alloc(32,1).toString('base64');await assert.rejects(f.run(),/KEY_BRIDGE_FORBIDDEN/);assert.equal(opens,1);f.memory.legacyKey='';
 f.ports.openLegacy=async()=>JSON.stringify(value).replace('"title":','"title":"First original title","title":');await assert.rejects(f.run(),/SOURCE_INVALID/);
 f.ports.openLegacy=async()=>({...value,id:'restored-'+'b'.repeat(32)});await assert.rejects(f.run(),/SOURCE_INVALID/);
});

test('lossless source parsing rejects decoded duplicate keys at every depth but accepts JSON punctuation inside strings',async()=>{
 for(const raw of ['{"tasks":[],"tasks":[]}','{"tasks":[{"id":"a","title":"First","ti\\u0074le":"Second"}]}',
  '{"tasks":[{"id":"a","title":"Title","googleLinks":{"one":{"taskId":"one","taskId":"two"}}}]}']){
  const f=fixture();f.storage.setItem('genesis-calendar-v2:owner',raw);const before=[...f.storage.data];await assert.rejects(f.run(),/SOURCE_INVALID/);assert.equal(f.calls,0);assert.deepEqual([...f.storage.data],before);
 }
 const valid=fixture(),value=task('json-text',{description:'Preserve this literal: { "repeated":"one", "repeated":"two" }, [and] \\"quoted\\" text',reminderAt:-12345});valid.cache([value]);
 const read=await logical(await valid.run());assert.equal(read.tasks[0].description,value.description);assert.equal(read.tasks[0].reminderAt,-12345);
});

test('new-root task reader rejects missing/swapped/foreign objects and locked operations',async()=>{
 const result=await fixture().run();await assert.rejects(logical(result,'foreign'),/SCOPE_BINDING_MISMATCH/);
 const f=fixture();f.cache([task()]);const migrated=await f.run(),rows=new Map(migrated.content.map(row=>[row.objectId,row.bytes]));
 const index=decode(rows.get('personal-task-index-v1')),id=index.tasks[0].objectId;rows.delete(id);await assert.rejects(readMigratedPersonalTasks('owner',async name=>rows.get(name)?new Uint8Array(rows.get(name)):null,()=>{}),/OBJECT_MISSING/);
 await assert.rejects(readMigratedPersonalTasks('owner',async()=>null,()=>{throw new Error('E2EE_UNLOCK_REQUIRED');}),/UNLOCK_REQUIRED/);
});

test('authenticated source factory captures actual owner cache/key and mounted tasks without calling ordinary bootstrap or queue readers',async()=>{
 const tab=await cloudSyncClient(),calls=tab.requests.length,before=[...tab.storage.data],current={tasks:[task('mounted')],editors:[]};
 const source=await tab.client.createPersonalTasksMigrationSource(tab.userId,'personal:'+tab.userId,{legacyTasks(){throw new Error('Premature private IO');}},()=>current);
 const snapshot=decode(await source.captureLocal());assert.equal(snapshot.memory.ownerId,tab.userId);assert.deepEqual(snapshot.memory.tasks,current.tasks);assert.equal(tab.requests.length,calls);assert.deepEqual([...tab.storage.data],before);
 await assert.rejects(tab.client.createPersonalTasksMigrationSource('foreign','personal:foreign',{legacyTasks(){}},()=>current),/SCOPE_BINDING_MISMATCH/);
});
