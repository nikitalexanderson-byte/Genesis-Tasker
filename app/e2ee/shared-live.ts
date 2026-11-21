import catalogue from '../../contracts/e2ee/private-path-sources-v1.json' with {type:'json'};
import {sharedBodyMetadata,sharedBodyParent,sharedRecordKey,validateSharedRecordBody,type SharedDomainBinding,type SharedRecordBody,type SharedContentRecord} from './shared-domain.ts';
import {samePrivateJson} from './product-json.ts';
import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import type {ProductEdit,ProductVersion} from './shared-product.ts';
import type {ProductKind} from './product-contract.ts';

type ObjectValue=Record<string,unknown>;
export type SharedLiveContext={ownerId:string;spaceId:string;role:string;spaceRole:string;permissions:Record<string,boolean>;members:ObjectValue[];invitations:ObjectValue[]};
export type SavedSharedRequest={protocol:1;scopeId:string;id:string;method:string;path:string;body:ObjectValue;createdAt:string;edits:ProductEdit[]|null;result:ObjectValue|null;complete:boolean};
type SavedRequest=SavedSharedRequest;
export interface SharedLivePorts{
 binding:SharedDomainBinding;actorId:string;online:boolean;current:()=>void;
 context:()=>Promise<SharedLiveContext>;versions:()=>Promise<ProductVersion[]>;
 stage:(edits:ProductEdit[],intentId:string)=>Promise<string>;flush:(intentId:string)=>Promise<unknown>;
 loadRequest:(id:string)=>Promise<{value:SavedRequest;serial:number}|null>;
 saveRequest:(value:SavedRequest,expected:number|null)=>Promise<number>;
}
const camel=(key:string)=>key.replace(/_([a-z])/g,(_,letter:string)=>letter.toUpperCase());
function object(value:unknown):asserts value is ObjectValue{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_SHARED_DOMAIN_INVALID');}
function parse(value:unknown){if(typeof value!=='string')throw new Error('E2EE_SHARED_DOMAIN_INVALID');return parseLegacyMigrationJson(value,'E2EE_SHARED_DOMAIN_INVALID',16*1024*1024);}
function number(value:unknown){if(!Number.isSafeInteger(value)||Number(value)<0)throw new Error('E2EE_INVALID_REVISION');return value as number;}
function plain(version:ProductVersion):SharedRecordBody{if(version.deleted||!version.body)throw new Error('E2EE_PRODUCT_DELETED');return version.body as SharedRecordBody;}
export function validateSharedLiveRequest(binding:SharedDomainBinding,input:unknown):SavedRequest{
 exactKeys(input,['protocol','scopeId','id','method','path','body','createdAt','edits','result','complete']);assertTechnical(input.id);
 if(input.protocol!==1||input.scopeId!==binding.scopeId||!['POST','PATCH','PUT','DELETE'].includes(String(input.method))||typeof input.path!=='string'||input.path.length>2048
  ||typeof input.complete!=='boolean'||typeof input.createdAt!=='string'||!Number.isFinite(Date.parse(input.createdAt))||input.edits!==null&&(!Array.isArray(input.edits)||input.edits.length<1||input.edits.length>100))throw new Error('E2EE_SHARED_REQUEST_INVALID');
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
 constructor(private readonly ports:SharedLivePorts){}
 #run<T>(work:()=>Promise<T>){const task=this.#serial.catch(()=>undefined).then(async()=>{this.ports.current();return work();});this.#serial=task;return task;}
 async #snapshot(){const context=await this.ports.context();this.ports.current();const versions=await this.ports.versions();this.ports.current();
  if(context.ownerId.length<1||context.spaceId.length<1||!Array.isArray(context.members)||!Array.isArray(context.invitations))throw new Error('E2EE_SHARED_CONTEXT_INVALID');
  for(const row of versions){if(row.scopeId!==this.ports.binding.scopeId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');if(!row.deleted)validateSharedRecordBody(this.ports.binding,row.kind,row.body,row);}
  return{context,versions};
 }
 #row(version:ProductVersion,context:SharedLiveContext):ObjectValue{
  const body=plain(version),source=body.record,result:ObjectValue={};
  for(const [key,value]of Object.entries(source)){
   if(key.endsWith('_json')){result[camel(key.slice(0,-5))]=value===null?null:parse(value);}
   else if(key!=='content'&&key!=='payload'&&key!=='file')result[camel(key)]=value;
  }
  result.revision=version.revision;
  if(body.kind==='project'||body.kind==='space')Object.assign(result,{role:context.role,spaceRole:context.spaceRole,permissions:structuredClone(context.permissions),canOrganizeTasks:context.permissions.organizeTasks===true,canCreateBoards:context.permissions.manageProjects===true});
  if(body.kind==='status'){result.isDone=source.is_done;result.taskTitleLines=source.task_title_lines??(source.is_done===1?2:0);result.visibleTaskCount=source.visible_task_count??(source.is_done===1?5:0);}
  if(body.kind==='task'){
   const related=body.related;
   result.labelIds=(related.shared_task_labels??[]).map(row=>row.label_id);result.dependsOnIds=(related.shared_task_dependencies??[]).map(row=>row.predecessor_id);
   result.approvals=(related.shared_task_approvals??[]).map(row=>({userId:row.user_id,displayName:String(context.members.find(member=>member.userId===row.user_id)?.displayName??''),approvedAt:row.approved_at}));
   result.approvalRequired=(result.approvals as unknown[]).length>0;
   result.customFields=Object.fromEntries((related.shared_custom_field_values??[]).map(row=>[String(row.field_id),parse(row.value_json)]));
   const planning=related.shared_task_planning??[];if(planning.length>1)throw new Error('E2EE_SHARED_DOMAIN_INVALID');
   if(planning[0]){const estimates=parse(planning[0].estimates_json);object(estimates);Object.assign(result,estimates,{sprintId:planning[0].sprint_id});}
   // Historical approvals/reviews are display-only. Fresh completion still
   // requires product proposals and each approver's exact signed version.
   result.review={enabled:false,allowed:{checked:false,confirmed:false,deletable:false},entries:(related.shared_task_reviews??[]).map(row=>({kind:row.kind,userId:row.user_id,displayName:String(context.members.find(member=>member.userId===row.user_id)?.displayName??''),reviewedAt:row.reviewed_at}))};
  }
  if(body.kind==='comment'){result.mentionIds=(body.related.shared_comment_mentions??[]).map(row=>row.user_id);result.authorName=String(context.members.find(member=>member.userId===source.author_id)?.displayName??'');}
  if(body.kind==='mindmap')result.document=parse(source.content);
  if(body.kind==='category'&&body.table==='shared_member_categories')result.permissions=parse(source.permissions_json);
  return result;
 }
 #task(version:ProductVersion,versions:ProductVersion[],context:SharedLiveContext){
  const result=this.#row(version,context),children=versions.filter(row=>!row.deleted&&row.kind==='task'&&plain(row).record.parent_task_id===result.id);
  result.childCount=children.length;result.completedChildCount=children.filter(row=>plain(row).record.completed_at!==null).length;
  result.spaceId=context.spaceId;const project=versions.find(row=>row.kind==='project'&&!row.deleted);if(project){result.projectTitle=plain(project).record.title;result.isInbox=plain(project).record.is_inbox;}
  return result;
 }
 #draft(kind:ProductKind,table:string,record:SharedContentRecord,related:Record<string,SharedContentRecord[]>={}):SharedRecordBody{
  return{format:'genesis-shared-record-v1',kind,scopeId:this.ports.binding.scopeId,scopeKind:this.ports.binding.kind,resourceId:this.ports.binding.resourceId,table,record,related,execution:'live'};
 }
 #body(kind:ProductKind,table:string,record:SharedContentRecord,related:Record<string,SharedContentRecord[]>={}){return validateSharedRecordBody(this.ports.binding,kind,this.#draft(kind,table,record,related));}
 #edit(body:SharedRecordBody,expectedRevision:number,action:ProductEdit['action']='update'):ProductEdit{return{action,entityId:sharedRecordKey(body.kind,body.record),kind:body.kind,expectedRevision,parentId:sharedBodyParent(body),metadata:sharedBodyMetadata(body),body:action==='delete'?null:body};}
 #find(versions:ProductVersion[],kind:ProductKind,id:string){const row=versions.find(value=>value.kind===kind&&value.entityId===`${kind}:${id}`);if(!row)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return row;}
 #tasks(versions:ProductVersion[],context:SharedLiveContext,filter:ObjectValue={}){
  const allowed=['projectIds','statusIds','assigneeIds','priority','labelIds','tags','q','from','to','dueFrom','dueTo','undated','completion','archived','includeArchived','parentTaskId','ids','createdBy','spaceId'];
  if(Object.keys(filter).some(key=>!allowed.includes(key)))throw new Error('E2EE_SHARED_FILTER_REVIEW_REQUIRED');
  return versions.filter(row=>row.kind==='task'&&!row.deleted).map(row=>this.#task(row,versions,context)).filter(row=>{
   for(const [key,field]of Object.entries({projectIds:'projectId',statusIds:'statusId',assigneeIds:'assigneeId',priority:'priority',ids:'id'}))if(filter[key]!==undefined){if(!Array.isArray(filter[key]))throw new Error('E2EE_SHARED_FILTER_INVALID');if((filter[key] as unknown[]).length&&!(filter[key] as unknown[]).includes(row[field]))return false;}
   if(filter.spaceId!==undefined&&filter.spaceId!==context.spaceId||filter.createdBy!==undefined&&filter.createdBy!==row.createdBy||Object.hasOwn(filter,'parentTaskId')&&filter.parentTaskId!==row.parentTaskId)return false;
   if(!filter.includeArchived&&!!row.archivedAt!==(filter.archived===true))return false;
   if(filter.completion==='open'&&row.completedAt||filter.completion==='completed'&&!row.completedAt)return false;
   if(filter.undated===true&&row.dueDate!==null)return false;
   for(const [key,lower]of [['from',true],['dueFrom',true],['to',false],['dueTo',false]] as const)if(filter[key]!==undefined&&(typeof filter[key]!=='string'||typeof row.dueDate!=='string'||(lower?row.dueDate<filter[key]:row.dueDate>filter[key])))return false;
   for(const [key,field]of [['labelIds','labelIds'],['tags','tags']] as const)if(filter[key]!==undefined){if(!Array.isArray(filter[key]))throw new Error('E2EE_SHARED_FILTER_INVALID');if(!(filter[key] as unknown[]).every(value=>(row[field] as unknown[]).includes(value)))return false;}
   if(filter.q!==undefined){if(typeof filter.q!=='string')throw new Error('E2EE_SHARED_FILTER_INVALID');const text=filter.q.trim().toLocaleLowerCase();if(text&&!`${row.title}\n${row.description}\n${(row.tags as string[]).join(' ')}`.toLocaleLowerCase().includes(text))return false;}
   return true;
  });
 }
 #page(tasks:ObjectValue[],url:URL){
  const sort=url.searchParams.get('sort')??'position',sorts:Record<string,{field:string;direction:number}>={position:{field:'position',direction:1},dueDate:{field:'dueDate',direction:1},priority:{field:'priority',direction:-1},updatedAt:{field:'updatedAt',direction:-1},title:{field:'title',direction:1},createdAt:{field:'createdAt',direction:-1},createdAtAsc:{field:'createdAt',direction:1}};
  if(!Object.hasOwn(sorts,sort))throw new Error('E2EE_SHARED_FILTER_REVIEW_REQUIRED');const {field,direction}=sorts[sort];
  tasks.sort((a,b)=>{const left=a[field],right=b[field];if(left===null||left===undefined)return right===null||right===undefined?String(a.id).localeCompare(String(b.id)):1;if(right===null||right===undefined)return -1;const compared=typeof left==='number'&&typeof right==='number'?left-right:String(left).localeCompare(String(right));return direction*compared||String(a.id).localeCompare(String(b.id));});
  const cursor=url.searchParams.get('cursor');if(cursor)throw new Error('E2EE_SHARED_QUERY_REFRESH_REQUIRED');
  // A complete bounded local result has no server cursor whose meaning could
  // change under an unrelated plaintext query/index or leak private filters.
  return{tasks,total:tasks.length,hasMore:false,nextCursor:null};
 }
 async #get(path:string){const url=new URL(path,'https://private.invalid'),{context,versions}=await this.#snapshot(),segments=url.pathname.split('/').filter(Boolean),live=versions.filter(row=>!row.deleted);
  const list=(kind:ProductKind,table?:string)=>live.filter(row=>row.kind===kind&&(!table||plain(row).table===table)).map(row=>this.#row(row,context));
  if(segments.length===0){const root=this.#find(versions,this.ports.binding.kind,this.ports.binding.resourceId);
   if(this.ports.binding.kind==='space')return{space:this.#row(root,context),members:context.members,invitations:context.invitations};
   const raw=url.searchParams.get('filter'),filter=raw?parse(raw):{};object(filter);const page=this.#page(this.#tasks(versions,context,filter),url);
   return{project:this.#row(root,context),statuses:list('status').filter(row=>row.isChaos!==1),categories:list('category','shared_project_categories'),tasks:page.tasks,taskPage:{total:page.total,hasMore:false,nextCursor:null},members:context.members,customFieldDefinitions:list('custom-field')};
  }
  if(segments[0]==='tasks'){
   if(segments.length===1){const filter=parse(url.searchParams.get('filter')??'{}');object(filter);return this.#page(this.#tasks(versions,context,filter),url);}
   const task=this.#find(versions,'task',segments[1]);if(segments.length===2)return{task:this.#task(task,versions,context)};
   if(segments[2]==='comments')return{comments:live.filter(row=>row.kind==='comment'&&plain(row).record.task_id===segments[1]).map(row=>this.#row(row,context)),nextCursor:null,hasMore:false};
  }
  const collections:Record<string,[ProductKind,string?]>={statuses:['status'],categories:['category','shared_project_categories'],labels:['label'],comments:['project-comment'],mindmaps:['mindmap'],'project-categories':['category','shared_space_project_categories'],'member-categories':['category','shared_member_categories']};
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
  if(parts[0]==='tasks'&&(parts.length===1||parts.length===2)){
   const create=parts.length===1&&request.method==='POST',old=create?null:this.#find(versions,'task',parts[1]),body=old?structuredClone(plain(old)):this.#draft('task','shared_tasks',this.#newRecord('shared_tasks',{},context,request.createdAt,crypto.randomUUID()),{shared_task_labels:[],shared_task_dependencies:[],shared_task_planning:[],shared_task_approvals:[],shared_task_reviews:[],shared_custom_field_values:[],shared_task_watchers:[]});
   const expected=old?.revision??0;if(old&&number(input.expectedRevision)!==expected)throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
   if(request.method==='DELETE'){
    if(versions.some(row=>!row.deleted&&row.parentId===old!.entityId))throw new Error('E2EE_SHARED_SUBTREE_REVIEW_REQUIRED');edits.push(this.#edit(body,expected,'delete'));output={ok:true,id:body.record.id};
   }else{
    const fields:Record<string,string>={title:'title',description:'description',statusId:'status_id',categoryId:'category_id',assigneeId:'assignee_id',dueDate:'due_date',startDate:'start_date',startTime:'start_time',endTime:'end_time',entryType:'entry_type',priority:'priority',parentTaskId:'parent_task_id',position:'position',archivedAt:'archived_at'};
    const allowed=[...Object.keys(fields),'tags','checklists','labelIds','dependsOnIds','approverIds','approvalRequired','customFields','sprintId','storyPoints','estimateHours','expectedRevision','requestId','completedAt','completedBy'];
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
   const collections:Record<string,[ProductKind,string]>={statuses:['status','shared_project_statuses'],categories:['category','shared_project_categories'],labels:['label','shared_space_labels'],'project-categories':['category','shared_space_project_categories']};
   const root=parts.length===0,descriptor=root?[this.ports.binding.kind,this.ports.binding.kind==='project'?'shared_projects':'shared_spaces'] as [ProductKind,string]:collections[parts[0]];
   if(!descriptor||parts.length>2)throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');const [kind,table]=descriptor,create=!root&&parts.length===1&&request.method==='POST',old=create?null:this.#find(versions,kind,root?this.ports.binding.resourceId:parts[1]);
   if(old&&plain(old).table!==table)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const expected=old?.revision??0;if(old&&number(input.expectedRevision)!==expected)throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
   const body=old?structuredClone(plain(old)):this.#draft(kind,table,this.#newRecord(table,{},context,request.createdAt,crypto.randomUUID()));
   const fields:Record<string,string>={title:'title',description:'description',color:'color',layout:'layout',parentId:'parent_id',boardStatusId:'board_status_id',categoryId:'category_id',imageUrl:'image_url',isDone:'is_done',taskTitleLines:'task_title_lines',visibleTaskCount:'visible_task_count'};
   if(Object.keys(input).some(key=>!Object.hasOwn(fields,key)&&!['tags','expectedRevision','requestId'].includes(key)))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
   for(const [name,column]of Object.entries(fields))if(Object.hasOwn(input,name)){if(!Object.hasOwn(body.record,column))throw new Error('E2EE_SHARED_DOMAIN_INVALID');body.record[column]=name==='isDone'?(input[name]===true?1:0):input[name] as SharedContentRecord[string];}
   if(Object.hasOwn(input,'tags'))body.record.tags_json=JSON.stringify(input.tags);if(Object.hasOwn(body.record,'updated_at'))body.record.updated_at=request.createdAt;if(Object.hasOwn(body.record,'revision'))body.record.revision=expected+1;
   if(request.method==='DELETE'&&versions.some(row=>!row.deleted&&(row.parentId===old!.entityId||row.kind==='task'&&plain(row).record.status_id===body.record.id)))throw new Error('E2EE_SHARED_SUBTREE_REVIEW_REQUIRED');
   const validated=this.#body(kind,table,body.record,body.related);edits.push(this.#edit(validated,expected,request.method==='DELETE'?'delete':create?'create':'update'));
   output=request.method==='DELETE'?{ok:true}:{[kind]:this.#row({protocol:1,scopeId:this.ports.binding.scopeId,entityId:sharedRecordKey(kind,body.record),kind,revision:expected+1,parentId:sharedBodyParent(validated),deleted:false,metadata:sharedBodyMetadata(validated),body:validated},context)};
  }
  return{edits,result:output};
 }
 async #execute(method:string,path:string,held:ObjectValue,intentId?:string){
  if(method==='GET')return this.#get(path);if(!['POST','PATCH','PUT','DELETE'].includes(method))throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
  const id=intentId??(typeof held.requestId==='string'?held.requestId:crypto.randomUUID());assertTechnical(id);let saved=await this.ports.loadRequest(id),request:SavedRequest;
  if(intentId&&!saved)throw new Error('E2EE_SHARED_REQUEST_MISSING');
  if(saved){request=validateSharedLiveRequest(this.ports.binding,saved.value);if(request.method!==method||request.path!==path||!samePrivateJson(request.body,held))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');}
  else{request={protocol:1,scopeId:this.ports.binding.scopeId,id,method,path,body:held,createdAt:new Date().toISOString(),edits:null,result:null,complete:false};saved={value:request,serial:await this.ports.saveRequest(request,null)};}
  if(request.complete){if(!request.result||!request.edits)throw new Error('E2EE_SHARED_REQUEST_INVALID');return structuredClone(request.result);}
  if(!request.edits){const prepared=await this.#prepare(request);request={...request,...prepared};saved={value:request,serial:await this.ports.saveRequest(request,saved.serial)};}
  await this.ports.stage(request.edits!,id);this.ports.current();
  if(!this.ports.online){const result=structuredClone(request.result!);for(const key of ['task','comment','project','space','status','category','label'])if(result[key]&&typeof result[key]==='object')result[key]={...(result[key] as ObjectValue),pending:true};return{...result,pending:true};}
  await this.ports.flush(id);this.ports.current();
  await this.ports.saveRequest({...request,complete:true},saved.serial);this.ports.current();
  return structuredClone(request.result!);
 }
 request(method:string,path:string,body:ObjectValue={}){const held=structuredClone(body);return this.#run(()=>this.#execute(method,path,held));}
 resume(id:string){assertTechnical(id);return this.#run(async()=>{const saved=await this.ports.loadRequest(id);if(!saved)throw new Error('E2EE_SHARED_REQUEST_MISSING');const value=validateSharedLiveRequest(this.ports.binding,saved.value);return this.#execute(value.method,value.path,structuredClone(value.body),id);});}
}
