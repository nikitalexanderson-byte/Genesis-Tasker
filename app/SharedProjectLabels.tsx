"use client";
import { useState } from 'react';
import { translateText } from './i18n';
import { ExperimentalIcon } from './ExperimentalIcon';
export function SharedProjectLabels({value,defaultValue=[],onChange,name}:{value?:string[];defaultValue?:string[];onChange?:(value:string[])=>void;name?:string}){
  const [saved,setSaved]=useState(defaultValue),[draft,setDraft]=useState('');
  const labels=value??saved;
  const change=(items:string[])=>{const next=[...new Set(items)];setSaved(next);onChange?.(next);};
  const add=()=>{if(draft.trim()&&labels.length<30){change([...labels,draft.trim().slice(0,80)]);setDraft('');}};
  return <fieldset className="shared-project-labels"><legend>{translateText('Метки проекта')}</legend><input type="hidden" name={name} value={JSON.stringify(labels)}/>
    <div className="shared-project-label-chips">{labels.map(label=><span key={label}><span data-no-translate>{label}</span><button type="button" data-no-translate aria-label={`${translateText('Удалить метку')}: ${label}`} onClick={()=>change(labels.filter(item=>item!==label))}><ExperimentalIcon name="close"/></button></span>)}</div>
    <label>{translateText('Новая метка')}<input maxLength={80} value={draft} onChange={event=>setDraft(event.target.value)} onKeyDown={event=>{if(event.key==='Enter'){event.preventDefault();add();}}} onBlur={add}/></label>
    <button type="button" className="secondary-button" disabled={!draft.trim()||labels.length>=30} onClick={add}>{translateText('Добавить')}</button>
  </fieldset>;
}
