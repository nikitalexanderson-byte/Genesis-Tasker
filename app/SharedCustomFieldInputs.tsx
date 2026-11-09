"use client";
import { useId } from "react";
import { CalendarDatePicker } from "./CalendarDatePicker";
import type { CalendarContext } from "./calendar-context";
import { formatCalendarDate, type CalendarMode } from "./calendar-data";
import { translateText as t, type Language } from "./i18n";
import { customFieldText, type CustomFieldValues, type SharedCustomField } from "./shared-custom-fields";
import "./shared-custom-fields.css";
import {DraftNumberInput} from './DraftNumberInput';

export function SharedCustomFieldInputs({fields,values,onChange,language,mode,calculationContext,disabled=false,draftScope='values'}:{fields:SharedCustomField[];values:CustomFieldValues;
  onChange:(values:CustomFieldValues)=>void;language:Language;mode:CalendarMode;calculationContext?:CalendarContext;disabled?:boolean;draftScope?:string}){
  const prefix=useId(),active=fields.filter(field=>!field.archived);
  if(!active.length)return null;
  const update=(id:string,value:CustomFieldValues[string])=>onChange({...values,[id]:value});
  return <fieldset className="shared-custom-fields-inputs" disabled={disabled}><legend>{t("Пользовательские поля",language)}</legend>
    {active.map(field=>{const id=`${prefix}-${field.id}`,value=values[field.id],title=<span data-no-translate>{field.title}</span>,required=field.required;
      return <div className="shared-custom-field-input" data-custom-field-id={field.id} key={field.id}>
        <label htmlFor={id}>{title}{required?<span> · {t("Обязательное поле",language)}</span>:null}</label>
        {field.type==="date"?<><CalendarDatePicker id={id} value={typeof value==="string"?value:""} mode={mode} calculationContext={calculationContext} required={required} ariaLabel={field.title} onChange={value=>update(field.id,value||null)}/>
          {value?<button type="button" className="text-button" onClick={()=>update(field.id,null)}>{t("Очистить",language)}</button>:null}</>
        :field.type==="checkbox"?<select id={id} required={required} value={value===null||value===undefined?"":String(value)} onChange={event=>update(field.id,event.target.value===""?null:event.target.value==="true")}>
          <option value="">{t("Не задано",language)}</option><option value="true">{t("Да",language)}</option><option value="false">{t("Нет",language)}</option></select>
        :field.type==="select"||field.type==="multi"?<select id={id} required={required} multiple={field.type==="multi"} value={field.type==="multi"?(Array.isArray(value)?value:[]):typeof value==="string"?value:""}
          onChange={event=>update(field.id,field.type==="multi"?Array.from(event.target.selectedOptions).map(option=>option.value):event.target.value||null)}>
          {field.type==="select"?<option value="">{t("Не задано",language)}</option>:null}
          {field.options.filter(option=>!option.archived||value===option.id||Array.isArray(value)&&value.includes(option.id)).map(option=><option key={option.id} value={option.id} disabled={option.archived} data-no-translate>{option.title}{option.archived?` · ${t("Архив",language)}`:""}</option>)}
        </select>
        :field.type==='number'?<DraftNumberInput id={id} draftKey={`${draftScope}:${field.id}`} value={typeof value==='number'?value:null} optional={!required} required={required} invalidMessage={t("Проверьте тип и значение пользовательского поля.",language)} onValue={next=>update(field.id,next)}/>
        :<input id={id} type={field.type==="url"?"url":"text"} required={required}
          value={typeof value==="string"?value:""} maxLength={5000}
          onChange={event=>update(field.id,event.target.value||null)}/>}
      </div>;
    })}
  </fieldset>;
}

export function SharedCustomFieldValues({fields,values,language,mode,list=false}:{fields:SharedCustomField[];values:CustomFieldValues;language:Language;mode:CalendarMode;list?:boolean}){
  const shown=fields.filter(field=>(list?field.showList&&!field.archived:field.showCard)&&values[field.id]!==undefined&&values[field.id]!==null);
  if(!shown.length)return null;
  return <dl className={list?"shared-custom-field-list":"shared-custom-field-values"}>{shown.map(field=>{const value=values[field.id];
    const text=field.type==="date"&&typeof value==="string"?formatCalendarDate(new Date(`${value}T12:00:00`),mode,true):customFieldText(field,value,language);
    return <div key={field.id}><dt data-no-translate>{field.title}{field.archived?<span> · {t("Архив",language)}</span>:null}</dt>
      <dd>{field.type==="url"&&typeof value==="string"&&/^https?:\/\//i.test(value)?<a href={value} target="_blank" rel="noopener noreferrer" data-no-translate>{text}</a>:<span data-no-translate={field.type!=="checkbox"||undefined}>{text}</span>}</dd></div>;
  })}</dl>;
}
