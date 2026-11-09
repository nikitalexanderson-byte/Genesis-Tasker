"use client";
import { formatCalendarDateValue } from "./calendar-data";
import { translateText } from "./i18n";
import { SharedCustomFieldValues } from "./SharedCustomFieldInputs";
import { sharedPriorityLabel } from "./shared-task-details";
import { templateIssueText } from "./shared-templates";
import type { AutomationPreview } from "./shared-automations";
import type { AutomationResources } from "./SharedAutomationFields";
import type { CustomFieldValues } from "./shared-custom-fields";

export function SharedAutomationPreview({value,r}:{value:AutomationPreview;r:AutomationResources}){
 const t=(s:string)=>translateText(s,r.language),effect=value.effects;
 const labels:Record<string,string>={statusId:'Статус',assigneeId:'Исполнитель',priority:'Приоритет',labelIds:'Метки',dueDate:'Срок'};
 const fieldValue=(key:string,raw:unknown):string=>{
  if(raw===null)return t(key==='assigneeId'?'Не назначен':'Не задано');
  if(key==='priority')return sharedPriorityLabel(Number(raw));
  if(key==='dueDate')return formatCalendarDateValue(String(raw),r.mode,true,r.context);
  const rows=key==='statusId'?r.statuses:key==='assigneeId'?r.members:r.labels;
  return (Array.isArray(raw)?raw:[raw]).map(id=>rows.find(row=>row.id===id)?.title??t('Недоступно')).join(', ')||t('Не задано');
 };
 return <div role="status"><p>{t(value.matches?'Условия выполнены. Изменения не сохранены.':'Условия правила не выполнены.')}</p>{effect?<>
  <dl className="automation-result"><div><dt>{t('Изменение задачи')}</dt><dd>{t(effect.updated?'Да':'Нет')}</dd></div><div><dt>{t('Будет создано задач')}</dt><dd>{new Intl.NumberFormat(r.language).format(effect.createdTaskCount)}</dd></div><div><dt>{t('Уведомления')}</dt><dd>{new Intl.NumberFormat(r.language).format(effect.notifications)}</dd></div></dl>
  <dl>{Object.entries(effect.patch).filter(([key])=>key!=='customFields').map(([key,raw])=><div key={key}><dt>{t(labels[key]??'Изменение')}</dt><dd data-no-translate>{fieldValue(key,raw)}</dd></div>)}</dl>
  {effect.patch.customFields?<SharedCustomFieldValues fields={r.fields} values={effect.patch.customFields as CustomFieldValues} language={r.language} mode={r.mode}/>:null}
  {effect.notices.map((code,index)=><p key={index}>{templateIssueText({code},r.language)}</p>)}
 </>:null}</div>;
}
