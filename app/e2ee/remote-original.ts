import {sha256} from '@noble/hashes/sha2.js';
import {validatePrivatePathPage} from './private-path-source.ts';
import {canonicalE2eeValue,decodeCanonicalE2eeValue,snapshotE2eeValue,verifyE2eeCommand,type SignedE2eeCommand,type WireValue} from './commands.ts';
import {decodeE2eeBytes,encodeE2eeBytes} from './envelope.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {parseE2eeTransportJson} from './transport-json.ts';
import {e2eeResponseLimit} from './http-response.ts';
import type {E2eeHttpObservation,E2eeHttpBodyObservation} from './http-observation.ts';
import type {UnlockedE2eeVault,LocalWrite} from './storage.ts';

type Target=Readonly<{ownerId:string;scopeId:string;kind:'personal'|'project'|'space'}>;
type Context=Target&{actorId:string;actorScopeId:string;deviceId:string};
type Binding={packetHash:string;signer:string;generation:number;migrationId:string;fence:number;sourceHash:string;action:string;directoryRevision:number;checkpointHash:string;securityEpoch:number};
type Request={size:number;hash:string};type Part={size:number;hash:string};
type Response=Parameters<E2eeHttpBodyObservation['begin']>[0];
type Journal={protocol:1;purpose:'remote-original/v1';id:string;context:Context;binding:Binding;request:Request;response:Response|null;phase:'registered'|'receiving'|'complete';size:number;parts:Part[];rawHash:string|null;manifestHash:string|null};
type Catalog={protocol:1;context:Context;ids:string[]};
type ReadVault=Pick<UnlockedE2eeVault,'localIdentity'|'assertUnlocked'|'read'|'listLocal'>;
export type RemoteOriginalCapacity=Readonly<{maximumBytes:number;maximumParts:number;maximumObservations:number;maximumRecords:number;maximumMetadataBytes:number}>;
export const REMOTE_ORIGINAL_READ_CAPACITY:RemoteOriginalCapacity=Object.freeze({maximumBytes:2147483647,maximumParts:65536,maximumObservations:8000,maximumRecords:1000000,maximumMetadataBytes:128*1024*1024});
export type RemoteOriginalAdmission=Readonly<{bytes:number;parts:number;observations:number;records:number;metadataBytes:number}>;
export type RemoteOriginalReadOptions={vault:ReadVault;target:Target;capacity:RemoteOriginalCapacity;assertCurrent:()=>void};
export type RemoteOriginalOptions=Omit<RemoteOriginalReadOptions,'vault'>&{vault:UnlockedE2eeVault;packet:SignedE2eeCommand;signer:CryptoKey;generation:number;ensureDurableKeys:()=>Promise<void>;admit:(request:RemoteOriginalAdmission)=>Promise<void>};
export type RemoteOriginalReference=Readonly<{id:string;manifestHash:string;rawHash:string;size:number}>;
/** An inert identity for future pre-network ownership reservation. No store,
 * EOF, body integrity, custody or migration receipt is implied by this value. */
export type RemoteOriginalRegistration=Readonly<{protocol:1;purpose:'remote-original/v1';id:string;context:Readonly<Context>;binding:Readonly<Binding>}>;
export type RemoteOriginalDescriptor=Readonly<{registration:RemoteOriginalRegistration;bodyVerified:false;phase:Journal['phase'];request:Readonly<Request>;response:Response|null;size:number;parts:number;rawHash:string|null;manifestHash:string|null}>;
const PURPOSE='remote-original/v1',MAX_META=2*1024*1024,MAX_REQUEST=128*1024,MAX_PART=65536;
const uuid=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const actions=new Set(['legacy-workspace','legacy-aurora','legacy-stoicheion','legacy-advice','legacy-tasks','legacy-diary','legacy-mindmaps','legacy-physis','legacy-reminders','legacy-archives','legacy-shared-mindmaps','legacy-private-path']);
const encoder=new TextEncoder();
// Never put a provider/admission exception (possibly containing source text or
// a filesystem path) on the authenticated HTTP failure surface.
const localCodes=new Set(['E2EE_ACCOUNT_CHANGED','E2EE_UNLOCK_REQUIRED','E2EE_KEY_UNAVAILABLE','E2EE_LOCAL_CONFLICT','E2EE_LOCAL_RECORD_LIMIT','E2EE_STORAGE_CAPACITY','E2EE_STORAGE_USAGE_UNAVAILABLE','E2EE_CORRUPT_LOCAL_RECORD','E2EE_CORRUPT_LOCAL_DATABASE','E2EE_OBSERVATION_REQUEST_INVALID','E2EE_CORRUPT_REMOTE_ORIGINAL','E2EE_REMOTE_ORIGINAL_METADATA_LIMIT','E2EE_REMOTE_ORIGINAL_CONTEXT','E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT','E2EE_REMOTE_ORIGINAL_CAPACITY','E2EE_REMOTE_ORIGINAL_BUSY','E2EE_REMOTE_ORIGINAL_CLOSED','E2EE_REMOTE_ORIGINAL_INCOMPLETE_READ']);
function localFailure(error:unknown):never{
 if(error instanceof Error&&error.name==='AbortError')throw error;
 throw new Error(error instanceof Error&&localCodes.has(error.message)?error.message:'E2EE_REMOTE_ORIGINAL_STORAGE_UNAVAILABLE');
}
function invalid():never{throw new Error('E2EE_CORRUPT_REMOTE_ORIGINAL');}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function bytesHash(bytes:Uint8Array){return encodeE2eeBytes(sha256(bytes));}
function encoded(value:unknown){const bytes=canonicalE2eeValue(value as WireValue);if(bytes.length>MAX_META){bytes.fill(0);throw new Error('E2EE_REMOTE_ORIGINAL_METADATA_LIMIT');}return bytes;}
function identity(value:unknown){const bytes=encoded(value);try{return bytesHash(bytes);}finally{bytes.fill(0);}}
function registration(id:string,scope:Context,binding:Binding):RemoteOriginalRegistration{return Object.freeze({protocol:1,purpose:PURPOSE,id,context:Object.freeze({...scope}),binding:Object.freeze({...binding})});}
/** Authenticate an INERT pre-prepare identity against an independently trusted
 * signer and the actual local actor. This performs no storage or body proof. */
export async function authenticateRemoteOriginalRegistration(value:unknown,packet:SignedE2eeCommand,signer:CryptoKey,
 source:Pick<RemoteOriginalReadOptions,'vault'|'target'|'assertCurrent'>&{generation:number}):Promise<RemoteOriginalRegistration>{
 const options={...source,target:snapshotE2eeValue(source.target)},saved=snapshotE2eeValue(value),request=snapshotE2eeValue(packet);
 exactKeys(saved,['protocol','purpose','id','context','binding']);
 if(saved.protocol!==1||saved.purpose!==PURPOSE||typeof saved.id!=='string'||!uuid.test(saved.id))invalid();
 options.assertCurrent();options.vault.assertUnlocked();const scope=context(options.vault,options.target);
 const binding=await packetBinding(request,signer,scope,options.generation);
 options.assertCurrent();options.vault.assertUnlocked();same(context(options.vault,options.target),scope);same(saved.context,scope);validateBinding(saved.binding);if(identity(saved.binding)!==identity(binding))invalid();
 return registration(saved.id,scope,binding);
}
function parse(bytes:Uint8Array){const value=decodeCanonicalE2eeValue(bytes,MAX_META),canonical=encoded(value);try{if(canonical.length!==bytes.length||canonical.some((byte,at)=>byte!==bytes[at]))invalid();return value;}finally{canonical.fill(0);}}
function capacity(source:RemoteOriginalCapacity){
 const result=snapshotE2eeValue(source);exactKeys(result,['maximumBytes','maximumParts','maximumObservations','maximumRecords','maximumMetadataBytes']);
 integer(result.maximumBytes,1,REMOTE_ORIGINAL_READ_CAPACITY.maximumBytes);integer(result.maximumParts,1,65536);integer(result.maximumObservations,1,8000);integer(result.maximumRecords,1,1000000);integer(result.maximumMetadataBytes,1,128*1024*1024);return result;
}
function context(vault:ReadVault,target:Target):Context{
 exactKeys(target,['ownerId','scopeId','kind']);assertTechnical(target.ownerId);assertTechnical(target.scopeId);if(!['personal','project','space'].includes(target.kind))invalid();
 const actor=vault.localIdentity();return{...target,actorId:actor.ownerId,actorScopeId:actor.scopeId,deviceId:actor.deviceId};
}
function same(value:unknown,expected:Context){exactKeys(value,['ownerId','scopeId','kind','actorId','actorScopeId','deviceId']);for(const key of Object.keys(expected) as (keyof Context)[])if(value[key]!==expected[key])throw new Error('E2EE_REMOTE_ORIGINAL_CONTEXT');}
function check(options:RemoteOriginalReadOptions){options.assertCurrent();options.vault.assertUnlocked();}
function key(hash:string,id:string,role:'j'|'r'|'m'|'p',part=0){decodeE2eeBytes(hash,32);if(!uuid.test(id))invalid();integer(part,0,7999);return`remote-original:${hash}:${id}:${role}:${String(part).padStart(5,'0')}`;}
const catalogKey=(hash:string)=>'remote-original-catalog:'+hash;
function validateBinding(value:unknown){
 exactKeys(value,['packetHash','signer','generation','migrationId','fence','sourceHash','action','directoryRevision','checkpointHash','securityEpoch']);
 decodeE2eeBytes(value.packetHash,32);decodeE2eeBytes(value.signer,91);integer(value.generation,1);if(typeof value.migrationId!=='string'||!uuid.test(value.migrationId))invalid();
 integer(value.fence,1);decodeE2eeBytes(value.sourceHash,32);if(typeof value.action!=='string'||!actions.has(value.action))invalid();integer(value.directoryRevision,1);decodeE2eeBytes(value.checkpointHash,32);integer(value.securityEpoch,1);
}
function response(value:unknown):asserts value is Response{
 exactKeys(value,['path','status','contentType','contentLength']);if(value.path!=='/e2ee/v1/read')invalid();integer(value.status,0,599);
 for(const name of ['contentType','contentLength'] as const)if(value[name]!==null&&(typeof value[name]!=='string'||(value[name] as string).length>(name==='contentType'?512:64)||!/^[\x20-\x7e]*$/.test(value[name] as string)))invalid();
}
function manifest(j:Journal){return{protocol:j.protocol,purpose:j.purpose,id:j.id,context:j.context,binding:j.binding,request:j.request,response:j.response,size:j.size,parts:j.parts,rawHash:j.rawHash};}
function journal(value:unknown,scope:Context,id:string):Journal{
 exactKeys(value,['protocol','purpose','id','context','binding','request','response','phase','size','parts','rawHash','manifestHash']);
 if(value.protocol!==1||value.purpose!==PURPOSE||value.id!==id||!['registered','receiving','complete'].includes(value.phase as string))invalid();same(value.context,scope);validateBinding(value.binding);
 exactKeys(value.request,['size','hash']);integer(value.request.size,1,MAX_REQUEST);decodeE2eeBytes(value.request.hash,32);
 if(value.response!==null)response(value.response);if((value.phase==='registered')!==(value.response===null))invalid();integer(value.size,0,value.response===null?0:e2eeResponseLimit((value.response as Response).path,(value.response as Response).status));
 if(!Array.isArray(value.parts)||value.parts.length>65536)invalid();let size=0;
 for(const part of value.parts){exactKeys(part,['size','hash']);integer(part.size,1,MAX_PART);decodeE2eeBytes(part.hash,32);size+=part.size;}
 if(size!==value.size||value.phase==='registered'&&size!==0)invalid();
 if(value.phase==='complete'){decodeE2eeBytes(value.rawHash,32);decodeE2eeBytes(value.manifestHash,32);}else if(value.rawHash!==null||value.manifestHash!==null)invalid();
 return value as Journal;
}
async function metadata(options:RemoteOriginalReadOptions,id:string){check(options);const row=await options.vault.read('local-snapshot',id);try{check(options);return row?{serial:row.serial,value:parse(row.value),hash:bytesHash(row.value),bytes:row.value.length}:null;}finally{row?.value.fill(0);}}
type Inventory={context:Context;hash:string;catalog:Catalog;serial:number|null;journals:{value:Journal;serial:number;hash:string}[];keys:string[];usage:RemoteOriginalAdmission;stamp:string};
async function inventory(options:RemoteOriginalReadOptions):Promise<Inventory>{
 check(options);const scope=context(options.vault,options.target),hash=identity(scope),before=await metadata(options,catalogKey(hash)),all=await options.vault.listLocal('local-snapshot','remote-original:');check(options);
 const owned:string[]=[];
 for(const id of all){const parts=id.split(':');if(!/^remote-original:[A-Za-z0-9_-]{43}:[a-f0-9-]{36}:[jrmp]:[0-9]{5}$/.test(id)||!uuid.test(parts[2])||Number(parts[4])>7999||parts[3]!=='p'&&parts[4]!=='00000')throw new Error('E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT');decodeE2eeBytes(parts[1],32);if(parts[1]===hash)owned.push(id);}
 let index:Catalog={protocol:1,context:scope,ids:[]};
 if(before){exactKeys(before.value,['protocol','context','ids']);if(before.value.protocol!==1||!Array.isArray(before.value.ids)||before.value.ids.length>8000)invalid();same(before.value.context,scope);const seen=new Set();for(const id of before.value.ids){if(typeof id!=='string'||!uuid.test(id)||seen.has(id))invalid();seen.add(id);}index=before.value as Catalog;}
 else if(owned.length)throw new Error('E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT');
 const present=new Set(owned),expected=new Set<string>(),journals:Inventory['journals']=[];
 const usage={bytes:0,parts:0,observations:index.ids.length,records:before?1:0,metadataBytes:before?.bytes??0};
 for(const id of index.ids){
  const jid=key(hash,id,'j'),rid=key(hash,id,'r');if(!present.has(jid)||!present.has(rid))invalid();expected.add(jid);expected.add(rid);
  const row=await metadata(options,jid);if(!row)invalid();const j=journal(row.value,scope,id);journals.push({value:j,serial:row.serial,hash:row.hash});
  usage.bytes+=j.size;usage.parts+=j.parts.length;usage.records+=2+j.parts.length;usage.metadataBytes+=row.bytes+j.request.size;
  if(usage.parts>65536||usage.records>1000000||usage.observations>8000||usage.metadataBytes>128*1024*1024)throw new Error('E2EE_REMOTE_ORIGINAL_CAPACITY');
  for(const part of j.parts.keys())expected.add(key(hash,id,'p',part));
  if(j.phase==='complete'){
   const mid=key(hash,id,'m');expected.add(mid);const m=await metadata(options,mid);if(!m||m.serial!==1||m.hash!==j.manifestHash||identity(m.value)!==identity(manifest(j)))invalid();usage.records++;usage.metadataBytes+=m.bytes;
  }
 }
 if(owned.length!==expected.size||owned.some(id=>!expected.has(id)))throw new Error('E2EE_REMOTE_ORIGINAL_UNBOUND_REMNANT');
 for(const j of journals){const row=await metadata(options,key(hash,j.value.id,'j'));if(!row||row.serial!==j.serial||row.hash!==j.hash)throw new Error('E2EE_REMOTE_ORIGINAL_BUSY');}
 const after=await metadata(options,catalogKey(hash));if((before?.serial??null)!==(after?.serial??null)||(before?.hash??null)!==(after?.hash??null))throw new Error('E2EE_REMOTE_ORIGINAL_BUSY');
 check(options);const stamp=identity({catalogHash:before?.hash??null,catalogSerial:before?.serial??null,keys:owned.slice().sort(),journals:journals.map(j=>({id:j.value.id,serial:j.serial,hash:j.hash}))});
 return{context:scope,hash,catalog:index,serial:before?.serial??null,journals,keys:owned,usage,stamp};
}
function within(usage:RemoteOriginalAdmission,limit:RemoteOriginalCapacity){if(usage.bytes>limit.maximumBytes||usage.parts>limit.maximumParts||usage.observations>limit.maximumObservations||usage.records>limit.maximumRecords||usage.metadataBytes>limit.maximumMetadataBytes)throw new Error('E2EE_REMOTE_ORIGINAL_CAPACITY');}
async function stable(options:RemoteOriginalReadOptions,previous:Inventory){if((await inventory(options)).stamp!==previous.stamp)throw new Error('E2EE_REMOTE_ORIGINAL_BUSY');}
function write(id:string,value:unknown,expected:number|null):LocalWrite{return{domain:'local-snapshot',objectId:id,value:encoded(value),expected};}
async function commit(options:RemoteOriginalOptions,changes:LocalWrite[]){try{check(options);await options.vault.write(changes,()=>check(options));check(options);}finally{changes.forEach(row=>row.value.fill(0));}}
async function packetBinding(packet:SignedE2eeCommand,signer:CryptoKey,scope:Context,generation:number):Promise<Binding>{
 const command=await verifyE2eeCommand(packet,signer);if(command.ownerId!==scope.ownerId||command.scopeId!==scope.scopeId||command.deviceId!==scope.deviceId||!actions.has(command.action))throw new Error('E2EE_REMOTE_ORIGINAL_CONTEXT');
 if(command.action==='legacy-shared-mindmaps'&&(!['project','space'].includes(scope.kind)||!Object.hasOwn(command.payload,'table')))throw new Error('E2EE_REMOTE_ORIGINAL_CONTEXT');
 const payload=command.payload;const names=['migrationId','fence','sourceHash',...(Object.hasOwn(payload,'table')?['table','offset']:[]),...(Object.hasOwn(payload,'byteOffset')?['byteOffset']:[]),...(command.action==='legacy-private-path'?['pathId']:[]),...(command.action==='legacy-private-path'&&Object.hasOwn(payload,'maxFragments')?['maxFragments']:[])];exactKeys(payload,names);if(Object.hasOwn(payload,'maxFragments'))integer(payload.maxFragments,1,50);
 if(command.action==='legacy-private-path'){
  if(typeof payload.pathId!=='string'||typeof payload.table!=='string'||typeof payload.offset!=='number'||typeof payload.byteOffset!=='number')invalid();
  validatePrivatePathPage(scope.kind,payload.pathId,payload.table,payload.offset,payload.byteOffset);
 }
 if(typeof payload.migrationId!=='string'||!uuid.test(payload.migrationId))invalid();integer(payload.fence,1);decodeE2eeBytes(payload.sourceHash,32);integer(command.expectedRevision,1);decodeE2eeBytes(command.checkpointHash,32);integer(generation,1);
 if(Object.hasOwn(payload,'table')&&command.action!=='legacy-private-path'){
  const tables:Record<string,readonly string[]>={'legacy-mindmaps':['maps','versions','receipts','deletions'],'legacy-physis':['owners','records','usedIds','receipts'],'legacy-reminders':['habitProfiles','habitDevices','habitDeliveries','adviceDays','adviceDeliveries','sharedPreferences'],'legacy-archives':['stages','safety','receipts'],'legacy-shared-mindmaps':['maps','versions','receipts','deletions','deletionScopes','conversions']};
  if(typeof payload.table!=='string'||!tables[command.action]?.includes(payload.table))invalid();integer(payload.offset);
 }
 if(Object.hasOwn(payload,'byteOffset')){if(!['legacy-archives','legacy-private-path'].includes(command.action)||!Object.hasOwn(payload,'table'))invalid();integer(payload.byteOffset,0,64*1024*1024);}
 const spki=encodeE2eeBytes(new Uint8Array(await crypto.subtle.exportKey('spki',signer)));decodeE2eeBytes(spki,91);
 return{packetHash:identity(packet),signer:spki,generation,migrationId:payload.migrationId,fence:payload.fence,sourceHash:payload.sourceHash as string,action:command.action,directoryRevision:command.expectedRevision,checkpointHash:command.checkpointHash,securityEpoch:command.securityEpoch};
}

/** Same-original-active-actor inert quarantine. It never sends a request,
 * normalizes private data, grants replay/ACL authority or activates a scope. */
export class ProtectedRemoteOriginal implements E2eeHttpObservation {
 #options:RemoteOriginalOptions;#scope:Context;#binding:Binding;#id=crypto.randomUUID();#journal:Journal|null=null;#serial=0;#busy=false;#broken=false;#closed=false;#hash=sha256.create();#reference:RemoteOriginalReference|null=null;
 private constructor(options:RemoteOriginalOptions,scope:Context,binding:Binding){this.#options=options;this.#scope=scope;this.#binding=binding;}
 static async create(source:RemoteOriginalOptions){
  const options={...source,target:snapshotE2eeValue(source.target),capacity:capacity(source.capacity),packet:snapshotE2eeValue(source.packet)};check(options);const scope=context(options.vault,options.target),binding=await packetBinding(options.packet,options.signer,scope,options.generation);check(options);
  return new ProtectedRemoteOriginal(options,scope,binding);
 }
 registration(){return registration(this.#id,this.#scope,this.#binding);}
 #current(){check(this.#options);same(context(this.#options.vault,this.#options.target),this.#scope);if(this.#closed||this.#broken)throw new Error('E2EE_REMOTE_ORIGINAL_CLOSED');}
 async #operation<T>(body:()=>Promise<T>):Promise<T>{if(this.#busy){this.#broken=true;throw new Error('E2EE_REMOTE_ORIGINAL_BUSY');}this.#busy=true;try{this.#current();return await body();}catch(error){this.#broken=true;return localFailure(error);}finally{this.#busy=false;}}
 async #admit(previous:Inventory,usage:RemoteOriginalAdmission){within(usage,this.#options.capacity);await this.#options.admit(Object.freeze({...usage}));this.#current();await stable(this.#options,previous);this.#current();}
 prepare(request:Parameters<E2eeHttpObservation['prepare']>[0]){return this.#operation(async()=>{
  if(this.#journal||request.path!=='/e2ee/v1/read'||request.method!=='POST'||typeof request.body!=='string')throw new Error('E2EE_OBSERVATION_REQUEST_INVALID');
  const bytes=encoder.encode(request.body);try{
   if(bytes.length<1||bytes.length>MAX_REQUEST||request.body.charCodeAt(0)===0xfeff||identity(parseE2eeTransportJson(request.body))!==this.#binding.packetHash)throw new Error('E2EE_OBSERVATION_REQUEST_INVALID');
   await this.#options.ensureDurableKeys();this.#current();const previous=await inventory(this.#options),j:Journal={protocol:1,purpose:PURPOSE,id:this.#id,context:this.#scope,binding:this.#binding,request:{size:bytes.length,hash:bytesHash(bytes)},response:null,phase:'registered',size:0,parts:[],rawHash:null,manifestHash:null};
   const index={...previous.catalog,ids:[...previous.catalog.ids,this.#id]},jbytes=encoded(j),cbytes=encoded(index),oldCatalog=encoded(previous.catalog);
   try{await this.#admit(previous,{...previous.usage,observations:previous.usage.observations+1,records:previous.usage.records+2+(previous.serial===null?1:0),metadataBytes:previous.usage.metadataBytes+jbytes.length+bytes.length+cbytes.length-(previous.serial===null?0:oldCatalog.length)});
    await commit({...this.#options,assertCurrent:()=>this.#current()},[write(catalogKey(previous.hash),index,previous.serial),{domain:'local-snapshot',objectId:key(previous.hash,this.#id,'r'),value:bytes,expected:null},write(key(previous.hash,this.#id,'j'),j,null)]);this.#current();this.#journal=j;this.#serial=1;
   }finally{jbytes.fill(0);cbytes.fill(0);oldCatalog.fill(0);}
  }finally{bytes.fill(0);}
 });}
 async #publish(j:Journal,part?:Uint8Array,finished=false){
  this.#current();if(!this.#journal)invalid();const previous=await inventory(this.#options),old=previous.journals.find(row=>row.value.id===this.#id);if(!old||old.serial!==this.#serial||identity(old.value)!==identity(this.#journal))throw new Error('E2EE_REMOTE_ORIGINAL_BUSY');
  const body=encoded(j),oldBody=encoded(this.#journal),m=finished?encoded(manifest(j)):null;
  try{await this.#admit(previous,{...previous.usage,bytes:previous.usage.bytes+(part?.length??0),parts:previous.usage.parts+(part?1:0),records:previous.usage.records+(part?1:0)+(m?1:0),metadataBytes:previous.usage.metadataBytes+body.length-oldBody.length+(m?.length??0)});
   const changes=[write(key(previous.hash,this.#id,'j'),j,this.#serial)];if(part)changes.push({domain:'local-snapshot',objectId:key(previous.hash,this.#id,'p',j.parts.length-1),value:part,expected:null});if(m)changes.push({domain:'local-snapshot',objectId:key(previous.hash,this.#id,'m'),value:m,expected:null});
   await commit({...this.#options,assertCurrent:()=>this.#current()},changes);this.#current();this.#journal=j;this.#serial++;
  }finally{body.fill(0);oldBody.fill(0);m?.fill(0);}
 }
 begin(value:Response){const saved=snapshotE2eeValue(value);return this.#operation(async()=>{response(saved);if(!this.#journal||this.#journal.phase!=='registered')invalid();await this.#publish({...this.#journal,response:saved,phase:'receiving'});});}
 append(bytes:Uint8Array){return this.#operation(async()=>{
  const copy=bytes instanceof Uint8Array&&bytes.length>=1&&bytes.length<=MAX_PART?new Uint8Array(bytes):null;
  try{if(!copy||copy.length<1||copy.length>MAX_PART||!this.#journal||this.#journal.phase!=='receiving')invalid();
   const j=this.#journal,next={...j,size:j.size+copy.length,parts:[...j.parts,{size:copy.length,hash:bytesHash(copy)}]};if(next.size>e2eeResponseLimit(j.response!.path,j.response!.status))throw new Error('E2EE_REMOTE_ORIGINAL_CAPACITY');
   this.#hash.update(copy);await this.#publish(next,copy);
  }finally{copy?.fill(0);}
 });}
 finish(){return this.#operation(async()=>{
  if(!this.#journal||this.#journal.phase!=='receiving')invalid();const rawHash=encodeE2eeBytes(this.#hash.clone().digest());
  const proof=await withRemoteOriginal({...this.#options,assertCurrent:()=>this.#current()},this.#id,async source=>{for await(const part of source)part.fill(0);},{allowIncomplete:true});this.#current();
  if(proof.rawHash!==rawHash||proof.size!==this.#journal.size)invalid();const next={...this.#journal,phase:'complete' as const,rawHash};next.manifestHash=identity(manifest(next));await this.#publish(next,undefined,true);
  this.#reference=Object.freeze({id:this.#id,manifestHash:next.manifestHash,rawHash,size:next.size});
 });}
 reference(){if(this.#broken||!this.#reference)throw new Error('E2EE_REMOTE_ORIGINAL_INCOMPLETE');return this.#reference;}
 close(){if(!this.#closed){this.#closed=true;this.#hash.destroy();}}
}

function readOptions(source:RemoteOriginalReadOptions):RemoteOriginalReadOptions{return{vault:source.vault,target:snapshotE2eeValue(source.target),capacity:capacity(source.capacity),assertCurrent:source.assertCurrent};}
export async function listRemoteOriginals(source:RemoteOriginalReadOptions){const options=readOptions(source),state=await inventory(options);within(state.usage,options.capacity);return Object.freeze(state.journals.map(row=>Object.freeze({id:row.value.id,phase:row.value.phase,size:row.value.size,parts:row.value.parts.length,manifestHash:row.value.manifestHash})));}
async function verifiedRequest(options:RemoteOriginalReadOptions,state:Inventory,j:Journal){
 const request=await options.vault.read('local-snapshot',key(state.hash,j.id,'r'));
 try{check(options);if(!request||request.serial!==1||request.value.length!==j.request.size||bytesHash(request.value)!==j.request.hash
  ||request.value.length<1||request.value.length>MAX_REQUEST||request.value.length>=3&&request.value[0]===239&&request.value[1]===187&&request.value[2]===191)invalid();
  let parsed:SignedE2eeCommand;try{parsed=parseE2eeTransportJson(new TextDecoder('utf-8',{fatal:true}).decode(request.value)) as unknown as SignedE2eeCommand;}catch{invalid();}
  let signer:CryptoKey;try{signer=await crypto.subtle.importKey('spki',decodeE2eeBytes(j.binding.signer,91),{name:'ECDSA',namedCurve:'P-256'},true,['verify']);}catch{check(options);invalid();}check(options);
  let bound:Binding;try{bound=await packetBinding(parsed,signer,j.context,j.binding.generation);}catch{check(options);invalid();}check(options);if(identity(bound)!==identity(j.binding))invalid();
  return registration(j.id,j.context,j.binding);
 }finally{request?.value.fill(0);}
}
/** Same-active-actor technical discovery before ANY response part is opened.
 * A complete marker remains metadata only; withRemoteOriginal still must
 * authenticate every body part and actual EOF before returning its receipt. */
export async function describeRemoteOriginal(source:RemoteOriginalReadOptions,id:string):Promise<RemoteOriginalDescriptor>{
 const options=readOptions(source);check(options);if(!uuid.test(id))invalid();const before=await inventory(options);within(before.usage,options.capacity);
 const item=before.journals.find(row=>row.value.id===id);if(!item)throw new Error('E2EE_REMOTE_ORIGINAL_MISSING');const j=item.value,registered=await verifiedRequest(options,before,j);
 await stable(options,before);check(options);return Object.freeze({registration:registered,bodyVerified:false,phase:j.phase,request:Object.freeze({...j.request}),response:j.response?Object.freeze({...j.response}):null,size:j.size,parts:j.parts.length,rawHash:j.rawHash,manifestHash:j.manifestHash});
}
/** One bounded namespace audit for a retained ownership batch. Authenticate
 * every selected request before opening any body, then verify exact full/prefix
 * EOF and the complete namespace again before publishing any receipt. Missing
 * reserved IDs receive no receipt; callers still enforce completion claims. */
export async function verifyRemoteOriginals(source:RemoteOriginalReadOptions,ids:ReadonlySet<string>,beforeRead:(descriptor:RemoteOriginalDescriptor)=>void|Promise<void>){
 const options=readOptions(source),wanted=new Set(ids);check(options);for(const id of wanted)if(typeof id!=='string'||!uuid.test(id))invalid();
 const before=await inventory(options);within(before.usage,options.capacity);
 const selected=before.journals.filter(row=>wanted.has(row.value.id));
 for(const row of selected){
  const j=row.value,registered=await verifiedRequest(options,before,j);check(options);
  await beforeRead(Object.freeze({registration:registered,bodyVerified:false,phase:j.phase,request:Object.freeze({...j.request}),response:j.response?Object.freeze({...j.response}):null,size:j.size,parts:j.parts.length,rawHash:j.rawHash,manifestHash:j.manifestHash}));check(options);
 }
 await stable(options,before);check(options);
 const receipts=[];
 for(const row of selected){
  receipts.push(await readVerifiedOriginal(options,before,row.value,async input=>{for await(const bytes of input){check(options);bytes.fill(0);}},true,false));check(options);
 }
 await stable(options,before);check(options);return Object.freeze(receipts);
}
/** Active-original-actor read scope. All yielded loans expire on next/return;
 * a partial prefix is available only by explicit opt-in and never claims EOF. */
export async function withRemoteOriginal(sourceOptions:RemoteOriginalReadOptions,id:string,consume:(source:AsyncIterable<Uint8Array>)=>Promise<void>,mode:{allowIncomplete?:boolean}={}){
 const options=readOptions(sourceOptions),allowIncomplete=mode.allowIncomplete===true;
 check(options);if(!uuid.test(id))invalid();const before=await inventory(options);within(before.usage,options.capacity);const item=before.journals.find(row=>row.value.id===id);if(!item)throw new Error('E2EE_REMOTE_ORIGINAL_MISSING');const j=item.value;
 if(j.phase!=='complete'&&!allowIncomplete)throw new Error('E2EE_REMOTE_ORIGINAL_INCOMPLETE');
 await verifiedRequest(options,before,j);
 return readVerifiedOriginal(options,before,j,consume,allowIncomplete,true);
}
async function readVerifiedOriginal(options:RemoteOriginalReadOptions,before:Inventory,j:Journal,consume:(source:AsyncIterable<Uint8Array>)=>Promise<void>,allowIncomplete:boolean,verifyNamespace:boolean){
 const id=j.id;check(options);if(j.phase!=='complete'&&!allowIncomplete)throw new Error('E2EE_REMOTE_ORIGINAL_INCOMPLETE');
 let live=true,started=false,ended=false,failed=false,busy=false;const digest=sha256.create();let size=0,iterator:AsyncGenerator<Uint8Array>|undefined;
 const generate=async function*(){
  try{for(const[index,part]of j.parts.entries()){
   check(options);if(!live)throw new Error('E2EE_REMOTE_ORIGINAL_READER_CLOSED');const row=await options.vault.read('local-snapshot',key(before.hash,id,'p',index));
   try{check(options);if(!live||!row||row.serial!==1||row.value.length!==part.size||bytesHash(row.value)!==part.hash)invalid();digest.update(row.value);size+=row.value.length;yield row.value;}finally{row?.value.fill(0);}
  }check(options);ended=true;}catch(error){failed=true;throw error;}
 };
 const reject=()=>{failed=true;const refusal=Promise.reject<IteratorResult<Uint8Array>>(new Error('E2EE_REMOTE_ORIGINAL_READER_CLOSED'));void refusal.catch(()=>{});return refusal;};
 const source:AsyncIterable<Uint8Array>={[Symbol.asyncIterator](){
  if(!live||started){failed=true;throw new Error('E2EE_REMOTE_ORIGINAL_READER_CLOSED');}started=true;iterator=generate();const current=iterator;
  return{next(){if(!live||busy)return reject();busy=true;const pending=current.next();void pending.catch(()=>{failed=true;});void pending.finally(()=>{busy=false;}).catch(()=>{});return pending;},return(){if(!ended)failed=true;const pending=current.return(undefined);void pending.catch(()=>{});return pending;}};
 }};
 try{await consume(source);check(options);if(!started||!ended||failed||size!==j.size)throw new Error('E2EE_REMOTE_ORIGINAL_INCOMPLETE_READ');const rawHash=encodeE2eeBytes(digest.digest());if(j.phase==='complete'&&rawHash!==j.rawHash)invalid();if(verifyNamespace)await stable(options,before);check(options);return Object.freeze({id,size,rawHash,complete:j.phase==='complete',manifestHash:j.manifestHash});}
 finally{live=false;try{await iterator?.return(undefined);}catch{/* Preserve the consumer/actor error and drain the owned loan. */}finally{digest.destroy();}}
}
