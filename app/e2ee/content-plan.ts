import {sha256} from '@noble/hashes/sha2.js';
import {snapshotE2eeValue} from './commands.ts';
import {E2EE_DOMAINS,E2EE_SUITE,decodeE2eeBytes,encodeE2eeBytes,e2eeAdditionalData,openE2eeEnvelope,sealE2eeEnvelope,verifyE2eeEnvelope,validateE2eeEnvelope,type E2eeContext,type E2eeEnvelope} from './envelope.ts';
import {E2EE_CHUNK_BYTES,E2EE_MAX_FILE_BYTES,envelopePayloadHash,openE2eeFileStream,sealE2eeFileStream} from './files.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {parseE2eeContentPlanJson} from './file-manifest-json.ts';
import {validateMigrationLocalEntries,type MigrationLocalEntry} from './migration-local.ts';
import {requiredPrivatePaths,type PrivateScopeKind} from './private-paths.ts';
import type {MigrationCoverage} from './migration.ts';
import type {UnlockedE2eeVault,LocalWrite} from './storage.ts';
import type {SourceStageReadVault} from './source-stage.ts';

type Target={ownerId:string;scopeId:string;kind:PrivateScopeKind};
type Placement='remote'|'local';
type PlanEnvelope={recordId:string;domain:E2eeContext['domain'];objectId:string;hash:string};
type Logical={domain:E2eeContext['domain'];objectId:string;plaintextHash:string;size:number;filename:string;mediaType:string;manifestRecordId:string};
type Pending={path:string;placement:Placement;domain:E2eeContext['domain'];objectId:string;size:number;filename:string;mediaType:string;recordId:string;parts:number};
type Manifest={protocol:1;attemptId:string;migrationId:string;sourceHash:string;target:Target;actor:{ownerId:string;scopeId:string;deviceId:string};context:E2eeContext;
 paths:string[];coverage:MigrationCoverage[];plan:PlanEnvelope[];logical:Logical[];local:MigrationLocalEntry[]};
type Journal=Omit<Manifest,'coverage'>&{phase:'writing';pending:Pending|null;bytes:number;localParts:number};
export type MigrationContentPlanReference=Readonly<{attemptId:string;manifestHash:string}>;
export type MigrationContentPlanCapacity=Readonly<{maximumBytes:number;maximumEnvelopes:number;maximumLocalParts:number}>;
export type MigrationContentPlanAdmission=Readonly<{bytes:number;envelopes:number;localParts:number;metadataBytes:number;additionalStorageBytes:number}>;
type Common={vault:SourceStageReadVault;root:CryptoKey;signer:CryptoKey;context:E2eeContext;target:Target;migrationId:string;sourceHash:string;paths:readonly string[];assertCurrent:()=>void};
export type MigrationContentPlanOptions=Common&{vault:UnlockedE2eeVault;signingKey:CryptoKey;capacity:MigrationContentPlanCapacity;admit:(request:MigrationContentPlanAdmission)=>Promise<void>;
 ensureDurableKeys:()=>Promise<void>;assertSourceComplete:()=>Promise<void>;attemptId?:string};
export type MigrationContentStream={placement:Placement;domain:E2eeContext['domain'];objectId:string;size:number;source:AsyncIterable<Uint8Array>;filename?:string;mediaType?:string};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),MAX_METADATA=16*1024*1024;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
function invalid():never{throw new Error('E2EE_CORRUPT_CONTENT_PLAN');}
async function digest(bytes:Uint8Array){return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes))));}
function encode(value:unknown){const bytes=encoder.encode(JSON.stringify(value));if(bytes.length>MAX_METADATA){bytes.fill(0);throw new Error('E2EE_CONTENT_PLAN_METADATA_LIMIT');}return bytes;}
function id(attempt:string,suffix:string){return`content-plan:${attempt}:${suffix}`;}
function context(options:Common){
 exactKeys(options.target,['ownerId','scopeId','kind']);assertTechnical(options.migrationId);decodeE2eeBytes(options.sourceHash,32);e2eeAdditionalData(options.context);
 if(options.context.cryptoProtocol!==1||options.context.suite!==E2EE_SUITE||options.context.schemaVersion!==1||options.context.writerProtocol!==9||options.context.revision!==1
  ||options.target.ownerId!==options.context.ownerId||options.target.scopeId!==options.context.scopeId||options.context.deviceId!==options.vault.localIdentity().deviceId)invalid();
 const required=requiredPrivatePaths(options.target.kind).map(path=>path.id);
 if(options.paths.length!==required.length||options.paths.some((path,index)=>path!==required[index]))throw new Error('E2EE_SOURCE_ADAPTER_REQUIRED');
}
function current(options:Common){options.assertCurrent();options.vault.assertUnlocked();}
function captured<T extends Common>(input:T):T{return{...input,context:snapshotE2eeValue(input.context),target:{...input.target},paths:[...input.paths]};}
function equal(left:unknown,right:unknown){return JSON.stringify(left)===JSON.stringify(right);}
function fields(value:unknown,expected:Record<string,unknown>){exactKeys(value,Object.keys(expected));return Object.keys(expected).every(key=>value[key]===expected[key]);}
async function commit(options:Common&{vault:UnlockedE2eeVault},changes:LocalWrite[]){try{current(options);await options.vault.write(changes,()=>current(options));current(options);}finally{changes.forEach(row=>row.value.fill(0));}}
function write(objectId:string,value:unknown,expected:number|null):LocalWrite{return{domain:'local-snapshot',objectId,value:encode(value),expected};}
async function metadata(options:Common,objectId:string){
 current(options);const row=await options.vault.read('local-snapshot',objectId);if(!row)invalid();
 try{current(options);if(row.value.length>MAX_METADATA)invalid();const value=parseE2eeContentPlanJson(row.value);
  return{serial:row.serial,bytes:new Uint8Array(row.value),value};}
 finally{row.value.fill(0);}
}
async function sealed(options:Common,item:PlanEnvelope){
 current(options);const row=await options.vault.read('outbox',item.recordId);if(!row)invalid();
 try{
  current(options);if(row.serial!==1)invalid();
  const value=parseLegacyMigrationJson(decoder.decode(row.value),'E2EE_CORRUPT_CONTENT_PLAN',MAX_METADATA) as E2eeEnvelope;
  if(value.context.domain!==item.domain||value.context.objectId!==item.objectId||await envelopePayloadHash(value)!==item.hash)invalid();current(options);
  const expected={...options.context,domain:item.domain,objectId:item.objectId,operationId:value.context.operationId};
  if(!equal(value.context,expected)){
   // Context equality is semantic: insertion order differs across native JSON.
   for(const key of Object.keys(expected) as (keyof E2eeContext)[])if(value.context[key]!==expected[key])invalid();
  }
  return value;
 }finally{row.value.fill(0);}
}
function validate(options:Common,value:unknown,attempt:string,allowEmpty=false):Manifest{
 exactKeys(value,['protocol','attemptId','migrationId','sourceHash','target','actor','context','paths','coverage','plan','logical','local']);
 const row=value as unknown as Manifest;
 if(row.protocol!==1||row.attemptId!==attempt||!uuid.test(attempt)||row.migrationId!==options.migrationId||row.sourceHash!==options.sourceHash
  ||!fields(row.target,options.target)||!fields(row.actor,options.vault.localIdentity())||!equal(row.paths,options.paths))invalid();
 exactKeys(row.context,Object.keys(options.context));for(const key of Object.keys(options.context) as (keyof E2eeContext)[])if(row.context[key]!==options.context[key])invalid();
 if(!Array.isArray(row.plan)||row.plan.length>8000||!Array.isArray(row.logical)||!Array.isArray(row.local)||!allowEmpty&&row.logical.length+row.local.length<1||row.logical.length+row.local.length>10000)invalid();
 if(!Array.isArray(row.coverage)||row.coverage.length!==options.paths.length||row.coverage.some((entry,index)=>{exactKeys(entry,['domain','complete']);return entry.domain!==options.paths[index]||entry.complete!==true;}))invalid();
 const seen=new Set<string>(),envelopes=new Set<string>(),records=new Set<string>();
 for(const[itemIndex,item]of row.plan.entries()){
  exactKeys(item,['recordId','domain','objectId','hash']);assertTechnical(item.objectId);decodeE2eeBytes(item.hash,32);
  if(item.recordId!==`${attempt}:upload:${itemIndex}`||!E2EE_DOMAINS.includes(item.domain)||envelopes.has(item.domain+'\0'+item.objectId))invalid();
  envelopes.add(item.domain+'\0'+item.objectId);records.add(item.recordId);
 }
 for(const logical of row.logical){
  exactKeys(logical,['domain','objectId','plaintextHash','size','filename','mediaType','manifestRecordId']);assertTechnical(logical.objectId);decodeE2eeBytes(logical.plaintextHash,32);
  if(!options.paths.some(path=>requiredPrivatePaths(options.target.kind).find(row=>row.id===path)?.domains.includes(logical.domain))||!Number.isSafeInteger(logical.size)||logical.size<0||logical.size>E2EE_MAX_FILE_BYTES
   ||logical.domain==='shared-comment'&&logical.size>65536||typeof logical.filename!=='string'||logical.filename.length>512||typeof logical.mediaType!=='string'||logical.mediaType.length>128
   ||seen.has(logical.domain+'\0'+logical.objectId))invalid();
  const manifest=row.plan.find(item=>item.recordId===logical.manifestRecordId);if(!manifest||manifest.domain!==logical.domain||manifest.objectId!==logical.objectId)invalid();
  seen.add(logical.domain+'\0'+logical.objectId);
 }
 const allowed=[...new Set(requiredPrivatePaths(options.target.kind).flatMap(path=>path.domains))] as E2eeContext['domain'][];
 validateMigrationLocalEntries(row.local,attempt,allowed);
 for(const local of row.local){if(seen.has(local.domain+'\0'+local.objectId))invalid();seen.add(local.domain+'\0'+local.objectId);}
 if(records.size!==row.plan.length)invalid();return row;
}
async function verifyRecords(options:Common,value:Pick<Manifest,'attemptId'|'plan'|'logical'|'local'>,load:(item:PlanEnvelope)=>Promise<E2eeEnvelope>=item=>sealed(options,item)){
 const byId=new Map(value.plan.map(item=>[item.domain+'\0'+item.objectId,item]));const used=new Set<string>();
 for(const logical of value.logical){
  const descriptor=value.plan.find(item=>item.recordId===logical.manifestRecordId);if(!descriptor)invalid();const manifest=await load(descriptor),hash=sha256.create();let size=0;
  try{
   if(logical.domain==='shared-comment'){
    const bytes=await openE2eeEnvelope(options.root,options.signer,manifest.context,manifest);try{current(options);hash.update(bytes);size=bytes.length;}finally{bytes.fill(0);}
   }else{
    const opened=await openE2eeFileStream({root:options.root,signer:options.signer,expectedContext:manifest.context,manifestEnvelope:manifest,assertCurrent:()=>current(options),
     fetchChunk:async objectId=>{const item=byId.get('attachment\0'+objectId);if(!item||used.has(item.recordId))invalid();used.add(item.recordId);return load(item);},
     writeQuarantinedPlaintext:async bytes=>{hash.update(bytes);size+=bytes.length;}});
    if(opened.filename!==logical.filename||opened.mediaType!==logical.mediaType||opened.size!==logical.size)invalid();
   }
   const result=hash.digest();try{if(size!==logical.size||encodeE2eeBytes(result)!==logical.plaintextHash)invalid();}finally{result.fill(0);}
   if(used.has(descriptor.recordId))invalid();used.add(descriptor.recordId);current(options);
  }finally{hash.destroy();}
 }
 if(used.size!==value.plan.length)invalid();
 for(const local of value.local){const hash=sha256.create();let size=0;try{
  for(let part=0;part<local.parts;part++){
   current(options);const row=await options.vault.read('local-snapshot',`${local.recordId}:${part}`);if(!row)invalid();
   try{current(options);if(row.serial!==1||row.value.length!==Math.min(E2EE_CHUNK_BYTES,local.size-size))invalid();hash.update(row.value);size+=row.value.length;}finally{row.value.fill(0);}
  }
  const result=hash.digest();try{if(size!==local.size||encodeE2eeBytes(result)!==local.plaintextHash)invalid();}finally{result.fill(0);}current(options);
 }finally{hash.destroy();}}
}
async function inventory(options:Common,value:Pick<Manifest,'attemptId'|'plan'|'local'>,complete:boolean){
 const exact=async(domain:E2eeContext['domain'],prefix:string,expected:string[])=>{
  current(options);const actual=await options.vault.listLocal(domain,prefix);current(options);
  const names=new Set(expected);if(actual.length!==names.size||actual.some(name=>!names.has(name)))invalid();
 };
 await exact('outbox',`${value.attemptId}:`,value.plan.map(row=>row.recordId));
 await exact('local-snapshot',`${value.attemptId}:`,value.local.flatMap(row=>Array.from({length:row.parts},(_,part)=>`${row.recordId}:${part}`)));
 await exact('local-snapshot',`content-plan:${value.attemptId}:`,[id(value.attemptId,'journal'),...(complete?[id(value.attemptId,'manifest')]:[])]);
}

/** A complete local quarantine manifest is still inert. The coordinator must
 * bind this exact plan to its committed source/lease with its own CAS before
 * transport. No source, legacy key, accepted prefix or failed attempt is erased. */
export class ProtectedMigrationContentPlan {
 #options:MigrationContentPlanOptions;#journal:Journal;#serial=1;#busy=false;#broken=false;#finished=false;
 private constructor(options:MigrationContentPlanOptions,journal:Journal){this.#options=options;this.#journal=journal;}
 get attemptId(){return this.#journal.attemptId;}
 static async create(input:MigrationContentPlanOptions){
  const options={...captured(input),capacity:{...input.capacity}};current(options);context(options);
  const limit=options.capacity;if(!Number.isSafeInteger(limit.maximumBytes)||limit.maximumBytes<1||!Number.isSafeInteger(limit.maximumEnvelopes)||limit.maximumEnvelopes<1||limit.maximumEnvelopes>8000
   ||!Number.isSafeInteger(limit.maximumLocalParts)||limit.maximumLocalParts<1||limit.maximumLocalParts>8000)throw new Error('E2EE_CONTENT_PLAN_CAPACITY');
  const attemptId=options.attemptId??crypto.randomUUID();if(!uuid.test(attemptId))invalid();
  const journal:Journal={protocol:1,attemptId,migrationId:options.migrationId,sourceHash:options.sourceHash,target:options.target,actor:options.vault.localIdentity(),
   context:options.context,paths:[...options.paths],phase:'writing',pending:null,bytes:0,localParts:0,plan:[],logical:[],local:[]};
  const result=new ProtectedMigrationContentPlan(options,journal);await options.ensureDurableKeys();current(options);await result.#store(journal,[],true);return result;
 }
 #current(){current(this.#options);if(this.#broken||this.#finished)throw new Error('E2EE_CONTENT_PLAN_CLOSED');}
 async #store(next:Journal,extra:LocalWrite[]=[],initial=false){
  const changes=[...extra];
  try{
   changes.push(write(id(next.attemptId,'journal'),next,initial?null:this.#serial));
   const metadataBytes=changes.at(-1)!.value.length,newBytes=changes.reduce((total,row)=>total+row.value.length,0);
   await this.#options.admit({bytes:next.bytes,envelopes:next.plan.length,localParts:next.localParts,metadataBytes,additionalStorageBytes:newBytes*2+8192*changes.length});this.#current();
   await commit({...this.#options,assertCurrent:()=>this.#current()},changes);this.#journal=next;if(!initial)this.#serial++;
  }finally{changes.forEach(row=>row.value.fill(0));}
 }
 async #remote(envelope:E2eeEnvelope){
  this.#current();const next=structuredClone(this.#journal);if(next.plan.length>=this.#options.capacity.maximumEnvelopes)throw new Error('E2EE_CONTENT_PLAN_CAPACITY');
  const value=snapshotE2eeValue(envelope),recordId=`${this.attemptId}:upload:${next.plan.length}`,hash=await envelopePayloadHash(value);this.#current();
  next.plan.push({recordId,domain:value.context.domain,objectId:value.context.objectId,hash});
  await this.#store(next,[{domain:'outbox',objectId:recordId,value:encode(value),expected:null}]);return recordId;
 }
 async #local(bytes:Uint8Array){
  this.#current();const next=structuredClone(this.#journal),pending=next.pending;if(!pending||next.localParts>=this.#options.capacity.maximumLocalParts)throw new Error('E2EE_CONTENT_PLAN_CAPACITY');
  const recordId=`${pending.recordId}:${pending.parts++}`;next.localParts++;
  await this.#store(next,[{domain:'local-snapshot',objectId:recordId,value:new Uint8Array(bytes),expected:null}]);
 }
 async append(path:string,input:MigrationContentStream){
  this.#current();if(this.#busy)throw new Error('E2EE_CONTENT_PLAN_BUSY');
  const record={...input,filename:input.filename??'',mediaType:input.mediaType??'application/json'},allowed=requiredPrivatePaths(this.#options.target.kind).find(row=>row.id===path);
  assertTechnical(record.objectId);
  if(!allowed||!this.#options.paths.includes(path)||!allowed.domains.includes(record.domain)||!['remote','local'].includes(record.placement)||!Number.isSafeInteger(record.size)||record.size<0||record.size>E2EE_MAX_FILE_BYTES
   ||record.domain==='shared-comment'&&record.size>65536||typeof record.filename!=='string'||record.filename.length>512||typeof record.mediaType!=='string'||record.mediaType.length>128
   ||[...this.#journal.logical,...this.#journal.local].some(row=>row.domain===record.domain&&row.objectId===record.objectId)||this.#journal.logical.length+this.#journal.local.length>=10000)throw new Error('E2EE_INVALID_SOURCE_RESULT');
  if(this.#journal.bytes+record.size>this.#options.capacity.maximumBytes)throw new Error('E2EE_CONTENT_PLAN_CAPACITY');
  const iterator=record.source[Symbol.asyncIterator](),pull=iterator.next.bind(iterator),stop=iterator.return?.bind(iterator);this.#current();
  this.#busy=true;const hash=sha256.create(),check=()=>this.#current();let total=0,ended=false,closed=false,failed=false,failure:unknown;
  const close=async()=>{if(!ended&&!closed){closed=true;await stop?.();}};
  const source=(async function*(){try{while(true){check();const next=await pull();check();if(next.done){ended=true;break;}const value=next.value;
   if(!(value instanceof Uint8Array)||value.length<1||value.length>E2EE_CHUNK_BYTES||total+value.length>record.size)throw new Error('E2EE_INVALID_FILE_STREAM');
   const bytes=new Uint8Array(value);try{hash.update(bytes);total+=bytes.length;yield bytes;check();}finally{bytes.fill(0);}}
   check();if(total!==record.size)throw new Error('E2EE_INVALID_FILE_STREAM');}finally{await close();}})();
  try{
   const next=structuredClone(this.#journal);next.pending={path,placement:record.placement,domain:record.domain,objectId:record.objectId,size:record.size,filename:record.filename,mediaType:record.mediaType,
    recordId:record.placement==='local'?`${this.attemptId}:private:${next.local.length}`:'',parts:0};next.bytes+=record.size;await this.#store(next);
   let manifestRecordId='';
   if(record.placement==='remote'){
    const expected={...this.#options.context,domain:record.domain,objectId:record.objectId,operationId:crypto.randomUUID()};
    if(record.domain==='shared-comment'){
     const bytes=new Uint8Array(record.size);let at=0;try{for await(const part of source){bytes.set(part,at);at+=part.length;}
      this.#current();const value=await sealE2eeEnvelope(this.#options.root,this.#options.signingKey,expected,bytes);this.#current();manifestRecordId=await this.#remote(value);
     }finally{bytes.fill(0);}
    }else{
     const manifest=await sealE2eeFileStream({root:this.#options.root,signingKey:this.#options.signingKey,context:expected,size:record.size,source,metadata:{filename:record.filename,mediaType:record.mediaType},
      assertCurrent:()=>this.#current(),writeQuarantinedChunk:async value=>{await this.#remote(value);}});manifestRecordId=await this.#remote(manifest);
    }
   }else{
    const buffer=new Uint8Array(E2EE_CHUNK_BYTES);let filled=0;try{for await(const bytes of source){let at=0;while(at<bytes.length){const count=Math.min(buffer.length-filled,bytes.length-at);buffer.set(bytes.subarray(at,at+count),filled);at+=count;filled+=count;
     if(filled===buffer.length){await this.#local(buffer);buffer.fill(0);filled=0;}}}if(filled)await this.#local(buffer.subarray(0,filled));}finally{buffer.fill(0);}
   }
   this.#current();const result=hash.digest();let plaintextHash:string;try{plaintextHash=encodeE2eeBytes(result);}finally{result.fill(0);}
   const completed=structuredClone(this.#journal),pending=completed.pending;if(!pending)invalid();completed.pending=null;
   if(record.placement==='remote')completed.logical.push({domain:record.domain,objectId:record.objectId,size:record.size,plaintextHash,filename:record.filename,mediaType:record.mediaType,manifestRecordId});
   else completed.local.push({domain:record.domain,objectId:record.objectId,recordId:pending.recordId,parts:pending.parts,size:record.size,plaintextHash,filename:record.filename,mediaType:record.mediaType});
   // Authenticate the newly completed record before its journal receipt.
   const just={attemptId:this.attemptId,plan:[] as PlanEnvelope[],
    logical:record.placement==='remote'?[completed.logical.at(-1)!]:[],local:record.placement==='local'?[completed.local.at(-1)!]:[]};
   if(record.placement==='remote'){
    // The start index was recorded by the last completed manifest, including
    // shared comments (one envelope, no implicit attachment chunks).
    const previous=this.#journal.logical.at(-1),start=previous?completed.plan.findIndex(row=>row.recordId===previous.manifestRecordId)+1:0;just.plan=completed.plan.slice(start);
   }
   await verifyRecords(this.#options,just);this.#current();await this.#store(completed);
  }catch(error){this.#broken=true;failed=true;failure=error;}
  finally{hash.destroy();try{await source.return(undefined);await close();}catch(error){this.#broken=true;if(!failed){failed=true;failure=error;}}this.#busy=false;}
  if(failed)throw failure;
 }
 async finish(input:readonly MigrationCoverage[]):Promise<MigrationContentPlanReference>{
  this.#current();if(this.#busy||this.#journal.pending)throw new Error('E2EE_CONTENT_PLAN_BUSY');this.#busy=true;
  const coverage=input.map(row=>({...row}));
  try{
   const manifest:Manifest={protocol:1,attemptId:this.attemptId,migrationId:this.#options.migrationId,sourceHash:this.#options.sourceHash,target:this.#options.target,actor:this.#journal.actor,context:this.#options.context,
    paths:[...this.#options.paths],coverage,plan:this.#journal.plan,logical:this.#journal.logical,local:this.#journal.local};
   validate(this.#options,manifest,this.attemptId);await this.#options.assertSourceComplete();this.#current();await inventory(this.#options,manifest,false);await verifyRecords(this.#options,manifest);this.#current();
   const bytes=encode(manifest);try{
    const manifestHash=await digest(bytes);this.#current();const complete={protocol:1,attemptId:this.attemptId,phase:'complete',manifestHash};
    const changes=[{domain:'local-snapshot' as const,objectId:id(this.attemptId,'manifest'),value:bytes,expected:null},write(id(this.attemptId,'journal'),complete,this.#serial)];
    try{await this.#options.admit({bytes:this.#journal.bytes,envelopes:manifest.plan.length,localParts:this.#journal.localParts,metadataBytes:bytes.length+changes[1].value.length,
     additionalStorageBytes:(bytes.length+changes[1].value.length)*2+16384});this.#current();await this.#options.assertSourceComplete();this.#current();await commit({...this.#options,assertCurrent:()=>this.#current()},changes);this.#finished=true;
    }finally{changes.forEach(row=>row.value.fill(0));}
    return Object.freeze({attemptId:this.attemptId,manifestHash});
   }finally{bytes.fill(0);}
  }catch(error){this.#broken=true;throw error;}finally{this.#busy=false;}
 }
 close(){this.#broken=true;}
}

export type MigrationContentPlanInspection=Readonly<{phase:'missing'|'writing'|'complete';reference:MigrationContentPlanReference|null;
 records:number;bytes:number;metadataBytes:number;metadataIds:readonly string[]}>;
/** Discover only an EXACT coordinator-reserved attempt. Partial outputs remain
 * inert; all their rows are authenticated and accounted, never silently ignored.
 * This does not grant a source/plan publication, resume, upload or activation. */
export async function inspectMigrationContentPlanAttempt(input:Common&{attemptId:string;reference:MigrationContentPlanReference|null}):Promise<MigrationContentPlanInspection>{
 const options=captured(input),attempt=input.attemptId,expectedReference=input.reference===null?null:{...input.reference};current(options);context(options);if(!uuid.test(attempt))invalid();
 if(expectedReference){exactKeys(expectedReference,['attemptId','manifestHash']);if(expectedReference.attemptId!==attempt)invalid();decodeE2eeBytes(expectedReference.manifestHash,32);}
 let records=0,bytes=0,metadataBytes=0;
 const count=async(domain:E2eeContext['domain'],names:readonly string[],isMetadata=false)=>{
  for(const objectId of names){current(options);const row=await options.vault.read(domain,objectId);if(!row)invalid();
   try{current(options);records++;bytes+=row.value.length;if(isMetadata)metadataBytes+=row.value.length;}finally{row.value.fill(0);}}
 };
 const names=await options.vault.listLocal('local-snapshot',`content-plan:${attempt}:`);current(options);
 if(!names.includes(id(attempt,'journal'))){
  if(expectedReference||names.length)invalid();
  for(const domain of ['outbox','local-snapshot'] as const){const found=await options.vault.listLocal(domain,attempt+':');current(options);if(found.length)invalid();}
  return Object.freeze({phase:'missing',reference:null,records,bytes,metadataBytes,metadataIds:Object.freeze([])});
 }
 const marker=await metadata(options,id(attempt,'journal'));let reference:MigrationContentPlanReference|null=null;
 try{
  if((marker.value as {phase?:unknown}|null)?.phase==='complete'){
   exactKeys(marker.value,['protocol','attemptId','phase','manifestHash']);
   const row=marker.value as unknown as {protocol:number;attemptId:string;manifestHash:string};
   if(row.protocol!==1||row.attemptId!==attempt||marker.serial<2)invalid();decodeE2eeBytes(row.manifestHash,32);
   reference=Object.freeze({attemptId:attempt,manifestHash:row.manifestHash});
   if(expectedReference&&reference.manifestHash!==expectedReference.manifestHash)invalid();await openMigrationContentPlan({...options,reference});current(options);
  }else{
   const value=marker.value as unknown as Journal;
   if(expectedReference)invalid();
   exactKeys(value,['protocol','attemptId','migrationId','sourceHash','target','actor','context','paths','phase','pending','bytes','localParts','plan','logical','local']);
   if(value.phase!=='writing')invalid();
   const {pending,bytes:total,localParts}=value,common={protocol:value.protocol,attemptId:value.attemptId,migrationId:value.migrationId,sourceHash:value.sourceHash,
    target:value.target,actor:value.actor,context:value.context,paths:value.paths,plan:value.plan,logical:value.logical,local:value.local};
   validate(options,{...common,coverage:options.paths.map(domain=>({domain,complete:true}))},attempt,true);
   if(!Number.isSafeInteger(total)||total<0||!Number.isSafeInteger(localParts)||localParts<0||localParts>8000)invalid();
   const local=[...value.local];let expectedBytes=[...value.logical,...local].reduce((sum,row)=>sum+row.size,0),expectedParts=local.reduce((sum,row)=>sum+row.parts,0);
   if(pending!==null){
    exactKeys(pending,['path','placement','domain','objectId','size','filename','mediaType','recordId','parts']);assertTechnical(pending.objectId);
    const path=requiredPrivatePaths(options.target.kind).find(row=>row.id===pending.path);
    if(!path?.domains.includes(pending.domain)||!['remote','local'].includes(pending.placement)||!Number.isSafeInteger(pending.size)||pending.size<0||pending.size>E2EE_MAX_FILE_BYTES
     ||pending.domain==='shared-comment'&&pending.size>65536||typeof pending.filename!=='string'||pending.filename.length>512||typeof pending.mediaType!=='string'||pending.mediaType.length>128
     ||!Number.isSafeInteger(pending.parts)||pending.parts<0||pending.parts>8000||[...value.logical,...local].some(row=>row.domain===pending.domain&&row.objectId===pending.objectId))invalid();
    if(pending.placement==='remote'){if(pending.recordId!==''||pending.parts!==0)invalid();}
    else{
     if(pending.recordId!==`${attempt}:private:${local.length}`||pending.parts>Math.ceil(pending.size/E2EE_CHUNK_BYTES))invalid();
     local.push({...pending,plaintextHash:encodeE2eeBytes(new Uint8Array(32))});expectedParts+=pending.parts;
    }
    expectedBytes+=pending.size;
   }
   if(total!==expectedBytes||localParts!==expectedParts)invalid();
   await inventory(options,{attemptId:attempt,plan:value.plan,local},false);current(options);
   const last=value.logical.at(-1),end=last?value.plan.findIndex(row=>row.recordId===last.manifestRecordId)+1:0;
   if(!pending||pending.placement!=='remote'){if(end!==value.plan.length)invalid();}
   await verifyRecords(options,{attemptId:attempt,plan:value.plan.slice(0,end),logical:value.logical,local:value.local});current(options);
   // An interrupted file can lack its final per-file-key manifest. Authenticate
   // the retained envelope/signature and outer vault, but never claim plaintext
   // completeness for that pending suffix.
   for(const item of value.plan.slice(end)){
    const envelope=await sealed(options,item);await verifyE2eeEnvelope(envelope,envelope.context,options.signer);current(options);
   }
   if(pending?.placement==='local')for(let part=0;part<pending.parts;part++){
    const row=await options.vault.read('local-snapshot',`${pending.recordId}:${part}`);if(!row)invalid();
    try{current(options);if(row.serial!==1||row.value.length!==Math.min(E2EE_CHUNK_BYTES,pending.size-part*E2EE_CHUNK_BYTES))invalid();}finally{row.value.fill(0);}
   }
  }
  // Count the actual retained rows, including encrypted-prefix outputs whose
  // logical record has not completed. Physical ciphertext overhead is separately
  // charged by the mandatory provider admission.
  const outbox=await options.vault.listLocal('outbox',attempt+':'),local=await options.vault.listLocal('local-snapshot',attempt+':');current(options);
  await count('outbox',outbox);await count('local-snapshot',local);await count('local-snapshot',names,true);current(options);
  return Object.freeze({phase:reference?'complete':'writing',reference,records,bytes,metadataBytes,metadataIds:Object.freeze([...names])});
 }finally{marker.bytes.fill(0);}
}

/** Reads/authenticates an inert complete local plan; never uploads or grants
 * product restoration. Original source/lease/CAS validation belongs to the
 * coordinator, which must also reconcile every partial/previous source. */
export async function openMigrationContentPlan(input:Common&{reference:MigrationContentPlanReference}){
 const options=captured(input),reference={...input.reference};current(options);context(options);exactKeys(reference,['attemptId','manifestHash']);if(!uuid.test(reference.attemptId))invalid();decodeE2eeBytes(reference.manifestHash,32);
 const marker=await metadata(options,id(reference.attemptId,'journal'));
 try{exactKeys(marker.value,['protocol','attemptId','phase','manifestHash']);const row=marker.value;if(row.protocol!==1||row.phase!=='complete'||row.attemptId!==reference.attemptId||row.manifestHash!==reference.manifestHash)invalid();}
 finally{marker.bytes.fill(0);}
 const stored=await metadata(options,id(reference.attemptId,'manifest'));
 try{
  if(stored.serial!==1||await digest(stored.bytes)!==reference.manifestHash)invalid();current(options);const manifest=validate(options,stored.value,reference.attemptId);
  await inventory(options,manifest,true);await verifyRecords(options,manifest);await inventory(options,manifest,true);current(options);
  const result=structuredClone(manifest);for(const rows of [result.plan,result.logical,result.local,result.coverage]){rows.forEach(Object.freeze);Object.freeze(rows);}Object.freeze(result.paths);Object.freeze(result.target);Object.freeze(result.actor);Object.freeze(result.context);
  return Object.freeze(result);
 }finally{stored.bytes.fill(0);}
}

/** Readable user values of an authenticated retained attempt. A writing
 * journal contributes only its completed logical/local records; its unfinished
 * cipher suffix remains protected evidence, never invented plaintext or a
 * complete-plan/activation proof. Control/source-opening metadata is excluded. */
export async function retainedMigrationPlanValues(input:Common&{attemptId:string;reference:MigrationContentPlanReference|null}){
 const options=captured(input),inspection=await inspectMigrationContentPlanAttempt(options);current(options);
 if(inspection.reference){const opened=await openMigrationContentPlan({...options,reference:inspection.reference});return{plan:opened.plan,logical:opened.logical,local:opened.local};}
 if(inspection.phase==='missing')return{plan:[],logical:[],local:[]};
 const raw=await metadata(options,id(input.attemptId,'journal'));
 try{const journal=raw.value as unknown as Journal;
  if(journal.phase!=='writing')invalid();const last=journal.logical.at(-1),end=last?journal.plan.findIndex(row=>row.recordId===last.manifestRecordId)+1:0;
  return structuredClone({plan:journal.plan.slice(0,end),logical:journal.logical,local:journal.local});
 }finally{raw.bytes.fill(0);}
}

export type MigrationContentPlanReadback=Readonly<{
 forEachEnvelope:(consume:(envelope:E2eeEnvelope)=>Promise<void>)=>Promise<number>;
 getEnvelope:(domain:E2eeContext['domain'],objectId:string)=>Promise<E2eeEnvelope|null>;
}>;
/** Full inventory/signature and original-byte readback of an inert plan. The
 * coordinator must supply the pinned shadow-generation transport and bind the
 * returned reference to its source/lease/CAS; this grants no activation. No
 * ciphertext list or whole plaintext file is collected. Local-only parts never
 * enter the transport. Every required callback is captured before local IO. */
export async function verifyMigrationContentPlanReadback(input:Common&{reference:MigrationContentPlanReference},port:MigrationContentPlanReadback){
 const walk=port?.forEachEnvelope,get=port?.getEnvelope;
 if(typeof walk!=='function'||typeof get!=='function')throw new Error('E2EE_STREAMED_READBACK_REQUIRED');
 const each=walk.bind(port),fetch=get.bind(port),options=captured(input),reference={...input.reference};current(options);
 const manifest=await openMigrationContentPlan({...options,reference});current(options);
 const expected=new Map(manifest.plan.map(item=>[item.domain+'\0'+item.objectId,item])),seen=new Set<string>();
 const mismatch=():never=>{throw new Error('E2EE_CONTENT_READBACK_MISMATCH');};
 const checked=async(item:PlanEnvelope,value:E2eeEnvelope|null)=>{
  current(options);const envelope=validateE2eeEnvelope(value??mismatch()),context={...options.context,domain:item.domain,objectId:item.objectId,operationId:envelope.context.operationId};
  // payloadHash excludes the signature; verify it separately on EVERY reply.
  const valid=await verifyE2eeEnvelope(envelope,context,options.signer);current(options);
  if(await envelopePayloadHash(valid)!==item.hash)mismatch();current(options);return valid;
 };
 let closed=false,busy=false,failed=false,failure:unknown;
 const consume=async(value:E2eeEnvelope)=>{
  if(closed)throw new Error('E2EE_READBACK_CLOSED');
  let entered=false;
  try{
   current(options);if(failed)throw failure;if(busy)throw new Error('E2EE_READBACK_BUSY');busy=true;entered=true;
   const envelope=validateE2eeEnvelope(value),key=envelope.context.domain+'\0'+envelope.context.objectId,item=expected.get(key)??mismatch();
   if(seen.has(key))mismatch();await checked(item,envelope);if(closed)throw new Error('E2EE_READBACK_CLOSED');current(options);seen.add(key);
  }catch(error){if(!failed){failed=true;failure=error;}throw error;}finally{if(entered)busy=false;}
 };
 try{
  const count=await each(consume);current(options);if(failed)throw failure;
  if(busy||count!==manifest.plan.length||seen.size!==manifest.plan.length)mismatch();
 }finally{closed=true;}
 await verifyRecords(options,manifest,async item=>{current(options);const value=await fetch(item.domain,item.objectId);current(options);return checked(item,value);});current(options);
 // Re-open the exact complete reference after remote awaits: vanished or
 // changed quarantine/local-only records cannot yield a success receipt.
 await openMigrationContentPlan({...options,reference});current(options);
 return Object.freeze({...reference,envelopes:manifest.plan.length,remoteRecords:manifest.logical.length,localRecords:manifest.local.length});
}
