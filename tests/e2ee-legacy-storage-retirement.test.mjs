import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRecoveryKit} from '../app/e2ee/keys.ts';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {E2eeDeviceDocument} from '../app/e2ee/device-document.ts';
import {inspectDeviceControlCustody} from '../app/e2ee/device-control-custody.ts';
import {LegacyStorageRetirement,LEGACY_STORAGE_INDEX,LEGACY_STORAGE_ORIGINAL_PREFIX,migrationSourceStorage,validateLegacyStorageIndex,validateLegacyStorageOriginal} from '../app/e2ee/legacy-storage-retirement.ts';

class Records{
 rows=new Map();fail=false;afterCommit;
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return [...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes){
  if(this.fail)throw Error('DISK_FULL');
  for(const c of changes)assert.equal(this.rows.get(c.key)?.serial??null,c.expected);
  for(const c of changes)this.rows.set(c.key,structuredClone(c.value));
  this.afterCommit?.();
 }
}
class Keys{
 rows=new Map();async get(owner){return structuredClone(this.rows.get(owner)??null);}
 async create(owner,bundle){assert(!this.rows.has(owner));this.rows.set(owner,{serial:1,bundle:structuredClone(bundle)});}
}
function storage(){
 const rows=new Map();return{rows,failRemove:false,failSet:false,get length(){return rows.size;},key:index=>[...rows.keys()][index]??null,
  getItem:key=>rows.get(key)??null,setItem(key,value){if(this.failSet)throw Error('QUOTA');rows.set(key,value);},
  removeItem(key){if(this.failRemove)throw Error('REMOVE_DENIED');rows.delete(key);}};
}
async function fixture(t){
 const owner='retire-'+crypto.randomUUID(),recovery=await createRecoveryKit(owner),records=new Records(),keys=new Keys(),physical=storage();
 let current=true;const check=()=>{if(!current)throw Error('OWNER_CHANGED');};
 const device=await UnlockedWebDevice.provision(owner,recovery.secret,recovery.kit,records,keys);
 t.after(()=>device.lock());return{owner,recovery,records,keys,physical,device,check,stop:()=>{current=false;},
  open:scope=>LegacyStorageRetirement.open(device,physical,check,true,scope??'scope:personal')};
}

test('retirement seals exact key and content bytes before removal; cold vault retains inert custody',async t=>{
 const f=await fixture(t),key='genesis-workspace-device-key-v2:'+f.owner,text='PRIVATE-ORIGINAL-'+crypto.randomUUID();
 f.physical.setItem(key,'LEGACY-KEY-CANARY');f.physical.setItem('genesis-calendar-v2:'+f.owner,text);f.physical.setItem('unrelated-owner','PRESERVE');
 const r=await f.open();assert.equal(migrationSourceStorage(f.owner),r.storage);
 assert.equal(r.storage.getItem(key),'LEGACY-KEY-CANARY');assert.equal(r.storage.getItem('genesis-calendar-v2:'+f.owner),text);
 await r.retire();assert.equal(f.physical.getItem(key),null);assert.equal(f.physical.getItem('genesis-calendar-v2:'+f.owner),null);
 assert.equal(f.physical.getItem('unrelated-owner'),'PRESERVE');assert.equal(r.storage.getItem(key),'LEGACY-KEY-CANARY');
 assert(!JSON.stringify([...f.records.rows]).includes(text));assert(!JSON.stringify([...f.records.rows]).includes('LEGACY-KEY-CANARY'));
 r.close();f.device.lock();
 const cold=await UnlockedWebDevice.unlock(f.owner,f.recovery.secret,f.records,f.keys);t.after(()=>cold.lock());
 const reopened=await LegacyStorageRetirement.open(cold,f.physical,()=>cold.requireOpen(),true,'scope:project');
 t.after(()=>reopened.close());assert.equal(reopened.storage.getItem(key),'LEGACY-KEY-CANARY');
 const claims=[];await inspectDeviceControlCustody({device:cold,vault:cold.vault,personalScopeId:'scope:personal',current:()=>cold.requireOpen(),claim:(...args)=>claims.push(args)});
 assert(claims.some(([,id])=>id===LEGACY_STORAGE_INDEX));assert.equal(claims.filter(([,id])=>id.startsWith(LEGACY_STORAGE_ORIGINAL_PREFIX)).length,2);
 const index=await new E2eeDeviceDocument(cold,LEGACY_STORAGE_INDEX,v=>validateLegacyStorageIndex(v,f.owner),()=>cold.requireOpen()).load();
 for(const row of index.value.entries){
  const original=await new E2eeDeviceDocument(cold,row.originals[0],v=>validateLegacyStorageOriginal(v,f.owner),()=>cold.requireOpen()).load();
  assert.equal(original.value.execution,'history-only');assert.equal(original.value.raw,row.key===key?'LEGACY-KEY-CANARY':text);
 }
});

test('failed sealed write, lock and changed owner never remove a live original',async t=>{
 for(const mode of ['storage','lock','owner']){
  const f=await fixture(t);f.physical.setItem('source','ORIGINAL');const r=await f.open();t.after(()=>r.close());r.storage.getItem('source');
  if(mode==='storage')f.records.fail=true;else if(mode==='lock')f.device.lock();else f.stop();
  await assert.rejects(r.retire());assert.equal(f.physical.getItem('source'),'ORIGINAL');
 }
});

test('late source change blocks every removal and preserves the newly edited value',async t=>{
 const f=await fixture(t);f.physical.setItem('one','FIRST');f.physical.setItem('two','SECOND');const r=await f.open();t.after(()=>r.close());
 r.storage.getItem('one');r.storage.getItem('two');
 f.records.afterCommit=()=>{f.physical.setItem('two','NEW EDIT');f.records.afterCommit=undefined;};
 await assert.rejects(r.retire(),/SOURCE_CHANGED/);assert.equal(f.physical.getItem('one'),'FIRST');assert.equal(f.physical.getItem('two'),'NEW EDIT');
});

test('prepared retirement survives interruption and removes only byte-identical originals',async t=>{
 const f=await fixture(t);f.physical.setItem('source','ORIGINAL');let r=await f.open();r.storage.getItem('source');f.physical.failRemove=true;
 await assert.rejects(r.retire(),/REMOVE_DENIED/);assert.equal(f.physical.getItem('source'),'ORIGINAL');r.close();
 f.physical.failRemove=false;r=await f.open();t.after(()=>r.close());await r.finishPrepared();assert.equal(f.physical.getItem('source'),null);
 assert.equal(r.storage.getItem('source'),'ORIGINAL');
});

test('prepared restart refuses a changed live original instead of deleting it',async t=>{
 const f=await fixture(t);f.physical.setItem('source','ORIGINAL');let r=await f.open();r.storage.getItem('source');f.physical.failRemove=true;
 await assert.rejects(r.retire());r.close();f.physical.failRemove=false;f.physical.setItem('source','NEW EDIT');
 r=await f.open();t.after(()=>r.close());await assert.rejects(r.finishPrepared(),/SOURCE_CHANGED/);assert.equal(f.physical.getItem('source'),'NEW EDIT');
});

test('cancel restores only its scope and later deletion is not resurrected from cancelled history',async t=>{
 const f=await fixture(t);f.physical.setItem('personal','PERSONAL');let r=await f.open('scope:personal');r.storage.getItem('personal');await r.retire();r.close();
 f.physical.setItem('project','PROJECT');r=await f.open('scope:project');r.storage.getItem('project');await r.retire();await r.restoreCancelled();r.close();
 assert.equal(f.physical.getItem('personal'),null);assert.equal(f.physical.getItem('project'),'PROJECT');f.physical.removeItem('project');
 r=await f.open('scope:project');t.after(()=>r.close());assert.equal(r.storage.getItem('project'),null);assert.equal(r.storage.getItem('personal'),'PERSONAL');
});

test('failed cancel restoration retains sealed sources for a later retry',async t=>{
 const f=await fixture(t);f.physical.setItem('source','ORIGINAL');let r=await f.open();r.storage.getItem('source');await r.retire();f.physical.failSet=true;
 await assert.rejects(r.restoreCancelled(),/QUOTA/);r.close();f.physical.failSet=false;r=await f.open();t.after(()=>r.close());await r.restoreCancelled();assert.equal(f.physical.getItem('source'),'ORIGINAL');
});

test('profile cache uses its dedicated retention path; unrelated and unread sources stay live',async t=>{
 const f=await fixture(t);f.physical.setItem('genesis-last-user-v2','PROFILE');f.physical.setItem('untouched','KEEP');const r=await f.open();t.after(()=>r.close());
 assert.equal(r.storage.getItem('genesis-last-user-v2'),'PROFILE');await r.retire();assert.equal(f.physical.getItem('genesis-last-user-v2'),'PROFILE');assert.equal(f.physical.getItem('untouched'),'KEEP');
});

test('corrupt sealed history, foreign owner and concurrent migrations refuse without discarding originals',async t=>{
 const f=await fixture(t);f.physical.setItem('source','ORIGINAL');let r=await f.open();r.storage.getItem('source');await assert.rejects(f.open(),/MIGRATION_BUSY/);await r.retire();r.close();
 const row=[...f.records.rows.values()].find(value=>value!==null);assert(row);
 for(const [key,value]of f.records.rows){const changed=structuredClone(value);changed.serial++;f.records.rows.set(key,changed);}
 await assert.rejects(f.open(),/E2EE_/);assert.equal(f.physical.getItem('source'),null);
 assert.throws(()=>validateLegacyStorageIndex({format:'genesis-legacy-storage-retirement-v1',ownerId:'other',entries:[]},f.owner),/CORRUPT/);
});
