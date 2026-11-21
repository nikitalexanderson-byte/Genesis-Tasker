import {decodeE2eeBytes,encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {requiredPrivatePaths,type PrivateScopeKind,type PrivatePath} from './private-paths.ts';
export {requiredPrivatePaths,type PrivateScopeKind,type PrivatePath} from './private-paths.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {E2EE_MAX_FILE_BYTES} from './files.ts';
import {E2EE_CHUNK_BYTES} from './files.ts';
import type {StagedMigrationCapture} from './migration-stage.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSources,type MigrationSourceContext} from './migration.ts';
import {reconcileStagedPrivatePaths,type StagedPathReconciler,type StagedSourceInput} from './staged-reconciliation.ts';

export interface PrivatePathAdapter {
  readonly id:string;
  /** No network or mutations. Empty sources still return an explicit serialized value. */
  captureLocal():Promise<Uint8Array>;
  /** Only after the complete protected local snapshot commits. All old attempts are supplied. */
  reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext):Promise<{complete:boolean;content:MigrationContent[];localContent?:MigrationContent[]}>;
}
export interface PrivatePathStreamAdapter {
 readonly id:string;
 /** Local-only producer; success must follow complete original source EOF. */
 captureLocal(write:(bytes:Uint8Array)=>Promise<void>):Promise<void>;
}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});

/** A missing category cannot silently turn a partial adapter into full migration.
 * This is the shared product inventory, not a list inferred from mounted screens.
 * It never imports identity/ACL/payment authority or clears any legacy source.
 */
export class E2eeMigrationSources implements MigrationSources {
  #ownerId:string;#scopeId:string;#kind:PrivateScopeKind;#paths:readonly PrivatePath[];#adapters=new Map<string,PrivatePathAdapter>();
  #streamAdapters=new Map<string,PrivatePathStreamAdapter>();
  #stagedReconcilers=new Map<string,StagedPathReconciler>();
  readonly requiredCoverage:readonly string[];
  readonly allowedContentDomains:readonly E2eeContext['domain'][];
  constructor(ownerId:string,scopeId:string,kind:PrivateScopeKind){
    assertTechnical(ownerId);assertTechnical(scopeId);this.#ownerId=ownerId;this.#scopeId=scopeId;this.#kind=kind;this.#paths=requiredPrivatePaths(kind);
    this.requiredCoverage=Object.freeze(this.#paths.map(path=>path.id));
    this.allowedContentDomains=Object.freeze([...new Set(this.#paths.flatMap(path=>path.domains))]) as readonly E2eeContext['domain'][];
  }
  assertBinding(ownerId:string,scopeId:string,kind:string){
    if(ownerId!==this.#ownerId||scopeId!==this.#scopeId||kind!==this.#kind)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  }
  register(adapter:PrivatePathAdapter){
    if(!this.requiredCoverage.includes(adapter.id)||this.#adapters.has(adapter.id))throw new Error('E2EE_INVALID_SOURCE_ADAPTER');
    this.#adapters.set(adapter.id,adapter);
  }
  /** Compose existing bounded domain adapters with the streamed coordinator.
   * Limits are enforced on authenticated EOF; no dummy category is registered. */
  registerIntegrated(adapter:PrivatePathAdapter,assertCurrent:()=>void,maximum=E2EE_MAX_FILE_BYTES){
    if(!Number.isSafeInteger(maximum)||maximum<1||maximum>E2EE_MAX_FILE_BYTES||this.#adapters.has(adapter.id)||this.#streamAdapters.has(adapter.id)||this.#stagedReconcilers.has(adapter.id))throw new Error('E2EE_INVALID_SOURCE_ADAPTER');
    const capture=adapter.captureLocal.bind(adapter),reconcile=adapter.reconcile.bind(adapter),id=adapter.id;
    this.register(adapter);
    this.registerStream({id,async captureLocal(write){assertCurrent();const bytes=await capture();
      try{assertCurrent();if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>maximum)throw new Error('E2EE_SNAPSHOT_TOO_LARGE');
        for(let at=0;at<bytes.length;at+=E2EE_CHUNK_BYTES){assertCurrent();await write(bytes.subarray(at,Math.min(at+E2EE_CHUNK_BYTES,bytes.length)));assertCurrent();}
      }finally{bytes.fill(0);}}});
    this.registerStagedReconciler({id,async reconcile(input,context,emit){
      const buffers:Uint8Array[]=[];let total=0;
      try{
        for(const source of [input.current,...input.previous]){
          const reader=source.open(),parts:Uint8Array[]=[];let length=0;
          try{for await(const part of reader.chunks){assertCurrent();length+=part.length;total+=part.length;
            if(length>maximum||total>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');parts.push(new Uint8Array(part));}
            reader.assertComplete();const bytes=new Uint8Array(length);let at=0;for(const part of parts){bytes.set(part,at);at+=part.length;}buffers.push(bytes);
          }finally{parts.forEach(part=>part.fill(0));await reader.close();}
        }
        const result=await reconcile(buffers[0],buffers.slice(1),context);
        try{assertCurrent();for(const [placement,rows]of [['remote',result.content],['local',result.localContent??[]]] as const)for(const row of rows){
          assertCurrent();await emit({...row,placement,size:row.bytes.length,source:(async function*(){for(let at=0;at<row.bytes.length;at+=E2EE_CHUNK_BYTES){assertCurrent();yield row.bytes.subarray(at,Math.min(at+E2EE_CHUNK_BYTES,row.bytes.length));}})()});assertCurrent();
        }return result.complete;}finally{[...result.content,...result.localContent??[]].forEach(row=>row.bytes.fill(0));}
      }finally{buffers.forEach(bytes=>bytes.fill(0));}
    }});
  }
  registerStream(adapter:PrivatePathStreamAdapter){
    if(!this.requiredCoverage.includes(adapter.id)||this.#streamAdapters.has(adapter.id))throw new Error('E2EE_INVALID_SOURCE_ADAPTER');
    this.#streamAdapters.set(adapter.id,adapter);
  }
  registerStagedReconciler(adapter:StagedPathReconciler){
    if(!this.requiredCoverage.includes(adapter.id)||this.#stagedReconcilers.has(adapter.id))throw new Error('E2EE_INVALID_SOURCE_ADAPTER');
    this.#stagedReconcilers.set(adapter.id,adapter);
  }
  /** Synchronous full preflight and callback capture, before source capture,
   * durable-key callbacks or a server lease. The returned runner stays inert. */
  stagedReconciliation(){
    const reconcilers=new Map(this.#paths.map(path=>{
      const adapter=this.#stagedReconcilers.get(path.id);if(!adapter)throw new Error('E2EE_STAGED_RECONCILER_REQUIRED');
      return[path.id,Object.freeze({id:path.id,reconcile:adapter.reconcile.bind(adapter)})] as const;
    })),ownerId=this.#ownerId,scopeId=this.#scopeId,kind=this.#kind,paths=this.#paths;
    return Object.freeze({run(input:StagedSourceInput,context:MigrationSourceContext,emit:Parameters<typeof reconcileStagedPrivatePaths>[0]['emit'],assertCurrent:()=>void){
      return reconcileStagedPrivatePaths({ownerId,scopeId,kind,paths,reconcilers,input,context,emit,assertCurrent});
    }});
  }
  async reconcileStaged(input:StagedSourceInput,context:MigrationSourceContext,emit:Parameters<typeof reconcileStagedPrivatePaths>[0]['emit'],assertCurrent:()=>void){
    return this.stagedReconciliation().run(input,context,emit,assertCurrent);
  }
  /** Snapshot ALL callbacks and validate the full registry before any durable-key
   * callback or producer. Legacy compatibility requires an explicit per-path
   * bound and never aggregates several path results. */
  stagedCapture(legacyLimits:ReadonlyMap<string,number>=new Map()):StagedMigrationCapture{
    const producers=new Map<string,(write:(bytes:Uint8Array)=>Promise<void>)=>Promise<void>>();
    for(const path of this.#paths){
      const stream=this.#streamAdapters.get(path.id);
      if(stream){producers.set(path.id,stream.captureLocal.bind(stream));continue;}
      const legacy=this.#adapters.get(path.id),maximum=legacyLimits.get(path.id);
      if(!legacy||!Number.isSafeInteger(maximum)||maximum!<1||maximum!>E2EE_MAX_FILE_BYTES)throw new Error('E2EE_SOURCE_ADAPTER_REQUIRED');
      const capture=legacy.captureLocal.bind(legacy),limit=maximum!;
      producers.set(path.id,async write=>{
        const value=await capture();if(!(value instanceof Uint8Array)||value.length<1||value.length>limit)throw new Error('E2EE_SNAPSHOT_TOO_LARGE');
        const bytes=new Uint8Array(value);
        try{for(let at=0;at<bytes.length;at+=E2EE_CHUNK_BYTES)await write(bytes.subarray(at,Math.min(bytes.length,at+E2EE_CHUNK_BYTES)));}
        finally{bytes.fill(0);}
      });
    }
    return Object.freeze({target:Object.freeze({ownerId:this.#ownerId,scopeId:this.#scopeId,kind:this.#kind}),paths:Object.freeze([...this.requiredCoverage]),
      async capturePath(id:string,write:(bytes:Uint8Array)=>Promise<void>){const producer=producers.get(id);if(!producer)throw new Error('E2EE_SOURCE_ADAPTER_REQUIRED');await producer(write);}});
  }
  #all(){
    return this.#paths.map(path=>{const adapter=this.#adapters.get(path.id);if(!adapter)throw new Error('E2EE_SOURCE_ADAPTER_REQUIRED');return{path,adapter};});
  }
  async captureLocal():Promise<Uint8Array>{
    const adapters=this.#all(),captured:Uint8Array[]=[];let size=0;
    try {
      const paths=[];
      for(const {adapter,path} of adapters){
        const source=await adapter.captureLocal();if(!(source instanceof Uint8Array))throw new Error('E2EE_INVALID_SOURCE_RESULT');
        size+=source.length;if(source.length<1||size>E2EE_MAX_FILE_BYTES)throw new Error('E2EE_SNAPSHOT_TOO_LARGE');
        const bytes=new Uint8Array(source);captured.push(bytes);
        paths.push({id:path.id,bytes:encodeE2eeBytes(bytes)});
      }
      const snapshot=encoder.encode(JSON.stringify({protocol:1,ownerId:this.#ownerId,scopeId:this.#scopeId,paths}));
      if(snapshot.length>E2EE_MAX_FILE_BYTES){snapshot.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return snapshot;
    }finally{captured.forEach(bytes=>bytes.fill(0));}
  }
  #decode(bytes:Uint8Array){
    if(bytes.length<1||bytes.length>E2EE_MAX_FILE_BYTES)throw new Error('E2EE_CORRUPT_SNAPSHOT');
    const value:unknown=JSON.parse(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','paths']);
    if(value.protocol!==1||value.ownerId!==this.#ownerId||value.scopeId!==this.#scopeId||!Array.isArray(value.paths)||value.paths.length!==this.#paths.length)throw new Error('E2EE_CORRUPT_SNAPSHOT');
    const decoded=new Map<string,Uint8Array>();
    try{
      for(const source of value.paths){
        exactKeys(source,['id','bytes']);if(typeof source.id!=='string'||decoded.has(source.id)||!this.requiredCoverage.includes(source.id))throw new Error('E2EE_CORRUPT_SNAPSHOT');
        decoded.set(source.id,decodeE2eeBytes(source.bytes,1,E2EE_MAX_FILE_BYTES));
      }
      return decoded;
    }catch(error){decoded.forEach(bytes=>bytes.fill(0));throw error;}
  }
  async reconcile(snapshot:Uint8Array,previousSnapshots:readonly Uint8Array[],context?:MigrationSourceContext){
    if(context&&(context.ownerId!==this.#ownerId||context.scopeId!==this.#scopeId))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
    if(previousSnapshots.length>32)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
    if(snapshot.length+previousSnapshots.reduce((total,bytes)=>total+bytes.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
    const adapters=this.#all(),decoded:Map<string,Uint8Array>[]=[];const coverage:{domain:string;complete:boolean}[]=[],content:MigrationContent[]=[],localContent:MigrationContent[]=[];
    try{
      decoded.push(this.#decode(snapshot));for(const previous of previousSnapshots)decoded.push(this.#decode(previous));
      const seen=new Set<string>();let contentBytes=0;
      for(const {path,adapter} of adapters){
        const result=await adapter.reconcile(decoded[0].get(path.id)!,decoded.slice(1).map(previous=>previous.get(path.id)!),context);
        if(typeof result.complete!=='boolean'||!Array.isArray(result.content)||result.localContent!==undefined&&!Array.isArray(result.localContent))throw new Error('E2EE_INVALID_SOURCE_RESULT');
        coverage.push({domain:path.id,complete:result.complete});
        const local=result.localContent??[];
        for(const item of [...result.content,...local]){
          assertTechnical(item.objectId);const identity=`${item.domain}\0${item.objectId}`;
          if(!path.domains.includes(item.domain)||seen.has(identity)||content.length+localContent.length>=10000||!(item.bytes instanceof Uint8Array)||item.bytes.length>E2EE_MAX_FILE_BYTES)throw new Error('E2EE_INVALID_SOURCE_RESULT');
          contentBytes+=item.bytes.length;if(contentBytes>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_TOO_LARGE');
          seen.add(identity);
        }
        if(content.length+localContent.length+result.content.length+local.length>10000)throw new Error('E2EE_INVALID_SOURCE_RESULT');
        for(const item of result.content)content.push({...item,domain:item.domain as E2eeContext['domain'],bytes:new Uint8Array(item.bytes)});
        for(const item of local)localContent.push({...item,domain:item.domain as E2eeContext['domain'],bytes:new Uint8Array(item.bytes)});
      }
      return{coverage,content,localContent};
    }catch(error){[...content,...localContent].forEach(item=>item.bytes.fill(0));throw error;}
    finally{decoded.forEach(paths=>paths.forEach(bytes=>bytes.fill(0)));}
  }
}
