import type {SharedTask} from './cloud-sync';
import type {EstimateDraft} from './shared-planning';

export type PlanningTaskValues={storyPoints?:number|null;estimateHours?:number|null;sprintId?:string|null};
export type PlanningTaskEdit={taskId:string;expectedRevision:number;base:{storyPoints:number|null;estimateHours:number|null;sprintId:string|null};draft:EstimateDraft;touched:{storyPoints:boolean;estimateHours:boolean;destination:boolean};destination:string};
export type PlanningTaskCommand={taskId:string;expectedRevision:number;requestId:string;values:PlanningTaskValues};
export type PlanningTaskDeviceDraft={version:1;projectId:string;edits:PlanningTaskEdit[];pending:PlanningTaskCommand|null};
type TaskBase=Pick<SharedTask,'id'|'revision'|'storyPoints'|'estimateHours'|'sprintId'>;
const object=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const id=(value:unknown):value is string=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,100}$/.test(value);
const revision=(value:unknown)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0;
const estimate=(value:unknown)=>value===null||typeof value==='number'&&Number.isFinite(value)&&value>=0&&value<=1_000_000&&Math.abs(value*100-Math.round(value*100))<=0.000001;
const field=(value:unknown)=>typeof value==='string'&&[...value].length<=80;
const display=(value:number|null|undefined)=>value==null?'':String(value);
const base=(task:TaskBase)=>({storyPoints:task.storyPoints??null,estimateHours:task.estimateHours??null,sprintId:task.sprintId??null});
function editor(value:unknown){
 if(!object(value)||!keys(value,['taskId','expectedRevision','base','draft','touched','destination'])||!id(value.taskId)||!revision(value.expectedRevision)||!object(value.base)||!keys(value.base,['storyPoints','estimateHours','sprintId'])||!estimate(value.base.storyPoints)||!estimate(value.base.estimateHours)||(value.base.sprintId!==null&&!id(value.base.sprintId))||!object(value.draft)||!keys(value.draft,['storyPoints','estimateHours'])||!field(value.draft.storyPoints)||!field(value.draft.estimateHours)||!object(value.touched)||!keys(value.touched,['storyPoints','estimateHours','destination'])||!['storyPoints','estimateHours','destination'].every(key=>typeof (value.touched as Record<string,unknown>)[key]==='boolean')||!id(value.destination))return false;
 return true;
}
function command(value:unknown){
 if(!object(value)||!keys(value,['taskId','expectedRevision','requestId','values'])||!id(value.taskId)||!revision(value.expectedRevision)||!id(value.requestId)||!object(value.values)||!keys(value.values,['storyPoints','estimateHours','sprintId'])||!Object.keys(value.values).length)return false;
 return Object.entries(value.values).every(([key,entry])=>key==='sprintId'?entry===null||id(entry):estimate(entry));
}
/** Store editor intent only. Fresh task names and permission flags never enter the document. */
export function validatePlanningTaskDeviceDraft(value:unknown,projectId:string):PlanningTaskDeviceDraft{
 if(!object(value)||!keys(value,['version','projectId','edits','pending'])||value.version!==1||value.projectId!==projectId||!Array.isArray(value.edits)||value.edits.length>1000||!value.edits.every(editor)||new Set(value.edits.map(row=>row.taskId)).size!==value.edits.length||value.pending!==null&&(!command(value.pending)||!value.edits.some(row=>row.taskId===(value.pending as Record<string,unknown>).taskId)))throw new Error('PLANNING_TASK_DEVICE_DRAFT_INVALID');
 return structuredClone(value) as PlanningTaskDeviceDraft;
}
export function planningTaskEdit(task:TaskBase):PlanningTaskEdit{return {taskId:task.id,expectedRevision:task.revision,base:base(task),draft:{storyPoints:display(task.storyPoints),estimateHours:display(task.estimateHours)},touched:{storyPoints:false,estimateHours:false,destination:false},destination:task.sprintId??'backlog'};}
export function planningTaskEditField(edit:PlanningTaskEdit,field:keyof EstimateDraft,value:string):PlanningTaskEdit{return {...edit,draft:{...edit.draft,[field]:value},touched:{...edit.touched,[field]:true}};}
export function planningTaskEditDestination(edit:PlanningTaskEdit,destination:string):PlanningTaskEdit{return {...edit,destination,touched:{...edit.touched,destination:true}};}
export function planningTaskEstimateValue(raw:string):number|null{
 if(raw==='')return null;
 if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw))throw new Error('PLANNING_ESTIMATE_INVALID');
 const value=Number(raw);if(!estimate(value))throw new Error('PLANNING_ESTIMATE_INVALID');return Math.round(value*100)/100;
}
/** Omitted fields preserve another person's estimate; null remains an explicit clear. */
export function planningTaskEditValues(edit:PlanningTaskEdit):PlanningTaskValues{
 const values:PlanningTaskValues={};for(const field of ['storyPoints','estimateHours'] as const)if(edit.touched[field]){const value=planningTaskEstimateValue(edit.draft[field]);if(value!==edit.base[field])values[field]=value;}
 const destination=edit.destination==='backlog'?null:edit.destination;if(edit.touched.destination&&destination!==edit.base.sprintId)values.sprintId=destination;return values;
}
export function rebasePlanningTaskEdit(edit:PlanningTaskEdit,task:TaskBase):PlanningTaskEdit{
 if(edit.taskId!==task.id)throw new Error('PLANNING_TASK_DRAFT_SCOPE');
 return {...edit,expectedRevision:task.revision,base:base(task),draft:{storyPoints:edit.touched.storyPoints?edit.draft.storyPoints:display(task.storyPoints),estimateHours:edit.touched.estimateHours?edit.draft.estimateHours:display(task.estimateHours)},destination:edit.touched.destination?edit.destination:task.sprintId??'backlog'};
}
