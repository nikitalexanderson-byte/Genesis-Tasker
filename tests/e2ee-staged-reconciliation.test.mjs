import assert from 'node:assert/strict';
import test from 'node:test';
import {E2eeMigrationSources,requiredPrivatePaths} from '../app/e2ee/migration-sources.ts';
import {ProtectedSourceStage,openSourceStage} from '../app/e2ee/source-stage.ts';
import {ProtectedMigrationContentPlan,openMigrationContentPlan} from '../app/e2ee/content-plan.ts';
import {UnlockedE2eeVault} from '../app/e2ee/storage.ts';
import {generateDeviceKeys,freshSecret} from '../app/e2ee/keys.ts';
import {E2EE_SUITE,encodeE2eeBytes,importE2eeRoot} from '../app/e2ee/envelope.ts';

const context={ownerId:'owner',scopeId:'project:streamed',migrationId:'migration-streamed',fence:1,sourceHash:'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',generation:2};
function fixture(){
 const sources=new E2eeMigrationSources(context.ownerId,context.scopeId,'project'),paths=requiredPrivatePaths('project'),calls=[],target={ownerId:context.ownerId,scopeId:context.scopeId,kind:'project'};
 let live=true;const current=()=>{if(!live)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const history=id=>({id,target:{...target},paths:paths.map(row=>row.id),openPath(path){calls.push('open:'+id+':'+path);let complete=false;const bytes=new Uint8Array([id==='current'?1:2]);
  return{chunks:(async function*(){try{yield bytes;complete=true;}finally{bytes.fill(0);}})(),assertComplete(){if(!complete)throw new Error('E2EE_SOURCE_STAGE_EOF_REQUIRED');}};}});
 return{sources,paths,calls,input:{current:history('current'),previous:[history('history')]},current,retire:()=>{live=false;}};
}
async function read(input){const reader=input.open();let sum=0;for await(const bytes of reader.chunks)sum+=bytes[0];reader.assertComplete();return sum;}
function registerAll(f,replace){for(const path of f.paths)f.sources.registerStagedReconciler({id:path.id,async reconcile(input,lease,emit){
 if(replace&&await replace(path,input,lease,emit))return true;let value=await read(input.current);for(const previous of input.previous)value+=await read(previous);
 const bytes=new Uint8Array([value]);await emit({placement:'remote',domain:path.domains[0],objectId:path.id,size:1,source:(async function*(){try{yield bytes;}finally{bytes.fill(0);}})()});return true;
 }});}
test('all original current/history paths reach EOF and output is consumed one record at a time',async()=>{
 const f=fixture();registerAll(f);const values=[];
 const coverage=await f.sources.reconcileStaged(f.input,context,async(path,record)=>{let value=0;for await(const part of record.source)value+=part[0];values.push([path,record.placement,record.domain,record.objectId,value]);},f.current);
 assert.equal(values.length,6);assert.ok(values.every(row=>row[4]===3));assert.equal(f.calls.length,12);assert.deepEqual(coverage,f.paths.map(path=>({domain:path.id,complete:true})));
});
test('missing reconcilers wrong target and incomplete path inventories refuse before producer or sink',async()=>{
 const f=fixture();let emitted=0;
 await assert.rejects(f.sources.reconcileStaged(f.input,context,async()=>{emitted++;},f.current),/E2EE_/);assert.equal(f.calls.length,0);assert.equal(emitted,0);registerAll(f);
 for(const input of [{...f.input,current:{...f.input.current,target:{...f.input.current.target,ownerId:'foreign'}}},{...f.input,current:{...f.input.current,paths:f.input.current.paths.slice(1)}},
  {...f.input,previous:[f.input.current]}])await assert.rejects(f.sources.reconcileStaged(input,context,async()=>{emitted++;},f.current),/E2EE_/);
 assert.equal(f.calls.length,0);assert.equal(emitted,0);
});

test('the full reconciler plan is captured synchronously before keys sources or leases',async()=>{
 const f=fixture();assert.throws(()=>f.sources.stagedReconciliation(),/STAGED_RECONCILER_REQUIRED/);assert.equal(f.calls.length,0);
 const adapters=f.paths.map(path=>({id:path.id,async reconcile(input){await read(input.current);for(const previous of input.previous)await read(previous);return true;}}));
 for(const adapter of adapters)f.sources.registerStagedReconciler(adapter);const runner=f.sources.stagedReconciliation();
 for(const adapter of adapters)adapter.reconcile=async()=>{throw new Error('REPLACED_RECONCILER');};
 assert.equal((await runner.run(f.input,context,async()=>{},f.current)).length,6);assert.equal(f.calls.length,12);
});
test('an unopened history or a closed plaintext prefix cannot be reported complete',async()=>{
 for(const mode of ['unopened','prefix']){const f=fixture();registerAll(f,async(path,input)=>{if(path.id!==f.paths[0].id)return false;await read(input.current);
  if(mode==='prefix'){const reader=input.previous[0].open(),first=await reader.chunks.next();assert.equal(first.done,false);await reader.close();assert.ok(first.value.every(value=>value===0));}return true;});
  await assert.rejects(f.sources.reconcileStaged(f.input,context,async()=>{},f.current),/E2EE_/);
 }
});
test('producer and reader callbacks are captured before the first asynchronous sink',async()=>{
 const f=fixture();registerAll(f);let emissions=0;
 await f.sources.reconcileStaged(f.input,context,async()=>{emissions++;f.input.current.target.ownerId='changed';f.input.current.paths.length=0;f.input.current.openPath=()=>{throw new Error('REPLACED_OPEN');};},f.current);
 assert.equal(emissions,6);
});
test('late emission and sink failure cannot return complete coverage',async()=>{
 const f=fixture();let late;registerAll(f,async(path,input,lease,emit)=>{if(path.id!==f.paths[0].id)return false;await read(input.current);await read(input.previous[0]);late=emit;return true;});
 await f.sources.reconcileStaged(f.input,context,async()=>{},f.current);
 assert.throws(()=>late({placement:'remote',domain:'shared-project',objectId:'late',size:0,source:(async function*(){})()}),/E2EE_/);
 const g=fixture();registerAll(g);await assert.rejects(g.sources.reconcileStaged(g.input,context,async()=>{throw new Error('E2EE_NO_SPACE');},g.current),/NO_SPACE/);
});

test('retirement after an asynchronous factory returns closes that raw capability',async()=>{
 const f=fixture();let release,hit,closed=0;const reached=new Promise(resolve=>{hit=resolve;});
 f.input.current.openPath=async()=>{hit();await new Promise(resolve=>{release=resolve;});return{chunks:{async next(){return{done:true};},async return(){closed++;return{done:true};},[Symbol.asyncIterator](){return this;}},assertComplete(){}};};
 registerAll(f);const pending=f.sources.reconcileStaged(f.input,context,async()=>{},f.current);await reached;f.retire();release();
 await assert.rejects(pending,/ACCOUNT_CHANGED/);assert.equal(closed,1);
});

test('cleanup closes every open original and preserves the reconciliation failure',async()=>{
 const f=fixture();let closed=0;
 for(const source of [f.input.current,...f.input.previous])source.openPath=()=>({chunks:{async next(){return{done:false,value:new Uint8Array([1])};},async return(){closed++;throw new Error('CLOSE_FAILED');},[Symbol.asyncIterator](){return this;}},assertComplete(){}});
 registerAll(f,async(path,input)=>{if(path.id!==f.paths[0].id)return false;
  await input.current.open().chunks.next();await input.previous[0].open().chunks.next();throw new Error('ORIGINAL_FAILURE');});
 await assert.rejects(f.sources.reconcileStaged(f.input,context,async()=>{},f.current),/ORIGINAL_FAILURE/);assert.equal(closed,2);
});

test('a caught duplicate or concurrent output violation poisons the path',async()=>{
 for(const mode of ['duplicate','concurrent']){const f=fixture();let release,hit;const reached=new Promise(resolve=>{hit=resolve;});let emissions=0;
  const output=()=>({placement:'remote',domain:f.paths[0].domains[0],objectId:'same',size:0,source:(async function*(){})()});
  registerAll(f,async(path,input,lease,emit)=>{if(path.id!==f.paths[0].id)return false;await read(input.current);await read(input.previous[0]);
   if(mode==='duplicate'){await emit(output());assert.throws(()=>emit(output()),/INVALID_SOURCE_RESULT/);}else{
    const pending=emit(output());await reached;assert.throws(()=>emit({...output(),objectId:'second'}),/OUTPUT_BUSY/);release();await pending;
   }return true;
  });
  await assert.rejects(f.sources.reconcileStaged(f.input,context,async()=>{emissions++;if(mode==='concurrent'){hit();await new Promise(resolve=>{release=resolve;});}},f.current),/E2EE_/);
  assert.equal(emissions,1);
 }
});

test('unawaited output is settled before input closure and cannot return coverage',async()=>{
 const f=fixture();let release,hit,settled=false;const reached=new Promise(resolve=>{hit=resolve;});
 registerAll(f,async(path,input,lease,emit)=>{if(path.id!==f.paths[0].id)return false;await read(input.current);await read(input.previous[0]);
  void emit({placement:'remote',domain:path.domains[0],objectId:'pending',size:0,source:(async function*(){})()});await reached;return true;});
 const pending=f.sources.reconcileStaged(f.input,context,async()=>{hit();await new Promise(resolve=>{release=resolve;});settled=true;},f.current);
 await reached;await new Promise(resolve=>setImmediate(resolve));assert.equal(settled,false);release();await assert.rejects(pending,/OUTPUT_NOT_AWAITED/);assert.equal(settled,true);
});
test('account retirement while an original read is pending yields no borrowed plaintext',async()=>{
 const f=fixture();let release,hit;const reached=new Promise(resolve=>{hit=resolve;});f.input.current.openPath=()=>({chunks:(async function*(){hit();await new Promise(resolve=>{release=resolve;});yield new Uint8Array([7]);})(),assertComplete(){}});
 registerAll(f);let emitted=0;const pending=f.sources.reconcileStaged(f.input,context,async()=>{emitted++;},f.current);await reached;f.retire();release();await assert.rejects(pending,/ACCOUNT_CHANGED/);assert.equal(emitted,0);
});

class Memory {
 rows=new Map();
 async get(key){return structuredClone(this.rows.get(key)??null);}
 async list(prefix){return[...this.rows.keys()].filter(key=>key.startsWith(prefix));}
 async commit(changes,signal){
  if(signal?.aborted)throw new Error('E2EE_UNLOCK_REQUIRED');for(const row of changes)assert.equal(this.rows.get(row.key)?.serial??null,row.expected);
  const next=new Map(this.rows);for(const row of changes)if(row.value===null)next.delete(row.key);else next.set(row.key,structuredClone(row.value));this.rows=next;
 }
}
const digest=async bytes=>encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));
async function protectedFixture(late=false){
 const f=fixture(),storage=new Memory(),keys=await generateDeviceKeys(),raw=freshSecret(),root=await importE2eeRoot(raw);raw.fill(0);
 const scope={ownerId:'stage-actor',scopeId:'device:stage',deviceId:'stage-device',generation:1,cryptoEpoch:1,securityEpoch:1,keyId:'local-root',signingKey:keys.signing.privateKey,
  roots:new Map([['local-root',root]]),trustedSigner:id=>id==='stage-device'?keys.signing.publicKey:undefined};
 const vault=new UnlockedE2eeVault(storage,scope),target={...f.input.current.target},paths=f.paths.map(path=>path.id),histories=[],references=[],size=index=>index===0?512*1024+17:7;
 const stageOptions={vault,target,paths,capacity:{maximumBytes:8*1024*1024,maximumParts:64},ensureDurableKeys:async()=>{},assertCurrent:f.current,admit:async()=>{}};
 for(const seed of [1,2]){
  const stage=await ProtectedSourceStage.create(stageOptions);
  for(const[index,path]of f.paths.entries())await stage.capturePath(path.id,async write=>{
   for(let at=0;at<size(index);at+=65536){const bytes=new Uint8Array(Math.min(65536,size(index)-at)).fill(seed+index);try{await write(bytes);}finally{bytes.fill(0);}}
  });
  const reference=await stage.finish(),opened=await openSourceStage(vault,target,reference,f.current);references.push(reference);
  histories.push({id:reference.stageId,target,paths,openPath:id=>opened.openPath(id)});
 }
 f.input={current:histories[1],previous:[histories[0]]};const originals=structuredClone(storage.rows),lease={...context,sourceHash:await digest(new TextEncoder().encode(JSON.stringify(references)))};
 if(late){const original=f.input.previous[0].openPath;f.input.previous[0].openPath=id=>{const reader=original(id);return{assertComplete:reader.assertComplete,chunks:(async function*(){for await(const bytes of reader.chunks)yield bytes;throw new Error('E2EE_OLD_TAG_INVALID');})()};};}
 for(const[index,path]of f.paths.entries())f.sources.registerStagedReconciler({id:path.id,async reconcile(input,context,emit){
  await emit({placement:path.id.endsWith('.local-work')?'local':'remote',domain:path.domains[0],objectId:path.id,size:2*size(index),source:(async function*(){
   for(const original of [input.current,...input.previous]){const reader=original.open();try{for await(const bytes of reader.chunks)yield bytes;reader.assertComplete();}finally{await reader.close();}}
  })()});return true;
 }});
 let reconciled=false;
 const options={vault,root,signer:keys.signing.publicKey,signingKey:keys.signing.privateKey,context:{cryptoProtocol:1,suite:E2EE_SUITE,ownerId:context.ownerId,scopeId:context.scopeId,
  domain:'shared-project',objectId:'plan-context',schemaVersion:1,dataGeneration:2,writerProtocol:9,cryptoEpoch:1,securityEpoch:1,revision:1,keyId:'content-root',deviceId:scope.deviceId,operationId:crypto.randomUUID()},
  target,migrationId:lease.migrationId,sourceHash:lease.sourceHash,paths,capacity:{maximumBytes:8*1024*1024,maximumEnvelopes:128,maximumLocalParts:64},admit:async()=>{},ensureDurableKeys:async()=>{},assertCurrent:f.current,
  assertSourceComplete:async()=>{if(!reconciled)throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');}};
 return{...f,storage,scope,vault,originals,options,lease,root,keys,size,completed:()=>{reconciled=true;}};
}
test('protected originals stream through reconciliation into a cold-readable encrypted content plan',async()=>{
 const f=await protectedFixture(),plan=await ProtectedMigrationContentPlan.create(f.options),coverage=await f.sources.reconcileStaged(f.input,f.lease,(path,record)=>plan.append(path,record),f.current);
 f.completed();const reference=await plan.finish(coverage);f.vault.lock();const cold=new UnlockedE2eeVault(f.storage,f.scope),opened=await openMigrationContentPlan({...f.options,vault:cold,reference});
 assert.equal(opened.logical.length,5);assert.equal(opened.local.length,1);assert.ok(opened.plan.every(row=>row.objectId!=='project.local-work'));
 for(const[index,path]of f.paths.entries()){
  const bytes=new Uint8Array(2*f.size(index));bytes.fill(index+2,0,f.size(index));bytes.fill(index+1,f.size(index));
  const logical=[...opened.logical,...opened.local].find(row=>row.objectId===path.id);assert.ok(logical);assert.equal(logical.plaintextHash,await digest(bytes));bytes.fill(0);
 }
 for(const[key,row]of f.originals)assert.deepEqual(f.storage.rows.get(key),row);cold.lock();
});

test('a late original failure leaves encrypted plan prefixes inert and every protected source intact',async()=>{
 const f=await protectedFixture(true),plan=await ProtectedMigrationContentPlan.create(f.options);
 await assert.rejects(f.sources.reconcileStaged(f.input,f.lease,(path,record)=>plan.append(path,record),f.current),/OLD_TAG_INVALID/);
 assert.ok(f.storage.rows.size>f.originals.size);await assert.rejects(plan.finish(f.paths.map(path=>({domain:path.id,complete:true}))),/E2EE_/);
 for(const[key,row]of f.originals)assert.deepEqual(f.storage.rows.get(key),row);f.vault.lock();
});
