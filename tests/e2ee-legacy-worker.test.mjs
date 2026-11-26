import assert from 'node:assert/strict';
import {test} from 'node:test';
import {legacyWorkerGuard,legacyWorkerBackground,installLegacyTransportWorker,LEGACY_WORKER_STATUS} from '../app/e2ee/legacy-worker.ts';
import {requireLegacyTransportWorker} from '../app/e2ee/legacy-worker-client.ts';
import {WebLegacyTransportGate,WebMigrationTransportFence,validateLegacyTransportTransition,LEGACY_UNBOUND_TRANSPORT_LOCK} from '../app/e2ee/legacy-transport-fence.ts';
const deferred=()=>{let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};};
class Locks {
  queue=new Map();calls=[];
  request(name,options,operation){this.calls.push({name,...options});const current=(this.queue.get(name)??Promise.resolve()).catch(()=>{}).then(operation);this.queue.set(name,current);return current;}
}
class Markers {
  rows=new Map();fail=false;
  async get(owner){if(this.fail)throw Error('synthetic storage failure');return this.rows.get(owner)??null;}
  async any(){if(this.fail)throw Error('synthetic storage failure');return this.rows.size>0;}
  async commit(owner,expected,next){validateLegacyTransportTransition(owner,this.rows.get(owner)??null,expected,next);if(next)this.rows.set(owner,next);else this.rows.delete(owner);}
}
function fixture(fetch=async()=>new Response('{"synthetic":true}',{headers:{'Content-Type':'application/json'}}),responseLimit){
  const locks=new Locks(),markers=new Markers(),calls=[];
  const guard=legacyWorkerGuard({origin:'https://worker.invalid',apiPrefix:'/calendar/api/',locks,markers:()=>markers,
    fetch:async request=>{calls.push(request);return fetch(request);},responseLimit});
  const request=(path='/workspace',init={})=>new Request('https://worker.invalid/calendar/api'+path,init);
  return{locks,markers,calls,guard,request};
}
test('an unidentified old response holds the global permit until all bytes arrive, before migration capture',async()=>{
  const entered=deferred();let stream;
  const {locks,markers,calls,guard,request}=fixture(async()=>new Response(new ReadableStream({start(controller){stream=controller;controller.enqueue(new TextEncoder().encode('{"old":'));entered.resolve();}}),
    {headers:{'Content-Type':'application/json','Content-Encoding':'gzip','Content-Length':'99'}}));
  const old=guard(request());await entered.promise;
  const fence=new WebMigrationTransportFence(new WebLegacyTransportGate(markers,locks),'owner','personal:owner',()=>{});let captured=false;
  const migration=fence.withFence(async()=>{captured=true;});await new Promise(setImmediate);
  assert.equal(captured,false);assert.equal(await markers.get('owner'),null);
  stream.enqueue(new TextEncoder().encode('true}'));stream.close();const response=await old;
  assert.deepEqual(await response.json(),{old:true});assert.equal(response.headers.get('Content-Encoding'),null);assert.equal(response.headers.get('Content-Length'),null);
  await migration;assert.equal(captured,true);
  assert.equal(locks.calls[0].name,LEGACY_UNBOUND_TRANSPORT_LOCK);assert.equal(locks.calls[0].mode,'shared');
  const denied=await guard(request());assert.equal(denied.status,409);assert.equal((await denied.json()).error,'E2EE_UPGRADE_REQUIRED');assert.equal(calls.length,1);
});
test('identified current clients never take a nested owner lock and never read another owner marker as a grant',async()=>{
  const {guard,request,markers,locks,calls}=fixture();markers.rows.set('blocked',{protocol:1,ownerId:'blocked',scopeId:'personal:blocked',phase:'preparing',token:'token'});
  assert.equal((await guard(request('/workspace',{headers:{'X-Genesis-Account-Id':'blocked'}}))).status,409);assert.equal(calls.length,0);
  assert.equal((await guard(request('/workspace',{headers:{'X-Genesis-Account-Id':'other'}}))).status,200);
  assert.equal(calls[0].cache,'no-store');assert.equal(locks.calls.length,0);
});
test('private and unknown preferences are blocked; technical metadata, identity, billing and E2EE remain separate',async()=>{
  const {guard,request,markers,calls}=fixture();markers.rows.set('owner',{protocol:1,ownerId:'owner',scopeId:'scope',phase:'active',token:'token'});
  for(const body of ['{"uiLayout":{"synthetic":true}}','{"unknown":"private"}','{','{"uiLayout":"'+'x'.repeat(70000)+'"}']) {
    const response=await guard(request('/account/preferences',{method:'PUT',body}));assert.equal(response.status,409);
  }
  assert.equal(calls.length,0);
  for(const [path,init] of [['/account/preferences',{method:'PUT',body:'{"language":"en"}'}],['/session',{}],['/billing/orders',{}],['/e2ee/v1/status',{}]])
    assert.equal((await guard(request(path,init))).status,200);
  assert.equal(calls.length,4);
});

test('old pages cannot upload private counts or activity through the worker after the personal fence',async()=>{
 const {guard,request,markers,calls}=fixture();
 assert.equal((await guard(request('/metrics',{method:'POST',headers:{'X-Genesis-Account-Id':'owner'},body:'{"metrics":{"taskCount":3}}'}))).status,200);
 assert.equal(calls.length,1);markers.rows.set('owner',{protocol:1,ownerId:'owner',scopeId:'personal:owner',phase:'active',token:'token'});
 for(const path of ['/metrics','/metrics/','/feature-usage','/feature-usage/'])for(const headers of [{},{'X-Genesis-Account-Id':'owner'}]){
  assert.equal((await guard(request(path,{method:'POST',headers,body:'{"private-marker":"retained"}'}))).status,409);
 }
 assert.equal(calls.length,1,'No private body reaches the fetch port after activation');
});
test('storage and missing-lock failures do not forward private bytes; incomplete responses never become success',async()=>{
  const {guard,request,markers,calls}=fixture();markers.fail=true;
  for(const headers of [{},{'X-Genesis-Account-Id':'owner'}])assert.equal((await guard(request('/workspace',{headers}))).status,503);
  assert.equal(calls.length,0);
  const noLocks=legacyWorkerGuard({origin:'https://worker.invalid',apiPrefix:'/calendar/api/',markers:()=>markers,fetch:async()=>assert.fail('fallback socket')});
  assert.equal((await noLocks(request())).status,503);
  const large=fixture(async()=>new Response('private-too-large'),8);
  const denied=await large.guard(large.request());assert.equal(denied.status,409);assert.equal((await denied.json()).error,'E2EE_LEGACY_RESPONSE_TOO_LARGE');
  const broken=fixture(async()=>new Response(new ReadableStream({start(controller){controller.error(Error('synthetic connection lost'));}})));
  const interrupted=await broken.guard(broken.request());assert.equal(interrupted.status,503);assert.equal((await interrupted.json()).error,'E2EE_NETWORK_INTERRUPTED');
  const fragmentBytes=new TextEncoder().encode(JSON.stringify({synthetic:'a'.repeat(9000)}));let cursor=0;
  const fragmented=fixture(async()=>new Response(new ReadableStream({pull(controller){if(cursor===fragmentBytes.length)controller.close();else controller.enqueue(fragmentBytes.slice(cursor,++cursor));}})));
  const complete=await fragmented.guard(fragmented.request());assert.equal(complete.status,200);assert.equal((await complete.json()).synthetic.length,9000);
});
test('worker status opens no key/storage database and does not claim an unavailable lock API',()=>{
  for(const supported of [true,false]) {
    let listener,reply;const handler=installLegacyTransportWorker({location:{origin:'https://worker.invalid'},registration:{scope:'https://worker.invalid/calendar/'},
      navigator:{locks:supported?new Locks():undefined},addEventListener(type,callback){assert.equal(type,'message');listener=callback;}});
    listener({data:{type:LEGACY_WORKER_STATUS},ports:[{postMessage(value){reply=value;}}]});assert.equal(reply.protocol,supported?1:0);
    handler.completeBackgroundInstall();listener({data:{type:LEGACY_WORKER_STATUS},ports:[{postMessage(value){reply=value;}}]});assert.equal(reply.protocol,supported?2:0);
    assert.equal(handler.handles(new Request('https://worker.invalid/calendar/api/workspace')),true);
    assert.equal(handler.handles(new Request('https://worker.invalid/calendar/api/account/preferences',{method:'PUT',body:'{}'})),true);
    for(const path of ['auth/google/start','e2ee/v1/status','billing/orders','shared/messenger/devices'])
      assert.equal(handler.handles(new Request('https://worker.invalid/calendar/api/'+path)),false);
  }
});
test('a new imported transport module cannot certify old main-worker notification handlers as background-safe',()=>{
 let listener,reply;const handler=installLegacyTransportWorker({location:{origin:'https://worker.invalid'},registration:{scope:'https://worker.invalid/calendar/'},
  navigator:{locks:new Locks()},addEventListener(_type,callback){listener=callback;}});
 const status=()=>{listener({data:{type:LEGACY_WORKER_STATUS},ports:[{postMessage(value){reply=value;}}]});return reply.protocol;};
 assert.equal(status(),1);handler.completeBackgroundInstall();assert.equal(status(),2);
});
test('product migration preflight requires the same current worker to explicitly acknowledge the protocol',async()=>{
  await assert.rejects(requireLegacyTransportWorker({controller:null}),/E2EE_SERVICE_WORKER_REQUIRED/);
  for(const protocol of [0,1,2]) {
    const container={controller:{postMessage(_message,ports){ports[0].postMessage({type:LEGACY_WORKER_STATUS,protocol});}}};
    if(protocol===2)await requireLegacyTransportWorker(container);else await assert.rejects(requireLegacyTransportWorker(container),/E2EE_WORKER_UPGRADE_REQUIRED/);
  }
  const changed={controller:{postMessage(_message,ports){changed.controller={};ports[0].postMessage({type:LEGACY_WORKER_STATUS,protocol:1});}}};
  await assert.rejects(requireLegacyTransportWorker(changed),/E2EE_WORKER_UPGRADE_REQUIRED/);
  const {locks,markers}=fixture();const fence=new WebMigrationTransportFence(new WebLegacyTransportGate(markers,locks),'owner','scope',()=>{},async()=>{throw Error('E2EE_WORKER_UPGRADE_REQUIRED');});
  await assert.rejects(fence.withFence(async()=>assert.fail('unsafe capture')),/E2EE_WORKER_UPGRADE_REQUIRED/);
  assert.equal(locks.calls.length,0);assert.equal(await markers.get('owner'),null);
});
test('background cache/display work drains before preparation and is denied after a durable marker',async()=>{
 const {locks,markers}=fixture(),entered=deferred(),release=deferred();let captured=false,writes=0;
 const old=legacyWorkerBackground({locks,markers:()=>markers},async()=>{entered.resolve();await release.promise;writes++;});await entered.promise;
 const fence=new WebMigrationTransportFence(new WebLegacyTransportGate(markers,locks),'owner','personal:owner',()=>{});
 const migration=fence.withFence(async()=>{captured=true;assert.equal(writes,1);});await new Promise(setImmediate);assert.equal(captured,false);
 release.resolve();await Promise.all([old,migration]);assert.equal(captured,true);
 await assert.rejects(legacyWorkerBackground({locks,markers:()=>markers},async()=>{writes++;}),/LEGACY_TRANSPORT_FORBIDDEN/);assert.equal(writes,1);
 await assert.rejects(legacyWorkerBackground({markers:()=>markers},async()=>assert.fail('no-lock fallback')),/BROWSER_LOCKS_REQUIRED/);
});
test('an admitted owner receipt borrows its permit while migration waits; later unidentified work stays blocked',async()=>{
 const {locks,markers}=fixture(),gate=new WebLegacyTransportGate(markers,locks),entered=deferred(),release=deferred();let received=false,late=false;
 const page=gate.withOperation('owner',()=>{},async()=>{entered.resolve();await release.promise;
  await legacyWorkerBackground({locks,markers:()=>markers},async()=>{received=true;},'owner');});await entered.promise;
 const fence=new WebMigrationTransportFence(gate,'owner','personal:owner',()=>{}),migration=fence.withFence(async()=>assert.equal(received,true));await new Promise(setImmediate);
 const unknown=legacyWorkerBackground({locks,markers:()=>markers},async()=>{late=true;});const refused=assert.rejects(unknown,/LEGACY_TRANSPORT_FORBIDDEN/);
 release.resolve();await Promise.all([page,migration,refused]);assert.equal(late,false);
});
