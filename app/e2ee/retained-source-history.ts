import {canonicalE2eeValue,type WireValue} from './commands.ts';
import {openSourceStage,type SourceStageReadVault} from './source-stage.ts';
import {validateStagedMigrationSnapshot} from './migration-stage.ts';
import {captureLegacyMigrationSnapshotReference,openLegacyMigrationSnapshot} from './legacy-snapshot-stream.ts';
import {requiredPrivatePaths} from './private-paths.ts';
import type {MigrationState} from './migration.ts';
import type {MigrationHistoryAdmission} from './migration-history.ts';
import type {StagedPathReader,StagedSourceHistory,StagedSourceInput} from './staged-reconciliation.ts';

export type RetainedSourceScope={root:MigrationState;ancestors:readonly MigrationState[];stateId:string;target:{ownerId:string;scopeId:string;kind:'personal'|'project'|'space'}};
const bindings=(scope:RetainedSourceScope)=>canonicalE2eeValue([scope.stateId,scope.target,[...scope.ancestors,scope.root].map(state=>[state.migrationId,state.ancestors,
 'source' in state?state.source:{migrationId:state.migrationId,snapshotSize:state.snapshotSize,snapshotParts:state.snapshotParts,snapshotHash:state.snapshotHash}])] as unknown as WireValue);
export function sameRetainedSources(a:RetainedSourceScope,b:RetainedSourceScope){const left=bindings(a),right=bindings(b);try{return left.length===right.length&&left.every((byte,at)=>byte===right[at]);}finally{left.fill(0);right.fill(0);}}

/** Called only AFTER the coordinator has authenticated the complete account
 * ownership catalogue, including every plan and every other scope. It does
 * not turn state4/5 into fabricated state3 JSON or filter global discovery.
 * verify reauthenticates the LIVE coordinator cell after its own saved CASes;
 * the source/ancestor bindings below stay fixed throughout this one fence. */
export async function openRetainedSourceHistory(options:{vault:SourceStageReadVault;scope:RetainedSourceScope;assertCurrent:()=>void;
 verify:()=>Promise<MigrationHistoryAdmission>}){
 const {vault,assertCurrent:guard,verify}=options,scope=structuredClone(options.scope),paths=requiredPrivatePaths(scope.target.kind).map(path=>path.id);
 let closed=false,failed=false,checking=false;const active=new Set<{close:()=>Promise<void>}>(),completed=new Set<string>();
 const legacy:Awaited<ReturnType<typeof openLegacyMigrationSnapshot>>[]=[],sources:StagedSourceHistory[]=[];
 const current=()=>{guard();vault.assertUnlocked();if(closed)throw new Error('E2EE_SOURCE_HISTORY_CLOSED');};current();
 const make=(id:string,open:(path:string)=>StagedPathReader):StagedSourceHistory=>Object.freeze({id,target:Object.freeze({...scope.target}),paths:Object.freeze([...paths]),openPath(path){
  current();if(!paths.includes(path))throw new Error('E2EE_SOURCE_STAGE_PATH');if(checking||active.size){failed=true;throw new Error('E2EE_SOURCE_INPUT_BUSY');}
  let raw:StagedPathReader|undefined,ended=false,revoked=false,released=false,pulling=false,borrowed:Uint8Array|undefined;
  const check=()=>{current();if(revoked)throw new Error('E2EE_SOURCE_HISTORY_CLOSED');};
  const release=async()=>{if(released)return;released=true;borrowed?.fill(0);borrowed=undefined;try{if(!ended)await raw?.chunks.return?.();}finally{if(!ended)failed=true;active.delete(reader);}};
  const core=(async function*(){try{
   check();raw=open(path);for(;;){check();const next=await raw.chunks.next();check();if(next.done){raw.assertComplete();check();ended=true;completed.add(id+'\0'+path);return;}
    if(!(next.value instanceof Uint8Array))throw new Error('E2EE_SOURCE_HISTORY_INVALID');borrowed=new Uint8Array(next.value);try{yield borrowed;check();}finally{borrowed.fill(0);borrowed=undefined;}
   }
  }catch(reason){failed=true;throw reason;}finally{await release();}})();
  const stop=async()=>{revoked=true;borrowed?.fill(0);try{await core.return(undefined);}finally{await release();}};
  const chunks:AsyncIterableIterator<Uint8Array>={async next(){if(pulling){failed=true;throw new Error('E2EE_SOURCE_INPUT_BUSY');}pulling=true;try{return await core.next();}finally{pulling=false;}},async return(){await stop();return{done:true,value:undefined};},[Symbol.asyncIterator](){return this;}};
  const reader=Object.freeze({chunks,close:stop,assertComplete(){check();if(!ended||failed)throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');}});active.add(reader);return reader;
 }});
 const close=async()=>{closed=true;legacy.forEach(reader=>reader.close());const results=await Promise.allSettled([...active].map(reader=>reader.close()));const error=results.find(result=>result.status==='rejected');if(error?.status==='rejected')throw error.reason;};
 try{
  const state=scope.root;if(state.protocol<3||!('source'in state))throw new Error('E2EE_STAGED_SOURCE_REQUIRED');
  const snapshot=validateStagedMigrationSnapshot(state.source,scope.target,vault.localIdentity(),paths);
  for(const old of scope.ancestors)if(old.protocol===1||old.protocol===2){
   const reference=captureLegacyMigrationSnapshotReference({migrationId:old.migrationId,snapshotSize:old.snapshotSize,snapshotParts:old.snapshotParts,snapshotHash:old.snapshotHash});
   const input=await openLegacyMigrationSnapshot({vault,target:scope.target,paths,reference,assertCurrent:current});current();legacy.push(input);sources.push(make('legacy:'+old.migrationId,path=>input.openPath(path)));
  }
  for(const ref of [...snapshot.history,snapshot.reference]){
   const opened=await openSourceStage(vault,scope.target,ref,current);current();if(opened.paths.length!==paths.length||opened.paths.some((path,at)=>path!==paths[at]))throw new Error('E2EE_SOURCE_HISTORY_INVALID');
   sources.push(make('stage:'+ref.stageId,path=>opened.openPath(path)));
  }
  if(sources.length<1||sources.length>96||new Set(sources.map(source=>source.id)).size!==sources.length)throw new Error('E2EE_SOURCE_HISTORY_LIMIT');
  const input:StagedSourceInput=Object.freeze({current:sources.at(-1)!,previous:Object.freeze(sources.slice(0,-1))});
  const assert=async(complete:boolean)=>{
   current();if(checking)throw new Error('E2EE_SOURCE_INPUT_BUSY');checking=true;
   try{
    if(failed||active.size||complete&&sources.some(source=>paths.some(path=>!completed.has(source.id+'\0'+path))))throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');
    const totals=await verify();current();return Object.freeze({stateId:scope.stateId,...totals});
   }catch(reason){failed=true;throw reason;}finally{checking=false;}
  };
  await assert(false);return Object.freeze({input,close,assertMetadataUnchanged:()=>assert(false),assertCompleteAndUnchanged:()=>assert(true)});
 }catch(reason){try{await close();}catch{/* Keep the original custody failure. */}throw reason;}
}
