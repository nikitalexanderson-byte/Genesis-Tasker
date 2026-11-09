import type {SharedSavedView,SharedSavedViewDefinition} from './cloud-sync';
import type {CalendarMode} from './calendar-data';
import type {CalendarContext} from './calendar-context';
import {calendarContext} from './calendar-context.ts';
import {editableSharedViewDefinition} from './shared-saved-view-model.ts';

export const SAVED_VIEW_DEVICE_SCOPE='00000000-0000-4000-8000-000000000005';
export type SavedViewEditorDraft={definition:SharedSavedViewDefinition|null;damagedDefinition?:unknown;id?:string;revision?:number;spaceId:string|null;visibility:'personal'|'shared';dirty:boolean;tagsInput?:string;inputCalendar?:{mode:CalendarMode;context:CalendarContext}};
export type SavedViewCommand={action:'save'|'delete';id:string|null;bodyJson:string};
export type SavedViewDeviceDraft={version:1;edit:SavedViewEditorDraft;after:SavedViewEditorDraft|null;phase:'editing'|'pending'|'received'|'rejected'|'damaged';command:SavedViewCommand|null;attempts:number;receipt:SharedSavedView|{ok:true}|null;error:string|null;legacy:{draft:string|null;request:string|null}|null};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[],required=allowed)=>required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>allowed.includes(key));
const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const text=(value:unknown,max=100000)=>typeof value==='string'&&[...value].length<=max;
function valid(value:unknown):asserts value{if(!value)throw Error('SAVED_VIEW_DEVICE_DRAFT_INVALID');}
const equal=(a:unknown,b:unknown):boolean=>a===b||(Array.isArray(a)&&Array.isArray(b)?a.length===b.length&&a.every((item,index)=>equal(item,b[index])):object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key])));
function inputCalendar(raw:unknown):boolean{
 if(!object(raw)||!keys(raw,['mode','context'])||!['profane','sacred','lunar'].includes(String(raw.mode))||!object(raw.context)||!keys(raw.context,['version','timeZone','gregorianYearStart'])||raw.context.version!==2||!text(raw.context.timeZone,100))return false;
 try{return calendarContext(raw.context as CalendarContext).version===2;}catch{return false;}
}
function editor(raw:unknown):raw is SavedViewEditorDraft{
 return object(raw)&&keys(raw,['definition','damagedDefinition','id','revision','spaceId','visibility','dirty','tagsInput','inputCalendar'],['definition','spaceId','visibility','dirty'])
  &&(raw.definition===null||editableSharedViewDefinition(raw.definition))&&(raw.spaceId===null||id(raw.spaceId))&&['personal','shared'].includes(String(raw.visibility))&&typeof raw.dirty==='boolean'
  &&(raw.id===undefined&&raw.revision===undefined||id(raw.id)&&integer(raw.revision)&&(raw.revision as number)>0)&&(raw.tagsInput===undefined||text(raw.tagsInput,10000))
  &&(raw.inputCalendar===undefined||inputCalendar(raw.inputCalendar));
}
export function savedViewPayload(draft:SavedViewEditorDraft):SharedSavedViewDefinition{
 if(!draft.definition)throw Error('VIEW_INVALID');const filter={...draft.definition.filter};
 if(draft.spaceId)filter.spaceId=draft.spaceId;else delete filter.spaceId;
 if(draft.definition.relative!=='none'){delete filter.dueFrom;delete filter.dueTo;}
 return {...draft.definition,title:draft.definition.title.trim(),filter};
}
function commandBody(command:SavedViewCommand):Record<string,unknown>{
 valid(object(command)&&keys(command,['action','id','bodyJson'])&&['save','delete'].includes(command.action)&&(command.id===null||id(command.id))&&text(command.bodyJson,60000));
 let body:unknown;try{body=JSON.parse(command.bodyJson);}catch{throw Error('SAVED_VIEW_DEVICE_DRAFT_INVALID');}
 valid(object(body)&&typeof body.requestId==='string'&&/^[a-zA-Z0-9:_-]{1,100}$/.test(body.requestId));
 if(command.action==='delete')valid(command.id!==null&&keys(body,['requestId','expectedRevision'])&&integer(body.expectedRevision)&&(body.expectedRevision as number)>0);
 else valid(keys(body,['requestId','spaceId','visibility','definition',...(command.id===null?[]:['expectedRevision'])])&&(body.spaceId===null||id(body.spaceId))&&['personal','shared'].includes(String(body.visibility))&&(body.visibility!=='shared'||body.spaceId!==null)&&editableSharedViewDefinition(body.definition)&&(command.id===null||integer(body.expectedRevision)&&(body.expectedRevision as number)>0));
 return body;
}
const normalizedDefinition=(value:SharedSavedViewDefinition)=>({...value,title:value.title.trim(),filter:Array.isArray(value.filter)&&!value.filter.length?{}:value.filter});
export function confirmSavedViewReceipt(command:SavedViewCommand,raw:unknown):SharedSavedView|{ok:true}{
 const body=commandBody(command);
 if(command.action==='delete'){if(!object(raw)||!keys(raw,['ok'])||raw.ok!==true)throw Error('VIEW_RECEIPT_INVALID');return {ok:true};}
 if(!object(raw)||!keys(raw,['id','spaceId','visibility','revision','updatedAt','canEdit','invalid','definition'])||!id(raw.id)||raw.spaceId!==body.spaceId||raw.visibility!==body.visibility||raw.revision!==(command.id===null?1:(body.expectedRevision as number)+1)||command.id!==null&&raw.id!==command.id||raw.invalid!==false||raw.canEdit!==true||typeof raw.updatedAt!=='string'||!Number.isFinite(Date.parse(raw.updatedAt))||!editableSharedViewDefinition(raw.definition)||!equal(normalizedDefinition(raw.definition),normalizedDefinition(body.definition as SharedSavedViewDefinition)))throw Error('VIEW_RECEIPT_INVALID');
 return structuredClone(raw) as SharedSavedView;
}
export function validateSavedViewDeviceDraft(raw:unknown):SavedViewDeviceDraft{
 valid(object(raw)&&keys(raw,['version','edit','after','phase','command','attempts','receipt','error','legacy'])&&raw.version===1&&editor(raw.edit)&&(raw.after===null||editor(raw.after))&&integer(raw.attempts)&&['editing','pending','received','rejected','damaged'].includes(String(raw.phase))&&(raw.error===null||text(raw.error,100)));
 if(raw.phase==='editing')valid(raw.after===null&&raw.command===null&&raw.attempts===0&&raw.receipt===null&&raw.error===null&&raw.legacy===null);
 else if(raw.phase==='damaged')valid(raw.command===null&&raw.receipt===null&&object(raw.legacy)&&keys(raw.legacy,['draft','request'])&&[raw.legacy.draft,raw.legacy.request].every(value=>value===null||text(value,1000000)));
 else{
  valid(object(raw.command));commandBody(raw.command as SavedViewCommand);valid(raw.legacy===null);
  if(raw.phase==='received'){valid((raw.attempts as number)>0&&raw.error===null);confirmSavedViewReceipt(raw.command as SavedViewCommand,raw.receipt);}
  else valid(raw.receipt===null&&(raw.phase!=='rejected'||(raw.attempts as number)>0&&raw.error!==null));
 }
 valid(new TextEncoder().encode(JSON.stringify(raw)).byteLength<=1500000);
 return structuredClone(raw) as SavedViewDeviceDraft;
}
export function savedViewDeviceEdit(edit:SavedViewEditorDraft):SavedViewDeviceDraft{
 return validateSavedViewDeviceDraft({version:1,edit,after:null,phase:'editing',command:null,attempts:0,receipt:null,error:null,legacy:null});
}
export function prepareSavedViewDeviceDraft(edit:SavedViewEditorDraft,command:SavedViewCommand):SavedViewDeviceDraft{
 return validateSavedViewDeviceDraft({...savedViewDeviceEdit(edit),phase:'pending',command});
}
/** Import old bytes before deleting either plaintext key; a legacy request may already be committed. */
export function legacySavedViewDeviceDraft(draftRaw:string|null,requestRaw:string|null):SavedViewDeviceDraft{
 const damaged:SavedViewEditorDraft={definition:null,spaceId:null,visibility:'personal',dirty:true};
 let own:SavedViewEditorDraft=damaged;
 try{
  if(draftRaw!==null){try{const parsed:unknown=JSON.parse(draftRaw);if(editor(parsed))own=parsed;else if(object(parsed)&&keys(parsed,['definition','damagedDefinition','id','revision','spaceId','visibility','dirty','tagsInput','inputCalendar'],['spaceId','visibility','dirty']))own={...parsed,definition:null,damagedDefinition:parsed.definition} as SavedViewEditorDraft;else throw Error('invalid');valid(editor(own));}
   catch{if(requestRaw===null)throw Error('invalid');own={...damaged,damagedDefinition:draftRaw};}}
  if(requestRaw===null)return savedViewDeviceEdit(own);
  const request=JSON.parse(requestRaw);valid(object(request)&&keys(request,['body','id'])&&text(request.body,60000)&&typeof request.id==='string');
  const original=JSON.parse(request.body as string);valid(object(original));let command:SavedViewCommand,frozen:SavedViewEditorDraft;
  if(original.action==='delete'){
   valid(keys(original,['action','id','revision'])&&id(original.id));command={action:'delete',id:original.id as string,bodyJson:JSON.stringify({requestId:request.id,expectedRevision:original.revision})};frozen=own;
  }else{
   valid(keys(original,['spaceId','visibility','definition','expectedRevision','id'],['spaceId','visibility','definition']));
   const target=original.id??null;valid(target===null||id(target));
   command={action:'save',id:target as string|null,bodyJson:JSON.stringify({requestId:request.id,spaceId:original.spaceId,visibility:original.visibility,definition:original.definition,...(target===null?{}:{expectedRevision:original.expectedRevision})})};
   frozen={definition:original.definition,spaceId:original.spaceId,visibility:original.visibility,dirty:true,...(target===null?{}:{id:target,revision:original.expectedRevision})} as SavedViewEditorDraft;
  }
  return validateSavedViewDeviceDraft({...prepareSavedViewDeviceDraft(frozen,command),attempts:1,after:own});
 }catch{
  return validateSavedViewDeviceDraft({version:1,edit:damaged,after:null,phase:'damaged',command:null,attempts:requestRaw===null?0:1,receipt:null,error:null,legacy:{draft:draftRaw,request:requestRaw}});
 }
}
/** Keep input made after an old unknown request, while rebinding only that same view to its receipt. */
export function settledSavedViewEdit(record:SavedViewDeviceDraft):SavedViewEditorDraft{
 valid(record.phase==='received'&&record.command!==null);const command=record.command,body=commandBody(command),own=structuredClone(record.after??record.edit);
 if(command.action==='delete')return own.id===command.id?{definition:own.definition,damagedDefinition:own.damagedDefinition,spaceId:own.spaceId,visibility:'personal',dirty:true,tagsInput:own.tagsInput,inputCalendar:own.inputCalendar}:own;
 const view=record.receipt as SharedSavedView;
 if(record.after!==null&&(command.id===null?own.id!==undefined:own.id!==command.id))return own;
 const changed=record.after!==null&&(!own.definition||own.spaceId!==view.spaceId||own.visibility!==view.visibility||!equal(normalizedDefinition(savedViewPayload(own)),normalizedDefinition(body.definition as SharedSavedViewDefinition)));
 return {...own,id:view.id,revision:view.revision,spaceId:view.spaceId,visibility:view.visibility,definition:changed?own.definition:view.definition,dirty:changed};
}
export async function sendSavedViewDeviceDraft(input:SavedViewDeviceDraft,access:{persist:(value:SavedViewDeviceDraft)=>Promise<unknown>;send:(command:SavedViewCommand)=>Promise<unknown>;definitiveRejection:(error:unknown)=>string|null}):Promise<SavedViewDeviceDraft>{
 const original=validateSavedViewDeviceDraft(input);valid(original.phase==='pending'&&original.command!==null);const attempted={...original,attempts:original.attempts+1};await access.persist(attempted);
 let receipt:SharedSavedView|{ok:true};try{receipt=confirmSavedViewReceipt(original.command,await access.send(original.command));}
 catch(error){const code=original.attempts===0?access.definitiveRejection(error):null;if(code)await access.persist({...attempted,phase:'rejected',error:code});throw error;}
 const received:SavedViewDeviceDraft={...attempted,phase:'received',receipt};await access.persist(received);return received;
}
