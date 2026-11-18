import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WebLegacyTransportGate,WebMigrationTransportFence,validateLegacyTransportTransition} from '../app/e2ee/legacy-transport-fence.ts';
import {FixtureLockManager} from './helpers/browser-locks.mjs';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
class Markers {
  rows=new Map();fail=false;
  async get(owner){if(this.fail)throw new Error('SYNTHETIC_STORAGE_FAILURE');return structuredClone(this.rows.get(owner)??null);}
  async commit(owner,expected,next){if(this.fail)throw new Error('SYNTHETIC_STORAGE_FAILURE');validateLegacyTransportTransition(owner,this.rows.get(owner)??null,expected,next);if(next)this.rows.set(owner,structuredClone(next));else this.rows.delete(owner);}
}
class Locks {
  queue=new Map();
  request(name,options,operation){
    const previous=this.queue.get(name)??Promise.resolve();
    const current=previous.catch(()=>{}).then(()=>{if(options.signal?.aborted)throw new Error('ABORTED');return operation();});
    this.queue.set(name,current);return current;
  }
}
function fixture(){const markers=new Markers(),locks=new Locks(),gate=new WebLegacyTransportGate(markers,locks);return{markers,gate,locks,fence:new WebMigrationTransportFence(gate,'owner','personal:scope',()=>{})};}
const directory=state=>({ownerId:'owner',scopeId:'personal:scope',resourceId:'owner',kind:'personal',state});
test('migration waits for the full old response and persists denial before its snapshot callback',async()=>{
  const {markers,gate,fence}=fixture(),entered=deferred(),release=deferred(),order=[];
  const old=gate.request('owner',()=>{},async()=>{entered.resolve();await release.promise;order.push('parsed-response');return 1;});
  await entered.promise;
  const migration=fence.withFence(async()=>{assert.ok(await markers.get('owner'));order.push('snapshot');});
  await Promise.resolve();assert.equal(await markers.get('owner'),null);
  release.resolve();assert.equal(await old,1);await migration;assert.deepEqual(order,['parsed-response','snapshot']);
  await assert.rejects(gate.request('owner',()=>{},async()=>assert.fail('new socket')),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  assert.equal(await gate.request('other',()=>{},async()=>2),2);
});
test('failure and a new controller retain the marker; unavailable storage never reaches IO or capture',async()=>{
  const {markers,locks,gate,fence}=fixture();
  await assert.rejects(fence.withFence(async()=>{throw new Error('SYNTHETIC_INTERRUPTION');}),/SYNTHETIC_INTERRUPTION/);
  const reopened=new WebLegacyTransportGate(markers,locks);
  await assert.rejects(reopened.request('owner',()=>{},async()=>assert.fail('late IO')),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  markers.fail=true;
  await assert.rejects(gate.request('free',()=>{},async()=>assert.fail('fallback IO')),/SYNTHETIC_STORAGE_FAILURE/);
  await assert.rejects(fence.withFence(async()=>assert.fail('capture before commit')),/SYNTHETIC_STORAGE_FAILURE/);
});
test('fresh cancellation status, exact token/scope and irreversible active markers are mandatory',async()=>{
  const {gate,markers,fence}=fixture();await fence.withFence(async()=>{});const token=await fence.token();
  const cancelled=async()=>({phase:'cancelled',pending:null,resuming:null});
  for(const status of [{phase:'uploading',pending:null,resuming:null},{phase:'cancelled',pending:{},resuming:null},{phase:'cancelled',pending:null,resuming:{}}])
    await assert.rejects(fence.releaseCancelled(token,directory('preparing'),async()=>status),/E2EE_LOCAL_DOWNGRADE_FORBIDDEN/);
  await assert.rejects(fence.releaseCancelled('wrong-token',directory('preparing'),cancelled),/E2EE_LOCAL_DOWNGRADE_FORBIDDEN/);
  await fence.releaseCancelled(token,directory('preparing'),cancelled);
  assert.equal(await gate.request('owner',()=>{},async()=>1),1);
  await fence.withFence(async()=>{});assert.notEqual(await fence.token(),token);await fence.activate(directory('active'));
  await assert.rejects(fence.releaseCancelled(await fence.token(),directory('preparing'),cancelled),/E2EE_LOCAL_DOWNGRADE_FORBIDDEN/);
  const row=await markers.get('owner');
  await assert.rejects(markers.commit('owner',row,null),/E2EE_LOCAL_DOWNGRADE_FORBIDDEN/);
  await assert.rejects(markers.commit('owner',row,{...row,phase:'preparing'}),/E2EE_LOCAL_DOWNGRADE_FORBIDDEN/);
  const wrong=new WebMigrationTransportFence(gate,'owner','other-scope',()=>{});
  await assert.rejects(wrong.withFence(async()=>assert.fail()),/E2EE_SCOPE_BINDING_MISMATCH/);
});
test('queued account changes and aborts cannot start a new private request',async()=>{
  const {gate,fence}=fixture(),entered=deferred(),release=deferred();let current=true;
  const held=gate.request('owner',()=>{},async()=>{entered.resolve();await release.promise;});await entered.promise;
  const waiting=gate.request('owner',()=>{if(!current)throw new Error('E2EE_ACCOUNT_CHANGED');},async()=>assert.fail('old account IO'));
  const rejected=assert.rejects(waiting,/E2EE_ACCOUNT_CHANGED/);current=false;release.resolve();await held;await rejected;
  const abort=new AbortController();abort.abort();
  await assert.rejects(gate.request('owner',()=>{},async()=>assert.fail('aborted IO'),abort.signal),/ABORTED/);
  assert.throws(()=>new WebLegacyTransportGate(new Markers(),null),/E2EE_BROWSER_LOCKS_REQUIRED/);
  await fence.withFence(async()=>{});
});

test('a complete operation borrows its permit for IO while migration waits, then commits locally before capture',{timeout:3000},async()=>{
  const markers=new Markers(),locks=new FixtureLockManager(),gate=new WebLegacyTransportGate(markers,locks);
  const fence=new WebMigrationTransportFence(gate,'owner','personal:scope',()=>{}),entered=deferred(),resume=deferred(),order=[];
  let permit;
  const editing=gate.withOperation('owner',()=>{},async borrowed=>{
    permit=borrowed;entered.resolve();await resume.promise;order.push('encrypted');
    await gate.borrow(borrowed,'owner',()=>{},async()=>{order.push('IO parsed');});
    gate.assertOperation(borrowed,'owner');order.push('local commit');
  });
  await entered.promise;
  const migrating=fence.withFence(async()=>{order.push('snapshot');});
  for(let n=0;n<20&&(await locks.query()).pending.length===0;n++)await new Promise(resolve=>setImmediate(resolve));
  assert.ok((await locks.query()).pending.length);resume.resolve();await editing;await migrating;
  assert.deepEqual(order,['encrypted','IO parsed','local commit','snapshot']);
  await assert.rejects(gate.borrow(permit,'owner',()=>{},async()=>assert.fail('expired IO')),/E2EE_INVALID_LEGACY_OPERATION/);
});

test('borrowed permits cannot be forged, moved to another owner or used by another gate',async()=>{
  const markers=new Markers(),locks=new FixtureLockManager(),gate=new WebLegacyTransportGate(markers,locks),other=new WebLegacyTransportGate(markers,locks);
  await gate.withOperation('owner',()=>{},async permit=>{
    for(const [target,token,owner]of [[gate,{},'owner'],[gate,permit,'other'],[other,permit,'owner']])
      await assert.rejects(target.borrow(token,owner,()=>{},async()=>assert.fail('invalid IO')),/E2EE_INVALID_LEGACY_OPERATION/);
  });
});

test('an unawaited child is rejected and drained before an exclusive migration may capture',{timeout:3000},async()=>{
  const markers=new Markers(),locks=new FixtureLockManager(),gate=new WebLegacyTransportGate(markers,locks);
  const fence=new WebMigrationTransportFence(gate,'owner','personal:scope',()=>{}),entered=deferred(),release=deferred();
  let child;
  const editing=gate.withOperation('owner',()=>{},async permit=>{
    child=gate.borrow(permit,'owner',()=>{},async()=>{entered.resolve();await release.promise;return true;}).catch(error=>error);
    await entered.promise;
  });
  const rejected=assert.rejects(editing,/E2EE_UNAWAITED_LEGACY_OPERATION/);await entered.promise;
  const migration=fence.withFence(async()=>{});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(await markers.get('owner'),null);
  release.resolve();await rejected;assert.match((await child).message,/E2EE_INVALID_LEGACY_OPERATION/);await migration;
});
