import {E2eeEditorQueue} from './editor-queue.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {assertTechnical} from './keys.ts';
import type {E2eeContext} from './envelope.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import type {E2eeScopeClient} from './scope-client.ts';
import {privatePathSource} from './private-path-source.ts';
import {privateTableObjectId,type PrivateTableDocument} from './relational-path-source.ts';
import {privatePathDocumentDomain,type PrivateScopeKind} from './private-paths.ts';

type Opened<T>={value:T;serial:number;remoteRevision:number;pending:boolean};
export type PrivateDocumentView<T>=Opened<T>&{conflict:null|{value:T;revision:number}};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
/** Product read/write channel. Acknowledged edits use the existing encrypted
 * editor queue, retaining all versions through offline/retry/process death.
 * Online errors never trigger a legacy read or an implicit offline fallback. */
export class E2eePrivateDocument<T>{
 #queue:E2eeEditorQueue;#client:E2eeScopeClient;#domain:E2eeContext['domain'];#id:string;
 #validate:(input:unknown)=>T|Promise<T>;#current:()=>void;#write:()=>void;
 constructor(options:{device:UnlockedWebDevice;client:E2eeScopeClient;scopeId:string;domain:E2eeContext['domain'];objectId:string;
  validate:(input:unknown)=>T|Promise<T>;assertCurrent:()=>void;assertWrite:()=>void}){
  assertTechnical(options.scopeId);assertTechnical(options.objectId);options.assertCurrent();
  this.#queue=new E2eeEditorQueue(options.device,options.client,options.scopeId,options.domain,options.objectId);
  this.#client=options.client;this.#domain=options.domain;this.#id=options.objectId;this.#validate=options.validate;this.#current=options.assertCurrent;this.#write=options.assertWrite;
 }
 async #decode(bytes:Uint8Array){const value=await this.#validate(parseLegacyMigrationJson(decoder.decode(bytes),'E2EE_PRIVATE_DOCUMENT_CORRUPT',64*1024*1024));this.#current();return value;}
 async load(mode:'online'|'offline'='online',expected?:Parameters<E2eeScopeClient['read']>[2]):Promise<PrivateDocumentView<T>>{
  this.#current();if(mode==='online')try{await this.#queue.recoverAcknowledgement();}catch(error){if(!(error instanceof Error)||error.message!=='E2EE_CONFLICT_REVIEW_STALE')throw error;}
  this.#current();const local=await this.#queue.load();this.#current();
  try{
   if(mode==='offline'){
    if(!local)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');
    return{value:await this.#decode(local.bytes),serial:local.serial,remoteRevision:local.remoteRevision,pending:local.pending,conflict:null};
   }
   const remote=await this.#client.read(this.#domain,this.#id,expected);this.#current();
   if(!remote){
    if(local?.pending&&local.remoteRevision===0)return{value:await this.#decode(local.bytes),serial:local.serial,remoteRevision:0,pending:true,conflict:null};
    throw new Error('E2EE_PRIVATE_DOCUMENT_MISSING');
   }
   try{
    const value=await this.#decode(remote.bytes);this.#current();
    if(local?.pending)return{value:await this.#decode(local.bytes),serial:local.serial,remoteRevision:local.remoteRevision,pending:true,
     conflict:remote.revision===local.remoteRevision?null:{value,revision:remote.revision}};
    if(local&&remote.revision===local.remoteRevision){
     if(local.bytes.length!==remote.bytes.length||local.bytes.some((byte,index)=>byte!==remote.bytes[index]))throw new Error('E2EE_PRIVATE_DOCUMENT_DIVERGED');
     return{value,serial:local.serial,remoteRevision:remote.revision,pending:false,conflict:null};
    }
    const serial=await this.#queue.reconcile(remote.bytes,local?.serial??null,remote.revision,undefined,'cache');this.#current();
    return{value,serial,remoteRevision:remote.revision,pending:false,conflict:null};
   }finally{remote.bytes.fill(0);}
  }finally{local?.bytes.fill(0);}
 }
 async save(input:T,expected:{serial:number|null;remoteRevision:number}):Promise<number>{
  this.#current();this.#write();const value=await this.#validate(structuredClone(input));this.#current();this.#write();const bytes=encoder.encode(JSON.stringify(value));
  try{const serial=await this.#queue.stage(bytes,expected.serial,expected.remoteRevision);this.#current();return serial;}finally{bytes.fill(0);}
 }
 async merge(input:T,expected:{serial:number|null;remoteRevision:number}){
  this.#current();this.#write();const value=await this.#validate(structuredClone(input));this.#current();this.#write();const bytes=encoder.encode(JSON.stringify(value));
  try{const serial=await this.#queue.reconcile(bytes,expected.serial,expected.remoteRevision);this.#current();return serial;}finally{bytes.fill(0);}
 }
 async flush(){this.#current();this.#write();const revision=await this.#queue.flush();this.#current();return revision;}
 async rebasePending(revision:number){this.#current();this.#write();return this.#queue.rebasePending(revision);}
 async reviewConflict(input:T,expected:{serial:number;remoteRevision:number}){
  this.#current();this.#write();const value=await this.#validate(structuredClone(input));this.#current();this.#write();const bytes=encoder.encode(JSON.stringify(value));
  try{const serial=await this.#queue.reviewConflict(bytes,expected.serial,expected.remoteRevision);this.#current();return serial;}finally{bytes.fill(0);}
 }
}

/** Client queries over one authenticated table snapshot. Domain-specific
 * operations still supply validation and fresh signed-role authorization; this
 * object cannot restore membership, billing, device trust or old queue actions. */
export class E2eePrivateTable{
 readonly document:E2eePrivateDocument<PrivateTableDocument>;
 constructor(options:Omit<ConstructorParameters<typeof E2eePrivateDocument<PrivateTableDocument>>[0],'domain'|'objectId'|'validate'>&{
  kind:PrivateScopeKind;pathId:string;table:string;validateRow:(input:unknown)=>Record<string,unknown>}){
  const source=privatePathSource(options.kind,options.pathId);if(!source.server.includes(options.table))throw new Error('E2EE_SOURCE_PATH_FORBIDDEN');
  const validate=(input:unknown):PrivateTableDocument=>{
   if(!input||typeof input!=='object'||Array.isArray(input))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');const value=input as Record<string,unknown>;
   if(value.format!=='genesis-private-table-v1'||value.pathId!==options.pathId||value.table!==options.table||value.execution!=='content-only'||!Array.isArray(value.rows)||value.rows.length>1000000
    ||Object.keys(value).some(name=>!['format','pathId','table','rows','execution'].includes(name)))throw new Error('E2EE_PRIVATE_DOCUMENT_CORRUPT');
   return{format:'genesis-private-table-v1',pathId:options.pathId,table:options.table,execution:'content-only',rows:value.rows.map(options.validateRow)};
  };
  this.document=new E2eePrivateDocument({...options,domain:privatePathDocumentDomain(options.kind,options.pathId),objectId:privateTableObjectId(options.pathId,options.table),validate});
 }
}
