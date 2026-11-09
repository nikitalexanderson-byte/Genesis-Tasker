import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';
import {mergeWorkspaceDocuments,prepareWorkspaceForSync} from '../app/workspace-sync-state.ts';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';

const project = {id:'sync-project',parentId:null,categoryId:null,title:'Original title',description:'Original description',tags:[],status:'active',position:0};
const metrics = {projectCount:1,taskCount:0,openTaskCount:0,completedTaskCount:0,googleSyncedCount:0,habitCount:0};
const json = (body,status=200) => new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});

test('timer preferences require writer nine only after explicit configuration and survive encrypted reload',async()=>{
  const {first,remote}=await twoClients();
  const habits=calendarModule('app/habits.ts');
  const habit=habits.defaultHabit('2026-11-01','profane');habit.title='Timer preferences QA';
  const workspace={...habits.EMPTY_HABIT_WORKSPACE,habits:[habit]};
  await first.client.saveWorkspaceStructure([project],[],[],metrics,workspace);
  const lastWrite=()=>JSON.parse(first.requests.filter(row=>row.init.method==='PUT'&&new URL(row.url).pathname==='/api/workspace').at(-1).init.body);
  assert.ok(lastWrite().minimumWriterProtocol<9);
  const preferences={modes:['pomodoro'],workMinutes:40,breakMinutes:8,progress:'time-only'};
  habit.timerPreferences=preferences;
  await first.client.saveWorkspaceStructure([project],[],[],metrics,workspace);
  assert.equal(lastWrite().writerProtocol,9);assert.equal(lastWrite().minimumWriterProtocol,9);
  const reloaded=await cloudSyncClient({userId:first.userId,key:first.key});reloaded.respond(remote.respond);
  assert.deepEqual(JSON.parse(JSON.stringify((await reloaded.client.loadGenesisWorkspace()).habits[0].timerPreferences)),preferences);
});

test('the deferred conflict dictionary supplies the same complete controls for all fourteen languages',()=>{
  const copy=JSON.parse(readFileSync(new URL('../app/workspace-conflict-translations.json',import.meta.url),'utf8'));
  assert.equal(Object.keys(copy).length,14);
  const fields=Object.keys(copy.ru).sort();
  for(const [language,values]of Object.entries(copy)){
    assert.deepEqual(Object.keys(values).sort(),fields,language);
    assert.ok(Object.values(values).every(value=>typeof value==='string'&&value.trim()),language);
    if(language!=='en')assert.notEqual(values.title,copy.en.title,language);
  }
});

// The server owns one opaque CAS envelope. It never sees decrypted project fields.
function server(key,userId) {
  let envelope=null,version=0;
  return {get version(){return version;},respond:async(url,init)=>{
    const path=new URL(url).pathname;
    if(path==='/api/bootstrap')return json({user:{uid:userId,authProvider:'google'},csrf:'synthetic',tasks:[],deletedTaskIds:[],taskLists:[],workspace:{key,keyMode:'account',envelope}});
    if(path==='/api/workspace'&&init.method!=='PUT')return json({workspace:{envelope}});
    if(path==='/api/workspace'&&init.method==='PUT'){
      const body=JSON.parse(init.body);
      if(body.expectedVersion!==version)return json({error:'WORKSPACE_VERSION_CONFLICT',currentVersion:version},409);
      version++;envelope={ciphertext:body.ciphertext,iv:body.iv,version,minimumWriterProtocol:body.minimumWriterProtocol,updatedAt:new Date().toISOString()};
      return json({workspace:{version,updatedAt:envelope.updatedAt}});
    }
    throw Error('Unexpected synthetic API path: '+path);
  }};
}

async function twoClients() {
  const first=await cloudSyncClient({userId:'workspace-sync-qa'}),remote=server(first.key,first.userId);
  first.respond(remote.respond);await first.client.loadGenesisWorkspace();
  await first.client.saveWorkspaceStructure([project],[],[],metrics);
  const second=await cloudSyncClient({userId:first.userId,key:first.key});second.respond(remote.respond);
  await second.client.loadGenesisWorkspace();
  return {first,second,remote};
}

test('concurrent edits to different fields of one project both survive the CAS retry',async()=>{
  const {first,second}=await twoClients();
  await first.client.saveWorkspaceStructure([{...project,title:'Title changed on first client'}],[],[],metrics);
  await second.client.saveWorkspaceStructure([{...project,description:'Description changed on second client'}],[],[],metrics);
  const actual=(await first.client.loadGenesisWorkspace()).projects.find(value=>value.id===project.id);
  assert.equal(actual.title,'Title changed on first client');
  assert.equal(actual.description,'Description changed on second client');
});

const pending = tab => [...tab.storage.data.entries()].filter(([key])=>key.includes(':workspace:')).map(([,value])=>JSON.parse(value));
const save = (tab,change={})=>tab.client.saveWorkspaceStructure([{...project,...change}],[],[],metrics);
const title = async tab => (await tab.client.loadGenesisWorkspace()).projects[0]?.title;
function reviews(tab){const ready=deferred();tab.client.registerWorkspaceConflictReviewHandler(request=>ready.resolve(request));return ready.promise;}

test('same-field conflict preserves both copies until a reviewed choice; unrelated local fields survive choosing the site',async()=>{
  const {first,second,remote}=await twoClients();
  await save(first,{title:'Site title'});
  const ready=reviews(second),saving=save(second,{title:'Device title',description:'Independent local description'});
  const review=await ready;
  assert.equal(remote.version,2);assert.equal(pending(second).length,1);
  assert.equal(review.conflicts.length,1);assert.equal(review.conflicts[0].local,'Device title');assert.equal(review.conflicts[0].remote,'Site title');
  await review.confirm(Object.fromEntries(review.conflicts.map(row=>[row.key,'remote'])));await saving;
  const actual=(await first.client.loadGenesisWorkspace()).projects[0];
  assert.equal(actual.title,'Site title');assert.equal(actual.description,'Independent local description');assert.equal(pending(second).length,0);
});

test('offline draft keeps its encrypted original across a bootstrap/reload and merges independent edits',async()=>{
  const {first,second,remote}=await twoClients();
  second.respond(async()=>{throw new TypeError('offline');});
  await assert.rejects(save(second,{description:'Offline description'}),/offline/);
  assert.ok(pending(second)[0].workspaceBase?.ciphertext);
  assert.ok(!JSON.stringify(pending(second)).includes('Offline description'));
  await save(first,{title:'New remote title'});
  const reloaded=await cloudSyncClient({storage:second.storage,key:second.key,userId:second.userId});reloaded.respond(remote.respond);
  const loaded=await reloaded.client.loadGenesisWorkspace();assert.equal(loaded.projects[0].description,'Offline description');
  await reloaded.client.retryPendingWorkspaceSync();
  const actual=(await first.client.loadGenesisWorkspace()).projects[0];
  assert.equal(actual.title,'New remote title');assert.equal(actual.description,'Offline description');assert.equal(pending(reloaded).length,0);
});

test('cancelling a conflict retains the draft; a fresh instance can review it again',async()=>{
  const {first,second,remote}=await twoClients();await save(first,{title:'Site title'});
  const ready=reviews(second),saving=save(second,{title:'Device title'});const rejected=assert.rejects(saving,/WORKSPACE_CONFLICT_PENDING/);
  (await ready).cancel();await rejected;assert.equal(pending(second).length,1);
  const reloaded=await cloudSyncClient({storage:second.storage,key:second.key,userId:second.userId});reloaded.respond(remote.respond);await reloaded.client.loadGenesisWorkspace();
  const again=reviews(reloaded),retry=reloaded.client.retryPendingWorkspaceSync(),review=await again;
  await review.confirm(Object.fromEntries(review.conflicts.map(row=>[row.key,'local'])));await retry;
  assert.equal(await title(first),'Device title');
});

test('an altered remote envelope invalidates the review until refreshed',async()=>{
  const {first,second,remote}=await twoClients();await save(first,{title:'First site title'});
  const ready=reviews(second),saving=save(second,{title:'Device title'}),review=await ready;
  await save(first,{title:'Latest site title'});
  const writes=remote.version;
  await assert.rejects(review.confirm(Object.fromEntries(review.conflicts.map(row=>[row.key,'local']))),/WORKSPACE_REVIEW_STALE/);
  assert.equal(remote.version,writes);
  const refreshed=await review.refresh();assert.equal(refreshed.conflicts[0].remote,'Latest site title');
  await refreshed.confirm(Object.fromEntries(refreshed.conflicts.map(row=>[row.key,'remote'])));await saving;
  assert.equal(await title(first),'Latest site title');
});

test('a committed envelope with a lost HTTP reply is acknowledged without a second write',async()=>{
  const {first,second,remote}=await twoClients();let lose=true;
  second.respond(async(url,init)=>{const response=await remote.respond(url,init);if(init.method==='PUT'&&lose&&response.ok){lose=false;throw new TypeError('lost reply');}return response;});
  await assert.rejects(save(second,{title:'Committed title'}),/lost reply/);const version=remote.version;
  await second.client.retryPendingWorkspaceSync();assert.equal(remote.version,version);assert.equal(pending(second).length,0);assert.equal(await title(first),'Committed title');
});

test('a malformed successful receipt never discards the durable draft',async()=>{
  const {second,remote}=await twoClients();let bad=true;
  second.respond(async(url,init)=>{const response=await remote.respond(url,init);if(init.method==='PUT'&&bad&&response.ok){bad=false;return json({workspace:{version:0,updatedAt:''}});}return response;});
  await assert.rejects(save(second,{title:'Needs confirmation'}),/WORKSPACE_SAVE_UNCONFIRMED/);assert.equal(pending(second).length,1);
  const version=remote.version;await second.client.retryPendingWorkspaceSync();assert.equal(remote.version,version);assert.equal(pending(second).length,0);
});

test('storage quota prevents any mutation HTTP request and keeps the previous queue',async()=>{
  const {second}=await twoClients(),before=second.requests.length;
  const set=second.storage.setItem.bind(second.storage);second.storage.setItem=(key,value)=>{if(key.includes(':workspace:'))throw new DOMException('quota','QuotaExceededError');set(key,value);};
  await assert.rejects(save(second,{title:'Cannot persist'}),/quota/);assert.equal(second.requests.length,before);
});

test('two offline tabs sharing localStorage keep independent journals and merge after reconnect',async()=>{
  const {first,remote}=await twoClients();
  const sibling=await cloudSyncClient({storage:first.storage,userId:first.userId,key:first.key});sibling.respond(remote.respond);await sibling.client.loadGenesisWorkspace();
  first.respond(async()=>{throw new TypeError('offline');});sibling.respond(async()=>{throw new TypeError('offline');});
  await assert.rejects(save(first,{title:'First offline tab'}),/offline/);
  await assert.rejects(save(sibling,{description:'Second offline tab'}),/offline/);
  assert.equal(pending(first).length,2);
  sibling.respond(remote.respond);await sibling.client.retryPendingWorkspaceSync();
  first.respond(remote.respond);const actual=(await first.client.loadGenesisWorkspace()).projects[0];
  assert.equal(actual.title,'First offline tab');assert.equal(actual.description,'Second offline tab');assert.equal(pending(first).length,0);
});

test('editing a restored draft before reconnect preserves the original remote change',async()=>{
  const {first,second,remote}=await twoClients();second.respond(async()=>{throw new TypeError('offline');});await assert.rejects(save(second,{description:'First offline edit'}));
  await save(first,{title:'New site title'});
  const reloaded=await cloudSyncClient({storage:second.storage,userId:second.userId,key:second.key});reloaded.respond(remote.respond);await reloaded.client.loadGenesisWorkspace();
  reloaded.respond(async()=>{throw new TypeError('offline');});await assert.rejects(save(reloaded,{description:'Second offline edit'}));
  reloaded.respond(remote.respond);await reloaded.client.retryPendingWorkspaceSync();
  const actual=(await first.client.loadGenesisWorkspace()).projects[0];assert.equal(actual.title,'New site title');assert.equal(actual.description,'Second offline edit');
});

test('partial writers preserve absent fields and collections while explicit zero and false merge',()=>{
  const clock={version:2,updatedAt:'2026-10-23T00:00:00Z',deviceId:'test'};
  const base={projects:[{id:'p',title:'Old',position:2,archived:true,future:'keep'}],categories:[{id:'c',title:'Retain'}],futureSettings:{value:42}};
  const prepared=prepareWorkspaceForSync({current:{projects:base.projects},base,clock});assert.equal(prepared.document.categories[0].title,'Retain');assert.deepEqual(prepared.document.futureSettings,{value:42});
  const merged=mergeWorkspaceDocuments({base,left:{projects:[{id:'p',title:'Old',position:0,archived:false}]},right:{projects:[{...base.projects[0],title:'Remote'}],futureSettings:{value:42}},leftFallback:clock,rightFallback:clock,reviewConflicts:true});
  assert.equal(merged.conflicts.length,0);assert.deepEqual(merged.document.projects[0],{id:'p',title:'Remote',position:0,archived:false,future:'keep'});
});

test('delete versus edit requires review, and choosing an edit removes the conflicting tombstone',async()=>{
  const {first,second}=await twoClients();
  await first.client.saveWorkspaceStructure([],[],[],{...metrics,projectCount:0});
  const ready=reviews(second),saving=save(second,{title:'Keep edited project'}),review=await ready;
  assert.equal(review.conflicts.length,1);assert.equal(review.conflicts[0].remote,null);
  await review.confirm({[review.conflicts[0].key]:'local'});await saving;
  assert.equal(await title(first),'Keep edited project');
});

test('deleting an unchanged project remains deleted without resurrecting it from another client',async()=>{
  const {first,second}=await twoClients();await first.client.saveWorkspaceStructure([],[],[],{...metrics,projectCount:0});
  await save(second);assert.equal((await first.client.loadGenesisWorkspace()).projects.length,0);
});

test('late confirmation after sign-out cannot save or publish another account state',async()=>{
  const {first,second,remote}=await twoClients();await save(first,{title:'Remote'});
  const ready=reviews(second),saving=save(second,{title:'Local'}),rejected=assert.rejects(saving,/WORKSPACE_CONFLICT_PENDING/),review=await ready;
  const version=remote.version;
  const event=new Event('storage');Object.assign(event,{key:'genesis-local-sign-out-v1',newValue:'synthetic'});second.window.dispatchEvent(event);await rejected;
  await assert.rejects(review.confirm({[review.conflicts[0].key]:'local'}));assert.equal(remote.version,version);
});

test('a late successful HTTP reply after sign-out cannot adopt or clear a draft',async()=>{
  const {second,remote}=await twoClients(),entered=deferred(),release=deferred();
  second.respond(async(url,init)=>{const response=await remote.respond(url,init);if(init.method==='PUT'){entered.resolve();await release.promise;}return response;});
  const saving=save(second,{title:'Delayed'}),rejected=assert.rejects(saving);await entered.promise;
  const event=new Event('storage');Object.assign(event,{key:'genesis-local-sign-out-v1',newValue:'synthetic'});second.window.dispatchEvent(event);release.resolve();await rejected;
  assert.equal(second.client.restoreOfflineWorkspaceSession('different-account'),false);
});
