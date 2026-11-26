import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {admitE2eeStorage,measureE2eeDeviceStorage} from '../app/e2ee/storage-admission.ts';
import {UnlockedWebDevice} from '../app/e2ee/device-vault.ts';
import {createRecoveryKit} from '../app/e2ee/keys.ts';
const vector=JSON.parse(readFileSync(new URL('./fixtures/e2ee-storage-admission-v1.json',import.meta.url),'utf8'));
for(const row of vector.cases)test('provider-wide admission vector: '+row.id,()=>{
 const before=structuredClone(row);
 if(row.error)assert.throws(()=>admitE2eeStorage(row.usage,row.growth,row.budget),{message:row.error});
 else{const receipt=admitE2eeStorage(row.usage,row.growth,row.budget);assert.deepEqual(receipt,row.expected);assert.ok(Object.isFrozen(receipt));}
 assert.deepEqual(row,before);
});
test('unknown fields, coercion, accessors and noninteger byte amounts never become capacity grants',()=>{
 const row=vector.cases[0];
 for(const value of [NaN,Infinity,0.5,'3',null,undefined]){
  assert.throws(()=>admitE2eeStorage({...row.usage,records:value},row.growth,row.budget));
 }
 for(const field of ['usage','growth','budget']){
  const args=[structuredClone(row.usage),structuredClone(row.growth),structuredClone(row.budget)],index=['usage','growth','budget'].indexOf(field);args[index].unexpected=true;
  assert.throws(()=>admitE2eeStorage(...args));
 }
 let getters=0;const usage={...row.usage};Object.defineProperty(usage,'records',{enumerable:true,get(){getters++;return 0;}});
 assert.throws(()=>admitE2eeStorage(usage,row.growth,row.budget));assert.equal(getters,0);
});
test('a device lookalike cannot measure or reach a quota provider',async()=>{
 let quota=0;await assert.rejects(measureE2eeDeviceStorage({vault:{storage:{async providerCounts(){throw new Error('UNREACHABLE');}}}},()=>{},async()=>{quota++;return{usage:0,quota:100};}),/E2EE_STORAGE_PROVIDER_REQUIRED/);assert.equal(quota,0);
});
test('an actually provisioned memory device cannot impersonate the actual IDB provider',async()=>{
 const recovery=await createRecoveryKit('storage-owner'),rows=new Map(),records={async get(key){return structuredClone(rows.get(key)??null);},async list(prefix){return[...rows.keys()].filter(key=>key.startsWith(prefix));},async commit(){throw new Error('UNREACHABLE');}};
 const bundles=new Map(),keys={async get(id){return structuredClone(bundles.get(id)??null);},async create(id,bundle){bundles.set(id,{serial:1,bundle:structuredClone(bundle)});}};
 const device=await UnlockedWebDevice.provision('storage-owner',recovery.secret,recovery.kit,records,keys);let quota=0;
 try{await assert.rejects(measureE2eeDeviceStorage(device,()=>{},async()=>{quota++;return{usage:0,quota:100};}),/E2EE_STORAGE_PROVIDER_REQUIRED/);assert.equal(quota,0);assert.equal(rows.size,0);assert.equal(bundles.size,1);}
 finally{device.lock();recovery.secret.fill(0);}
});
