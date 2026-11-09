import type {SprintDraft,PlanningConfig} from './shared-planning';

export type PlanningSprintEdit={sprintId:string|null;expectedRevision:number;draft:SprintDraft};
export type PlanningCompletionDraft={sprintId:string;expectedRevision:number;fingerprint:string;tasks:{id:string;revision:number}[];choices:Record<string,string>};
export type PlanningCommand=
 |{kind:'settings';requestId:string;expectedRevision:number;config:Omit<PlanningConfig,'revision'>}
 |{kind:'sprint';requestId:string;expectedRevision:number;sprintId:string|null;draft:SprintDraft}
 |{kind:'transition';requestId:string;expectedRevision:number;sprintId:string;fingerprint:string;action:'start'|'complete';outcomes?:{taskId:string;expectedRevision:number;destinationSprintId:string|null}[]};
export type PlanningDeviceDraft={version:1;projectId:string;observedAt:string;form:PlanningSprintEdit|null;completion:PlanningCompletionDraft|null;pending:PlanningCommand|null};
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
const revision=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const text=(value:unknown,max:number)=>typeof value==='string'&&[...value].length<=max;
const date=(value:unknown)=>typeof value==='string'&&(value===''||/^\d{4}-\d{2}-\d{2}$/.test(value));
const fingerprint=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const unique=(items:unknown[])=>new Set(items).size===items.length;
function sprintDraft(value:unknown){
 if(!object(value)||!keys(value,['title','goal','startDate','endDate','calendarMode','calendarContext'])||!text(value.title,160)||!text(value.goal,5000)||!date(value.startDate)||!date(value.endDate)||!['profane','sacred','lunar'].includes(String(value.calendarMode)))return false;
 const context=value.calendarContext;
 return object(context)&&keys(context,['version','timeZone','gregorianYearStart'])&&context.version===2&&text(context.timeZone,200)&&context.timeZone!==''&&['january','march'].includes(String(context.gregorianYearStart));
}
function editor(value:unknown){return object(value)&&keys(value,['sprintId','expectedRevision','draft'])&&(value.sprintId===null||id(value.sprintId))&&revision(value.expectedRevision)&&sprintDraft(value.draft);}
function completion(value:unknown){
 if(!object(value)||!keys(value,['sprintId','expectedRevision','fingerprint','tasks','choices'])||!id(value.sprintId)||!revision(value.expectedRevision)||!fingerprint(value.fingerprint)||!Array.isArray(value.tasks)||value.tasks.length>20000||!object(value.choices))return false;
 if(!value.tasks.every(task=>object(task)&&keys(task,['id','revision'])&&id(task.id)&&revision(task.revision))||!unique(value.tasks.map(task=>task.id)))return false;
 const ids=new Set(value.tasks.map(task=>task.id));return Object.entries(value.choices).every(([task,target])=>ids.has(task)&&(target===''||id(target)));
}
function command(value:unknown){
 if(!object(value)||!id(value.requestId)||!revision(value.expectedRevision))return false;
 if(value.kind==='settings')return keys(value,['kind','requestId','expectedRevision','config'])&&object(value.config)&&keys(value.config,['enabled','estimateUnit'])&&typeof value.config.enabled==='boolean'&&['points','hours'].includes(String(value.config.estimateUnit));
 if(value.kind==='sprint')return keys(value,['kind','requestId','expectedRevision','sprintId','draft'])&&(value.sprintId===null||id(value.sprintId))&&sprintDraft(value.draft);
 if(value.kind!=='transition'||!keys(value,['kind','requestId','expectedRevision','sprintId','fingerprint','action','outcomes'])||!id(value.sprintId)||!fingerprint(value.fingerprint))return false;
 if(value.action==='start')return value.outcomes===undefined;
 return value.action==='complete'&&Array.isArray(value.outcomes)&&value.outcomes.length<=20000&&value.outcomes.every(row=>object(row)&&keys(row,['taskId','expectedRevision','destinationSprintId'])&&id(row.taskId)&&revision(row.expectedRevision)&&(row.destinationSprintId===null||id(row.destinationSprintId)))&&unique(value.outcomes.map(row=>row.taskId));
}
/** No task titles, values, members, cached permissions or report data enter this journal. */
export function validatePlanningDeviceDraft(value:unknown,projectId:string):PlanningDeviceDraft{
 if(!object(value)||!keys(value,['version','projectId','observedAt','form','completion','pending'])||value.version!==1||value.projectId!==projectId||typeof value.observedAt!=='string'||!Number.isFinite(Date.parse(value.observedAt))||value.form!==null&&!editor(value.form)||value.completion!==null&&!completion(value.completion)||value.pending!==null&&!command(value.pending)||value.form!==null&&value.completion!==null)throw new Error('PLANNING_DEVICE_DRAFT_INVALID');
 return structuredClone(value) as PlanningDeviceDraft;
}
/** Called only after a definitive rejection; an uncertain send must retain its command. */
export function planningDraftAfterRejectedCommand(value:PlanningDeviceDraft):PlanningDeviceDraft|null{
 return value.form||value.completion?{...structuredClone(value),pending:null}:null;
}
/** Preserve only decisions still referring to the same task revision after an explicit refresh. */
export function planningCompletionChoices(previous:PlanningCompletionDraft|null,tasks:{id:string;revision:number}[],sprints:{id:string;state:string}[],source:string){
 const choices:Record<string,string>={},targets=new Set(sprints.filter(row=>row.id!==source&&row.state!=='completed').map(row=>row.id)),revisions=new Map(previous?.tasks.map(row=>[row.id,row.revision]));
 for(const task of tasks){const choice=previous?.choices[task.id];if(revisions.get(task.id)===task.revision&&choice&&(choice==='backlog'||targets.has(choice)))choices[task.id]=choice;}
 return choices;
}
