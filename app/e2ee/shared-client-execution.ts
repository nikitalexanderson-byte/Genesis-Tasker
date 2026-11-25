import {assertTechnical,exactKeys} from './keys.ts';
import {sharedBodyMetadata,sharedBodyParent,sharedRecordKey,type SharedDomainBinding,type SharedRecordBody,type SharedContentRecord} from './shared-domain.ts';
import {privateAutomationDefinition,privateAutomationEffects,privateAutomationMatches,privateExecutionId,privateSeriesSettings,privateTaskTemplate,type ExecutionDirectory,type ExecutionRow} from './shared-execution-values.ts';
import {addCivilDays,civilDayNumber,momentCivilDate,todayCivilDate} from '../calendar-context.ts';
import {recurrenceMatchesDate} from '../task-recurrence.ts';
import type {ProductEdit,ProductVersion} from './shared-product.ts';
import type {ProductKind} from './product-contract.ts';
import type {SavedSharedRequest,SharedLiveContext} from './shared-live.ts';
import type {AutomationDefinition} from '../shared-automations.ts';
import type {SharedSeriesSettings} from '../shared-series.ts';

type Plan={edits:ProductEdit[];result:ExecutionRow};
type AutomationCandidate={definition:AutomationDefinition;task:ExecutionRow|null;key:string;id:string;date:string};
export interface SharedClientExecutionPorts{
 binding:SharedDomainBinding;actorId:string;context:SharedLiveContext;versions:ProductVersion[];
 row:(version:ProductVersion)=>ExecutionRow;
 body:(kind:ProductKind,table:string,record:SharedContentRecord)=>SharedRecordBody;
 newRecord:(table:string,input:ExecutionRow,time:string,id:string)=>SharedContentRecord;
 task:(input:ExecutionRow,id:string|null,expected:number|null,request:SavedSharedRequest,versions:ProductVersion[])=>Promise<Plan>;
 history?:(entityId:string,before:number)=>Promise<{versions:ProductVersion[]}>;
}
const body=(version:ProductVersion)=>version.body as SharedRecordBody;
const parse=(value:unknown)=>{if(typeof value!=='string')throw new Error('E2EE_SHARED_DOMAIN_INVALID');return JSON.parse(value) as unknown;};
const object=(value:unknown):ExecutionRow=>{if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('E2EE_SHARED_DOMAIN_INVALID');return value as ExecutionRow;};
/** One bounded plan becomes one ordinary signed product commit. It has no
 * transport, worker credentials or server impersonation of the selected owner. */
export class SharedClientExecution{
 constructor(private readonly ports:SharedClientExecutionPorts){}
 #rows(kind:ProductKind){return this.ports.versions.filter(v=>!v.deleted&&v.kind===kind).map(v=>this.ports.row(v));}
 #version(kind:ProductKind,id:string){const found=this.ports.versions.find(v=>v.kind===kind&&v.entityId===`${kind}:${id}`&&!v.deleted);if(!found)throw new Error('E2EE_PRODUCT_ENTITY_MISSING');return found;}
 #edit(value:SharedRecordBody,expected=0,action:ProductEdit['action']=expected?'update':'create'):ProductEdit{return{action,entityId:sharedRecordKey(value.kind,value.record),kind:value.kind,expectedRevision:expected,parentId:sharedBodyParent(value),metadata:sharedBodyMetadata(value),body:action==='delete'?null:value};}
 #directory():ExecutionDirectory{return{projectId:this.ports.binding.resourceId,members:this.ports.context.members,statuses:this.#rows('status'),labels:this.#rows('label'),fields:this.#rows('custom-field'),templates:this.#rows('template')};}
 #write(){if(this.ports.binding.kind!=='project'||!this.ports.context.permissions.editTasks)throw new Error('SHARED_PROJECT_FORBIDDEN');}
 #organize(){this.#write();if(!this.ports.context.permissions.organizeTasks)throw new Error('SHARED_PROJECT_FORBIDDEN');}
 #overlay(versions:ProductVersion[],edits:ProductEdit[]){const result=new Map(versions.map(v=>[v.entityId,v]));for(const edit of edits)result.set(edit.entityId,{protocol:1,scopeId:this.ports.binding.scopeId,entityId:edit.entityId,kind:edit.kind,revision:edit.expectedRevision+1,parentId:edit.parentId,deleted:edit.action==='delete',metadata:edit.metadata,body:edit.body});return[...result.values()];}
 #runs(){return this.#rows('automation-run');}
 async ready(now:string){
  if(!Number.isFinite(Date.parse(now)))throw new Error('AUTOMATION_INVALID');let automation=false,series=false;
  if(this.ports.context.permissions.editTasks){for(const rule of this.#rows('automation').filter(v=>v.enabled&&!v.deleted&&v.ownerId===this.ports.actorId)){if(await this.#candidate(rule,now)){automation=true;break;}}
   if(this.ports.context.permissions.organizeTasks)for(const version of this.ports.versions.filter(v=>!v.deleted&&v.kind==='series')){const value=this.ports.row(version),settings=privateSeriesSettings(value.rule),today=todayCivilDate(settings.recurrence.calendarContext,new Date(now));if(value.paused===1||Number(value.generatedCount)>=settings.limit)continue;const next=settings.timing==='after-completion'?this.#after(value,settings):addCivilDays(String(value.cursorDate),1);if(next&&next<=today&&(!settings.recurrence.rangeEnd||next<=settings.recurrence.rangeEnd)){series=true;break;}}
  }return{automation,series};
 }
 automationRuns(ruleId:string){const runs=this.#runs().filter(v=>v.ruleId===ruleId).map(v=>{const payload=object(v.payload),result=v.result===null?null:object(v.result);return{id:v.id,ruleId:v.ruleId,revision:1,taskId:v.taskId,taskTitle:payload.taskTitle??null,state:v.state,attempts:v.attempts,retryCount:v.retryCount,errorCode:v.errorCode,result:result?.effects??null,createdAt:v.createdAt,finishedAt:v.finishedAt};});return{runs,nextCursor:null};}
 async #effects(definition:AutomationDefinition,task:ExecutionRow|null,request:SavedSharedRequest,runId:string){
  const effects=privateAutomationEffects(definition,task),edits:ProductEdit[]=[];let versions=this.ports.versions;
  if(effects.updated){const plan=await this.ports.task({...effects.patch,expectedRevision:task!.revision},String(task!.id),Number(task!.revision),request,versions);edits.push(...plan.edits);versions=this.#overlay(versions,plan.edits);}
  for(const [index,action]of definition.actions.entries()){
   if(action.type==='createTemplate'){
    if(task&&definition.trigger.type==='completed'&&this.#rows('series-instance').some(v=>v.taskId===task.id&&v.state==='created'))throw new Error('AUTOMATION_SERIES_DUPLICATE');
    const template=this.#rows('template').find(v=>v.id===action.templateId&&!v.deleted);if(!template)throw new Error('AUTOMATION_TASK_TEMPLATE_REQUIRED');
    const options={...action.options,projectId:this.ports.binding.resourceId},anchor=todayCivilDate(definition.calendarContext,new Date(request.createdAt)),tasks=await privateTaskTemplate(template.manifest,options,anchor,this.#directory(),this.ports.binding.scopeId,`${runId}:${index}`);
    if(effects.createdTaskCount+tasks.length>50)throw new Error('AUTOMATION_EFFECT_LIMIT');
    // Dependencies may point forward. The complete batch validates its final
    // graph; stage parent tasks first, then attach dependencies in those bodies.
    for(const task of tasks){const plan=await this.ports.task(task.input,task.id,null,request,versions);edits.push(...plan.edits);versions=this.#overlay(versions,plan.edits);}effects.createdTaskCount+=tasks.length;
   }
   if(action.type==='notify'){
    const id=await privateExecutionId(this.ports.binding.scopeId,runId,'notification',index),record=this.ports.newRecord('shared_project_comments',{body:action.message||String(this.#rows('automation').find(v=>v.id===request.body.ruleId)?.title??'GENESIS'),mentionIds:action.recipientIds??[]},request.createdAt,id);
    record.mention_ids_json=JSON.stringify(action.recipientIds??[]);record.board_id=null;edits.push(this.#edit(this.ports.body('project-comment','shared_project_comments',record)));effects.notifications+=action.recipientIds!.length;
   }
  }return{edits,effects};
 }
 async preview(input:ExecutionRow,request:SavedSharedRequest){
  this.#write();exactKeys(input,['definition','ownerId','taskId']);assertTechnical(input.ownerId);if(!this.ports.context.members.some(v=>v.userId===input.ownerId)||input.ownerId!==this.ports.actorId&&!this.ports.context.permissions.manageProjects)throw new Error('SHARED_PROJECT_FORBIDDEN');
  const definition=privateAutomationDefinition(input.definition,this.#directory()),task=input.taskId===null?null:this.ports.row(this.#version('task',String(input.taskId)));
  if(!task&&!(definition.trigger.type==='schedule'&&(definition.trigger.target??'project')==='project'))throw new Error('AUTOMATION_TASK_REQUIRED');const matches=privateAutomationMatches(definition,this.ports.binding.resourceId,task),effects=matches?(await this.#effects(definition,task,request,request.id)).effects:null;
  return{edits:[],result:{matches,ownerId:input.ownerId,taskId:input.taskId,taskRevision:task?.revision??null,effects,dryRun:true}};
 }
 async #candidate(rule:ExecutionRow,now:string):Promise<AutomationCandidate|null>{
  const definition=privateAutomationDefinition(rule.definition,this.#directory()),type=definition.trigger.type,zone=definition.calendarContext.timeZone,date=momentCivilDate(new Date(now),zone),time=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(now));
  const taskEvent=['created','status','assignee','completed'].includes(type);
  // An event belongs to the rule revision in force when the task changed.
  // The legacy server captured it only for rules enabled at that moment.
  const ruleSince=Date.parse(String(taskEvent?rule.updatedAt:rule.createdAt));
  if(['schedule','due','dueSoon'].includes(type)&&time<(definition.trigger.time??'09:00'))return null;
  if(type==='schedule'&&!recurrenceMatchesDate(definition.trigger.recurrence!.rangeStart,definition.trigger.recurrence!,date))return null;
  const tasks: (ExecutionRow|null)[]=type==='schedule'&&(definition.trigger.target??'project')==='project'?[null]:this.#rows('task').filter(v=>v.archivedAt===null);
  for(const task of tasks){
   if(task&&!(Date.parse(String(type==='created'?task.createdAt:task.updatedAt))>=ruleSince))continue;let coordinates:string|number=date;
   if(type==='due'||type==='dueSoon'){if(!task||task.completedAt!==null||typeof task.dueDate!=='string'||(type==='dueSoon'?addCivilDays(task.dueDate,-(definition.trigger.leadDays??1))!==date:task.dueDate>date))continue;coordinates=String(task.dueDate);}
   if(taskEvent){
    if(!task)continue;coordinates=Number(task.revision);if(type==='created'&&task.revision!==1)continue;
    if(type!=='created'){if(!this.ports.history)throw new Error('E2EE_SHARED_HISTORY_READER_REQUIRED');const current=this.#version('task',String(task.id)),page=await this.ports.history(current.entityId,current.revision),previous=page.versions.find(v=>v.revision===current.revision-1&&!v.deleted);if(!previous)continue;
     const before=this.ports.row(previous);if(type==='status'&&before.statusId===task.statusId||type==='assignee'&&before.assigneeId===task.assigneeId||type==='completed'&&(before.completedAt!==null||task.completedAt===null))continue;
    }
   }
   const key=await privateExecutionId(this.ports.binding.scopeId,String(rule.id),Number(rule.revision),type,String(task?.id??'project'),coordinates),id=await privateExecutionId(this.ports.binding.scopeId,'automation-run',key);
   if(this.#runs().some(v=>v.id===id))continue;return{definition,task,key,id,date};
  }return null;
 }
 async automation(request:SavedSharedRequest){
  this.#write();const parts=request.path.split('/'),input=request.body,retry=parts.length===5&&parts[2]==='runs'&&parts[4]==='retry';
  let rule:ExecutionRow|undefined,selected:AutomationCandidate|null=null,retryOf:string|null=null,retryCount=0;
  if(retry){exactKeys(input,['operationId','expectedRevision']);const old=this.ports.row(this.#version('automation-run',parts[3]));if(old.ruleId!==parts[1]||input.expectedRevision!==1||!['failed','cancelled'].includes(String(old.state)))throw new Error('AUTOMATION_CONFLICT');rule=this.ports.row(this.#version('automation',parts[1]));object(old.payload);retryOf=String(old.id);retryCount=Number(old.retryCount)+1;
   const task=old.taskId===null?null:this.ports.row(this.#version('task',String(old.taskId)));if(task&&task.revision!==old.taskRevision||old.ruleRevision!==rule.revision)throw new Error('AUTOMATION_STALE');
   const definition=privateAutomationDefinition(rule.definition,this.#directory()),id=await privateExecutionId(this.ports.binding.scopeId,'automation-retry',retryOf,request.id);selected={definition,task,id,key:await privateExecutionId(this.ports.binding.scopeId,id,'trigger'),date:todayCivilDate(definition.calendarContext,new Date(request.createdAt))};
  }else{
   exactKeys(input,['now']);if(typeof input.now!=='string'||!Number.isFinite(Date.parse(input.now))||Math.abs(Date.parse(input.now)-Date.parse(request.createdAt))>300000)throw new Error('AUTOMATION_INVALID');
   for(const candidate of this.#rows('automation').filter(v=>v.enabled&&!v.deleted&&v.ownerId===this.ports.actorId).sort((a,b)=>String(a.id).localeCompare(String(b.id)))){const event=await this.#candidate(candidate,input.now);if(event){rule=candidate;selected=event;break;}}
  }
  if(!rule||!selected)return{edits:[],result:{advanced:false}};
  if(rule.ownerId!==this.ports.actorId||!rule.enabled||rule.deleted)throw new Error('E2EE_EXECUTION_ACTOR_REQUIRED');
  const previous=selected.task?this.#runs().find(v=>v.taskId===selected!.task!.id&&object(v.result??{}).taskRevisionAfter===selected!.task!.revision):undefined,previousPayload=previous?object(previous.payload):{},visited=Array.isArray(previousPayload.visited)?previousPayload.visited as string[]:[];
  let state='succeeded',error:string|null=null,effects:unknown=null,edits:ProductEdit[]=[];
  if(visited.includes(String(rule.id))||visited.length>=10){state='cancelled';error=visited.includes(String(rule.id))?'AUTOMATION_LOOP_GUARD':'AUTOMATION_CHAIN_LIMIT';}
  else if(!privateAutomationMatches(selected.definition,this.ports.binding.resourceId,selected.task)){state='skipped';error='AUTOMATION_CONDITIONS_NOT_MET';}
  else try{const plan=await this.#effects(selected.definition,selected.task,request,selected.id);edits=plan.edits;effects=plan.effects;}catch(failure){state='failed';error=failure instanceof Error&&/^(?:AUTOMATION|CUSTOM_FIELD|TEMPLATE|WORKFLOW|INVALID_|TASK_|E2EE_PRODUCT_)[A-Z_]*$/.test(failure.message)?failure.message:'AUTOMATION_ACTION_REJECTED';}
  const record:SharedContentRecord={id:selected.id,rule_id:String(rule.id),rule_revision:Number(rule.revision),trigger_key:selected.key,task_id:selected.task?.id as string??null,task_revision:selected.task?.revision as number??null,chain_id:typeof previousPayload.chainId==='string'?previousPayload.chainId:selected.id,payload_json:JSON.stringify({format:'genesis-client-automation-v1',executedBy:this.ports.actorId,type:selected.definition.trigger.type,scheduledDate:selected.date,taskTitle:selected.task?.title??null,chainId:typeof previousPayload.chainId==='string'?previousPayload.chainId:selected.id,visited:[...visited,String(rule.id)],retryOf}),state,attempts:1,retry_count:retryCount,error_code:error,result_json:JSON.stringify({effects,taskRevisionAfter:selected.task&&edits.some(v=>v.entityId===`task:${selected.task!.id}`)?Number(selected.task.revision)+1:null}),created_at:request.createdAt,finished_at:request.createdAt};
  edits.push(this.#edit(this.ports.body('automation-run','shared_automation_runs',record)));return{edits,result:{advanced:true,runId:selected.id,state,errorCode:error}};
 }
 #seriesNodes(sourceId:string,children:boolean){
  const tasks=this.#rows('task'),source=tasks.find(v=>v.id===sourceId);if(!source)throw new Error('SERIES_SOURCE_UNAVAILABLE');const selected=[source];
  if(children)for(let index=0;index<selected.length;index++){if(selected.length>20)throw new Error('SERIES_TEMPLATE_LIMIT');selected.push(...tasks.filter(v=>v.parentTaskId===selected[index].id&&!selected.some(s=>s.id===v.id)));}if(selected.length>20)throw new Error('SERIES_TEMPLATE_LIMIT');
  const anchor=source.dueDate??source.startDate,offset=(date:unknown)=>date===null?null:anchor===null?0:civilDayNumber(String(date))-civilDayNumber(String(anchor)),open=this.#rows('status').find(v=>!v.isDone&&!v.isChaos)??this.#rows('status').find(v=>!v.isDone);if(!open)throw new Error('SERIES_TEMPLATE_UNAVAILABLE');const selectedIds=new Set(selected.map(v=>v.id));
  return selected.map(task=>({sourceId:task.id,parentSourceId:task.id===sourceId?null:task.parentTaskId,title:task.title,description:task.description,tags:task.tags,entryType:task.entryType,statusId:task.completedAt!==null?open.id:task.statusId,categoryId:task.categoryId,assigneeId:task.assigneeId,priority:task.priority,checklists:(task.checklists as ExecutionRow[]).map(list=>({...list,items:(list.items as ExecutionRow[]).map(item=>({...item,done:false,dueOffset:offset(item.dueDate??null),linkedTaskId:selectedIds.has(item.linkedTaskId)?item.linkedTaskId:null}))})),customFields:task.customFields,dueOffset:task.id===sourceId?0:offset(task.dueDate),startOffset:offset(task.startDate),startTime:task.startTime,endTime:task.endTime,labelIds:task.labelIds,dependsOnSources:(task.dependsOnIds as string[]).filter(id=>selectedIds.has(id)),approverIds:(task.approvals as ExecutionRow[]).map(v=>v.userId)}));
 }
 #instances(seriesId:string){const records=this.#rows('series-instance').filter(v=>v.seriesId===seriesId).sort((a,b)=>String(a.createdAt).localeCompare(String(b.createdAt))),byOrdinal=new Map<number,ExecutionRow>();for(const item of records)byOrdinal.set(Number(item.ordinal),item);return[...byOrdinal.values()].sort((a,b)=>Number(a.ordinal)-Number(b.ordinal));}
 #after(row:ExecutionRow,settings:SharedSeriesSettings){const instances=this.#instances(String(row.id)),last=instances.at(-1);if(!last)return null;if(last.state==='skipped')return addCivilDays(String(last.originalDate),settings.delayDays);const task=this.#rows('task').find(v=>v.id===last.taskId);return task?.completedAt?addCivilDays(momentCivilDate(new Date(String(task.completedAt)),settings.recurrence.calendarContext!.timeZone),settings.delayDays):null;}
 seriesView(version:ProductVersion){const value=this.ports.row(version),settings=privateSeriesSettings(value.rule),nodes=parse(body(version).record.template_json);if(!Array.isArray(nodes)||nodes.length>20)throw new Error('SERIES_TEMPLATE_UNAVAILABLE');const instances=this.#instances(String(value.id)),nextDates:string[]=[],today=todayCivilDate(settings.recurrence.calendarContext);let waiting=false;
  if(Number(value.generatedCount)<settings.limit){if(settings.timing==='after-completion'){const date=this.#after(value,settings);if(date)nextDates.push(date);else waiting=true;}else{let date=String(value.cursorDate)<today?today:addCivilDays(String(value.cursorDate),1);for(let index=0;index<1830&&date<='2100-12-31'&&nextDates.length<Math.min(5,settings.limit-Number(value.generatedCount));index++,date=addCivilDays(date,1)){if(settings.recurrence.rangeEnd&&date>settings.recurrence.rangeEnd)break;if(recurrenceMatchesDate(settings.recurrence.rangeStart,settings.recurrence,date)&&!settings.excludedDates.includes(date))nextDates.push(date);}}}
  return{id:value.id,projectId:this.ports.binding.resourceId,sourceTaskId:value.sourceTaskId,revision:version.revision,paused:value.paused===1,settings,generatedCount:value.generatedCount,lastError:value.lastError,nextDates,waitingForCompletion:waiting,templateTaskCount:nodes.length,workerCompletedAt:null,instances:instances.slice(-30).reverse().map(v=>({taskId:v.taskId,projectId:v.taskId===null?null:this.ports.binding.resourceId,date:v.originalDate,ordinal:v.ordinal,state:v.state}))};
 }
 seriesForTask(taskId:string){const instance=this.#rows('series-instance').find(v=>v.taskId===taskId),series=instance?this.ports.versions.find(v=>!v.deleted&&v.kind==='series'&&body(v).record.id===instance.seriesId):undefined;return series?this.seriesView(series):null;}
 async #instance(seriesId:string,revision:number,date:string,ordinal:number,taskId:string|null,state:string,request:SavedSharedRequest,key:string){const occurrence=await privateExecutionId(this.ports.binding.scopeId,seriesId,key);return this.#edit(this.ports.body('series-instance','shared_series_instances',{series_id:seriesId,occurrence_key:occurrence,task_id:taskId,original_date:date,ordinal,state,created_at:request.createdAt}));}
 async series(request:SavedSharedRequest,taskId:string){
  this.#organize();const input=request.body,task=this.ports.row(this.#version('task',taskId));if(input.taskRevision!==task.revision)throw new Error('SHARED_TASK_CONFLICT');
  const existing=typeof input.seriesId==='string'?this.#version('series',input.seriesId):null,old=existing?this.ports.row(existing):null;if(existing&&this.seriesForTask(taskId)?.id!==old!.id)throw new Error('SERIES_SOURCE_UNAVAILABLE');
  if(input.skipInstance===true){exactKeys(input,['skipInstance','seriesId','expectedRevision','taskRevision','requestId']);if(!existing||input.expectedRevision!==existing.revision||task.completedAt!==null)throw new Error('SERIES_COMPLETED_INSTANCE');const item=this.#instances(String(old!.id)).find(v=>v.taskId===taskId);if(!item||item.state!=='created')throw new Error('SERIES_SOURCE_UNAVAILABLE');
   const subtree=[this.#version('task',taskId)];for(let at=0;at<subtree.length;at++)subtree.push(...this.ports.versions.filter(v=>!v.deleted&&v.kind==='task'&&v.parentId===subtree[at].entityId&&!subtree.some(s=>s.entityId===v.entityId)));if(subtree.some(v=>body(v).record.completed_at!==null)||subtree.length>90)throw new Error('SERIES_COMPLETED_INSTANCE');
   const edits=subtree.reverse().map(v=>this.#edit(body(v),v.revision,'delete'));const updated=structuredClone(body(existing).record);updated.revision=existing.revision+1;updated.updated_at=request.createdAt;edits.push(this.#edit(this.ports.body('series','shared_task_series',updated),existing.revision));edits.push(await this.#instance(String(old!.id),existing.revision,String(item.originalDate),Number(item.ordinal),taskId,'skipped',request,`skip:${request.id}`));return{edits,result:{series:{...this.seriesView(existing),instances:this.seriesView(existing).instances.map(v=>v.taskId===taskId?{...v,state:'skipped'}:v)}}};
  }
  const settings=privateSeriesSettings(input.settings);
  if(old&&!input.refreshTemplate&&privateSeriesSettings(old.rule).cloneChildren!==settings.cloneChildren)throw new Error('SERIES_REFRESH_REQUIRED');
  const nodes=existing&&!input.refreshTemplate?parse(body(existing).record.template_json):this.#seriesNodes(taskId,settings.cloneChildren);if(!Array.isArray(nodes)||!nodes.length||nodes.length>20)throw new Error('SERIES_TEMPLATE_LIMIT');
  if(input.preview===true)return{edits:[],result:{preview:{taskCount:nodes.length,checklistCount:nodes.reduce((n,v)=>n+(object(v).checklists as unknown[]).length,0),preservesExistingInstances:true,copiesDiscussion:false,copiesFiles:false}}};
  if(typeof input.paused!=='boolean'||existing&&input.expectedRevision!==existing.revision)throw new Error('SERIES_CONFLICT');if(!existing&&this.seriesForTask(taskId))throw new Error('SERIES_EXISTS');
  const id=existing?String(old!.id):await privateExecutionId(this.ports.binding.scopeId,'series',request.id),record=existing?structuredClone(body(existing).record):this.ports.newRecord('shared_task_series',{},request.createdAt,id),edits:ProductEdit[]=[];
  Object.assign(record,{rule_json:JSON.stringify(settings),template_json:JSON.stringify(nodes),paused:input.paused?1:0,revision:(existing?.revision??0)+1,updated_at:request.createdAt});
  if(!existing)Object.assign(record,{source_task_id:taskId,owner_id:this.ports.actorId,cursor_date:task.dueDate??task.startDate??todayCivilDate(settings.recurrence.calendarContext,new Date(request.createdAt)),generated_count:1,last_error:null,checked_at:null});
  const updated=this.ports.body('series','shared_task_series',record);edits.push(this.#edit(updated,existing?.revision??0));if(!existing)edits.push(await this.#instance(id,1,String(record.cursor_date),1,taskId,'created',request,'source'));
  const view=this.seriesView({protocol:1,scopeId:this.ports.binding.scopeId,entityId:sharedRecordKey('series',record),kind:'series',revision:Number(record.revision),parentId:sharedBodyParent(updated),deleted:false,metadata:sharedBodyMetadata(updated),body:updated});if(!existing)view.instances=[{taskId,projectId:this.ports.binding.resourceId,date:String(record.cursor_date),ordinal:1,state:'created'}];return{edits,result:{series:view}};
 }
 async advanceSeries(request:SavedSharedRequest){
  this.#organize();exactKeys(request.body,['now']);if(typeof request.body.now!=='string'||!Number.isFinite(Date.parse(request.body.now))||Math.abs(Date.parse(request.body.now)-Date.parse(request.createdAt))>300000)throw new Error('SERIES_INVALID');
  for(const version of this.ports.versions.filter(v=>v.kind==='series'&&!v.deleted).sort((a,b)=>a.entityId.localeCompare(b.entityId))){const value=this.ports.row(version),settings=privateSeriesSettings(value.rule);if(value.paused===1||Number(value.generatedCount)>=settings.limit)continue;
   const today=todayCivilDate(settings.recurrence.calendarContext,new Date(request.body.now));let date=settings.timing==='after-completion'?this.#after(value,settings):addCivilDays(String(value.cursorDate),1);if(!date)continue;
   if(settings.timing==='schedule'){for(let scan=0;scan<1830&&date<=today;scan++,date=addCivilDays(date,1)){if(settings.recurrence.rangeEnd&&date>settings.recurrence.rangeEnd)break;if(recurrenceMatchesDate(settings.recurrence.rangeStart,settings.recurrence,date))break;}}
   if(date>today||settings.recurrence.rangeEnd&&date>settings.recurrence.rangeEnd||settings.timing==='schedule'&&!recurrenceMatchesDate(settings.recurrence.rangeStart,settings.recurrence,date))continue;
   const ordinal=Number(value.generatedCount)+1,excluded=settings.excludedDates.includes(date),key=settings.timing==='schedule'?date:`after:${ordinal}:${date}`,runId=await privateExecutionId(this.ports.binding.scopeId,String(value.id),key),nodes=parse(body(version).record.template_json);if(!Array.isArray(nodes)||!nodes.length||nodes.length>20)throw new Error('SERIES_TEMPLATE_UNAVAILABLE');
   const edits:ProductEdit[]=[],keys=new Map<string,string>();let versions=this.ports.versions;
   if(!excluded)for(const raw of nodes){const node=object(raw);keys.set(String(node.sourceId),await privateExecutionId(this.ports.binding.scopeId,runId,String(node.sourceId)));}
   if(!excluded)for(const raw of nodes){const node=object(raw),id=keys.get(String(node.sourceId))!,shift=(offset:unknown)=>offset===null?null:addCivilDays(date!,Number(offset)),checklists=[];
    for(const listRaw of node.checklists as unknown[]){const list=object(listRaw),items=[];for(const itemRaw of list.items as unknown[]){const item=object(itemRaw);const retained={...item};delete retained.dueOffset;items.push({...retained,id:await privateExecutionId(this.ports.binding.scopeId,runId,id,String(list.id),String(item.id)),done:false,dueDate:shift(item.dueOffset),linkedTaskId:keys.get(String(item.linkedTaskId))??null});}checklists.push({...list,id:await privateExecutionId(this.ports.binding.scopeId,runId,id,String(list.id)),items});}
    const input={title:node.title,description:node.description,tags:node.tags,entryType:node.entryType,statusId:node.statusId,categoryId:node.categoryId,assigneeId:node.assigneeId,priority:node.priority,customFields:node.customFields,checklists,dueDate:shift(node.dueOffset),startDate:shift(node.startOffset),startTime:node.startTime,endTime:node.endTime,parentTaskId:keys.get(String(node.parentSourceId))??null,labelIds:node.labelIds,approverIds:node.approverIds,dependsOnIds:(node.dependsOnSources as string[]).flatMap(key=>keys.has(key)?[keys.get(key)!]:[])};
    const plan=await this.ports.task(input,id,null,request,versions);edits.push(...plan.edits);versions=this.#overlay(versions,plan.edits);
   }
   edits.push(await this.#instance(String(value.id),version.revision,date,ordinal,excluded?null:keys.get(String(object(nodes[0]).sourceId))!,excluded?'skipped':'created',request,key));
   const record=structuredClone(body(version).record);Object.assign(record,{generated_count:ordinal,cursor_date:date,revision:version.revision+1,last_error:null,checked_at:request.createdAt,updated_at:request.createdAt});edits.push(this.#edit(this.ports.body('series','shared_task_series',record),version.revision));return{edits,result:{advanced:true,seriesId:value.id,ordinal,date}};
  }return{edits:[],result:{advanced:false}};
 }
}
