import {requirePrivateAccount} from './product-session.ts';
import {E2eePrivateDocument,type PrivateDocumentView} from './product-repository.ts';
import {E2eeDeviceDocument,type DeviceDocumentView} from './device-document.ts';
import {readActiveMigrationLocalContent} from './migration.ts';
import {readMigratedDiary,parseDiaryMigrationJson} from './diary-source.ts';
import {parsePrivateDiary,parsePrivateDiaryDevice,validateDiaryDraft,diaryRevision,
 type PrivateDiaryState,type PrivateDiaryDeviceState,type PrivateDiaryEntry} from './diary-product-state.ts';
import {validateDiaryNote,validDreamDay,type DiaryNote} from '../diary-model.ts';
import {DEFAULT_DREAM_SETTINGS,parseDreamSettings,type DreamSettings} from '../dream-journal-model.ts';
import {currentFeatureAccess,requireFeature,requireQuotaGrowth} from '../feature-access.ts';
import {privateServiceRequest} from '../cloud-sync.ts';
import {exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import type {DiaryRecord} from '../diary-storage.ts';

const decoder=new TextDecoder('utf-8',{fatal:true}),encoder=new TextEncoder();
const same=(a:DiaryNote,b:DiaryNote)=>JSON.stringify({...a,updatedAt:''})===JSON.stringify({...b,updatedAt:''});
const entry=(note:DiaryNote|null,id:string,revision:number):PrivateDiaryEntry=>({id,note,revision,deleted:note===null,updatedAt:note?.updatedAt??new Date().toISOString()});
/** Live diary content and device-only notes deliberately use different stores.
 * The latter has no network capability. Privacy changes copy before tombstoning;
 * only explicit re-enabling creates durable promotion IDs and uploads notes. */
export class E2eeDiaryRepository{
 #account:ReturnType<typeof requirePrivateAccount>;#remote:E2eePrivateDocument<PrivateDiaryState>;#local:E2eeDeviceDocument<PrivateDiaryDeviceState>;
 #view:PrivateDocumentView<PrivateDiaryState>|null=null;#device:DeviceDocumentView<PrivateDiaryDeviceState>|null=null;
 #serial:Promise<unknown>=Promise.resolve();#closed=false;#writer=crypto.randomUUID();#owner:string;
 constructor(owner:string){
  this.#owner=owner;this.#account=requirePrivateAccount(owner);const {client,directory}=this.#account.personal();
  this.#remote=new E2eePrivateDocument({device:this.#account.device,client,scopeId:directory.scopeId,domain:'diary',objectId:'personal-diary-live-v1',
   assertCurrent:()=>this.check(),assertWrite:()=>this.check(),validate:value=>parsePrivateDiary(value,owner)});
  this.#local=new E2eeDeviceDocument(this.#account.device,'personal-diary-device-live-v1',value=>parsePrivateDiaryDevice(value,owner,this.#account.device.deviceId),()=>this.check());
 }
 check(){if(this.#closed)throw new Error('DIARY_SESSION_CLOSED');this.#account.requireOpen();}
 dispose(){this.#closed=true;this.#view=null;this.#device=null;}
 get syncEnabled(){return(this.#view?.value.syncEnabled??true)&&!(this.#device?.value.paused??false);}
 get offline(){return this.#account.mode==='offline';}
 get dreamSettings(){return structuredClone(this.#view?.value.dreamSettings??DEFAULT_DREAM_SETTINGS);}
 get pendingUploads(){return this.#device?.value.records.filter(row=>!row.deleted).length??0;}
 get localHistory(){return this.#device?.value.migrationHistory??null;}
 #operation<T>(run:()=>Promise<T>):Promise<T>{const task=this.#serial.catch(()=>undefined).then(async()=>{this.check();return run();});this.#serial=task;return task;}
 #state(){this.check();if(!this.#view||!this.#device)throw new Error('E2EE_PRODUCT_READ_REQUIRED');if(this.#view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return{remote:this.#view,local:this.#device};}
 async #read(id:string){const row=await this.#account.personal().client.read('diary',id);this.check();if(!row)throw new Error('E2EE_DIARY_SOURCE_INVALID');
  try{return parseDiaryMigrationJson(decoder.decode(row.bytes));}finally{row.bytes.fill(0);}}
 async #history(id:string){const value=await readActiveMigrationLocalContent(this.#account.device,this.#account.personal().directory,'diary',id);this.check();
  if(value.availability==='not-on-this-device')return value;if(!value.content)throw new Error('E2EE_DIARY_LOCAL_CONTENT_REQUIRED');return value;}
 async #load(refresh=false){
  this.check();if(!this.#view||refresh){
   try{this.#view=await this.#remote.load(this.#account.mode);}
   catch(error){if(this.#account.mode!=='online'||!(error instanceof Error)||error.message!=='E2EE_PRIVATE_DOCUMENT_MISSING')throw error;
    const seed=await readMigratedDiary((_domain,id)=>this.#read(id),null,this.#owner),metadata=await this.#read('personal-diary-settings-v1');
    exactKeys(metadata,['protocol','ownerId','settings','dreamSettings','noteHistory','execution']);
    if(metadata.protocol!==1||metadata.ownerId!==this.#owner||metadata.execution!=='history-only'||!Array.isArray(metadata.settings)||metadata.settings.length>1||!Array.isArray(metadata.dreamSettings)||metadata.dreamSettings.length>1)throw new Error('E2EE_DIARY_SOURCE_INVALID');
    const settings=metadata.settings[0] as {sync_enabled:0|1;revision:number}|undefined,dream=metadata.dreamSettings[0] as {today_mode:DreamSettings['todayMode'];revision:number}|undefined;
    if(settings){if(settings.sync_enabled!==0&&settings.sync_enabled!==1)throw new Error('E2EE_DIARY_SOURCE_INVALID');diaryRevision(settings.revision);}
    const value:PrivateDiaryState={protocol:1,ownerId:this.#owner,syncEnabled:settings?.sync_enabled!==0,settingsRevision:settings?.revision??0,
     dreamSettings:dream?parseDreamSettings({todayMode:dream.today_mode,revision:dream.revision}):{...DEFAULT_DREAM_SETTINGS},
     records:seed.map(row=>entry(row.note?validateDiaryNote(row.note):null,row.id,row.revision))};
    const serial=await this.#remote.save(value,{serial:null,remoteRevision:0});this.#view={value,serial,remoteRevision:0,pending:true,conflict:null};
   }
  }
  this.#device=await this.#local.load();
  if(!this.#device){
   if(this.#account.mode==='offline')throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');
   const index=await this.#history('personal-diary-local-index-v1');let records:PrivateDiaryEntry[]=[],drafts:PrivateDiaryDeviceState['drafts']=[],paused=!this.#view.value.syncEnabled;
   if(index.availability==='present'){
    index.content!.bytes.fill(0);
    const migrated=await readMigratedDiary((_domain,id)=>this.#read(id),async(_domain,id)=>{const value=await this.#history(id);return value.availability==='present'?value.content!.bytes:null;},this.#owner);
    records=migrated.filter(row=>row.placement==='local').map(row=>entry(row.note?validateDiaryNote(row.note):null,row.id,row.revision));
    const history=await this.#history('personal-diary-local-history-v1');if(history.availability!=='present')throw new Error('E2EE_DIARY_LOCAL_CONTENT_REQUIRED');
    try{const value=parseDiaryMigrationJson(decoder.decode(history.content!.bytes));exactKeys(value,['protocol','ownerId','settings','dreamSettings','deletions','history','drafts','noteHistory','execution']);
     if(value.protocol!==1||value.ownerId!==this.#owner||value.execution!=='history-only'||!Array.isArray(value.drafts))throw new Error('E2EE_DIARY_SOURCE_INVALID');
     const settings=value.settings as {syncEnabled:boolean;deviceLocalOnly?:boolean}|null;paused=paused||settings?.syncEnabled===false||settings?.deviceLocalOnly===true;
     drafts=value.drafts.map(row=>{if(!row||typeof row!=='object')throw new Error('E2EE_DIARY_SOURCE_INVALID');diaryRevision(row.revision);
      return{key:'diary-draft:'+crypto.randomUUID(),note:validateDiaryDraft(row.pendingNote??row.note),revision:row.revision,
       localOnly:paused||records.some(record=>record.id===row.note?.id&&!record.deleted),editorState:null};});
    }finally{history.content!.bytes.fill(0);}
   }
   this.#device=await this.#local.save({protocol:1,ownerId:this.#owner,deviceId:this.#account.device.deviceId,migrationHistory:index.availability,paused,records,drafts,promotions:[]},null);
  }
  return this.#state();
 }
 async #stage(value:PrivateDiaryState){const prior=this.#state().remote,serial=await this.#remote.save(value,prior);this.#view={...prior,value,serial,pending:true};}
 async #stageLocal(value:PrivateDiaryDeviceState){this.#device=await this.#local.save(value,this.#state().local.serial);}
 async #flush(){const view=this.#state().remote;if(!view.pending||this.#account.mode==='offline'||!navigator.onLine)return;
  await this.#remote.flush();this.#view=await this.#remote.load('offline');this.check();if(this.#view.pending||JSON.stringify(this.#view.value)!==JSON.stringify(view.value))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');}
 #records():DiaryRecord[]{const {remote,local}=this.#state(),hidden=local.value.paused||!remote.value.syncEnabled;
  return[...(!hidden?remote.value.records.filter(row=>!row.deleted).map(row=>({note:structuredClone(row.note!),revision:row.revision})):[]),
   ...local.value.records.filter(row=>!row.deleted).map(row=>({note:structuredClone(row.note!),revision:row.revision,localOnly:true})),
   ...local.value.drafts.map(row=>({note:structuredClone(row.note),revision:row.revision,draftKey:row.key,localOnly:row.localOnly||hidden}))];}
 list(){return this.#operation(async()=>{await this.#load(true);await this.#flush();return this.#records();});}
 restoreView(){return this.#operation(async()=>{await this.#load(true);await this.#flush();const {remote,local}=this.#state();return{checkpoint:JSON.stringify([remote.serial,remote.remoteRevision,local.serial]),pending:remote.pending||local.value.promotions.length>0,records:[...remote.value.records.map(row=>({id:row.id,revision:row.revision,deleted:row.deleted,value:row.note,localOnly:false})),...local.value.records.map(row=>({id:row.id,revision:row.revision,deleted:row.deleted,value:row.note,localOnly:true}))]};});}
 /** A restored note starts on this device. Import cannot turn on cloud sync. */
 restoreAdd(input:unknown){const note=validateDiaryNote(structuredClone(input));return this.#operation(async()=>{await this.#load();const {remote,local}=this.#state();
  if([...remote.value.records,...local.value.records].some(row=>row.id===note.id)||local.value.drafts.some(row=>row.note.id===note.id))throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');
  const access=currentFeatureAccess(this.#owner);if(note.dream)requireFeature(access,'dream-journal');if(!note.advice){const count=this.#records().filter(row=>!row.draftKey&&!row.note.advice).length;requireQuotaGrowth(access,'diary',count,count+1);}
  await this.#stageLocal({...local.value,records:[...local.value.records,entry(note,note.id,1)]});
 });}
 async #ownKey(id:string){const digest=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(id)));this.check();return`diary-draft:${this.#writer}:${encodeE2eeBytes(digest)}`;}
 async #keep(note:DiaryNote,record?:DiaryRecord){
  const key=record?.draftKey??await this.#ownKey(note.id),{local}=this.#state(),old=local.value.drafts.find(row=>row.key===key);
  if(old&&old.note.id!==note.id||!key.startsWith('diary-draft:'))throw new Error('DIARY_INVALID_DRAFT');
  const row={key,note,revision:record?.revision??0,localOnly:record?.localOnly===true||!this.syncEnabled,editorState:old?.editorState??null};
  await this.#stageLocal({...local.value,drafts:[...local.value.drafts.filter(row=>row.key!==key),row]});return row;
 }
 keepDraft(input:DiaryNote,record?:DiaryRecord){const note=validateDiaryDraft(structuredClone(input));return this.#operation(async()=>{await this.#load();const row=await this.#keep(note,record);return{note:row.note,revision:row.revision,draftKey:row.key,localOnly:row.localOnly};});}
 save(input:DiaryNote,record?:DiaryRecord):Promise<DiaryRecord&{clearedDraftKey:string}>{const note=validateDiaryNote(structuredClone(input));if(record&&record.note.id!==note.id)throw new Error('DIARY_INVALID_NOTE');
  return this.#operation(async()=>{
   await this.#load();const draft=await this.#keep(note,record),{remote,local}=this.#state(),localOnly=draft.localOnly;
   const rows=localOnly?local.value.records:remote.value.records,old=rows.find(row=>row.id===note.id);
   if(old?.deleted)throw new Error('DIARY_NOTE_DELETED');if((old?.revision??0)!==draft.revision)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
   const access=currentFeatureAccess(this.#owner);if(note.dream)requireFeature(access,'dream-journal');
   if(!note.advice&&!old){const count=this.#records().filter(row=>!row.draftKey&&!row.note.advice).length;requireQuotaGrowth(access,'diary',count,count+1);}
   if(local.value.promotions.some(row=>row.sourceId===note.id))throw new Error('DIARY_LOCAL_UPLOAD_PENDING');
   const revision=(old?.revision??0)+1,next=[...rows.filter(row=>row.id!==note.id),entry(note,note.id,revision)];
   if(localOnly)await this.#stageLocal({...local.value,records:next});else{await this.#stage({...remote.value,records:next});await this.#flush();}
   await this.#discard([draft.key]);return{note,revision,localOnly,clearedDraftKey:draft.key};
  });
 }
 remove(record:DiaryRecord){return this.#operation(async()=>{await this.#load();if(record.draftKey)throw new Error('DIARY_INVALID_NOTE');
  const {remote,local}=this.#state(),deviceOnly=record.localOnly===true||!this.syncEnabled,rows=deviceOnly?local.value.records:remote.value.records,old=rows.find(row=>row.id===record.note.id);
  if(!old||old.deleted)return;if(old.revision!==record.revision||local.value.promotions.some(row=>row.sourceId===old.id))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
  const next=rows.map(row=>row.id===old.id?entry(null,row.id,row.revision+1):row);
  if(deviceOnly)await this.#stageLocal({...local.value,records:next,drafts:local.value.drafts.filter(row=>row.note.id!==old.id)});
  else{await this.#stage({...remote.value,records:next});await this.#flush();await this.#stageLocal({...this.#state().local.value,drafts:this.#state().local.value.drafts.filter(row=>row.note.id!==old.id||row.localOnly)});}
 });}
 async #discard(keys:string[]){const local=this.#state().local;for(const key of keys)if(!key.startsWith('diary-draft:'))throw new Error('DIARY_INVALID_DRAFT');await this.#stageLocal({...local.value,drafts:local.value.drafts.filter(row=>!keys.includes(row.key))});}
 discardDraft(key:string){return this.#operation(async()=>{await this.#load();await this.#discard([key]);});}
 async discardOwnDraft(id:string){const key=await this.#ownKey(id);await this.discardDraft(key);return key;}
 discardEditorDraft(id:string,key?:string){return this.#operation(async()=>{await this.#load();const keys=[await this.#ownKey(id),...(key?[key]:[])];
  if(this.#state().local.value.drafts.some(row=>keys.includes(row.key)&&row.note.id!==id))throw new Error('DIARY_INVALID_DRAFT');await this.#discard(keys);return keys;});}
 setSyncEnabled(enabled:boolean){return this.#operation(async()=>{
  if(this.#account.mode!=='online'||!navigator.onLine)throw new Error('DIARY_ONLINE_REQUIRED');await this.#load(true);await this.#flush();
  const {remote,local}=this.#state();if(remote.pending)throw new Error('DIARY_ONLINE_REQUIRED');
  if(!enabled){
   const copied=[...local.value.records];for(const row of remote.value.records.filter(row=>!row.deleted)){
    const previous=copied.find(entry=>entry.id===row.id);if(previous&&(previous.deleted||!previous.note||!same(previous.note,row.note!)))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');
    if(!previous)copied.push(structuredClone(row));
   }
   await this.#stageLocal({...local.value,paused:true,records:copied,drafts:local.value.drafts.map(row=>({...row,localOnly:true}))});
   if(remote.value.syncEnabled){await this.#stage({...remote.value,syncEnabled:false,settingsRevision:remote.value.settingsRevision+1,
    records:remote.value.records.map(row=>row.deleted?row:entry(null,row.id,row.revision+1))});await this.#flush();}
  }else{
   if(!remote.value.syncEnabled){await this.#stage({...remote.value,syncEnabled:true,settingsRevision:remote.value.settingsRevision+1});await this.#flush();}
   await this.#stageLocal({...this.#state().local.value,paused:false});await this.#promote();
  }return this.#records();
 });}
 async #promote(){
  for(const source of [...this.#state().local.value.records].filter(row=>!row.deleted)){
   let local=this.#state().local;let promotion=local.value.promotions.find(row=>row.sourceId===source.id);
   if(!promotion){promotion={sourceId:source.id,sourceRevision:source.revision,id:crypto.randomUUID()};await this.#stageLocal({...local.value,promotions:[...local.value.promotions,promotion]});}
   const note=validateDiaryNote({...source.note!,id:promotion.id}),remote=this.#state().remote,existing=remote.value.records.find(row=>row.id===note.id);
   if(existing){if(existing.deleted||!existing.note||!same(existing.note,note))throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');}
   else await this.#stage({...remote.value,records:[...remote.value.records,entry(note,note.id,1)]});
   await this.#flush();if(this.#state().remote.pending)throw new Error('DIARY_ONLINE_REQUIRED');
   local=this.#state().local;await this.#stageLocal({...local.value,records:local.value.records.filter(row=>row.id!==source.id),promotions:local.value.promotions.filter(row=>row.sourceId!==source.id),
    drafts:local.value.drafts.map(row=>row.note.id===source.id?{...row,note:{...row.note,id:note.id},revision:1,localOnly:false,editorState:null}:row)});
  }
 }
 adviceId(id:string){return this.#operation(async()=>{await this.#load();const records=this.#records(),found=records.find(row=>!row.draftKey&&row.note.advice?.id===id);if(found)return found.note.id;
  const deleted=new Set([...this.#state().remote.value.records,...this.#state().local.value.records].filter(row=>row.deleted).map(row=>row.id));
  for(let generation=0;generation<20000;generation++){const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',encoder.encode(`GENESIS-DIARY-ADVICE-ID\0v1\0${this.#owner}\0${id}\0${generation}`)));this.check();
   const candidate='adv-'+Array.from(bytes,byte=>byte.toString(16).padStart(2,'0')).join('');bytes.fill(0);if(!deleted.has(candidate))return candidate;}throw new Error('DIARY_ID_LIMIT');
 });}
 setDreamTodayMode(todayMode:DreamSettings['todayMode']){return this.#operation(async()=>{await this.#load();const remote=this.#state().remote;
  const dreamSettings=parseDreamSettings({todayMode,revision:remote.value.dreamSettings.revision+1});await this.#stage({...remote.value,dreamSettings});await this.#flush();});}
 async dreamToday(timeZone:string,signal?:AbortSignal){this.check();if(this.#account.mode==='offline')throw new Error('DIARY_ONLINE_REQUIRED');
  const result=await privateServiceRequest<{today:string;timeZone:string}>(this.#owner,'dream-clock',timeZone,signal);this.check();if(!validDreamDay(result.today)||result.timeZone!==timeZone)throw new Error('DREAM_CLOCK_INVALID');return result.today;}
 async authorizeDreamVoice(){this.check();if(this.#account.mode==='offline')throw new Error('DIARY_ONLINE_REQUIRED');const result=await privateServiceRequest<{allowed:boolean}>(this.#owner,'dream-voice');this.check();if(result.allowed!==true)throw new Error('FEATURE_SUBSCRIPTION_REQUIRED');}
}
