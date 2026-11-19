import {assertTechnical,exactKeys} from './keys.ts';
import {decodeE2eeBytes} from './envelope.ts';
import {backupJson} from '../backup-format.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {validateDiaryNote,validDreamDay} from '../diary-model.ts';
import {E2EE_MIGRATION_BYTE_BUDGET,type MigrationContent,type MigrationSourceContext} from './migration.ts';
import type {PrivatePathAdapter} from './migration-sources.ts';

type Row=Record<string,unknown>;
export type DiaryMigrationMemory={ownerId:string;legacyKey:string;generation:number;reconciliationRequired:boolean;records:unknown[];editors:unknown[]};
export type DiaryMigrationVariant={source:string;note:Row|null;revision:number;deleted:boolean};
export type DiaryMigrationConflict={id:string;placement:'remote'|'local';variants:readonly DiaryMigrationVariant[]};
export type DiarySourcePorts={storage:Pick<Storage,'getItem'|'key'|'length'>;memory:()=>DiaryMigrationMemory;assertCurrent:()=>void;
 legacyDiary:(context:MigrationSourceContext)=>Promise<unknown>;openLegacy?:(envelope:{iv:string;ciphertext:string},purpose:string)=>Promise<unknown>;
 review?:(conflicts:readonly DiaryMigrationConflict[])=>Promise<Record<string,string>>};
type Snapshot={protocol:1;ownerId:string;scopeId:string;capturedAt:string;entries:{key:string;value:string|null}[];memory:DiaryMigrationMemory};
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),MAX=16*1024*1024;
function invalid():never{throw new Error('E2EE_DIARY_SOURCE_INVALID');}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function allowed(value:unknown,keys:readonly string[]):asserts value is Row{object(value);if(Object.keys(value).some(key=>!keys.includes(key)))throw new Error('E2EE_DIARY_FORMAT_UNSUPPORTED');}
function integer(value:unknown,min=0):asserts value is number{if(!Number.isSafeInteger(value)||(value as number)<min||(value as number)>Number.MAX_SAFE_INTEGER-1)invalid();}
function text(value:unknown,max=MAX):asserts value is string{if(typeof value!=='string'||value.length>max)invalid();}
function id(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))invalid();}
function time(value:unknown):asserts value is string{text(value,64);if(!Number.isFinite(Date.parse(value)))invalid();}
function list(value:unknown):asserts value is unknown[]{if(!Array.isArray(value)||value.length>10000)invalid();}
/** Preserve raw JSON until duplicate decoded names have been checked. */
export function parseDiaryMigrationJson(value:unknown):unknown{
 text(value);try{
  const result=backupJson(value,MAX),stack:(Set<string>|null)[]=[];
  for(let index=0;index<value.length;index++){
   const char=value[index];if(char==='{'||char==='['){stack.push(char==='{'?new Set():null);if(stack.length>41)invalid();}
   else if(char==='}'||char===']')stack.pop();else if(char==='"'){
    const start=index;index++;while(index<value.length&&value[index]!=='"'){if(value[index]==='\\')index++;index++;}
    let next=index+1;while(next<value.length&&/\s/u.test(value[next]))next++;
    if(value[next]===':'){const names=stack.at(-1);if(!names)invalid();const key=JSON.parse(value.slice(start,index+1)) as string;if(names.has(key))invalid();names.add(key);}
   }
  }return result;
 }catch{return invalid();}
}
function note(value:unknown,draft=false):Row{
 object(value);id(value.id);if(draft&&typeof value.body==='string'&&!value.body.trim()){
  validateDiaryNote({...value,body:'draft'});return structuredClone(value);
 }
 validateDiaryNote(value);return structuredClone(value);
}
function deletion(value:unknown){exactKeys(value,['id','revision','updatedAt','localOnly']);id(value.id);integer(value.revision,2);time(value.updatedAt);if(typeof value.localOnly!=='boolean')invalid();return value as {id:string;revision:number;updatedAt:string;localOnly:boolean};}
function settings(value:unknown):Row{allowed(value,['syncEnabled','revision','deviceLocalOnly']);if(typeof value.syncEnabled!=='boolean'||value.deviceLocalOnly!==undefined&&typeof value.deviceLocalOnly!=='boolean')invalid();integer(value.revision);return value;}
function dreamSettings(value:unknown){exactKeys(value,['todayMode','revision']);if(!['off','morning','all-day'].includes(String(value.todayMode)))invalid();integer(value.revision);return value;}
function base64(value:unknown,min:number,max=min){text(value,Math.ceil(max/3)*4);if(value.length%4||!/^[A-Za-z0-9+/]*={0,2}$/.test(value))invalid();let bytes:Uint8Array;
 try{bytes=Uint8Array.from(atob(value),char=>char.charCodeAt(0));}catch{return invalid();}
 if(bytes.length<min||bytes.length>max||btoa(atob(value.slice(-4)))!==value.slice(-4)){bytes.fill(0);invalid();}return bytes;
}
function envelope(value:unknown,draft=false):asserts value is Row{
 allowed(value,draft?['iv','ciphertext','expectedRevision','schemaVersion']:['id','iv','ciphertext','revision','schemaVersion','updatedAt','localOnly','uploadId','expectedRevision']);
 if(value.schemaVersion!==1)throw new Error('E2EE_DIARY_FORMAT_UNSUPPORTED');base64(value.iv,12).fill(0);base64(value.ciphertext,16,MAX).fill(0);
 if(draft)integer(value.expectedRevision);else{id(value.id);integer(value.revision,value.localOnly===true?0:1);time(value.updatedAt);
  if(value.localOnly!==undefined&&typeof value.localOnly!=='boolean')invalid();if(value.uploadId!==undefined)id(value.uploadId);if(value.expectedRevision!==undefined)integer(value.expectedRevision);}
}

/** Full diary cache/drafts/settings and mounted state. No ordinary diary methods,
 * privacy toggles, quota checks, upload acknowledgements or provider calls. */
export class PersonalDiarySource implements PrivatePathAdapter{
 readonly id='personal.diary';#owner:string;#scope:string;#ports:DiarySourcePorts;
 constructor(ownerId:string,scopeId:string,ports:DiarySourcePorts){assertTechnical(ownerId);assertTechnical(scopeId);this.#owner=ownerId;this.#scope=scopeId;this.#ports=ports;}
 #prefix(){return`genesis-diary-v1:${this.#owner}:`;}
 #required(){return['cache','deleted','settings','dream-settings'].map(key=>this.#prefix()+key);}
 async captureLocal():Promise<Uint8Array>{
  this.#ports.assertCurrent();const keys=new Set(this.#required());for(let index=0;index<this.#ports.storage.length;index++){
   const key=this.#ports.storage.key(index);if(key?.startsWith(this.#prefix()))keys.add(key);
  }
  if(keys.size>10004)throw new Error('E2EE_SNAPSHOT_TOO_LARGE');
  const value:Snapshot={protocol:1,ownerId:this.#owner,scopeId:this.#scope,capturedAt:new Date().toISOString(),entries:[...keys].sort().map(key=>({key,value:this.#ports.storage.getItem(key)})),memory:this.#ports.memory()};
  if(value.memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  const bytes=encoder.encode(JSON.stringify(value));this.#ports.assertCurrent();if(bytes.length>MAX){bytes.fill(0);throw new Error('E2EE_SNAPSHOT_TOO_LARGE');}return bytes;
 }
 #decode(bytes:Uint8Array):Snapshot{
  if(bytes.length<1||bytes.length>MAX)invalid();const value=parseDiaryMigrationJson(decoder.decode(bytes));exactKeys(value,['protocol','ownerId','scopeId','capturedAt','entries','memory']);
  if(value.protocol!==1||value.ownerId!==this.#owner||value.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');time(value.capturedAt);
  if(!Array.isArray(value.entries)||value.entries.length>10004)invalid();const seen=new Set<string>(),required=this.#required();
  for(const row of value.entries){exactKeys(row,['key','value']);text(row.key,1024);if(!row.key.startsWith(this.#prefix())||seen.has(row.key)||row.value!==null&&typeof row.value!=='string')invalid();seen.add(row.key);
   if(!required.includes(row.key)&&!/^draft:[^:]{1,100}:[a-zA-Z0-9_-]{1,100}$/.test(row.key.slice(this.#prefix().length)))throw new Error('E2EE_DIARY_FORMAT_UNSUPPORTED');
  }
  if(required.some(key=>!seen.has(key)))invalid();exactKeys(value.memory,['ownerId','legacyKey','generation','reconciliationRequired','records','editors']);const memory=value.memory;
  if(memory.ownerId!==this.#owner)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');text(memory.legacyKey,44);integer(memory.generation);
  if(typeof memory.reconciliationRequired!=='boolean')invalid();if(memory.reconciliationRequired)throw new Error('E2EE_DIARY_GENERATION_REVIEW_REQUIRED');list(memory.records);list(memory.editors);
  return value as Snapshot;
 }
 async reconcile(local:Uint8Array,previous:readonly Uint8Array[],context?:MigrationSourceContext){
  this.#ports.assertCurrent();if(!context||context.ownerId!==this.#owner||context.scopeId!==this.#scope)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  if(previous.length>32||local.length+previous.reduce((size,bytes)=>size+bytes.length,0)>E2EE_MIGRATION_BYTE_BUDGET)throw new Error('E2EE_MIGRATION_HISTORY_LIMIT');
  const snapshot=this.#decode(local),stable=(value:Snapshot)=>({...value,capturedAt:''});
  for(const old of previous)if(canonicalJson(stable(this.#decode(old)))!==canonicalJson(stable(snapshot)))throw new Error('E2EE_DIARY_HISTORY_REVIEW_REQUIRED');
  const values=new Map(snapshot.entries.map(row=>[row.key.slice(this.#prefix().length),row.value]));
  const read=(key:string)=>{const raw=values.get(key);return raw===null||raw===undefined?null:parseDiaryMigrationJson(raw);};
  const savedSettings=read('settings'),localSettings=savedSettings===null?null:settings(savedSettings);const localDream=read('dream-settings');if(localDream!==null)dreamSettings(localDream);
  const localDeleted=read('deleted')??[];list(localDeleted);const deletions=localDeleted.map(deletion);if(new Set(deletions.map(row=>row.id)).size!==deletions.length)invalid();
  const remote=await this.#ports.legacyDiary(context);this.#ports.assertCurrent();exactKeys(remote,['protocol','ownerId','scopeId','migrationId','fence','sourceHash','legacyGeneration','checkpointHash','directoryRevision','notes','deletions','settings','dreams','dreamSettings','adviceReferences','legacyKey']);
  if(remote.protocol!==1||remote.ownerId!==this.#owner||remote.scopeId!==this.#scope||remote.migrationId!==context.migrationId||remote.fence!==context.fence||remote.sourceHash!==context.sourceHash)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  integer(remote.legacyGeneration);integer(remote.directoryRevision,1);decodeE2eeBytes(remote.checkpointHash,32);
  if(remote.legacyGeneration!==snapshot.memory.generation||context.generation<=remote.legacyGeneration)throw new Error('E2EE_DIARY_GENERATION_REVIEW_REQUIRED');
  let rows=0;for(const key of ['notes','deletions','settings','dreams','dreamSettings','adviceReferences']){list(remote[key]);rows+=(remote[key] as unknown[]).length;}
  if(rows>10000||encoder.encode(JSON.stringify(remote)).length>MAX)throw new Error('E2EE_SOURCE_TOO_LARGE');
  const serverSettings=remote.settings as Row[],serverDream=remote.dreamSettings as Row[];
  if(serverSettings.length>1||serverDream.length>1)invalid();
  for(const row of serverSettings){exactKeys(row,['sync_enabled','revision','command_hash','removed_count','updated_at']);integer(row.sync_enabled);if(row.sync_enabled>1)invalid();integer(row.revision);integer(row.removed_count);time(row.updated_at);if(row.command_hash!==null&&(typeof row.command_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.command_hash)))invalid();}
  for(const row of serverDream){exactKeys(row,['today_mode','revision','updated_at']);dreamSettings({todayMode:row.today_mode,revision:row.revision});time(row.updated_at);}
  const serverDeletions:ReturnType<typeof deletion>[]=[];for(const row of remote.deletions as unknown[]){exactKeys(row,['id','revision','local_only','updated_at']);if(row.local_only!==0&&row.local_only!==1)invalid();serverDeletions.push(deletion({id:row.id,revision:row.revision,updatedAt:row.updated_at,localOnly:row.local_only===1}));}
  if(new Set(serverDeletions.map(row=>row.id)).size!==serverDeletions.length)invalid();
  const privacyIds=new Set([...deletions,...serverDeletions].filter(row=>row.localOnly).map(row=>row.id));
  const localPrivate=localSettings!==null&&(localSettings.deviceLocalOnly===true||localSettings.syncEnabled===false),serverPrivate=serverSettings.some(row=>row.sync_enabled===0);
  const cloud=new Map<string,DiaryMigrationVariant[]>(),device=new Map<string,DiaryMigrationVariant[]>(),drafts:Row[]=[],history:Row[]=[],serverHistory:Row[]=[];
  const keys:CryptoKey[]=[],content:MigrationContent[]=[],localContent:MigrationContent[]=[];let complete=false,outputSize=0;
  const add=(placement:'remote'|'local',source:string,value:Row|null,revision:number,deleted=false,identity?:string)=>{
   const name=identity??value?.id;id(name);const target=placement==='remote'?cloud:device,entries=target.get(name)??[];
   if(entries.some(row=>row.source===source))invalid();entries.push({source,note:value,revision,deleted});target.set(name,entries);if(cloud.size+device.size>9990)throw new Error('E2EE_SOURCE_TOO_LARGE');
  };
  const open=async(row:Row,identity:string)=>{
   const packet={iv:row.iv as string,ciphertext:row.ciphertext as string},purpose=`diary-note:v1:${identity}`;let value:unknown;
   if(this.#ports.openLegacy)value=await this.#ports.openLegacy(packet,purpose);
   else{
    const iv=base64(packet.iv,12),cipher=base64(packet.ciphertext,16,MAX);let plain:Uint8Array|undefined;
    try{for(const key of keys)try{plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:new Uint8Array(iv),additionalData:encoder.encode(`genesis-mindmap-v1:${this.#owner}:${purpose}`)},key,new Uint8Array(cipher)));break;}catch{/* Only captured old keys may open the source. */}
     if(!plain)throw new Error(keys.length?'E2EE_LEGACY_DIARY_CORRUPT':'E2EE_LEGACY_KEY_UNAVAILABLE');value=parseDiaryMigrationJson(decoder.decode(plain));
    }finally{iv.fill(0);cipher.fill(0);plain?.fill(0);}
   }
   this.#ports.assertCurrent();return typeof value==='string'?parseDiaryMigrationJson(value):value;
  };
  const output=(placement:'remote'|'local',objectId:string,value:unknown)=>{const bytes=encoder.encode(JSON.stringify(value));outputSize+=bytes.length;if(bytes.length>MAX||outputSize>E2EE_MIGRATION_BYTE_BUDGET||content.length+localContent.length>=10000){bytes.fill(0);throw new Error('E2EE_SOURCE_TOO_LARGE');}(placement==='remote'?content:localContent).push({domain:'diary',objectId,bytes});};
  try{
   exactKeys(remote.legacyKey,['keyMode','key']);if(!['account','client','empty'].includes(String(remote.legacyKey.keyMode)))invalid();
   if(!this.#ports.openLegacy){
    for(const encoded of [...(snapshot.memory.legacyKey?[snapshot.memory.legacyKey]:[]),...(remote.legacyKey.keyMode==='account'?[remote.legacyKey.key]:[])]){const bytes=base64(encoded,32);try{keys.push(await crypto.subtle.importKey('raw',new Uint8Array(bytes),'AES-GCM',false,['decrypt']));}finally{bytes.fill(0);}}
    if(remote.legacyKey.keyMode!=='account'&&remote.legacyKey.key!==null)invalid();
   }else if(snapshot.memory.legacyKey!==''||remote.legacyKey.key!==null)throw new Error('E2EE_KEY_BRIDGE_FORBIDDEN');
   const serverNotes=new Map<string,Row>();for(const row of remote.notes as unknown[]){exactKeys(row,['id','revision','schema_version','iv','ciphertext','payload_hash','updated_at']);id(row.id);integer(row.revision,1);time(row.updated_at);
    if(serverNotes.has(row.id)||row.schema_version!==1||row.payload_hash!==null&&(typeof row.payload_hash!=='string'||!/^[a-f0-9]{64}$/.test(row.payload_hash)))invalid();
    base64(row.iv,12).fill(0);base64(row.ciphertext,16,MAX).fill(0);const value=note(await open(row,row.id));if(value.id!==row.id)invalid();
    const placement=serverPrivate||privacyIds.has(row.id)?'local':'remote';add(placement,'server',value,row.revision);serverNotes.set(row.id,value);
    serverHistory.push({id:row.id,revision:row.revision,schemaVersion:row.schema_version,payloadHash:row.payload_hash,updatedAt:row.updated_at});
    if(placement==='local')history.push({source:'server',note:value,revision:row.revision,updatedAt:row.updated_at,payloadHash:row.payload_hash});
   }
   const cache=read('cache')??[];list(cache);const cached=new Set<string>();for(const row of cache){envelope(row);id(row.id);if(cached.has(row.id))invalid();cached.add(row.id);const value=note(await open(row,row.id));if(value.id!==row.id)invalid();
    if(row.localOnly===true)privacyIds.add(row.id);const placement=localPrivate||row.localOnly===true||privacyIds.has(row.id)?'local':'remote';add(placement,'cache',value,row.revision as number);history.push({source:'cache',note:value,revision:row.revision,expectedRevision:row.expectedRevision??null,localOnly:row.localOnly??false,uploadId:row.uploadId??null,updatedAt:row.updatedAt});
   }
   for(const [key,raw]of values)if(key.startsWith('draft:')){if(raw===null)invalid();const row=parseDiaryMigrationJson(raw);envelope(row,true);const identity=key.split(':').at(-1)!;id(identity);const value=note(await open(row,identity),true);if(value.id!==identity)invalid();drafts.push({source:key,note:value,revision:row.expectedRevision,kind:'draft'});}
   const memoryNames=new Set<string>();for(const row of snapshot.memory.records){allowed(row,['note','revision','draftKey','pending','localOnly','uploadId','pendingNote','source']);const value=note(row.note,row.draftKey!=null);id(value.id);integer(row.revision);
    if(row.localOnly!==undefined&&typeof row.localOnly!=='boolean')invalid();if(row.uploadId!==undefined&&row.uploadId!==null)id(row.uploadId);
    if(row.source!==undefined)text(row.source,1024);const source='memory:'+(row.source??row.draftKey??value.id);if(memoryNames.has(source))invalid();memoryNames.add(source);
    let pendingNote:Row|null=null;if(row.pending!==undefined&&row.pending!==null){envelope(row.pending,true);if(row.pending.expectedRevision!==row.revision)invalid();pendingNote=note(await open(row.pending,value.id),true);if(pendingNote.id!==value.id)invalid();}
    if(row.pendingNote!==undefined&&row.pendingNote!==null){const pending=note(row.pendingNote,true);if(pending.id!==value.id||pendingNote!==null&&canonicalJson(pending)!==canonicalJson(pendingNote))invalid();pendingNote=pending;}
    if(row.draftKey!=null){text(row.draftKey,1024);if(!row.draftKey.endsWith(':'+value.id)||!row.draftKey.includes('draft:'))invalid();drafts.push({source,note:value,revision:row.revision,pendingNote,kind:'draft'});}
    else{if(pendingNote!==null)invalid();if(row.localOnly===true)privacyIds.add(value.id);add(localPrivate||row.localOnly===true||privacyIds.has(value.id)?'local':'remote',source,value,row.revision);}
    history.push({source,note:value,revision:row.revision,pendingNote,localOnly:row.localOnly??false,uploadId:row.uploadId??null});
   }
   const editorNames=new Set<string>();for(const row of snapshot.memory.editors){allowed(row,['source','note','revision','state']);text(row.source,1024);integer(row.revision);if(!row.source||editorNames.has(row.source))invalid();editorNames.add(row.source);drafts.push({source:row.source,note:note(row.note,true),revision:row.revision,kind:'editor',...(row.state===undefined?{}:{state:row.state})});}
   for(const [source,rows]of [['local',deletions],['server',serverDeletions]]as const)for(const row of rows)if(!row.localOnly){
    add('remote',source+'-deletion',null,row.revision,true,row.id);add('local',source+'-deletion',null,row.revision,true,row.id);
   }
   const references:Row[]=[];for(const row of remote.dreams as unknown[]){exactKeys(row,['note_id','dream_day','time_zone']);id(row.note_id);if(!validDreamDay(row.dream_day))invalid();text(row.time_zone,128);
    const value=serverNotes.get(row.note_id);if(!value||!value.dream||canonicalJson({day:row.dream_day,timeZone:row.time_zone})!==canonicalJson({day:(value.dream as Row).day,timeZone:(value.dream as Row).timeZone}))throw new Error('E2EE_DIARY_REFERENCE_REVIEW_REQUIRED');references.push({kind:'dream',...row});}
   for(const row of remote.adviceReferences as unknown[]){exactKeys(row,['note_id','advice_id']);id(row.note_id);text(row.advice_id,100);const value=serverNotes.get(row.note_id);if(!value||!value.advice||(value.advice as Row).id!==row.advice_id)throw new Error('E2EE_DIARY_REFERENCE_REVIEW_REQUIRED');references.push({kind:'advice',...row});}
   for(const identity of privacyIds){const old=cloud.get(identity);if(old){for(const row of old)add('local','privacy:'+row.source,row.note,row.revision,row.deleted,identity);cloud.delete(identity);}}
   const conflicts:DiaryMigrationConflict[]=[],selected=new Map<string,DiaryMigrationVariant>();
   for(const [placement,groups]of [['remote',cloud],['local',device]]as const)for(const [identity,variants]of groups){
    const key=placement+':'+identity,deleted=variants.filter(row=>row.deleted).sort((a,b)=>b.revision-a.revision)[0];
    const notes=variants.filter(row=>!row.deleted),current=notes.filter(row=>row.source==='server'||row.source.endsWith('-deletion'));
    // A clean cached revision predating a newer server row is history. Drafts
    // never enter this selection and remain local even when a note is deleted.
    const latest=current[0],candidates=notes.filter(row=>!latest||row.source==='server'||row.revision>=latest.revision);
    if(deleted&&notes.every(row=>row.revision<deleted.revision)){selected.set(key,deleted);continue;}
    const distinct=new Set(candidates.map(row=>canonicalJson(row.note)));
    if(deleted||distinct.size>1){conflicts.push({id:identity,placement,variants});continue;}
    const chosen=candidates[0]??deleted;if(chosen)selected.set(key,chosen);
   }
   if(conflicts.length){if(!this.#ports.review)throw new Error('E2EE_DIARY_CONFLICT_REVIEW_REQUIRED');const choices=await this.#ports.review(structuredClone(conflicts));this.#ports.assertCurrent();object(choices);
    const names=conflicts.map(row=>row.placement+':'+row.id);if(Object.keys(choices).length!==names.length||Object.keys(choices).some(name=>!names.includes(name)))throw new Error('E2EE_DIARY_CONFLICT_REVIEW_REQUIRED');
    for(const conflict of conflicts){const key=conflict.placement+':'+conflict.id,chosen=conflict.variants.find(row=>row.source===choices[key]);if(!chosen)throw new Error('E2EE_DIARY_CONFLICT_REVIEW_REQUIRED');selected.set(key,chosen);}
   }
   for(const [placement,groups]of [['remote',cloud],['local',device]]as const){const index:Row[]=[];
    for(const [identity,variants]of [...groups].sort(([a],[b])=>a.localeCompare(b))){const chosen=selected.get(placement+':'+identity);if(!chosen)invalid();const objectId='personal-diary-record:'+crypto.randomUUID();
     output(placement,objectId,{protocol:1,ownerId:this.#owner,id:identity,selected:chosen,variants});index.push({id:identity,objectId,deleted:chosen.deleted});}
    const privateId=(identity:unknown)=>typeof identity==='string'&&(privacyIds.has(identity)||serverPrivate||device.has(identity)&&!cloud.has(identity));
    output(placement,placement==='remote'?'personal-diary-index-v1':'personal-diary-local-index-v1',{protocol:1,ownerId:this.#owner,records:index,
     references:references.filter(row=>(privateId(row.note_id)?'local':'remote')===placement)});
   }
   const serverPrivateId=(identity:unknown)=>typeof identity==='string'&&(serverPrivate||privacyIds.has(identity));
   output('remote','personal-diary-settings-v1',{protocol:1,ownerId:this.#owner,settings:serverSettings,dreamSettings:serverDream,noteHistory:serverHistory.filter(row=>!serverPrivateId(row.id)),execution:'history-only'});
   output('local','personal-diary-local-history-v1',{protocol:1,ownerId:this.#owner,settings:localSettings,dreamSettings:localDream,deletions:[...deletions,...serverDeletions],history,drafts,noteHistory:serverHistory.filter(row=>serverPrivateId(row.id)),execution:'history-only'});
   this.#ports.assertCurrent();complete=true;return{complete:true,content,localContent};
  }finally{if(!complete)[...content,...localContent].forEach(row=>row.bytes.fill(0));}
 }
}

/** Product reads decrypted current-generation content; never old keys or HTTP
 * commands. Device-only overlays are explicit and require the retained vault. */
export async function readMigratedDiary(readRemote:(domain:'diary',id:string)=>Promise<unknown>,readLocal:(domain:'diary',id:string)=>Promise<Uint8Array|null>,ownerId:string){
 const indexes:{placement:'remote'|'local';value:unknown}[]=[{placement:'remote',value:await readRemote('diary','personal-diary-index-v1')}];
 const raw=await readLocal('diary','personal-diary-local-index-v1');if(!raw)throw new Error('E2EE_DIARY_LOCAL_CONTENT_REQUIRED');
 try{indexes.push({placement:'local',value:parseDiaryMigrationJson(decoder.decode(raw))});}finally{raw.fill(0);}
 const records:{placement:'remote'|'local';id:string;note:Row|null;deleted:boolean}[]=[];
 for(const {placement,value}of indexes){exactKeys(value,['protocol','ownerId','records','references']);if(value.protocol!==1||value.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');list(value.records);list(value.references);const seen=new Set<string>();
  for(const entry of value.records){exactKeys(entry,['id','objectId','deleted']);id(entry.id);if(seen.has(entry.id)||typeof entry.objectId!=='string'||!/^personal-diary-record:[a-f0-9-]{36}$/.test(entry.objectId)||typeof entry.deleted!=='boolean')invalid();seen.add(entry.id);
   let row:unknown;if(placement==='remote')row=await readRemote('diary',entry.objectId);else{const bytes=await readLocal('diary',entry.objectId);if(!bytes)throw new Error('E2EE_DIARY_LOCAL_CONTENT_REQUIRED');try{row=parseDiaryMigrationJson(decoder.decode(bytes));}finally{bytes.fill(0);}}
   exactKeys(row,['protocol','ownerId','id','selected','variants']);if(row.protocol!==1||row.ownerId!==ownerId||row.id!==entry.id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');list(row.variants);exactKeys(row.selected,['source','note','revision','deleted']);integer(row.selected.revision);text(row.selected.source,1024);
   if(row.selected.deleted!==entry.deleted||!row.variants.some(variant=>canonicalJson(variant)===canonicalJson(row.selected)))invalid();
   const value=row.selected.deleted?(row.selected.note===null?null:invalid()):note(row.selected.note);if(value&&value.id!==entry.id)invalid();records.push({placement,id:entry.id,note:value,deleted:entry.deleted});
  }
 }
 return records;
}
