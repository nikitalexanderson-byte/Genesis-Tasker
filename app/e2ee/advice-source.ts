import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationSourceContext,type MigrationContent} from './migration.ts';
import {backupJson} from '../backup-format.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {isCivilDate} from '../calendar-context.ts';
import {advicePreferences,ADVICE_CATEGORIES,ADVICE_COLLECTIONS} from '../daily-advice.ts';
import {ADVICE_CATALOGUE_LANGUAGES,type PublicAdviceCatalogues,type AdviceCatalogueLanguage} from './advice-catalogue.ts';

const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=16*1024*1024;
type Row=Record<string,unknown>;
export type AdviceMigrationMemory={ownerId:string;generation:number;reconciliationRequired:boolean;
 preferences:{base:unknown;value:unknown}|null;mounted:{language:string;result:unknown;selection:string|null}|null;
 rendered:{source:string;response:unknown}[];seen:{dayKey:string;id:string}[];unassignedLegacy:boolean};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;memory:AdviceMigrationMemory;generationMarker:string|null};
export type AdviceSourcePorts={storage:Pick<Storage,'getItem'>;memory:()=>AdviceMigrationMemory;assertCurrent:()=>void;
 legacyAdvice:(context:MigrationSourceContext)=>Promise<unknown>;catalogues:Pick<PublicAdviceCatalogues,'resolve'>};
function invalid():never{throw new Error('E2EE_ADVICE_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function allowed(value:unknown,fields:readonly string[]):asserts value is Row{object(value);if(Object.keys(value).some(key=>!fields.includes(key)))invalid();}
function integer(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER-1):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>max)invalid();}
function date(value:unknown):asserts value is string{if(typeof value!=='string'||!isCivilDate(value))invalid();}
function time(value:unknown):asserts value is string{if(typeof value!=='string'||!Number.isFinite(Date.parse(value)))invalid();}
function identity(value:unknown):asserts value is string{if(typeof value!=='string'||!/^advice-[a-f0-9]{24}$/.test(value))invalid();}
function language(value:unknown):asserts value is AdviceCatalogueLanguage{if(!ADVICE_CATALOGUE_LANGUAGES.includes(value as AdviceCatalogueLanguage))invalid();}
function parse(raw:unknown):unknown{if(typeof raw!=='string')invalid();try{return backupJson(raw,MAX);}catch{return invalid();}}
function list(value:unknown,choices:readonly string[],minimum=0):asserts value is string[]{
 if(!Array.isArray(value)||value.length<minimum||value.length>choices.length||new Set(value).size!==value.length||value.some(id=>typeof id!=='string'||!choices.includes(id)))invalid();
}
function preferences(value:unknown){
 allowed(value,['enabled','smart','categories','aphrodisiaAdult','collections','notifications','psychopompia','philosophersPerDay']);
 for(const key of ['enabled','smart'])if(value[key]!==undefined&&typeof value[key]!=='boolean')invalid();
 if(value.aphrodisiaAdult!==undefined&&value.aphrodisiaAdult!==null&&typeof value.aphrodisiaAdult!=='boolean')invalid();
 if(value.categories!==undefined)list(value.categories,ADVICE_CATEGORIES);if(value.collections!==undefined)list(value.collections,ADVICE_COLLECTIONS,1);
 if(value.philosophersPerDay!==undefined)integer(value.philosophersPerDay,1,3);
 if(value.notifications!==undefined){allowed(value.notifications,['enabled','time','timeZone']);const row=value.notifications;
  if(row.enabled!==undefined&&typeof row.enabled!=='boolean'||row.time!==undefined&&(typeof row.time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.time))
   ||row.timeZone!==undefined&&(typeof row.timeZone!=='string'||row.timeZone.length>128))invalid();}
 if(value.psychopompia!==undefined){allowed(value.psychopompia,['adultConfirmed','subcategories','alcohol']);const row=value.psychopompia;
  if(row.adultConfirmed!==undefined&&typeof row.adultConfirmed!=='boolean'||row.subcategories!==undefined&&(!Array.isArray(row.subcategories)||row.subcategories.length>32||row.subcategories.some(id=>typeof id!=='string'||id.length>80)))invalid();
  if(row.alcohol!==undefined){allowed(row.alcohol,['consent','countryCode','subdivisionCode','ageAtLeast','policyVersion']);const alcohol=row.alcohol;
   if(alcohol.consent!==undefined&&typeof alcohol.consent!=='boolean')invalid();
   for(const key of ['countryCode','subdivisionCode','policyVersion'])if(alcohol[key]!==undefined&&(typeof alcohol[key]!=='string'||alcohol[key].length>80))invalid();
   if(alcohol.ageAtLeast!==undefined&&alcohol.ageAtLeast!==null)integer(alcohol.ageAtLeast,18,100);}}
 const normalized=advicePreferences(value);
 const preserved=(raw:unknown,result:unknown):boolean=>{
  if(Array.isArray(raw))return Array.isArray(result)&&raw.length===result.length&&raw.every(item=>result.some(other=>canonicalJson(item)===canonicalJson(other)));
  if(raw&&typeof raw==='object')return !!result&&typeof result==='object'&&Object.entries(raw).every(([key,item])=>preserved(item,(result as Row)[key]));
  return raw===result;
 };
 if(!preserved(value,normalized))throw new Error('E2EE_ADVICE_PREFERENCES_REVIEW_REQUIRED');return normalized;
}
function merge(base:unknown,local:unknown,remote:unknown):unknown{
 if(canonicalJson(local)===canonicalJson(base)||canonicalJson(local)===canonicalJson(remote))return remote;
 if(canonicalJson(remote)===canonicalJson(base))return local;
 if(base&&local&&remote&&typeof base==='object'&&typeof local==='object'&&typeof remote==='object'&&!Array.isArray(base)&&!Array.isArray(local)&&!Array.isArray(remote)){
  const result:Row={};for(const key of new Set([...Object.keys(base),...Object.keys(local),...Object.keys(remote)]))result[key]=merge((base as Row)[key],(local as Row)[key],(remote as Row)[key]);return result;
 }
 throw new Error('E2EE_ADVICE_CONFLICT_REVIEW_REQUIRED');
}
function card(value:unknown,day:string,raw=false):Row{
 allowed(value,['id','categories','title','body','language','sources','image','aphrodisiaTheme','requiresAdult','collection','subcategories','containsAlcohol','review','editorialContext',
  ...(raw?['contentVersion','translationVersion','sourceId','topics','schedule','status','timeOfDay','priority']:['dayKey','dismissed','sequence','psychopompiaPublished'])]);
 identity(value.id);language(value.language);list(value.categories,ADVICE_CATEGORIES,(value.collection??'aurora')==='philosophers'?0:1);
 if(value.collection!==undefined&&!ADVICE_COLLECTIONS.includes(value.collection as typeof ADVICE_COLLECTIONS[number]))invalid();
 if(typeof value.body!=='string'||!value.body.trim()||value.body.length>100000||value.title!==undefined&&(typeof value.title!=='string'||value.title.length>2000))invalid();
 if(!Array.isArray(value.sources)||value.sources.length>20)invalid();
 for(const source of value.sources){allowed(source,['kind','author','work','reference','url']);if(!['quote','inspired'].includes(String(source.kind)))invalid();for(const key of ['author','work','reference','url'])if(source[key]!==undefined&&(typeof source[key]!=='string'||source[key].length>2000))invalid();
  if(source.url&&!/^https?:\/\/[^\s]+$/u.test(String(source.url)))invalid();}
 if(value.image!==undefined&&(typeof value.image!=='string'||!/^\/advice-art\/[a-z0-9-]+\/advice-[a-f0-9]{24}\.webp$/.test(value.image)))invalid();
 if(!raw){if(value.dayKey!==day||typeof value.dismissed!=='boolean')invalid();if(value.sequence!==undefined)integer(value.sequence,1,9);}
 for(const key of ['requiresAdult','containsAlcohol','editorialContext','psychopompiaPublished'])if(value[key]!==undefined&&typeof value[key]!=='boolean')invalid();
 return value;
}
/** Portable display state only. Live quota and permission fields remain solely
 * in the protected source snapshot, never imported as new authorization. */
function response(value:unknown){
 allowed(value,['dayKey','state','advice','history','sequence','dailyLimit','remaining','canNext']);date(value.dayKey);
 if(!['disabled','empty','no-match','ready'].includes(String(value.state))||value.canNext!==undefined&&typeof value.canNext!=='boolean')invalid();
 for(const key of ['sequence','dailyLimit','remaining'])if(value[key]!==undefined)integer(value[key],0,9);
 const sequence=(value.sequence as number|undefined)??1,limit=(value.dailyLimit as number|undefined)??1;
 if(limit<1||value.canNext===true&&sequence>=limit)invalid();
 if(value.advice!==null)card(value.advice,value.dayKey);if((value.state==='ready')!==(value.advice!==null))invalid();
 let history:Row[]=[];if(value.history!==undefined){if(!Array.isArray(value.history)||value.history.length>9)invalid();history=value.history.map(row=>card(row,value.dayKey as string));
  if(history.length>limit||new Set(history.map(row=>row.id)).size!==history.length||value.advice!==null&&!history.some(row=>row.id===(value.advice as Row).id)
   ||history.some((row,index)=>typeof row.sequence!=='number'||row.sequence>sequence||index>0&&row.sequence<=(history[index-1].sequence as number))
   ||new Set(history.map(row=>row.language)).size>1||value.advice!==null&&history.some(row=>row.language!==(value.advice as Row).language))invalid();}
 else if(value.advice!==null)history=[value.advice as Row];
 return{dayKey:value.dayKey,state:value.state,advice:value.advice,history};
}

/** Owner-bound actual Advice selections/preferences and mounted rendered state.
 * The full coordinator encrypts capture before any signed source/catalogue IO.
 * Native supplies authenticated local responses; unknown provenance blocks. */
export class PersonalAdviceSource implements PrivatePathAdapter{
 readonly id='personal.advice';#owner:string;#scope:string;#ports:AdviceSourcePorts;
 constructor(ownerId:string,scopeId:string,ports:AdviceSourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
 async captureLocal():Promise<Uint8Array>{
  this.#ports.assertCurrent();const value:Snapshot={protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),memory:this.#ports.memory(),generationMarker:this.#ports.storage.getItem(`genesis-data-generation-v1:${this.#owner}`)};
  if(value.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const bytes=encoder.encode(JSON.stringify(value));this.#ports.assertCurrent();if(bytes.length>MAX){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
 }
 #decode(bytes:Uint8Array):Snapshot{
  if(bytes.length<1||bytes.length>MAX)invalid();const value=parse(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','memory','generationMarker']);
  if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');time(value.capturedAt);
  exactKeys(value.memory,['ownerId','generation','reconciliationRequired','preferences','mounted','rendered','seen','unassignedLegacy']);const memory=value.memory;
  if(memory.ownerId!==this.#owner||typeof memory.reconciliationRequired!=='boolean'||typeof memory.unassignedLegacy!=='boolean'||!Array.isArray(memory.rendered)||!Array.isArray(memory.seen)||memory.rendered.length>10000||memory.seen.length>10000)invalid();integer(memory.generation);
  if(value.generationMarker!==null&&value.generationMarker!==String(memory.generation)||memory.reconciliationRequired)throw new Error('E2EE_ADVICE_GENERATION_REVIEW_REQUIRED');
  if(memory.unassignedLegacy)throw new Error('E2EE_ADVICE_PROVENANCE_REVIEW_REQUIRED');
  if(memory.preferences!==null){exactKeys(memory.preferences,['base','value']);preferences(memory.preferences.base);preferences(memory.preferences.value);}
  if(memory.mounted!==null){const mounted=memory.mounted;exactKeys(mounted,['language','result','selection']);language(mounted.language);const rendered=response(mounted.result);
   if(rendered.history.some(row=>row.language!==mounted.language))invalid();if(mounted.selection!==null){identity(mounted.selection);if(!rendered.history.some(row=>row.id===mounted.selection))invalid();}}
  for(const row of memory.rendered){exactKeys(row,['source','response']);if(typeof row.source!=='string'||row.source.length<1||row.source.length>1024)invalid();response(row.response);}
  for(const row of memory.seen){exactKeys(row,['dayKey','id']);date(row.dayKey);identity(row.id);}
  return value as unknown as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext):Promise<{complete:boolean;content:MigrationContent[]}>{
  this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(previous.length>32||local.length+previous.reduce((sum,bytes)=>sum+bytes.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const snapshot=this.#decode(local);for(const bytes of previous){const old=this.#decode(bytes);if(canonicalJson(old.memory)!==canonicalJson(snapshot.memory)||old.generationMarker!==snapshot.generationMarker)throw new Error('E2EE_ADVICE_HISTORY_REVIEW_REQUIRED');}
  const remote=await this.#ports.legacyAdvice(context);this.#ports.assertCurrent();exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision',
   'preferencesJson','collectionsJson','notificationsJson','psychopompiaJson','philosophersPerDay','days','entries','extraEntries','metrics']);
  if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32);
  if(remote.legacyGeneration!==snapshot.memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_ADVICE_GENERATION_REVIEW_REQUIRED');
  const original=parse(remote.preferencesJson);object(original);integer(remote.philosophersPerDay,1,3);
  const rawPreferences={...original,collections:parse(remote.collectionsJson),notifications:parse(remote.notificationsJson),psychopompia:parse(remote.psychopompiaJson),philosophersPerDay:remote.philosophersPerDay};
  let current=preferences(rawPreferences);const edits=snapshot.memory.preferences;
  if(edits)current=preferences(merge(preferences(edits.base),preferences(edits.value),current));
  const content:MigrationContent[]=[];let size=0,complete=false;
  const add=(objectId:string,value:unknown)=>{const bytes=encoder.encode(JSON.stringify(value));size+=bytes.length;if(bytes.length>MAX||size>E2EE_MIGRATION_BYTE_BUDGET||content.length>=10000){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}content.push({domain:'workspace',objectId,bytes});};
  try{
   add('personal-advice-preferences-v1',{protocol:1,ownerId:this.#owner,preferences:current,rawPreferences,
    originals:{preferencesJson:remote.preferencesJson,collectionsJson:remote.collectionsJson,notificationsJson:remote.notificationsJson,psychopompiaJson:remote.psychopompiaJson,philosophersPerDay:remote.philosophersPerDay},editing:edits});
   const days=new Map<string,{pointer:unknown;entries:unknown[];extraEntries:unknown[]}>(),names=new Set<string>();let count=0;
   const editions=new Map<string,Promise<Record<string,unknown>>>();
   const texts=(entry:Row)=>{
    if(entry.contentVersion!==undefined&&entry.translationVersion!==undefined)invalid();
    const version=entry.contentVersion??entry.translationVersion;if(version===undefined)return null;if(typeof version!=='string')invalid();
    const kind=entry.translationVersion===undefined?'daily':'philosophers';if(kind==='philosophers'&&entry.collection!=='philosophers')invalid();
    const name=kind+':'+version+':'+entry.id;if(!editions.has(name))editions.set(name,(async()=>{const values:Record<string,unknown>={};for(const lang of ADVICE_CATALOGUE_LANGUAGES){this.#ports.assertCurrent();values[lang]=await this.#ports.catalogues.resolve(kind,version,lang,entry.id as string);this.#ports.assertCurrent();}return values;})());return editions.get(name)!;
   };
   for(const family of ['days','entries','extraEntries']as const){if(!Array.isArray(remote[family]))invalid();for(const row of remote[family]){
    if(++count>10000)throw new Error('E2EE_SOURCE_TOO_LARGE');exactKeys(row,['dayKey','adviceId','entryJson','createdAt','viewedAt','dismissedAt',family==='days'?'selectionJson':'slot']);
    date(row.dayKey);identity(row.adviceId);time(row.createdAt);for(const field of ['viewedAt','dismissedAt'])if(row[field]!==null)time(row[field]);
    if(family!=='days')integer(row.slot,family==='entries'?1:7,family==='entries'?6:9);
    const name=family+':'+row.dayKey+':'+(row.slot??'pointer');if(names.has(name))invalid();names.add(name);
    const entry=card(parse(row.entryJson),row.dayKey,true);if(entry.id!==row.adviceId)invalid();
    const selection=family==='days'?parse(row.selectionJson):null;if(selection!==null)preferences(selection);
    const portable={...row,entry,translations:await texts(entry),...(family==='days'?{selection}:{})};this.#ports.assertCurrent();
    if(!days.has(row.dayKey))days.set(row.dayKey,{pointer:null,entries:[],extraEntries:[]});const day=days.get(row.dayKey)!;
    if(family==='days')day.pointer=portable;else day[family].push(portable);
   }}
   // Dates/selection identities stay inside ciphertext, never in remote AAD or
   // object IDs. The encrypted index is part of the same persisted shadow plan.
   const index:{dayKey:string;objectId:string}[]=[];
   for(const [day,history]of [...days].sort(([a],[b])=>a.localeCompare(b))){const objectId='personal-advice-day:'+crypto.randomUUID();
    index.push({dayKey:day,objectId});add(objectId,{protocol:1,ownerId:this.#owner,dayKey:day,...history});}
   add('personal-advice-history-index-v1',{protocol:1,ownerId:this.#owner,days:index});
   let metrics:unknown=null;if(remote.metrics!==null){exactKeys(remote.metrics,['projects','tasks','openTasks','completedTasks','googleSynced','habits','updatedAt']);for(const field of ['projects','tasks','openTasks','completedTasks','googleSynced','habits'])integer(remote.metrics[field]);time(remote.metrics.updatedAt);metrics=remote.metrics;}
   add('personal-advice-local-history-v1',{protocol:1,ownerId:this.#owner,metrics,mounted:snapshot.memory.mounted===null?null:{...snapshot.memory.mounted,result:response(snapshot.memory.mounted.result)},
    rendered:snapshot.memory.rendered.map(row=>({source:row.source,response:response(row.response)})),seen:snapshot.memory.seen});
   this.#ports.assertCurrent();complete=true;return{complete:true,content};
  }finally{if(!complete)content.forEach(row=>row.bytes.fill(0));}
 }
}

/** The native capture normalizer uses the identical lossless preference and
 * portable response validation; it never imports cached live permissions. */
export const validateAdviceMigrationPreferences=preferences;
export const normalizeAdviceMigrationResponse=response;
