import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';

const ok=value=>new Response(JSON.stringify(value),{headers:{'Content-Type':'application/json'}});
const session=uid=>({user:uid?{uid}:null,csrf:'fixture-csrf',loginId:`fixture-login:${uid??'anonymous'}`});

test('a cached workspace key permits offline encryption, but cannot authorize private HTTP',async()=>{
  const fixture=await cloudSyncClient({authenticated:false});
  const access=fixture.client.personalDocumentAccess(fixture.userId);
  const sealed=await access.seal({body:'retained offline draft'},'note:offline');
  assert.equal((await access.open(sealed,'note:offline')).body,'retained offline draft');
  await assert.rejects(access.request('/diary'),/E2EE_ACCOUNT_BINDING_REQUIRED/);
  assert.equal(fixture.requests.length,0);
});

test('a verified change of account retires old capabilities and preserves all durable sources',async()=>{
  const fixture=await cloudSyncClient();
  fixture.storage.setItem(`genesis-diary-v1:${fixture.userId}:draft`,'original encrypted bytes');
  const access=fixture.client.personalDocumentAccess(fixture.userId),guard=fixture.client.captureAccountSessionGuard();
  const original=[...fixture.storage.data.entries()];
  fixture.respond(()=>ok(session('another-owner')));
  const checks=await Promise.all(Array.from({length:4},()=>fixture.client.loadGenesisSession()));
  assert.deepEqual(checks.map(user=>user.uid),Array(4).fill('another-owner'));
  assert.equal(fixture.requests.length,1,'Coalesced checks must publish a single identity transition');
  assert.throws(guard,/AUTH_REQUIRED/);
  assert.throws(access.check);
  await assert.rejects(access.request('/diary'),/AUTH_REQUIRED|Разблокируйте/);
  await assert.rejects(access.seal({body:'old editor'},'note:old'));
  await assert.rejects(fixture.client.saveCloudTask(fixture.userId,{id:'old-task',title:'old bytes'}));
  assert.equal(fixture.requests.length,1,'Old private content must not be sent under the new owner');
  for(const [key,value]of original)if(key!=='genesis-local-login-id-v1')assert.equal(fixture.storage.getItem(key),value,key);
  assert.equal(fixture.client.restoreOfflineWorkspaceSession(fixture.userId),false,'A live owner cannot open another owner cache');
});

test('a null session retires capabilities even if the same owner signs in again later',async()=>{
  const fixture=await cloudSyncClient(),old=fixture.client.personalDocumentAccess(fixture.userId);
  fixture.respond(()=>ok(session(null)));assert.equal(await fixture.client.loadGenesisSession(),null);
  fixture.respond(()=>ok(session(fixture.userId)));assert.equal((await fixture.client.loadGenesisSession()).uid,fixture.userId);
  assert.equal(fixture.client.restoreOfflineWorkspaceSession(fixture.userId),true);
  assert.throws(old.check,/AUTH_REQUIRED/);
  fixture.client.personalDocumentAccess(fixture.userId).check();
});

test('a malformed session cannot publish a new owner or invalidate the previous verified owner',async()=>{
  const fixture=await cloudSyncClient(),access=fixture.client.personalDocumentAccess(fixture.userId);
  fixture.respond(()=>ok({user:{uid:'unvalidated-owner'},csrf:''}));
  await assert.rejects(fixture.client.loadGenesisSession(),{name:'SessionResponseError'});
  access.check();fixture.requests.length=0;
  fixture.respond(()=>ok({notes:[]}));await access.request('/diary');
  assert.equal(fixture.requests[0].init.headers['X-Genesis-Account-Id'],fixture.userId);
});

test('an old in-flight private response cannot commit after a verified identity transition',async()=>{
  const fixture=await cloudSyncClient(),access=fixture.client.personalDocumentAccess(fixture.userId),pending=deferred(),entered=deferred();
  fixture.respond(url=>{if(url.endsWith('/session'))return ok(session('another-owner'));entered.resolve();return pending.promise;});
  const reading=access.request('/diary').then(value=>({value}),error=>({error}));await entered.promise;
  assert.equal((await fixture.client.loadGenesisSession()).uid,'another-owner');
  pending.resolve(ok({notes:[{id:'old-note'}]}));const result=await reading;
  assert.equal(result.value,undefined);assert.ok(result.error);
  assert.equal(fixture.requests[0].init.signal.aborted,true);
});

test('an unexpected owner in a non-session response cannot silently authorize a new account',async()=>{
  const fixture=await cloudSyncClient(),guard=fixture.client.captureAccountSessionGuard();
  fixture.respond(()=>ok({user:{uid:'another-owner'}}));
  await assert.rejects(fixture.client.createBillingTrial('standart'),/E2EE_ACCOUNT_CHANGED/);
  assert.throws(guard,/AUTH_REQUIRED/);
  const count=fixture.requests.length;
  await assert.rejects(fixture.client.saveCloudTask(fixture.userId,{id:'task',title:'old bytes'}));
  assert.equal(fixture.requests.length,count);
});

test('a validated identity change retires old editors even when its new login receipt cannot be stored',async()=>{
  const fixture=await cloudSyncClient(),access=fixture.client.personalDocumentAccess(fixture.userId),guard=fixture.client.captureAccountSessionGuard();
  const original=[...fixture.storage.data.entries()],save=fixture.storage.setItem.bind(fixture.storage);
  fixture.storage.setItem=(key,value)=>{if(key==='genesis-local-login-id-v1')throw new DOMException('Storage full','QuotaExceededError');save(key,value);};
  fixture.respond(()=>ok(session('another-owner')));
  await assert.rejects(fixture.client.loadGenesisSession());
  assert.throws(guard,/AUTH_REQUIRED/);assert.throws(access.check,/AUTH_REQUIRED/);
  const count=fixture.requests.length;
  await assert.rejects(access.request('/diary'));
  assert.equal(fixture.requests.length,count,'No old-owner data can leave after the validated account change');
  for(const [key,value]of original)assert.equal(fixture.storage.getItem(key),value,key);
});

test('an owner mismatch in a private response retires its editor before another operation',async()=>{
  const fixture=await cloudSyncClient(),access=fixture.client.personalDocumentAccess(fixture.userId),guard=fixture.client.captureAccountSessionGuard();
  fixture.respond(()=>ok({user:{uid:'another-owner'},notes:[]}));
  await assert.rejects(access.request('/diary'),/E2EE_ACCOUNT_CHANGED/);
  assert.throws(guard,/AUTH_REQUIRED/);assert.throws(access.check,/AUTH_REQUIRED/);
});
