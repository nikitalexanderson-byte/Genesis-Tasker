"use client";
import { useState } from "react";
import type { CalendarMode } from "./calendar-data";
import type { CalendarContext } from './calendar-context';
import { translateText as t, type Language } from "./i18n";
import { customFieldText, customFieldTypes, type CustomFieldCriterion, type CustomFieldValue, type CustomFieldValues, type SharedCustomField } from "./shared-custom-fields";
import { SharedCustomFieldInputs } from "./SharedCustomFieldInputs";
import { IconActionButton } from "./IconActionButton";

const operations:Record<CustomFieldCriterion['op'],string>={eq:"Равно",ne:"Не равно",contains:"Содержит",exists:"Значение задано",missing:"Значение отсутствует",gt:"Больше",gte:"Не меньше",lt:"Меньше",lte:"Не больше"};
export function SharedCustomFieldFilter({fields,criteria,onChange,mode,calculationContext,language,disabled=false}:{fields:SharedCustomField[];criteria:CustomFieldCriterion[];
 onChange:(criteria:CustomFieldCriterion[])=>void;mode:CalendarMode;calculationContext?:CalendarContext;language:Language;disabled?:boolean}){
 const [fieldId,setFieldId]=useState(''),[op,setOp]=useState<CustomFieldCriterion['op']>('eq'),[values,setValues]=useState<CustomFieldValues>({});
 if(!fields.length&&!criteria.length)return null;const field=fields.find(field=>field.id===fieldId),value=values[fieldId];
 const add=()=>{if(!field||!['exists','missing'].includes(op)&&(value===null||value===undefined))return;
  onChange([...criteria,{fieldId,op,...(['exists','missing'].includes(op)?{}:{value:value as CustomFieldValue})}]);setValues({});};
 const choices:CustomFieldCriterion['op'][]=field?['eq','ne','exists','missing',...(['text','url','multi'].includes(field.type)?['contains' as const]:[]),...(['number','date'].includes(field.type)?['gt','gte','lt','lte'] as const:[])]:['eq'];
 return <details className="shared-custom-field-filter-panel"><summary>{t("Фильтр по пользовательским полям",language)}{criteria.length?` · ${new Intl.NumberFormat(language).format(criteria.length)}`:''}</summary>
  <ul>{criteria.map((criterion,index)=>{const definition=fields.find(field=>field.id===criterion.fieldId);return <li key={index}><span data-no-translate>{definition?.title??t('Недоступно',language)}</span> · {t(operations[criterion.op],language)}{criterion.value!==undefined&&definition?<> · <span data-no-translate>{customFieldText(definition,criterion.value,language)}</span></>:null}
   <IconActionButton icon="close" label={t('Убрать фильтр',language)} disabled={disabled} onClick={()=>onChange(criteria.filter((_,i)=>i!==index))}/></li>;})}</ul>
  <div className="shared-custom-field-filter">
   <fieldset disabled={disabled||criteria.length>=20}><label>{t('Поле',language)}<select value={fieldId} onChange={event=>{setFieldId(event.target.value);setOp('eq');setValues({});}}><option value="">{t('Выберите поле',language)}</option>{fields.map(field=><option key={field.id} value={field.id} data-no-translate>{field.title} · {t(customFieldTypes[field.type],language)}{field.archived?` · ${t('Архив',language)}`:''}</option>)}</select></label>
    <label>{t('Условие',language)}<select value={op} onChange={event=>setOp(event.target.value as CustomFieldCriterion['op'])}>{choices.map(option=><option key={option} value={option}>{t(operations[option],language)}</option>)}</select></label>
    {field&&!['exists','missing'].includes(op)?<SharedCustomFieldInputs key={field.id} fields={[{...field,archived:false,required:false,options:field.options.map(option=>({...option,archived:false,title:option.title+(option.archived?` · ${t('Архив',language)}`:'' )}))}]} values={values} onChange={setValues} language={language} mode={mode} calculationContext={calculationContext}/>:null}
    <div className="shared-custom-field-filter-add"><span>{t('Добавить фильтр',language)}</span><IconActionButton icon="plus" label={t('Добавить фильтр',language)} disabled={!field||!['exists','missing'].includes(op)&&(value===null||value===undefined)} onClick={add}/></div>
   </fieldset>
  </div>
 </details>;
}
