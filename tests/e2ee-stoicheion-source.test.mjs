import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
import {MemoryStorage,cloudSyncClient} from './helpers/cloud-sync-client.mjs';
const {PersonalStoicheionSource}=calendarModule('app/e2ee/stoicheion-source.ts');
const {validateRestorationDocument}=calendarModule('app/stoicheion-restoration-work.ts');
const NOW='2026-10-22T09:00:00Z',prefix='genesis-stoicheion-workspace-v1:owner:';
const context={ownerId:'owner',scopeId:'personal:owner',migrationId:'migration',fence:7,sourceHash:'A'.repeat(43),generation:2};
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)),decode=value=>JSON.parse(new TextDecoder().decode(value));
const empty=()=>({version:1,works:[],removed:[]});
const doc=(note='A synthetic private reflection')=>{const value=JSON.parse(readFileSync('tests/fixtures/e2ee/stoicheion-content-v1.json','utf8'));assert.equal(value.synthetic,true);value.document.works[0].snapshot.reflection=note;return value.document;};
const draw=(kind='spread')=>({kind,dayKey:'2026-10-22',seed:123,attempts:2,firstDrawAt:NOW,rerollDeadline:NOW,remainingSeconds:0,canReroll:true,unlimited:true});
async function fixture(initial=empty()){
 const raw=crypto.getRandomValues(new Uint8Array(32)),rawKey=Buffer.from(raw).toString('base64'),key=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);raw.fill(0);
 const storage=new MemoryStorage(),memory={ownerId:'owner',legacyKey:rawKey,generation:0,reconciliationRequired:false,current:null,draws:[],timeline:null,nativeDraws:null};
 const seal=async(value,purpose)=>{const iv=crypto.getRandomValues(new Uint8Array(12)),cipher=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('genesis-mindmap-v1:owner:'+purpose)},key,bytes(value));return{iv:Buffer.from(iv).toString('base64'),ciphertext:Buffer.from(cipher).toString('base64')};};
 const remote={protocol:1,ownerId:'owner',scopeId:context.scopeId,migrationId:context.migrationId,fence:7,sourceHash:context.sourceHash,legacyGeneration:0,checkpointHash:'A'.repeat(43),directoryRevision:1,
  legacyKey:{keyMode:'account',key:rawKey},workspace:{...await seal(initial,'stoicheion-workspace:v1'),revision:1,updatedAt:NOW},draws:[],spreadCards:[],timelineSessions:[],timelineWindows:[]};
 let calls=0,captured=false,live=true;
 const ports={storage,memory:()=>memory,assertCurrent:()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');},legacyStoicheion:async actual=>{assert.ok(captured);assert.deepEqual(actual,context);calls++;return structuredClone(remote);}};
 const source=new PersonalStoicheionSource('owner',context.scopeId,ports);
 return{source,storage,memory,remote,rawKey,key,seal,ports,get calls(){return calls;},lock(){live=false;},async capture(){const value=await source.captureLocal();captured=true;return value;},
  async run(previous=[]){return source.reconcile(await this.capture(),previous,context);},
  async pending(document,base=empty(),key=prefix+'pending'){storage.setItem(key,JSON.stringify({envelope:{...await seal(document,'stoicheion-workspace:v1'),expectedRevision:0},base:await seal(base,'stoicheion-pending-base:v1')}));}};
}
test('actual unmounted journals capture before IO, retain all old writer copies, exclude foreign/guest stores and remove authority from portable content',async()=>{
 assert.deepEqual(validateRestorationDocument(doc()),doc());const f=await fixture();
 const writer=prefix+'pending:writer:11111111-1111-4111-8111-111111111111:';await f.pending(doc('older private reflection'),empty(),writer+'1:pending');await f.pending(doc('newer private reflection'),empty(),writer+'2:pending');
 f.storage.setItem('genesis-stoicheion-workspace-v1:foreign:pending','FOREIGN PRIVATE CONTENT');f.storage.setItem('genesis-stoicheion-draws-v2:2026-10-22','UNATTRIBUTED GUEST DRAW');
 f.storage.setItem('genesis-stoicheion-draws-v2:timeline:reveal:owner:2026-10-22:123:2','2');f.memory.draws=[draw()];
 const before=[...f.storage.data],snapshot=await f.capture();assert.equal(f.calls,0);assert.ok(!new TextDecoder().decode(snapshot).includes('FOREIGN PRIVATE'));assert.ok(!new TextDecoder().decode(snapshot).includes('UNATTRIBUTED'));
 const result=await f.source.reconcile(snapshot,[],context);assert.equal(result.complete,true);assert.equal(decode(result.content[0].bytes).document.works[0].snapshot.reflection,'newer private reflection');
 const history=decode(result.content.find(row=>row.objectId==='personal-stoicheion-local-history-v1').bytes);assert.equal(history.snapshots.length,2);assert.equal(history.snapshots[0].document.works[0].snapshot.reflection,'older private reflection');
 const draws=decode(result.content.find(row=>row.objectId==='personal-stoicheion-draw-history-v1').bytes);assert.equal(draws.device.draws[0].seed,123);assert.equal(draws.device.reveals[0].count,2);
 const portable=JSON.stringify(result.content.map(row=>decode(row.bytes)));for(const forbidden of [f.rawKey,'unlimited','canReroll','rerollDeadline','attempts'])assert.ok(!portable.includes(forbidden),forbidden);assert.deepEqual([...f.storage.data],before);
});
test('real deleted practice stays deleted while its full old reflection remains available as encrypted history',async()=>{
 const original=doc(),work=original.works[0],removed={id:work.id,createdAt:work.createdAt,updatedAt:NOW,version:2,syncState:'synced'},f=await fixture({...empty(),removed:[removed]});
 await f.pending(original,original);const result=await f.run();assert.deepEqual(decode(result.content[0].bytes).document,{...empty(),removed:[removed]});assert.equal(decode(result.content[1].bytes).snapshots[0].document.works.length,1);
});
test('real conflict, lossy old format, corrupt envelope and source rollback refuse completion without changing originals',async()=>{
 const f=await fixture(doc('server edit'));await f.pending(doc('local edit'),doc('base'));const before=[...f.storage.data];await assert.rejects(f.run(),/CONFLICT_REVIEW_REQUIRED/);assert.deepEqual([...f.storage.data],before);
 const lossy=await fixture({...doc(),unknownPrivateField:'never silently discard'});await assert.rejects(lossy.run(),/DOCUMENT_REVIEW_REQUIRED/);
 const cipher=await fixture(doc());cipher.remote.workspace.iv=Buffer.from(crypto.getRandomValues(new Uint8Array(12))).toString('base64');await assert.rejects(cipher.run(),/LEGACY_STOICHEION_CORRUPT/);
 const rollback=await fixture();await rollback.pending(doc());const pending=JSON.parse(rollback.storage.getItem(prefix+'pending'));pending.envelope.expectedRevision=2;rollback.storage.setItem(prefix+'pending',JSON.stringify(pending));await assert.rejects(rollback.run(),/REMOTE_ROLLBACK/);
});
test('mounted edits use the captured base and revision instead of overwriting the server head',async()=>{
 const f=await fixture();f.memory.current={document:doc(),base:empty(),revision:0};assert.deepEqual(decode((await f.run()).content[0].bytes).document,doc());f.memory.current.revision=2;await assert.rejects(f.run(),/REMOTE_ROLLBACK/);
});
test('unknown local formats, changed protected attempts and pending restore generations block before source IO',async()=>{
 const f=await fixture();await f.pending(doc());const old=await f.capture();f.storage.removeItem(prefix+'pending');await assert.rejects(f.run([old]),/HISTORY_REVIEW_REQUIRED/);assert.equal(f.calls,0);
 const future=await fixture();future.storage.setItem(prefix+'future-v99','retain original');await assert.rejects(future.run(),/FORMAT_UNSUPPORTED/);assert.equal(future.storage.getItem(prefix+'future-v99'),'retain original');
 const generation=await fixture();generation.memory.reconciliationRequired=true;await assert.rejects(generation.run(),/GENERATION_REVIEW_REQUIRED/);assert.equal(generation.calls,0);
 const changed=await fixture();changed.remote.legacyGeneration=1;await assert.rejects(changed.run(),/GENERATION_REVIEW_REQUIRED/);
});
test('every real server history family is validated and preserved without mixing in quotas or accepting orphan cards/windows',async()=>{
 const f=await fixture();f.remote.draws=[{kind:'spread',dayKey:'2026-10-22',seed:123,firstDrawAt:NOW,updatedAt:NOW}];
 f.remote.spreadCards=[{dayKey:'2026-10-22',sourceSeed:123,revision:1,cardsJson:'[]',updatedAt:NOW}];
 f.remote.timelineSessions=[{periodKey:'2026-10-19',dayKey:'2026-10-22',seed:456,revision:1,createdAt:NOW,updatedAt:NOW}];f.remote.timelineWindows=[{periodKey:'2026-10-19',position:0,firstRevealedAt:NOW,lastRerolledAt:null}];
 const result=await f.run(),history=decode(result.content.at(-1).bytes);assert.equal(history.server.spreadCards[0].cards.length,9);assert.deepEqual(history.server.timelineWindows,f.remote.timelineWindows);
 for(const mutate of [value=>value.draws.push(value.draws[0]),value=>value.spreadCards[0].sourceSeed=777,value=>value.timelineWindows[0].position=2,value=>value.timelineWindows[0].periodKey='2026-10-12',value=>value.draws[0].unlimited=true]){
  const before=structuredClone(f.remote);mutate(f.remote);await assert.rejects(f.run(),/INVALID/);Object.assign(f.remote,before);
 }
});
test('actual native days and timeline caches normalize to history while live privileges never become portable authority',async()=>{
 const f=await fixture();f.memory.nativeDraws={days:{'2026-10-22':{spread:{seed:123,attempts:2,firstAt:Date.parse(NOW),rerollDeadline:Date.parse(NOW),unlimited:true,serverRerollAllowed:true,cardRevision:0}}},timelineSession:{serverNow:NOW,receivedAt:Date.parse(NOW),timeline:{dayKey:'2026-10-22',periodKey:'2026-10-19',seed:456,revision:1,firstDrawAt:NOW,cards:[{position:0,firstRevealedAt:NOW,rerollDeadline:NOW,remainingSeconds:0,canReroll:true,unlimited:true,rerolled:true}]}}};
 const history=decode((await f.run()).content.at(-1).bytes);assert.equal(history.device.native.draws[0].seed,123);assert.equal(history.device.native.timeline.windows[0].wasRerolled,true);
 for(const forbidden of ['unlimited','canReroll','serverRerollAllowed','rerollDeadline','attempts'])assert.ok(!JSON.stringify(history).includes(forbidden));
});
test('native-owned decryption runs the same source without receiving legacy keys and rejects key/purpose/owner changes',async()=>{
 const f=await fixture(doc());const local=decode(await f.capture());local.memory.legacyKey='';const remote=structuredClone(f.remote);remote.legacyKey.key=null;let opens=0;
 const source=new PersonalStoicheionSource('owner',context.scopeId,{...f.ports,legacyStoicheion:async()=>remote,openLegacy:async(envelope,purpose)=>{assert.equal(purpose,'stoicheion-workspace:v1');assert.deepEqual(Object.keys(envelope).sort(),['ciphertext','iv']);opens++;
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:Buffer.from(envelope.iv,'base64'),additionalData:new TextEncoder().encode('genesis-mindmap-v1:owner:'+purpose)},f.key,Buffer.from(envelope.ciphertext,'base64'));return decode(new Uint8Array(plain));}});
 assert.deepEqual(decode((await source.reconcile(bytes(local),[],context)).content[0].bytes).document,doc());assert.equal(opens,1);
 remote.legacyKey.key=f.rawKey;await assert.rejects(source.reconcile(bytes(local),[],context),/KEY_BRIDGE_FORBIDDEN/);assert.equal(opens,1);remote.legacyKey.key=null;
 f.lock();await assert.rejects(source.reconcile(bytes(local),[],context),/ACCOUNT_CHANGED/);
});
test('authenticated factory captures the actual restoration repository without network, ACK or owner changes',async()=>{
 const tab=await cloudSyncClient({withPersonalRepositories:true}),repo=new tab.repositories.restoration.RestorationRepository(tab.userId,tab.storage,tab.client.personalDocumentAccess(tab.userId));
 const before=[...tab.storage.data],calls=tab.requests.length,source=await tab.client.createPersonalStoicheionMigrationSource(tab.userId,'personal:'+tab.userId,{legacyStoicheion:()=>{throw new Error('Premature IO');}},()=>({current:repo.captureMigrationState(doc()),draws:[],timeline:null}));
 const snapshot=decode(await source.captureLocal());assert.deepEqual(snapshot.memory.current.document,doc());assert.equal(snapshot.memory.current.revision,0);assert.deepEqual([...tab.storage.data],before);assert.equal(tab.requests.length,calls);
});
