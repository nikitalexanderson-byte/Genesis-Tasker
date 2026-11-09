"use client";
import { useEffect, useState } from "react";
import { loadSharedTemplate } from "./cloud-sync";
import { SharedTemplateApply } from "./SharedTemplateApply";
import { translateText, type Language } from "./i18n";
import { automationError, type AutomationAction } from "./shared-automations";
import type { SharedTemplate } from "./shared-templates";
import type { AutomationResources } from "./SharedAutomationFields";

export function SharedAutomationTemplate({value,onChange,r}:{value:AutomationAction;onChange:(value:AutomationAction)=>void;r:AutomationResources}){
 const t=(s:string)=>translateText(s,r.language),[record,setRecord]=useState<SharedTemplate|null>(null),[configure,setConfigure]=useState(false),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();if(value.templateId)void loadSharedTemplate(value.templateId,r.language,controller.signal).then(next=>{if(!controller.signal.aborted){setRecord(next);setError('');}}).catch(reason=>{if(!controller.signal.aborted){setRecord(null);setError(automationError(reason,r.language));}});return()=>controller.abort();},[value.templateId,r.language]);
 return <><label>{t('Шаблон задачи')}<select value={value.templateId??''} onChange={event=>{setRecord(null);setConfigure(false);onChange({type:'createTemplate',templateId:event.target.value,options:{}});}}><option value="">{t('Выберите шаблон задачи')}</option>{r.templates.filter(row=>row.kind==='task').map(row=><option key={row.id} value={row.id} data-no-translate>{row.title}</option>)}</select></label>
  {value.unavailable?<p role="status">{t('Шаблон больше недоступен.')}</p>:null}<p>{t('Базовая дата — дата запуска в часовом поясе правила. Экземпляры повторяющейся серии не создаются повторно.')}</p>
  {record?<button type="button" onClick={()=>setConfigure(!configure)} aria-expanded={configure}>{t('Настроить применение шаблона')}</button>:null}
  {record?<div hidden={!configure}><SharedTemplateApply key={record.id} userId={r.userId} contextKey={r.draftKey} record={record} spaceId={r.spaceId} projectId={r.projectId} projects={[{id:r.projectId,title:r.projectTitle,canWrite:true}]} language={r.language as Language} initialOptions={value.options} onDirtyChange={dirty=>r.onNestedDirty?.(dirty)} onApplied={async()=>{}} onConfigured={options=>{onChange({...value,options});setConfigure(false);}}/></div>:null}
  {error?<p role="alert">{error}</p>:null}
 </>;
}
