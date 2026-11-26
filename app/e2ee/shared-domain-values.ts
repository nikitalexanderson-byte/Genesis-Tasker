import {assertTechnical,exactKeys} from './keys.ts';
import {calendarContext,isCivilDate} from '../calendar-context.ts';
import {editableSharedViewDefinition} from '../shared-saved-view-model.ts';
import {isRecurrencePattern} from '../task-recurrence.ts';

type Row=Record<string,unknown>;
function invalid():never{throw new Error('E2EE_SHARED_DOMAIN_INVALID');}
export function sharedObject(value:unknown):asserts value is Row{if(!value||typeof value!=='object'||Array.isArray(value))invalid();}
function text(value:unknown,max=2000,blank=true):asserts value is string{if(typeof value!=='string'||value.length>max||!blank&&!value.trim())invalid();}
function integer(value:unknown,min=0,max=100000):asserts value is number{if(!Number.isSafeInteger(value)||Number(value)<min||Number(value)>max)invalid();}
function array(value:unknown,max=200):asserts value is unknown[]{if(!Array.isArray(value)||value.length>max)invalid();}
function ids(value:unknown,max=200){array(value,max);if(new Set(value).size!==value.length)invalid();value.forEach(assertTechnical);}
function context(value:unknown){sharedObject(value);calendarContext(value as Parameters<typeof calendarContext>[0]);}
function mode(value:unknown){if(!['profane','sacred','lunar'].includes(String(value)))invalid();}
function scalar(value:unknown){if(value===null||typeof value==='boolean')return;if(typeof value==='number'){if(!Number.isFinite(value)||Math.abs(value)>1e12)invalid();return;}if(typeof value==='string'){text(value,100000);return;}array(value,200);for(const item of value)text(item,2000);}
function offset(value:unknown){if(value===null)return;exactKeys(value,['amount','unit']);integer(value.amount,-10000,10000);if(!['day','month','year'].includes(String(value.unit)))invalid();}
export function validateSharedReviewPolicy(value:unknown){exactKeys(value,['enabled','checked','confirmed','deletable']);if(typeof value.enabled!=='boolean')invalid();
 for(const name of ['checked','confirmed','deletable']){const rule:unknown=value[name];exactKeys(rule,['group','userIds']);if(!['everyone','editors','organizers','selected'].includes(String(rule.group)))invalid();ids(rule.userIds);}
 return value;
}
export function validateSharedAutomation(value:unknown){exactKeys(value,['schemaVersion','trigger','conditions','actions','calendarMode','calendarContext']);if(value.schemaVersion!==1)invalid();context(value.calendarContext);mode(value.calendarMode);
 sharedObject(value.trigger);const trigger=value.trigger;if(!['created','status','assignee','dueSoon','due','completed','schedule'].includes(String(trigger.type))||Object.keys(trigger).some(key=>!['type','leadDays','time','recurrence','target'].includes(key)))invalid();
 if(trigger.leadDays!==undefined)integer(trigger.leadDays,0,3650);if(trigger.time!==undefined&&(typeof trigger.time!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(trigger.time)))invalid();
 if(trigger.target!==undefined&&!['project','tasks'].includes(String(trigger.target)))invalid();
 if(trigger.type==='schedule'){sharedObject(trigger.recurrence);const recurrence=trigger.recurrence;if(recurrence.calendarContext!==undefined)context(recurrence.calendarContext);if(typeof recurrence.enabled!=='boolean'||!['classic','genesis','lunar'].includes(String(recurrence.mode))||!isRecurrencePattern(recurrence.pattern)||recurrence.pattern==='none')invalid();integer(recurrence.interval,1,1000);
  for(const name of ['days','months','pyatas']){array(recurrence[name],1000);for(const item of recurrence[name])integer(item,0,1000);}for(const name of ['rangeStart','rangeEnd'])if(typeof recurrence[name]!=='string'||recurrence[name]!==''&&!isCivilDate(recurrence[name]))invalid();}
 array(value.conditions,100);for(const item of value.conditions){sharedObject(item);if(Object.keys(item).some(key=>!['field','fieldId','operator','value'].includes(key))||!['project','status','label','assignee','priority','custom'].includes(String(item.field))||!['eq','ne','missing','present','contains','notContains','gt','gte','lt','lte'].includes(String(item.operator)))invalid();if(item.field==='custom')assertTechnical(item.fieldId);scalar(item.value);}
 array(value.actions,100);if(!value.actions.length)invalid();for(const item of value.actions){sharedObject(item);if(Object.keys(item).some(key=>!['type','value','fieldId','mode','date','offset','templateId','options','recipientIds','message','unavailable'].includes(key))||!['status','assignee','priority','addLabels','removeLabels','due','custom','createTemplate','notify'].includes(String(item.type)))invalid();
  if(item.value!==undefined)scalar(item.value);if(item.fieldId!==undefined)assertTechnical(item.fieldId);if(item.type==='custom'&&!item.fieldId)invalid();if(item.type==='priority')integer(item.value,0,5);
  if(item.type==='createTemplate')assertTechnical(item.templateId);if(item.options!==undefined)sharedObject(item.options);if(item.recipientIds!==undefined)ids(item.recipientIds);
  if(item.message!==undefined)text(item.message,10000);if(item.mode!==undefined&&!['set','shift','clear'].includes(String(item.mode)))invalid();if(item.date!==undefined&&item.date!==null&&(typeof item.date!=='string'||!isCivilDate(item.date)))invalid();if(item.offset!==undefined)offset(item.offset);
 }return value;
}
export function validateSharedTemplateManifest(value:unknown){exactKeys(value,['schemaVersion','kind','calendarMode','calendarContext','projects','labels','fields','tasks']);if(value.schemaVersion!==1||!['task','project'].includes(String(value.kind)))invalid();context(value.calendarContext);mode(value.calendarMode);
 const keys=(rows:unknown,max:number)=>{array(rows,max);const seen=new Set<string>();for(const row of rows){sharedObject(row);assertTechnical(row.key);if(seen.has(row.key))invalid();seen.add(row.key);}return seen;};
 const projects=keys(value.projects,100),tasks=keys(value.tasks,5000),labels=keys(value.labels,200),fields=keys(value.fields,200);if(!projects.size)invalid();
 const parentEdges=new Map<string,string|null>();const graph=(edges:Map<string,string|null>)=>{for(const start of edges.keys()){let next:string|null=start;const seen=new Set<string>();while(next!==null){if(seen.has(next)||!edges.has(next))invalid();seen.add(next);next=edges.get(next)!;}}};
 const statuses=new Map<string,Set<string>>(),categories=new Map<string,Set<string>>();
 for(const input of value.projects as unknown[]){sharedObject(input);const row=input;if(row.parentKey!==null&&!projects.has(String(row.parentKey)))invalid();parentEdges.set(String(row.key),row.parentKey as string|null);text(row.title,2000,false);text(row.description,100000);
  if(!['list','board'].includes(String(row.layout))||!['project','task-list'].includes(String(row.kind)))invalid();statuses.set(String(row.key),keys(row.statuses,200));categories.set(String(row.key),keys(row.categories,200));ids(row.labelKeys);if((row.labelKeys as string[]).some(id=>!labels.has(id)))invalid();array(row.tags,100);for(const tag of row.tags)text(tag,240);
  for(const status of row.statuses as unknown[]){sharedObject(status);text(status.title,2000,false);if(typeof status.isDone!=='boolean')invalid();text(status.color,64);integer(status.taskTitleLines,0,20);integer(status.visibleTaskCount,0,10000);}
 }graph(parentEdges);parentEdges.clear();
 for(const input of value.tasks as unknown[]){sharedObject(input);const row=input;if(!projects.has(String(row.projectKey))||row.parentKey!==null&&!tasks.has(String(row.parentKey)))invalid();parentEdges.set(String(row.key),row.parentKey as string|null);text(row.title,2000,false);text(row.description,100000);
  if(!['task','meeting','event','birthday'].includes(String(row.entryType))||!statuses.get(String(row.projectKey))?.has(String(row.statusKey))||row.categoryKey!==null&&!categories.get(String(row.projectKey))?.has(String(row.categoryKey)))invalid();integer(row.priority,0,5);ids(row.approverIds);if(typeof row.approvalRequired!=='boolean')invalid();ids(row.dependsOnKeys,1000);if((row.dependsOnKeys as string[]).some(id=>id===row.key||!tasks.has(id)))invalid();ids(row.labelKeys);if((row.labelKeys as string[]).some(id=>!labels.has(id)))invalid();
  if(row.assigneeId!==null)assertTechnical(row.assigneeId);offset(row.due);offset(row.start);for(const name of ['startTime','endTime'])if(row[name]!==null&&(typeof row[name]!=='string'||!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(row[name]))))invalid();
  array(row.checklists,100);for(const list of row.checklists){sharedObject(list);assertTechnical(list.key);text(list.title,2000);array(list.items,1000);for(const item of list.items){sharedObject(item);assertTechnical(item.key);text(item.title,2000);if(item.assigneeId!==null)assertTechnical(item.assigneeId);offset(item.due);if(item.linkedTaskKey!==null&&!tasks.has(String(item.linkedTaskKey)))invalid();}}
  sharedObject(row.customValues);for(const [id,content]of Object.entries(row.customValues)){if(!fields.has(id))invalid();scalar(content);}for(const estimate of [row.storyPoints,row.estimateHours])if(estimate!==undefined&&estimate!==null&&(typeof estimate!=='number'||!Number.isFinite(estimate)||estimate<0||estimate>1e9))invalid();
 }graph(parentEdges);
 for(const input of value.fields as unknown[]){sharedObject(input);text(input.title,2000,false);if(!['text','number','date','select','multi','checkbox','url'].includes(String(input.type)))invalid();if(input.projectKey!==null&&!projects.has(String(input.projectKey)))invalid();array(input.options,10000);const optionIds=new Set<string>();for(const option of input.options){sharedObject(option);assertTechnical(option.id);text(option.title,2000);if(optionIds.has(option.id)||typeof option.archived!=='boolean')invalid();optionIds.add(option.id);}for(const name of ['required','showCard','showList'])if(typeof input[name]!=='boolean')invalid();}
 return value as Row&{kind:string;projects:unknown[];tasks:unknown[]};
}
export function validateSharedSavedDefinition(value:unknown){if(!editableSharedViewDefinition(value))invalid();context(value.calendarContext);text(value.title,2000,false);return value;}
