import assert from 'node:assert/strict';
import test from 'node:test';
import {nativeBackupOperations} from '../app/backup-native-operations.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};};
function rig(){const events=[];const ports={async begin(operationId){events.push(['begin',operationId]);return{operationId};},async end(id){events.push(['end',id]);},async restart(){events.push(['restart']);}};
 return{events,ports,session:nativeBackupOperations(ports)};}
test('one backup capability remains admitted across picker crypto and multiple request waits',async()=>{
 const r=rig(),picker=deferred(),entered=deferred();let original='';
 const job=r.session.run(async()=>{original=r.session.token();assert.match(original,/^[a-f0-9-]{36}$/);entered.resolve();await picker.promise;
  for(const method of ['read file','capture','retain','authorize','materialize','preview','commit']){await Promise.resolve();assert.equal(r.session.token(),original);r.events.push([method]);}return'finished';});
 await entered.promise;assert.equal(r.events.filter(([event])=>event==='end').length,0);picker.resolve();assert.equal(await job,'finished');
 assert.deepEqual(r.events[0],['begin',original]);assert.deepEqual(r.events.at(-1),['end',original]);assert.equal(r.session.token(),'');
});
test('a second action cannot enter while a begin receipt is pending or while the admitted job waits',async()=>{
 const r=rig(),begin=deferred(),body=deferred(),entered=deferred();r.ports.begin=async id=>{r.events.push(['begin',id]);await begin.promise;return{operationId:id};};
 const first=r.session.run(async()=>{entered.resolve();await body.promise;});
 await assert.rejects(r.session.run(async()=>assert.fail('Concurrent job entered')),/NESTED_LEGACY_OPERATION/);
 begin.resolve();await entered.promise;await assert.rejects(r.session.run(async()=>assert.fail('Nested job entered')),/NESTED_LEGACY_OPERATION/);
 body.resolve();await first;assert.equal(r.events.filter(([event])=>event==='begin').length,1);
});
test('a lost begin receipt still cleans up its caller-selected capability and never starts the action',async()=>{
 const r=rig();r.ports.begin=async id=>{r.events.push(['begin',id]);throw new Error('lost begin receipt');};
 await assert.rejects(r.session.run(async()=>assert.fail('Action began after a lost receipt')),/lost begin receipt/);
 assert.deepEqual(r.events.map(([event])=>event),['begin','end']);assert.equal(r.events[0][1],r.events[1][1]);assert.equal(r.session.token(),'');
});
test('a foreign or expanded begin receipt never releases a foreign capability',async()=>{
 for(const response of [{operationId:'foreign'},{operationId:'match',extra:'future'},null]){
  const r=rig();let chosen='';r.ports.begin=async id=>{chosen=id;return response?.operationId==='match'?{...response,operationId:id}:response;};
  await assert.rejects(r.session.run(async()=>assert.fail('Malformed receipt admitted')),/INVALID_LEGACY_OPERATION/);
  assert.deepEqual(r.events,[['end',chosen]]);assert.equal(r.session.token(),'');
 }
});
test('native cleanup failure prevents successful completion but preserves the original action failure',async()=>{
 const r=rig();r.ports.end=async()=>{throw new Error('cleanup failed');};
 await assert.rejects(r.session.run(async()=>{}),/cleanup failed/);
 await assert.rejects(r.session.run(async()=>{throw new Error('original action failure');}),/original action failure/);
 r.ports.end=async()=>{};assert.equal(await r.session.run(async()=>'new distinct operation'),'new distinct operation');assert.equal(r.session.token(),'');
});
test('verified reset requests restart only after the whole backup capability is released',async()=>{
 const r=rig();r.ports.restart=async()=>{assert.equal(r.session.token(),'');r.events.push(['restart']);};
 await r.session.run(async()=>{r.events.push(['reset own generation']);r.session.requestRestart();r.session.requestRestart();});
 assert.deepEqual(r.events.map(([event])=>event),['begin','reset own generation','end','restart']);
});
test('failed reset or failed cleanup cannot restart the application and restart has no standalone authority',async()=>{
 const r=rig();assert.throws(()=>r.session.requestRestart(),/INVALID_LEGACY_OPERATION/);
 await assert.rejects(r.session.run(async()=>{r.session.requestRestart();throw new Error('reset failed');}),/reset failed/);
 r.ports.end=async()=>{throw new Error('end failed');};await assert.rejects(r.session.run(async()=>{r.session.requestRestart();}),/end failed/);
 assert.equal(r.events.filter(([event])=>event==='restart').length,0);
});
