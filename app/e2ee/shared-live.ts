import catalogue from '../../contracts/e2ee/private-path-sources-v1.json' with {type:'json'};
import {sharedBodyMetadata,sharedBodyParent,sharedRecordKey,validateSharedRecordBody,type SharedDomainBinding,type SharedRecordBody,type SharedContentRecord} from './shared-domain.ts';
import {samePrivateJson} from './product-json.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {ProductEdit,ProductVersion,PendingProductVersion} from './shared-product.ts';
import type {ProductKind} from './product-contract.ts';
import {overlayPendingSharedVersions} from './shared-local-overlay.ts';
import {calendarContext,isCivilDate} from '../calendar-context.ts';
import {validateMindmap} from '../mindmaps-model.ts';
import {encodeE2eeBytes} from './envelope.ts';
import type {VerifiedProductProposal,VerifiedProductOrigin} from './product-proofs.ts';
import {prepareSharedTaskFiles,sharedRequestFileInputs,sharedFileReference,type SharedFileReference} from './shared-file-values.ts';
import {privateSharedTaskPage,privateSharedCustomFieldMatch} from './shared-query.ts';
import {membershipOperationForSharedRequest} from './membership-operation-request.ts';
import type {MembershipOperation} from './membership-operation-plan.ts';

type ObjectValue=Record<string,unknown>;
export type SharedLiveContext={ownerId:string;spaceId:string;role:string;spaceRole:string;permissions:Record<string,boolean>;members:ObjectValue[];invitations:ObjectValue[]};
export type SavedSharedRequest={protocol:1;scopeId:string;id:string;method:string;path:string;body:ObjectValue;createdAt:string;edits:ProductEdit[]|null;result:ObjectValue|null;complete:boolean};
type SavedRequest=SavedSharedRequest;
export interface SharedLivePorts{
 binding:SharedDomainBinding;actorId:string;online:boolean;current:()=>void;
 context:()=>Promise<SharedLiveContext>;versions:()=>Promise<ProductVersion[]>;
 localVersions?:()=>Promise<PendingProductVersion[]>;
 history?:(entityId:string,before:number)=>Promise<{versions:ProductVersion[];origins:VerifiedProductOrigin[];nextBefore:number|null}>;
 sourceTable?:(table:string)=>Promise<ObjectValue[]>;
 eventCache?:{load:()=>Promise<ObjectValue[]|null>;save:(events:ObjectValue[])=>Promise<void>};
 completionProposals?:()=>Promise<VerifiedProductProposal[]>;
 approvalPreview?:(entityId:string)=>Promise<{proposalId:string;payloadHash:string;version:ProductVersion}[]>;
 approve?:(review:{proposalId:string;payloadHash:string;version:ProductVersion},intentId:string)=>Promise<unknown>;
 stageFile?:(reference:SharedFileReference,bytes:Uint8Array)=>Promise<void>;
 readFile?:(reference:SharedFileReference)=>Promise<{bytes:Uint8Array;filename:string;mediaType:string}>;
 stage:(edits:ProductEdit[],intentId:string)=>Promise<string>;flush:(intentId:string)=>Promise<unknown>;
 loadRequest:(id:string)=>Promise<{value:SavedRequest;serial:number}|null>;
 saveRequest:(value:SavedRequest,expected:number|null)=>Promise<number>;
 membership?:(operation:MembershipOperation,intentId:string)=>Promise<ObjectValue>;
}
const camel=(key:string)=>key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
function object(value:unknown):asserts value is ObjectValue{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_SHARED_DOMAIN_INVALID');}
function parse(value:unknown){if(typeof value!=='string')throw new Error('E2EE_SHARED_DOMAIN_INVALID');return parseLegacyMigrationJson(value,'E2EE_SHARED_DOMAIN_INVALID',16*1024*1024);}
function number(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('E2EE_INVALID_REVISION');return value as number;}
function plain(version:ProductVersion):SharedRecordBody{if(version.deleted||!version.body)throw new Error('E2EE_PRODUCT_DELETED');return version.body as SharedRecordBody;}
export function validateSharedLiveRequest(binding:SharedDomainBinding,input:unknown):SavedRequest{
 exactKeys(input,['protocol','scopeId','id','method','path','body','createdAt','edits','result','complete']);assertTechnical(input.id);
 if(input.protocol!==1||input.scopeId!==binding.scopeId||!['POST','PATCH','PUT','DELETE'].includes(String(input.method))||typeof input.path!=='string'||input.path.length>2048
  ||typeof input.complete!=='boolean'||typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt))||input.edits!==null&&(!Array.isArray(input.edits)||input.edits.length>100))throw new Error('E2EE_SHARED_REQUEST_INVALID');
 object(input.body);if(input.result!==null)object(input.result);return input as SavedRequest;
}
export function validateSharedLiveContext(input:unknown):SharedLiveContext{
 exactKeys(input,['ownerId','spaceId','role','spaceRole','permissions','members','invitations']);assertTechnical(input.ownerId);assertTechnical(input.spaceId);
 if(typeof input.role!=='string'||typeof input.spaceRole!=='string'||!Array.isArray(input.members)||input.members.length>200||!Array.isArray(input.invitations)||input.invitations.length>100)throw new Error('E2EE_SHARED_CONTEXT_INVALID');
 exactKeys(input.permissions,['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers']);if(Object.values(input.permissions).some(value=>typeof value!=='boolean'))throw new Error('E2EE_SHARED_CONTEXT_INVALID');
 const seen=new Set<string>();for(const member of input.members){object(member);assertTechnical(member.userId);if(seen.has(member.userId)||typeof member.displayName!=='string'||member.displayName.length>2000)throw new Error('E2EE_SHARED_CONTEXT_INVALID');seen.add(member.userId);}
 for(const invite of input.invitations){object(invite);assertTechnical(invite.id);if(typeof invite.email!=='string'||invite.email.length>320)throw new Error('E2EE_SHARED_CONTEXT_INVALID');}
 return input as SharedLiveContext;
}
/** Shared web/native content model. Every mutation retains the user's complete
 * intent before reading or uploading; replay can only finish that same intent.
 * Server ACL, billing, quotas and exact-version approvals remain independent.
 * Unsupported operations fail explicitly instead of reaching legacy routes. */
export class SharedLiveModel{
 #serial:Promise<unknown>=Promise.resolve();
 #completion:VerifiedProductProposal[]=[];
 #pendingEntities=new Set<string>();
 constructor(private readonly ports:SharedLivePorts){}
 #run<T>(work:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return work();});this.#serial=task;return task;}
 async #snapshot(){const context=await this.ports.context();this.ports.current();const versions=await this.ports.versions();this.ports.current();
  if(context.ownerId.length<1||context.spaceId.length<1||!Array.isArray(context.members)||!Array.isArray(context.invitations))throw new Error('E2EE_SHARED_CONTEXT_INVALID');
  for(const row of versions){if(row.scopeId!==this.ports.binding.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');if(!row.deleted)validateSharedRecordBody(this.ports.binding,row.kind,row.body,row);}
  const local=this.ports.localVersions?await this.ports.localVersions():[];this.ports.current();
  this.#pendingEntities=new Set(local.map(row=>row.version.entityId));
  this.#completion=this.ports.completionProposals?await this.ports.completionProposals():[];this.ports.current();
  return{context,versions:overlayPendingSharedVersions(this.ports.binding,versions,local)};
 }
 #row(version:ProductVersion,context:SharedLiveContext):ObjectValue{
  const body=plain(version),source=body.record,result:ObjectValue={};
  for(const [key,value]of Object.entries(source)){
   if(key.endsWith('_json')){result[camel(key.slice(0,-5))]=value===null?null:parse(value);}
   else if(key!=='content'&&key!=='payload'&&key!=='file')result[camel(key)]=value;
  }
  result.revision=version.revision;
  if(body.kind==='project'||body.kind==='space')Object.assign(result,{role:context.role,spaceRole:context.spaceRole,permissions:structuredClone(context.permissions),canOrganizeTasks:context.permissions.organizeTasks===true,canCreateBoards:context.permissions.manageProjects===true});
  if(body.kind==='space')Object.assign(result,{coverPosition:{x:source.cover_x,y:source.cover_y},coverUrl:typeof source.cover_image==='string'&&source.cover_image?source.cover_image:null});
  if(body.kind==='status'){result.isDone=source.is_done;result.taskTitleLines=source.task_title_lines??(source.is_done===1?2:0);result.visibleTaskCount=source.visible_task_count??(source.is_done===1?5:0);}
  if(body.kind==='task'){
   const related=body.related;
   result.labelIds=(related.shared_task_labels??[]).map(row=>row.label_id);result.dependsOnIds=(related.shared_task_dependencies??[]).map(row=>row.predecessor_id);
   result.approvals=(related.shared_task_approvals??[]).map(row=>({userId:row.user_id,displayName:String(context.members.find(member=>member.userId===row.user_id)?.displayName??''),approvedAt:row.approved_at}));
   result.approvalRequired=(result.approvals as unknown[]).length>0;
   result.customFields=Object.fromEntries((related.shared_custom_field_values??[]).map(row=>[String(row.field_id),parse(row.value_json)]));
   const watched=(related.shared_task_watchers??[]).find(row=>row.user_id===this.ports.actorId),imported=(related.shared_notification_task_state??[]).some(row=>row.imported===1);
   result.watching=watched?watched.watching===1:!imported&&(source.created_by===this.ports.actorId||source.assignee_id===this.ports.actorId);result.notificationImported=imported;
   const planning=related.shared_task_planning??[];if(planning.length>1)throw new Error('E2EE_SHARED_DOMAIN_INVALID');
   if(planning[0]){const estimates=parse(planning[0].estimates_json);object(estimates);Object.assign(result,estimates,{sprintId:planning[0].sprint_id});}
   // Historical approvals/reviews are display-only. Fresh completion still
   // requires product proposals and each approver's exact signed version.
   result.review={enabled:false,allowed:{checked:false,confirmed:false,deletable:false},entries:(related.shared_task_reviews??[]).map(row=>({kind:row.kind,userId:row.user_id,displayName:String(context.members.find(member=>member.userId===row.user_id)?.displayName??''),reviewedAt:row.reviewed_at}))};
  }
  if(body.kind==='comment'){result.mentionIds=(body.related.shared_comment_mentions??[]).map(row=>row.user_id);result.authorName=String(context.members.find(member=>member.userId===source.author_id)?.displayName??'');}
  if(body.kind==='project')result.labelIds=(body.related.shared_project_labels??[]).map(row=>row.label_id);
  if(body.kind==='mindmap')result.document=parse(source.content);
  if(body.kind==='automation')Object.assign(result,{definition:parse(source.definition_json),enabled:source.enabled===1,deleted:source.deleted_at!==null,canManage:context.permissions.manageProjects,workerCompletedAt:null});
  if(body.kind==='template')Object.assign(result,{manifest:parse(source.manifest_json),notices:parse(source.source_notices_json),deleted:source.deleted_at!==null,system:false,canEdit:context.permissions.manageProjects});
  if(body.kind==='custom-field'){const definition=parse(source.definition_json);object(definition);Object.assign(result,definition,{required:source.required===1,showCard:source.show_card===1,showList:source.show_list===1,archived:source.archived_at!==null});}
  if(body.kind==='sprint'){const content=parse(source.content_json);object(content);Object.assign(result,content);}
  if(body.kind==='view')Object.assign(result,{definition:parse(source.payload),invalid:false,canEdit:source.owner_id===this.ports.actorId||context.permissions.manageProjects});
  if(body.kind==='category'&&body.table==='shared_member_categories')result.permissions=parse(source.permissions_json);
  return result;
 }
 async #fingerprint(versions:ProductVersion[],input:unknown){const bytes=new TextEncoder().encode(JSON.stringify({scopeId:this.ports.binding.scopeId,versions:[...versions].sort((a,b)=>a.entityId<b.entityId?-1:a.entityId>b.entityId?1:0),input}));
  try{return encodeE2eeBytes(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)));}finally{bytes.fill(0);}}
 #fieldInput(input:ObjectValue){
  const names=['id','title','type','projectId','options','position','required','showCard','showList','archived','expectedRevision'],result:ObjectValue={};
  if(Object.keys(input).some(name=>![...names,'fingerprint','operationId','replaceType'].includes(name)))throw new Error('CUSTOM_FIELD_INVALID');
  for(const name of names){if(!Object.hasOwn(input,name))throw new Error('CUSTOM_FIELD_INVALID');result[name]=structuredClone(input[name]);}
  assertTechnical(result.id);if(typeof result.title!=='string'||!result.title.trim()||result.title.length>2000||!['text','number','date','select','multi','checkbox','url'].includes(String(result.type))||!Number.isSafeInteger(result.position)||Math.abs(Number(result.position))>100000)throw new Error('CUSTOM_FIELD_INVALID');
  if(result.projectId!==(this.ports.binding.kind==='project'?this.ports.binding.resourceId:null))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
  for(const name of ['required','showCard','showList','archived'])if(typeof result[name]!=='boolean')throw new Error('CUSTOM_FIELD_INVALID');number(result.expectedRevision);
  if(!Array.isArray(result.options)||result.options.length>10000)throw new Error('CUSTOM_FIELD_OPTIONS_LIMIT');const seen=new Set<string>();
  for(const option of result.options){exactKeys(option,['id','title','archived']);assertTechnical(option.id);if(seen.has(option.id)||typeof option.title!=='string'||!option.title.trim()||option.title.length>2000||typeof option.archived!=='boolean')throw new Error('CUSTOM_FIELD_INVALID');seen.add(option.id);}
  return result;
 }
 async #fieldPreview(input:ObjectValue,versions:ProductVersion[],context:SharedLiveContext){const draft=this.#fieldInput(input),old=versions.find(row=>!row.deleted&&row.kind==='custom-field'&&plain(row).record.id===draft.id);
  if((old?.revision??0)!==draft.expectedRevision)throw new Error('CUSTOM_FIELD_CONFLICT');const prior=old?this.#row(old,context):null,replaceType=!!prior&&prior.type!==draft.type;
  const previousOptions=prior?.options as {id:string;title:string;archived:boolean}[]|undefined,options=draft.options as {id:string;title:string;archived:boolean}[];
  if(options.filter(row=>!row.archived).length>200||options.length>Math.max(200,replaceType?0:previousOptions?.length??0))throw new Error('CUSTOM_FIELD_OPTIONS_LIMIT');
  if(!replaceType&&previousOptions?.some(option=>!options.some(row=>row.id===option.id)))throw new Error('CUSTOM_FIELD_OPTIONS_RETAIN_REQUIRED');
  const field:ObjectValue={...draft,spaceId:context.spaceId,predecessorId:replaceType?draft.id:prior?.predecessorId??null};delete field.expectedRevision;
  return{field,fingerprint:await this.#fingerprint(versions,draft),valueCount:versions.filter(row=>!row.deleted&&row.kind==='task'&&(plain(row).related.shared_custom_field_values??[]).some(value=>value.field_id===draft.id)).length,replaceType,previousRevision:old?.revision??0,preservesPreviousValues:true};
 }
 #task(version:ProductVersion,versions:ProductVersion[],context:SharedLiveContext){
  const result=this.#row(version,context),children=versions.filter(row=>!row.deleted&&row.kind==='task'&&plain(row).record.parent_task_id===result.id);
  result.childCount=children.length;result.completedChildCount=children.filter(row=>plain(row).record.completed_at!==null).length;
  result.spaceId=context.spaceId;const project=versions.find(row=>row.kind==='project'&&!row.deleted);if(project){result.projectTitle=plain(project).record.title;result.isInbox=plain(project).record.is_inbox;}
  const body=plain(version);result.imageUrl=(body.related.shared_task_images??[]).length?`/api/shared/tasks/${encodeURIComponent(String(result.id))}/image`:null;
  result.attachments=(body.related.shared_task_attachments??[]).map(row=>{const file=sharedFileReference(row);return{id:row.id,name:file.filename,type:file.mediaType,size:file.size,url:`/api/shared/tasks/${encodeURIComponent(String(result.id))}/attachments/${encodeURIComponent(String(row.id))}`};});
  const proposals=this.#completion.filter(proposal=>proposal.entityId===version.entityId&&(proposal.baseRevision===version.revision||proposal.baseRevision+1===version.revision));
  if(proposals.length){const active=proposals.filter(proposal=>proposal.baseRevision===version.revision);result.completionRequested=active.length>0;
   const approved=new Map(proposals.flatMap(proposal=>proposal.approvals??[]).map(row=>[row.userId,row.createdAt]));
   result.approvals=(result.approvals as ObjectValue[]).map(row=>({...row,approvedAt:approved.get(String(row.userId))??null}));
  }
  return result;
 }
 #draft(kind:ProductKind,table:string,record:SharedContentRecord,related:Record<string,SharedContentRecord[]>={}):SharedRecordBody{
  return{format:'genesis-shared-record-v1',kind,scopeId:this.ports.binding.scopeId,scopeKind:this.ports.binding.kind,resourceId:this.ports.binding.resourceId,table,record,related,execution:'live'};
 }
 #body(kind:ProductKind,table:string,record:SharedContentRecord,related:Record<string,SharedContentRecord[]>={}){return validateSharedRecordBody(this.ports.binding,kind,this.#draft(kind,table,record,related));}
 #edit(body:SharedRecordBody,expectedRevision:number,action:ProductEdit['action']='update'):ProductEdit{return{action,entityId:sharedRecordKey(body.kind,body.record),kind:body.kind,expectedRevision,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),body:action==='delete'?null:body};}
 #find(versions:ProductVersion[],kind:ProductKind,id:string){const row=versions.find(value=>value.kind===kind&&value.entityId===`${kind}:${id}`);if(!row)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return row;}
 #tasks(versions:ProductVersion[],context:SharedLiveContext,filter:ObjectValue={}){
  const allowed=['projectIds','statusIds','assigneeIds','priority','labelIds','tags','q','from','to','dueFrom','dueTo','undated','completion','archived','includeArchived','parentTaskId','ids','createdBy','spaceId','sprintId','backlog','unscheduled','scheduled','approvalPending','customFields'];
  if(Object.keys(filter).some(key=>!allowed.includes(key)))throw new Error('E2EE_SHARED_FILTER_REVIEW_REQUIRED');
  return versions.filter(row=>row.kind==='task'&&!row.deleted).map(row=>this.#task(row,versions,context)).filter(row=>{
   for(const [key,field]of Object.entries({projectIds:'projectId',statusIds:'statusId',assigneeIds:'assigneeId',priority:'priority',ids:'id'}))if(filter[key]!==undefined){if(!Array.isArray(filter[key]))throw new Error('E2EE_SHARED_FILTER_INVALID');if((filter[key] as unknown[]).length&&!(filter[key] as unknown[]).includes(row[field]))return false;}
   if(filter.spaceId!==undefined&&filter.spaceId!==context.spaceId||filter.createdBy!==undefined&&filter.createdBy!==row.createdBy||Object.hasOwn(filter,'parentTaskId')&&filter.parentTaskId!==row.parentTaskId)return false;
   if(!filter.includeArchived&&!!row.archivedAt!==(filter.archived===true))return false;
   if(filter.completion==='open'&&row.completedAt||filter.completion==='completed'&&!row.completedAt)return false;
   if(filter.undated===true&&row.dueDate!==null)return false;
   if(Object.hasOwn(filter,'sprintId')&&(row.sprintId??null)!==filter.sprintId||filter.backlog===true&&row.sprintId!==null&&row.sprintId!==undefined)return false;
   const scheduledDate=typeof row.startDate==='string'||typeof row.dueDate==='string',scheduledTime=scheduledDate&&typeof row.startTime==='string'&&typeof row.endTime==='string';
   if(filter.unscheduled==='date'&&scheduledDate||filter.unscheduled==='time'&&scheduledTime||filter.scheduled==='date'&&!scheduledDate||filter.scheduled==='time'&&!scheduledTime)return false;
   if(filter.approvalPending===true&&(!row.approvalRequired||!!row.completedAt||!(row.approvals as ObjectValue[]).some(value=>!value.approvedAt)))return false;
   if(filter.customFields!==undefined&&!privateSharedCustomFieldMatch(row.customFields,filter.customFields))return false;
   for(const [key,lower]of [['from',true],['dueFrom',true],['to',false],['dueTo',false]] as const)if(filter[key]!==undefined&&(typeof filter[key]!=='string'||typeof row.dueDate!=='string'||(lower?row.dueDate<filter[key]:row.dueDate>filter[key])))return false;
   for(const [key,field]of [['labelIds','labelIds'],['tags','tags']] as const)if(filter[key]!==undefined){if(!Array.isArray(filter[key]))throw new Error('E2EE_SHARED_FILTER_INVALID');if(!(filter[key] as unknown[]).every(value=>(row[field] as unknown[]).includes(value)))return false;}
   if(filter.q!==undefined){if(typeof filter.q!=='string')throw new Error('E2EE_SHARED_FILTER_INVALID');const text=filter.q.trim().toLocaleLowerCase();if(text&&!`${row.title}\n${row.description}\n${(row.tags as string[]).join(' ')}`.toLocaleLowerCase().includes(text))return false;}
   return true;
  });
 }
 #page(tasks:ObjectValue[],url:URL){
  const cursor=url.searchParams.get('cursor');if(cursor)throw new Error('E2EE_SHARED_QUERY_REFRESH_REQUIRED');
  // A complete bounded local result has no server cursor whose meaning could
  // change under an unrelated plaintext query/index or leak private filters.
  return privateSharedTaskPage(tasks,url.searchParams.get('sort')??'position');
 }
 async #events(versions:ProductVersion[],context:SharedLiveContext){
  if(this.ports.binding.kind!=='project'||!this.ports.eventCache)throw new Error('E2EE_SHARED_HISTORY_READER_REQUIRED');
  if(!this.ports.online){const saved=await this.ports.eventCache.load();this.ports.current();if(!saved)throw new Error('E2EE_OFFLINE_CONTENT_UNAVAILABLE');return saved;}
  if(!this.ports.history||!this.ports.sourceTable)throw new Error('E2EE_SHARED_HISTORY_READER_REQUIRED');
  const old=await this.ports.sourceTable('shared_audit_events');this.ports.current();if(old.length>10000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');const events:ObjectValue[]=old.map(row=>({id:row.id,action:row.action,objectId:row.object_id,actorId:row.actor_id,createdAt:row.created_at,taskId:row.task_id,boardId:row.board_id,legacy:true}));
  for(const entity of versions){if(!['project','task','comment','project-comment','history'].includes(entity.kind))continue;let before=Number.MAX_SAFE_INTEGER,last=before;
   do{const page=await this.ports.history(entity.entityId,before);this.ports.current();if(page.origins.length!==page.versions.length)throw new Error('E2EE_PRODUCT_HISTORY_INVALID');
    for(const [at,version]of page.versions.entries()){const origin=page.origins[at];if(origin.entityId!==version.entityId||origin.revision!==version.revision||version.revision>=last)throw new Error('E2EE_PRODUCT_HISTORY_INVALID');last=version.revision;
     if(origin.bootstrap)continue;const body=version.deleted?null:plain(version),source=body?.record,time=source?.updated_at??source?.created_at;
     // A deletion's prior content remains in history, but a removed object is
     // never turned into a new navigable content preview.
     if(version.deleted)continue;if(typeof time!=='string'||!Number.isFinite(Date.parse(time)))throw new Error('E2EE_SHARED_DOMAIN_INVALID');
     if(version.kind==='history'){
      if(origin.action!=='create'||version.revision!==1||body?.table!=='shared_audit_events'||!['member.removed','member.role_changed'].includes(String(source!.action)))throw new Error('E2EE_PRODUCT_HISTORY_INVALID');
      events.push({id:source!.id,action:source!.action,objectId:source!.object_id,actorId:origin.actorId,initiatorId:source!.actor_id,createdAt:time,taskId:null,boardId:null,details:parse(source!.details_json),legacy:false});
      if(events.length>10000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');continue;
     }
     const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${this.ports.binding.scopeId}\0${version.entityId}\0${version.revision}\0${origin.operationId}`)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes.subarray(0,16),value=>value.toString(16).padStart(2,'0')).join(''),id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
     events.push({id,action:version.kind==='comment'?'comment.created':version.kind==='project-comment'?'project.comment_created':`${version.kind}.${origin.action==='create'?'created':origin.action==='complete'?'completed':'updated'}`,objectId:source!.id,actorId:origin.actorId,createdAt:time,taskId:version.kind==='task'?source!.id:source!.task_id??null,boardId:source!.board_id??null,legacy:false});
     if(events.length>10000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');
    }
    before=page.nextBefore??0;if(before&&before!==last)throw new Error('E2EE_PRODUCT_HISTORY_INVALID');
   }while(before);
  }
  const ids=new Set<string>();for(const event of events){assertTechnical(event.id);assertTechnical(event.objectId);if(event.actorId!==null)assertTechnical(event.actorId);if(ids.has(String(event.id))||typeof event.action!=='string'||typeof event.createdAt!=='string'||!Number.isFinite(Date.parse(event.createdAt)))throw new Error('E2EE_SHARED_DOMAIN_INVALID');ids.add(String(event.id));}
  await this.ports.eventCache.save(events);this.ports.current();return events;
 }
 async #get(path:string){const url=new URL(path,'https://private.invalid'),{context,versions}=await this.#snapshot(),segments=url.pathname.split('/').filter(Boolean),live=versions.filter(row=>!row.deleted);
  const list=(kind:ProductKind,table?:string)=>live.filter(row=>row.kind===kind&&(!table||plain(row).table===table)).map(row=>this.#row(row,context));
  if(segments.length===0){const root=this.#find(versions,this.ports.binding.kind,this.ports.binding.resourceId);
   if(this.ports.binding.kind==='space')return{space:this.#row(root,context),members:context.members,invitations:context.invitations};
   const raw=url.searchParams.get('filter'),filter=raw?parse(raw):{};object(filter);const page=await this.#page(this.#tasks(versions,context,filter),url);
   return{project:this.#row(root,context),statuses:list('status').filter(row=>row.isChaos!==1),categories:list('category','shared_project_categories'),tasks:page.tasks,taskPage:{total:page.total,hasMore:false,nextCursor:null},members:context.members,customFieldDefinitions:list('custom-field')};
  }
  if(segments[0]==='events'&&segments.length===1){const events=await this.#events(versions,context),project=this.#row(this.#find(versions,'project',this.ports.binding.resourceId),context),tasks=live.filter(row=>row.kind==='task').map(row=>this.#task(row,versions,context)),comments=live.filter(row=>row.kind==='comment').map(row=>this.#row(row,context));return{events,project,tasks,comments,members:context.members};}
  if(segments[0]==='tasks'){
   if(segments.length===1){const filter=parse(url.searchParams.get('filter')??'{}');object(filter);return this.#page(this.#tasks(versions,context,filter),url);}
   const task=this.#find(versions,'task',segments[1]);if(segments.length===2)return{task:this.#task(task,versions,context)};
   if(segments[2]==='comments')return{comments:live.filter(row=>row.kind==='comment'&&plain(row).record.task_id===segments[1]).map(row=>this.#row(row,context)),nextCursor:null,hasMore:false};
   if(segments[2]==='image'&&segments.length===3||segments[2]==='attachments'&&segments.length===4){
    if(!this.ports.readFile)throw new Error('E2EE_PRIVATE_FILE_UNAVAILABLE');const body=plain(task),row=segments[2]==='image'?body.related.shared_task_images?.[0]:body.related.shared_task_attachments?.find(row=>row.id===segments[3]);
    if(!row)throw new Error('E2EE_PRIVATE_FILE_UNAVAILABLE');const reference=sharedFileReference(row),file=await this.ports.readFile(reference);this.ports.current();
    try{if(file.bytes.length!==reference.size||file.filename!==reference.filename||file.mediaType!==reference.mediaType)throw new Error('E2EE_PRIVATE_FILE_CORRUPT');return{data:encodeE2eeBytes(file.bytes),size:reference.size,filename:file.filename,mediaType:file.mediaType};}finally{file.bytes.fill(0);}
   }
  }
  if(segments[0]==='workflow'){
   const saved=live.find(row=>row.kind==='workflow'),definition=saved?parse(plain(saved).record.definition_json):{statuses:[],transitions:[]};object(definition);
   if(segments[1]==='history'){
    if(!saved||!this.ports.history)throw new Error('E2EE_SHARED_HISTORY_READER_REQUIRED');const before=url.searchParams.has('before')?number(Number(url.searchParams.get('before'))):Number.MAX_SAFE_INTEGER;
    const page=await this.ports.history(saved.entityId,before);this.ports.current();return{versions:page.versions.filter(row=>!row.deleted).map(row=>{const body=plain(row),definition=parse(body.record.definition_json);object(definition);return{...definition,enabled:body.record.enabled===1,revision:row.revision,createdAt:body.record.updated_at,actorId:body.record.updated_by};}),nextCursor:page.nextBefore};
   }
   const statuses=list('status'),counts=Object.fromEntries(statuses.map(status=>[String(status.id),live.filter(row=>row.kind==='task'&&plain(row).record.status_id===status.id).length]));
   return{config:{...definition,enabled:saved?plain(saved).record.enabled===1:false,revision:saved?.revision??0},counts,context:{project:this.#row(this.#find(versions,'project',this.ports.binding.resourceId),context),statuses,customFieldDefinitions:list('custom-field')}};
  }
  if(segments[0]==='planning'&&segments.length===1){const saved=live.find(row=>row.kind==='planning'),raw=saved?plain(saved).record:null,tasks=live.filter(row=>row.kind==='task').map(row=>this.#task(row,versions,context)),totals:ObjectValue={},byAssignee:ObjectValue={};
   const summarize=(rows:ObjectValue[])=>({count:rows.length,completed:rows.filter(row=>row.completedAt!==null).length,points:{value:rows.reduce((sum,row)=>sum+(typeof row.storyPoints==='number'?row.storyPoints:0),0),unestimated:rows.filter(row=>row.storyPoints===null||row.storyPoints===undefined).length},hours:{value:rows.reduce((sum,row)=>sum+(typeof row.estimateHours==='number'?row.estimateHours:0),0),unestimated:rows.filter(row=>row.estimateHours===null||row.estimateHours===undefined).length}});
   const sprints=list('sprint');for(const id of ['backlog',...sprints.map(row=>String(row.id))]){const rows=tasks.filter(row=>(row.sprintId??'backlog')===id);totals[id]=summarize(rows);byAssignee[id]=Object.fromEntries([...new Set(rows.map(row=>String(row.assigneeId??'')))].map(userId=>[userId,summarize(rows.filter(row=>String(row.assigneeId??'')===userId))]));}
   return{config:{enabled:raw?.enabled===1,estimateUnit:raw?.estimate_unit??'points',revision:saved?.revision??0},sprints,totals,byAssignee,fingerprint:await this.#fingerprint(versions,null),context:{permissions:context.permissions}};
  }
  if(segments[0]==='automations'){const rules=list('automation').filter(row=>row.deleted===(url.searchParams.get('deleted')==='true'));
   if(segments.length===1)return{rules,nextCursor:null,canCreate:context.permissions.manageProjects,workerCompletedAt:null};
   if(segments.length===2){const rule=rules.find(row=>row.id===segments[1]);if(!rule)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return{rule};}
  }
  if(segments.length===3&&segments[2]==='history'&&['mindmaps','custom-fields','templates','tasks'].includes(segments[0])){
   if(!this.ports.history)throw new Error('E2EE_SHARED_HISTORY_READER_REQUIRED');const kinds:Record<string,ProductKind>={mindmaps:'mindmap','custom-fields':'custom-field',templates:'template',tasks:'task'},kind=kinds[segments[0]],entity=this.#find(versions,kind,segments[1]);
   const before=url.searchParams.has('before')?number(Number(url.searchParams.get('before'))):Number.MAX_SAFE_INTEGER,page=await this.ports.history(entity.entityId,before);this.ports.current();
   const history:ObjectValue[]=page.versions.map(row=>row.deleted?{id:segments[1],revision:row.revision,deleted:true}:{...(kind==='custom-field'?{field:this.#row(row,context)}:this.#row(row,context)),revision:row.revision});
   if(kind==='mindmap'&&page.nextBefore===null){if(!this.ports.sourceTable)throw new Error('E2EE_SHARED_HISTORY_READER_REQUIRED');const original=await this.ports.sourceTable('shared_mindmap_versions');this.ports.current();for(const row of original.filter(row=>row.map_id===segments[1]))history.push({id:segments[1],revision:Number(row.revision),document:validateMindmap(parse(row.content)),updatedAt:row.updated_at,schemaVersion:1,historyOrigin:'migration'});}
   return{versions:history,nextCursor:page.nextBefore};
  }
  if(segments[0]==='mindmaps'&&segments.length===1)return{maps:list('mindmap').map(row=>({...row,schemaVersion:1}))};
  const collections:Record<string,[ProductKind,string?]>={statuses:['status'],categories:['category','shared_project_categories'],labels:['label'],comments:['project-comment'],mindmaps:['mindmap'],'project-categories':['category','shared_space_project_categories'],'member-categories':['category','shared_member_categories'],'custom-fields':['custom-field'],templates:['template'],views:['view']};
  if(Object.hasOwn(collections,segments[0])){const [kind,table]=collections[segments[0]],rows=list(kind,table);return segments[1]?{[kind]:rows.find(row=>row.id===segments[1])??(()=>{throw new Error('E2EE_PRODUCT_ENTITY_MISSING');})()}:{[segments[0]==='project-categories'||segments[0]==='member-categories'?'categories':segments[0]]:rows};}
  throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
 }
 #newRecord(table:string,input:ObjectValue,context:SharedLiveContext,time:string,id:string):SharedContentRecord{
  const spec=catalogue.tables.find(row=>row.table===table);if(!spec)throw new Error('E2EE_SHARED_DOMAIN_INVALID');const row:SharedContentRecord={};
  for(const key of spec.columns){const name=camel(key);let value:unknown=null;
   if(key==='id')value=id;else if(key==='project_id')value=this.ports.binding.kind==='project'?this.ports.binding.resourceId:null;else if(key==='space_id')value=context.spaceId;
   else if(['created_by','updated_by','author_id','owner_id'].includes(key))value=this.ports.actorId;
   else if(key==='created_at'||key==='updated_at')value=time;else if(key==='revision')value=1;
   else if(key==='title'||key==='description'||key==='body')value='';else if(key==='position'||key==='priority'||key==='is_done'||key==='is_chaos')value=0;
   else if(key==='entry_type')value='task';else if(key==='color')value='#64748b';else if(key==='tags_json'||key==='checklists_json'||key==='mention_ids_json')value='[]';
   if(Object.hasOwn(input,name))value=input[name];row[key]=value as SharedContentRecord[string];
  }return row;
 }
 async #prepare(request:SavedRequest){
  const {context,versions}=await this.#snapshot(),parts=request.path.split('?')[0].split('/').filter(Boolean),input=request.body,edits:ProductEdit[]=[];let output:ObjectValue;
  if(parts[0]==='mindmaps'&&parts.length===2&&['PUT','DELETE'].includes(request.method)){
   assertTechnical(parts[1]);const old=versions.find(row=>row.kind==='mindmap'&&row.entityId===`mindmap:${parts[1]}`),expected=old?.revision??0;
   if(old?.deleted||number(input.expectedRevision)!==expected||request.method==='DELETE'&&!old)throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
   if(Object.keys(input).some(key=>!['expectedRevision','operationId','requestId','schemaVersion','document'].includes(key))||input.schemaVersion!==undefined&&![1,2].includes(Number(input.schemaVersion)))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
   const row:SharedContentRecord=old?structuredClone(plain(old).record):{space_id:context.spaceId,id:parts[1],revision:1,content:'',updated_at:request.createdAt,project_id:this.ports.binding.kind==='project'?this.ports.binding.resourceId:null};
   if(request.method==='PUT'){const document=validateMindmap(input.document);if(document.id!==parts[1]||document.projectId!==row.project_id)throw new Error('E2EE_SHARED_CROSS_SCOPE_REVIEW_REQUIRED');row.content=JSON.stringify(document);}
   row.revision=expected+1;row.updated_at=request.createdAt;const body=this.#body('mindmap','shared_mindmaps',row),edit=this.#edit(body,expected,request.method==='DELETE'?'delete':old?'update':'create');
   return{edits:[edit],result:request.method==='DELETE'?{ok:true}:{id:parts[1],revision:expected+1,updatedAt:request.createdAt}};
  }
  if(parts[0]==='custom-fields'&&parts.length===1&&request.method==='PUT'){
   const draft=this.#fieldInput(input),preview=await this.#fieldPreview(input,versions,context);if(preview.fingerprint!==input.fingerprint||preview.replaceType!==input.replaceType)throw new Error('E2EE_SHARED_PREVIEW_CHANGED');
   const old=versions.find(row=>!row.deleted&&row.kind==='custom-field'&&plain(row).record.id===draft.id),expected=old?.revision??0,replace=preview.replaceType,id=replace?crypto.randomUUID():String(draft.id);
   const row=this.#newRecord('shared_custom_fields',{},context,request.createdAt,id);row.project_id=draft.projectId as string|null;row.type=draft.type as string;row.definition_json=JSON.stringify({title:draft.title,options:draft.options});row.position=draft.position as number;
   for(const [name,column]of [['required','required'],['showCard','show_card'],['showList','show_list']])row[column]=draft[name]?1:0;
   row.archived_at=draft.archived?request.createdAt:null;row.predecessor_id=replace?String(draft.id):old?plain(old).record.predecessor_id:null;row.revision=replace?1:expected+1;if(old&&!replace){row.created_at=plain(old).record.created_at;row.created_by=plain(old).record.created_by;}
   const body=this.#body('custom-field','shared_custom_fields',row);if(replace&&old){const archived=structuredClone(plain(old));archived.record.archived_at=request.createdAt;archived.record.updated_at=request.createdAt;archived.record.revision=expected+1;edits.push(this.#edit(this.#body('custom-field',archived.table,archived.record),expected));}
   const edit=this.#edit(body,replace?0:expected,replace||!old?'create':'update');edits.push(edit);const version:ProductVersion={protocol:1,scopeId:this.ports.binding.scopeId,entityId:edit.entityId,kind:'custom-field',revision:replace?1:expected+1,parentId:edit.parentId,deleted:false,metadata:edit.metadata,body};
   return{edits,result:{field:this.#row(version,context),previousFieldId:replace?draft.id:null}};
  }
  if(parts[0]==='tasks'&&(parts.length===1||parts.length===2)){
   const create=parts.length===1&&request.method==='POST',old=create?null:this.#find(versions,'task',parts[1]),body=old?structuredClone(plain(old)):this.#draft('task','shared_tasks',this.#newRecord('shared_tasks',{},context,request.createdAt,crypto.randomUUID()),{shared_task_labels:[],shared_task_dependencies:[],shared_task_planning:[],shared_task_approvals:[],shared_task_reviews:[],shared_custom_field_values:[],shared_task_watchers:[]});
   const expected=old?.revision??0;if(old&&number(input.expectedRevision)!==expected)throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
   if(create&&input.mindmapSource!==undefined){exactKeys(input.mindmapSource,['mapId','nodeId']);assertTechnical(input.mindmapSource.mapId);assertTechnical(input.mindmapSource.nodeId);const source=input.mindmapSource;
    const converted=versions.find(row=>row.kind==='task'&&!row.deleted&&(plain(row).related.shared_mindmap_conversions??[]).some(reference=>reference.map_id===source.mapId&&reference.node_id===source.nodeId));
    if(converted)return{edits:[],result:{task:this.#task(converted,versions,context)}};
    const bytes=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`${this.ports.binding.scopeId}\0map-conversion\0${source.mapId}\0${source.nodeId}`)));bytes[6]=(bytes[6]&15)|80;bytes[8]=(bytes[8]&63)|128;const hex=Array.from(bytes.subarray(0,16),value=>value.toString(16).padStart(2,'0')).join('');body.record.id=`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
    body.related.shared_mindmap_conversions=[{space_id:context.spaceId,map_id:source.mapId,node_id:source.nodeId,project_id:this.ports.binding.resourceId,task_id:body.record.id}];
   }
   if(request.method==='DELETE'){
    if(versions.some(row=>!row.deleted&&row.parentId===old!.entityId))throw new Error('E2EE_SHARED_SUBTREE_REVIEW_REQUIRED');edits.push(this.#edit(body,expected,'delete'));output={ok:true,id:body.record.id};
   }else{
    const fields:Record<string,string>={title:'title',description:'description',statusId:'status_id',categoryId:'category_id',assigneeId:'assignee_id',dueDate:'due_date',startDate:'start_date',startTime:'start_time',endTime:'end_time',entryType:'entry_type',priority:'priority',parentTaskId:'parent_task_id',position:'position',archivedAt:'archived_at'};
    const allowed=[...Object.keys(fields),'tags','checklists','labelIds','dependsOnIds','approverIds','approvalRequired','customFields','sprintId','storyPoints','estimateHours','expectedRevision','requestId','completedAt','completedBy','imageData','attachments','removeAttachmentIds',...(create?['mindmapSource']:[])];
    if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
    for(const [name,column]of Object.entries(fields))if(Object.hasOwn(input,name))body.record[column]=input[name] as SharedContentRecord[string];
    for(const key of ['tags','checklists'] as const)if(Object.hasOwn(input,key))body.record[`${key}_json`]=JSON.stringify(input[key]);
    const taskId=body.record.id;
    for(const [key,table,column]of [['labelIds','shared_task_labels','label_id'],['dependsOnIds','shared_task_dependencies','predecessor_id']] as const)if(Object.hasOwn(input,key)){
     if(!Array.isArray(input[key]))throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.related[table]=(input[key] as unknown[]).map(value=>{assertTechnical(value);return{task_id:taskId,[column]:value};});
    }
    if(Object.hasOwn(input,'approverIds')){if(!Array.isArray(input.approverIds)||input.approverIds.length>200)throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.related.shared_task_approvals=input.approverIds.map(userId=>{assertTechnical(userId);return{id:crypto.randomUUID(),task_id:taskId,user_id:userId,approved_at:null};});}
    if(input.approvalRequired===false)body.related.shared_task_approvals=[];
    if(Object.hasOwn(input,'customFields')){object(input.customFields);body.related.shared_custom_field_values=Object.entries(input.customFields).map(([fieldId,value])=>{assertTechnical(fieldId);return{task_id:taskId,field_id:fieldId,value_json:JSON.stringify(value)};});}
    prepareSharedTaskFiles(body,input,request.id,request.createdAt);
    if(['sprintId','storyPoints','estimateHours'].some(key=>Object.hasOwn(input,key))){const previous=body.related.shared_task_planning?.[0],estimates=previous?parse(previous.estimates_json):{};object(estimates);for(const key of ['storyPoints','estimateHours'])if(Object.hasOwn(input,key))estimates[key]=input[key];body.related.shared_task_planning=[{task_id:taskId,sprint_id:Object.hasOwn(input,'sprintId')?input.sprintId as string|null:previous?.sprint_id??null,estimates_json:JSON.stringify(estimates)}];}
    const status=versions.find(row=>row.kind==='status'&&!row.deleted&&plain(row).record.id===body.record.status_id);if(!status)throw new Error('E2EE_PRODUCT_WORKFLOW_STATUS');const done=plain(status).record.is_done===1;
    body.record.completed_at=done?(body.record.completed_at??request.createdAt):null;body.record.completed_by=done?(body.record.completed_by??this.ports.actorId):null;
    body.record.updated_at=request.createdAt;body.record.updated_by=this.ports.actorId;body.record.revision=expected+1;
    const validated=this.#body('task',body.table,body.record,body.related);edits.push(this.#edit(validated,expected,done&&(validated.related.shared_task_approvals??[]).length?'propose-complete':create?'create':'update'));
    const version:ProductVersion={protocol:1,scopeId:this.ports.binding.scopeId,entityId:sharedRecordKey('task',body.record),kind:'task',revision:expected+1,parentId:sharedBodyParent(validated),deleted:false,metadata:sharedBodyMetadata(validated),body:validated};
    if(edits[0].action==='propose-complete'){if(!old)throw new Error('E2EE_PRODUCT_APPROVAL_REQUIRES_EXISTING_TASK');edits[0].proposalId=crypto.randomUUID();output={task:this.#task(old,versions,context),completionRequested:true,proposalId:edits[0].proposalId};}
    else output={task:this.#task(version,versions,context)};
   }
  }else if(parts[0]==='tasks'&&parts[2]==='comments'&&parts.length===3&&request.method==='POST'){
   this.#find(versions,'task',parts[1]);if(Object.keys(input).some(key=>!['body','mentionIds','requestId'].includes(key)))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');const mentionIds=input.mentionIds??[];if(!Array.isArray(mentionIds)||mentionIds.length>200)throw new Error('E2EE_SHARED_DOMAIN_INVALID');
   const row=this.#newRecord('shared_comments',{body:input.body},context,request.createdAt,crypto.randomUUID());row.task_id=parts[1];const body=this.#body('comment','shared_comments',row,{shared_comment_mentions:mentionIds.map(userId=>{assertTechnical(userId);return{comment_id:row.id,user_id:userId};})});edits.push(this.#edit(body,0,'create'));
   output={comment:this.#row({protocol:1,scopeId:this.ports.binding.scopeId,entityId:sharedRecordKey('comment',row),kind:'comment',revision:1,parentId:sharedBodyParent(body),deleted:false,metadata:sharedBodyMetadata(body),body},context)};
  }else{
   const singletons:Record<string,[ProductKind,string]>={workflow:['workflow','shared_project_workflows'],planning:['planning','shared_project_planning']};
   const collections:Record<string,[ProductKind,string]>={statuses:['status','shared_project_statuses'],categories:['category','shared_project_categories'],labels:['label','shared_space_labels'],'project-categories':['category','shared_space_project_categories'],comments:['project-comment','shared_project_comments'],automations:['automation','shared_automation_rules'],templates:['template','shared_templates'],mindmaps:['mindmap','shared_mindmaps'],views:['view','shared_saved_views']};
   if(parts[0]==='planning'&&parts[1]==='sprints')return this.#prepareSprint(request,context,versions);
   const singleton=parts.length===1?singletons[parts[0]]:undefined;
   const root=parts.length===0,descriptor=root?[this.ports.binding.kind,this.ports.binding.kind==='project'?'shared_projects':'shared_spaces'] as [ProductKind,string]:collections[parts[0]];
   if(!descriptor&&!singleton||parts.length>2)throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');const [kind,table]=(singleton??descriptor)!;
   const singletonOld=singleton?versions.find(row=>row.kind===kind&&row.entityId===`${kind}:${this.ports.binding.resourceId}`):undefined;
   const create=singleton?!singletonOld:!root&&parts.length===1&&request.method==='POST',old=singleton?singletonOld??null:create?null:this.#find(versions,kind,root?this.ports.binding.resourceId:parts[1]);
   if(old&&plain(old).table!==table)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const expected=old?.revision??0;if(old&&number(input.expectedRevision)!==expected)throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
   const body=old?structuredClone(plain(old)):this.#draft(kind,table,this.#newRecord(table,{},context,request.createdAt,crypto.randomUUID()));
   if(singleton)body.record.project_id=this.ports.binding.resourceId;
   if(['workflow','planning','automation','template','mindmap','project-comment','view'].includes(kind)){
    return this.#prepareAdvancedRecord(request,context,versions,body,expected,create);
   }
   const fields:Record<string,string>={title:'title',description:'description',color:'color',layout:'layout',parentId:'parent_id',boardStatusId:'board_status_id',categoryId:'category_id',imageUrl:'image_url',isDone:'is_done',taskTitleLines:'task_title_lines',visibleTaskCount:'visible_task_count'};
   if(Object.keys(input).some(key=>!Object.hasOwn(fields,key)&&!['tags','labelIds','expectedRevision','requestId',...(kind==='space'?['coverImage','coverPosition']:[])].includes(key)))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
   for(const [name,column]of Object.entries(fields))if(Object.hasOwn(input,name)){if(!Object.hasOwn(body.record,column))throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.record[column]=name==='isDone'?(input[name]===true?1:0):input[name] as SharedContentRecord[string];}
   if(kind==='space'){
    if(Object.hasOwn(input,'coverImage')){if(typeof input.coverImage!=='string'||input.coverImage.length>4*1024*1024||input.coverImage!==''&&!/^data:image\/(?:png|jpeg|webp);base64,/.test(input.coverImage))throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.record.cover_image=input.coverImage;}
    if(Object.hasOwn(input,'coverPosition')){exactKeys(input.coverPosition,['x','y']);for(const axis of ['x','y'] as const){const value=input.coverPosition[axis];if(typeof value!=='number'||!Number.isFinite(value)||value<0||value>100)throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.record[`cover_${axis}`]=value;}}
   }
   if(Object.hasOwn(input,'labelIds')){if(kind!=='project'||!Array.isArray(input.labelIds)||input.labelIds.length>50||new Set(input.labelIds).size!==input.labelIds.length)throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.related.shared_project_labels=input.labelIds.map(id=>{assertTechnical(id);return{project_id:body.record.id,label_id:id};});}
   if(Object.hasOwn(input,'tags'))body.record.tags_json=JSON.stringify(input.tags);if(Object.hasOwn(body.record,'updated_at'))body.record.updated_at=request.createdAt;if(Object.hasOwn(body.record,'revision'))body.record.revision=expected+1;
   if(request.method==='DELETE'&&versions.some(row=>!row.deleted&&(row.parentId===old!.entityId||row.kind==='task'&&plain(row).record.status_id===body.record.id)))throw new Error('E2EE_SHARED_SUBTREE_REVIEW_REQUIRED');
   const validated=this.#body(kind,table,body.record,body.related);edits.push(this.#edit(validated,expected,request.method==='DELETE'?'delete':create?'create':'update'));
   output=request.method==='DELETE'?{ok:true}:{[kind]:this.#row({protocol:1,scopeId:this.ports.binding.scopeId,entityId:sharedRecordKey(kind,body.record),kind,revision:expected+1,parentId:sharedBodyParent(validated),deleted:false,metadata:sharedBodyMetadata(validated),body:validated},context)};
  }
  return{edits,result:output};
 }
 #prepareAdvancedRecord(request:SavedRequest,context:SharedLiveContext,versions:ProductVersion[],body:SharedRecordBody,expected:number,create:boolean){
  const {kind}=body,input=request.body,fields:Record<string,string>=kind==='automation'?{title:'title',definition:'definition_json',enabled:'enabled',deleted:'deleted_at'}:kind==='template'?{title:'title',manifest:'manifest_json',notices:'source_notices_json',deleted:'deleted_at'}:kind==='mindmap'?{document:'content'}:kind==='view'?{visibility:'visibility',definition:'payload'}:kind==='workflow'?{enabled:'enabled',statuses:'definition_json',transitions:'definition_json'}:kind==='planning'?{enabled:'enabled',estimateUnit:'estimate_unit'}:{body:'body',mentionIds:'mention_ids_json',boardId:'board_id'};
  const allowed=[...Object.keys(fields),'expectedRevision','requestId','operationId',...(kind==='template'?['projectId']:[])];if(Object.keys(input).some(key=>!allowed.includes(key)))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
  if(!['POST','PATCH','PUT','DELETE'].includes(request.method)||create&&!['POST','PUT'].includes(request.method)||request.method==='DELETE'&&['workflow','planning'].includes(kind))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
  if(kind==='workflow'){
   const before=create?{statuses:[],transitions:[]}:parse(body.record.definition_json);object(before);body.record.definition_json=JSON.stringify({statuses:input.statuses??before.statuses,transitions:input.transitions??before.transitions});
   body.record.enabled=Object.hasOwn(input,'enabled')?(input.enabled===true?1:input.enabled===false?0:(()=>{throw new Error('E2EE_SHARED_DOMAIN_INVALID');})()):body.record.enabled;
  }else for(const [name,column]of Object.entries(fields))if(Object.hasOwn(input,name)){
   if(name==='enabled'){if(typeof input[name]!=='boolean')throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.record[column]=input[name]?1:0;}
   else if(name==='deleted'){if(typeof input[name]!=='boolean')throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.record[column]=input[name]?request.createdAt:null;}
   else if(column.endsWith('_json')||column==='payload'||column==='content')body.record[column]=JSON.stringify(input[name]);
   else body.record[column]=input[name] as SharedContentRecord[string];
  }
  if(kind==='automation'){
   if(create){body.record.enabled=body.record.enabled??0;body.record.deleted_at=null;body.record.owner_id=this.ports.actorId;}
  }
  if(kind==='template'){
   const manifest=parse(body.record.manifest_json);object(manifest);if(!Array.isArray(manifest.projects)||!Array.isArray(manifest.tasks))throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.record.kind=manifest.kind as string;body.record.project_count=manifest.projects.length;body.record.task_count=manifest.tasks.length;
   body.record.source_notices_json=body.record.source_notices_json??'[]';if(create)body.record.deleted_at=null;
   if(Object.hasOwn(input,'projectId')){if(input.projectId!==null&&input.projectId!==this.ports.binding.resourceId||input.projectId!==null&&this.ports.binding.kind!=='project')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');body.record.project_id=input.projectId as string|null;}
  }
  if(kind==='mindmap'){const document=validateMindmap(parse(body.record.content));if(create)body.record.id=document.id;if(document.id!==body.record.id||document.projectId!==(this.ports.binding.kind==='project'?this.ports.binding.resourceId:null))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');}
  if(kind==='view'){const definition=parse(body.record.payload);object(definition);if(input.visibility!=='shared'&&create)throw new Error('E2EE_PERSONAL_VIEW_STORE_REQUIRED');if(create)body.record.deleted_at=null;}
  if(kind==='planning'&&!['points','hours'].includes(String(body.record.estimate_unit)))throw new Error('E2EE_SHARED_DOMAIN_INVALID');
  if(Object.hasOwn(body.record,'revision'))body.record.revision=expected+1;if(Object.hasOwn(body.record,'updated_at'))body.record.updated_at=request.createdAt;if(Object.hasOwn(body.record,'updated_by'))body.record.updated_by=this.ports.actorId;
  const validated=this.#body(kind,body.table,body.record,body.related),edit=this.#edit(validated,expected,request.method==='DELETE'?'delete':create?'create':'update'),version:ProductVersion={protocol:1,scopeId:this.ports.binding.scopeId,entityId:edit.entityId,kind,revision:expected+1,parentId:edit.parentId,deleted:request.method==='DELETE',metadata:edit.metadata,body:edit.body};
  let result:ObjectValue=request.method==='DELETE'?{ok:true}:{[kind==='automation'?'rule':kind==='project-comment'?'comment':kind==='mindmap'?'map':kind]:this.#row(version,context)};
  if(kind==='template')result={id:body.record.id,revision:expected+1,deleted:body.record.deleted_at!==null};
  if(kind==='workflow'){const definition=parse(body.record.definition_json);object(definition);result={config:{...definition,enabled:body.record.enabled===1,revision:expected+1},counts:Object.fromEntries(versions.filter(row=>row.kind==='status'&&!row.deleted).map(row=>[String(plain(row).record.id),versions.filter(task=>!task.deleted&&task.kind==='task'&&plain(task).record.status_id===plain(row).record.id).length]))};}
  if(kind==='planning')result={config:{enabled:body.record.enabled===1,estimateUnit:body.record.estimate_unit,revision:expected+1}};
  return{edits:[edit],result};
 }
 async #prepareSprint(request:SavedRequest,context:SharedLiveContext,versions:ProductVersion[]){
  const parts=request.path.split('?')[0].split('/').filter(Boolean),input=request.body,transition=parts[3]==='transition',create=parts.length===2&&request.method==='POST';
  if(!create&&parts.length!==3&&!(transition&&parts.length===4))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
  if(transition&&request.method!=='POST'||!transition&&!['POST','PATCH'].includes(request.method))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
  const old=create?null:this.#find(versions,'sprint',parts[2]),expected=old?.revision??0;if(number(input.expectedRevision)!==expected)throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
  const body=old?structuredClone(plain(old)):this.#draft('sprint','shared_sprints',this.#newRecord('shared_sprints',{},context,request.createdAt,crypto.randomUUID())),edits:ProductEdit[]=[];
  if(create){body.record.state='planning';body.record.estimate_unit=null;body.record.started_at=null;body.record.completed_at=null;}
  if(transition){
   if(input.fingerprint!==await this.#fingerprint(versions,null)||!['start','complete'].includes(String(input.action)))throw new Error('E2EE_SHARED_PREVIEW_CHANGED');
   if(input.action==='start'){if(body.record.state!=='planning'||versions.some(row=>!row.deleted&&row.kind==='sprint'&&plain(row).record.state==='active'))throw new Error('PLANNING_ACTIVE_SPRINT');body.record.state='active';body.record.started_at=request.createdAt;
    const config=versions.find(row=>row.kind==='planning'&&!row.deleted);if(!config||plain(config).record.enabled!==1)throw new Error('PLANNING_DISABLED');body.record.estimate_unit=plain(config).record.estimate_unit;
   }else{if(body.record.state!=='active'||!Array.isArray(input.outcomes))throw new Error('SPRINT_OUTCOMES_REQUIRED');const affected=versions.filter(row=>!row.deleted&&row.kind==='task'&&(plain(row).related.shared_task_planning??[]).some(plan=>plan.sprint_id===body.record.id)&&plain(row).record.completed_at===null),outcomes=input.outcomes;
    if(outcomes.length!==affected.length||new Set(outcomes.map(row=>{object(row);return row.taskId;})).size!==affected.length)throw new Error('SPRINT_OUTCOMES_REQUIRED');
    for(const task of affected){const change=outcomes.find(row=>{object(row);return row.taskId===plain(task).record.id;});if(!change)throw new Error('SPRINT_OUTCOMES_REQUIRED');object(change);if(change.expectedRevision!==task.revision)throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
     if(change.destinationSprintId!==null&&!versions.some(row=>!row.deleted&&row.kind==='sprint'&&plain(row).record.id===change.destinationSprintId&&plain(row).record.state!=='completed'&&plain(row).record.id!==body.record.id))throw new Error('SPRINT_STATE_INVALID');
     const value=structuredClone(plain(task));value.related.shared_task_planning[0].sprint_id=change.destinationSprintId as string|null;value.record.updated_at=request.createdAt;value.record.updated_by=this.ports.actorId;value.record.revision=task.revision+1;edits.push(this.#edit(this.#body('task',value.table,value.record,value.related),task.revision));
    }body.record.state='completed';body.record.completed_at=request.createdAt;
   }
  }else{
   if(body.record.state==='completed')throw new Error('SPRINT_COMPLETED');if(Object.keys(input).some(key=>!['title','goal','startDate','endDate','calendarMode','calendarContext','expectedRevision','requestId'].includes(key)))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
   const content=create?{}:parse(body.record.content_json);object(content);for(const name of ['title','goal','calendarMode','calendarContext'])if(Object.hasOwn(input,name))content[name]=input[name];
   if(typeof content.title!=='string'||!content.title.trim()||content.title.length>2000||typeof content.goal!=='string'||content.goal.length>100000||!['profane','sacred','lunar'].includes(String(content.calendarMode)))throw new Error('E2EE_SHARED_DOMAIN_INVALID');calendarContext(content.calendarContext as Parameters<typeof calendarContext>[0]);body.record.content_json=JSON.stringify(content);
   for(const [name,column]of [['startDate','start_date'],['endDate','end_date']])if(Object.hasOwn(input,name)){if(typeof input[name]!=='string'||!isCivilDate(input[name]))throw new Error('SPRINT_DATES_INVALID');body.record[column]=input[name];}
  }
  body.record.updated_at=request.createdAt;body.record.revision=expected+1;const validated=this.#body('sprint',body.table,body.record,body.related),edit=this.#edit(validated,expected,create?'create':'update');edits.push(edit);if(edits.length>100)throw new Error('E2EE_PRODUCT_BATCH_INVALID');
  return{edits,result:{sprint:this.#row({protocol:1,scopeId:this.ports.binding.scopeId,entityId:edit.entityId,kind:'sprint',revision:expected+1,parentId:edit.parentId,deleted:false,metadata:edit.metadata,body:validated},context)}};
 }
 async #execute(method:string,path:string,held:ObjectValue,intentId?:string){
  if(method==='GET')return this.#get(path);
  const segments=path.split('?')[0].split('/').filter(Boolean);
  if(method==='POST'&&segments.length===3&&segments[0]==='tasks'&&segments[2]==='approval-preview'){
   if(!this.ports.online||!this.ports.approvalPreview)throw new Error('E2EE_ONLINE_REQUIRED');const {context,versions}=await this.#snapshot(),task=this.#find(versions,'task',segments[1]),proposals=await this.ports.approvalPreview(task.entityId);this.ports.current();
   return{current:this.#task(task,versions,context),proposals:proposals.map(row=>({...row,task:this.#task(row.version,versions,context)}))};
  }
  if(method==='POST'&&segments.length===3&&segments[0]==='tasks'&&segments[2]==='approve'){
   if(!this.ports.online||!this.ports.approve)throw new Error('E2EE_ONLINE_REQUIRED');exactKeys(held,['review','requestId']);assertTechnical(held.requestId);exactKeys(held.review,['proposalId','payloadHash','version']);
   const review=held.review as {proposalId:string;payloadHash:string;version:ProductVersion};if(review.version.entityId!==`task:${segments[1]}`||review.version.scopeId!==this.ports.binding.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
   await this.ports.approve(review,held.requestId);this.ports.current();const {context,versions}=await this.#snapshot();return{task:this.#task(this.#find(versions,'task',segments[1]),versions,context)};
  }
  if(method==='POST'&&path.split('?')[0]==='custom-fields/preview'){const {context,versions}=await this.#snapshot();return this.#fieldPreview(held,versions,context);}
  if(!['POST','PATCH','PUT','DELETE'].includes(method))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
  const id=intentId??(typeof held.operationId==='string'?held.operationId:typeof held.requestId==='string'?held.requestId:crypto.randomUUID());assertTechnical(id);let saved=await this.ports.loadRequest(id),request:SavedRequest;
  if(intentId&&!saved)throw new Error('E2EE_SHARED_REQUEST_MISSING');
  if(saved){request=validateSharedLiveRequest(this.ports.binding,saved.value);if(request.method!==method||request.path!==path||!samePrivateJson(request.body,held))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}
  else{request={protocol:1,scopeId:this.ports.binding.scopeId,id,method,path,body:held,createdAt:new Date().toISOString(),edits:null,result:null,complete:false};saved={value:request,serial:await this.ports.saveRequest(request,null)};}
  if(request.complete){if(!request.result||!request.edits)throw new Error('E2EE_SHARED_REQUEST_INVALID');return structuredClone(request.result);}
  const membership=membershipOperationForSharedRequest(this.ports.binding,method,path,held);
  if(membership){if(!this.ports.online||!this.ports.membership)throw new Error('E2EE_MEMBERSHIP_REVIEW_REQUIRED');
   const result=await this.ports.membership(membership,id);this.ports.current();await this.ports.saveRequest({...request,edits:[],result,complete:true},saved.serial);this.ports.current();return result;
  }
  if(!request.edits){const prepared=await this.#prepare(request);request={...request,...prepared};saved={value:request,serial:await this.ports.saveRequest(request,saved.serial)};}
  if(request.edits!.length===0){const taskId=(request.result?.task as ObjectValue|undefined)?.id;if(typeof taskId!=='string')throw new Error('E2EE_SHARED_REQUEST_INVALID');const {context,versions}=await this.#snapshot(),task=this.#find(versions,'task',taskId),result={task:this.#task(task,versions,context)};
   if(this.#pendingEntities.has(task.entityId))return{task:{...result.task,pending:true},pending:true};await this.ports.saveRequest({...request,result,complete:true},saved.serial);this.ports.current();return result;
  }
  for(const edit of request.edits!)if(edit.kind==='task'&&edit.body!==null){const uploads=sharedRequestFileInputs(edit.body as SharedRecordBody,request.body,id);
   try{for(const upload of uploads){if(!this.ports.stageFile)throw new Error('E2EE_PRIVATE_FILE_UNAVAILABLE');await this.ports.stageFile(upload.reference,upload.bytes);this.ports.current();}}finally{uploads.forEach(upload=>upload.bytes.fill(0));}
  }
  await this.ports.stage(request.edits!,id);this.ports.current();
  if(!this.ports.online){const result=structuredClone(request.result!);for(const key of ['task','comment','project','space','status','category','label'])if(result[key]&&typeof result[key]==='object')result[key]={...(result[key] as ObjectValue),pending:true};return{...result,pending:true};}
  await this.ports.flush(id);this.ports.current();
  await this.ports.saveRequest({...request,complete:true},saved.serial);this.ports.current();
  return structuredClone(request.result!);
 }
 request(method:string,path:string,body:ObjectValue={}){const held=structuredClone(body);return this.#run(()=>this.#execute(method,path,held));}
 resume(id:string){assertTechnical(id);return this.#run(async()=>{const saved=await this.ports.loadRequest(id);if(!saved)throw new Error('E2EE_SHARED_REQUEST_MISSING');const value=validateSharedLiveRequest(this.ports.binding,saved.value);return this.#execute(value.method,value.path,structuredClone(value.body),id);});}
}
