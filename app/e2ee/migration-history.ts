import {encodeE2eeBytes} from './envelope.ts';
import {assertTechnical} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {requiredPrivatePaths} from './private-paths.ts';
import {openLegacyMigrationSnapshot,captureLegacyMigrationSnapshotReference,type LegacyMigrationSnapshotReference} from './legacy-snapshot-stream.ts';
import {openSourceStage,inspectSourceStages,type SourceStageReference,type SourceStageTarget} from './source-stage.ts';
import {validateStagedMigrationSnapshot,verifyStagedMigrationSnapshot,type StagedMigrationSnapshot} from './migration-stage.ts';
import type {StagedPathReader,StagedSourceHistory,StagedSourceInput} from './staged-reconciliation.ts';
import type {UnlockedE2eeVault} from './storage.ts';

/** Structural view only. The coordinator supplies its existing exact state
 * decoder AFTER the original raw JSON passes the duplicate/UTF8 preflight. */
export type MigrationHistoryState={protocol:1|2|3;migrationId:string;phase:string;ancestors:string[];plan:unknown[];logical:unknown[];local?:unknown[];planned?:boolean;
 sourceHash:string|null;lease:unknown|null;pending:unknown|null;resuming:unknown|null}
 &({protocol:1|2;snapshotSize:number;snapshotParts:number;snapshotHash:string}|{protocol:3;source:StagedMigrationSnapshot});
export type MigrationHistoryAdmission=Readonly<{bytes:number;parts:number;metadataBytes:number;sources:number}>;
export type MigrationHistoryOptions={capacity:Readonly<{maximumBytes:number;maximumParts:number;maximumMetadataBytes:number}>;
 admit:(request:MigrationHistoryAdmission)=>Promise<void>;assertCurrent:()=>void};
export type MigrationHistoryReadVault=Pick<UnlockedE2eeVault,'assertUnlocked'|'localIdentity'|'read'|'listLocal'|'listMigrationOriginalParts'|'listMigrationHistoryCopies'>;
type Metadata={id:string;serial:number;hash:string};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),MAX_METADATA=4*1024*1024;
function invalid():never{throw new Error('E2EE_SOURCE_HISTORY_INVALID');}
async function digest(bytes:Uint8Array){const copy=new Uint8Array(bytes);try{return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',copy)));}finally{copy.fill(0);}}
function sameRefs(left:readonly SourceStageReference[],right:readonly SourceStageReference[]){return left.length===right.length&&left.every((ref,index)=>ref.stageId===right[index].stageId&&ref.manifestHash===right[index].manifestHash);}
function requireSourceOnly(state:MigrationHistoryState){
 if(state.planned||state.plan.length||state.logical.length||state.local?.length||[state.sourceHash,state.lease,state.pending,state.resuming].some(value=>value!==null))throw new Error('E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED');
}
async function cleanup(close:()=>Promise<void>,rejected:boolean){try{await close();}catch(error){if(!rejected)throw error;}}

/** Same-original-actor coordinator history. No key recovery/handoff, remote
 * source, plan publication or transport. Unknown legacy source prefixes REFUSE;
 * a different scope needs an authenticated locator, never an ignore-list. */
export async function openMigrationSourceHistory(input:{vault:MigrationHistoryReadVault;target:SourceStageTarget;paths:readonly string[];stateId:string;
 decode:(bytes:Uint8Array)=>MigrationHistoryState;options:MigrationHistoryOptions;
 /** State4 supplies exact reserved-role authentication, never a prefix filter.
  * Omission preserves the strict v1/v2/v3 source-only refusal. */
 inspectContentPlans?:(metadataIds:readonly string[])=>Promise<MigrationHistoryAdmission>}){
 const vault=input.vault,target={...input.target},paths=[...input.paths],stateId=input.stateId,decode=input.decode,
  capacity={...input.options.capacity},admit=input.options.admit,guard=input.options.assertCurrent;
 let closed=false,failed=false,reading=false;const active=new Set<{close:()=>Promise<void>}>(),legacy:Awaited<ReturnType<typeof openLegacyMigrationSnapshot>>[]=[],completed=new Set<string>();
 const current=()=>{guard();vault.assertUnlocked();if(closed)throw new Error('E2EE_SOURCE_HISTORY_CLOSED');};current();
 for(const limit of [capacity.maximumBytes,capacity.maximumParts,capacity.maximumMetadataBytes])if(!Number.isSafeInteger(limit)||limit<1)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
 if(capacity.maximumParts>10000||capacity.maximumMetadataBytes>128*1024*1024)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
 if(paths.length!==requiredPrivatePaths(target.kind).length||paths.some((path,index)=>path!==requiredPrivatePaths(target.kind)[index].id))throw new Error('E2EE_SOURCE_ADAPTER_REQUIRED');
 if(stateId!=='migration:'+await digest(encoder.encode(target.scopeId)))invalid();current();
 const metadata:Metadata[]=[],originals:LegacyMigrationSnapshotReference[]=[];let metadataBytes=0;
 const inspectContentPlans=input.inspectContentPlans;let derived:MigrationHistoryAdmission={bytes:0,parts:0,metadataBytes:0,sources:0};
 const readState=async(id:string,remember=true)=>{
  current();assertTechnical(id);const row=await vault.read('local-snapshot',id);
  try{
   current();if(!row||!Number.isSafeInteger(row.serial)||row.serial<1||row.value.length<1||row.value.length>MAX_METADATA)invalid();
   if(remember){metadataBytes+=row.value.length;if(metadataBytes>capacity.maximumMetadataBytes)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');}
   parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_SOURCE_HISTORY_INVALID',MAX_METADATA);
   const state=decode(row.value),hash=await digest(row.value);current();
   if(remember)metadata.push({id,serial:row.serial,hash});return{state,serial:row.serial,hash};
  }finally{row?.value.fill(0);}
 };
 const close=async()=>{
  closed=true;for(const source of legacy)source.close();
  const results=await Promise.allSettled([...active].map(reader=>reader.close()));
  const failure=results.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
 };
 try{
  const initial=await readState(stateId),state=initial.state;
  if(state.protocol!==3||state.phase!=='preparing')throw new Error('E2EE_STAGED_SOURCE_REQUIRED');
  const actor=vault.localIdentity(),snapshot=validateStagedMigrationSnapshot(state.source,target,actor,paths),refs=[...snapshot.history,snapshot.reference];
  const seen=new Set([state.migrationId]),ancestors=[...state.ancestors];
  const binding=(row:MigrationHistoryState)=>JSON.stringify([row.protocol,row.migrationId,row.ancestors,row.protocol===3?
   validateStagedMigrationSnapshot(row.source,target,actor,paths):captureLegacyMigrationSnapshotReference({migrationId:row.migrationId,snapshotSize:row.snapshotSize,snapshotParts:row.snapshotParts,snapshotHash:row.snapshotHash})]);
  const bindings=new Map([[state.migrationId,binding(state)]]);
  if(ancestors.length>32)invalid();
  for(const id of ancestors){assertTechnical(id);if(!id.endsWith(':archive'))invalid();assertTechnical(id.slice(0,-8));}
  for(const[index,id]of ancestors.entries()){
   const archived=await readState(id),old=archived.state;current();assertTechnical(old.migrationId);
   if(archived.serial!==1||id!==old.migrationId+':archive'||old.phase!=='cancelled'||seen.has(old.migrationId)||old.ancestors.length!==index||old.ancestors.some((value,at)=>value!==ancestors[at]))invalid();
   seen.add(old.migrationId);
   // A saved plan can contain the ONLY remaining copy of a remote original.
   // This source-only capability must not silently classify it as disposable.
   requireSourceOnly(old);bindings.set(old.migrationId,binding(old));
   if(old.protocol===3){
    const source=validateStagedMigrationSnapshot(old.source,target,actor,paths),declared=[...source.history,source.reference],at=refs.findIndex(ref=>ref.stageId===source.reference.stageId);
    if(at<0||!sameRefs(declared,refs.slice(0,at+1)))invalid();
   }else originals.push(captureLegacyMigrationSnapshotReference({migrationId:old.migrationId,snapshotSize:old.snapshotSize,snapshotParts:old.snapshotParts,snapshotHash:old.snapshotHash}));
  }
  // Check ALL locator roles before opening any corresponding cancellation body.
  // Copies precede cancellation and therefore need not have phase=cancelled.
  const copies=(await vault.listMigrationHistoryCopies()).sort();current();
  const counts=new Map<string,number>(),cancelled:{id:string;migrationId:string}[]=[];
  for(const id of copies){
   if(ancestors.includes(id))continue;
   const at=id.lastIndexOf(':cancel:'),migrationId=id.slice(0,at),nonce=id.slice(at+8);
   if(at<1||!bindings.has(migrationId)||!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(nonce))throw new Error('E2EE_SOURCE_HISTORY_REVIEW_REQUIRED');
   cancelled.push({id,migrationId});counts.set(migrationId,(counts.get(migrationId)??0)+1);
  }
  for(const id of ancestors)if(!counts.has(id.slice(0,-8)))throw new Error('E2EE_SOURCE_HISTORY_REVIEW_REQUIRED');
  for(const locator of cancelled){
   const copy=await readState(locator.id);current();if(copy.serial!==1||copy.state.phase==='active'||binding(copy.state)!==bindings.get(locator.migrationId))invalid();requireSourceOnly(copy.state);
  }
  const sourceIds=new Set(originals.flatMap(ref=>Array.from({length:ref.snapshotParts},(_,index)=>`${ref.migrationId}:source:${index}`)));
  const inspectLegacy=async()=>{
   current();const ids=await vault.listMigrationOriginalParts();current();
   if(ids.some(id=>!sourceIds.has(id)))throw new Error('E2EE_SOURCE_HISTORY_REVIEW_REQUIRED');
   const actualCopies=(await vault.listMigrationHistoryCopies()).sort();current();
   if(actualCopies.length!==copies.length||actualCopies.some((id,index)=>id!==copies[index]))throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
   const plans=await vault.listLocal('local-snapshot','content-plan:');current();
   if(inspectContentPlans){derived=await inspectContentPlans(plans);current();for(const value of Object.values(derived))if(!Number.isSafeInteger(value)||value<0)invalid();}
   else if(plans.length)throw new Error('E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED');
   for(const id of seen){
    const uploads=await vault.listLocal('outbox',id+':');current();const local=await vault.listLocal('local-snapshot',id+':private:');current();
    if(uploads.length||local.length)throw new Error('E2EE_SOURCE_HISTORY_PLAN_REVIEW_REQUIRED');
   }
  };
  await inspectLegacy();
  const stages=[];let bytes=originals.reduce((total,ref)=>total+ref.snapshotSize,0),parts=originals.reduce((total,ref)=>total+ref.snapshotParts,0);
  for(const ref of refs){const opened=await openSourceStage(vault,target,ref,current);current();if(opened.paths.length!==paths.length||opened.paths.some((path,index)=>path!==paths[index]))invalid();
   bytes+=opened.storageUsage.bytes;parts+=opened.storageUsage.parts;stages.push({ref,opened});}
  const totals=()=>{
   const value={bytes:bytes+derived.bytes,parts:parts+derived.parts,metadataBytes:metadataBytes+derived.metadataBytes,sources:stages.length+originals.length+derived.sources};
   if(value.bytes>capacity.maximumBytes||value.parts>capacity.maximumParts||value.metadataBytes>capacity.maximumMetadataBytes||value.sources>96)throw new Error('E2EE_SOURCE_HISTORY_CAPACITY');
   return Object.freeze(value);
  };await admit(totals());current();
  await verifyStagedMigrationSnapshot(vault,snapshot,current);current();
  for(const ref of originals){legacy.push(await openLegacyMigrationSnapshot({vault,target,paths,reference:ref,assertCurrent:current}));current();}
  const source=(id:string,open:(path:string)=>StagedPathReader):StagedSourceHistory=>Object.freeze({id,target:Object.freeze({...target}),paths:Object.freeze([...paths]),openPath(path:string){
   current();if(!paths.includes(path))throw new Error('E2EE_SOURCE_STAGE_PATH');if(reading||active.size){failed=true;throw new Error('E2EE_SOURCE_INPUT_BUSY');}
   let raw:StagedPathReader|undefined,ended=false,released=false,revoked=false,borrowed:Uint8Array|undefined;
   const check=()=>{current();if(revoked)throw new Error('E2EE_SOURCE_HISTORY_CLOSED');};
   const release=async()=>{if(released)return;released=true;borrowed?.fill(0);borrowed=undefined;
    try{if(!ended)await raw?.chunks.return?.();}finally{if(!ended)failed=true;active.delete(reader);}};
   const core=(async function*(){let rejected=false;try{
    check();raw=open(path);check();for(;;){check();const next=await raw.chunks.next();check();
     if(next.done){raw.assertComplete();check();ended=true;completed.add(id+'\0'+path);return;}
     if(!(next.value instanceof Uint8Array))invalid();borrowed=new Uint8Array(next.value);
     try{yield borrowed;check();}finally{borrowed.fill(0);borrowed=undefined;}
    }
   }catch(error){failed=true;rejected=true;throw error;}finally{await cleanup(release,rejected);}})();
   let pulling=false;
   const stop=async()=>{revoked=true;borrowed?.fill(0);try{await core.return(undefined);}finally{await release();}};
   const chunks:AsyncIterableIterator<Uint8Array>={async next(){if(pulling){failed=true;throw new Error('E2EE_SOURCE_INPUT_BUSY');}pulling=true;try{return await core.next();}finally{pulling=false;}},async return(){await stop();return{done:true,value:undefined};},[Symbol.asyncIterator](){return this;}};
   const reader=Object.freeze({chunks,close:stop,assertComplete(){check();if(!ended||failed)throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');}});active.add(reader);return reader;
  }});
  const previous:StagedSourceHistory[]=[];
  for(const[index,original]of originals.entries()){const id='legacy:'+await digest(encoder.encode(original.migrationId));current();previous.push(source(id,path=>legacy[index].openPath(path)));}
  for(const stage of stages.slice(0,-1))previous.push(source('stage:'+stage.ref.stageId,path=>stage.opened.openPath(path)));
  const last=stages.at(-1)!;const sources:StagedSourceInput=Object.freeze({current:source('stage:'+last.ref.stageId,path=>last.opened.openPath(path)),previous:Object.freeze(previous)});
  const verifyMetadata=async()=>{for(const expected of metadata){const actual=await readState(expected.id,false);if(actual.serial!==expected.serial||actual.hash!==expected.hash)throw new Error('E2EE_SOURCE_HISTORY_CHANGED');}};
  await verifyMetadata();await inspectLegacy();current();
  return Object.freeze({input:sources,close,async assertMetadataUnchanged(){
   current();if(reading)throw new Error('E2EE_SOURCE_INPUT_BUSY');reading=true;
   try{
    // This is deliberately metadata only. It retains the checked body/EOF
    // capability inside this one fence; it never grants a new body proof.
    if(failed||active.size)throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');
    await verifyMetadata();await inspectLegacy();
    const known=await inspectSourceStages(vault,target,current);current();
    if(known.length!==refs.length||known.some((row,index)=>!row.complete||row.id!==refs[index].stageId||row.manifestHash!==refs[index].manifestHash))throw new Error('E2EE_SOURCE_HISTORY_CHANGED');
    const usage=totals();await admit(usage);current();return usage;
   }catch(error){failed=true;throw error;}finally{reading=false;}
  },async assertCompleteAndUnchanged(){
   current();if(reading)throw new Error('E2EE_SOURCE_INPUT_BUSY');reading=true;
   try{
    if(failed||active.size||[sources.current,...sources.previous].some(source=>paths.some(path=>!completed.has(source.id+'\0'+path))))throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');
    await verifyStagedMigrationSnapshot(vault,snapshot,current);current();
    for(const ref of originals){const reopened=await openLegacyMigrationSnapshot({vault,target,paths,reference:ref,assertCurrent:current});reopened.close();current();}
    await inspectLegacy();await verifyMetadata();const usage=totals();await admit(usage);current();return Object.freeze({stateId,serial:initial.serial,...usage});
   }catch(error){failed=true;throw error;}finally{reading=false;}
  }});
 }catch(error){try{await close();}catch{/* Preserve the primary validation failure. */}throw error;}
}
