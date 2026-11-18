import registry from '../../contracts/e2ee/private-paths-v1.json' with {type:'json'};
import {E2EE_DOMAINS,decodeE2eeBytes,encodeE2eeBytes,type E2eeContext} from './envelope.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {E2EE_MAX_FILE_BYTES} from './files.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSources} from './migration.ts';

export type PrivateScopeKind='personal'|'project'|'space';
export type PrivatePath=typeof registry.paths[number];
export function requiredPrivatePaths(kind:PrivateScopeKind):readonly PrivatePath[]{
  if(registry.version!==1||!['personal','project','space'].includes(kind)||new Set(registry.paths.map(path=>path.id)).size!==registry.paths.length
    ||['personal','project','space'].some(scope=>!registry.paths.some(path=>path.scope===scope))
    ||registry.paths.some(path=>path.domains.length<1||path.domains.some(domain=>!(E2EE_DOMAINS as readonly string[]).includes(domain)
      ||!registry.remoteDomains[path.scope as PrivateScopeKind].includes(domain))))throw new Error('E2EE_INVALID_COVERAGE_REGISTRY');
  return structuredClone(registry.paths.filter(path=>path.scope===kind));
}
export interface PrivatePathAdapter {
  readonly id:string;
  /** No network or mutations. Empty sources still return an explicit serialized value. */
  captureLocal():Promise<Uint8Array>;
  /** Only after the complete protected local snapshot commits. All old attempts are supplied. */
  reconcile(local:Uint8Array,previous:readonly Uint8Array[]):Promise<{complete:boolean;content:MigrationContent[]}>;
}
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});

/** A missing category cannot silently turn a partial adapter into full migration.
 * This is the shared product inventory, not a list inferred from mounted screens.
 * It never imports identity/ACL/payment authority or clears any legacy source.
 */
export class E2eeMigrationSources implements MigrationSources {
  #ownerId:string;#scopeId:string;#kind:PrivateScopeKind;#paths:readonly PrivatePath[];#adapters=new Map<string,PrivatePathAdapter>();
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
  async reconcile(snapshot:Uint8Array,previousSnapshots:readonly Uint8Array[]){
    if(previousSnapshots.length>32)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
    if(snapshot.length+previousSnapshots.reduce((total,bytes)=>total+bytes.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
    const adapters=this.#all(),decoded:Map<string,Uint8Array>[]=[];const coverage:{domain:string;complete:boolean}[]=[],content:MigrationContent[]=[];
    try{
      decoded.push(this.#decode(snapshot));for(const previous of previousSnapshots)decoded.push(this.#decode(previous));
      const seen=new Set<string>();let contentBytes=0;
      for(const {path,adapter} of adapters){
        const result=await adapter.reconcile(decoded[0].get(path.id)!,decoded.slice(1).map(previous=>previous.get(path.id)!));
        if(typeof result.complete!=='boolean'||!Array.isArray(result.content))throw new Error('E2EE_INVALID_SOURCE_RESULT');
        coverage.push({domain:path.id,complete:result.complete});
        for(const item of result.content){
          assertTechnical(item.objectId);const identity=`${item.domain}\0${item.objectId}`;
          if(!path.domains.includes(item.domain)||seen.has(identity)||content.length>=10000||!(item.bytes instanceof Uint8Array)||item.bytes.length>E2EE_MAX_FILE_BYTES)throw new Error('E2EE_INVALID_SOURCE_RESULT');
          contentBytes+=item.bytes.length;if(contentBytes>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_TOO_LARGE');
          seen.add(identity);
        }
        if(content.length+result.content.length>10000)throw new Error('E2EE_INVALID_SOURCE_RESULT');
        for(const item of result.content)content.push({...item,domain:item.domain as E2eeContext['domain'],bytes:new Uint8Array(item.bytes)});
      }
      return{coverage,content};
    }catch(error){content.forEach(item=>item.bytes.fill(0));throw error;}
    finally{decoded.forEach(paths=>paths.forEach(bytes=>bytes.fill(0)));}
  }
}
