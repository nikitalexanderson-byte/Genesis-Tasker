import {E2eeDeviceDocument} from './device-document.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {calendarContext,isCivilDate} from '../calendar-context.ts';
import {approveExternalCopy,EXTERNAL_COPY_NOTICE_VERSION} from './external-copy.ts';
import {requestPrivateGoogleCopy} from '../cloud-sync.ts';
import type {WebPrivateAccount} from './product-session.ts';

export type GoogleCopyContent={title:string;description:string;dueDate:string|null;startDate:string|null;startTime:string|null;endTime:string|null;timeZone:string;completedAt:string|null};
export type GoogleCopyPayload={operationId:string;provider:'google-tasks'|'google-calendar';accountId:string;copy:GoogleCopyContent};
export type GoogleCopyReceipt={operationId:string;provider:GoogleCopyPayload['provider'];state:'complete'|'uncertain';externalId:string|null};
export type GoogleCopyJob={protocol:1;ownerId:string;payload:GoogleCopyPayload;state:'prepared'|'complete'|'uncertain';externalId:string|null;createdAt:string};
export function googleCopyContent(source:{title:string;description?:string;dueDate?:string|null;endDate?:string|null;startDate?:string|null;startTime?:string|null;time?:string|null;endTime?:string|null;completedAt?:string|null},timeZone:string):GoogleCopyContent{
 const nullable=(value:string|null|undefined)=>value?.trim()||null;
 const copy={title:source.title,description:source.description??'',dueDate:nullable(source.endDate)??nullable(source.dueDate),startDate:nullable(source.startDate)??nullable(source.dueDate),startTime:nullable(source.startTime)??nullable(source.time),endTime:nullable(source.endTime),timeZone,completedAt:nullable(source.completedAt)};validateContent(copy);return copy;
}
function validateContent(input:unknown):asserts input is GoogleCopyContent{
 exactKeys(input,['title','description','dueDate','startDate','startTime','endTime','timeZone','completedAt']);
 if(typeof input.title!=='string'||!input.title.trim()||input.title.length>2000||typeof input.description!=='string'||input.description.length>100000||typeof input.timeZone!=='string')throw new Error('E2EE_EXTERNAL_COPY_INVALID');calendarContext({timeZone:input.timeZone});
 for(const key of ['dueDate','startDate'])if(input[key]!==null&&(typeof input[key]!=='string'||!isCivilDate(input[key])))throw new Error('E2EE_EXTERNAL_COPY_INVALID');
 for(const key of ['startTime','endTime'])if(input[key]!==null&&(typeof input[key]!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(input[key])))throw new Error('E2EE_EXTERNAL_COPY_INVALID');
 if(input.completedAt!==null&&(typeof input.completedAt!=='string'||!Number.isFinite(Date.parse(input.completedAt))))throw new Error('E2EE_EXTERNAL_COPY_INVALID');
}
export function validateGoogleCopyPayload(input:unknown):GoogleCopyPayload{
 exactKeys(input,['operationId','provider','accountId','copy']);assertTechnical(input.operationId);assertTechnical(input.accountId);if(!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(input.operationId)||!['google-tasks','google-calendar'].includes(String(input.provider)))throw new Error('E2EE_EXTERNAL_COPY_INVALID');validateContent(input.copy);if(input.provider==='google-calendar'&&(!input.copy.dueDate||!!input.copy.startTime!==!!input.copy.endTime||input.copy.startDate&&input.copy.startDate>input.copy.dueDate))throw new Error('E2EE_EXTERNAL_COPY_DATE_REQUIRED');return input as GoogleCopyPayload;
}
function document(account:WebPrivateAccount,id:string){assertTechnical(id);return new E2eeDeviceDocument<GoogleCopyJob>(account.device,`external-google-copy:${id}`,input=>{
 exactKeys(input,['protocol','ownerId','payload','state','externalId','createdAt']);if(input.protocol!==1||input.ownerId!==account.ownerId||!['prepared','complete','uncertain'].includes(String(input.state))||typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt))||input.externalId!==null&&(typeof input.externalId!=='string'||input.externalId.length>2048))throw new Error('E2EE_EXTERNAL_COPY_INVALID');const payload=validateGoogleCopyPayload(input.payload);if(payload.operationId!==id||input.state==='complete'&&!input.externalId)throw new Error('E2EE_EXTERNAL_COPY_INVALID');return input as GoogleCopyJob;
 },()=>account.requireOpen());}
export async function prepareGoogleCopy(account:WebPrivateAccount,provider:GoogleCopyPayload['provider'],accountId:string,copy:GoogleCopyContent){
 account.requireOpen();if(account.mode!=='online')throw new Error('E2EE_ONLINE_REQUIRED');const payload=validateGoogleCopyPayload({operationId:crypto.randomUUID(),provider,accountId,copy:structuredClone(copy)}),job:GoogleCopyJob={protocol:1,ownerId:account.ownerId,payload,state:'prepared',externalId:null,createdAt:new Date().toISOString()};await document(account,payload.operationId).save(job,null);account.requireOpen();return job;
}
export async function sendGoogleCopy(account:WebPrivateAccount,job:GoogleCopyJob,confirmed:boolean){
 account.requireOpen();const store=document(account,job.payload.operationId),saved=await store.load();account.requireOpen();if(!saved||JSON.stringify(saved.value)!==JSON.stringify(job))throw new Error('E2EE_EXTERNAL_COPY_CHANGED');if(job.state==='complete')return job;
 const consent=await approveExternalCopy(account,job.payload.provider,`google-copy:${job.payload.accountId}`,job.payload,{confirmed,noticeVersion:EXTERNAL_COPY_NOTICE_VERSION}),receipt=await requestPrivateGoogleCopy(account.ownerId,job.payload,consent);account.requireOpen();
 exactKeys(receipt,['operationId','provider','state','externalId']);if(receipt.operationId!==job.payload.operationId||receipt.provider!==job.payload.provider||!['complete','uncertain'].includes(receipt.state)||receipt.externalId!==null&&typeof receipt.externalId!=='string')throw new Error('E2EE_INVALID_RECEIPT');
 const next:GoogleCopyJob={...job,state:receipt.state,externalId:receipt.externalId};await store.save(next,saved.serial);account.requireOpen();return next;
}
export async function retainedGoogleCopies(account:WebPrivateAccount){account.requireOpen();const prefix='external-google-copy:',ids=await account.device.vault.listLocal('draft',prefix);account.requireOpen();const jobs:GoogleCopyJob[]=[];
 for(const id of ids){const row=await document(account,id.slice(prefix.length)).load();account.requireOpen();if(!row)throw new Error('E2EE_EXTERNAL_COPY_INVALID');jobs.push(row.value);}return jobs.sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}
