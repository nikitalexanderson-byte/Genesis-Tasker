import {E2eeDeviceDocument} from './device-document.ts';
import type {UnlockedWebDevice} from './device-vault.ts';
import {exactKeys,assertTechnical} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';

export const LEGACY_STORAGE_INDEX='legacy-storage-retirement-v1';
export const LEGACY_STORAGE_ORIGINAL_PREFIX='legacy-storage-original:';
type Original={format:'genesis-legacy-storage-original-v1';ownerId:string;store:'localStorage';key:string;raw:string;execution:'history-only'};
type Index={format:'genesis-legacy-storage-retirement-v1';ownerId:string;entries:{key:string;originals:string[];retiredBy:string|null}[]};
type ReadStorage=Pick<Storage,'length'|'key'|'getItem'>;
const encoder=new TextEncoder(),MAX_KEYS=10000,MAX_RAW=64*1024*1024,MAX_TOTAL=512*1024*1024;
const captures=new Map<string,LegacyStorageRetirement>();
function invalid():never{throw new Error('E2EE_LEGACY_STORAGE_CORRUPT');}
export function validateLegacyStorageOriginal(input:unknown,ownerId:string):Original{
 exactKeys(input,['format','ownerId','store','key','raw','execution']);
 if(input.format!=='genesis-legacy-storage-original-v1'||input.ownerId!==ownerId||input.store!=='localStorage'||input.execution!=='history-only'
  ||typeof input.key!=='string'||!input.key||input.key.length>4096||typeof input.raw!=='string'||input.raw.length>MAX_RAW)invalid();
 return input as Original;
}
export function validateLegacyStorageIndex(input:unknown,ownerId:string):Index{
 exactKeys(input,['format','ownerId','entries']);
 if(input.format!=='genesis-legacy-storage-retirement-v1'||input.ownerId!==ownerId||!Array.isArray(input.entries)||input.entries.length>MAX_KEYS)invalid();
 const keys=new Set<string>(),ids=new Set<string>();
 for(const row of input.entries){exactKeys(row,['key','originals','retiredBy']);if(row.retiredBy!==null)assertTechnical(row.retiredBy);
  if(typeof row.key!=='string'||!row.key||row.key.length>4096||keys.has(row.key)||!Array.isArray(row.originals)||!row.originals.length)invalid();keys.add(row.key);
  for(const id of row.originals){if(typeof id!=='string'||!/^legacy-storage-original:[A-Za-z0-9_-]{43}$/.test(id)||ids.has(id)||ids.size>=MAX_KEYS)invalid();ids.add(id);}
 }
 return input as Index;
}
export async function legacyStorageOriginalId(value:Original){
 const bytes=encoder.encode(JSON.stringify(value));try{return LEGACY_STORAGE_ORIGINAL_PREFIX+encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}finally{bytes.fill(0);}
}
/** This port is available only to the current migration's owner-bound readers.
 * Normal product reads never regain access to legacy values or commands. */
export function migrationSourceStorage(ownerId:string):ReadStorage{
 const capture=captures.get(ownerId);return capture?capture.storage:localStorage;
}
export class LegacyStorageRetirement{
 #closed=false;#index:Index;#serial:number|null=null;#captured=new Map<string,{raw:string;live:string|null}>();#previous=new Map<string,string>();#removed=new Set<string>();
 readonly storage:ReadStorage;
 private constructor(readonly device:UnlockedWebDevice,private readonly physical:Storage,private readonly current:()=>void,private readonly scopeId:string){
  assertTechnical(scopeId);
  this.#index={format:'genesis-legacy-storage-retirement-v1',ownerId:device.ownerId,entries:[]};
  const keys=()=>this.#keys();
  this.storage={get length(){return keys().length;},key:index=>keys()[index]??null,getItem:key=>this.#read(key)};
 }
 #check(){if(this.#closed)throw new Error('E2EE_UNLOCK_REQUIRED');this.current();this.device.requireOpen();}
 #keys(){this.#check();const keys=new Set(this.#previous.keys());for(let index=0;index<this.physical.length;index++){const key=this.physical.key(index);if(key!==null)keys.add(key);}return [...keys];}
 #read(key:string){
  this.#check();const live=this.physical.getItem(key),raw=live??this.#previous.get(key)??null;
  // The ordinary profile needs its existing validated public projection, not
  // deletion. retainEncryptedUserCache handles it separately before commit.
  if(raw!==null&&key!=='genesis-last-user-v2'){
   const prior=this.#captured.get(key);if(prior&&prior.raw!==raw)throw new Error('E2EE_SOURCE_CHANGED');
   if(!prior){if(this.#captured.size>=MAX_KEYS)throw new Error('E2EE_SOURCE_TOO_LARGE');this.#captured.set(key,{raw,live});}
  }
  return raw;
 }
 static async open(device:UnlockedWebDevice,physical:Storage,current:()=>void,bind=true,scopeId='retirement:resume'){
  current();device.requireOpen();if(bind&&captures.has(device.ownerId))throw new Error('E2EE_MIGRATION_BUSY');
  const value=new LegacyStorageRetirement(device,physical,current,scopeId);
  try{
   const saved=await value.#document().load();value.#check();
   if(saved){value.#index=saved.value;value.#serial=saved.serial;let size=0;
    for(const row of saved.value.entries){
     const id=row.originals.at(-1)!,original=await value.#original(id).load();value.#check();
     if(!original||original.value.key!==row.key||await legacyStorageOriginalId(original.value)!==id)invalid();value.#check();
     size+=encoder.encode(original.value.raw).length;if(size>MAX_TOTAL)throw new Error('E2EE_SOURCE_TOO_LARGE');
     // A cancelled scope restored its originals to the ordinary store. Its
     // history must not resurrect a subsequently removed or replaced value.
     if(row.retiredBy!==null)value.#previous.set(row.key,original.value.raw);
    }
   }
   if(bind)captures.set(device.ownerId,value);return value;
  }catch(error){value.close();throw error;}
 }
 #document(){return new E2eeDeviceDocument(this.device,LEGACY_STORAGE_INDEX,input=>validateLegacyStorageIndex(input,this.device.ownerId),()=>this.#check());}
 #original(id:string){assertTechnical(id);return new E2eeDeviceDocument(this.device,id,input=>validateLegacyStorageOriginal(input,this.device.ownerId),()=>this.#check());}
 /** All bytes and the complete index are independently read back before the
  * first synchronous compare-and-remove. A crash leaves the sealed sources.
  * A changed live value refuses retirement and is never discarded. */
 async retire(){
  this.#check();let size=0;const index=structuredClone(this.#index);
  for(const [key,source]of this.#captured){
   this.#check();size+=encoder.encode(source.raw).length;if(size>MAX_TOTAL)throw new Error('E2EE_SOURCE_TOO_LARGE');
   const original:Original={format:'genesis-legacy-storage-original-v1',ownerId:this.device.ownerId,store:'localStorage',key,raw:source.raw,execution:'history-only'};
   const id=await legacyStorageOriginalId(original);this.#check();const document=this.#original(id);let saved=await document.load();this.#check();
   if(!saved){await document.save(original,null);this.#check();saved=await document.load();this.#check();}
   if(!saved||saved.value.key!==key||saved.value.raw!==source.raw||await legacyStorageOriginalId(saved.value)!==id)invalid();this.#check();
   let row=index.entries.find(row=>row.key===key);if(!row){row={key,originals:[],retiredBy:null};index.entries.push(row);}
   if(!row.originals.includes(id))row.originals.push(id);
   if(source.live!==null&&row.retiredBy===null)row.retiredBy=this.scopeId;
  }
  index.entries.sort((left,right)=>left.key<right.key?-1:left.key>right.key?1:0);validateLegacyStorageIndex(index,this.device.ownerId);
  if(this.#serial===null||JSON.stringify(index)!==JSON.stringify(this.#index)){
   const saved=await this.#document().save(index,this.#serial);this.#check();const checked=await this.#document().load();this.#check();
   if(!checked||checked.serial!==saved.serial||JSON.stringify(checked.value)!==JSON.stringify(index))invalid();this.#index=checked.value;this.#serial=checked.serial;
  }
  for(const [key,source]of this.#captured){this.#check();const actual=this.physical.getItem(key);
   if(actual!==source.live&&!(actual===null&&this.#removed.has(key)))throw new Error('E2EE_SOURCE_CHANGED');
  }
  for(const [key,source]of this.#captured){this.#check();const actual=this.physical.getItem(key);
   if(actual!==source.live&&!(actual===null&&this.#removed.has(key)))throw new Error('E2EE_SOURCE_CHANGED');
   this.#previous.set(key,source.raw);
   if(actual!==null){this.physical.removeItem(key);if(this.physical.getItem(key)!==null)throw new Error('E2EE_STORAGE_UNAVAILABLE');this.#removed.add(key);}
  }
 }
 /** Resume only a previously sealed retirement; no new live content is assumed
  * to have participated in the completed migration. */
 async finishPrepared(){
  this.#check();if(this.#serial===null)return;
  for(const row of this.#index.entries.filter(row=>row.retiredBy!==null)){const key=row.key,raw=this.#previous.get(key)!;const live=this.physical.getItem(key);if(live!==null&&live!==raw)throw new Error('E2EE_SOURCE_CHANGED');this.#captured.set(key,{raw,live});}
  await this.retire();this.#check();
 }
 /** Called only after a verified signed cancellation, while the legacy fence
  * is still held. Restore only this uncommitted scope's exact removed copies. */
 async restoreCancelled(){
  this.#check();const rows=this.#index.entries.filter(row=>row.retiredBy===this.scopeId);
  for(const row of rows){const raw=this.#previous.get(row.key);if(raw===undefined)invalid();const live=this.physical.getItem(row.key);if(live!==null&&live!==raw)throw new Error('E2EE_SOURCE_CHANGED');}
  for(const row of rows){this.#check();const raw=this.#previous.get(row.key)!;if(this.physical.getItem(row.key)===null)this.physical.setItem(row.key,raw);if(this.physical.getItem(row.key)!==raw)throw new Error('E2EE_STORAGE_UNAVAILABLE');}
  if(rows.length){const index=structuredClone(this.#index);for(const row of index.entries)if(row.retiredBy===this.scopeId)row.retiredBy=null;
   const saved=await this.#document().save(index,this.#serial);this.#check();const checked=await this.#document().load();this.#check();
   if(!checked||checked.serial!==saved.serial||JSON.stringify(checked.value)!==JSON.stringify(index))invalid();this.#index=checked.value;this.#serial=checked.serial;
   for(const row of rows){this.#previous.delete(row.key);this.#captured.delete(row.key);this.#removed.delete(row.key);}
  }
 }
 close(){if(this.#closed)return;this.#closed=true;if(captures.get(this.device.ownerId)===this)captures.delete(this.device.ownerId);this.#captured.clear();this.#previous.clear();this.#removed.clear();}
}
export async function finishPreparedLegacyStorageRetirement(device:UnlockedWebDevice,current:()=>void){
 if(typeof localStorage==='undefined')return;
 const retirement=await LegacyStorageRetirement.open(device,localStorage,current,false);
 try{await retirement.finishPrepared();current();}finally{retirement.close();}
}
