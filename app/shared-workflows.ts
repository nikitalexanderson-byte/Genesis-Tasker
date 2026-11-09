import { sharedCollaborationRequest, type SharedStatus, type SharedProject, type SharedProjectSnapshot } from './cloud-sync';

export const workflowRoles=['owner','manager','member','commenter','viewer'] as const;
export type WorkflowRole=typeof workflowRoles[number];
export type WorkflowStatus={statusId:string;wipLimit:number|null;requiredFields:string[]};
export type WorkflowTransition={fromStatusId:string|null;toStatusId:string;roles:WorkflowRole[]};
export type WorkflowConfig={enabled:boolean;revision:number;statuses:WorkflowStatus[];transitions:WorkflowTransition[]};
export type ProjectWorkflow={config:WorkflowConfig;counts:Record<string,number>};
export type WorkflowContext={project:Pick<SharedProject,'id'|'title'|'role'|'permissions'>}&Pick<SharedProjectSnapshot,'statuses'|'customFieldDefinitions'>;
export type WorkflowSnapshot=ProjectWorkflow&{context:WorkflowContext};
export type WorkflowCommand=Pick<WorkflowConfig,'enabled'>&Partial<Pick<WorkflowConfig,'statuses'|'transitions'>>&{expectedRevision:number;requestId:string};
export type WorkflowVersion=Omit<WorkflowConfig,'revision'>&{revision:number;createdAt:string;actorId:string};
const path=(project:string)=>`/projects/${encodeURIComponent(project)}/workflow`;
export const loadWorkflow=(project:string,signal?:AbortSignal)=>sharedCollaborationRequest<WorkflowSnapshot>(path(project),{signal});
export const saveWorkflow=(project:string,command:WorkflowCommand)=>sharedCollaborationRequest<ProjectWorkflow>(path(project),{method:'PUT',body:JSON.stringify(command)});
export const workflowHistory=(project:string,before?:number,signal?:AbortSignal)=>sharedCollaborationRequest<{versions:WorkflowVersion[];nextCursor:number|null}>(`${path(project)}/history${before?`?before=${before}`:''}`,{signal});
export function workflowDraft(config:WorkflowConfig,statuses:SharedStatus[]):WorkflowConfig {
 const ids=new Set(statuses.map(status=>status.id));
 return {...config,statuses:statuses.map(status=>{const rule=structuredClone(config.statuses.find(rule=>rule.statusId===status.id)??{statusId:status.id,wipLimit:null,requiredFields:[]});return {...rule,wipLimit:status.isDone?null:rule.wipLimit};}),
  transitions:config.revision||config.statuses.length?structuredClone(config.transitions.filter(edge=>ids.has(edge.toStatusId)&&(edge.fromStatusId===null||ids.has(edge.fromStatusId)))):
   [null,...statuses.map(status=>status.id)].flatMap(from=>statuses.filter(status=>status.id!==from).map(status=>({fromStatusId:from,toStatusId:status.id,roles:[...workflowRoles]})))};
}
export const workflowStatusesKey=(statuses:SharedStatus[])=>JSON.stringify(statuses.map(status=>[status.id,status.isDone]));
