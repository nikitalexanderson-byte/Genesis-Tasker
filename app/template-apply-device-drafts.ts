import type {TemplateApplyOptions} from './shared-templates';
import type {NumberDrafts} from './DraftNumberInput';
import {validateEditorDeviceDraft} from './shared-editor-device-drafts';
export type TemplateApplySnapshot={templateId:string;contextKey:string;title:string;options:TemplateApplyOptions;numbers:NumberDrafts};
const object=(v:unknown):v is Record<string,unknown>=>Boolean(v)&&typeof v==='object'&&!Array.isArray(v);
export function validateTemplateApplySnapshot(raw:unknown):TemplateApplySnapshot{
 if(!object(raw)||typeof raw.templateId!=='string'||typeof raw.contextKey!=='string'||typeof raw.title!=='string'||!object(raw.options)||typeof raw.options.anchorDate!=='string'||typeof raw.options.spaceId!=='string'||!object(raw.numbers)||!Object.values(raw.numbers).every(v=>typeof v==='string'&&v.length<=100))throw Error('SHARED_EDITOR_DRAFT_INVALID');
 return structuredClone(raw) as TemplateApplySnapshot;
}
export const validateTemplateApplyDeviceDraft=(raw:unknown,spaceId:string,projectId:string)=>validateEditorDeviceDraft(raw,spaceId,projectId,'template-apply',validateTemplateApplySnapshot);
