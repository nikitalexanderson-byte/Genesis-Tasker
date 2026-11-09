import type {WorkflowCommand,WorkflowConfig,WorkflowContext,WorkflowSnapshot} from './shared-workflows';

export type WorkflowEditorDraft={config:WorkflowConfig;statusesKey:string};
export type WorkflowDeviceSnapshot=Omit<WorkflowSnapshot,'context'>&{context:Omit<WorkflowContext,'customFieldDefinitions'>&{customFieldDefinitions:{id:string;title:string;archived:boolean}[]}};
export type WorkflowDeviceDraft={version:1;projectId:string;observedAt:string;snapshot:WorkflowDeviceSnapshot;draft:WorkflowEditorDraft|null;pending:WorkflowCommand|null;fromStatusId:string;numberInputs?:Record<string,string>};
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const text=(value:unknown,max=400)=>typeof value==='string'&&[...value].length<=max;
const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
const integer=(value:unknown,max=Number.MAX_SAFE_INTEGER)=>typeof value==='number'&&Number.isSafeInteger(value)&&value>=0&&value<=max;
const keys=(value:Record<string,unknown>,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const list=(value:unknown,max:number,check:(value:unknown)=>boolean):value is unknown[]=>Array.isArray(value)&&value.length<=max&&value.every(check);
const unique=(items:unknown[])=>new Set(items).size===items.length;
const roles=new Set(['owner','manager','member','commenter','viewer']);
const status=(value:unknown)=>record(value)&&keys(value,['statusId','wipLimit','requiredFields'])&&id(value.statusId)&&(value.wipLimit===null||integer(value.wipLimit,1_000_000))&&list(value.requiredFields,208,item=>text(item,220)&&item!=='')&&unique(value.requiredFields);
const transition=(value:unknown)=>record(value)&&keys(value,['fromStatusId','toStatusId','roles'])&&(value.fromStatusId===null||id(value.fromStatusId))&&id(value.toStatusId)&&list(value.roles,5,role=>typeof role==='string'&&roles.has(role))&&unique(value.roles);
function definition(value:Record<string,unknown>){
 return list(value.statuses,30,status)&&unique(value.statuses.map(item=>(item as Record<string,unknown>).statusId))&&list(value.transitions,930,transition);
}
function config(value:unknown){return record(value)&&keys(value,['enabled','revision','statuses','transitions'])&&typeof value.enabled==='boolean'&&integer(value.revision)&&definition(value);}
function command(value:unknown){
 if(!record(value)||!keys(value,['enabled','expectedRevision','requestId','statuses','transitions'])||typeof value.enabled!=='boolean'||!integer(value.expectedRevision)||!id(value.requestId))return false;
 if(!value.enabled&&value.statuses===undefined&&value.transitions===undefined)return true;
 return definition(value)&&(value.transitions as {roles:unknown[]}[]).every(edge=>edge.roles.length>0);
}
function editorDraft(value:unknown){
 if(!record(value)||!keys(value,['config','statusesKey'])||!config(value.config)||!text(value.statusesKey,16000))return false;
 try{const states:unknown=JSON.parse(value.statusesKey as string);return list(states,30,pair=>Array.isArray(pair)&&pair.length===2&&id(pair[0])&&(pair[1]===0||pair[1]===1))&&unique(states.map(pair=>(pair as unknown[])[0]));}catch{return false;}
}
function snapshot(value:unknown,projectId:string){
 if(!record(value)||!keys(value,['config','counts','context'])||!config(value.config)||!record(value.context)||!keys(value.context,['project','statuses','customFieldDefinitions']))return false;
 const context=value.context,project=context.project;
 if(!record(project)||!keys(project,['id','title','role','permissions'])||project.id!==projectId||!text(project.title)||!text(project.role,40)||!record(project.permissions))return false;
 if(!['createProjects','editTasks','organizeTasks','comment','manageProjects','inviteMembers'].every(key=>typeof (project.permissions as Record<string,unknown>)[key]==='boolean'))return false;
 if(!list(context.statuses,30,item=>record(item)&&keys(item,['id','title','position','isDone','revision'])&&id(item.id)&&text(item.title)&&typeof item.position==='number'&&Number.isSafeInteger(item.position)&&(item.isDone===0||item.isDone===1)&&integer(item.revision)))return false;
 if(!unique(context.statuses.map(item=>(item as Record<string,unknown>).id))||!list(context.customFieldDefinitions,200,item=>record(item)&&keys(item,['id','title','archived'])&&id(item.id)&&text(item.title)&&typeof item.archived==='boolean')||!unique(context.customFieldDefinitions.map(item=>(item as Record<string,unknown>).id)))return false;
 return (record(value.counts)||Array.isArray(value.counts)&&value.counts.length===0)&&Object.entries(value.counts).every(([key,value])=>id(key)&&integer(value));
}
/** Keep only the metadata used by this editor; task values and field options stay out. */
export function workflowDeviceSnapshot(value:WorkflowSnapshot|WorkflowDeviceSnapshot):WorkflowDeviceSnapshot{
 return structuredClone({config:value.config,counts:value.counts,context:{project:{id:value.context.project.id,title:value.context.project.title,role:value.context.project.role,permissions:value.context.project.permissions},
  statuses:value.context.statuses.map(({id,title,position,isDone,revision})=>({id,title,position,isDone,revision})),customFieldDefinitions:(value.context.customFieldDefinitions??[]).map(({id,title,archived})=>({id,title,archived}))}});
}
/** Validate stored bytes without rebasing or dropping an unfinished edit. */
export function validateWorkflowDeviceDraft(value:unknown,projectId:string):WorkflowDeviceDraft{
 if(!record(value)||!keys(value,['version','projectId','observedAt','snapshot','draft','pending','fromStatusId','numberInputs'])||value.version!==1||value.projectId!==projectId||!text(value.observedAt,100)||!Number.isFinite(Date.parse(value.observedAt as string))||!snapshot(value.snapshot,projectId)||value.draft!==null&&!editorDraft(value.draft)||value.pending!==null&&!command(value.pending)||value.fromStatusId!==''&&!id(value.fromStatusId)||value.numberInputs!==undefined&&(!record(value.numberInputs)||!Object.entries(value.numberInputs).every(([key,value])=>id(key)&&text(value,100))))throw new Error('WORKFLOW_DEVICE_DRAFT_INVALID');
 return structuredClone(value) as WorkflowDeviceDraft;
}
