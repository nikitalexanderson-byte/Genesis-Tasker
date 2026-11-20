import {canonicalE2eeValue,decodeCanonicalE2eeValue,type WireValue} from './commands.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {E2EE_CHUNK_BYTES} from './files.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import type {UnlockedE2eeVault,LocalWrite} from './storage.ts';

/** Read-only source access. Capture/publication still require the active vault;
 * an original-device recovery reader cannot sign, commit or become that actor. */
export type SourceStageReadVault=Pick<UnlockedE2eeVault,'assertUnlocked'|'localIdentity'|'read'|'listLocal'>;

export type SourceStageTarget=Readonly<{ownerId:string;scopeId:string;kind:'personal'|'project'|'space'}>;
type Context=SourceStageTarget&{actorId:string;actorScopeId:string;deviceId:string};
type Part={size:number;hash:string};
type Entry={id:string;size:number;parts:Part[];complete:boolean};
type Journal={protocol:1;stageId:string;context:Context;chunkSize:number;phase:'capturing'|'complete';entries:Entry[];manifestHash:string|null};
type Manifest={protocol:1;stageId:string;context:Context;chunkSize:number;entries:Entry[]};
type Catalog={protocol:1;context:Context;stages:{id:string;complete:boolean;manifestHash:string|null}[]};
export type SourceStageReference=Readonly<{stageId:string;manifestHash:string}>;
export type SourceStageCapacity=Readonly<{maximumBytes:number;maximumParts:number}>;
export type SourceStageAdmission=Readonly<{bytes:number;parts:number;metadataBytes:number}>;
export type SourceStageOptions={vault:UnlockedE2eeVault;target:SourceStageTarget;paths:readonly string[];capacity:SourceStageCapacity;
 ensureDurableKeys:()=>Promise<void>;assertCurrent:()=>void;admit:(request:SourceStageAdmission)=>Promise<void>};
const MAX_METADATA=2*1024*1024,MAX_PARTS=10000,MAX_STAGES=64;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function invalid():never{throw new Error('E2EE_CORRUPT_SOURCE_STAGE');}
function current(vault:SourceStageReadVault,check:()=>void){check();vault.assertUnlocked();}
function canonical(value:unknown){const bytes=canonicalE2eeValue(value as WireValue);if(bytes.length>MAX_METADATA){bytes.fill(0);throw new Error('E2EE_SOURCE_STAGE_METADATA_LIMIT');}return bytes;}
function parse(bytes:Uint8Array):unknown{
 if(bytes.length<1||bytes.length>MAX_METADATA)invalid();const value:unknown=decodeCanonicalE2eeValue(bytes,MAX_METADATA),encoded=canonical(value);
 try{if(encoded.length!==bytes.length||encoded.some((byte,index)=>byte!==bytes[index]))invalid();return value;}finally{encoded.fill(0);}
}
async function digest(bytes:Uint8Array){
 const captured=new Uint8Array(bytes);try{return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',captured)));}finally{captured.fill(0);}
}
async function identity(value:unknown){const bytes=canonical(value);try{return await digest(bytes);}finally{bytes.fill(0);}}
function context(vault:SourceStageReadVault,target:SourceStageTarget):Context{
 exactKeys(target,['ownerId','scopeId','kind']);const{ownerId,scopeId,kind}=target;assertTechnical(ownerId);assertTechnical(scopeId);
 if(!['personal','project','space'].includes(kind))invalid();const actor=vault.localIdentity();
 return{ownerId,scopeId,kind,actorId:actor.ownerId,actorScopeId:actor.scopeId,deviceId:actor.deviceId};
}
function sameContext(value:unknown,expected:Context){
 exactKeys(value,['ownerId','scopeId','kind','actorId','actorScopeId','deviceId']);
 for(const name of ['ownerId','scopeId','kind','actorId','actorScopeId','deviceId'] as const)if(value[name]!==expected[name])throw new Error('E2EE_SOURCE_STAGE_CONTEXT');
}
function stageId(value:string){if(!uuid.test(value))invalid();return value;}
function stageKey(hash:string,id:string,role:'j'|'m'|'p',path=0,part=0){
 decodeE2eeBytes(hash,32);stageId(id);if(!Number.isInteger(path)||path<0||path>19||!Number.isInteger(part)||part<0||part>=MAX_PARTS)invalid();
 return`source-stage:${hash}:${id}:${role}:${String(path).padStart(2,'0')}:${String(part).padStart(5,'0')}`;
}
function journalId(hash:string,id:string){return stageKey(hash,id,'j');}
function manifestId(hash:string,id:string){return stageKey(hash,id,'m');}
function partId(hash:string,id:string,path:number,part:number){return stageKey(hash,id,'p',path,part);}
function catalogId(hash:string){return'source-stage-catalog:'+hash;}
function entries(value:unknown,complete:boolean):Entry[]{
 if(!Array.isArray(value)||value.length<1||value.length>20)invalid();const seen=new Set<string>();let parts=0,unfinished=false;
 for(const row of value){
  exactKeys(row,['id','size','parts','complete']);assertTechnical(row.id);
  if(seen.has(row.id)||!Number.isSafeInteger(row.size)||(row.size as number)<0||typeof row.complete!=='boolean'||complete&&!row.complete||!Array.isArray(row.parts))invalid();seen.add(row.id);
  if(unfinished&&(row.complete||row.size!==0||row.parts.length!==0))invalid();if(!row.complete)unfinished=true;
  parts+=row.parts.length;if(parts>MAX_PARTS)invalid();let size=0;
  for(const [index,part]of row.parts.entries()){
   exactKeys(part,['size','hash']);if(!Number.isSafeInteger(part.size)||(part.size as number)<1||(part.size as number)>E2EE_CHUNK_BYTES
    ||index<row.parts.length-1&&part.size!==E2EE_CHUNK_BYTES)invalid();decodeE2eeBytes(part.hash,32);size+=part.size as number;
  }
  if(size!==row.size||row.complete&&size===0)invalid();
 }
 return value as Entry[];
}
function catalog(value:unknown,expected:Context):Catalog{
 exactKeys(value,['protocol','context','stages']);if(value.protocol!==1||!Array.isArray(value.stages)||value.stages.length>MAX_STAGES)invalid();sameContext(value.context,expected);const seen=new Set<string>();
 for(const row of value.stages){exactKeys(row,['id','complete','manifestHash']);if(typeof row.id!=='string'||seen.has(stageId(row.id))||typeof row.complete!=='boolean')invalid();seen.add(row.id);
  if(row.complete)decodeE2eeBytes(row.manifestHash,32);else if(row.manifestHash!==null)invalid();}
 return value as Catalog;
}
async function metadata(vault:SourceStageReadVault,id:string,check:()=>void){
 current(vault,check);const row=await vault.read('local-snapshot',id);
 try{current(vault,check);return row?{serial:row.serial,value:parse(row.value)}:null;}finally{row?.value.fill(0);}
}
function journal(value:unknown,scope:Context,id:string):Journal{
 exactKeys(value,['protocol','stageId','context','chunkSize','phase','entries','manifestHash']);
 if(value.protocol!==1||value.stageId!==id||value.chunkSize!==E2EE_CHUNK_BYTES||!['capturing','complete'].includes(value.phase as string))invalid();sameContext(value.context,scope);
 entries(value.entries,value.phase==='complete');if(value.phase==='complete')decodeE2eeBytes(value.manifestHash,32);else if(value.manifestHash!==null)invalid();
 return value as Journal;
}
/** Metadata/key checks happen under the caller's source fence. The second
 * catalog read also catches another creator/completer before classifying keys. */
async function knownCatalog(vault:SourceStageReadVault,scope:Context,hash:string,check:()=>void){
 const before=await metadata(vault,catalogId(hash),check),keys=await vault.listLocal('local-snapshot','source-stage:');current(vault,check);
 const after=await metadata(vault,catalogId(hash),check);if((before?.serial??null)!==(after?.serial??null))throw new Error('E2EE_SOURCE_STAGE_BUSY');
 const prefix=`source-stage:${hash}:`,owned:string[]=[];
 for(const key of keys){
  // Every new record carries its original target-context fingerprint in its
  // authenticated technical ID, including when an index/journal is missing.
  const fields=key.split(':');
  if(!/^source-stage:[A-Za-z0-9_-]{43}:[a-f0-9-]{36}:[jmp]:[0-9]{2}:[0-9]{5}$/.test(key)||!uuid.test(fields[2])||Number(fields[4])>19||Number(fields[5])>=MAX_PARTS
   ||fields[3]!=='p'&&(fields[4]!=='00'||fields[5]!=='00000'))throw new Error('E2EE_SOURCE_STAGE_UNBOUND_REMNANT');
  decodeE2eeBytes(fields[1],32);
  if(key.startsWith(prefix))owned.push(key);
 }
 if(!before){if(owned.length)throw new Error('E2EE_SOURCE_STAGE_UNBOUND_REMNANT');return null;}
 const index=catalog(before.value,scope),ids=new Set(index.stages.map(row=>row.id));
 for(const key of owned)if(!ids.has(key.slice(prefix.length,prefix.length+36)))throw new Error('E2EE_SOURCE_STAGE_UNBOUND_REMNANT');
 const present=new Set(owned),stamps:{id:string;serial:number}[]=[];
 for(const row of index.stages){
  if(!present.has(journalId(hash,row.id))||row.complete!==present.has(manifestId(hash,row.id)))invalid();
  const state=await metadata(vault,journalId(hash,row.id),check);if(!state)invalid();
  const body=journal(state.value,scope,row.id);stamps.push({id:row.id,serial:state.serial});
  if(row.complete!==(body.phase==='complete')||row.manifestHash!==body.manifestHash)invalid();
  const expected=new Set([journalId(hash,row.id)]);
  for(const [path,entry]of body.entries.entries())for(const part of entry.parts.keys())expected.add(partId(hash,row.id,path,part));
  if(row.complete){
   expected.add(manifestId(hash,row.id));const manifest=await metadata(vault,manifestId(hash,row.id),check);if(!manifest||manifest.serial!==1)invalid();
   exactKeys(manifest.value,['protocol','stageId','context','chunkSize','entries']);
   if(manifest.value.protocol!==1||manifest.value.stageId!==row.id||manifest.value.chunkSize!==E2EE_CHUNK_BYTES)invalid();sameContext(manifest.value.context,scope);
   entries(manifest.value.entries,true);if(await identity(manifest.value)!==row.manifestHash||await identity(manifest.value.entries)!==await identity(body.entries))invalid();
  }
  const actual=owned.filter(key=>key.startsWith(`source-stage:${hash}:${row.id}:`));
  if(actual.length!==expected.size||actual.some(key=>!expected.has(key)))throw new Error('E2EE_SOURCE_STAGE_UNBOUND_REMNANT');
 }
 // No stage is classified from a list taken before a concurrent append/create.
 for(const stamp of stamps){const row=await metadata(vault,journalId(hash,stamp.id),check);if(row?.serial!==stamp.serial)throw new Error('E2EE_SOURCE_STAGE_BUSY');}
 const final=await metadata(vault,catalogId(hash),check);if(final?.serial!==before.serial)throw new Error('E2EE_SOURCE_STAGE_BUSY');
 return{serial:before.serial,value:index,keys:owned};
}
function write(id:string,value:unknown,expected:number|null):LocalWrite{return{domain:'local-snapshot',objectId:id,value:canonical(value),expected};}
async function commit(vault:UnlockedE2eeVault,changes:LocalWrite[],check:()=>void){
 try{current(vault,check);await vault.write(changes);current(vault,check);}finally{changes.forEach(row=>row.value.fill(0));}
}

/** Local signed-AEAD quarantine only. A complete stage is still inert until the
 * coordinator publishes its own CAS pointer. No network/restore/ACL port exists.
 * Capacity admission is supplied by the actual storage owner, never inferred
 * from one fixture or a raised aggregate/heap limit. */
export class ProtectedSourceStage {
 #vault:UnlockedE2eeVault;#context:Context;#hash:string;#journal:Journal;#serial=1;#capacity:SourceStageCapacity;
 #check:()=>void;#admit:SourceStageOptions['admit'];#busy=false;#broken=false;
 private constructor(options:SourceStageOptions,scope:Context,hash:string,journal:Journal){
  this.#vault=options.vault;this.#context=scope;this.#hash=hash;this.#journal=journal;this.#capacity={...options.capacity};this.#check=options.assertCurrent;this.#admit=options.admit;
 }
 #current(){current(this.#vault,this.#check);if(this.#broken||this.#journal.phase!=='capturing')throw new Error('E2EE_SOURCE_STAGE_CLOSED');}
 static async create(options:SourceStageOptions){
  current(options.vault,options.assertCurrent);const scope=context(options.vault,options.target),paths=[...options.paths],capacity={...options.capacity};
  if(paths.length<1||paths.length>20||new Set(paths).size!==paths.length)invalid();paths.forEach(assertTechnical);
  if(!Number.isSafeInteger(capacity.maximumParts)||capacity.maximumParts<1||capacity.maximumParts>MAX_PARTS||!Number.isSafeInteger(capacity.maximumBytes)
   ||capacity.maximumBytes<1||capacity.maximumBytes>capacity.maximumParts*E2EE_CHUNK_BYTES)throw new Error('E2EE_SOURCE_STAGE_CAPACITY');
  const captured={...options,paths,capacity};await captured.ensureDurableKeys();current(captured.vault,captured.assertCurrent);
  const hash=await identity(scope),id=catalogId(hash),old=await knownCatalog(captured.vault,scope,hash,captured.assertCurrent),index=old?old.value:{protocol:1 as const,context:scope,stages:[]};
  if(index.stages.length>=MAX_STAGES)throw new Error('E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED');const stage=crypto.randomUUID();stageId(stage);
  const journal:Journal={protocol:1,stageId:stage,context:scope,chunkSize:E2EE_CHUNK_BYTES,phase:'capturing',entries:paths.map(id=>({id,size:0,parts:[],complete:false})),manifestHash:null};
  const next:Catalog={...index,stages:[...index.stages,{id:stage,complete:false,manifestHash:null}]};
  const changes=[write(id,next,old?.serial??null),write(journalId(hash,stage),journal,null)];
  try{await captured.admit({bytes:0,parts:0,metadataBytes:changes.reduce((sum,row)=>sum+row.value.length,0)});await commit(captured.vault,changes,captured.assertCurrent);}
  catch(error){changes.forEach(row=>row.value.fill(0));throw error;}
  return new ProtectedSourceStage(captured,scope,hash,journal);
 }
 async #append(index:number,bytes:Uint8Array){
  this.#current();const captured=new Uint8Array(bytes);let changes:LocalWrite[]=[];
  try{
   if(captured.length<1||captured.length>E2EE_CHUNK_BYTES)invalid();const next=structuredClone(this.#journal),entry=next.entries[index];
   if(entry.complete)invalid();entry.parts.push({size:captured.length,hash:await digest(captured)});entry.size+=captured.length;
   const size=next.entries.reduce((sum,row)=>sum+row.size,0),parts=next.entries.reduce((sum,row)=>sum+row.parts.length,0);
   if(size>this.#capacity.maximumBytes||parts>this.#capacity.maximumParts)throw new Error('E2EE_SOURCE_STAGE_CAPACITY');
   changes=[{domain:'local-snapshot',objectId:partId(this.#hash,next.stageId,index,entry.parts.length-1),value:captured,expected:null},write(journalId(this.#hash,next.stageId),next,this.#serial)];
   await this.#admit({bytes:size,parts,metadataBytes:changes[1].value.length});this.#current();await commit(this.#vault,changes,()=>this.#current());this.#journal=next;this.#serial++;
  }finally{captured.fill(0);changes.forEach(row=>row.value.fill(0));}
 }
 /** The caller retains originals until capture/whole-snapshot publication.
  * Buffer acceptance is not a durable-input or snapshot-completion receipt. */
 async capturePath(id:string,producer:(write:(chunk:Uint8Array)=>Promise<void>)=>Promise<void>){
  this.#current();if(this.#busy)throw new Error('E2EE_SOURCE_STAGE_BUSY');const index=this.#journal.entries.findIndex(row=>!row.complete);
  if(index<0||this.#journal.entries[index].id!==id)throw new Error('E2EE_SOURCE_STAGE_ORDER');this.#busy=true;
  const buffer=new Uint8Array(E2EE_CHUNK_BYTES);let count=0,writing=false,accepting=true,inFlight:Promise<void>|undefined;
  const accept=(value:Uint8Array)=>{
   let owns=false;
   const task=(async()=>{
    let input:Uint8Array|undefined,entered=false;
    try{this.#current();if(!accepting||writing||!(value instanceof Uint8Array)||value.length<1||value.length>E2EE_CHUNK_BYTES)throw new Error('E2EE_SOURCE_STAGE_INPUT');
     writing=true;entered=true;owns=true;input=new Uint8Array(value);let offset=0;while(offset<input.length){this.#current();const size=Math.min(input.length-offset,buffer.length-count);buffer.set(input.subarray(offset,offset+size),count);count+=size;offset+=size;
      if(count===buffer.length){await this.#append(index,buffer);buffer.fill(0);count=0;}}}
    catch(error){this.#broken=true;throw error;}finally{input?.fill(0);if(entered)writing=false;}
   })();
   // Drain an outstanding write even if a faulty producer returns/throws early.
   // Attach a rejection observer now, including for a swallowed invalid call.
   if(owns)inFlight=task;void task.catch(()=>{});return task;
  };
  try{
   await producer(accept);
   accepting=false;if(writing)throw new Error('E2EE_SOURCE_STAGE_INPUT');this.#current();if(count)await this.#append(index,buffer.subarray(0,count));
   const next=structuredClone(this.#journal);if(next.entries[index].size===0)throw new Error('E2EE_SOURCE_STAGE_EMPTY');next.entries[index].complete=true;
   await commit(this.#vault,[write(journalId(this.#hash,next.stageId),next,this.#serial)],()=>this.#current());this.#journal=next;this.#serial++;
  }catch(error){this.#broken=true;throw error;}finally{accepting=false;await inFlight?.catch(()=>{});buffer.fill(0);this.#busy=false;}
 }
 async finish():Promise<SourceStageReference>{
  this.#current();if(this.#busy||this.#journal.entries.some(row=>!row.complete))throw new Error('E2EE_SOURCE_STAGE_INCOMPLETE');this.#busy=true;
  try{
  const manifest:Manifest={protocol:1,stageId:this.#journal.stageId,context:this.#context,chunkSize:E2EE_CHUNK_BYTES,entries:structuredClone(this.#journal.entries)};
  // Read-back every sealed part before publishing even a local complete marker.
  for(const [path,row]of manifest.entries.entries())for(const [part,expected]of row.parts.entries()){
   const opened=await this.#vault.read('local-snapshot',partId(this.#hash,manifest.stageId,path,part));
   try{this.#current();if(!opened||opened.serial!==1||opened.value.length!==expected.size||await digest(opened.value)!==expected.hash)invalid();}finally{opened?.value.fill(0);}
  }
  const hash=await identity(manifest),id=catalogId(this.#hash),old=await knownCatalog(this.#vault,this.#context,this.#hash,()=>this.#current());if(!old)invalid();const index=old.value;
  const entry=index.stages.find(row=>row.id===manifest.stageId);if(!entry||entry.complete)invalid();entry.complete=true;entry.manifestHash=hash;
  const next:Journal={...this.#journal,phase:'complete',manifestHash:hash};
  const changes=[write(manifestId(this.#hash,manifest.stageId),manifest,null),write(journalId(this.#hash,manifest.stageId),next,this.#serial),write(id,index,old.serial)];
  try{
   await this.#admit({bytes:manifest.entries.reduce((sum,row)=>sum+row.size,0),parts:manifest.entries.reduce((sum,row)=>sum+row.parts.length,0),metadataBytes:changes.reduce((sum,row)=>sum+row.value.length,0)});
   await commit(this.#vault,changes,()=>this.#current());
  }finally{changes.forEach(row=>row.value.fill(0));}
  this.#journal=next;this.#serial++;return Object.freeze({stageId:manifest.stageId,manifestHash:hash});
  }catch(error){this.#broken=true;throw error;}finally{this.#busy=false;}
 }
}

/** Read-only restart discovery. Incomplete stages are explicit; nothing is
 * deleted, resumed, rebound, uploaded or treated as a completed empty source. */
export async function inspectSourceStages(vault:SourceStageReadVault,target:SourceStageTarget,check:()=>void){
 const scope=context(vault,target),hash=await identity(scope),old=await knownCatalog(vault,scope,hash,check);if(!old)return[];
 return old.value.stages.map(row=>Object.freeze({...row}));
}

/** Compare AND re-seal this exact complete catalogue in the coordinator's own
 * publication transaction. Any concurrent create/finish then loses a CAS;
 * there is no unguarded gap between source verification and pointer visibility.
 * The returned owned metadata bytes must be wiped by the transaction owner. */
export async function sourceStagePublicationGuard(vault:UnlockedE2eeVault,target:SourceStageTarget,references:readonly SourceStageReference[],check:()=>void):Promise<LocalWrite>{
 const refs=references.map(row=>{exactKeys(row,['stageId','manifestHash']);stageId(row.stageId);decodeE2eeBytes(row.manifestHash,32);return{...row};});
 const scope=context(vault,target),hash=await identity(scope),old=await knownCatalog(vault,scope,hash,check);current(vault,check);
 if(!old||refs.length<1||old.value.stages.length!==refs.length||old.value.stages.some((row,index)=>!row.complete||row.id!==refs[index].stageId||row.manifestHash!==refs[index].manifestHash))
  throw new Error('E2EE_SOURCE_STAGE_HISTORY_REVIEW_REQUIRED');
 return write(catalogId(hash),old.value,old.serial);
}

/** Opening authenticates metadata; consuming a path through actual EOF proves
 * its complete ordered bytes. Closing an iterator early proves no completeness. */
export async function openSourceStage(vault:SourceStageReadVault,target:SourceStageTarget,reference:SourceStageReference,check:()=>void){
 current(vault,check);const scope=context(vault,target);exactKeys(reference,['stageId','manifestHash']);const ref={stageId:reference.stageId,manifestHash:reference.manifestHash};stageId(ref.stageId);decodeE2eeBytes(ref.manifestHash,32);
 const hash=await identity(scope),row=await metadata(vault,manifestId(hash,ref.stageId),check);if(!row||row.serial!==1)invalid();exactKeys(row.value,['protocol','stageId','context','chunkSize','entries']);
 if(row.value.protocol!==1||row.value.stageId!==ref.stageId||row.value.chunkSize!==E2EE_CHUNK_BYTES)invalid();sameContext(row.value.context,scope);
 const manifest=row.value as unknown as Manifest;entries(manifest.entries,true);if(await identity(manifest)!==ref.manifestHash)invalid();
 const journal=await metadata(vault,journalId(hash,ref.stageId),check);if(!journal)invalid();exactKeys(journal.value,['protocol','stageId','context','chunkSize','phase','entries','manifestHash']);
 if(journal.value.protocol!==1||journal.value.stageId!==ref.stageId||journal.value.chunkSize!==E2EE_CHUNK_BYTES||journal.value.phase!=='complete'||journal.value.manifestHash!==ref.manifestHash)invalid();sameContext(journal.value.context,scope);
 entries(journal.value.entries,true);if(await identity(journal.value.entries)!==await identity(manifest.entries))invalid();
 const index=await knownCatalog(vault,scope,hash,check);if(!index)invalid();const marker=index.value.stages.find(value=>value.id===ref.stageId);
 if(!marker?.complete||marker.manifestHash!==ref.manifestHash)invalid();
 const expectedKeys=new Set([journalId(hash,ref.stageId),manifestId(hash,ref.stageId)]);
 for(const [path,entry]of manifest.entries.entries())for(const part of entry.parts.keys())expectedKeys.add(partId(hash,ref.stageId,path,part));
 const ownPrefix=`source-stage:${hash}:${ref.stageId}:`,actual=index.keys.filter(key=>key.startsWith(ownPrefix));
 if(actual.length!==expectedKeys.size||actual.some(key=>!expectedKeys.has(key)))throw new Error('E2EE_SOURCE_STAGE_UNBOUND_REMNANT');
 return Object.freeze({paths:Object.freeze(manifest.entries.map(row=>row.id)),
  storageUsage:Object.freeze({bytes:manifest.entries.reduce((total,row)=>total+row.size,0),parts:manifest.entries.reduce((total,row)=>total+row.parts.length,0)}),openPath(id:string){
  const path=manifest.entries.findIndex(row=>row.id===id);if(path<0)throw new Error('E2EE_SOURCE_STAGE_PATH');const entry=manifest.entries[path];let complete=false;
  const chunks=(async function*(){let total=0;
   for(const [part,expected]of entry.parts.entries()){
    current(vault,check);const opened=await vault.read('local-snapshot',partId(hash,manifest.stageId,path,part));
    try{current(vault,check);if(!opened||opened.serial!==1||opened.value.length!==expected.size||await digest(opened.value)!==expected.hash)invalid();current(vault,check);total+=opened.value.length;yield opened.value;current(vault,check);}
    finally{opened?.value.fill(0);}
   }
   if(total!==entry.size)invalid();current(vault,check);complete=true;
  })();
  return Object.freeze({chunks,assertComplete(){current(vault,check);if(!complete)throw new Error('E2EE_SOURCE_STAGE_EOF_REQUIRED');}});
 }});
}
