import assert from 'node:assert/strict';
import test from 'node:test';
import {setImmediate} from 'node:timers/promises';
import {SharedLiveModel} from '../app/e2ee/shared-live.ts';
import {SharedAggregateModel,seedPersonalSharedLayouts,validatePersonalSharedState} from '../app/e2ee/shared-aggregate.ts';

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
