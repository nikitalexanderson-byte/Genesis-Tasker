import { getRuntimeLanguage, translateText, type Language } from './i18n';
import translations from './workflow-translations.json';

export type WorkflowCopyKey=keyof typeof translations.ru;
const copy:Record<Language,Record<WorkflowCopyKey,string>>=translations;
export const workflowText=(key:WorkflowCopyKey,language:Language=getRuntimeLanguage())=>copy[language][key];
const errors:Record<string,WorkflowCopyKey>={WORKFLOW_CONFLICT:'conflict',WORKFLOW_WIP_LIMIT:'wipError',WORKFLOW_REQUIRED_FIELDS:'requiredError',WORKFLOW_TRANSITION_FORBIDDEN:'transitionError',WORKFLOW_ROLE_FORBIDDEN:'roleError',WORKFLOW_STATUS_EDIT_REQUIRES_DISABLE:'statusError',WORKFLOW_FIELD_IN_USE:'fieldError',WORKFLOW_INVALID:'invalidError',WORKFLOW_NO_SAFE_ENTRY:'entryError',WORKFLOW_NO_SAFE_EXIT:'exitError',WORKFLOW_FIELD_UNAVAILABLE:'unavailableError',WORKFLOW_STATUS_UNCONFIGURED:'unavailableError'};
export function workflowError(reason:unknown,language:Language=getRuntimeLanguage()):string|null {
 const payload=reason&&typeof reason==='object'&&'payload' in reason?reason.payload as Record<string,unknown>|undefined:undefined;
 const code=String(payload?.error??(reason instanceof Error?reason.message:reason));
 const key=errors[code];if(!key)return null;
 let text=workflowText(key,language);
 const details=payload?.details as Record<string,unknown>|undefined;
 if(key==='wipError'&&Number.isInteger(details?.limit))text+=` ${workflowText('limit',language)}: ${new Intl.NumberFormat(language).format(details!.limit as number)}.`;
 const fields:Record<string,string>={assigneeId:'Исполнитель',labels:'Метки',storyPoints:'Story points',estimateHours:'Часы'};
 const own:Record<string,WorkflowCopyKey>={description:'description',dueDate:'dueDate',startDate:'startDate',categoryId:'category'};
 if(key==='requiredError'&&Array.isArray(details?.fields))text+=' '+[...new Set(details.fields.map(value=>own[String(value)]?workflowText(own[String(value)],language):fields[String(value)]?translateText(fields[String(value)],language):workflowText('required',language)))].join(', ')+'.';
 return text;
}
