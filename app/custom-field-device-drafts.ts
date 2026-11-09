import type {CustomFieldCommand,CustomFieldDraft,CustomFieldPreview,SharedCustomField} from './shared-custom-fields';

type ExpectedField=CustomFieldPreview['field'];
export type CustomFieldReceipt={field:SharedCustomField;previousFieldId:string|null};
export type CustomFieldDeviceDraft={version:1;spaceId:string;projectId:string;draft:CustomFieldDraft;positionInput?:string;
 phase:'editing'|'pending'|'rejected'|'received';commandJson:string|null;expected:ExpectedField|null;attempts:number;receipt:CustomFieldReceipt|null;error:string|null};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).length===allowed.length&&Object.keys(value).every(key=>allowed.includes(key));
const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const text=(value:unknown,max:number)=>typeof value==='string'&&[...value].length<=max;
const integer=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const fieldKeys=['id','title','type','projectId','options','position','required','showCard','showList','archived'];
function field(value:unknown):boolean{
 if(!object(value)||!id(value.id)||!text(value.title,160)||!['text','number','date','select','multi','checkbox','url'].includes(String(value.type))||value.projectId!==null&&!id(value.projectId)||typeof value.position!=='number'||!Number.isSafeInteger(value.position)||Math.abs(value.position)>100000)return false;
 if(!['required','showCard','showList','archived'].every(key=>typeof value[key]==='boolean')||!Array.isArray(value.options)||value.options.filter(row=>object(row)&&row.archived===false).length>200||new TextEncoder().encode(JSON.stringify(value)).length>1_000_000)return false;
 return value.options.every(row=>object(row)&&keys(row,['id','title','archived'])&&id(row.id)&&text(row.title,160)&&typeof row.archived==='boolean')&&new Set(value.options.map(row=>row.id)).size===value.options.length;
}
const equal=(a:unknown,b:unknown):boolean=>{
 if(a===b)return true;
 if(Array.isArray(a)&&Array.isArray(b))return a.length===b.length&&a.every((value,index)=>equal(value,b[index]));
 return object(a)&&object(b)&&Object.keys(a).length===Object.keys(b).length&&Object.keys(a).every(key=>Object.hasOwn(b,key)&&equal(a[key],b[key]));
};
function requireValid(value:unknown):asserts value{if(!value)throw new Error('CUSTOM_FIELD_DEVICE_DRAFT_INVALID');}
export function customFieldPositionValue(value:string):number|null{
 const number=Number(value);return /^-?\d+$/.test(value)&&Number.isSafeInteger(number)&&Math.abs(number)<=100000?number:null;
}
export function validateCustomFieldDeviceDraft(raw:unknown,spaceId:string,projectId:string):CustomFieldDeviceDraft{
 requireValid(object(raw)&&keys(raw,['version','spaceId','projectId','draft','phase','commandJson','expected','attempts','receipt','error',...(Object.hasOwn(raw,'positionInput')?['positionInput']:[])]));
 requireValid(raw.positionInput===undefined||text(raw.positionInput,100));
 requireValid(raw.version===1&&raw.spaceId===spaceId&&id(spaceId)&&raw.projectId===projectId&&id(projectId));
 requireValid(object(raw.draft)&&keys(raw.draft,[...fieldKeys,'expectedRevision'])&&field(raw.draft)&&integer(raw.draft.expectedRevision));
 requireValid(['editing','pending','rejected','received'].includes(String(raw.phase))&&integer(raw.attempts));
 requireValid(raw.error===null||text(raw.error,100));
 if(raw.phase==='editing')requireValid(raw.commandJson===null&&raw.expected===null&&raw.attempts===0&&raw.receipt===null&&raw.error===null);
 else{
  requireValid(raw.positionInput===undefined||customFieldPositionValue(raw.positionInput as string)===(raw.draft as CustomFieldDraft).position);
  requireValid(text(raw.commandJson,1_000_000)&&object(raw.expected)&&keys(raw.expected,[...fieldKeys,'spaceId'])&&field(raw.expected)&&raw.expected.spaceId===spaceId);
  let command:unknown;try{command=JSON.parse(raw.commandJson as string);}catch{throw new Error('CUSTOM_FIELD_DEVICE_DRAFT_INVALID');}
  requireValid(object(command)&&keys(command,[...fieldKeys,'expectedRevision','operationId','fingerprint','replaceType'])&&field(command)&&integer(command.expectedRevision)&&typeof command.operationId==='string'&&/^[a-zA-Z0-9:_-]{1,100}$/.test(command.operationId)&&typeof command.fingerprint==='string'&&/^[a-f0-9]{64}$/.test(command.fingerprint)&&typeof command.replaceType==='boolean');
  requireValid(equal(Object.fromEntries([...fieldKeys,'expectedRevision'].map(key=>[key,command[key]])),raw.draft));
  requireValid(raw.expected.id===command.id);
  if(raw.phase==='received'){requireValid((raw.attempts as number)>0&&raw.error===null);confirmCustomFieldReceipt(raw as CustomFieldDeviceDraft,raw.receipt);}
  else requireValid(raw.receipt===null&&(raw.phase!=='rejected'||raw.attempts===1&&raw.error!==null));
 }
 return structuredClone(raw) as CustomFieldDeviceDraft;
}
export function customFieldDeviceEdit(spaceId:string,projectId:string,draft:CustomFieldDraft,positionInput=String(draft.position)):CustomFieldDeviceDraft{
 return validateCustomFieldDeviceDraft({version:1,spaceId,projectId,draft,positionInput,phase:'editing',commandJson:null,expected:null,attempts:0,receipt:null,error:null},spaceId,projectId);
}
export function prepareCustomFieldDeviceDraft(input:CustomFieldDeviceDraft,preview:CustomFieldPreview,confirmed:boolean,operationId:string):CustomFieldDeviceDraft{
 requireValid(input.phase==='editing'&&preview.field.id===input.draft.id&&preview.field.spaceId===input.spaceId&&preview.previousRevision===input.draft.expectedRevision&&(!preview.replaceType||confirmed));
 requireValid(customFieldPositionValue(input.positionInput??String(input.draft.position))===input.draft.position);
 const command:CustomFieldCommand={...input.draft,fingerprint:preview.fingerprint,operationId,replaceType:preview.replaceType};
 return validateCustomFieldDeviceDraft({...input,phase:'pending',commandJson:JSON.stringify(command),expected:preview.field},input.spaceId,input.projectId);
}
/** Compare the complete normalized definition, including options, before settling a send. */
export function confirmCustomFieldReceipt(input:CustomFieldDeviceDraft,raw:unknown):CustomFieldReceipt{
 if(!input.commandJson||!input.expected||!object(raw)||!keys(raw,['field','previousFieldId'])||!object(raw.field)||!field(raw.field)||!keys(raw.field,[...fieldKeys,'spaceId','predecessorId','revision']))throw new Error('CUSTOM_FIELD_RECEIPT_INVALID');
 const command=JSON.parse(input.commandJson) as CustomFieldCommand,returned=raw.field;
 const replaced=command.replaceType;
 if(!integer(returned.revision)||returned.revision!==(replaced?1:command.expectedRevision+1)||!id(returned.id)||replaced&&returned.id===command.id||!replaced&&returned.id!==command.id||raw.previousFieldId!==(replaced?command.id:null)||replaced&&returned.predecessorId!==command.id||!replaced&&returned.predecessorId!==null&&!id(returned.predecessorId))throw new Error('CUSTOM_FIELD_RECEIPT_INVALID');
 const expected={...input.expected,id:returned.id};
 if(!equal(Object.fromEntries([...fieldKeys,'spaceId'].map(key=>[key,returned[key]])),expected))throw new Error('CUSTOM_FIELD_RECEIPT_INVALID');
 return structuredClone(raw) as CustomFieldReceipt;
}

type AttemptAccess={persist:(value:CustomFieldDeviceDraft)=>Promise<unknown>;send:(command:CustomFieldCommand)=>Promise<unknown>;definitiveRejection:(error:unknown)=>string|null};
/** Durable attempt precedes HTTP. Unknown replies and later rejections keep the exact command. */
export async function sendCustomFieldDeviceDraft(input:CustomFieldDeviceDraft,access:AttemptAccess):Promise<CustomFieldDeviceDraft>{
 const original=validateCustomFieldDeviceDraft(input,input.spaceId,input.projectId);requireValid(original.phase==='pending'&&original.commandJson!==null);
 const attempted={...original,attempts:original.attempts+1};await access.persist(attempted);
 let receipt:CustomFieldReceipt;
 try{receipt=confirmCustomFieldReceipt(attempted,await access.send(JSON.parse(original.commandJson!) as CustomFieldCommand));}
 catch(error){const code=original.attempts===0?access.definitiveRejection(error):null;
  if(code)await access.persist({...attempted,phase:'rejected',error:code});throw error;
 }
 const received:CustomFieldDeviceDraft={...attempted,phase:'received',receipt};await access.persist(received);return received;
}

/** Explicit fresh base only; own settings survive and a new preview is always required. */
export function rebaseCustomFieldDeviceDraft(input:CustomFieldDeviceDraft,latest:SharedCustomField):CustomFieldDeviceDraft{
 const original=validateCustomFieldDeviceDraft(input,input.spaceId,input.projectId);
 requireValid(original.phase==='editing'||original.phase==='rejected'&&original.attempts===1||original.phase==='pending'&&original.attempts===0);
 requireValid(field(latest)&&latest.id===original.draft.id&&latest.spaceId===original.spaceId&&integer(latest.revision)&&latest.revision>=Math.max(1,original.draft.expectedRevision));
 return customFieldDeviceEdit(original.spaceId,original.projectId,{...original.draft,expectedRevision:latest.revision},original.positionInput);
}
