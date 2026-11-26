import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {e2eeStorageWriteGrowth,E2EE_PROVIDER_STORAGE_BUDGET} from '../app/e2ee/storage-capacity.ts';
const vector=JSON.parse(readFileSync(new URL('./fixtures/e2ee-storage-write-growth-v1.json',import.meta.url),'utf8'));
for(const row of vector.cases)test('actual write headroom vector: '+row.id,()=>{
 const before=structuredClone(row.rows);
 if(row.error)assert.throws(()=>e2eeStorageWriteGrowth(row.rows),{message:row.error});
 else{const result=e2eeStorageWriteGrowth(row.rows);assert.deepEqual(result,row.expected);assert.ok(Object.isFrozen(result));}
 assert.deepEqual(row.rows,before);
});
test('write headroom rejects accessors and unknown row fields without invoking caller code',()=>{
 let getters=0;const row={previousBytes:null};Object.defineProperty(row,'nextBytes',{enumerable:true,get(){getters++;return 1;}});
 assert.throws(()=>e2eeStorageWriteGrowth([row]));assert.equal(getters,0);
 assert.throws(()=>e2eeStorageWriteGrowth([{nextBytes:1,previousBytes:null,additional:0}]));
 for(const nextBytes of [NaN,Infinity,0.5,'10',undefined])assert.throws(()=>e2eeStorageWriteGrowth([{nextBytes,previousBytes:null}]));
});
test('provider policy preserves bounded counts and a physical safety reserve',()=>{
 assert.ok(Object.isFrozen(E2EE_PROVIDER_STORAGE_BUDGET));assert.equal(E2EE_PROVIDER_STORAGE_BUDGET.maximumRecords,1000000);
 assert.equal(E2EE_PROVIDER_STORAGE_BUDGET.maximumKeyRecords,65536);assert.equal(E2EE_PROVIDER_STORAGE_BUDGET.safetyBytes,1024*1024);
});
