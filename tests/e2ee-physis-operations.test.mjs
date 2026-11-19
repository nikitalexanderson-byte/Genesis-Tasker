import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';
import {settingsRecord} from './physis-test-loader.mjs';
import {WebLegacyTransportGate,WebMigrationTransportFence,validateLegacyTransportTransition,legacyTransportLock} from '../app/e2ee/legacy-transport-fence.ts';

const response=value=>Response.json(value),clone=value=>JSON.parse(JSON.stringify(value));
const observed=promise=>promise.then(value=>({value}),error=>({error}));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
async function fixture(options={}){
 const tab=await cloudSyncClient({withPhysis:true,...options}),key=await webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
 return{tab,key,store:new tab.physis.store.PhysisMemoryStore(tab.userId,key,1)};
}
function fence(tab){
 const markers={get:async owner=>tab.legacyMarkers.get(owner)??null,commit:async(owner,expected,next)=>{
  validateLegacyTransportTransition(owner,tab.legacyMarkers.get(owner)??null,expected,next);
  if(next)tab.legacyMarkers.set(owner,next);else tab.legacyMarkers.delete(owner);
 }};
 return new WebMigrationTransportFence(new WebLegacyTransportGate(markers,tab.navigator.locks),tab.userId,`personal:${tab.userId}`,()=>{});
}
function acknowledgement(body,after=0){
 return{records:body.changes.map((change,index)=>({id:change.id,revision:change.expectedRevision+1,sequence:after+index+1,
  updatedAt:'2026-11-19T00:00:00.000Z',deletedAt:change.operation==='delete'?'2026-11-19T00:00:00.000Z':null})),cursor:after+body.changes.length};
}
function savePeer(tab){
 const bodies=[];let cursor=0;tab.respond(async(url,init)=>{
  assert.equal(new URL(url).pathname,'/api/physis/v1/records');assert.equal(init.method,'POST');
  bodies.push(init.body);const result=acknowledgement(JSON.parse(init.body),cursor);cursor=result.cursor;return response(result);
 });return bodies;
}
async function wire(tab,key,record){
 return{id:record.id,revision:1,sequence:1,updatedAt:record.updatedAt,deletedAt:null,
  envelope:await tab.physis.crypto.sealPhysis(key,tab.userId,record.id,1,record)};
}

test('Physis bootstrap and initial reload borrow one owner permit across account crypto and a queued migration',{timeout:8000},async()=>{
 const tab=await cloudSyncClient({withPhysis:true});let savedVault=null,model,borrowed,admitted=false;
 tab.respond(async(url,init)=>{const path=new URL(url).pathname;
  if(path==='/api/physis/v1/vault'&&init.method==='PUT'){const body=JSON.parse(init.body);assert.equal(body.expectedRevision,0);savedVault=body.vault;return response({revision:1});}
  if(path==='/api/physis/v1/vault')return response({vault:savedVault,revision:savedVault?1:0});
  assert.equal(path,'/api/physis/v1/records');return response({records:[],cursor:0,minCursor:0,snapshot:0,hasMore:false});
 });
 const held=tab.holdCrypto('encrypt'),opening=observed(tab.client.withPhysisAccountOperation(tab.userId,async({account,request,permit})=>{
  borrowed=permit;const result=await tab.physis.account.openPhysisAccount(tab.userId,account,request,account.check);
  model=new tab.physis.store.PhysisMemoryStore(tab.userId,result.key,result.state.vault.keyVersion);await model.reload(permit);admitted=true;return result.state;
 }));
 await held.entered;let captured;
 const migrating=fence(tab).withFence(async()=>{captured=await model.captureMigrationMemory();});
 await turn();assert.equal(captured,undefined);assert.equal(tab.requests.length,1);
 held.release();assert.equal((await opening).error,undefined);await migrating;assert.equal(admitted,true);assert.equal(captured.records.length,0);assert.equal(captured.keyVersion,1);
 assert.equal(tab.requests.length,3);assert.equal(savedVault.version,2);
 let late=false;await assert.rejects(tab.client.withPhysisAccountOperation(tab.userId,async()=>{late=true;}),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);assert.equal(late,false);
 await assert.rejects(model.reload(borrowed),/E2EE_INVALID_LEGACY_OPERATION/);assert.equal(tab.requests.length,3);model.destroy();
});

test('Physis migration waits for optimistic memory, encryption, borrowed HTTP and final acknowledgement',{timeout:8000},async()=>{
 const{tab,key,store}=await fixture(),bodies=savePeer(tab),record=settingsRecord(),held=tab.holdCrypto('encrypt');
 const saving=observed(store.getSnapshot().save(record));await held.entered;let captured;
 const migrating=fence(tab).withFence(async()=>{captured={state:clone(store.getSnapshot()),pending:store.hasPending,cursor:store.cursor};});
 await turn();assert.equal(captured,undefined);assert.equal(bodies.length,0);assert.equal(store.hasPending,true);
 held.release();assert.equal((await saving).error,undefined);await migrating;
 assert.equal(captured.pending,false);assert.equal(captured.state.status,'saved');assert.equal(captured.cursor,1);
 assert.deepEqual(captured.state.records,[record]);assert.equal(bodies.length,1);assert.equal(bodies[0].includes(record.createdAt),false);
 const envelope=JSON.parse(bodies[0]).changes[0].envelope;
 assert.deepEqual(clone(await tab.physis.crypto.openPhysis(key,tab.userId,record.id,1,envelope)),record);
});

test('a later Physis save waits before any optimistic write and cannot cross a preparing marker',{timeout:8000},async()=>{
 const{tab,store}=await fixture(),bodies=savePeer(tab),first=settingsRecord(),later=settingsRecord(),held=tab.holdCrypto('encrypt');
 const saving=observed(store.getSnapshot().save(first));await held.entered;
 const entered=deferred(),release=deferred();
 const migrating=fence(tab).withFence(async()=>{entered.resolve();await release.promise;});
 await turn();assert.ok((await tab.navigator.locks.query()).pending.some(row=>row.name===legacyTransportLock(tab.userId)&&row.mode==='exclusive'));
 const second=observed(store.getSnapshot().save(later));await turn();assert.equal(store.getSnapshot().records.length,1);
 held.release();assert.equal((await saving).error,undefined);await entered.promise;
 assert.equal(store.getSnapshot().records.length,1);assert.equal(store.hasPending,false);assert.equal(bodies.length,1);
 release.resolve();await migrating;assert.match((await second).error.message,/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
 assert.deepEqual(clone(store.getSnapshot().records),[first]);assert.equal(store.hasPending,false);assert.equal(bodies.length,1);
});

test('two Physis saves admitted before the barrier drain both queues without borrowing a closed parent',{timeout:8000},async()=>{
 const{tab,store}=await fixture(),bodies=savePeer(tab),first=settingsRecord(),second=settingsRecord(),held=tab.holdCrypto('encrypt');
 const saving=observed(store.getSnapshot().save(first));await held.entered;
 const later=observed(store.getSnapshot().save(second));await turn();assert.equal(store.getSnapshot().records.length,2);
 let captured;const migrating=fence(tab).withFence(async()=>{captured={records:clone(store.getSnapshot().records),pending:store.hasPending,cursor:store.cursor};});
 held.release();assert.equal((await saving).error,undefined);assert.equal((await later).error,undefined);await migrating;
 assert.equal(bodies.length,2);assert.equal(captured.pending,false);assert.equal(captured.cursor,2);assert.deepEqual(captured.records,[first,second]);
});

for(const method of ['reload','exportWire'])test(`Physis ${method} keeps owner exclusion through paged HTTP, decrypt and final return`,{timeout:8000},async()=>{
 const{tab,key,store}=await fixture(),record=settingsRecord(),row=await wire(tab,key,record);
 tab.respond(async(url,init)=>{assert.equal(new URL(url).pathname,'/api/physis/v1/records');assert.equal(init.method,undefined);
  return response({records:[row],cursor:1,snapshot:1,minCursor:0,hasMore:false});});
 const held=tab.holdCrypto('decrypt'),reading=observed(store[method]());await held.entered;let captured=false;
 const migrating=fence(tab).withFence(async()=>{captured=true;});await turn();assert.equal(captured,false);
 held.release();const read=await reading;assert.equal(read.error,undefined);await migrating;assert.equal(captured,true);
 if(method==='reload'){assert.deepEqual(clone(store.getSnapshot().records),[record]);assert.equal(store.cursor,1);}
 else assert.deepEqual(clone(read.value),clone([row]));
 assert.equal(tab.requests.length,1);
});

test('a failed Physis write finishes its error state before migration while retaining the unsent queue',{timeout:8000},async()=>{
 const{tab,store}=await fixture(),record=settingsRecord();tab.respond(async()=>{throw new TypeError('Synthetic offline');});
 const saving=observed(store.getSnapshot().save(record));const result=await saving;assert.ok(result.error);
 let captured;await fence(tab).withFence(async()=>{captured={state:clone(store.getSnapshot()),pending:store.hasPending};});
 assert.equal(captured.pending,true);assert.equal(captured.state.status,'offline');assert.deepEqual(captured.state.records,[record]);
 assert.equal(tab.requests.length,1);
});

test('Physis rotation borrows one permit across reload, new-key encryption, HTTP and result publication',{timeout:8000},async()=>{
 const{tab,key,store}=await fixture(),record=settingsRecord(),row=await wire(tab,key,record);
 const next=await tab.physis.crypto.createPhysisVault(tab.userId,'Synthetic rotation password only',2);let rotationBody;
 tab.respond(async(url,init)=>{
  if(init.method!=='POST')return response({records:[row],cursor:1,snapshot:1,minCursor:0,hasMore:false});
  assert.equal(new URL(url).pathname,'/api/physis/v1/rotate');rotationBody=init.body;
  const sent=JSON.parse(init.body);assert.equal(sent.expectedCursor,1);assert.equal(sent.expectedRevision,1);
  assert.deepEqual(clone(await tab.physis.crypto.openPhysis(next.key,tab.userId,record.id,2,sent.records[0].envelope)),record);
  return response({revision:2,cursor:3,keyVersion:2});
 });
 const held=tab.holdCrypto('encrypt'),rotating=observed(store.rotate(next.key,next.vault,1));await held.entered;let captured;
 const migrating=fence(tab).withFence(async()=>{captured=store.rotationPending;});await turn();assert.equal(captured,undefined);
 held.release();const result=await rotating;assert.deepEqual(clone(result.value),{revision:2,cursor:3,keyVersion:2});await migrating;
 assert.equal(captured,false);assert.equal(JSON.parse(rotationBody).records.length,1);assert.equal(tab.requests.length,2);
});

test('a delayed Physis acknowledgement after sign-out cannot clear pending work or publish a late error state',{timeout:8000},async()=>{
 const{tab,store}=await fixture(),record=settingsRecord(),entered=deferred(),release=deferred();
 tab.respond(async(_url,init)=>{entered.resolve();await release.promise;return response(acknowledgement(JSON.parse(init.body)));});
 const saving=observed(store.getSnapshot().save(record));await entered.promise;
 const before=store.getSnapshot();assert.equal(store.hasPending,true);assert.equal(store.cursor,0);
 tab.storage.setItem('genesis-local-sign-out-v1','synthetic-sign-out');release.resolve();
 assert.match((await saving).error.message,/AUTH_REQUIRED|E2EE_ACCOUNT_CHANGED/);
 assert.equal(store.getSnapshot(),before);assert.equal(store.hasPending,true);assert.equal(store.cursor,0);
});

test('an active Physis owner marker refuses before optimistic memory, encryption or HTTP',{timeout:8000},async()=>{
 const{tab,store}=await fixture();tab.legacyMarkers.set(tab.userId,{protocol:1,ownerId:tab.userId,scopeId:`personal:${tab.userId}`,phase:'active',token:'synthetic-active'});
 await assert.rejects(store.getSnapshot().save(settingsRecord()),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
 assert.equal(store.getSnapshot().records.length,0);assert.equal(store.hasPending,false);assert.equal(tab.requests.length,0);
});

test('a foreign Physis owner cannot use the current account transport or stage private work',{timeout:8000},async()=>{
 const{tab,key}=await fixture(),foreign=new tab.physis.store.PhysisMemoryStore('other-owner',key,1);
 await assert.rejects(foreign.getSnapshot().save(settingsRecord()),/E2EE_ACCOUNT_CHANGED/);
 assert.equal(foreign.getSnapshot().records.length,0);assert.equal(foreign.hasPending,false);assert.equal(tab.requests.length,0);
});

test('an authenticated independent Physis key does not require the workspace key to use the owner operation',{timeout:8000},async()=>{
 const{tab,store}=await fixture({initializeWorkspace:false}),bodies=savePeer(tab),record=settingsRecord();
 assert.throws(()=>tab.client.personalDocumentAccess(tab.userId).check(),/Разблокируйте/);
 await store.getSnapshot().save(record);assert.equal(bodies.length,1);assert.equal(store.hasPending,false);
});

test('Physis snapshots the submitted record before waiting for an owner lock',{timeout:8000},async()=>{
 const{tab,key,store}=await fixture(),bodies=savePeer(tab),record=settingsRecord(),original=clone(record),entered=deferred(),release=deferred();
 const blocking=tab.navigator.locks.request(legacyTransportLock(tab.userId),{mode:'exclusive'},async()=>{entered.resolve();await release.promise;});
 await entered.promise;const saving=store.getSnapshot().save(record);record.data.restSeconds=300;
 release.resolve();await blocking;await saving;
 const envelope=JSON.parse(bodies[0]).changes[0].envelope;
 assert.deepEqual(clone(await tab.physis.crypto.openPhysis(key,tab.userId,record.id,1,envelope)),original);
 assert.deepEqual(clone(store.getSnapshot().records),[original]);
});
