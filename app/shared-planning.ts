import { GenesisApiError, sharedCollaborationRequest, type SharedTask } from './cloud-sync';
import type { CalendarMode } from './calendar-data';
import type { CalendarContext } from './calendar-context';
import {translateText,type Language} from './i18n';
import translations from './planning-translations.json';
import { workflowError } from './workflow-copy';
import type {PlanningCommand} from './planning-device-drafts';

export type PlanningCopyKey=keyof typeof translations.ru;
const copy:Record<Language,Record<PlanningCopyKey,string>>=translations;
export const planningText=(key:PlanningCopyKey,language:Language)=>copy[language][key];
export type PlanningConfig={enabled:boolean;estimateUnit:'points'|'hours';revision:number};
export type SharedSprint={id:string;projectId:string;state:'planning'|'active'|'completed';title:string;goal:string;startDate:string;endDate:string;calendarMode:CalendarMode;calendarContext:CalendarContext;revision:number;estimateUnit:'points'|'hours'|null;createdAt:string;updatedAt:string;startedAt:string|null;completedAt:string|null};
export type PlanningTotals={count:number;completed:number;points:{value:number;unestimated:number};hours:{value:number;unestimated:number}};
export type ProjectPlanning={config:PlanningConfig;sprints:SharedSprint[];totals:Record<string,PlanningTotals>;byAssignee:Record<string,Record<string,PlanningTotals>>;fingerprint:string;context:{permissions:{editTasks:boolean;organizeTasks:boolean;manageProjects:boolean}}};
export type SprintDraft=Pick<SharedSprint,'title'|'goal'|'startDate'|'endDate'|'calendarMode'|'calendarContext'>;
export type EstimateDraft={storyPoints:string;estimateHours:string};
export const estimateDraft=(task?:Pick<SharedTask,'storyPoints'|'estimateHours'>):EstimateDraft=>({storyPoints:task?.storyPoints==null?'':String(task.storyPoints),estimateHours:task?.estimateHours==null?'':String(task.estimateHours)});
export const estimateInput=(draft:EstimateDraft)=>({storyPoints:draft.storyPoints===''?null:Number(draft.storyPoints),estimateHours:draft.estimateHours===''?null:Number(draft.estimateHours)});
const projectPath=(project:string)=>`/projects/${encodeURIComponent(project)}/planning`;
export const loadPlanning=(project:string,signal?:AbortSignal)=>sharedCollaborationRequest<ProjectPlanning>(projectPath(project),{signal});
export const savePlanning=(project:string,config:Omit<PlanningConfig,'revision'>,expectedRevision:number,requestId:string)=>sharedCollaborationRequest<{config:PlanningConfig}>(projectPath(project),{method:'PUT',body:JSON.stringify({...config,expectedRevision,requestId})});
export const saveSprint=(project:string,draft:SprintDraft,expectedRevision:number,requestId:string,id?:string)=>sharedCollaborationRequest<{sprint:SharedSprint}>(`${projectPath(project)}/sprints${id?`/${encodeURIComponent(id)}`:''}`,{method:id?'PATCH':'POST',body:JSON.stringify({...draft,expectedRevision,requestId})});
export const transitionSprint=(project:string,sprint:Pick<SharedSprint,'id'|'revision'>,fingerprint:string,action:'start'|'complete',requestId:string,outcomes?:{taskId:string;expectedRevision:number;destinationSprintId:string|null}[])=>sharedCollaborationRequest<{sprint:SharedSprint}>(`${projectPath(project)}/sprints/${encodeURIComponent(sprint.id)}/transition`,{method:'POST',body:JSON.stringify({expectedRevision:sprint.revision,fingerprint,action,requestId,outcomes})});
export const executePlanningCommand=(project:string,command:PlanningCommand)=>command.kind==='settings'?savePlanning(project,command.config,command.expectedRevision,command.requestId):command.kind==='sprint'?saveSprint(project,command.draft,command.expectedRevision,command.requestId,command.sprintId??undefined):transitionSprint(project,{id:command.sprintId,revision:command.expectedRevision},command.fingerprint,command.action,command.requestId,command.outcomes);
export const savePlanningTask=(task:Pick<SharedTask,'id'|'projectId'|'revision'>,values:{sprintId?:string|null;storyPoints?:number|null;estimateHours?:number|null},requestId:string)=>sharedCollaborationRequest<{task:SharedTask}>(`/projects/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}`,{method:'PATCH',body:JSON.stringify({...values,expectedRevision:task.revision,requestId})});
export const planningAccessLost=(reason:unknown)=>reason instanceof GenesisApiError&&[401,403,404].includes(reason.status);
export function planningError(reason:unknown,language:Language):string {
 const workflow=workflowError(reason,language);if(workflow)return workflow;
 const code=reason instanceof GenesisApiError?String(reason.payload?.error??reason.message):reason instanceof Error?reason.message:'';
 if(code==='PLANNING_PERMISSION_CHANGED')return translateText('Нет доступа',language);
 const keys:Record<string,PlanningCopyKey>={PLANNING_CONFLICT:'conflict',SHARED_TASK_CONFLICT:'conflict',SHARED_QUERY_CHANGED:'conflict',PLANNING_ACTIVE_SPRINT:'activeExists',SPRINT_COMPLETED:'closed',SPRINT_DATES_INVALID:'datesInvalid',PLANNING_ESTIMATE_INVALID:'numbersInvalid',SPRINT_CONTEXT_INVALID:'contextInvalid',INVALID_CALENDAR_CONTEXT:'contextInvalid',SPRINT_OUTCOMES_REQUIRED:'outcomesRequired',SPRINT_STATE_INVALID:'stateInvalid',PLANNING_DISABLED:'disabled'};
 return planningText(keys[code]??'error',language);
}
