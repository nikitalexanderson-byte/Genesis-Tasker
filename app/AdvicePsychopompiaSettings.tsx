"use client";

import {useEffect,useRef,useState} from 'react';
import copyByLanguage from './advice-psychopompia-copy.json';
import {DialogCloseButton} from './DialogCloseButton';
import {translateText} from './i18n';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {ADVICE_AGE_POLICY,PSYCHOPOMPIA_SUBCATEGORIES,adviceAlcoholAllowed,adviceAlcoholJurisdiction,type AdvicePsychopompiaPreferences} from './advice-age-access';

type PsychopompiaSettingsProps={value:AdvicePsychopompiaPreferences;language:keyof typeof copyByLanguage;disabled:boolean;error?:string;onChange:(value:AdvicePsychopompiaPreferences)=>void};

export function AdvicePsychopompiaSettings(props:PsychopompiaSettingsProps){
  const [open,setOpen]=useState(false);
  const copy=copyByLanguage[props.language];
  return <div className="daily-advice-adult-settings">
    <button type="button" className="secondary-button daily-advice-settings-open" disabled={props.disabled}
      aria-haspopup="dialog" aria-expanded={open} data-testid="psychopompia-settings-open" onClick={()=>setOpen(true)}>{copy.title}</button>
    {open?<PsychopompiaSettingsDialog {...props} onClose={()=>setOpen(false)}/>:null}
  </div>;
}

function PsychopompiaSettingsDialog({value,language,disabled,error,onChange,onClose}:PsychopompiaSettingsProps&{onClose:()=>void}){
  const nativeDialog=useRef<HTMLDialogElement>(null);
  const focusRef=useDialogAccessibility<HTMLDialogElement>(onClose);
  useEffect(()=>{
    const dialog=nativeDialog.current;dialog?.showModal();
    return()=>dialog?.close();
  },[]);
  const copy=copyByLanguage[language],policy=ADVICE_AGE_POLICY;
  const countries=policy.jurisdictions as Record<string,{status:string;subdivisions?:Record<string,{name?:string;sourceIds?:string[]}>;sourceIds?:string[]}>;
  const names=new Intl.DisplayNames([language],{type:'region'});
  const country=countries[value.alcohol.countryCode];
  const subdivisions=country?.subdivisions??{};
  const jurisdiction=adviceAlcoholJurisdiction(value.alcohol.countryCode,value.alcohol.subdivisionCode);
  const currentRule=value.alcohol.subdivisionCode?subdivisions[value.alcohol.subdivisionCode]:country;
  const sources=currentRule?.sourceIds?.map(id=>(policy.sources as Record<string,{url:string}>)[id]).filter(Boolean)??[];
  const declare=(countryCode:string,subdivisionCode:string)=>onChange({...value,alcohol:{...value.alcohol,countryCode,subdivisionCode,consent:false,ageAtLeast:null,policyVersion:policy.policyVersion}});
  return <dialog ref={element=>{nativeDialog.current=element;focusRef(element);}} className="daily-advice-age-dialog daily-advice-psychopompia-dialog"
    aria-labelledby="psychopompia-settings-title" onClose={onClose} data-testid="psychopompia-settings-dialog">
    <header><h2 id="psychopompia-settings-title">{copy.title}</h2><DialogCloseButton type="button"
      aria-label={translateText('Закрыть',language)} onClick={onClose}/></header>
    <fieldset className="daily-advice-psychopompia" disabled={disabled} aria-describedby="psychopompia-hint">
    <label className="daily-advice-category" htmlFor="advice-psychopompia-adult"><input id="advice-psychopompia-adult" aria-label={copy.adult} type="checkbox" checked={value.adultConfirmed}
      onChange={event=>onChange({...value,adultConfirmed:event.target.checked})}/><span><strong>{copy.adult}</strong></span></label>
    <p id="psychopompia-hint" className="daily-advice-note">{copy.hint}</p>
    {!policy.corpusEnabled?<p className="daily-advice-note" role="status">{copy.pending}</p>:null}
    <details><summary>{copy.sections}</summary><fieldset disabled={!value.adultConfirmed} className="daily-advice-psychopompia-subcategories">
      {PSYCHOPOMPIA_SUBCATEGORIES.map(row=><label className="daily-advice-category" key={row.id} htmlFor={`advice-psychopompia-${row.id}`}>
        <input id={`advice-psychopompia-${row.id}`} type="checkbox" checked={value.subcategories.includes(row.id)} onChange={event=>onChange({...value,subcategories:PSYCHOPOMPIA_SUBCATEGORIES.filter(item=>item.id===row.id?event.target.checked:value.subcategories.includes(item.id)).map(item=>item.id)})}/>
        <span>{copy.subcategories[row.id as keyof typeof copy.subcategories]}</span></label>)}
    </fieldset></details>
    <fieldset disabled={!value.adultConfirmed} className="daily-advice-psychopompia-alcohol"><legend>{copy.wine}</legend>
      <label htmlFor="advice-psychopompia-country">{copy.country}<select id="advice-psychopompia-country" value={value.alcohol.countryCode} onChange={event=>declare(event.target.value,'')}>
        <option value="">{copy.choose}</option>
        {value.alcohol.countryCode&&!country?<option value={value.alcohol.countryCode}>{names.of(value.alcohol.countryCode)??value.alcohol.countryCode}</option>:null}
        {Object.keys(countries).sort((a,b)=>(names.of(a)??a).localeCompare(names.of(b)??b,language)).map(code=><option key={code} value={code}>{names.of(code)??code}</option>)}
      </select></label>
      {country?.status==='subdivision-required'?<label htmlFor="advice-psychopompia-region">{copy.region}<select id="advice-psychopompia-region" value={value.alcohol.subdivisionCode} onChange={event=>declare(value.alcohol.countryCode,event.target.value)}>
        <option value="">{copy.choose}</option>
        {Object.entries(subdivisions).map(([code,row])=><option key={code} value={code}>{row.name??code}</option>)}
      </select></label>:null}
      <label className="daily-advice-category" htmlFor="advice-psychopompia-wine"><input id="advice-psychopompia-wine" type="checkbox" checked={adviceAlcoholAllowed(value)} disabled={jurisdiction.state!=='verified'}
        onChange={event=>onChange({...value,alcohol:{...value.alcohol,consent:event.target.checked,ageAtLeast:event.target.checked?jurisdiction.minimumAge:null,policyVersion:policy.policyVersion}})}/>
        <span>{jurisdiction.minimumAge?copy.age.replace('{age}',String(jurisdiction.minimumAge)):copy.wine}</span></label>
      {jurisdiction.state!=='verified'?<p className="daily-advice-note" role="status">{jurisdiction.state==='blocked'?copy.blocked:copy.unknown}</p>:null}
      {sources.length?<details><summary>{copy.sources}</summary>{sources.map(source=><p key={source.url}><a href={source.url} target="_blank" rel="noopener noreferrer">{new URL(source.url).hostname}</a></p>)}</details>:null}
    </fieldset>
    <p className="daily-advice-note">{copy.privacy}</p>
    </fieldset>
    {error?<p role="alert">{error}</p>:null}
  </dialog>;
}
