import assert from 'node:assert/strict';
import test from 'node:test';
import {createStartupRouting} from '../scripts/qa/startup-routing.mjs';

const origin='http://127.0.0.1:4380';
function request(url,{failure}={}) {
  const calls=[];
  return {calls,request:()=>({url:()=>url}),
    async continue(){calls.push('continue');if(failure)throw new Error(failure);},
    async abort(){calls.push('abort');},
  };
}

test('startup routing aborts external origins and routes only the current local operation',async()=>{
  const router=createStartupRouting(origin),row={routeErrors:[]},handled=[];
  router.begin(row,async()=>handled.push('bootstrap'),async()=>handled.push('shared'));
  const external=request('https://example.invalid/api/bootstrap');await router.handle(external);
  assert.deepEqual(external.calls,['abort']);assert.deepEqual(handled,[]);
  await router.handle(request(origin+'/api/bootstrap'));
  await router.handle(request(origin+'/api/shared/tasks?source=genesis'));
  const assetRequest=request(origin+'/assets/main.js');await router.handle(assetRequest);
  assert.deepEqual(handled,['bootstrap','shared']);assert.deepEqual(assetRequest.calls,['continue']);
});

test('an already handled route fails its owning operation and never falls back to continue',async()=>{
  const router=createStartupRouting(origin),row={routeErrors:[]},route=request(origin+'/assets/main.js',{failure:'Route is already handled!'});
  router.begin(row,async()=>{},async()=>{});await router.handle(route);await router.drain(row);
  assert.deepEqual(route.calls,['continue','abort']);
  assert.deepEqual(row.routeErrors,['Route is already handled!']);assert.equal(router.errors.length,1);
});

test('a delayed callback remains owned by its first operation after a navigation change',async()=>{
  const router=createStartupRouting(origin),first={routeErrors:[]},second={routeErrors:[]};let release;
  router.begin(first,async()=>{await new Promise(resolve=>{release=resolve;});throw new Error('Late startup failure');},async()=>{});
  const pending=router.handle(request(origin+'/api/bootstrap'));
  router.end();router.begin(second,async()=>{},async()=>{});release();await pending;await router.drain(first);
  assert.deepEqual(first.routeErrors,['Late startup failure']);assert.deepEqual(second.routeErrors,[]);
});

test('target-close errors count as failures until owned context teardown begins',async()=>{
  const message='Target page, context or browser has been closed',router=createStartupRouting(origin);
  await router.handle(request(origin+'/asset',{failure:message}));assert.equal(router.errors.length,1);
  router.closing();const late=request(origin+'/asset');late.abort=async()=>{throw new Error(message);};
  await router.handle(late);assert.equal(router.errors.length,1);assert.deepEqual(router.teardownErrors,[message]);
});
