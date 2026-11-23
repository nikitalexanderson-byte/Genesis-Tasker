import assert from 'node:assert/strict';
import {test} from 'node:test';
import {E2eeReadRateError,retryE2eeRead} from '../app/e2ee/read-rate-retry.ts';

test('an actual rate boundary repeats the same read after guarded one-second waits',async()=>{
 let at=0,calls=0,guards=0;const waits=[],ports={now:()=>at,sleep:async ms=>{waits.push(ms);at+=ms;}};
 const result=await retryE2eeRead(async()=>{if(++calls===1)throw new E2eeReadRateError(3);return 'same signed read';},()=>guards++,ports);
 assert.equal(result,'same signed read');assert.equal(calls,2);assert.deepEqual(waits,[1000,1000,1000]);assert(guards>=8);
});
test('lock or owner change during the rate wait prevents the next RPC',async()=>{
 let live=true,calls=0,at=0;
 await assert.rejects(retryE2eeRead(async()=>{calls++;throw new E2eeReadRateError(30);},()=>{if(!live)throw Error('E2EE_ACCOUNT_CHANGED');},{now:()=>at,sleep:async ms=>{at+=ms;live=false;}}),/E2EE_ACCOUNT_CHANGED/);
 assert.equal(calls,1);
});
test('a result from an account retired while the RPC ran is never admitted',async()=>{
 let live=true;await assert.rejects(retryE2eeRead(async()=>{live=false;return 'private response';},()=>{if(!live)throw Error('E2EE_UNLOCK_REQUIRED');}),/E2EE_UNLOCK_REQUIRED/);
});
test('other refusals are not retried, and repeated rate replies have a finite attempt budget',async()=>{
 let calls=0;await assert.rejects(retryE2eeRead(async()=>{calls++;throw Error('E2EE_STALE_EPOCH');},()=>{}),/E2EE_STALE_EPOCH/);assert.equal(calls,1);
 calls=0;await assert.rejects(retryE2eeRead(async()=>{calls++;throw new E2eeReadRateError(0);},()=>{},{now:()=>0}),/E2EE_HTTP_ERROR/);assert.equal(calls,3);
 for(const seconds of [-1,601,NaN,1.1])assert.throws(()=>new E2eeReadRateError(seconds),/E2EE_INVALID_RETRY_AFTER/);
});
