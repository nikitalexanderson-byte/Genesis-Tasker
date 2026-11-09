import type {SharedProjectAccessDraft} from './shared-project-access';
import type {DataCommand} from './shared-data-exchange';
import type {NumberDrafts} from './DraftNumberInput';

export type ProjectAccessEditorSnapshot={targetUserId:string;draft:SharedProjectAccessDraft};
export type DataImportEditorSnapshot={file:{id:string;name:string;content:string};command:Omit<DataCommand,'content'>;numbers?:NumberDrafts};
export const importCommandOptions=(command:DataCommand)=>Object.fromEntries(Object.entries(command).filter(([key])=>key!=='content')) as Omit<DataCommand,'content'>;
const record=(value:unknown):value is Record<string,unknown>=>Boolean(value)&&typeof value==='object'&&!Array.isArray(value);
const id=(value:unknown)=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,200}$/.test(value);
function requireValid(value:unknown):asserts value {if(!value)throw Error('SHARED_EDITOR_DRAFT_INVALID');}
export function validateProjectAccessEditor(value:unknown):ProjectAccessEditorSnapshot {
 requireValid(record(value)&&Object.keys(value).length===2&&id(value.targetUserId)&&record(value.draft));
 const draft=value.draft;requireValid(Object.keys(draft).length===2&&typeof draft.allProjects==='boolean'&&Array.isArray(draft.grants));
 requireValid(draft.grants.every(row=>record(row)&&Object.keys(row).length===3&&id(row.projectId)&&['member','commenter','viewer','none'].includes(String(row.role))&&typeof row.includeDescendants==='boolean'));
 requireValid(new Set(draft.grants.map(row=>row.projectId)).size===draft.grants.length);
 return structuredClone(value) as ProjectAccessEditorSnapshot;
}
export function validateDataImportEditor(value:unknown,spaceId:string,projectId:string):DataImportEditorSnapshot {
 requireValid(record(value)&&Object.keys(value).every(key=>['file','command','numbers'].includes(key))&&record(value.file)&&Object.keys(value.file).length===3&&id(value.file.id)&&typeof value.file.name==='string'&&typeof value.file.content==='string');
 requireValid(value.numbers===undefined||record(value.numbers)&&Object.values(value.numbers).every(raw=>typeof raw==='string'&&raw.length<=100));
 requireValid(new TextEncoder().encode(value.file.content).byteLength<=20*1024*1024&&record(value.command));
 const command=value.command;requireValid(command.spaceId===spaceId&&['json','csv','trello'].includes(String(command.format))&&!Object.hasOwn(command,'content')&&(command.projectId===null||command.projectId===projectId)&&(command.parentProjectId===null||command.parentProjectId===projectId));
 requireValid(record(command.parse)&&['memberMap','statusMap','labelMap','fieldMap','optionMap','fieldDefaults'].every(key=>record(command[key])));
 return structuredClone(value) as DataImportEditorSnapshot;
}
