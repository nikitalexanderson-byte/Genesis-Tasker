import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {SharedLiveModel} from '../app/e2ee/shared-live.ts';
import {SharedClientExecution} from '../app/e2ee/shared-client-execution.ts';
import {sharedBodyMetadata,sharedBodyParent} from '../app/e2ee/shared-domain.ts';
import {SharedAggregateModel,seedPersonalSharedLayouts,validatePersonalSharedState} from '../app/e2ee/shared-aggregate.ts';
import sourceCatalogue from '../contracts/e2ee/private-path-sources-v1.json' with {type:'json'};

const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
const binding={scopeId:'project:read-scheduling',kind:'project',resourceId:'project'};
const context={ownerId:'owner',spaceId:'space',role:'owner',spaceRole:'owner',members:[],invitations:[],
 permissions:{createProjects:true,editTasks:true,organizeTasks:true,comment:true,manageProjects:true,inviteMembers:true}};
function liveFixture(){
 let open=true,observations=0;const order=[];
 const ports={binding,actorId:'owner',online:true,current(){if(!open)throw Error('E2EE_UNLOCK_REQUIRED');},
  context:async()=>{observations++;order.push('snapshot');return structuredClone(context);},versions:async()=>[],
  stage:async()=>{throw Error('Unexpected write');},flush:async()=>{throw Error('Unexpected upload');},
  loadRequest:async()=>{order.push('write-load');return null;},saveRequest:async()=>{order.push('write-save');return 1;}};
 return{ports,model:new SharedLiveModel(ports),order,close(){open=false;},observations:()=>observations};
}

test('overlapping shared queries use one freshly authorized observation and independent results',async()=>{
 const f=liveFixture();const [first,second]=await Promise.all([f.model.request('GET','tasks'),f.model.request('GET','tasks?sort=title')]);
 assert.equal(f.observations(),1);assert.equal(first.total,0);assert.equal(second.total,0);
 first.tasks.push({id:'local-only-change'});assert.deepEqual(second.tasks,[]);
 await f.model.request('GET','tasks');assert.equal(f.observations(),2,'A later read requires a new observation');
});

test('a widget arriving during unfinished scope IO shares that observation, but a settled read does not',async()=>{
 const f=liveFixture(),entered=deferred(),finish=deferred(),original=f.ports.context;
 f.ports.context=async()=>{entered.resolve();await finish.promise;return original();};
 const first=f.model.request('GET','tasks');await entered.promise;
 const second=f.model.request('GET','tasks?sort=title');finish.resolve();
 const results=await Promise.all([first,second]);assert.equal(f.observations(),1);
 results[0].tasks.push({id:'one-widget-only'});assert.deepEqual(results[1].tasks,[]);
 await f.model.request('GET','tasks');assert.equal(f.observations(),2);
});

test('a mutation queued during scope IO separates a later widget from the unfinished read batch',async()=>{
 const f=liveFixture(),entered=deferred(),finish=deferred(),original=f.ports.context;
 f.ports.context=async()=>{entered.resolve();await finish.promise;return original();};
 const first=f.model.request('GET','tasks');await entered.promise;
 const sibling=f.model.request('GET','tasks?sort=title');
 const refused=assert.rejects(f.model.request('POST','unsupported',{requestId:'mutation-after-scope-io'}),/E2EE_/);
 const next=f.model.request('GET','tasks');finish.resolve();await Promise.all([first,sibling,refused,next]);
 assert.equal(f.observations(),3);assert.deepEqual(f.order,['snapshot','write-load','write-save','snapshot','snapshot']);
});

test('failed scope IO rejects every staggered selector and the next read acquires a new observation',async()=>{
 const f=liveFixture(),entered=deferred(),finish=deferred(),original=f.ports.context;let failedObservations=0;
 f.ports.context=async()=>{failedObservations++;entered.resolve();await finish.promise;throw Error('E2EE_REFRESH_REQUIRED');};
 const first=assert.rejects(f.model.request('GET','tasks'),/E2EE_REFRESH_REQUIRED/);await entered.promise;
 const second=assert.rejects(f.model.request('GET','tasks?sort=title'),/E2EE_REFRESH_REQUIRED/);finish.resolve();await Promise.all([first,second]);
 assert.equal(failedObservations,1);f.ports.context=original;assert.equal((await f.model.request('GET','tasks')).total,0);assert.equal(f.observations(),1);
});

test('a queued mutation separates shared read observations even when that mutation is refused',async()=>{
 const f=liveFixture(),first=f.model.request('GET','tasks');
 const refused=assert.rejects(f.model.request('POST','unsupported',{requestId:'mutation'}),/E2EE_/);
 const next=f.model.request('GET','tasks');await Promise.all([first,refused,next]);
 assert.equal(f.observations(),3);assert.deepEqual(f.order,['snapshot','write-load','write-save','snapshot','snapshot']);
});

test('locking during a shared observation rejects every waiting selector',async()=>{
 const f=liveFixture(),entered=deferred(),finish=deferred();
 f.ports.context=async()=>{entered.resolve();await finish.promise;return structuredClone(context);};
 const first=assert.rejects(f.model.request('GET','tasks'),/E2EE_UNLOCK_REQUIRED/);
 const second=assert.rejects(f.model.request('GET','tasks?sort=title'),/E2EE_UNLOCK_REQUIRED/);
 await entered.promise;f.close();finish.resolve();await Promise.all([first,second]);
});

test('shared task creation without a board uses the verified project inbox status',async()=>{
 const fixture=liveFixture();
 const statusColumns=sourceCatalogue.tables.find(row=>row.table==='shared_project_statuses').columns;
 const status=(id,position,done,chaos)=>{
  const record={...Object.fromEntries(statusColumns.map(column=>[column,null])),id,project_id:'project',
   title:id,position,is_done:done,is_chaos:chaos,revision:1};
  const body={format:'genesis-shared-record-v1',kind:'status',scopeId:binding.scopeId,scopeKind:binding.kind,
   resourceId:binding.resourceId,table:'shared_project_statuses',record,related:{},execution:'live'};
  return{protocol:1,scopeId:binding.scopeId,entityId:'status:'+id,kind:'status',revision:1,
   parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),deleted:false,body};
 };
 const board=status('open-board',0,0,0), inbox=status('chaos-open:project',-2,0,1);
 fixture.ports.versions=async()=>[board,inbox];
 const staged=[];
 fixture.ports.stage=async edits=>{staged.push(...edits);};
 fixture.ports.flush=async()=>{};
 const create=input=>fixture.model.request('POST','tasks',{title:'Synthetic shared task',...input});
 for(const input of [{},{statusId:''},{statusId:'open-board'}]){
  const expected=input.statusId||'chaos-open:project';
  assert.equal((await create(input)).task.statusId,expected);
  assert.equal(staged.at(-1).body.record.status_id,expected);
 }
 await assert.rejects(create({statusId:'other-project-board'}),/E2EE_PRODUCT_WORKFLOW_STATUS/);
 fixture.ports.versions=async()=>[board];
 await assert.rejects(create({statusId:''}),/E2EE_PRODUCT_WORKFLOW_STATUS/);
 assert.equal(staged.length,3);
});

test('enabling a retained creation rule does not process tasks saved while it was disabled',async()=>{
 const definition={schemaVersion:1,trigger:{type:'created'},conditions:[],actions:[{type:'priority',value:2}],
  calendarMode:'profane',calendarContext:{version:2,timeZone:'UTC',gregorianYearStart:'march'}};
 const target={kind:'automation',deleted:false,body:{id:'rule',ownerId:'owner',revision:2,enabled:true,deleted:false,
  definition,createdAt:'2026-11-25T10:00:00Z',updatedAt:'2026-11-25T10:05:00.500Z'}};
 const task=(id,createdAt)=>({kind:'task',deleted:false,body:{id,createdAt,updatedAt:createdAt,revision:1,archivedAt:null}});
 const original=task('retained-task','2026-11-25T10:00:00Z');
 const whileDisabled=task('task-before-enabling','2026-11-25T10:05:00Z');
 const whileEnabled=task('task-after-enabling','2026-11-25T10:05:00.600Z');
 const ready=(rule,tasks)=>new SharedClientExecution({binding,actorId:'owner',context,versions:[rule,...tasks],
  row:version=>version.body}).ready('2026-11-25T10:06:00Z');
 assert.equal((await ready(target,[original,whileDisabled])).automation,false);
 assert.equal((await ready(target,[original,whileDisabled,whileEnabled])).automation,true);
 assert.equal((await ready({...target,body:{...target.body,enabled:false}},[whileEnabled])).automation,false);
});

test('a signed bootstrap task head is not a new creation for a retained active rule',async()=>{
 const definition={schemaVersion:1,trigger:{type:'created'},conditions:[],actions:[{type:'priority',value:2}],
  calendarMode:'profane',calendarContext:{version:2,timeZone:'UTC',gregorianYearStart:'march'}};
 const rule={kind:'automation',deleted:false,body:{id:'rule',ownerId:'owner',revision:1,enabled:true,deleted:false,
  definition,createdAt:'2026-11-25T10:00:00Z',updatedAt:'2026-11-25T10:00:00Z'}};
 const task=id=>({kind:'task',entityId:'task:'+id,deleted:false,body:{id,revision:1,archivedAt:null,
  createdAt:'2026-11-25T10:05:00Z',updatedAt:'2026-11-25T10:05:00Z'}});
 const migrated=task('migrated'),fresh=task('fresh');
 const read=tasks=>new SharedClientExecution({binding,actorId:'owner',context,versions:[rule,...tasks],
  bootstrapTaskIds:new Set([migrated.entityId]),row:version=>version.body}).ready('2026-11-25T10:06:00Z');
 assert.equal((await read([migrated])).automation,false);
 assert.equal((await read([migrated,fresh])).automation,true);
});

test('shared automation history displays migrated runs without making them executable',async()=>{
 const fixture=liveFixture(),at='2026-11-25T10:00:00Z';
 const columns=sourceCatalogue.tables.find(row=>row.table==='shared_automation_rules').columns;
 const record={...Object.fromEntries(columns.map(column=>[column,null])),id:'rule',project_id:'project',owner_id:'owner',
  title:'Retained rule',enabled:0,revision:3,created_at:at,updated_at:at,
  definition_json:JSON.stringify({schemaVersion:1,trigger:{type:'created'},conditions:[],actions:[{type:'priority',value:2}],
   calendarMode:'profane',calendarContext:{version:2,timeZone:'UTC',gregorianYearStart:'march'}})};
 const body={format:'genesis-shared-record-v1',kind:'automation',scopeId:binding.scopeId,scopeKind:binding.kind,
  resourceId:binding.resourceId,table:'shared_automation_rules',record,related:{},execution:'live'};
 fixture.ports.versions=async()=>[{protocol:1,scopeId:binding.scopeId,entityId:'automation:rule',kind:'automation',
  revision:1,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),deleted:false,body}];
 const run={id:'old-run',rule_id:'rule',rule_revision:3,task_id:null,state:'failed',attempts:1,retry_count:0,
  error_code:'AUTOMATION_ACTION_REJECTED',result_json:null,created_at:at,finished_at:at};
 fixture.ports.sourceTable=async table=>{
  assert.equal(table,'shared_automation_runs');
  return [run,{...run,id:'other-run',rule_id:'other-rule'}];
 };
 const history=await fixture.model.request('GET','automations/rule/runs');
 assert.deepEqual(history.runs.map(row=>[row.id,row.state,row.historyOnly]),[['old-run','failed',true]]);
 assert.equal(history.nextCursor,null);
 await assert.rejects(fixture.model.request('POST','automations/rule/runs/old-run/retry',
  {operationId:'retry-old-run',expectedRevision:1}),/E2EE_PRODUCT_ENTITY_MISSING/);
});

const state=()=>({protocol:1,ownerId:'owner',views:[],requests:[],readFlags:{},watching:{}});
function aggregateFixture(){
 let document=state(),seedReads=0,writes=0;const project={id:'project',spaceId:'space',archivedAt:null};
 const view=()=>({document:structuredClone(document),base:structuredClone(document),pending:false,remoteRevision:1,conflict:null});
 const ports={actorId:'owner',current(){},bindings:async()=>[binding,{scopeId:'space:read-scheduling',kind:'space',resourceId:'space'}],
  request:async(_scope,_method,path)=>path===''?{project,members:[]}:{tasks:[],queryVersion:'verified-empty'},
  layoutSeed:async()=>{seedReads++;return[{user_id:'owner',space_id:'space',expanded_json:'["project","retired-project"]',updated_at:'2026-11-23T00:00:00Z'}];},
  personal:{read:async()=>view(),write:async value=>{document=validatePersonalSharedState(structuredClone(value),'owner');writes++;return view();},flush:async()=>view(),resolve:async()=>{throw Error('Unexpected conflict');}}};
 return{ports,model:new SharedAggregateModel(ports),document:()=>structuredClone(document),writes:()=>writes,seedReads:()=>seedReads};
}

test('independent shared queries overlap while an intervening write remains a barrier',{timeout:5000},async()=>{
 const f=aggregateFixture(),both=deferred(),release=deferred();let calls=0,bindings=0;
 const list=f.ports.bindings;f.ports.bindings=async()=>{bindings++;return list();};
 f.ports.request=async()=>{calls++;if(calls===2)both.resolve();await release.promise;return{tasks:[],queryVersion:'verified-empty'};};
 const first=f.model.request('GET','/shared/tasks?filter={}'),second=f.model.request('GET','/shared/tasks?filter={}&sort=title');
 await both.promise;
 const refused=assert.rejects(f.model.request('POST','/shared/unsupported'),/E2EE_SHARED_OPERATION_REVIEW_REQUIRED/);
 const next=f.model.request('GET','/shared/tasks?filter={}');await setImmediate();
 assert.equal(bindings,2,'The write and its later read must wait for existing readers');
 release.resolve();await Promise.all([first,second,refused,next]);assert.equal(calls,3);assert.equal(bindings,4);
});

test('private layout reads preserve the captured source and explicit saves stay in the personal document',async()=>{
 const f=aggregateFixture(),before=f.document();
 assert.deepEqual(await f.model.request('GET','/shared/spaces/space/ui'),{expandedIds:['project']});
 assert.deepEqual(f.document(),before);assert.equal(f.writes(),0,'Reading history must not upload or activate it');
 assert.deepEqual(await f.model.request('PUT','/shared/spaces/space/ui',{expandedIds:['project']}),{expandedIds:['project']});
 assert.deepEqual(f.document().layouts,{space:['project']});assert.equal(f.writes(),1);
 const retained=f.document();await assert.rejects(f.model.request('PUT','/shared/spaces/space/ui',{expandedIds:['another-space-project']}),/INVALID_SHARED_UI_STATE/);
 assert.deepEqual(f.document(),retained);
 assert.deepEqual(await f.model.request('GET','/shared/spaces/space/ui'),{expandedIds:['project']});assert.equal(f.seedReads(),2);
});

test('foreign or malformed layout history refuses without manufacturing an empty replacement',()=>{
 assert.throws(()=>seedPersonalSharedLayouts([{user_id:'other',space_id:'space',expanded_json:'[]',updated_at:'2026-11-23'}],'owner'),/E2EE_SCOPE_BINDING_MISMATCH/);
 assert.throws(()=>seedPersonalSharedLayouts([{user_id:'owner',space_id:'space',expanded_json:'["project","project"]',updated_at:'2026-11-23'}],'owner'),/INVALID_SHARED_UI_STATE/);
 assert.throws(()=>validatePersonalSharedState({...state(),layouts:{space:['project','project']}},'owner'),/INVALID_SHARED_UI_STATE/);
 assert.throws(()=>validatePersonalSharedState(null,'owner'));
});

function workflowPageFixture() {
 const f=liveFixture(),entityId='workflow:project';
 const createdAt='2026-11-25T06:00:00Z';
 const definition=limit=>JSON.stringify({statuses:[{statusId:'open',wipLimit:limit,requiredFields:[]}],transitions:[]});
 const version=(revision,originalRevision,limit)=>{
  const record={project_id:'project',enabled:0,revision:originalRevision,definition_json:definition(limit),updated_at:createdAt,updated_by:'owner'};
  const body={format:'genesis-shared-record-v1',kind:'workflow',scopeId:binding.scopeId,scopeKind:binding.kind,resourceId:binding.resourceId,
   table:'shared_project_workflows',record,related:{},execution:'live'};
  return{protocol:1,scopeId:binding.scopeId,entityId,kind:'workflow',revision,deleted:false,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),body};
 };
 const origin=(row,bootstrap=false)=>({entityId:row.entityId,revision:row.revision,bootstrap});
 const current=version(3,3,9),older=version(2,2,8),bootstrap=version(1,2,5);
 f.ports.versions=async()=>[current];
 f.ports.history=async(id,before)=>{
  assert.equal(id,entityId);
  if(before===2)return{versions:[bootstrap],origins:[origin(bootstrap,true)],nextBefore:1};
  assert.equal(before,Number.MAX_SAFE_INTEGER);
  return{versions:[current,older],origins:[origin(current),origin(older)],nextBefore:2};
 };
 const archived=[{project_id:'project',revision:1,enabled:0,definition_json:definition(2),created_at:createdAt,actor_id:null},
  {project_id:'project',revision:2,enabled:0,definition_json:definition(5),created_at:createdAt,actor_id:'owner'}];
 f.ports.sourceTable=async table=>{assert.equal(table,'shared_project_workflow_versions');return archived;};
 return{...f,archived};
}

test('workflow history preserves both migrated revisions after the live pages and omits the repeated bootstrap',async()=>{
 const f=workflowPageFixture();let sourceReads=0;
 const sourceTable=f.ports.sourceTable;f.ports.sourceTable=table=>{sourceReads++;return sourceTable(table);};
 const live=await f.model.request('GET','workflow/history');
 assert.deepEqual(live.versions.map(row=>row.revision),[3,2]);
 assert.deepEqual(live.archivedVersions,[]);assert.equal(sourceReads,0);assert.equal(live.nextCursor,2);
 const archived=await f.model.request('GET','workflow/history?before='+live.nextCursor);
 assert.deepEqual(archived.versions,[]);assert.equal(archived.nextCursor,null);
 assert.deepEqual(archived.archivedVersions.map(row=>[row.revision,row.statuses[0].wipLimit]),[[2,5],[1,2]]);
 assert.equal(archived.archivedVersions[1].actorId,null);
 assert.equal(sourceReads,1);
});

test('workflow history refuses a foreign project row and conflicting archived revision',async()=>{
 const foreign=workflowPageFixture();foreign.archived[0].project_id='another-project';
 await assert.rejects(foreign.model.request('GET','workflow/history?before=2'),/E2EE_SCOPE_BINDING_MISMATCH/);
 const conflict=workflowPageFixture();conflict.archived[1].definition_json=conflict.archived[0].definition_json;
 await assert.rejects(conflict.model.request('GET','workflow/history?before=2'),/E2EE_PRODUCT_HISTORY_INVALID/);
});

test('map history returns each archived version once and retains later edits with overlapping revision numbers',async()=>{
 const f=liveFixture(),id='map',entityId='mindmap:map',updatedAt='2026-11-25T06:00:00Z';
 const document=label=>({schemaVersion:1,id,title:'Map',pinned:false,archived:false,projectId:'project',
  nodes:[{id:'root',parentId:null,kind:'idea',text:label,note:''}],links:[]});
 const entity=(revision,content)=>{
  const body={format:'genesis-shared-record-v1',kind:'mindmap',scopeId:binding.scopeId,scopeKind:binding.kind,resourceId:binding.resourceId,
   table:'shared_mindmaps',record:{id,space_id:'space',project_id:'project',revision:2,updated_at:updatedAt,content:JSON.stringify(document(content))},
   related:{},execution:'live'};
  return{scopeId:binding.scopeId,entityId,revision,kind:'mindmap',deleted:false,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),body};
 };
 const migrated=entity(1,'Migrated latest'),current=entity(2,'Edited after migration');
 f.ports.versions=async()=>[current];
 f.ports.history=async()=>({versions:[current,migrated],nextBefore:1,
  origins:[{entityId,revision:2,bootstrap:false},{entityId,revision:1,bootstrap:true}]});
 const versions=[{map_id:id,space_id:'space',project_id:'project',revision:1,updated_at:updatedAt,content:JSON.stringify(document('Migrated earlier'))},
  {map_id:id,space_id:'space',project_id:'project',revision:2,updated_at:updatedAt,content:JSON.stringify(document('Migrated latest'))}];
 f.ports.sourceTable=async table=>{assert.equal(table,'shared_mindmap_versions');return versions;};
 const result=await f.model.request('GET','mindmaps/map/history');
 assert.equal(result.nextCursor,null);
 assert.deepEqual(result.versions.map(row=>[row.revision,row.historyOrigin??'current',row.document.nodes[0].text]),[
  [2,'current','Edited after migration'],[2,'migration','Migrated latest'],[1,'migration','Migrated earlier'],
 ]);
 versions[1].content=versions[0].content;
 await assert.rejects(f.model.request('GET','mindmaps/map/history'),/E2EE_PRODUCT_HISTORY_INVALID/);
});

test('private project import history pages only previously visible records within the current project',async()=>{
 const f=liveFixture();
 const row=(number,visibleInHistory=true)=>({project_id:'project',kind:'history',target_id:null,visibleInHistory,
  payload_json:JSON.stringify({actorTitle:'Synthetic importer',number})});
 const rows=[row(0,false),{...row(0),target_id:'missing-task'},...Array.from({length:51},(_,index)=>row(index+1))];
 f.ports.sourceTable=async table=>{assert.equal(table,'shared_data_import_records');return rows;};
 const first=await f.model.request('GET','data-history');
 assert.deepEqual(first.records.map(value=>value.source.number),Array.from({length:50},(_,index)=>index+1));
 const last=await f.model.request('GET','data-history?cursor='+first.nextCursor);
 assert.deepEqual(last.records.map(value=>value.source.number),[51]);
 assert.equal(last.nextCursor,null);
 await assert.rejects(f.model.request('GET','data-history?cursor=1000'),/DATA_CURSOR_INVALID/);
 await assert.rejects(f.model.request('GET','data-history?taskId=missing-task'),/E2EE_PRODUCT_ENTITY_MISSING/);
 rows[2].project_id='another-project';
 await assert.rejects(f.model.request('GET','data-history'),/E2EE_SCOPE_BINDING_MISMATCH/);
 rows[2].project_id='project';delete rows[2].visibleInHistory;
 await assert.rejects(f.model.request('GET','data-history'),/E2EE_SHARED_HISTORY_READER_REQUIRED/);
});

test('private activity pages project events and preserves role changes without cross-project labels',async()=>{
 const f=liveFixture();
 f.ports.context=async()=>({...context,members:[{userId:'owner',displayName:'Test owner'}]});
 f.ports.eventCache={load:async()=>null,save:async()=>{}};
 f.ports.history=async()=>{throw Error('No live entities in this fixture');};
 const rows=Array.from({length:51},(_,index)=>({
  id:'event-'+index,project_id:'project',actor_id:'owner',action:'member.role_changed',object_id:'member',
  created_at:new Date(1795500000000+index*1000).toISOString(),task_id:null,board_id:null,
  details_json:JSON.stringify({changes:{role:{from:'manager',to:'viewer'},projectId:{from:'foreign title',to:'project'}}}),
 }));
 rows.push({...rows[0],id:'observed',action:'task.observed'});
 f.ports.sourceTable=async table=>{assert.equal(table,'shared_audit_events');return rows;};
 const first=await f.model.request('GET','activity');
 assert.equal(first.events.length,50);
 assert.equal(first.events[0].actorName,'Test owner');
 assert.deepEqual(first.events[0].details,{changes:{role:{from:'manager',to:'viewer'}}});
 const last=await f.model.request('GET','activity?before='+first.nextCursor);
 assert.deepEqual(last.events.map(event=>event.id),['event-0']);
 assert.equal(last.nextCursor,null);
 await assert.rejects(f.model.request('GET','activity?before=missing'),/INVALID_ACTIVITY_CURSOR/);
 rows[0].project_id='foreign-project';
 await assert.rejects(f.model.request('GET','activity'),/E2EE_SCOPE_BINDING_MISMATCH/);
});
