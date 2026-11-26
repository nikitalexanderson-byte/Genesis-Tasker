import {exactKeys,assertTechnical} from './keys.ts';
import {validateDiaryNote,type DiaryNote} from '../diary-model.ts';
import {parseDreamSettings,type DreamSettings} from '../dream-journal-model.ts';

export type PrivateDiaryEntry={id:string;note:DiaryNote|null;revision:number;deleted:boolean;updatedAt:string};
export type PrivateDiaryState={protocol:1;ownerId:string;syncEnabled:boolean;settingsRevision:number;dreamSettings:DreamSettings;records:PrivateDiaryEntry[]};
export type PrivateDiaryDraft={key:string;note:DiaryNote;revision:number;localOnly:boolean;editorState:string|null};
export type PrivateDiaryDeviceState={protocol:1;ownerId:string;deviceId:string;migrationHistory:'present'|'not-on-this-device';paused:boolean;
 records:PrivateDiaryEntry[];drafts:PrivateDiaryDraft[];promotions:{sourceId:string;sourceRevision:number;id:string}[]};

function invalid():never{throw new Error('E2EE_DIARY_SOURCE_INVALID');}
export function diaryId(value:unknown):asserts value is string{if(typeof value!=='string'||!/^[a-zA-Z0-9_-]{1,100}$/.test(value))invalid();}
export function diaryRevision(value:unknown):asserts value is number{if(typeof value!=='number'||!Number.isSafeInteger(value)||value<0||value>=Number.MAX_SAFE_INTEGER)invalid();}
function rows(value:unknown):unknown[]{if(!Array.isArray(value)||value.length>20000)invalid();return value;}
export function validateDiaryDraft(value:unknown):DiaryNote{
 if(value&&typeof value==='object'&&'body' in value&&typeof value.body==='string'&&!value.body.trim()){
  const result=validateDiaryNote({...value,body:'draft'});return{...result,body:value.body};
 }return validateDiaryNote(value);
}
function entries(value:unknown):PrivateDiaryEntry[]{
 const seen=new Set<string>();return rows(value).map(row=>{
  exactKeys(row,['id','note','revision','deleted','updatedAt']);diaryId(row.id);diaryRevision(row.revision);
  if(seen.has(row.id)||typeof row.deleted!=='boolean'||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))invalid();seen.add(row.id);
  const note=row.deleted?(row.note===null?null:invalid()):validateDiaryNote(row.note);if(note&&note.id!==row.id)invalid();
  return{id:row.id,note,revision:row.revision,deleted:row.deleted,updatedAt:row.updatedAt};
 });
}
export function parsePrivateDiary(input:unknown,ownerId:string):PrivateDiaryState{
 exactKeys(input,['protocol','ownerId','syncEnabled','settingsRevision','dreamSettings','records']);
 if(input.protocol!==1||input.ownerId!==ownerId||typeof input.syncEnabled!=='boolean')invalid();diaryRevision(input.settingsRevision);
 const records=entries(input.records);if(!input.syncEnabled&&records.some(row=>!row.deleted))invalid();
 return{protocol:1,ownerId,syncEnabled:input.syncEnabled,settingsRevision:input.settingsRevision,dreamSettings:parseDreamSettings(input.dreamSettings),records};
}
export function parsePrivateDiaryDevice(input:unknown,ownerId:string,deviceId:string):PrivateDiaryDeviceState{
 exactKeys(input,['protocol','ownerId','deviceId','migrationHistory','paused','records','drafts','promotions']);
 if(input.protocol!==1||input.ownerId!==ownerId||input.deviceId!==deviceId||typeof input.paused!=='boolean'||!['present','not-on-this-device'].includes(String(input.migrationHistory)))invalid();
 const records=entries(input.records),seen=new Set<string>(),drafts=rows(input.drafts).map(row=>{
  exactKeys(row,['key','note','revision','localOnly','editorState']);assertTechnical(row.key);diaryRevision(row.revision);
  if(!row.key.startsWith('diary-draft:')||seen.has(row.key)||typeof row.localOnly!=='boolean')invalid();seen.add(row.key);
  if(row.editorState!==null&&(typeof row.editorState!=='string'||row.editorState.length>1024*1024))invalid();
  return{key:row.key,note:validateDiaryDraft(row.note),revision:row.revision,localOnly:row.localOnly,editorState:row.editorState};
 });
 const sources=new Set<string>(),destinations=new Set<string>(),promotions=rows(input.promotions).map(row=>{
  exactKeys(row,['sourceId','sourceRevision','id']);diaryId(row.sourceId);diaryId(row.id);diaryRevision(row.sourceRevision);
  if(sources.has(row.sourceId)||destinations.has(row.id)||row.sourceId===row.id||!records.some(entry=>entry.id===row.sourceId&&!entry.deleted&&entry.revision===row.sourceRevision))invalid();
  sources.add(row.sourceId);destinations.add(row.id);return{sourceId:row.sourceId,sourceRevision:row.sourceRevision,id:row.id};
 });
 return{protocol:1,ownerId,deviceId,migrationHistory:input.migrationHistory as PrivateDiaryDeviceState['migrationHistory'],paused:input.paused,records,drafts,promotions};
}
