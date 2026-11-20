import {assertTechnical} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES} from './files.ts';
import type {PrivatePath,PrivateScopeKind} from './migration-sources.ts';
import type {MigrationSourceContext,MigrationCoverage} from './migration.ts';
import type {MigrationContentStream} from './content-plan.ts';

export type StagedPathReader={chunks:AsyncIterableIterator<Uint8Array>;assertComplete:()=>void};
export type StagedSourceHistory=Readonly<{id:string;target:Readonly<{ownerId:string;scopeId:string;kind:PrivateScopeKind}>;paths:readonly string[];
 openPath:(id:string)=>StagedPathReader|Promise<StagedPathReader>}>;
export type StagedSourceInput=Readonly<{current:StagedSourceHistory;previous:readonly StagedSourceHistory[]}>;
export type ReconciliationPathInput=Readonly<{sourceId:string;open:()=>StagedPathReader&{close:()=>Promise<void>}}>;
export type StagedPathReconciler=Readonly<{id:string;reconcile:(input:Readonly<{current:ReconciliationPathInput;previous:readonly ReconciliationPathInput[]}>,context:MigrationSourceContext,
 emit:(record:MigrationContentStream)=>Promise<void>)=>Promise<boolean>}>;
const closed=():never=>{throw new Error('E2EE_STAGED_RECONCILIATION_CLOSED');};
async function closeAll(readers:readonly{close:()=>Promise<void>}[]){
 const results=await Promise.allSettled(readers.map(async reader=>reader.close()));
 const failure=results.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
}
async function cleanup(close:()=>Promise<void>,rejected:boolean){try{await close();}catch(error){if(!rejected)throw error;}}

/** Original factories must come from authenticated coordinator history/custody,
 * not a server's claimed path array. This layer checks full declared coverage
 * and actual reader EOF; it does not discover omitted originals or grant trust. */
class TrackedPath {
 readonly input:ReconciliationPathInput;#guard:()=>void;#factory:()=>StagedPathReader|Promise<StagedPathReader>;
 #readers=new Set<{close:()=>Promise<void>}>();#complete=false;#failed=false;#closed=false;
 constructor(sourceId:string,factory:()=>StagedPathReader|Promise<StagedPathReader>,guard:()=>void){
  this.#guard=guard;this.#factory=factory;this.input=Object.freeze({sourceId,open:()=>this.#open()});
 }
 #current(){this.#guard();if(this.#closed)closed();}
 #open(){
  this.#current();if(this.#readers.size)throw new Error('E2EE_SOURCE_INPUT_BUSY');
  let stop:(()=>Promise<IteratorResult<Uint8Array>>)|undefined,borrowed:Uint8Array|undefined,ended=false,revoked=false,released=false,reading=false;
  const current=()=>{this.#current();if(revoked)closed();};
  const release=async()=>{if(released)return;released=true;borrowed?.fill(0);borrowed=undefined;
   try{if(!ended)await stop?.();}catch(error){this.#failed=true;throw error;}finally{if(!ended)this.#failed=true;this.#readers.delete(reader);}};
  const core=(async function*(this:TrackedPath,factory:()=>StagedPathReader|Promise<StagedPathReader>,complete:()=>void){
   let rejected=false;
   try{
    current();const raw=await factory(),iterator=raw.chunks[Symbol.asyncIterator]();stop=iterator.return?.bind(iterator);
    const pull=iterator.next.bind(iterator),verify=raw.assertComplete.bind(raw);current();
    while(true){current();const next=await pull();current();if(next.done){verify();current();ended=true;complete();return;}
     if(!(next.value instanceof Uint8Array)||next.value.length<1||next.value.length>E2EE_CHUNK_BYTES)throw new Error('E2EE_INVALID_SOURCE_STREAM');
     borrowed=new Uint8Array(next.value);try{yield borrowed;current();}finally{borrowed.fill(0);borrowed=undefined;}
    }
   }catch(error){rejected=true;this.#failed=true;throw error;}
   finally{await cleanup(release,rejected);}
  }).call(this,this.#factory,()=>{this.#complete=true;});
  const observe=<T>(pending:Promise<T>)=>{void pending.catch(()=>{this.#failed=true;});return pending;};
  const close=async()=>{revoked=true;borrowed?.fill(0);try{await core.return(undefined);}finally{await release();}};
  const chunks:AsyncIterableIterator<Uint8Array>={next:()=>{
   if(reading){this.#failed=true;return observe(Promise.reject(new Error('E2EE_SOURCE_INPUT_BUSY')));}
   reading=true;return observe(core.next().finally(()=>{reading=false;}));
  },return:async()=>{await close();return{done:true,value:undefined};},[Symbol.asyncIterator](){return this;}};
  const reader=Object.freeze({chunks,close,assertComplete:()=>{current();if(!ended||this.#failed)throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');}});
  this.#readers.add(reader);return reader;
 }
 assertComplete(){this.#current();if(!this.#complete||this.#failed||this.#readers.size)throw new Error('E2EE_SOURCE_INPUT_EOF_REQUIRED');}
 async close(){this.#closed=true;await closeAll([...this.#readers]);}
}

/** Sequential record streaming, no aggregate content/result arrays. Every
 * declared current/history input must really authenticate EOF. Prefixes in the
 * sink remain inert quarantine until the separate complete-plan publication. */
export async function reconcileStagedPrivatePaths(options:{ownerId:string;scopeId:string;kind:PrivateScopeKind;paths:readonly PrivatePath[];
 reconcilers:ReadonlyMap<string,StagedPathReconciler>;input:StagedSourceInput;context:MigrationSourceContext;
 emit:(path:string,record:MigrationContentStream)=>Promise<void>;assertCurrent:()=>void}):Promise<MigrationCoverage[]>{
 const ownerId=options.ownerId,scopeId=options.scopeId,kind=options.kind,guard=options.assertCurrent,sink=options.emit;
 const context=Object.freeze({...options.context}),paths=options.paths.map(path=>({...path,domains:[...path.domains]}));guard();
 if(context.ownerId!==ownerId||context.scopeId!==scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');assertTechnical(context.migrationId);decodeE2eeBytes(context.sourceHash,32);
 if(!Number.isSafeInteger(context.fence)||context.fence<1||!Number.isSafeInteger(context.generation)||context.generation<1)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(options.input.previous.length>95)throw new Error('E2EE_SOURCE_HISTORY_INVALID');
 const original=[options.input.current,...options.input.previous],sources=original.map(source=>({id:source.id,target:{...source.target},paths:[...source.paths],open:source.openPath.bind(source)}));
 if(sources.length<1||sources.length>96||new Set(sources.map(source=>source.id)).size!==sources.length)throw new Error('E2EE_SOURCE_HISTORY_INVALID');
 for(const source of sources){assertTechnical(source.id);if(source.target.ownerId!==ownerId||source.target.scopeId!==scopeId||source.target.kind!==kind||source.paths.length!==paths.length
  ||source.paths.some((id,index)=>id!==paths[index].id))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
 // Capture every callback before the first original factory or sink await.
 const adapters=paths.map(path=>{const adapter=options.reconcilers.get(path.id);if(!adapter)throw new Error('E2EE_STAGED_RECONCILER_REQUIRED');return{path,reconcile:adapter.reconcile.bind(adapter)};});
 const coverage:MigrationCoverage[]=[],seen=new Set<string>();let records=0;
 for(const {path,reconcile}of adapters){
  guard();const tracked=sources.map(source=>new TrackedPath(source.id,()=>source.open(path.id),guard));let active=true,writing=false,pending:Promise<void>|undefined,failed=false,failure:unknown;
  const emit=(input:MigrationContentStream):Promise<void>=>{
   let record:MigrationContentStream;
   try{
   guard();if(!active)closed();if(writing)throw new Error('E2EE_SOURCE_OUTPUT_BUSY');record={...input};assertTechnical(record.objectId);
   const identity=record.domain+'\0'+record.objectId;
   if(!path.domains.includes(record.domain)||!['remote','local'].includes(record.placement)||!Number.isSafeInteger(record.size)||record.size<0||record.size>E2EE_MAX_FILE_BYTES
    ||record.domain==='shared-comment'&&record.size>65536||seen.has(identity)||++records>10000)throw new Error('E2EE_INVALID_SOURCE_RESULT');
   seen.add(identity);writing=true;
   }catch(error){failed=true;failure??=error;throw error;}
   pending=(async()=>{try{await sink(path.id,record);guard();}catch(error){failed=true;failure??=error;throw error;}finally{writing=false;}})();
   void pending.catch(()=>{});return pending;
  };
  let rejected=false;
  try{
   const complete=await reconcile(Object.freeze({current:tracked[0].input,previous:Object.freeze(tracked.slice(1).map(source=>source.input))}),context,emit);guard();active=false;
   if(writing){await pending?.catch(()=>{});throw new Error('E2EE_SOURCE_OUTPUT_NOT_AWAITED');}if(failed)throw failure;
   if(complete!==true)throw new Error('E2EE_INCOMPLETE_COVERAGE');for(const source of tracked)source.assertComplete();coverage.push({domain:path.id,complete:true});
  }catch(error){rejected=true;throw error;}
  finally{active=false;await pending?.catch(()=>{});await cleanup(()=>closeAll(tracked),rejected);}
 }
 guard();return coverage;
}
