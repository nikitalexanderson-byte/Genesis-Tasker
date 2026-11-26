import {sha256} from '@noble/hashes/sha2.js';
import {assertTechnical,exactKeys} from './keys.ts';
import {encodeE2eeBytes} from './envelope.ts';
import {canonicalJson} from '../aurora/forecast.ts';
import {samePrivateJson as same} from './product-json.ts';
import {sharedRecordKey,sharedBodyParent,sharedRestoreContentAllowed,validateSharedRecordBody,type SharedDomainBinding,type SharedRecordBody} from './shared-domain.ts';
import {sharedFileReference,type SharedFileReference} from './shared-file-values.ts';
import {openContentArchiveValue,type ContentArchiveValue} from './content-archive.ts';
import {privateExecutionId} from './shared-execution-values.ts';
import {validateSharedLiveContext,type SharedLiveContext} from './shared-live.ts';
import type {ProductVersion} from './shared-product.ts';

type Row=Record<string,unknown>;
export type SharedRestoreSource={binding:SharedDomainBinding;records:SharedRecordBody[];files:{objectId:string;value:ContentArchiveValue}[]};
export type SharedRestoreCapture={binding:SharedDomainBinding;context:SharedLiveContext;versions:ProductVersion[]};
type Plan={before:SharedRestoreCapture;records:SharedRecordBody[];files:{reference:SharedFileReference;value:ContentArchiveValue}[];added:number;skipped:number;fingerprint:string};
export type SharedRestoreJournal={format:'genesis-shared-content-restore-v1';ownerId:string;intentId:string;backupId:string;createdAt:string;source:SharedRestoreSource;proposal:Plan|null;confirmed:string|null;started:boolean;complete:boolean;applied:string[]};
function invalid():never{throw new Error('E2EE_RESTORE_CONTENT_INVALID');}
const hash=(value:unknown)=>{const bytes=new TextEncoder().encode(canonicalJson(value));try{return encodeE2eeBytes(sha256(bytes));}finally{bytes.fill(0);}};
export function sharedRestoreBinding(value:unknown):SharedDomainBinding{exactKeys(value,['scopeId','kind','resourceId']);assertTechnical(value.scopeId);assertTechnical(value.resourceId);if(!['project','space'].includes(String(value.kind)))invalid();return value as SharedDomainBinding;}
export function validateSharedRestoreSource(input:unknown):SharedRestoreSource{
 exactKeys(input,['binding','records','files']);const binding=sharedRestoreBinding(input.binding);if(!Array.isArray(input.records)||!input.records.length||input.records.length>100000||!Array.isArray(input.files)||input.files.length>600000)invalid();
 const records=input.records.map(raw=>{if(!raw||typeof raw!=='object')invalid();return validateSharedRecordBody(binding,(raw as SharedRecordBody).kind,raw);});if(new Set(records.map(row=>sharedRecordKey(row.kind,row.record))).size!==records.length)invalid();
 const ids=new Set<string>();for(const file of input.files){exactKeys(file,['objectId','value']);assertTechnical(file.objectId);if(ids.has(file.objectId))invalid();ids.add(file.objectId);exactKeys(file.value,['id','encoding','bytes','sha256','size','filename','mediaType']);if(file.value.encoding!=='base64url'||typeof file.value.bytes!=='string'||typeof file.value.sha256!=='string'||!Number.isSafeInteger(file.value.size)||Number(file.value.size)<1)invalid();}
 return structuredClone({binding,records,files:input.files}) as SharedRestoreSource;
}
export function validateSharedRestoreCapture(input:unknown):SharedRestoreCapture{
 exactKeys(input,['binding','context','versions']);const binding=sharedRestoreBinding(input.binding);validateSharedLiveContext(input.context);if(!Array.isArray(input.versions)||input.versions.length>100000)invalid();const ids=new Set<string>();
 for(const raw of input.versions){exactKeys(raw,['protocol','scopeId','entityId','kind','revision','parentId','deleted','metadata','body']);assertTechnical(raw.entityId);if(raw.protocol!==1||raw.scopeId!==binding.scopeId||ids.has(raw.entityId)||!Number.isSafeInteger(raw.revision)||Number(raw.revision)<1||typeof raw.deleted!=='boolean')invalid();ids.add(raw.entityId);if(!raw.deleted)validateSharedRecordBody(binding,raw.kind as SharedRecordBody['kind'],raw.body,raw as ProductVersion);}
 return structuredClone(input) as SharedRestoreCapture;
}
/** Imported ACL/category policies, completed jobs, receipts and root topology
 * are retained as history. Definitions that can execute start disabled. */
async function plan(journal:SharedRestoreJournal,captured:unknown):Promise<Plan>{
 const before=validateSharedRestoreCapture(captured),source=journal.source;if(before.binding.kind!==source.binding.kind||before.binding.resourceId!==source.binding.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 const existing=new Set(before.versions.map(row=>row.entityId)),members=new Set(before.context.members.map(row=>row.userId)),records:SharedRecordBody[]=[],files:Plan['files']=[];let skipped=0;
 for(const original of source.records){const id=sharedRecordKey(original.kind,original.record);if(existing.has(id)||!sharedRestoreContentAllowed(original)){skipped++;continue;}
  const value=structuredClone(original);Object.assign(value,{scopeId:before.binding.scopeId,execution:'live'});const row=value.record;
  if(row.revision!==undefined)row.revision=1;if(row.deleted_at!==undefined)row.deleted_at=null;
  if(value.kind==='automation'){row.enabled=0;row.owner_id=journal.ownerId;}if(value.kind==='series'){row.paused=1;row.owner_id=journal.ownerId;row.cursor_date=null;row.generated_count=0;row.last_error=null;row.checked_at=null;}
  if(value.kind==='task'){
   if(row.assignee_id!==null&&!members.has(row.assignee_id))throw new Error('INVALID_ASSIGNEE');row.completed_at=null;row.completed_by=null;row.updated_by=journal.ownerId;row.updated_at=journal.createdAt;
   value.related.shared_task_approvals=[];value.related.shared_task_reviews=[];value.related.shared_task_watchers=[];value.related.shared_notification_task_state=[];value.related.shared_mindmap_conversions=[];
   for(const table of ['shared_task_attachments','shared_task_images'])for(const child of value.related[table]??[]){const reference=sharedFileReference(child),content=source.files.find(file=>file.objectId===reference.objectId);if(!content)throw new Error('E2EE_RESTORE_FILE_REQUIRED');
    if(content.value.size!==reference.size||content.value.filename!==reference.filename||content.value.mediaType!==reference.mediaType)throw new Error('E2EE_PRIVATE_FILE_CORRUPT');const target={...reference,objectId:'shared-file:'+await privateExecutionId(before.binding.scopeId,journal.intentId,reference.objectId)};child.file=target;if(!files.some(file=>file.reference.objectId===target.objectId))files.push({reference:target,value:content.value});}
  }
  if(value.kind==='comment')value.related.shared_comment_mentions=[];
  records.push(validateSharedRecordBody(before.binding,value.kind,value));
 }
 const ordered:SharedRecordBody[]=[],pending=[...records],ready=new Set(before.versions.filter(row=>!row.deleted).map(row=>row.entityId));
 while(pending.length){let progress=false;for(let at=0;at<pending.length;){const value=pending[at],row=value.record,dependencies=[sharedBodyParent(value)];if(value.kind==='task'){dependencies.push('status:'+row.status_id);for(const child of value.related.shared_task_dependencies??[])dependencies.push('task:'+child.predecessor_id);for(const child of value.related.shared_task_labels??[])dependencies.push('label:'+child.label_id);for(const child of value.related.shared_custom_field_values??[])dependencies.push('custom-field:'+child.field_id);}
   if(dependencies.every(id=>id===null||ready.has(id))){ordered.push(value);ready.add(sharedRecordKey(value.kind,row));pending.splice(at,1);progress=true;}else at++;}if(!progress)throw new Error('E2EE_PRODUCT_DEPENDENCY_INVALID');}
 const result={before,records:ordered,files,added:ordered.length,skipped};return{...result,fingerprint:hash({format:'genesis-shared-restore-review-v1',source,...result})};
}
export function validateSharedRestoreJournal(input:unknown,ownerId:string,id:string):SharedRestoreJournal{
 exactKeys(input,['format','ownerId','intentId','backupId','createdAt','source','proposal','confirmed','started','complete','applied']);assertTechnical(id);assertTechnical(input.backupId);if(input.format!=='genesis-shared-content-restore-v1'||input.ownerId!==ownerId||input.intentId!==id||typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt))||typeof input.started!=='boolean'||typeof input.complete!=='boolean'||!Array.isArray(input.applied)||input.applied.length>100000||new Set(input.applied).size!==input.applied.length)invalid();validateSharedRestoreSource(input.source);
 if(input.proposal!==null){exactKeys(input.proposal,['before','records','files','added','skipped','fingerprint']);validateSharedRestoreCapture(input.proposal.before);if(!Array.isArray(input.proposal.records)||!Array.isArray(input.proposal.files)||input.proposal.added!==input.proposal.records.length||!Number.isSafeInteger(input.proposal.skipped)||Number(input.proposal.skipped)<0||typeof input.proposal.fingerprint!=='string')invalid();}
 const checkedProposal=input.proposal as Plan|null;
 if(input.confirmed!==null&&(!checkedProposal||input.confirmed!==checkedProposal.fingerprint)||input.started&&input.confirmed===null||input.applied.some(item=>typeof item!=='string'||!checkedProposal||!(checkedProposal.records as SharedRecordBody[]).some(row=>sharedRecordKey(row.kind,row.record)===item))||input.applied.length&&!input.started||input.complete&&(!input.started||input.applied.length!==checkedProposal?.added))invalid();return structuredClone(input) as SharedRestoreJournal;
}
export interface SharedRestorePorts{ownerId:string;current:()=>void;load:(id:string)=>Promise<{value:unknown;serial:number}|null>;save:(id:string,value:SharedRestoreJournal,expected:number|null)=>Promise<number>;list:()=>Promise<string[]>;capture:(binding:SharedDomainBinding)=>Promise<unknown>;request:(binding:SharedDomainBinding,path:string,input:Row)=>Promise<Row>}
/** Every write uses the current normal signed product writer. A former member
 * can inspect retained content but cannot restore it into an inaccessible scope. */
export class SharedContentRestore{
 #serial:Promise<unknown>=Promise.resolve();constructor(private readonly ports:SharedRestorePorts){}
 #run<T>(work:()=>Promise<T>){const next=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return work();});this.#serial=next;return next;}
 async #load(id:string){assertTechnical(id);const saved=await this.ports.load(id);this.ports.current();if(!saved)throw new Error('E2EE_RESTORE_REQUIRED');const value=validateSharedRestoreJournal(saved.value,this.ports.ownerId,id);if(value.proposal&&!same(await plan(value,value.proposal.before),value.proposal))invalid();this.ports.current();return{...saved,value};}
 async #save(value:SharedRestoreJournal,expected:number|null){validateSharedRestoreJournal(value,this.ports.ownerId,value.intentId);const serial=await this.ports.save(value.intentId,value,expected);this.ports.current();const row=await this.#load(value.intentId);if(serial!==(expected??0)+1||row.serial!==serial||!same(row.value,value))throw new Error('E2EE_LOCAL_CONFLICT');return row;}
 async #capture(binding:SharedDomainBinding){const view=validateSharedRestoreCapture(await this.ports.capture(binding));this.ports.current();if(view.binding.kind!==binding.kind||view.binding.resourceId!==binding.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return view;}
 create(backupId:string,input:unknown){const source=validateSharedRestoreSource(input);assertTechnical(backupId);return this.#run(async()=>{for(const file of source.files){const opened=await openContentArchiveValue(file.value,this.ports.current);opened.bytes.fill(0);}const intentId=crypto.randomUUID();await this.#save({format:'genesis-shared-content-restore-v1',ownerId:this.ports.ownerId,intentId,backupId,createdAt:new Date().toISOString(),source,proposal:null,confirmed:null,started:false,complete:false,applied:[]},null);return intentId;});}
 inspect(id:string){return this.#run(async()=>(await this.#load(id)).value);}
 pending(){return this.#run(async()=>{const result:SharedRestoreJournal[]=[];for(const id of await this.ports.list())result.push((await this.#load(id)).value);return result;});}
 preview(id:string){return this.#run(async()=>{const row=await this.#load(id);if(row.value.started)throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');const proposal=await plan(row.value,await this.#capture(row.value.source.binding));return(await this.#save({...row.value,proposal,confirmed:null},row.serial)).value;});}
 confirm(id:string,fingerprint:string){return this.#run(async()=>{const row=await this.#load(id);if(row.value.started||!row.value.proposal||row.value.proposal.fingerprint!==fingerprint||!same(await this.#capture(row.value.source.binding),row.value.proposal.before))throw new Error('E2EE_RESTORE_REVIEW_STALE');return(await this.#save({...row.value,confirmed:fingerprint},row.serial)).value;});}
 apply(id:string){return this.#run(async()=>{let row=await this.#load(id);const review=row.value.proposal;if(!review||row.value.confirmed!==review.fingerprint)throw new Error('E2EE_RESTORE_REVIEW_REQUIRED');if(row.value.complete)return row.value;
  let current=await this.#capture(review.before.binding);if(!same(current.binding,review.before.binding))throw new Error('E2EE_RESTORE_REVIEW_STALE');if(!row.value.started){if(!same(current,review.before))throw new Error('E2EE_RESTORE_REVIEW_STALE');row=await this.#save({...row.value,started:true},row.serial);}
  // Original archive bytes remain in the journal throughout interrupted uploads.
  for(const file of review.files){const opened=await openContentArchiveValue(file.value,this.ports.current);try{const result=await this.ports.request(current.binding,'content-restore/file',{requestId:await privateExecutionId(current.binding.scopeId,id,file.reference.objectId),reference:file.reference,data:encodeE2eeBytes(opened.bytes)});this.ports.current();if(result.pending)throw new Error('E2EE_ONLINE_REQUIRED');}finally{opened.bytes.fill(0);}}
  let writes=0;for(const record of review.records){const entityId=sharedRecordKey(record.kind,record.record);if(row.value.applied.includes(entityId))continue;current=await this.#capture(review.before.binding);if(!same(current.binding,review.before.binding))throw new Error('E2EE_RESTORE_REVIEW_STALE');let observed=current.versions.find(value=>value.entityId===entityId);
   if(!observed){const result=await this.ports.request(current.binding,'content-restore/records',{requestId:await privateExecutionId(current.binding.scopeId,id,entityId),records:[record]});this.ports.current();if(result.pending)throw new Error('E2EE_ONLINE_REQUIRED');current=await this.#capture(review.before.binding);observed=current.versions.find(value=>value.entityId===entityId);}
   if(!observed||observed.deleted||observed.revision!==1||!same(observed.body,record))throw new Error('E2EE_RESTORE_OUTCOME_REQUIRED');row=await this.#save({...row.value,applied:[...row.value.applied,entityId]},row.serial);if(++writes===25)break;
  }
  if(row.value.applied.length===review.added)row=await this.#save({...row.value,complete:true},row.serial);return row.value;
 });}
}
