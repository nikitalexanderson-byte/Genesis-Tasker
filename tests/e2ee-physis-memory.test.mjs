import assert from 'node:assert/strict';
import test from 'node:test';
import {webcrypto} from 'node:crypto';
import {physisModules,settingsRecord,deferred,clone} from './physis-test-loader.mjs';

const owner='physis-migration-owner',generate=()=>webcrypto.subtle.generateKey({name:'AES-GCM',length:256},true,['encrypt','decrypt']);
const importKey=value=>webcrypto.subtle.importKey('raw',Buffer.from(value,'base64'),'AES-GCM',false,['decrypt']);

async function fixture(cryptoOverride=webcrypto){
 const modules=physisModules(cryptoOverride),key=await generate(),record=settingsRecord();let calls=0;
 const wire={id:record.id,revision:1,sequence:1,updatedAt:record.updatedAt,deletedAt:null,envelope:await modules.crypto.sealPhysis(key,owner,record.id,1,record)};
 const transport=async(path)=>{calls++;if(path.startsWith('/records?'))return{records:[clone(wire)],cursor:1,minCursor:0,snapshot:1,hasMore:false};throw new TypeError('synthetic lost response');};
 let current=true;
 const model=new(modules.store().PhysisMemoryStore)(owner,key,1,transport,()=>{if(!current)throw new Error('ACCOUNT_CHANGED');});
 await model.reload();return{modules,key,record,wire,model,calls:()=>calls,end:()=>{current=false;}};
}

test('Physis protected-source capture retains uncertain exact retry and old DEK without network or source cleanup',async()=>{
 const f=await fixture(),record={...f.record,data:{...f.record.data,restSeconds:123}};
 await assert.rejects(f.model.getSnapshot().save(record));const before=f.calls(),memory=await f.model.captureMigrationMemory();
 assert.equal(f.calls(),before);assert.equal(f.model.hasPending,true);assert.equal(memory.pending.length,1);
 assert.equal(memory.pending[0].requestId.length,36);assert.equal(memory.pending[0].changes[0].operation,'update');
 assert.deepEqual(clone(memory.records),[record]);assert.deepEqual(clone(memory.pending[0].records),[record]);
 const request=JSON.stringify(memory.pending[0].changes),key=await importKey(memory.key);
 assert.deepEqual(clone(await f.modules.crypto.openPhysis(key,owner,record.id,1,memory.pending[0].changes[0].envelope)),record);
 memory.pending[0].records[0].data.restSeconds=10;memory.confirmed.length=0;
 const again=await f.model.captureMigrationMemory();assert.equal(JSON.stringify(again.pending[0].changes),request);
 assert.equal(again.pending[0].records[0].data.restSeconds,123);assert.equal(again.confirmed.length,1);f.model.destroy();
});

test('uncertain Physis rotation preserves both independent keys and exact prepared body after source destruction',async()=>{
 const f=await fixture(),next=await generate(),access={seal:async()=>({iv:'AAAAAAAAAAAAAAAA',ciphertext:Buffer.alloc(62).toString('base64')})};
 const {vault}=await f.modules.crypto.accountPhysisVault(access,2,next);
 await assert.rejects(f.model.rotate(next,vault,3));const before=f.calls(),memory=await f.model.captureMigrationMemory();
 assert.equal(f.calls(),before);assert.equal(memory.rotation.uncertain,true);assert.equal(memory.rotation.expectedRevision,3);
 const request=JSON.parse(memory.rotation.payload);assert.equal(request.requestId.length,36);assert.equal(request.expectedCursor,1);
 assert.equal(request.expectedRevision,3);assert.equal(request.vault.keyVersion,2);assert.equal(memory.rotation.result,null);
 f.model.destroy();const old=await importKey(memory.key),rotated=await importKey(memory.rotation.key);
 assert.deepEqual(clone(await f.modules.crypto.openPhysis(old,owner,f.record.id,1,memory.confirmed[0].envelope)),f.record);
 assert.deepEqual(clone(await f.modules.crypto.openPhysis(rotated,owner,f.record.id,2,request.records[0].envelope)),f.record);
 await assert.rejects(f.modules.crypto.openPhysis(old,owner,f.record.id,2,request.records[0].envelope));
 await assert.rejects(f.model.captureMigrationMemory(),/PHYSIS_LOCKED/);
});

test('mounted and detached Physis editor states are independent immutable source data',async()=>{
 const f=await fixture();let draft={name:'private unsaved form',amount:'1,'};const detach=f.model.registerMigrationEditor(()=>draft);
 assert.equal((await f.model.captureMigrationMemory()).editors[0].mounted,true);
 draft={...draft,amount:'1,5'};detach();draft.name='later mutation';detach();
 const memory=await f.model.captureMigrationMemory();assert.equal(memory.editors.length,1);assert.equal(memory.editors[0].mounted,false);
 assert.deepEqual(clone(memory.editors[0].value),{name:'private unsaved form',amount:'1,5'});f.model.destroy();
});

test('capture rejects a live read, account change and editor mutation during asynchronous key export',async()=>{
 const block=deferred(),entered=deferred();let intercept=false;
 const cryptoOverride={getRandomValues:array=>webcrypto.getRandomValues(array),randomUUID:()=>webcrypto.randomUUID(),subtle:new Proxy(webcrypto.subtle,{get(target,name){
  const original=Reflect.get(target,name);if(name==='exportKey')return async(...args)=>{if(intercept){entered.resolve();await block.promise;}return original.apply(target,args);};
  return typeof original==='function'?original.bind(target):original;
 }})};
 const f=await fixture(cryptoOverride);let draft='before';f.model.registerMigrationEditor(()=>({draft}));intercept=true;
 const capture=f.model.captureMigrationMemory();await entered.promise;draft='after';block.resolve();await assert.rejects(capture,/E2EE_PHYSIS_CAPTURE_CHANGED/);
 f.end();await assert.rejects(f.model.captureMigrationMemory(),/ACCOUNT_CHANGED/);f.model.destroy();
 const waiting=deferred(),started=deferred(),m=physisModules(),key=await generate();
 const model=new(m.store().PhysisMemoryStore)(owner,key,1,async()=>{started.resolve();await waiting.promise;return{records:[],cursor:0,minCursor:0,snapshot:0,hasMore:false};},()=>{});
 const reload=model.reload();await started.promise;await assert.rejects(model.captureMigrationMemory(),/E2EE_PHYSIS_OPERATION_PENDING/);
 waiting.resolve();await reload;assert.equal((await model.captureMigrationMemory()).records.length,0);model.destroy();
});

test('retained Physis session survives page detachment with immutable vault metadata and refuses foreign/current-owner changes',async()=>{
 const f=await fixture(),sessions=f.modules.sessions(),vaultState={vault:{version:2,keyVersion:1,account:{iv:'exact-old-iv',ciphertext:'exact-old-wrap'}},revision:3};
 sessions.rememberPhysisSession(owner,f.model,vaultState);vaultState.vault.account.ciphertext='later mutation';
 const retained=sessions.retainedPhysisSession(owner);assert.equal(retained.model,f.model);retained.vaultState.revision=999;
 let form={text:'detached private form'};const detach=f.model.registerMigrationEditor(()=>form);detach();form=null;
 const captured=await sessions.capturePhysisSessionMemory(owner);assert.equal(captured.length,1);assert.equal(captured[0].vault.account.ciphertext,'exact-old-wrap');
 assert.equal(sessions.retainedPhysisSession(owner).vaultState.revision,3);assert.equal(captured[0].state.editors[0].value.text,'detached private form');
 assert.deepEqual(clone(await sessions.capturePhysisSessionMemory('foreign')),[]);f.end();assert.throws(()=>sessions.retainedPhysisSession(owner),/ACCOUNT_CHANGED/);
 await assert.rejects(sessions.capturePhysisSessionMemory(owner),/ACCOUNT_CHANGED/);sessions.clearPhysisSessionMemory();assert.equal(sessions.retainedPhysisSession(owner),null);
});

test('in-flight file/import work prevents source capture even after its form detaches and never nests a legacy owner permit',async()=>{
 const f=await fixture(),work=deferred(),entered=deferred();let draft={file:'loading'};
 const detach=f.model.registerMigrationEditor(()=>draft),task=f.model.withEditorTask(async()=>{entered.resolve();await work.promise;return'complete';});
 await entered.promise;detach();await assert.rejects(f.model.captureMigrationMemory(),/E2EE_PHYSIS_OPERATION_PENDING/);
 work.resolve();assert.equal(await task,'complete');assert.equal((await f.model.captureMigrationMemory()).editors[0].value.file,'loading');
 const second=deferred(),late=f.model.withEditorTask(async()=>{await second.promise;});f.end();second.resolve();await assert.rejects(late,/ACCOUNT_CHANGED/);f.model.destroy();
});
