"use client";
import type { CalendarMode } from "./calendar-data";
import type { CalendarContext } from "./calendar-context";
import { CalendarDatePicker } from "./CalendarDatePicker";
import { SharedCustomFieldInputs } from "./SharedCustomFieldInputs";
import { translateText, type Language } from "./i18n";
import { sharedPriorityLabel } from "./shared-task-details";
import type { CustomFieldValue, SharedCustomField } from "./shared-custom-fields";
import { automationActionTypes, automationOperators, type AutomationAction, type AutomationCondition } from "./shared-automations";
import { SharedAutomationTemplate } from "./SharedAutomationTemplate";
import type { SharedTemplateSummary } from "./shared-templates";
import {DraftNumberInput} from './DraftNumberInput';

export type AutomationResources={projectId:string;spaceId:string;projectTitle:string;language:Language;mode:CalendarMode;context:CalendarContext;userId:string;draftKey?:string;
 statuses:{id:string;title:string}[];members:{id:string;title:string}[];labels:{id:string;title:string}[];fields:SharedCustomField[];templates:SharedTemplateSummary[];onNestedDirty?:(dirty:boolean)=>void};
export function defaultAutomationAction(type:AutomationAction['type'],r:AutomationResources):AutomationAction {
 if(type==='status')return {type,value:r.statuses[0]?.id??""};if(type==='assignee')return {type,value:null};if(type==='priority')return {type,value:0};
 if(type==='due')return {type,mode:'clear'};if(type==='custom')return {type,fieldId:r.fields[0]?.id??"",value:null};
 if(type==='createTemplate')return {type,templateId:r.templates.find(template=>template.kind==='task')?.id??"",options:{}};
 if(type==='notify')return {type,recipientIds:[r.userId],message:""};return {type,value:[]};
}
function Choice({label,rows,value,onChange,multiple=false,empty}:{label:string;rows:{id:string;title:string}[];value:string|string[];onChange:(value:string|string[])=>void;multiple?:boolean;empty?:string}){
 return <label>{label}<select multiple={multiple} value={value} onChange={event=>onChange(multiple?Array.from(event.target.selectedOptions).map(option=>option.value):event.target.value)}>{!multiple&&empty?<option value="">{empty}</option>:null}{rows.map(row=><option key={row.id} value={row.id} data-no-translate>{row.title}</option>)}</select></label>;
}
function TypedValue({field,value,onChange,r,contains=false}:{field?:SharedCustomField;value:CustomFieldValue|null;onChange:(value:CustomFieldValue|null)=>void;r:AutomationResources;contains?:boolean}){
 if(!field)return null;
 const definition={...field,required:false,...(contains&&field.type==='multi'?{type:'select' as const}:{})};
 return <SharedCustomFieldInputs fields={[definition]} draftScope={r.draftKey} values={{[field.id]:value}} onChange={values=>onChange(values[field.id]??null)} language={r.language} mode={r.mode} calculationContext={r.context}/>;
}
export function SharedAutomationCondition({value,onChange,r}:{value:AutomationCondition;onChange:(value:AutomationCondition)=>void;r:AutomationResources}){
 const t=(s:string)=>translateText(s,r.language),field=r.fields.find(field=>field.id===value.fieldId);
 const fields={project:'Проект',status:'Статус',label:'Метка',assignee:'Исполнитель',priority:'Приоритет',custom:'Пользовательское поле'} as const;
 let operators:AutomationCondition['operator'][]=value.field==='label'?['contains','notContains']:['eq','ne','missing','present'];
 if(value.field==='priority'||value.field==='custom'&&field&&['number','date'].includes(field.type))operators=[...operators,'gt','gte','lt','lte'];
 if(value.field==='custom'&&field?.type==='multi')operators=[...operators,'contains','notContains'];
 const changeField=(name:AutomationCondition['field'])=>onChange({field:name,operator:name==='label'?'contains':'eq',value:name==='project'?r.projectId:name==='priority'?0:null,...(name==='custom'?{fieldId:r.fields[0]?.id??''}:{})});
 return <div className="automation-condition"><div className="template-grid"><label>{t('Поле условия')}<select value={value.field} onChange={event=>changeField(event.target.value as AutomationCondition['field'])}>{Object.entries(fields).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
  <label>{t('Сравнение')}<select value={value.operator} onChange={event=>onChange({...value,operator:event.target.value as AutomationCondition['operator']})}>{operators.map(key=><option key={key} value={key}>{t(automationOperators[key])}</option>)}</select></label></div>
  {value.field==='custom'?<Choice label={t('Пользовательское поле')} rows={r.fields} value={value.fieldId??''} onChange={id=>onChange({...value,fieldId:String(id),operator:'eq',value:null})} empty={t('Выберите поле')}/>:null}
  {!['missing','present'].includes(value.operator)?value.field==='project'?<p data-no-translate>{r.projectTitle}</p>
   :value.field==='custom'?<TypedValue field={field} value={value.value} onChange={next=>onChange({...value,value:next})} r={r} contains={['contains','notContains'].includes(value.operator)}/>
   :value.field==='priority'?<label>{t('Приоритет')}<select value={String(value.value??0)} onChange={event=>onChange({...value,value:Number(event.target.value)})}>{[0,1,2,3].map(level=><option key={level} value={level}>{sharedPriorityLabel(level)}</option>)}</select></label>
   :<Choice label={t('Значение')} rows={value.field==='status'?r.statuses:value.field==='label'?r.labels:r.members} value={String(value.value??'')} onChange={next=>onChange({...value,value:String(next)||null})} empty={t(value.field==='assignee'?'Не назначен':'Выберите значение')}/>:null}
 </div>;
}
export function SharedAutomationAction({value,onChange,r}:{value:AutomationAction;onChange:(value:AutomationAction)=>void;r:AutomationResources}){
 const t=(s:string)=>translateText(s,r.language);
 return <div className="automation-action"><label>{t('Действие')}<select value={value.type} onChange={event=>onChange(defaultAutomationAction(event.target.value as AutomationAction['type'],r))}>{Object.entries(automationActionTypes).map(([key,label])=><option key={key} value={key}>{t(label)}</option>)}</select></label>
  {value.type==='status'||value.type==='assignee'?<Choice label={t(value.type==='status'?'Статус':'Исполнитель')} rows={value.type==='status'?r.statuses:r.members} value={String(value.value??'')} onChange={next=>onChange({...value,value:String(next)||null})} empty={t(value.type==='status'?'Выберите статус':'Не назначен')}/>:null}
  {value.type==='priority'?<label>{t('Приоритет')}<select value={Number(value.value??0)} onChange={event=>onChange({...value,value:Number(event.target.value)})}>{[0,1,2,3].map(level=><option key={level} value={level}>{sharedPriorityLabel(level)}</option>)}</select></label>:null}
  {value.type==='addLabels'||value.type==='removeLabels'?<Choice label={t('Метки')} rows={r.labels} value={Array.isArray(value.value)?value.value:[]} onChange={next=>onChange({...value,value:next})} multiple/>:null}
  {value.type==='custom'?<><Choice label={t('Пользовательское поле')} rows={r.fields} value={value.fieldId??''} onChange={id=>onChange({...value,fieldId:String(id),value:null})} empty={t('Выберите поле')}/><TypedValue field={r.fields.find(field=>field.id===value.fieldId)} value={value.value??null} onChange={next=>onChange({...value,value:next})} r={r}/></>:null}
  {value.type==='due'?<><label>{t('Изменение срока')}<select value={value.mode??'clear'} onChange={event=>onChange({type:'due',mode:event.target.value as 'set'|'shift'|'clear',...(event.target.value==='set'?{date:''}:event.target.value==='shift'?{offset:{amount:1,unit:'day'}}:{})})}><option value="set">{t('Установить дату')}</option><option value="shift">{t('Сдвинуть срок')}</option><option value="clear">{t('Очистить срок')}</option></select></label>
   {value.mode==='set'?<CalendarDatePicker mode={r.mode} calculationContext={r.context} ariaLabel={t('Срок')} required value={value.date??''} onChange={date=>onChange({...value,date})}/>:null}
   {value.mode==='shift'?<div className="template-grid"><label>{t('Сдвиг')}<DraftNumberInput draftKey={`${r.draftKey}:offset`} integer min={-200} max={200} value={value.offset?.amount??1} invalidMessage={t('Проверьте триггер, условия и действия правила.')} onValue={amount=>onChange({...value,offset:{amount:amount!,unit:value.offset?.unit??'day'}})}/></label><label>{t('Единица сдвига')}<select value={value.offset?.unit??'day'} onChange={event=>onChange({...value,offset:{amount:value.offset?.amount??1,unit:event.target.value as 'day'|'month'|'year'}})}><option value="day">{t('Дни')}</option><option value="month">{t('Месяцы')}</option><option value="year">{t('Годы')}</option></select></label></div>:null}</>:null}
  {value.type==='createTemplate'?<SharedAutomationTemplate value={value} onChange={onChange} r={r}/>:null}
  {value.type==='notify'?<><Choice label={t('Получатели')} rows={r.members} value={value.recipientIds??[]} onChange={next=>onChange({...value,recipientIds:Array.isArray(next)?next:[]})} multiple/><label>{t('Текст уведомления')}<textarea value={value.message??''} maxLength={1000} onChange={event=>onChange({...value,message:event.target.value})}/></label><p>{t('Язык, каналы, частота и тихие часы берутся из настроек получателя. Ваш текст сохраняется как введён.')}</p></>:null}
 </div>;
}
