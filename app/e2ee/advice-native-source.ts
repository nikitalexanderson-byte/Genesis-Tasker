import {exactKeys} from './keys.ts';
import {backupJson} from '../backup-format.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {isCivilDate} from '../calendar-context.ts';
import {ADVICE_CATALOGUE_LANGUAGES} from './advice-catalogue.ts';
import {validateAdviceMigrationPreferences,normalizeAdviceMigrationResponse,type AdviceMigrationMemory} from './advice-source.ts';

type Row=Record<string,unknown>;
const encoder=new TextEncoder(),MAX=16*1024*1024;
function invalid():never{throw new Error('E2EE_ADVICE_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function integer(value:unknown):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<0||(value as number)>Number.MAX_SAFE_INTEGER-1)invalid();}
function date(value:unknown):asserts value is string{if(typeof value!=='string'||!isCivilDate(value))invalid();}
function language(value:unknown):asserts value is string{if(!(ADVICE_CATALOGUE_LANGUAGES as readonly unknown[]).includes(value))invalid();}
function identity(value:unknown):asserts value is string{if(typeof value!=='string'||!/^advice-[a-f0-9]{24}$/.test(value))invalid();}
function parse(value:unknown):unknown{if(typeof value!=='string')invalid();try{return backupJson(value,MAX);}catch{return invalid();}}
async function hash(value:string){return [...new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(value)))].map(value=>value.toString(16).padStart(2,'0')).join('');}
function snapshotReference(value:unknown){
 if(typeof value!=='string')invalid();const match=/^advice-snapshot-v1-(\d{4}-\d{2}-\d{2})-(aurora|philosophers)-(advice-[a-f0-9]{24})$/.exec(value);
 if(!match)invalid();date(match[1]);return{dayKey:match[1],collection:match[2],id:match[3]};
}
function strings(value:unknown){if(!Array.isArray(value)||value.length>10000||value.some(row=>typeof row!=='string')||new Set(value).size!==value.length)invalid();return value as string[];}

/** Authenticated Room plaintext is supplied by native LocalCipher; no key enters
 * JS. Original ciphertext/raw v1 bytes remain in the protected native capture.
 * This module preserves content/provenance, never cached quota authority. */
export async function normalizeNativeAdviceCapture(input:unknown,remote:unknown,assertCurrent:()=>void){
 assertCurrent();exactKeys(input,['protocol','ownerId','scopeId','capturedAt','generation','pendingGeneration','documents','outbox','legacy','unknownLegacyCount','knownProfiles','mounted']);
 if(input.protocol!==1||typeof input.ownerId!=='string'||typeof input.scopeId!=='string'||typeof input.capturedAt!=='string'||!Number.isFinite(Date.parse(input.capturedAt)))invalid();
 integer(input.generation);integer(input.unknownLegacyCount);
 if(input.pendingGeneration!==null)throw new Error('E2EE_ADVICE_GENERATION_REVIEW_REQUIRED');
 if(input.unknownLegacyCount>0)throw new Error('E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED');
 if(!Array.isArray(input.documents)||input.documents.length>1026||!Array.isArray(input.outbox)||input.outbox.length)throw new Error('E2EE_ADVICE_QUEUE_REVIEW_REQUIRED');
 if(!Array.isArray(input.knownProfiles)||input.knownProfiles.length>4096||!Array.isArray(input.legacy)||input.legacy.length>10000)invalid();
 const owner=input.ownerId,profiles=new Map<string,{language:string;preferences:string}>(),rendered:AdviceMigrationMemory['rendered']=[],seen=new Map<string,{dayKey:string;id:string}>();
 const profileMetadata:unknown[]=[],indexes:unknown[]=[],legacyMetadata:unknown[]=[],documents:unknown[]=[];
 const rawDocuments=new Map<string,unknown>(),kinds=new Set<string>();let hasPrimary=false,hasHistory=false;
 const profile=async(languageValue:unknown,preferencesValue:unknown,expected?:string)=>{
  language(languageValue);if(typeof preferencesValue!=='string'||preferencesValue.length>16384)invalid();validateAdviceMigrationPreferences(parse(preferencesValue));
  const key=await hash(`${owner}\u0000${languageValue}\u0000${preferencesValue}`);assertCurrent();if(expected!==undefined&&key!==expected)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const value={language:languageValue,preferences:preferencesValue},old=profiles.get(key);if(old&&canonicalJson(old)!==canonicalJson(value))throw new Error('E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED');profiles.set(key,value);return key;
 };
 const retainResponse=(source:string,value:unknown)=>{normalizeAdviceMigrationResponse(value);rendered.push({source,response:value});if(rendered.length>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');};
 const cacheEntry=(source:string,value:unknown)=>{exactKeys(value,['deviceDay','response']);date(value.deviceDay);retainResponse(source,value.response);return value.deviceDay;};
 const retainSeen=(dayKey:unknown,id:unknown)=>{date(dayKey);identity(id);seen.set(dayKey+':'+id,{dayKey,id});if(seen.size>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');};
 for(const row of input.knownProfiles){exactKeys(row,['language','preferences']);await profile(row.language,row.preferences);}
 for(const row of input.documents){
  exactKeys(row,['kind','revision','encrypted','plain']);if(typeof row.kind!=='string'||kinds.has(row.kind)||typeof row.encrypted!=='string'||row.encrypted.length<1)invalid();integer(row.revision);kinds.add(row.kind);
  const raw=parse(row.plain);rawDocuments.set(row.kind,raw);documents.push({kind:row.kind,revision:row.revision});
  if(row.kind==='advice-cache-v2'||row.kind.startsWith('advice-cache-history-v2:')){
   if(row.kind==='advice-cache-v2')hasPrimary=true;else{if(!/^advice-cache-history-v2:[a-f0-9]{64}$/.test(row.kind)||await hash(row.encrypted)!==row.kind.slice('advice-cache-history-v2:'.length))invalid();hasHistory=true;}
   exactKeys(raw,['protocol','ownerId','profiles']);if(raw.protocol!==2||raw.ownerId!==owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');object(raw.profiles);if(Object.keys(raw.profiles).length>256)invalid();
   for(const [key,value]of Object.entries(raw.profiles)){
    if(!/^[a-f0-9]{64}$/.test(key))invalid();exactKeys(value,['language','preferences','current','seen','legacyOriginal']);await profile(value.language,value.preferences,key);
    const source=row.kind+':'+key;const deviceDay=value.current===null?null:cacheEntry(source,value.current);
    const legacyDay=value.legacyOriginal===null?null:cacheEntry(source+':legacy',parse(value.legacyOriginal));
    profileMetadata.push({source,profileHash:key,language:value.language,preferences:value.preferences,deviceDay,legacyDeviceDay:legacyDay});
    object(value.seen);if(Object.keys(value.seen).length>10000)invalid();for(const [marker,event]of Object.entries(value.seen)){
     exactKeys(event,['day','id']);date(event.day);identity(event.id);if(await hash(`${event.id}\u0000${event.day}`)!==marker)invalid();retainSeen(event.day,event.id);assertCurrent();
    }
   }
  }else if(row.kind==='advice-snapshots-v1'){
   object(raw);if(Object.keys(raw).some(key=>!['entries','latest','targets','delivered'].includes(key)))invalid();
  }else{
   const reference=snapshotReference(row.kind),value=normalizeAdviceMigrationResponse(raw);
   if(value.dayKey!==reference.dayKey||!value.history.some(card=>card.id===reference.id&&(card.collection??'aurora')===reference.collection))invalid();retainResponse(row.kind,raw);
  }
  assertCurrent();
 }
 if(hasHistory&&!hasPrimary)throw new Error('E2EE_ADVICE_CACHE_PRIMARY_MISSING');
 const legacyKeys=new Set<string>();
 for(const row of input.legacy){
  exactKeys(row,['key','value']);if(typeof row.key!=='string'||typeof row.value!=='string'||legacyKeys.has(row.key))invalid();legacyKeys.add(row.key);
  const match=/^([a-f0-9]{64})(?::seen:(advice-[a-f0-9]{24}))?$/.exec(row.key);if(!match||!profiles.has(match[1]))throw new Error('E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED');
  const descriptor=profiles.get(match[1])!;
  if(match[2]){date(row.value);retainSeen(row.value,match[2]);legacyMetadata.push({profileHash:match[1],...descriptor,kind:'seen',dayKey:row.value,id:match[2]});}
  else{const deviceDay=cacheEntry('legacy-v1:'+match[1],parse(row.value));legacyMetadata.push({profileHash:match[1],...descriptor,kind:'cache',deviceDay});}
 }
 const index=rawDocuments.get('advice-snapshots-v1');
 if(index!==undefined){
  object(index);const entries=index.entries===undefined?[]:strings(index.entries),delivered=index.delivered===undefined?[]:strings(index.delivered);for(const day of delivered)date(day);
  const references=new Set(entries);for(const key of entries)snapshotReference(key);
  const readLinks=(field:'latest'|'targets')=>{
   const value=index[field]??[];if(!Array.isArray(value)||value.length>10000)invalid();const names=new Set<string>();
   for(const row of value){exactKeys(row,field==='latest'?['day','language','kind']:['day','kind']);date(row.day);const reference=snapshotReference(row.kind);if(row.day!==reference.dayKey)invalid();if(field==='latest')language(row.language);
    const name=row.day+':'+(row.language??'target');if(names.has(name))invalid();names.add(name);references.add(row.kind as string);
   }return value;
  };
  const latest=readLinks('latest'),targets=readLinks('targets'),missingLocal:string[]=[];
  object(remote);const remoteEntries:Row[]=[];for(const field of ['days','entries','extraEntries']){const rows=remote[field];if(!Array.isArray(rows)||rows.length>10000)invalid();for(const row of rows){object(row);remoteEntries.push(row);}}
  for(const kind of references)if(!kinds.has(kind)){
   const reference=snapshotReference(kind);const exists=remoteEntries.some(row=>{if(row.dayKey!==reference.dayKey||row.adviceId!==reference.id)return false;const entry=parse(row.entryJson);object(entry);return(entry.collection??'aurora')===reference.collection;});
   if(!exists)throw new Error('E2EE_ADVICE_INDEX_REVIEW_REQUIRED');missingLocal.push(kind);
  }
  indexes.push({source:'advice-snapshots-v1',entries,latest,targets,delivered,missingLocal});
 }
 let preferences:AdviceMigrationMemory['preferences']=null,mounted:AdviceMigrationMemory['mounted']=null;
 if(input.mounted!==null){exactKeys(input.mounted,['preferences','mounted']);preferences=input.mounted.preferences as AdviceMigrationMemory['preferences'];mounted=input.mounted.mounted as AdviceMigrationMemory['mounted'];}
 const memory:AdviceMigrationMemory={ownerId:owner,generation:input.generation,reconciliationRequired:false,preferences,mounted,rendered,seen:[...seen.values()],unassignedLegacy:false};
 const snapshot={protocol:1,ownerId:owner,scopeId:input.scopeId,capturedAt:input.capturedAt,generationMarker:null,memory};
 const metadata={protocol:1,ownerId:owner,documents,profiles:profileMetadata,indexes,legacy:legacyMetadata};assertCurrent();return{snapshot,metadata};
}
