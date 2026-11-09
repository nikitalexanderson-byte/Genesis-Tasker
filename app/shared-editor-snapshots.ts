import type {CalendarContext} from './calendar-context';
import type {CalendarMode} from './calendar-data';
import type {SharedTemplate,TemplateManifest} from './shared-templates';
import type {AutomationRule,AutomationDefinition} from './shared-automations';
import type {NumberDrafts} from './DraftNumberInput';
export type TemplateEditorValue={id?:string;cloneTemplateId?:string;projectId:string;title:string;manifest:TemplateManifest;revision:number};
export type TemplateEditorSnapshot={draft:TemplateEditorValue|null;record:SharedTemplate|null;capture:boolean;captureTitle:string;captureMode:CalendarMode;captureAnchor:string;captureContext:CalendarContext;source:{taskId?:string;title:string};numbers:NumberDrafts};
export type AutomationEditorValue={id?:string;title:string;ownerId:string;enabled:boolean;definition:AutomationDefinition;revision:number};
export type AutomationEditorSnapshot={draft:AutomationEditorValue|null;record:AutomationRule|null;baseline:string;zoneDraft:string|null;actionKeys:string[];conditionKeys:string[];numbers:NumberDrafts};
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
function valid(v:unknown):asserts v {if(!v)throw Error('SHARED_EDITOR_DRAFT_INVALID');}
function manifest(v:unknown){valid(object(v)&&v.schemaVersion===1&&['task','project'].includes(String(v.kind))&&object(v.calendarContext)&&Array.isArray(v.projects)&&v.projects.length>0&&Array.isArray(v.tasks)&&Array.isArray(v.fields)&&Array.isArray(v.labels));
 for(const project of v.projects)valid(object(project)&&typeof project.key==='string'&&Array.isArray(project.statuses)&&Array.isArray(project.categories)&&Array.isArray(project.labelKeys)&&Array.isArray(project.tags));
 for(const task of v.tasks)valid(object(task)&&typeof task.key==='string'&&Array.isArray(task.checklists)&&task.checklists.every(list=>object(list)&&Array.isArray(list.items))&&Array.isArray(task.approverIds)&&Array.isArray(task.dependsOnKeys)&&Array.isArray(task.labelKeys)&&Array.isArray(task.tags)&&object(task.customValues));
}
function numbers(v:unknown){valid(object(v)&&Object.values(v).every(value=>typeof value==='string'&&value.length<=100));}
export function validateTemplateEditorSnapshot(raw:unknown):TemplateEditorSnapshot{
 valid(object(raw)&&typeof raw.capture==='boolean'&&typeof raw.captureTitle==='string'&&['sacred','lunar','profane'].includes(String(raw.captureMode))&&typeof raw.captureAnchor==='string'&&object(raw.captureContext)&&typeof raw.captureContext.timeZone==='string'&&object(raw.source)&&typeof raw.source.title==='string');numbers(raw.numbers);
 if(raw.draft!==null){valid(object(raw.draft)&&typeof raw.draft.title==='string'&&typeof raw.draft.projectId==='string'&&Number.isSafeInteger(raw.draft.revision));manifest(raw.draft.manifest);}
 if(raw.record!==null){valid(object(raw.record)&&typeof raw.record.id==='string'&&Array.isArray(raw.record.notices));manifest(raw.record.manifest);}
 return structuredClone(raw) as TemplateEditorSnapshot;
}
export function validateAutomationEditorSnapshot(raw:unknown):AutomationEditorSnapshot{
 valid(object(raw)&&typeof raw.baseline==='string'&&(raw.zoneDraft===null||typeof raw.zoneDraft==='string')&&Array.isArray(raw.actionKeys)&&raw.actionKeys.every(value=>typeof value==='string')&&Array.isArray(raw.conditionKeys)&&raw.conditionKeys.every(value=>typeof value==='string'));numbers(raw.numbers);
 if(raw.draft!==null){valid(object(raw.draft)&&typeof raw.draft.title==='string'&&typeof raw.draft.ownerId==='string'&&typeof raw.draft.enabled==='boolean'&&Number.isSafeInteger(raw.draft.revision));
  const definition=raw.draft.definition;valid(object(definition)&&object(definition.trigger)&&object(definition.calendarContext)&&Array.isArray(definition.actions)&&definition.actions.length===raw.actionKeys.length&&Array.isArray(definition.conditions)&&definition.conditions.length===raw.conditionKeys.length);}
 valid(raw.record===null||object(raw.record)&&typeof raw.record.id==='string'&&object(raw.record.definition));
 return structuredClone(raw) as AutomationEditorSnapshot;
}
