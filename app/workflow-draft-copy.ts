import type {Language} from './i18n';
import translations from './workflow-draft-translations.json';
export type WorkflowDraftCopyKey=keyof typeof translations.ru;
const copy:Record<Language,Record<WorkflowDraftCopyKey,string>>=translations;
export const workflowDraftText=(key:WorkflowDraftCopyKey,language:Language)=>copy[language][key];
export function workflowDraftError(reason:unknown,language:Language){
 const code=reason instanceof Error?reason.message:'';
 const key:WorkflowDraftCopyKey=code==='DRAFT_CHANGED'?'changed':['DRAFT_INVALID','DRAFT_RECOVERY_REQUIRED','WORKFLOW_DEVICE_DRAFT_INVALID','PLANNING_DEVICE_DRAFT_INVALID','PLANNING_TASK_DEVICE_DRAFT_INVALID','CUSTOM_FIELD_DEVICE_DRAFT_INVALID','SAVED_VIEW_DEVICE_DRAFT_INVALID','SHARED_EDITOR_DRAFT_INVALID'].includes(code)?'invalid':['DRAFT_LIMIT','DRAFT_TOO_LARGE'].includes(code)?'limit':'error';
 return workflowDraftText(key,language);
}
