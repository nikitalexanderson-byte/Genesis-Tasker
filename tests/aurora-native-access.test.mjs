import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const {createNativeAuroraAccess}=calendarModule('app/aurora/native-access.ts');

function nativeFixture(){
 const live=new Set(),calls=[],disk=new Map();
 const check=token=>{if(token&&!live.has(token))throw new Error('E2EE_INVALID_LEGACY_OPERATION');};
 const bridge={checkSession:check,getItem:(key,token)=>{check(token);calls.push(['get',token]);return disk.get(key)??null;},
  setItem:(key,value,token)=>{check(token);calls.push(['set',token]);disk.set(key,value);},
  removeItem:(key,token)=>{check(token);calls.push(['remove',token]);disk.delete(key);}};
 let failBegin=false,foreignReceipt=false;
 const rpc=async(method,payload)=>{
  calls.push([method,payload.operationId]);
  if(method==='operationBegin') {live.add(payload.operationId);if(failBegin)throw new Error('Synthetic lost begin receipt');return {operationId:foreignReceipt?'other':payload.operationId};}
  if(method==='operationEnd'){live.delete(payload.operationId);return {};}
  check(payload.operationId);assert.ok(payload.operationId);return {};
 };
 return {live,calls,disk,access:createNativeAuroraAccess(bridge,rpc),loseBegin:()=>{failBegin=true;},foreign:()=>{foreignReceipt=true;}};
}
test('native operation binds storage and every private RPC to one exact token, then expires it',async()=>{
 const f=nativeFixture();let old;
 await f.access.withLegacyOperation(async access=>{
  old=access;access.storage.setItem('pending','ciphertext');assert.equal(access.storage.getItem('pending'),'ciphertext');
  await access.seal({},'aurora-workspace:v1');await access.request('/aurora-workspace');await access.open({iv:'iv',ciphertext:'ct'},'aurora-workspace:v1');
  await access.withLegacyOperation(async nested=>{nested.check();nested.storage.removeItem('pending');});
 });
 assert.equal(f.live.size,0);assert.equal(new Set(f.calls.map(row=>row[1])).size,1);assert.equal(f.calls.filter(row=>row[0]==='operationBegin').length,1);
 assert.throws(()=>old.check(),/E2EE_INVALID_LEGACY_OPERATION/);
 await f.access.withLegacyOperation(async access=>{access.check();});
 assert.equal(new Set(f.calls.map(row=>row[1])).size,2);
});
test('unknown begin outcome still ends its caller-selected native lease',async()=>{
 const f=nativeFixture();f.loseBegin();let called=false;
 await assert.rejects(f.access.withLegacyOperation(async()=>{called=true;}),/Synthetic lost begin receipt/);
 assert.equal(called,false);assert.equal(f.live.size,0);assert.deepEqual(f.calls.map(row=>row[0]),['operationBegin','operationEnd']);
 assert.equal(f.calls[0][1],f.calls[1][1]);
});
test('a foreign native begin receipt never grants editor storage access',async()=>{
 const f=nativeFixture();f.foreign();let called=false;
 await assert.rejects(f.access.withLegacyOperation(async()=>{called=true;}),/E2EE_INVALID_LEGACY_OPERATION/);
 assert.equal(called,false);assert.equal(f.live.size,0);
});
test('a failed native callback always releases its lease and keeps durable work',async()=>{
 const f=nativeFixture();await assert.rejects(f.access.withLegacyOperation(async access=>{
  access.storage.setItem('pending','retained-ciphertext');throw new Error('Synthetic failure');
 }),/Synthetic failure/);
 assert.equal(f.disk.get('pending'),'retained-ciphertext');assert.equal(f.live.size,0);
});
