import {assertTechnical,exactKeys} from './keys.ts';
import {parseLegacyMigrationJson} from './legacy-json.ts';
import {validateSharedSavedDefinition} from './shared-domain-values.ts';
import {privateSharedTaskPage} from './shared-query.ts';
import {calendarContext,todayCivilDate,addCivilDays,civilDateCarrier} from '../calendar-context.ts';
import {calendarPeriod} from '../calendar-astronomy.ts';
import {samePrivateJson} from './product-json.ts';
import type {SharedDomainBinding} from './shared-domain.ts';
import type {FeatureDocumentPort} from './feature-document.ts';
import type {SharedSavedView,SharedSavedViewDefinition} from '../cloud-sync.ts';
import {validateMindmap} from '../mindmaps-model.ts';

type Row=Record<string,unknown>;
type PersonalView=SharedSavedView&{deleted:boolean};
export type PersonalSharedState={protocol:1;ownerId:string;views:PersonalView[];requests:{id:string;method:string;path:string;input:Row;result:Row}[];readFlags:Record<string,boolean>;watching:Record<string,boolean>;layouts?:Record<string,string[]>};
export interface SharedAggregatePorts{
 actorId:string;current:()=>void;bindings:()=>Promise<SharedDomainBinding[]>;
 request:(binding:SharedDomainBinding,method:string,path:string,body?:Row)=>Promise<Row>;
 personal:FeatureDocumentPort<PersonalSharedState>;
 layoutSeed?:()=>Promise<unknown>;
}
function object(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_SHARED_CONTENT_INVALID');}
function rows(value:unknown):Row[]{if(!Array.isArray(value)||value.length>10000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');for(const row of value)object(row);return value;}
function parse(value:string){return parseLegacyMigrationJson(value,'E2EE_SHARED_FILTER_INVALID',1024*1024);}
export function validatePersonalSharedState(input:unknown,ownerId:string):PersonalSharedState{
 const hasLayouts=!!input&&typeof input==='object'&&!Array.isArray(input)&&Object.hasOwn(input,'layouts');
 exactKeys(input,['protocol','ownerId','views','requests','readFlags','watching',...(hasLayouts?['layouts']:[])]);if(input.protocol!==1||input.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');
 if(Object.hasOwn(input,'layouts'))validateLayouts(input.layouts);
 for(const name of ['readFlags','watching']){object(input[name]);if(Object.keys(input[name]).length>100000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');for(const [id,value]of Object.entries(input[name])){assertTechnical(id);if(typeof value!=='boolean')throw new Error('E2EE_SHARED_CONTENT_INVALID');}}
 const seen=new Set<string>();for(const row of rows(input.views)){
  exactKeys(row,['id','spaceId','visibility','revision','updatedAt','canEdit','invalid','definition','deleted']);assertTechnical(row.id);if(row.spaceId!==null)assertTechnical(row.spaceId);
  if(seen.has(String(row.id))||row.visibility!=='personal'||row.canEdit!==true||typeof row.invalid!=='boolean'||typeof row.deleted!=='boolean'||!Number.isSafeInteger(row.revision)||Number(row.revision)<1||typeof row.updatedAt!=='string'||!Number.isFinite(Date.parse(row.updatedAt)))throw new Error('E2EE_SHARED_VIEW_INVALID');seen.add(String(row.id));
  if(!row.invalid)validateSharedSavedDefinition(row.definition);
 }
 const requests=new Set<string>();for(const row of rows(input.requests)){exactKeys(row,['id','method','path','input','result']);assertTechnical(row.id);if(requests.has(String(row.id))||!['POST','PATCH','DELETE'].includes(String(row.method))||typeof row.path!=='string')throw new Error('E2EE_SHARED_REQUEST_INVALID');requests.add(String(row.id));object(row.input);object(row.result);}
 return input as PersonalSharedState;
}
function expandedIds(input:unknown):string[]{if(!Array.isArray(input)||input.length>100||new Set(input).size!==input.length)throw new Error('INVALID_SHARED_UI_STATE');for(const id of input)assertTechnical(id);return [...input] as string[];}
function validateLayouts(input:unknown):Record<string,string[]>{object(input);if(Object.keys(input).length>4096)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');for(const [space,ids]of Object.entries(input)){assertTechnical(space);expandedIds(ids);}return input as Record<string,string[]>;}
export function seedPersonalSharedLayouts(input:unknown,ownerId:string):Record<string,string[]>{
 const result:Record<string,string[]>=Object.create(null);
 for(const row of rows(input)){exactKeys(row,['user_id','space_id','expanded_json','updated_at']);if(row.user_id!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');assertTechnical(row.space_id);if(Object.hasOwn(result,row.space_id))throw new Error('E2EE_SHARED_CONTENT_INVALID');result[row.space_id]=expandedIds(parse(String(row.expanded_json)));}
 return validateLayouts(result);
}
/** Only personally owned view content is seeded. Permissions, membership,
 * historical requests and any inherited server receipts are never adopted. */
export function seedPersonalSharedState(input:unknown,ownerId:string,technical:unknown):PersonalSharedState{
 exactKeys(input,['format','pathId','table','rows','execution']);if(input.format!=='genesis-private-table-v1'||input.pathId!=='personal.local-work'||input.table!=='shared_saved_views'||input.execution!=='content-only')throw new Error('E2EE_PRIVATE_SEED_REQUIRED');
 const views:PersonalView[]=rows(input.rows).map(row=>{if(row.owner_id!==ownerId||row.visibility!=='personal')throw new Error('E2EE_SCOPE_BINDING_MISMATCH');let definition:SharedSavedViewDefinition|null=null,invalid=false;
  try{definition=validateSharedSavedDefinition(parse(String(row.payload))) as SharedSavedViewDefinition;}catch{invalid=true;}
  return{id:String(row.id),spaceId:row.space_id as string|null,visibility:'personal',revision:Number(row.revision),updatedAt:String(row.updated_at),canEdit:true,invalid,definition,deleted:row.deleted_at!==null};
 });exactKeys(technical,['ownerId','readFlags','watching']);if(technical.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');return validatePersonalSharedState({protocol:1,ownerId,views,requests:[],readFlags:technical.readFlags,watching:technical.watching},ownerId);
}
/** All cross-project filters, sorting, relative dates and saved definitions
 * run over authenticated client-decrypted records. No readable query is sent
 * to the legacy index. Missing scopes fail instead of yielding partial totals. */
export class SharedAggregateModel{
 #serial:Promise<unknown>=Promise.resolve();
 #readers=new Set<Promise<unknown>>();
 constructor(private readonly ports:SharedAggregatePorts){}
 #run<T>(run:()=>Promise<T>,readOnly=false){const previous=this.#serial,readers=readOnly?[]:[...this.#readers];const pending=previous.catch(()=>undefined).then(async()=>{await Promise.allSettled(readers);this.ports.current();const result=await run();this.ports.current();return result;});
  if(readOnly){this.#readers.add(pending);void pending.then(()=>this.#readers.delete(pending),()=>this.#readers.delete(pending));}else this.#serial=pending;return pending;
 }
 async #bindings(){const bindings=await this.ports.bindings();this.ports.current();if(bindings.length>4096||new Set(bindings.map(row=>row.scopeId)).size!==bindings.length)throw new Error('E2EE_SHARED_CONTEXT_INVALID');return bindings;}
 async #state(){const view=await this.ports.personal.read();this.ports.current();if(view.conflict)throw new Error('E2EE_PRODUCT_CONFLICT_REVIEW_REQUIRED');return validatePersonalSharedState(view.document,this.ports.actorId);}
 async #layout(method:string,spaceId:string,input:Row,bindings:SharedDomainBinding[]){
  assertTechnical(spaceId);if(!bindings.some(row=>row.kind==='space'&&row.resourceId===spaceId))throw new Error('E2EE_SHARED_SCOPE_FORBIDDEN');
  if(!['GET','PUT'].includes(method))throw new Error('E2EE_SHARED_REQUEST_INVALID');exactKeys(input,method==='GET'?[]:['expandedIds']);
  const state=await this.#state();let layouts=state.layouts;
  if(!layouts){if(!this.ports.layoutSeed)throw new Error('E2EE_PRIVATE_SEED_REQUIRED');layouts=seedPersonalSharedLayouts(await this.ports.layoutSeed(),this.ports.actorId);this.ports.current();}
  const visible=new Set((await this.#projects(bindings)).filter(row=>row.project.spaceId===spaceId&&!row.project.archivedAt).map(row=>String(row.project.id)));this.ports.current();
  if(method==='PUT'){const ids=expandedIds(input.expandedIds);if(ids.some(id=>!visible.has(id)))throw new Error('INVALID_SHARED_UI_STATE');const next={...layouts,[spaceId]:ids};await this.ports.personal.write({...state,layouts:next});this.ports.current();await this.ports.personal.flush();this.ports.current();layouts=next;}
  // A read never uploads an imported history or changes the current view. A
  // later explicit layout save retains the seeded history in the normal queue.
  return{expandedIds:(Object.hasOwn(layouts,spaceId)?layouts[spaceId]:[]).filter(id=>visible.has(id))};
 }
 async #views(bindings:SharedDomainBinding[]){const personal=(await this.#state()).views.filter(row=>!row.deleted),all:SharedSavedView[]=[...personal];
  for(const scope of bindings.filter(row=>row.kind==='space')){const response=await this.ports.request(scope,'GET','views');this.ports.current();for(const row of rows(response.views)){if(row.visibility!=='shared'||row.spaceId!==scope.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');all.push(row as unknown as SharedSavedView);}}
  if(all.length>10000||new Set(all.map(row=>row.id)).size!==all.length)throw new Error('E2EE_SHARED_VIEW_INVALID');return all;
 }
 async #projects(bindings:SharedDomainBinding[]){const all:{scope:SharedDomainBinding;project:Row;members:Row[]}[]=[];
  for(const scope of bindings.filter(row=>row.kind==='project')){const result=await this.ports.request(scope,'GET','');this.ports.current();object(result.project);all.push({scope,project:result.project,members:rows(result.members)});}return all;
 }
 async #tasks(bindings:SharedDomainBinding[],filter:Row,sort:string){const criteria=structuredClone(filter);let definition:SharedSavedViewDefinition|undefined;
  if(Object.hasOwn(criteria,'savedViewId')){assertTechnical(criteria.savedViewId);if(Object.hasOwn(criteria,'viewDefinition'))throw new Error('E2EE_SHARED_FILTER_INVALID');const view=(await this.#views(bindings)).find(row=>row.id===criteria.savedViewId);if(!view||view.invalid||!view.definition)throw new Error('E2EE_SHARED_VIEW_INVALID');definition=validateSharedSavedDefinition(view.definition) as SharedSavedViewDefinition;delete criteria.savedViewId;}
  if(Object.hasOwn(criteria,'viewDefinition')){definition=validateSharedSavedDefinition(criteria.viewDefinition) as SharedSavedViewDefinition;delete criteria.viewDefinition;}
  let overdue:{date:string;time:string}|undefined;
  if(definition){const context=calendarContext(definition.calendarContext),today=todayCivilDate(context),base=Array.isArray(definition.filter)?{}:definition.filter;
   Object.assign(criteria,{...base,...criteria});sort=definition.sort;
   if(definition.relative==='overdue'){const wall=new Intl.DateTimeFormat('en-GB',{timeZone:context.timeZone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()),part=(name:string)=>wall.find(row=>row.type===name)?.value;
    overdue={date:today,time:`${part('hour')}:${part('minute')}`};criteria.completion='open';}
   if(definition.relative==='this-week'){const weekday=civilDateCarrier(today).getUTCDay(),start=addCivilDays(today,-((weekday+6)%7));criteria.dueFrom=start;criteria.dueTo=addCivilDays(start,6);}
   if(definition.relative==='this-month'){const period=calendarPeriod(today,definition.calendarMode,'month',context);criteria.dueFrom=period.start;criteria.dueTo=addCivilDays(period.end,-1);}
  }
  const tasks:Row[]=[],sources:Row[]=[];
  for(const scope of bindings.filter(row=>row.kind==='project')){const result=await this.ports.request(scope,'GET',`tasks?filter=${encodeURIComponent(JSON.stringify(criteria))}&sort=${encodeURIComponent(sort)}`);this.ports.current();
   for(const task of rows(result.tasks)){if(task.projectId!==scope.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');if(!overdue||typeof task.dueDate==='string'&&(task.dueDate<overdue.date||task.dueDate===overdue.date&&typeof task.endTime==='string'&&task.endTime<overdue.time))tasks.push(task);}
   sources.push({scopeId:scope.scopeId,queryVersion:result.queryVersion});if(tasks.length>10000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');
  }return privateSharedTaskPage(tasks,sort,sources);
 }
 async #saveView(method:string,path:string,input:Row,bindings:SharedDomainBinding[]){
  exactKeys(input,method==='DELETE'?['requestId','expectedRevision']:Object.hasOwn(input,'expectedRevision')?['requestId','spaceId','visibility','definition','expectedRevision']:['requestId','spaceId','visibility','definition']);assertTechnical(input.requestId);
  const id=path.split('/')[2],state=await this.#state(),priorRequest=state.requests.find(row=>row.id===input.requestId);
  if(priorRequest){if(priorRequest.method!==method||priorRequest.path!==path||!samePrivateJson(priorRequest.input,input))throw new Error('E2EE_IDEMPOTENCY_CONFLICT');await this.ports.personal.flush();this.ports.current();return structuredClone(priorRequest.result);}
  const views=await this.#views(bindings),old=id?views.find(row=>row.id===id):null;
  if(id&&!old)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');if(old&&(old.revision!==input.expectedRevision||!old.canEdit))throw new Error('E2EE_PRODUCT_REVISION_CONFLICT');
  if(old?.visibility==='shared'||method!=='DELETE'&&input.visibility==='shared'){
   const spaceId=old?.spaceId??input.spaceId;if(old&&method!=='DELETE'&&(old.visibility!==input.visibility||old.spaceId!==input.spaceId))throw new Error('E2EE_SHARED_CROSS_SCOPE_REVIEW_REQUIRED');
   const scope=bindings.find(row=>row.kind==='space'&&row.resourceId===spaceId);if(!scope)throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');
   const body=structuredClone(input);delete body.spaceId;return this.ports.request(scope,method,`views${id?'/'+encodeURIComponent(id):''}`,body);
  }
  if(method!=='DELETE'&&input.visibility!=='personal')throw new Error('E2EE_SHARED_VIEW_INVALID');if(input.spaceId!==undefined&&input.spaceId!==null&&!bindings.some(row=>row.kind==='space'&&row.resourceId===input.spaceId))throw new Error('E2EE_SHARED_SCOPE_FORBIDDEN');
  const next:PersonalView=method==='DELETE'?{...old!,deleted:true} as PersonalView:{id:old?.id??crypto.randomUUID(),spaceId:input.spaceId as string|null,visibility:'personal',revision:(old?.revision??0)+1,updatedAt:new Date().toISOString(),canEdit:true,invalid:false,definition:validateSharedSavedDefinition(input.definition) as SharedSavedViewDefinition,deleted:false};
  if(method==='DELETE'){next.revision++;next.updatedAt=new Date().toISOString();}
  const result:Row=method==='DELETE'?{ok:true}:{view:next},updated:PersonalSharedState={...state,views:[...state.views.filter(row=>row.id!==next.id),next],requests:[...state.requests,{id:String(input.requestId),method,path,input:structuredClone(input),result:structuredClone(result)}]};
  await this.ports.personal.write(validatePersonalSharedState(updated,this.ports.actorId));this.ports.current();await this.ports.personal.flush();this.ports.current();return result;
 }
 async #notices(bindings:SharedDomainBinding[],state:PersonalSharedState){
  const notifications:Row[]=[];for(const scope of bindings.filter(row=>row.kind==='project')){
   const response=await this.ports.request(scope,'GET','events');this.ports.current();object(response.project);const project=response.project;if(project.archivedAt)continue;
   const tasks=new Map(rows(response.tasks).map(row=>[String(row.id),row])),comments=new Map(rows(response.comments).map(row=>[String(row.id),row])),members=new Map(rows(response.members).map(row=>[String(row.userId),row]));
   for(const event of rows(response.events)){if(event.actorId===this.ports.actorId)continue;const task=event.taskId?tasks.get(String(event.taskId)):null,comment=comments.get(String(event.objectId));
    if(event.taskId&&!task||task?.archivedAt)continue;let kind=event.action==='task.created'?'created':event.action==='project.created'?'projects':event.action==='comment.created'?'comments':'changes';
    const mentions=Array.isArray(comment?.mentionIds)&&comment.mentionIds.includes(this.ports.actorId),watching=task?(state.watching[String(task.id)]??task.watching===true):false;
    if(mentions)kind='mentions';else if(task?.assigneeId===this.ports.actorId&&event.action==='task.updated')kind='assignment';
    if(!['created','projects','assignment','mentions'].includes(kind)&&task&&!watching)continue;
    notifications.push({id:event.id,action:event.action,objectId:event.objectId,createdAt:event.createdAt,projectId:scope.resourceId,projectTitle:project.title,spaceId:project.spaceId,actorName:members.get(String(event.actorId))?.displayName??'',taskTitle:task?.title??null,commentBody:comment?.body??null,commentId:comment?.id??null,isRead:state.readFlags[String(event.id)]===true?1:0,kind,previewAllowed:true,dueDate:task?.dueDate??null,archivedAt:task?.archivedAt??null,taskId:task?.id??null});
    if(notifications.length>10000)throw new Error('E2EE_SHARED_QUERY_TOO_LARGE');
   }
  }
  if(new Set(notifications.map(row=>row.id)).size!==notifications.length)throw new Error('E2EE_SHARED_DOMAIN_INVALID');return notifications.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt))||String(b.id).localeCompare(String(a.id)));
 }
 async #overview(bindings:SharedDomainBinding[],state:PersonalSharedState,spaceId?:string){
  if(spaceId&&!bindings.some(row=>row.kind==='space'&&row.resourceId===spaceId))throw new Error('E2EE_SHARED_SCOPE_FORBIDDEN');
  const projects=(await this.#projects(bindings)).map(row=>row.project).filter(row=>!row.archivedAt&&(!spaceId||row.spaceId===spaceId)),ids=projects.map(row=>row.id),page=await this.#tasks(bindings,{projectIds:ids},'position');
  const tasks=ids.length?page.tasks:[],unread=(await this.#notices(bindings,state)).filter(row=>row.isRead===0&&(!spaceId||row.spaceId===spaceId)),count=(action:string)=>unread.filter(row=>row.action===action).length,ordinary=projects.filter(row=>row.isInbox!==1&&row.kind==='project');
  return{projects:ordinary.length,rootProjects:ordinary.filter(row=>row.parentId===null).length,subprojects:ordinary.filter(row=>row.parentId!==null).length,tasks:tasks.length,openTasks:tasks.filter(row=>!row.completedAt).length,completedTasks:tasks.filter(row=>!!row.completedAt).length,newTasks:count('task.created'),newProjects:count('project.created'),newComments:count('comment.created'),newNotifications:unread.filter(row=>!['task.created','project.created','comment.created'].includes(String(row.action))).length};
 }
 async #saveReadFlags(state:PersonalSharedState,ids:string[],read:boolean){
  const readFlags={...state.readFlags};for(const id of ids){assertTechnical(id);readFlags[id]=read;}
  if(!samePrivateJson(readFlags,state.readFlags))await this.ports.personal.write(validatePersonalSharedState({...state,readFlags},this.ports.actorId));this.ports.current();await this.ports.personal.flush();this.ports.current();return{...state,readFlags};
 }
 async #notificationRequest(method:string,url:URL,input:Row,bindings:SharedDomainBinding[]){
  const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent),state=await this.#state();
  if(method==='GET'&&parts[1]==='overview')return{overview:await this.#overview(bindings,state,url.searchParams.get('spaceId')??undefined)};
  if(parts[1]==='projects'&&parts.length===6&&parts[3]==='tasks'&&['read','watch'].includes(parts[5])){
   const binding=bindings.find(row=>row.kind==='project'&&row.resourceId===parts[2]);if(!binding)throw new Error('E2EE_SHARED_SCOPE_FORBIDDEN');const result=await this.ports.request(binding,'GET',`tasks/${encodeURIComponent(parts[4])}`);object(result.task);const task=result.task;
   if(parts[5]==='watch'){
    if(method==='GET')return{watching:state.watching[String(task.id)]??task.watching===true};exactKeys(input,['watching']);if(method!=='PUT'||typeof input.watching!=='boolean')throw new Error('E2EE_SHARED_REQUEST_INVALID');
    await this.ports.personal.write(validatePersonalSharedState({...state,watching:{...state.watching,[String(task.id)]:input.watching}},this.ports.actorId));this.ports.current();await this.ports.personal.flush();this.ports.current();return{watching:input.watching};
   }
   exactKeys(input,['commentIds']);if(method!=='POST'||!Array.isArray(input.commentIds)||input.commentIds.length>200)throw new Error('E2EE_SHARED_REQUEST_INVALID');for(const id of input.commentIds)assertTechnical(id);
   const commentIds=input.commentIds;const notices=await this.#notices(bindings,state),ids=notices.filter(row=>row.projectId===parts[2]&&row.taskId===parts[4]&&(row.action!=='comment.created'||commentIds.includes(row.objectId))).map(row=>String(row.id)),next=await this.#saveReadFlags(state,ids,true);return{ok:true,overview:await this.#overview(bindings,next)};
  }
  const notices=await this.#notices(bindings,state);
  if(parts[1]==='notifications'&&parts.length===4&&parts[3]==='destination'&&method==='GET'){
   const row=notices.find(row=>row.id===parts[2]);if(!row)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return{spaceId:row.spaceId,projectId:row.projectId,...(row.taskId?{taskId:row.taskId}:{}),...(row.commentId?{taskAction:'comments',commentId:row.commentId}:{})};
  }
  if(method==='POST'&&parts[2]==='read'&&['notifications','inbox'].includes(parts[1])){
   if(Object.keys(input).some(key=>!['eventIds','all','read'].includes(key))||!Array.isArray(input.eventIds)||input.eventIds.length>200||input.all!==undefined&&typeof input.all!=='boolean'||input.read!==undefined&&typeof input.read!=='boolean')throw new Error('E2EE_SHARED_REQUEST_INVALID');
   const ids=input.all===true?notices.map(row=>String(row.id)):input.eventIds.map(id=>{assertTechnical(id);if(!notices.some(row=>row.id===id))throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return id;});await this.#saveReadFlags(state,ids,input.read!==false);return{ok:true};
  }
  if(method==='GET'&&parts.length===2&&['notifications','inbox'].includes(parts[1])){
   let selected=notices;if(url.searchParams.get('unread')==='1')selected=selected.filter(row=>row.isRead===0);const before=url.searchParams.get('before');if(before){const index=selected.findIndex(row=>row.id===before);if(index<0)throw new Error('E2EE_SHARED_QUERY_REFRESH_REQUIRED');selected=selected.slice(index+1);}
   const page=selected.slice(0,50);return{notifications:page,nextCursor:selected.length>page.length?String(page.at(-1)!.id):null};
  }
  throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
 }
 async #maps(method:string,url:URL,input:Row,bindings:SharedDomainBinding[]){
  const parts=url.pathname.split('/').filter(Boolean).map(decodeURIComponent),spaceId=parts[2],space=bindings.find(row=>row.kind==='space'&&row.resourceId===spaceId);if(!space)throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');
  const scopes=[space,...(await this.#projects(bindings)).filter(row=>row.project.spaceId===spaceId).map(row=>row.scope)],maps:{scope:SharedDomainBinding;row:Row}[]=[];
  for(const scope of scopes){const result=await this.ports.request(scope,'GET','mindmaps');this.ports.current();for(const row of rows(result.maps)){const document=validateMindmap(row.document);if(document.projectId!==(scope.kind==='project'?scope.resourceId:null))throw new Error('E2EE_SCOPE_BINDING_MISMATCH');maps.push({scope,row:{...row,document}});}}
  if(new Set(maps.map(row=>row.row.id)).size!==maps.length)throw new Error('E2EE_SHARED_DOMAIN_INVALID');const id=parts[4],found=id?maps.find(row=>row.row.id===id):null;
  if(method==='GET'){
   if(!id)return{maps:maps.map(row=>row.row)};if(!found)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');
   if(parts[5]==='history')return this.ports.request(found.scope,'GET',`mindmaps/${encodeURIComponent(id)}/history`+url.search);return{map:found.row};
  }
  if(!id||!['PUT','DELETE'].includes(method))throw new Error('E2EE_SHARED_REQUEST_INVALID');let target=found?.scope;
  if(method==='PUT'){const document=validateMindmap(input.document);if(document.id!==id)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const expected=scopes.find(row=>row.kind===(document.projectId?'project':'space')&&row.resourceId===(document.projectId??spaceId));if(!expected)throw new Error('E2EE_SHARED_SCOPE_FORBIDDEN');if(target&&target.scopeId!==expected.scopeId)throw new Error('E2EE_SHARED_CROSS_SCOPE_REVIEW_REQUIRED');target=expected;}
  if(!target)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return this.ports.request(target,method,`mindmaps/${encodeURIComponent(id)}`,input);
 }
 request(method:string,path:string,body:Row={}){const input=structuredClone(body);return this.#run(async()=>{
  const url=new URL(path,'https://private.invalid'),segments=url.pathname.split('/').filter(Boolean).map(decodeURIComponent),bindings=await this.#bindings();if(segments[0]!=='shared')throw new Error('E2EE_SHARED_REQUEST_INVALID');
  if(['overview','inbox','notifications'].includes(segments[1])||segments[1]==='projects'&&segments.length===6&&segments[3]==='tasks'&&['read','watch'].includes(segments[5]))return this.#notificationRequest(method,url,input,bindings);
  if(segments[1]==='spaces'&&segments[3]==='ui'&&segments.length===4)return this.#layout(method,segments[2],input,bindings);
  if(segments[1]==='spaces'&&segments[3]==='mindmaps'&&segments.length>=4&&segments.length<=6)return this.#maps(method,url,input,bindings);
  if(method==='GET'&&segments[1]==='tasks'&&segments.length===2){if(url.searchParams.get('cursor'))throw new Error('E2EE_SHARED_QUERY_REFRESH_REQUIRED');const filter=parse(url.searchParams.get('filter')??'{}');object(filter);return this.#tasks(bindings,filter,url.searchParams.get('sort')??'position');}
  if(segments[1]==='views'){
   if(method!=='GET')return this.#saveView(method,segments.join('/'),input,bindings);if(url.searchParams.get('cursor'))throw new Error('E2EE_SHARED_QUERY_REFRESH_REQUIRED');
   if(segments[2]==='options'){const kind=url.searchParams.get('kind'),filter=parse(url.searchParams.get('filter')??'{}');object(filter);if(!['projects','statuses','assignees','labels'].includes(kind??''))throw new Error('E2EE_SHARED_FILTER_INVALID');
    const options=new Map<string,Row>();for(const {scope,project,members}of await this.#projects(bindings)){if(filter.spaceId&&filter.spaceId!==project.spaceId||Array.isArray(filter.projectIds)&&filter.projectIds.length&&!filter.projectIds.includes(project.id))continue;
     if(kind==='projects')options.set(String(project.id),{id:project.id,title:project.title,groupId:project.spaceId});
     else if(kind==='assignees')for(const member of members)options.set(String(member.userId),{id:member.userId,title:member.displayName});
     else if(kind==='statuses')for(const row of rows((await this.ports.request(scope,'GET','statuses')).statuses))options.set(String(row.id),{id:row.id,title:row.title,groupId:project.id});
     else{const space=bindings.find(row=>row.kind==='space'&&row.resourceId===project.spaceId);if(!space)throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');for(const row of rows((await this.ports.request(space,'GET','labels')).labels))options.set(String(row.id),{id:row.id,title:row.title,groupId:project.spaceId});}
    }this.ports.current();return{options:[...options.values()],hasMore:false,nextCursor:null};
   }
   const views=await this.#views(bindings);if(segments[2]){const view=views.find(row=>row.id===segments[2]);if(!view)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return{view};}return{views,total:views.length,hasMore:false,nextCursor:null};
  }
  if(method==='GET'&&segments[1]==='spaces'&&segments[3]==='search'&&segments.length===4){assertTechnical(segments[2]);if(!bindings.some(row=>row.kind==='space'&&row.resourceId===segments[2]))throw new Error('E2EE_SHARED_FINGERPRINT_REQUIRED');if(url.searchParams.get('cursor'))throw new Error('E2EE_SHARED_QUERY_REFRESH_REQUIRED');
   const text=(url.searchParams.get('q')??'').trim();if(text.length>2000)throw new Error('E2EE_SHARED_FILTER_INVALID');const page=await this.#tasks(bindings,{spaceId:segments[2],q:text},'position'),projects=(await this.#projects(bindings)).map(row=>row.project).filter(row=>row.spaceId===segments[2]&&!row.archivedAt&&`${row.title}\n${row.description}\n${Array.isArray(row.tags)?row.tags.join(' '):''}`.toLocaleLowerCase().includes(text.toLocaleLowerCase()));
   return{projects,tasks:page.tasks,total:page.total,projectTotal:projects.length,nextCursor:null,hasMore:false};
  }
  throw new Error('E2EE_SHARED_OPERATION_REVIEW_REQUIRED');
 },method==='GET');}
}
