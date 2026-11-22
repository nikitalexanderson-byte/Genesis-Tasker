import {assertTechnical} from './keys.ts';
import {samePrivateJson} from './product-json.ts';
import {validateSharedAutomation,validateSharedTemplateManifest} from './shared-domain-values.ts';
import {addCivilDays,calendarContext,civilDayNumber,isCivilDate,type CalendarContext} from '../calendar-context.ts';
import {lunarDateParts,lunarMonthStartDate,lunarYearPeriod,sacredDateParts,sacredToCivilDate,sacredYearStartDate} from '../calendar-astronomy.ts';
import {recurrenceMatchesDate,type RecurrenceConfig} from '../task-recurrence.ts';
import type {AutomationDefinition,AutomationEffects} from '../shared-automations.ts';
import type {TemplateManifest,TemplateApplyOptions,TemplateOffset} from '../shared-templates.ts';
import type {CalendarMode} from '../calendar-data.ts';
import type {SharedSeriesSettings} from '../shared-series.ts';

export type ExecutionRow=Record<string,unknown>;
export type ExecutionDirectory={projectId:string;members:ExecutionRow[];statuses:ExecutionRow[];labels:ExecutionRow[];fields:ExecutionRow[];templates:ExecutionRow[]};
const fail=(code='AUTOMATION_INVALID'):never=>{throw new Error(code);};
const row=(value:unknown):ExecutionRow=>{if(!value||typeof value!=='object'||Array.isArray(value))return fail();return value as ExecutionRow;};
const ids=(value:unknown,maximum=200):string[]=>{if(!Array.isArray(value)||value.length>maximum||new Set(value).size!==value.length)return fail();for(const id of value)assertTechnical(id);return value as string[];};
export async function privateExecutionId(scopeId:string,...coordinates:(string|number)[]){
 const bytes=new TextEncoder().encode(JSON.stringify(['genesis-private-execution-v1',scopeId,...coordinates]));
 try{const hash=new Uint8Array(await crypto.subtle.digest('SHA-256',bytes));hash[6]=(hash[6]&15)|80;hash[8]=(hash[8]&63)|128;const hex=Array.from(hash.subarray(0,16),b=>b.toString(16).padStart(2,'0')).join('');return`${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;}finally{bytes.fill(0);}
}
/** The three calendar algorithms and clamping policy match template-dates.php.
 * Date arithmetic never depends on the executing device's local time zone. */
export function privateTemplateDate(anchor:string,offset:TemplateOffset,mode:CalendarMode,raw:CalendarContext){
 const context=calendarContext(raw),limits={day:74000,month:2400,year:200};
 if(!isCivilDate(anchor)||!Object.hasOwn(limits,offset.unit)||!Number.isSafeInteger(offset.amount)||Math.abs(offset.amount)>limits[offset.unit])return fail('TEMPLATE_DATE_INVALID');
 let date:string,clamped=false;
 if(offset.unit==='day')date=addCivilDays(anchor,offset.amount);
 else if(mode==='profane'){
  const [year,month,day]=anchor.split('-').map(Number),index=year*12+month-1+offset.amount*(offset.unit==='year'?12:1),y=Math.floor(index/12),m=index-y*12;
  const length=new Date(Date.UTC(y,m+1,0)).getUTCDate(),d=Math.min(day,length);clamped=d!==day;date=`${String(y).padStart(4,'0')}-${String(m+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
 }else if(mode==='sacred'){
  const source=sacredDateParts(anchor,context);let year=source.sacredYear,month=source.monthIndex;
  if(offset.unit==='year')year+=offset.amount;else{const index=year*13+month+offset.amount;year=Math.floor(index/13);month=index-year*13;}
  const length=month===12?civilDayNumber(sacredYearStartDate(year+1,context))-civilDayNumber(sacredYearStartDate(year,context))-360:30,day=Math.min(source.day,length);clamped=day!==source.day;date=sacredToCivilDate(year,month,day,context);
 }else if(mode==='lunar'){
  const source=lunarDateParts(anchor,context);let month=source.monthIndex;
  if(offset.unit==='month')month+=offset.amount;else{const year=lunarYearPeriod(source.year.sacredYear+offset.amount,context),ordinal=Math.min(source.monthOrdinal,year.monthCount);clamped=ordinal!==source.monthOrdinal;month=year.startMonthIndex+ordinal-1;}
  const start=lunarMonthStartDate(month,context),length=civilDayNumber(lunarMonthStartDate(month+1,context))-civilDayNumber(start),day=Math.min(source.day,length);clamped=clamped||day!==source.day;date=addCivilDays(start,day-1);
 }else return fail('TEMPLATE_DATE_INVALID');
 if(!isCivilDate(date)||date<'1900-01-01'||date>'2100-12-31')return fail('TEMPLATE_DATE_OUTSIDE_RANGE');return{date,clamped};
}
export function privateCustomValue(field:ExecutionRow,value:unknown){
 if(value===null)return value;const options=Array.isArray(field.options)?field.options as ExecutionRow[]:[],active=new Set(options.filter(v=>!v.archived).map(v=>v.id));
 switch(field.type){
  case'text':case'url':if(typeof value!=='string'||value.length>100000)return fail('CUSTOM_FIELD_VALUE_INVALID');if(field.type==='url'&&value&&!/^https?:\/\//i.test(value))return fail('CUSTOM_FIELD_VALUE_INVALID');break;
  case'number':if(typeof value!=='number'||!Number.isFinite(value)||Math.abs(value)>1e12)return fail('CUSTOM_FIELD_VALUE_INVALID');break;
  case'date':if(typeof value!=='string'||!isCivilDate(value))return fail('CUSTOM_FIELD_VALUE_INVALID');break;
  case'checkbox':if(typeof value!=='boolean')return fail('CUSTOM_FIELD_VALUE_INVALID');break;
  case'select':if(!active.has(value))return fail('CUSTOM_FIELD_VALUE_INVALID');break;
  case'multi':if(ids(value).some(id=>!active.has(id)))return fail('CUSTOM_FIELD_VALUE_INVALID');break;
  default:return fail('CUSTOM_FIELD_UNAVAILABLE');
 }return structuredClone(value);
}
export function privateAutomationDefinition(input:unknown,directory:ExecutionDirectory):AutomationDefinition{
 const definition=validateSharedAutomation(structuredClone(input)) as unknown as AutomationDefinition,projectOnly=definition.trigger.type==='schedule'&&(definition.trigger.target??'project')==='project';
 if(definition.conditions.length>20||definition.actions.length>10||definition.trigger.type==='dueSoon'&&(!Number.isSafeInteger(definition.trigger.leadDays??1)||(definition.trigger.leadDays??1)<1||(definition.trigger.leadDays??1)>366))return fail();
 const members=new Set(directory.members.map(v=>v.userId)),statuses=new Set(directory.statuses.map(v=>v.id)),labels=new Set(directory.labels.map(v=>v.id)),fields=new Map(directory.fields.filter(v=>!v.archived).map(v=>[v.id,v]));
 for(const condition of definition.conditions){
  if(projectOnly&&condition.field!=='project')return fail();let allowed=['eq','ne','missing','present'];
  if(condition.field==='label')allowed=['contains','notContains'];
  const field=condition.field==='custom'?fields.get(condition.fieldId):undefined;if(condition.field==='custom'&&!field)return fail('CUSTOM_FIELD_UNAVAILABLE');
  if(condition.field==='priority'||field&&['number','date'].includes(String(field.type)))allowed.push('gt','gte','lt','lte');if(field?.type==='multi')allowed.push('contains','notContains');if(!allowed.includes(condition.operator))return fail();
  if(['missing','present'].includes(condition.operator))continue;
  const value=condition.value;if(field)privateCustomValue(field,['contains','notContains'].includes(condition.operator)?[value]:value);
  else if(condition.field==='project'&&value!==directory.projectId||condition.field==='status'&&!statuses.has(value)||condition.field==='label'&&!labels.has(value)||condition.field==='assignee'&&value!==null&&!members.has(value)||condition.field==='priority'&&(!Number.isSafeInteger(value)||Number(value)<0||Number(value)>3))return fail();
 }
 for(const action of definition.actions){
  if(action.unavailable)return fail('AUTOMATION_TEMPLATE_BLOCKED');if(projectOnly&&!['createTemplate','notify'].includes(action.type))return fail();
  if(action.type==='status'&&!statuses.has(action.value)||action.type==='assignee'&&action.value!==null&&action.value!==undefined&&!members.has(action.value)||action.type==='priority'&&(!Number.isSafeInteger(action.value)||Number(action.value)<0||Number(action.value)>3))return fail();
  if(['addLabels','removeLabels'].includes(action.type)&&ids(action.value,30).some(id=>!labels.has(id)))return fail();
  if(action.type==='custom'){const field=fields.get(action.fieldId);if(!field)return fail('CUSTOM_FIELD_UNAVAILABLE');privateCustomValue(field,action.value??null);}
  if(action.type==='due'){if(!['set','shift','clear'].includes(action.mode??''))return fail();if(action.mode==='set'&&(typeof action.date!=='string'||!isCivilDate(action.date)))return fail();if(action.mode==='shift'){if(!action.offset)return fail();privateTemplateDate('2000-06-15',action.offset,definition.calendarMode,definition.calendarContext);}}
  if(action.type==='notify'&&(!ids(action.recipientIds,50).length||action.recipientIds!.some(id=>!members.has(id))||typeof action.message!=='string'||action.message.length>1000))return fail('AUTOMATION_RECIPIENT_UNAVAILABLE');
  if(action.type==='createTemplate'&&!directory.templates.some(v=>v.id===action.templateId&&!v.deleted&&v.kind==='task'))return fail('AUTOMATION_TASK_TEMPLATE_REQUIRED');
 }return definition;
}
export function privateAutomationMatches(definition:AutomationDefinition,projectId:string,task:ExecutionRow|null){
 return definition.conditions.every(condition=>{
  const actual=condition.field==='project'?projectId:condition.field==='custom'?(task?.customFields as ExecutionRow|undefined)?.[condition.fieldId!]??null:task?.[({status:'statusId',label:'labelIds',assignee:'assigneeId',priority:'priority'} as const)[condition.field as 'status'|'label'|'assignee'|'priority']]??null,wanted=condition.value,exists=actual!==null;
  switch(condition.operator){case'missing':return!exists;case'present':return exists;case'eq':return samePrivateJson(actual,wanted);case'ne':return!samePrivateJson(actual,wanted);case'contains':return Array.isArray(actual)&&actual.some(v=>samePrivateJson(v,wanted));case'notContains':return!Array.isArray(actual)||!actual.some(v=>samePrivateJson(v,wanted));
   case'gt':case'gte':case'lt':case'lte':if(!exists||typeof actual!==typeof wanted||typeof actual!=='number'&&typeof actual!=='string')return false;return condition.operator==='gt'?actual>(wanted as never):condition.operator==='gte'?actual>=(wanted as never):condition.operator==='lt'?actual<(wanted as never):actual<=(wanted as never);
  }
 });
}
export function privateAutomationEffects(definition:AutomationDefinition,task:ExecutionRow|null):AutomationEffects{
 const patch:ExecutionRow={},notices:string[]=[];let labels=Array.isArray(task?.labelIds)?[...task.labelIds] as string[]:[],due=task?.dueDate as string|null??null;
 for(const action of definition.actions){switch(action.type){
  case'status':patch.statusId=action.value;break;case'assignee':patch.assigneeId=action.value??null;break;case'priority':patch.priority=action.value;break;
  case'addLabels':labels=[...new Set([...labels,...action.value as string[]])];patch.labelIds=labels;break;case'removeLabels':labels=labels.filter(id=>!(action.value as string[]).includes(id));patch.labelIds=labels;break;
  case'custom':patch.customFields={...(patch.customFields as ExecutionRow??task?.customFields as ExecutionRow??{}),[action.fieldId!]:action.value??null};break;
  case'due':if(action.mode==='clear')due=null;else if(action.mode==='set')due=action.date!;else{if(!due)return fail('AUTOMATION_DUE_REQUIRED');const shifted=privateTemplateDate(due,action.offset!,definition.calendarMode,definition.calendarContext);due=shifted.date;if(shifted.clamped)notices.push('TEMPLATE_DATE_CLAMPED');}patch.dueDate=due;break;
 }}if(Object.keys(patch).length&&!task)return fail('AUTOMATION_TASK_REQUIRED');return{updated:!!Object.keys(patch).length,patch,createdTaskCount:0,notifications:0,notices};
}
export function privateSeriesSettings(input:unknown):SharedSeriesSettings{
 const value=row(structuredClone(input)),recurrence=row(value.recurrence);if(Object.keys(value).some(k=>!['timing','delayDays','limit','cloneChildren','excludedDates','recurrence'].includes(k))||!['schedule','after-completion'].includes(String(value.timing))||!Number.isSafeInteger(value.delayDays)||Number(value.delayDays)<1||Number(value.delayDays)>366||!Number.isSafeInteger(value.limit)||Number(value.limit)<1||Number(value.limit)>1000||typeof value.cloneChildren!=='boolean'||!Array.isArray(value.excludedDates)||value.excludedDates.length>1000||value.excludedDates.some(v=>typeof v!=='string'||!isCivilDate(v))||typeof recurrence.rangeStart!=='string'||!isCivilDate(recurrence.rangeStart)||typeof recurrence.rangeEnd!=='string'||recurrence.rangeEnd!==''&&!isCivilDate(recurrence.rangeEnd))return fail('SERIES_INVALID');
 calendarContext(recurrence.calendarContext as CalendarContext);recurrenceMatchesDate(recurrence.rangeStart,recurrence as unknown as RecurrenceConfig,recurrence.rangeStart);value.excludedDates=[...new Set(value.excludedDates)].sort();return value as unknown as SharedSeriesSettings;
}
/** Task-template application stays in this project. All destination mappings
 * are checked locally against the normal decrypted catalogue before staging. */
export async function privateTaskTemplate(input:unknown,options:Partial<TemplateApplyOptions>,anchor:string,directory:ExecutionDirectory,scopeId:string,operationId:string){
 const manifest=validateSharedTemplateManifest(input) as unknown as TemplateManifest;if(manifest.kind!=='task'||manifest.projects.length!==1||options.projectId!==undefined&&options.projectId!==directory.projectId||options.parentProjectId||options.boardStatusId)return fail('AUTOMATION_TASK_TEMPLATE_REQUIRED');
 const include=options.include??{},source=manifest.projects[0],selected=manifest.tasks.filter(v=>include.subtasks!==false||v.parentKey===null);if(selected.length>50)return fail('AUTOMATION_EFFECT_LIMIT');
 const keys=new Map<string,string>();for(const task of selected)keys.set(task.key,await privateExecutionId(scopeId,operationId,'template-task',task.key));
 const member=(id:string|null)=>{if(id===null)return null;const mapped=options.memberMap?.[id]??id;if(!directory.members.some(v=>v.userId===mapped))return fail('INVALID_ASSIGNEE');return mapped;};
 const date=(offset:TemplateOffset|null)=>offset&&include.dates!==false?privateTemplateDate(anchor,offset,manifest.calendarMode,manifest.calendarContext).date:null;
 const tasks:{id:string;input:ExecutionRow}[]=[];
 for(const task of selected){
  const status=options.statusMap?.[`${task.projectKey}:${task.statusKey}`]??options.statusMap?.[task.statusKey]??directory.statuses.find(v=>v.id===task.statusKey||v.title===source.statuses.find(v=>v.key===task.statusKey)?.title&&!v.isDone)?.id;
  if(typeof status!=='string'||!directory.statuses.some(v=>v.id===status))return fail('AUTOMATION_TEMPLATE_BLOCKED');
  const custom:ExecutionRow={};if(include.customFields!==false)for(const [key,value]of Object.entries({...task.customValues,...options.fieldValues?.[task.key]})){
   const fieldId=options.fieldMap?.[`${task.projectKey}:${key}`]??options.fieldMap?.[key]??key;if(fieldId===null)continue;const field=directory.fields.find(v=>v.id===fieldId&&!v.archived);if(!field)return fail('AUTOMATION_TEMPLATE_BLOCKED');
   const mapping=options.optionMap?.[key],mapped=mapping?Array.isArray(value)?value.map(v=>mapping[String(v)]??v):mapping[String(value)]??value:value;custom[fieldId]=privateCustomValue(field,mapped);
  }
  const labels=include.labels===false?[]:task.labelKeys.map(key=>{const original=manifest.labels.find(v=>v.key===key),target=directory.labels.find(v=>v.id===key||original&&v.title===original.title&&v.color===original.color);if(typeof target?.id!=='string')return fail('AUTOMATION_TEMPLATE_BLOCKED');return target.id;});
  const checklists=[];if(include.checklists!==false)for(const list of task.checklists){const listId=await privateExecutionId(scopeId,operationId,task.key,'list',list.key),items=[];for(const item of list.items)items.push({id:await privateExecutionId(scopeId,operationId,task.key,list.key,item.key),title:item.title,done:false,assigneeId:include.assignees===false?null:member(item.assigneeId),dueDate:date(item.due),linkedTaskId:item.linkedTaskKey?keys.get(item.linkedTaskKey)??null:null});checklists.push({id:listId,title:list.title,items});}
  const category=task.categoryKey===null?null:options.categoryMap?.[`${task.projectKey}:${task.categoryKey}`]??options.categoryMap?.[task.categoryKey]??task.categoryKey;
  tasks.push({id:keys.get(task.key)!,input:{title:task.parentKey===null&&options.title!==undefined?options.title:task.title,description:include.descriptions===false?'':task.description,statusId:status,categoryId:category,parentTaskId:task.parentKey?keys.get(task.parentKey)??null:null,entryType:task.entryType,priority:task.priority,tags:include.tags===false?[]:task.tags,labelIds:labels,assigneeId:include.assignees===false?null:member(task.assigneeId),approverIds:include.approvals===false?[]:task.approverIds.map(member),dependsOnIds:include.dependencies===false?[]:task.dependsOnKeys.flatMap(key=>keys.has(key)?[keys.get(key)!]:[]),customFields:custom,checklists,dueDate:date(task.due),startDate:date(task.start),startTime:include.dates===false?null:task.startTime,endTime:include.dates===false?null:task.endTime}});
 }return tasks;
}
