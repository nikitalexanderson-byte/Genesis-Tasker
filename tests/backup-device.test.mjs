import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudSyncClient} from './helpers/cloud-sync-client.mjs';
test('rescue captures device and domain queue before any entitlement request, ignoring a later empty server',async()=>{
 const f=await cloudSyncClient({userId:'backup-owner',withBackups:true});
 const source={tasks:[{id:'local',title:'Only good copy'}],habits:[]};
 f.backups.sources.registerBackupSource('workspace',{owner:f.userId,capture:()=>source});
 const raw=JSON.stringify([{key:'task:local',path:'/tasks/local',method:'PUT',body:JSON.stringify({id:'local',title:'Only good copy',access_token:'MUST_NOT_EXPORT'}),headers:{Authorization:'MUST_NOT_EXPORT'}}]);
 f.storage.setItem('genesis-pending-mutations-v2:'+f.userId,raw);
 const before=f.requests.length,frozen=f.backups.device.freezeBackupDevice(f.userId,f.storage);
 assert.equal(f.requests.length,before);assert.equal(f.storage.getItem('genesis-pending-mutations-v2:'+f.userId),raw);
 source.tasks.length=0;f.respond(()=>new Response(JSON.stringify({ownerId:f.userId,generation:0}),{headers:{'Content-Type':'application/json'}}));
 await f.backups.device.authorizeBackup();
 const result=await f.backups.device.materializeDeviceBackup(frozen);
 assert.equal(result.sections[0].data.document.tasks[0].title,'Only good copy');
 assert.equal(result.sections[0].data.sync.pending[0].operationId,'task:local');
 assert.equal(JSON.stringify(result).includes('MUST_NOT_EXPORT'),false);
 assert.equal(f.requests.slice(before).some(row=>/bootstrap|sync|workspace/.test(row.url)),false);
});
test('entitlement outage issues no user file and preserves original device data plus encrypted safety state',async()=>{
 const f=await cloudSyncClient({userId:'backup-outage',withBackups:true});
 f.storage.setItem('genesis-calendar-v2:'+f.userId,JSON.stringify({tasks:[{id:'only',title:'Unsynced'}]}));
 const frozen=f.backups.device.freezeBackupDevice(f.userId,f.storage);
 await f.backups.device.retainBackupSafety(frozen,f.storage);
 f.respond(()=>new Response(JSON.stringify({error:'TEMPORARILY_UNAVAILABLE'}),{status:503,headers:{'Content-Type':'application/json'}}));
 await assert.rejects(f.backups.device.authorizeBackup());
 assert.match(f.storage.getItem('genesis-calendar-v2:'+f.userId),/Unsynced/);
 const snapshots=[...f.storage.data].filter(([key])=>key.startsWith('genesis-backup-safety-v1:'));
 assert.equal(snapshots.length,1);assert.equal(snapshots[0][1].includes('Unsynced'),false);
});
test('snapshot quota failure retains a memory snapshot without erasing the last durable copy',async()=>{
 const f=await cloudSyncClient({userId:'backup-quota',withBackups:true});
 f.backups.sources.registerBackupSource('workspace',{owner:f.userId,capture:()=>({tasks:[]})});
 const frozen=f.backups.device.freezeBackupDevice(f.userId,f.storage);
 const limited={get length(){return f.storage.length},key:index=>f.storage.key(index),getItem:key=>f.storage.getItem(key),setItem(){throw new Error('QUOTA')},removeItem(){throw new Error('MUST_NOT_DELETE')}};
 assert.equal((await f.backups.device.retainBackupSafety(frozen,limited)).persistent,false);
});
test('a server generation conflict retains an old task operation for reconciliation',async()=>{
 const f=await cloudSyncClient({userId:'backup-old-device',withBackups:true});
 f.respond(()=>new Response(JSON.stringify({error:'BACKUP_RECONCILIATION_REQUIRED'}),{status:409,headers:{'Content-Type':'application/json'}}));
 const task=f.client.normalizeTask({id:'old-task',title:'Keep this unsynced edit'});
 await assert.rejects(f.client.saveCloudTask(f.userId,task));
 const pending=f.storage.getItem('genesis-pending-mutations-v2:'+f.userId);
 assert.match(pending,/Keep this unsynced edit/);
});

test('recovered dependencies and series stay inside GENESIS, including an absent series root and re-export',async()=>{
 const f=await cloudSyncClient({userId:'backup-relations',withBackups:true});
 const task=values=>f.client.normalizeTask({createdIn:'google',googleAccountId:'source-account',googleTaskListId:'source-list',...values});
 const source=[task({id:'root',title:'Series',googleTaskId:'remote-root',dependsOnIds:[]}),task({id:'child',title:'Occurrence',recurrenceSeriesId:'root',dependsOnIds:['root','absent'],googleTaskId:'remote-child'}),task({id:'orphan',title:'Missing root',recurrenceSeriesId:'missing-series',dependsOnIds:[]})];
 const first=await f.backups.tasks.recoverBackupTasks(source,f.userId,'backup-one');
 const [root,child,orphan]=first.tasks;
 assert.equal(child.recurrenceSeriesId,root.id);assert.equal(child.dependsOnIds[0],root.id);
 assert.match(child.dependsOnIds[1],/^restored-ref-/);assert.match(orphan.recurrenceSeriesId,/^restored-ref-/);
 assert.equal(await first.reference('root'),root.id);
 for(const row of first.tasks){assert.equal(row.syncToGoogle,false);assert.equal(row.googleAccountId,null);assert.equal(row.googleTaskId,null);assert.deepEqual([...row.syncAccountIds],[]);}
 const second=await f.backups.tasks.recoverBackupTasks(first.tasks,f.userId,'backup-two');
 assert.deepEqual(second.tasks.map(row=>[row.id,row.recurrenceSeriesId,[...row.dependsOnIds]]),first.tasks.map(row=>[row.id,row.recurrenceSeriesId,[...row.dependsOnIds]]));
 const deduplicated=await f.backups.tasks.recoverBackupTasks([source[0],root],f.userId,'dedupe');assert.equal(deduplicated.tasks.length,1);
 await assert.rejects(f.backups.tasks.recoverBackupTasks([source[0],{...root,title:'Conflicting edit'}],f.userId,'conflict'),/BACKUP_DRAFT_CHOICE_REQUIRED/);
 await assert.rejects(f.backups.tasks.recoverBackupTasks([source[0],source[0]],f.userId,'duplicate'),/BACKUP_TASK_INVALID/);
 assert.equal(f.requests.length,0);
});

test('a fresh device accepts the restored generation while an existing device holds its older state',async()=>{
 for(const existing of [false,'workspace','aurora','stoicheion']){
  const f=await cloudSyncClient({userId:`backup-generation-${existing}`,withBackups:true,initializeWorkspace:false});
  const stateKey=existing==='workspace'?`genesis-calendar-v2:${f.userId}`:`genesis-${existing}-workspace-v1:${f.userId}:pending`;
  if(existing)f.storage.setItem(stateKey,JSON.stringify({tasks:[{id:'old',title:'Keep me'}]}));
  const unrelated=`genesis-pending-mutations-v2:${f.userId}-other`;
  f.storage.setItem(unrelated,'[]');
  f.respond(url=>url.endsWith('/bootstrap')?Response.json({user:{uid:f.userId,authProvider:'google',dataGeneration:4},csrf:'synthetic',tasks:[],deletedTaskIds:[],taskLists:[],workspace:{key:f.key,keyMode:'account',envelope:null}}):url.endsWith('/recovered-tasks')?Response.json({tasks:[]}):Promise.reject(new Error('Unexpected fixture request')));
  await f.client.loadGenesisWorkspace();
  assert.equal(f.client.backupNeedsReconciliation(),Boolean(existing));
  assert.equal(f.storage.getItem(`genesis-data-generation-v1:${f.userId}`),existing?null:'4');
  if(existing){
   assert.match(f.storage.getItem(stateKey),/Keep me/);
   const heldKey=[...f.storage.data.keys()].find(key=>key.startsWith(`genesis-backup-held-v1:${f.userId}:`));assert.ok(heldKey);
   const held=JSON.parse(f.storage.getItem(heldKey));
   const rows=await f.client.personalDocumentAccess(f.userId).open(held.envelope,'backup-held-state:v1');
   assert.equal(rows.some(([key])=>key===unrelated),false);
   await f.client.holdBackupStaleChanges(f.userId);assert.equal(f.storage.getItem(stateKey),null);assert.equal(f.storage.getItem(unrelated),'[]');
  }
 }
});

test('replace preview reports removals outside projects and habits before sealing a mutation',async()=>{
 const f=await cloudSyncClient({userId:'backup-preview-removals',withBackups:true});
 f.respond(()=>Response.json({workspace:{envelope:null}}));
 const empty=(await f.client.backupRestoreCurrent(f.userId)).document;
 const current={...empty,categories:[{id:'current-category',title:'Current category'}],moodEntries:[{id:'current-mood',date:'2026-11-05',recordedAt:'2026-11-05T12:00:00Z',moodValue:4,note:'',tags:[]}],dailyGoalRecords:[{date:'2026-11-05',timezone:'Europe/Moscow',mode:'easy',status:'open'}],hiddenDefaultTemplates:['old-template']};
 const envelope=await f.client.sealBackupWorkspace(f.userId,current,0);
 f.respond(url=>{assert.ok(url.endsWith('/workspace'));return Response.json({workspace:{envelope}});});
 const payload={ownerId:f.userId,backupId:'fixture-preview',createdAt:'2026-11-05T12:00:00Z',sections:[{id:'workspace',completeness:'partial',data:{document:{...empty,tasks:[]}}}]};
 const before=f.requests.length,plan=await f.backups.restore.prepareBackupRestore(payload,f.userId,['workspace'],'replace');
 assert.equal(plan.removed,4);
 assert.deepEqual(JSON.parse(JSON.stringify(plan.workspaceRemovals)),[{collection:'categories',count:1},{collection:'moodEntries',count:1},{collection:'dailyGoalRecords',count:1},{collection:'hiddenDefaultTemplates',count:1}]);
 assert.equal(plan.operations.length,1);
 const result=await f.client.openBackupWorkspace(f.userId,plan.operations[0].input);assert.equal(result.moodEntries.length,0);assert.equal(result.categories.length,0);
 assert.equal(f.requests.slice(before).every(row=>!row.init?.method||row.init.method==='GET'),true);
});
