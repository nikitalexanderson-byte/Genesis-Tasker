import test from 'node:test';
import assert from 'node:assert/strict';
import {cloudSyncClient,MemoryStorage,deferred} from './helpers/cloud-sync-client.mjs';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {WebLegacyTransportGate,WebMigrationTransportFence,validateLegacyTransportTransition} from '../app/e2ee/legacy-transport-fence.ts';

const {newMindmap}=calendarModule('app/mindmaps-model.ts');
const view={mode:'map',collapsed:[],focus:null,zoom:1};
const empty=()=>({version:1,works:[],removed:[]});
const plain=value=>JSON.parse(JSON.stringify(value));
const response=(value,status=200)=>Response.json(value,{status});
const observed=promise=>promise.then(value=>({value}),error=>({error}));
// Match the browser's key enumeration as well as Storage.key()/length. The VM
// fixture still executes the real repository, API, WebCrypto and lock policy.
function browserStorage(){
  return new Proxy(new MemoryStorage(),{
    ownKeys:target=>[...target.data.keys()],
    getOwnPropertyDescriptor:(target,key)=>target.data.has(key)?{configurable:true,enumerable:true,value:target.getItem(key)}:undefined,
  });
}
function fence(tab){
  const markers={get:async owner=>tab.legacyMarkers.get(owner)??null,commit:async(owner,expected,next)=>{
    validateLegacyTransportTransition(owner,tab.legacyMarkers.get(owner)??null,expected,next);
    if(next)tab.legacyMarkers.set(owner,next);else tab.legacyMarkers.delete(owner);
  }};
  return new WebMigrationTransportFence(new WebLegacyTransportGate(markers,tab.navigator.locks),tab.userId,`personal:${tab.userId}`,()=>{});
}
const entries=storage=>[...storage.data.entries()].sort(([a],[b])=>a.localeCompare(b));
async function maps(shared=false){
  const tab=await cloudSyncClient({storage:browserStorage(),withMindmaps:true});
  const repo=new tab.mindmaps.MindmapRepository(tab.userId,shared?'shared-space':undefined);
  const map=newMindmap('Synthetic private map');
  return {tab,repo,map,prefix:shared?`genesis-shared-mindmaps:${tab.userId}:shared-space:`:`genesis-mindmaps:${tab.userId}:`};
}
async function restoration(){
  const tab=await cloudSyncClient({withPersonalRepositories:true});
  const repo=new tab.repositories.restoration.RestorationRepository(tab.userId,tab.storage,tab.client.personalDocumentAccess(tab.userId));
  return {tab,repo,key:`genesis-stoicheion-workspace-v1:${tab.userId}:pending`};
}
async function aurora(){
  const tab=await cloudSyncClient({withPersonalRepositories:true});
  const {AuroraRepository,emptyAuroraDocument}=tab.repositories.aurora;
  return {tab,repo:new AuroraRepository(tab.userId,tab.storage,tab.client.personalDocumentAccess(tab.userId)),
    document:emptyAuroraDocument(tab.userId),key:`genesis-aurora-workspace-v1:${tab.userId}:pending`};
}

test('migration between immediate map staging and network upload captures the complete encrypted draft',{timeout:8000},async()=>{
  const {tab,repo,map,prefix}=await maps(),held=tab.holdCrypto('encrypt');
  const saving=observed(repo.save(map,()=>{}));await held.entered;
  let captured;const migration=fence(tab).withFence(async()=>{captured=entries(tab.storage);});
  held.release();await migration;assert.match((await saving).error.message,/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  const drafts=captured.filter(([key])=>key.startsWith(prefix+'draft:'));
  assert.equal(drafts.length,1);assert.equal(captured.some(([key])=>key.startsWith(prefix+'request:')),false);
  assert.deepEqual(plain(await tab.client.personalDocumentAccess(tab.userId).open(JSON.parse(drafts[0][1]),`map:${map.id}`)),plain(map));
  assert.equal(JSON.stringify(captured).includes(map.title),false);assert.equal(tab.requests.length,0);
});

for(const shared of [false,true])test(`${shared?'shared':'personal'} map permit includes response encryption and acknowledgment cleanup`,{timeout:8000},async()=>{
  const {tab,repo,map,prefix}=await maps(shared),entered=deferred(),release=deferred();
  tab.respond(async(url,init)=>{
    assert.equal(new URL(url).pathname,shared?`/api/shared/spaces/shared-space/mindmaps/${map.id}`:`/api/mindmaps/${map.id}`);
    assert.equal(new Headers(init.headers).get('X-Genesis-Account-Id'),tab.userId);
    assert.equal(init.method,'PUT');entered.resolve();await release.promise;return response({revision:1});
  });
  const saving=repo.save(map,()=>{});await entered.promise;
  let captured;const migration=fence(tab).withFence(async()=>{captured=entries(tab.storage);});
  release.resolve();await saving;await migration;
  assert.equal(captured.some(([key])=>key.startsWith(prefix+'draft:')||key.startsWith(prefix+'request:')),false);
  assert.equal(JSON.parse(tab.storage.getItem(prefix+'cache'))[0].revision,1);
  const before=entries(tab.storage),calls=tab.requests.length;
  for(const action of [()=>repo.list(),()=>repo.save(map,()=>{}),()=>repo.view(map.id),()=>repo.saveView(map.id,view),
    ()=>repo.journal({mapId:map.id,nodeId:map.nodes[0].id,taskId:'task'}),()=>repo.conversions(map),()=>repo.history(map.id),
    ()=>repo.retry({document:map,revision:1,updatedAt:''},()=>{}),()=>repo.remove({document:map,revision:1,updatedAt:''})]){
    await assert.rejects(action(),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  }
  assert.deepEqual(entries(tab.storage),before);assert.equal(tab.requests.length,calls);
});

test('a second map edit is encrypted durably while an earlier network write is still slow',{timeout:8000},async()=>{
  const {tab,repo,map,prefix}=await maps(),entered=deferred(),release=deferred(),durable=deferred();let count=0;
  tab.respond(async(_url,init)=>{count++;if(count===1){entered.resolve();await release.promise;}return response({revision:JSON.parse(init.body).expectedRevision+1});});
  const first=repo.save(map,()=>{});await entered.promise;
  const newer={...map,title:'A newer encrypted draft'},second=repo.save(newer,state=>{if(state==='device')durable.resolve();});await durable.promise;
  const [key]=Object.keys(tab.storage).filter(key=>key.startsWith(prefix+'draft:'));
  assert.equal((await tab.client.personalDocumentAccess(tab.userId).open(JSON.parse(tab.storage.getItem(key)),`map:${map.id}`)).title,newer.title);
  release.resolve();await first;await second;assert.equal(count,2);
  assert.equal(JSON.parse(tab.storage.getItem(prefix+'cache'))[0].revision,2);assert.equal(tab.storage.getItem(key),null);
});

test('view and removal queues never hold a permit while waiting behind migration',{timeout:8000},async()=>{
  const {tab,repo,map,prefix}=await maps(),held=tab.holdCrypto('encrypt');
  const first=repo.saveView(map.id,view);await held.entered;
  const migration=fence(tab).withFence(async()=>{});
  const second=observed(repo.saveView(map.id,{...view,zoom:2}));
  const removing=observed(repo.remove({document:map,revision:1,updatedAt:''}));
  held.release();await first;await migration;
  assert.match((await second).error.message,/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  assert.match((await removing).error.message,/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  const raw=tab.storage.getItem(prefix+`view:${map.id}`);assert.ok(raw);assert.equal(tab.requests.length,0);
  assert.equal((await tab.client.personalDocumentAccess(tab.userId).open(JSON.parse(raw),`view:${map.id}`)).zoom,1);
});

test('lost map acknowledgments replay the exact receipt after reload',{timeout:8000},async()=>{
  const {tab,repo,map,prefix}=await maps(),bodies=[];let remote=null,lost=true;
  tab.respond(async(_url,init)=>{
    if(init.method!=='PUT')return response({maps:remote?[remote]:[]});
    bodies.push(init.body);const body=JSON.parse(init.body);
    remote={...body,id:map.id,revision:1,updatedAt:'2026-11-18T00:00:00Z'};
    if(lost){lost=false;throw new TypeError('Synthetic lost acknowledgment');}return response({revision:1});
  });
  await assert.rejects(repo.save(map,()=>{}));const fresh=new tab.mindmaps.MindmapRepository(tab.userId);
  const record=(await fresh.list()).find(row=>row.draftKey);assert.equal(record.document.title,map.title);
  await fresh.retry(record,()=>{});assert.equal(bodies.length,2);assert.equal(bodies[0],bodies[1]);
  assert.equal(Object.keys(tab.storage).some(key=>key.startsWith(prefix+'draft:')||key.startsWith(prefix+'request:')),false);
});

test('malformed map receipts and closed editor responses cannot delete the encrypted draft',{timeout:8000},async()=>{
  const {tab,repo,map,prefix}=await maps();tab.respond(async()=>response({revision:0}));
  await assert.rejects(repo.save(map,()=>{}),/MINDMAP_INVALID_RESPONSE/);
  const before=entries(tab.storage).filter(([key])=>key.startsWith(prefix+'draft:')||key.startsWith(prefix+'request:'));
  assert.equal(before.length,2);
  const entered=deferred(),release=deferred();tab.respond(async()=>{entered.resolve();await release.promise;return response({revision:1});});
  const draftKey=before.find(([key])=>key.startsWith(prefix+'draft:'))[0];
  const retry=observed(repo.retry({document:map,revision:0,updatedAt:'',draftKey},()=>{}));
  await entered.promise;repo.dispose();release.resolve();assert.match((await retry).error.message,/Сессия карт закрыта/);
  assert.deepEqual(entries(tab.storage).filter(([key])=>key.startsWith(prefix+'draft:')||key.startsWith(prefix+'request:')),before);
});

test('retry cleanup cannot delete a newer map draft or immutable request from its original editor',{timeout:8000},async()=>{
  const {tab,repo,map,prefix}=await maps();tab.respond(async()=>{throw new TypeError('Synthetic offline');});
  await assert.rejects(repo.save(map,()=>{}));
  const draftKey=Object.keys(tab.storage).find(key=>key.startsWith(prefix+'draft:')),requestKey=draftKey.replace(':draft:',':request:');
  const access=tab.client.personalDocumentAccess(tab.userId),next=JSON.stringify({...await access.seal({...map,title:'Newer editor work'},`map:${map.id}`),schemaVersion:2,expectedRevision:1,operationId:crypto.randomUUID()});
  tab.respond(async()=>{tab.storage.setItem(draftKey,next);tab.storage.setItem(requestKey,next);return response({revision:1});});
  await repo.retry({document:map,revision:0,updatedAt:'',draftKey},()=>{});
  assert.equal(tab.storage.getItem(draftKey),next);assert.equal(tab.storage.getItem(requestKey),next);
});

test('storage exhaustion prevents an unjournaled map upload',{timeout:8000},async()=>{
  const {tab,repo,map}=await maps();tab.storage.setItem=()=>{throw new Error('Synthetic quota');};
  await assert.rejects(repo.save(map,()=>{}),/Synthetic quota/);assert.equal(tab.requests.length,0);
});

test('restoration migration waits for local encryption, borrowed IO, decrypt and cleanup',{timeout:8000},async()=>{
  const {tab,repo,key}=await restoration(),held=tab.holdCrypto('encrypt');
  tab.respond(async(_url,init)=>response({revision:JSON.parse(init.body).expectedRevision+1}));
  const saving=repo.save(empty());await held.entered;let captured;
  const migration=fence(tab).withFence(async()=>{captured=tab.storage.getItem(key);});
  held.release();await saving;await migration;assert.equal(captured,null);assert.equal(tab.requests.length,1);
  const before=entries(tab.storage);
  for(const action of [()=>repo.load(),()=>repo.save(empty()),()=>repo.keepPending()])await assert.rejects(action(),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  assert.deepEqual(entries(tab.storage),before);assert.equal(tab.requests.length,1);
});

test('restoration conflict merge uses the held operation, even with an exclusive migration waiting',{timeout:8000},async()=>{
  const {tab,repo,key}=await restoration(),access=tab.client.personalDocumentAccess(tab.userId);
  const remote={...await access.seal(empty(),'stoicheion-workspace:v1'),revision:1},entered=deferred(),release=deferred();let writes=0;
  tab.respond(async(_url,init)=>{
    if(init.method!=='PUT')return response({document:remote});
    if(++writes===1){entered.resolve();await release.promise;return response({error:'RESTORATION_REVISION_CONFLICT'},409);}
    assert.equal(JSON.parse(init.body).expectedRevision,1);return response({revision:2});
  });
  const saving=repo.save(empty());await entered.promise;const migration=fence(tab).withFence(async()=>{assert.equal(tab.storage.getItem(key),null);});
  release.resolve();await saving;await migration;assert.equal(writes,2);
});

test('a restoration acknowledgment leaves a different pending envelope persisted by another tab',{timeout:8000},async()=>{
  const {tab,repo,key}=await restoration(),entered=deferred(),release=deferred();
  tab.respond(async()=>{entered.resolve();await release.promise;return response({revision:1});});
  const saving=repo.save(empty());await entered.promise;
  const access=tab.client.personalDocumentAccess(tab.userId),next=JSON.stringify({envelope:{...await access.seal(empty(),'stoicheion-workspace:v1'),expectedRevision:1},base:await access.seal(empty(),'stoicheion-pending-base:v1')});
  tab.storage.setItem(key,next);release.resolve();await saving;assert.equal(tab.storage.getItem(key),next);
});

test('a malformed restoration receipt cannot remove a pending copy',{timeout:8000},async()=>{
  const {tab,repo,key}=await restoration();tab.respond(async()=>response({revision:7}));
  await assert.rejects(repo.save(empty()),/RESTORATION_INVALID_RESPONSE/);assert.ok(tab.storage.getItem(key));
});

test('Aurora migration waits for the full operation and every later public entry point is fenced',{timeout:8000},async()=>{
  const {tab,repo,document,key}=await aurora(),held=tab.holdCrypto('encrypt');
  tab.respond(async(_url,init)=>response({revision:JSON.parse(init.body).expectedRevision+1}));
  const saving=repo.save(document);await held.entered;
  const migration=fence(tab).withFence(async()=>{assert.equal(tab.storage.getItem(key),null);});
  held.release();await saving;await migration;const before=entries(tab.storage);
  for(const action of [()=>repo.load(),()=>repo.save(document),()=>repo.conflictVersions(),()=>repo.recoverAsCopy({},'2026-11-18T00:00:00Z')]){
    await assert.rejects(action(),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
  }
  assert.deepEqual(entries(tab.storage),before);assert.equal(tab.requests.length,1);
});

test('Aurora conflict retry borrows its operation while a migration is queued',{timeout:8000},async()=>{
  const {tab,repo,document,key}=await aurora(),access=tab.client.personalDocumentAccess(tab.userId);
  const remote={...await access.seal(document,'aurora-workspace:v1'),revision:1},entered=deferred(),release=deferred();let writes=0;
  tab.respond(async(_url,init)=>{
    if(init.method!=='PUT')return response({document:remote});
    if(++writes===1){entered.resolve();await release.promise;return response({error:'AURORA_REVISION_CONFLICT'},409);}
    assert.equal(JSON.parse(init.body).expectedRevision,1);return response({revision:2});
  });
  const saving=repo.save(document);await entered.promise;
  const migration=fence(tab).withFence(async()=>{assert.equal(tab.storage.getItem(key),null);});
  release.resolve();await saving;await migration;assert.equal(writes,2);
});

test('Aurora malformed receipts fail without pretending an offline save or clearing pending bytes',{timeout:8000},async()=>{
  const {tab,repo,document,key}=await aurora();tab.respond(async()=>response({revision:0}));
  await assert.rejects(repo.save(document),/AURORA_INVALID_RESPONSE/);assert.ok(tab.storage.getItem(key));assert.notEqual(repo.syncState,'offline');
});

test('Aurora late acknowledgment cannot clear a newer pending document from another tab',{timeout:8000},async()=>{
  const {tab,repo,document,key}=await aurora(),entered=deferred(),release=deferred();
  tab.respond(async()=>{entered.resolve();await release.promise;return response({revision:1});});
  const saving=repo.save(document);await entered.promise;
  const access=tab.client.personalDocumentAccess(tab.userId),next=JSON.stringify({envelope:{...await access.seal(document,'aurora-workspace:v1'),expectedRevision:1},base:await access.seal(document,'aurora-workspace-base:v1')});
  tab.storage.setItem(key,next);release.resolve();await saving;assert.equal(tab.storage.getItem(key),next);
});

for(const feature of ['aurora','restoration'])test(`${feature} changed session during a pending response preserves work`,{timeout:8000},async()=>{
  const f=await (feature==='aurora'?aurora():restoration()),{tab,repo,key}=f;
  const entered=deferred(),release=deferred();
  tab.respond(async()=>{entered.resolve();await release.promise;return response({revision:1});});
  const saving=observed(repo.save(f.document??empty()));await entered.promise;const before=tab.storage.getItem(key);assert.ok(before);
  tab.respond(async url=>{assert.equal(new URL(url).pathname,'/api/session');return response({user:null,csrf:'synthetic'});});
  try {await tab.client.loadGenesisSession();} finally {release.resolve();}
  assert.ok((await saving).error);
  assert.equal(tab.storage.getItem(key),before);
});
