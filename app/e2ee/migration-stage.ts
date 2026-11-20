import {decodeE2eeBytes} from './envelope.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {ProtectedSourceStage,inspectSourceStages,openSourceStage,sourceStagePublicationGuard,type SourceStageTarget,type SourceStageReference,type SourceStageCapacity,type SourceStageAdmission} from './source-stage.ts';
import type {UnlockedE2eeVault} from './storage.ts';

/** A preflighted registry, never a mounted-screen inventory. No network port. */
export type StagedMigrationCapture=Readonly<{target:SourceStageTarget;paths:readonly string[];
 capturePath:(id:string,write:(bytes:Uint8Array)=>Promise<void>)=>Promise<void>}>;
export type StagedMigrationSnapshot={format:'source-stage-v1';target:SourceStageTarget;
 actor:{ownerId:string;scopeId:string;deviceId:string};paths:string[];reference:SourceStageReference;history:SourceStageReference[]};
export type StagedMigrationOptions={capacity:SourceStageCapacity;admit:(request:SourceStageAdmission)=>Promise<void>;assertCurrent:()=>void};
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function invalid():never{throw new Error('E2EE_CORRUPT_STAGED_MIGRATION');}
function reference(value:unknown):SourceStageReference{
 exactKeys(value,['stageId','manifestHash']);if(typeof value.stageId!=='string'||!uuid.test(value.stageId))invalid();decodeE2eeBytes(value.manifestHash,32);
 return{stageId:value.stageId,manifestHash:value.manifestHash as string};
}
export function validateStagedMigrationSnapshot(value:unknown,target:SourceStageTarget,actor:{ownerId:string;scopeId:string;deviceId:string},paths:readonly string[]):StagedMigrationSnapshot{
 exactKeys(value,['format','target','actor','paths','reference','history']);if(value.format!=='source-stage-v1')invalid();
 exactKeys(value.target,['ownerId','scopeId','kind']);exactKeys(value.actor,['ownerId','scopeId','deviceId']);
 for(const key of ['ownerId','scopeId','kind'] as const)if(value.target[key]!==target[key])invalid();
 for(const key of ['ownerId','scopeId','deviceId'] as const)if(value.actor[key]!==actor[key])invalid();
 if(!Array.isArray(value.paths)||value.paths.length!==paths.length||value.paths.some((path,index)=>path!==paths[index])
  ||!Array.isArray(value.history)||value.history.length>63)invalid();
 const current=reference(value.reference),history=value.history.map(reference),seen=new Set<string>([current.stageId]);
 for(const ref of history){if(seen.has(ref.stageId))invalid();seen.add(ref.stageId);}
 return{format:'source-stage-v1',target:{...target},actor:{...actor},paths:[...paths],reference:current,history};
}
export async function stagedMigrationPublicationGuard(vault:UnlockedE2eeVault,snapshot:StagedMigrationSnapshot,check:()=>void){
 const value=validateStagedMigrationSnapshot(snapshot,snapshot.target,vault.localIdentity(),snapshot.paths);
 return sourceStagePublicationGuard(vault,value.target,[...value.history,value.reference],check);
}
/** Authenticate every current/orphan complete stage, including actual path EOF.
 * An incomplete marker blocks reconciliation; a prefix is never omitted. */
export async function verifyStagedMigrationSnapshot(vault:UnlockedE2eeVault,snapshot:StagedMigrationSnapshot,check:()=>void){
 const current=()=>{check();vault.assertUnlocked();};current();
 const value=validateStagedMigrationSnapshot(snapshot,snapshot.target,vault.localIdentity(),snapshot.paths);
 const refs=[...value.history,value.reference],known=await inspectSourceStages(vault,value.target,current);current();
 if(known.length!==refs.length||known.some((row,index)=>!row.complete||row.id!==refs[index].stageId||row.manifestHash!==refs[index].manifestHash))
  throw new Error('E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED');
 let bytes=0,parts=0;
 for(const ref of refs){
  const opened=await openSourceStage(vault,value.target,ref,current);current();
  if(opened.paths.length!==value.paths.length||opened.paths.some((id,index)=>id!==value.paths[index]))invalid();
  for(const id of opened.paths){const reader=opened.openPath(id);for await(const chunk of reader.chunks){current();bytes+=chunk.length;parts++;}reader.assertComplete();current();}
 }
 const after=await inspectSourceStages(vault,value.target,current);current();
 if(after.length!==known.length||after.some((row,index)=>row.id!==known[index].id||row.complete!==known[index].complete||row.manifestHash!==known[index].manifestHash))
  throw new Error('E2EE_SOURCE_STAGE_BUSY');
 return{bytes,parts};
}
/** Local source publication input only. The coordinator still owns its CAS;
 * a losing/failed attempt remains in the authenticated catalogue as history. */
export async function captureStagedMigrationSnapshot(vault:UnlockedE2eeVault,input:StagedMigrationCapture,required:readonly string[],
 options:StagedMigrationOptions,ensureDurableKeys:()=>Promise<void>):Promise<StagedMigrationSnapshot>{
 const capture={target:{...input.target},paths:[...input.paths],capturePath:input.capturePath},limits={...options.capacity},admit=options.admit,guard=options.assertCurrent;
 const current=()=>{guard();vault.assertUnlocked();};current();
 exactKeys(capture.target,['ownerId','scopeId','kind']);assertTechnical(capture.target.ownerId);assertTechnical(capture.target.scopeId);
 if(!['personal','project','space'].includes(capture.target.kind)||required.length<1||required.length>20||new Set(required).size!==required.length
  ||capture.paths.length!==required.length||capture.paths.some((id,index)=>id!==required[index]))throw new Error('E2EE_SOURCE_ADAPTER_REQUIRED');
 capture.paths.forEach(assertTechnical);const actor=vault.localIdentity();
 await ensureDurableKeys();current();
 const old=await inspectSourceStages(vault,capture.target,current);current();
 if(old.some(row=>!row.complete))throw new Error('E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED');
 const history=old.map(row=>reference({stageId:row.id,manifestHash:row.manifestHash}));
 // A complete orphan is original history too. Verify it before any producer.
 if(history.length){const prior={format:'source-stage-v1' as const,target:capture.target,actor,paths:capture.paths,reference:history.at(-1)!,history:history.slice(0,-1)};
  await verifyStagedMigrationSnapshot(vault,prior,current);current();}
 const stage=await ProtectedSourceStage.create({vault,target:capture.target,paths:capture.paths,capacity:limits,admit,assertCurrent:current,ensureDurableKeys:async()=>{current();}});
 for(const id of capture.paths){current();await stage.capturePath(id,write=>capture.capturePath(id,write));current();}
 const ref=await stage.finish();current();
 const result:StagedMigrationSnapshot={format:'source-stage-v1',target:capture.target,actor,paths:capture.paths,reference:ref,history};
 await verifyStagedMigrationSnapshot(vault,result,current);current();return result;
}
