import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage,cloudSyncClient} from './helpers/cloud-sync-client.mjs';
const {PersonalAuroraSource}=calendarModule('app/e2ee/aurora-source.ts');
const {newSession,freezeContext}=calendarModule('app/aurora/session.ts');
const {recordField}=calendarModule('app/aurora/context.ts');
const {issueForecast}=calendarModule('app/aurora/forecast.ts');
const {calculateModel}=calendarModule('app/aurora/model.ts');
const policy=calendarModule('app/aurora/draw-policy.ts');
const NOW='2026-11-05T09:00:00Z',prefix='genesis-aurora-workspace-v1:owner:';
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)),decode=value=>JSON.parse(new TextDecoder().decode(value));
const empty=()=>({version:1,ownerId:'owner',sessions:[],removed:[]});
const doc=id=>({...empty(),sessions:[newSession({id,ownerId:'owner',now:NOW,timezone:'Europe/Moscow',primary:policy.snapshotFromSavedDraw({id:'source',seed:123,day:'2026-11-05',createdAt:NOW,cards:policy.expectedSourceDraw(123)})})]});
async function fixture(initial=empty()){
 const raw=crypto.getRandomValues(new Uint8Array(32)),rawKey=Buffer.from(raw).toString('base64'),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt']);raw.fill(0);
 const storage=new MemoryStorage(),memory={ownerId:'owner',legacyKey:rawKey,generation:0,reconciliationRequired:false,current:null};
 const seal=async(value,scope)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('genesis-mindmap-v1:owner:'+scope)},key,bytes(value));
  return{iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(ciphertext).toString('base64')};};
 const remote={protocol:1,ownerId:'owner',scopeId:'personal:owner',migrationId:context.migrationId,fence:context.fence,sourceHash:context.sourceHash,legacyGeneration:0,
  checkpointHash:'A'.repeat(43),directoryRevision:1,legacyKey:{keyMode:'account',key:rawKey},workspace:{...await seal(initial,'aurora-workspace:v1'),revision:1,updatedAt:NOW},results:[]};
 let calls=0,protectedCopy=false,open=true;
 const source=new PersonalAuroraSource('owner','personal:owner',{storage,memory:()=>memory,assertCurrent:()=>{if(!open)throw new Error('SESSION_CHANGED');},legacyAurora:async actual=>{
  assert.ok(protectedCopy);assert.deepEqual(actual,context);calls++;return structuredClone(remote);
 }});
 return{source,storage,memory,remote,rawKey,seal,get calls(){return calls;},lock(){open=false;},
  async capture(){const value=await source.captureLocal();protectedCopy=true;return value;},
  async run(previous=[]){return source.reconcile(await this.capture(),previous,context);},
  async pending(document,base=empty(),key=prefix+'pending'){
   storage.setItem(key,JSON.stringify({envelope:{...await seal(document,'aurora-workspace:v1'),expectedRevision:0},base:await seal(base,'aurora-workspace-base:v1')}));
  }};
}
test('actual Aurora capture retains all unmounted writer bytes before network and excludes another owner',async()=>{
 const f=await fixture(doc('server')),writer=crypto.randomUUID();
 const older=doc('local');older.sessions[0].observationNote='An older private draft';await f.pending(older,empty(),`${prefix}pending:writer:${writer}:1:pending`);
 const later=structuredClone(older);later.sessions[0].observationNote='The latest private draft';await f.pending(later,empty(),`${prefix}pending:writer:${writer}:2:pending`);
 f.storage.setItem('genesis-aurora-workspace-v1:foreign:pending','FOREIGN PRIVATE COPY');
 const before=[...f.storage.data],snapshot=await f.capture();assert.equal(f.calls,0);assert.deepEqual([...f.storage.data],before);assert.ok(!new TextDecoder().decode(snapshot).includes('FOREIGN PRIVATE COPY'));
 const result=await f.source.reconcile(snapshot,[],context);assert.equal(result.complete,true);assert.equal(f.calls,1);
 const main=decode(result.content.find(row=>row.objectId==='personal-aurora-workspace-v1').bytes);
 assert.deepEqual(new Set(main.document.sessions.map(row=>row.id)),new Set(['server','local']));assert.equal(main.document.sessions.find(row=>row.id==='local').observationNote,'The latest private draft');
 const history=decode(result.content.find(row=>row.objectId==='personal-aurora-local-history-v1').bytes);assert.equal(history.snapshots.length,2);assert.equal(history.snapshots[0].document.sessions[0].observationNote,'An older private draft');
 assert.ok(!JSON.stringify(result.content.map(row=>decode(row.bytes))).includes(f.rawKey));assert.deepEqual([...f.storage.data],before);
});
test('a remote deletion stays deleted while its old local original remains recoverable history',async()=>{
 const original=doc('deleted'),remote={...empty(),removed:[{id:'deleted',removedAt:NOW}]},f=await fixture(remote);
 await f.pending(original,original);const result=await f.run(),main=decode(result.content[0].bytes);
 assert.equal(main.document.sessions.length,0);assert.equal(main.document.removed[0].id,'deleted');
 assert.equal(decode(result.content[1].bytes).snapshots[0].document.sessions[0].id,'deleted');
});
test('an older accepted cache remains a portable historical copy without resurrecting remotely deleted work',async()=>{
 const original=doc('old-cache'),f=await fixture({...empty(),removed:[{id:'old-cache',removedAt:NOW}]});
 f.storage.setItem(prefix+'cache',JSON.stringify({...await f.seal(original,'aurora-workspace:v1'),revision:1}));
 const result=await f.run();assert.equal(decode(result.content[0].bytes).document.sessions.length,0);
 assert.equal(decode(result.content.find(row=>row.objectId==='personal-aurora-local-history-v1').bytes).cache.document.sessions[0].id,'old-cache');
});
test('two genuine same-session edits block migration and leave both originals untouched',async()=>{
 const base=doc('conflict'),remote=structuredClone(base),local=structuredClone(base);remote.sessions[0].observationNote='Server branch';local.sessions[0].observationNote='Local branch';
 const f=await fixture(remote);await f.pending(local,base);const before=[...f.storage.data];
 await assert.rejects(f.run(),/E2EE_AURORA_CONFLICT_REVIEW_REQUIRED/);assert.deepEqual([...f.storage.data],before);
});
test('mounted memory participates through its actual repository base and cannot replace a future remote head',async()=>{
 const f=await fixture(doc('server'));f.memory.current={document:doc('mounted'),base:empty(),revision:0};
 assert.deepEqual(new Set(decode((await f.run()).content[0].bytes).document.sessions.map(row=>row.id)),new Set(['server','mounted']));
 f.memory.current.revision=2;await assert.rejects(f.run(),/E2EE_AURORA_REMOTE_ROLLBACK/);
});
test('all owner, generation, session, malformed and missing-key failures preserve the source',async()=>{
 for(const [field,value] of Object.entries({ownerId:'foreign',scopeId:'personal:foreign',migrationId:'other',fence:1,sourceHash:'B'.repeat(43)})){
  const f=await fixture();f.remote[field]=value;await assert.rejects(f.run(),/E2EE_SCOPE_BINDING_MISMATCH/);
 }
 const generation=await fixture();generation.remote.legacyGeneration=1;await assert.rejects(generation.run(),/GENERATION_REVIEW_REQUIRED/);
 const pendingReset=await fixture();pendingReset.memory.reconciliationRequired=true;await assert.rejects(pendingReset.run(),/GENERATION_REVIEW_REQUIRED/);assert.equal(pendingReset.calls,0);
 const locked=await fixture();const snapshot=await locked.capture();locked.lock();await assert.rejects(locked.source.reconcile(snapshot,[],context),/SESSION_CHANGED/);
 const missing=await fixture();missing.memory.legacyKey='';missing.remote.legacyKey={keyMode:'client',key:null};await assert.rejects(missing.run(),/E2EE_LEGACY_KEY_UNAVAILABLE/);
 const malformed=await fixture();malformed.storage.setItem(prefix+'pending','{damaged');await assert.rejects(malformed.run(),/E2EE_AURORA_SOURCE_INVALID/);assert.equal(malformed.storage.getItem(prefix+'pending'),'{damaged');
 const tamper=await fixture();tamper.remote.workspace.iv=Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64');await assert.rejects(tamper.run(),/E2EE_LEGACY_AURORA_CORRUPT/);
});
test('changed prior attempts are held for history review instead of being silently merged into current data',async()=>{
 const f=await fixture();await f.pending(doc('earlier'));const previous=await f.capture();f.storage.removeItem(prefix+'pending');
 await assert.rejects(f.run([previous]),/E2EE_AURORA_HISTORY_REVIEW_REQUIRED/);assert.equal(f.calls,0);assert.ok(decode(previous).entries.some(row=>row.key===prefix+'pending'));
});
async function preparedResult(f){
 const document=doc('issued'),s=document.sessions[0];
 for(const [field,value]of Object.entries({direct_evidence:false,info_access:true,repetition_known:false,phase_known:true,horizon_basis:'Согласованный срок в учебном примере.',context_confirmed:true,outcome_not_known:true,event_description:'Учебный вопрос ещё не получил ответа.'}))
  s.context=recordField(s.context,{id:field,field,value,exactUserText:String(value),kind:'reported_event',confirmed:true,beforeInterpretation:true});
 const snapshot=await freezeContext(s,'context',NOW),forecast=await issueForecast({id:'issued-forecast',now:NOW,profile:s.context,primary:s.primary,model:calculateModel(s.primary,s.context,null),contextSnapshotId:snapshot.id,temporalId:null,sectorId:'east',horizon:{mode:'absolute',start:NOW,end:'2026-11-12T09:00:00Z',timezone:'Europe/Moscow'},targetEvent:'Ответственный пришлёт содержательный ответ.',successCriterion:'В ответе приведено применимое правило.',failureCriterion:'Содержательный ответ за период отсутствует.',conditions:['Передан согласованный запрос.'],conditionDeadline:'2026-11-06T09:00:00Z',selectedScenarioId:'east-information-onset',actions:[]});
 s.contextSnapshots=[snapshot];s.forecasts=[forecast];
 const id=crypto.randomUUID(),solution={version:1,modelVersion:'aurora-two-circles-v2',contextHash:snapshot.hash,forecastHashes:[forecast.payloadHash],forecasts:[forecast],organon:null,actionIds:[]};
 const manifest={id,methodVersion:solution.modelVersion,contextHash:snapshot.hash,forecastHashes:[forecast.payloadHash],...await f.seal(solution,'aurora-result:v1:'+id)};
 s.preparedResults=[manifest];s.resultId=id;
 return{document,manifest,solution};
}
test('unsent inline and server-wrapped immutable results become portable new-root content without old keys or payment authority',async()=>{
 for(const server of [false,true]){
  const f=await fixture(),p=await preparedResult(f);await f.pending(p.document);
  if(server){const solutionJson=JSON.stringify({kind:'aurora-encrypted-solution-v1',forecastHashes:p.manifest.forecastHashes,contextHash:p.manifest.contextHash,iv:p.manifest.iv,ciphertext:p.manifest.ciphertext});
   f.remote.results=[{id:p.manifest.id,methodVersion:p.manifest.methodVersion,solutionJson,resultHash:createHash('sha256').update(p.manifest.methodVersion+':'+solutionJson).digest('hex'),createdAt:NOW}];}
  const result=await f.run(),copy=decode(result.content.find(row=>row.objectId==='aurora-result:'+p.manifest.id).bytes);
  assert.deepEqual(copy.solution,p.solution);assert.equal(copy.ownerId,'owner');assert.ok(!JSON.stringify(result.content.map(row=>decode(row.bytes))).includes(f.rawKey));
  assert.deepEqual(decode(result.content[0].bytes).resultIds,[p.manifest.id]);assert.equal(copy.entitlement,undefined);assert.equal(copy.orders,undefined);
 }
});
test('unknown historical result formats and altered signed legacy bytes cannot be called empty or complete',async()=>{
 const f=await fixture();f.remote.results=[{id:crypto.randomUUID(),methodVersion:'future-model-v99',solutionJson:JSON.stringify({answer:'Preserve this private historical content'}),resultHash:'0'.repeat(64),createdAt:NOW}];
 await assert.rejects(f.run(),/E2EE_LEGACY_AURORA_CORRUPT/);
 f.remote.results[0].resultHash=createHash('sha256').update(f.remote.results[0].methodVersion+':'+f.remote.results[0].solutionJson).digest('hex');
 await assert.rejects(f.run(),/E2EE_AURORA_RESULT_REVIEW_REQUIRED/);
});
test('cloud factory captures the actual mounted repository and persistent journals without network or mutation',async()=>{
 const tab=await cloudSyncClient({withPersonalRepositories:true}),repo=new tab.repositories.aurora.AuroraRepository(tab.userId,tab.storage,tab.client.personalDocumentAccess(tab.userId));
 const current=tab.repositories.aurora.emptyAuroraDocument(tab.userId),before=[...tab.storage.data],calls=tab.requests.length;
 const source=await tab.client.createPersonalAuroraMigrationSource(tab.userId,'personal:'+tab.userId,{legacyAurora:()=>{throw new Error('Premature source IO');}},()=>repo.captureMigrationState(current));
 const snapshot=decode(await source.captureLocal());assert.equal(snapshot.memory.current.revision,0);assert.equal(snapshot.memory.current.document.ownerId,tab.userId);
 assert.deepEqual([...tab.storage.data],before);assert.equal(tab.requests.length,calls);
});
