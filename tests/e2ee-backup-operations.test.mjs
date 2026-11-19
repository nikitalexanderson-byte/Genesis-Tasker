import assert from 'node:assert/strict';
import test from 'node:test';
import {cloudSyncClient,deferred} from './helpers/cloud-sync-client.mjs';
import {WebLegacyTransportGate,WebMigrationTransportFence,validateLegacyTransportTransition} from '../app/e2ee/legacy-transport-fence.ts';
const observed=promise=>promise.then(value=>({value}),error=>({error}));
function fence(tab){
 const markers={get:async owner=>tab.legacyMarkers.get(owner)??null,commit:async(owner,expected,next)=>{
  validateLegacyTransportTransition(owner,tab.legacyMarkers.get(owner)??null,expected,next);
  if(next)tab.legacyMarkers.set(owner,next);else tab.legacyMarkers.delete(owner);
 }};
 return new WebMigrationTransportFence(new WebLegacyTransportGate(markers,tab.navigator.locks),tab.userId,`personal:${tab.userId}`,()=>{});
}
async function fixture(){
 const tab=await cloudSyncClient({withBackups:true}),base={
  authorizeBackup:tab.backups.device.authorizeBackup,freezeBackupDevice:owner=>tab.backups.device.freezeBackupDevice(owner,tab.storage),
  materializeDeviceBackup:tab.backups.device.materializeDeviceBackup,materializeServerBackup:tab.backups.device.materializeServerBackup,
  retainBackupSafety:tab.backups.device.retainBackupSafety,prepareBackupRestore:tab.backups.restore.prepareBackupRestore,
  backupRequest:tab.client.backupRequest,backupNeedsReconciliation:tab.client.backupNeedsReconciliation,
  captureAccountSessionGuard:tab.client.captureAccountSessionGuard,holdBackupStaleChanges:tab.client.holdBackupStaleChanges,
  download:async()=>{},restart:()=>{},
 };
 tab.backups.sources.registerBackupSource('workspace',{owner:tab.userId,capture:()=>({tasks:[{id:'unsent',title:'Original only good copy'}]})});
 return{tab,base,run:action=>tab.backups.operations.withWebBackupRuntime(tab.userId,base,action)};
}

test('actual web backup runtime holds capture, safety crypto, borrowed HTTP, download and final history ahead of migration',{timeout:8000},async()=>{
 const {tab,base,run}=await fixture(),held=tab.holdCrypto('encrypt');let captured=false,downloaded=false,networkAfterCapture=false;
 base.freezeBackupDevice=owner=>{captured=true;return tab.backups.device.freezeBackupDevice(owner,tab.storage);};base.download=async()=>{downloaded=true;};
 tab.respond((url,init)=>{assert.equal(new URL(url).pathname,'/api/backup/v1/authorize');assert.equal(new Headers(init.headers).get('X-Genesis-Account-Id'),tab.userId);networkAfterCapture=captured;return Response.json({ownerId:tab.userId,generation:0});});
 const history=`genesis-backup-history-v1:${tab.userId}`,job=run(async runtime=>{
  const source=await runtime.freezeBackupDevice(tab.userId);await runtime.retainBackupSafety(source);await runtime.authorizeBackup();
  const payload=await runtime.materializeDeviceBackup(source);assert.equal(payload.sections[0].data.document.tasks[0].title,'Original only good copy');
  await runtime.download('synthetic independent encrypted file',payload.backupId);tab.storage.setItem(history,'final receipt');
 });
 await held.entered;let final;const migration=fence(tab).withFence(async()=>{final=tab.storage.getItem(history);assert.equal(downloaded,true);});
 held.release();await job;await migration;assert.equal(final,'final receipt');assert.equal(networkAfterCapture,true);assert.equal(tab.requests.length,1);
 const safety=[...tab.storage.data].find(([key])=>key.startsWith('genesis-backup-safety-v1:'));assert.ok(safety);assert.equal(safety[1].includes('Original only good copy'),false);
});

test('current restore and personal document IO borrow the same backup permit behind a waiting migration',{timeout:8000},async()=>{
 const {tab}=await fixture(),entered=deferred(),release=deferred();let calls=0;
 tab.respond(url=>new URL(url).pathname==='/api/bootstrap'?Response.json({user:{uid:tab.userId,authProvider:'google',dataGeneration:0},csrf:'fixture-csrf',tasks:[],deletedTaskIds:[],taskLists:[],workspace:{key:tab.key,keyMode:'account',envelope:null}}):Response.json({tasks:[]}));
 await tab.client.loadGenesisWorkspace();tab.requests.length=0;
 tab.respond(async url=>{calls++;const path=new URL(url).pathname;
  if(path==='/api/backup/v1/authorize'){entered.resolve();await release.promise;return Response.json({ownerId:tab.userId});}
  if(path==='/api/workspace')return Response.json({workspace:{envelope:null}});
  if(path==='/api/recovered-tasks')return Response.json({tasks:[]});
  if(path==='/api/diary')return Response.json({notes:[]});throw new Error('Unexpected backup request');
 });
 const job=tab.client.withBackupOperation(tab.userId,async ports=>{
  await ports.request('/authorize',{});assert.equal((await ports.current()).version,0);assert.deepEqual([...(await ports.access.request('/diary')).notes],[]);
  const encrypted=await ports.access.seal({original:'private'},'backup-device-safety:v1');assert.equal((await ports.access.open(encrypted,'backup-device-safety:v1')).original,'private');
 });
 await entered.promise;const migration=fence(tab).withFence(async()=>{assert.equal(calls,4);});release.resolve();await job;await migration;
});

for(const phase of ['preparing','active'])test('web backup '+phase+' fence refuses before source capture, crypto, file or HTTP',async()=>{
 const {tab,base,run}=await fixture();let captures=0,downloads=0;base.freezeBackupDevice=()=>{captures++;throw new Error('Must not capture');};base.download=()=>{downloads++;};
 tab.legacyMarkers.set(tab.userId,{protocol:1,ownerId:tab.userId,scopeId:`personal:${tab.userId}`,phase,token:crypto.randomUUID()});const before=[...tab.storage.data];
 await assert.rejects(run(async runtime=>{await runtime.freezeBackupDevice(tab.userId);await runtime.authorizeBackup();}),/E2EE_LOCAL_LEGACY_TRANSPORT_FORBIDDEN/);
 assert.equal(captures,0);assert.equal(downloads,0);assert.equal(tab.requests.length,0);assert.deepEqual([...tab.storage.data],before);
});

test('retained backup ports expire and cannot become another action or another owner',async()=>{
 const {tab,run}=await fixture();let retained;await run(async runtime=>{retained=runtime;});const before=[...tab.storage.data];
 for(const action of [()=>retained.authorizeBackup(),()=>retained.freezeBackupDevice(tab.userId),()=>retained.holdBackupStaleChanges(tab.userId),
  ()=>retained.captureAccountSessionGuard()(),()=>retained.restart(),()=>retained.backupRequest('/status'),()=>retained.download('old selected data','original')])await assert.rejects(async()=>action(),/E2EE_INVALID_LEGACY_OPERATION/);
 await assert.rejects(run(async runtime=>runtime.freezeBackupDevice('foreign-owner')),/E2EE_SCOPE_BINDING_MISMATCH/);
 assert.deepEqual([...tab.storage.data],before);assert.equal(tab.requests.length,0);
});

test('logout and same-owner login during safety crypto cannot publish a late protected copy',{timeout:8000},async()=>{
 const {tab,run}=await fixture(),held=tab.holdCrypto('encrypt');const job=observed(run(async runtime=>{const frozen=await runtime.freezeBackupDevice(tab.userId);await runtime.retainBackupSafety(frozen);}));
 await held.entered;
 tab.respond(()=>Response.json({user:null,csrf:'fixture-csrf'}));await tab.client.loadGenesisSession();
 tab.respond(()=>Response.json({user:{uid:tab.userId},csrf:'fixture-csrf',loginId:'new-backup-login'}));await tab.client.loadGenesisSession();held.release();
 assert.ok((await job).error);assert.equal([...tab.storage.data.keys()].some(key=>key.startsWith('genesis-backup-safety-v1:')),false);
});

test('unawaited backup HTTP invalidates and drains before releasing the migration lock',{timeout:8000},async()=>{
 const {tab}=await fixture(),entered=deferred(),release=deferred();let child,done=false,captured=false;
 tab.respond(async()=>{entered.resolve();await release.promise;return Response.json({generation:0});});
 const job=observed(tab.client.withBackupOperation(tab.userId,async ports=>{child=observed(ports.request('/status'));await entered.promise;})).then(value=>{done=true;return value;});
 await entered.promise;const migration=fence(tab).withFence(async()=>{captured=true;});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(done,false);assert.equal(captured,false);
 release.resolve();assert.match((await job).error.message,/E2EE_UNAWAITED_LEGACY_OPERATION/);await child;await migration;assert.equal(captured,true);
});

test('unawaited backup crypto is drained and cannot publish after the parent returns',{timeout:8000},async()=>{
 const {tab}=await fixture(),held=tab.holdCrypto('encrypt');let child,done=false,captured=false;
 const job=observed(tab.client.withBackupOperation(tab.userId,async ports=>{child=observed(ports.access.seal({private:'old copy'},'backup-device-safety:v1'));await held.entered;})).then(value=>{done=true;return value;});
 await held.entered;const migration=fence(tab).withFence(async()=>{captured=true;});await new Promise(resolve=>setTimeout(resolve,20));assert.equal(done,false);assert.equal(captured,false);
 held.release();assert.match((await job).error.message,/E2EE_UNAWAITED_LEGACY_OPERATION/);assert.match((await child).error.message,/E2EE_INVALID_LEGACY_OPERATION/);await migration;
});

test('restart is deferred until successful operation cleanup and cancelled on a failed job',async()=>{
 const {base,run}=await fixture(),events=[];base.restart=()=>events.push('restart');
 await run(async runtime=>{runtime.restart();events.push('last receipt');assert.deepEqual(events,['last receipt']);});assert.deepEqual(events,['last receipt','restart']);
 await assert.rejects(run(async runtime=>{runtime.restart();throw new Error('original failure');}),/original failure/);assert.deepEqual(events,['last receipt','restart']);
});
