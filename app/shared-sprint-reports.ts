import {sharedCollaborationRequest,GenesisApiError} from './cloud-sync';
import type {SharedSprint} from './shared-planning';
import type {CalendarContext} from './calendar-context';
import type {CalendarMode} from './calendar-data';

export type SprintReportUnit='tasks'|'points'|'hours';
export type SprintMetric={tasks:number|null;knownValue:number|null;unestimated:number|null;value:number|null;unknownTasks?:number;historyComplete?:boolean};
export type SprintObservation={taskId:string;statusId:string|null;done:boolean;active:boolean;revision:number;sprintId:string|null;storyPoints:number|null;estimateHours:number|null};
export type SprintSeriesPoint={at:string;date:string;sequence:number;firstSequence:number;sourceId:string|null;sourceKind:string;sourceCount:number;connectPrevious:boolean;coverage:'observed'|'partial';unknownTasks:number;historyGap?:boolean;gapWithinBucket?:boolean;scope:SprintMetric;remaining:SprintMetric;done:SprintMetric;wip:SprintMetric;statuses:Record<string,SprintMetric>;wipStatuses:Record<string,SprintMetric>};
export type SprintReportSummary={plan:SprintMetric;alreadyDone:SprintMetric;committed:SprintMetric;scope:SprintMetric;remaining:SprintMetric;done:SprintMetric;delivered:SprintMetric;carried:SprintMetric;added:Omit<SprintMetric,'value'>;removed:Omit<SprintMetric,'value'>;estimateDelta:number;unestimatedDelta:number;scopeChangeCoverage:'observed'|'partial';completionTransitions:number;completedTasksCount:number;reopenedTasksCount:number};
export type SprintReport={asOf:string;projectId:string;sprint:SharedSprint;launch:{startDate:string;endDate:string;calendarMode:CalendarMode;calendarContext:CalendarContext;estimateUnit:string|null};token:string;statuses:{id:string;title:string;color:string;position:number;revision:number;isDone:number}[];flow:
 {available:false;reason:string;unit:SprintReportUnit;series:SprintSeriesPoint[];summary:null;gaps:unknown[]}|{available:true;unit:SprintReportUnit;resolution:'day';timeZone:string;from:string;to:string;terminal:boolean;historyComplete:boolean;series:SprintSeriesPoint[];scopeChangeCount:number;summary:SprintReportSummary;gaps:{reason:string;sourceId?:string;taskId?:string;unavailable?:boolean}[]}};
export type SprintSourceTask={id:string;title:string;projectId:string;archived:boolean;revision:number};
export type SprintSourceItem=Partial<SprintSourceTask>&{sourceId?:string;sequence?:number;at?:string;action?:string;kind?:string;task?:SprintSourceTask;observed?:SprintObservation|null;before?:SprintObservation|null;after?:SprintObservation|null;unavailable?:boolean;completionCarry?:boolean;leftScope?:boolean};
export type SprintSourceQuery={kind:'tasks'|'events'|'changes';metric?:string;taskId?:string;date?:string};
export type SprintSourcePage={items:SprintSourceItem[];total:number;unavailable:number;nextCursor:string|null;asOf:string};
const path=(project:string,sprint:string)=>`/projects/${encodeURIComponent(project)}/planning/sprints/${encodeURIComponent(sprint)}/report`;
export const loadSprintReport=(project:string,sprint:string,unit:SprintReportUnit,signal?:AbortSignal)=>sharedCollaborationRequest<SprintReport>(path(project,sprint),{method:'POST',body:JSON.stringify({unit}),signal});
export const checkSprintReport=(project:string,sprint:string,token:string,signal?:AbortSignal)=>sharedCollaborationRequest<{unchanged:true}>(`${path(project,sprint)}/check`,{method:'POST',body:JSON.stringify({token}),signal});
export const loadSprintSources=(project:string,sprint:string,token:string,query:SprintSourceQuery,cursor?:string,signal?:AbortSignal)=>sharedCollaborationRequest<SprintSourcePage>(`${path(project,sprint)}/sources`,{method:'POST',body:JSON.stringify({token,...query,...(cursor?{cursor}:{})}),signal});
export const sprintReportCode=(error:unknown)=>error instanceof GenesisApiError?String(error.payload?.error??error.message):error instanceof Error?error.message:'';
