"use client";
import { useId } from 'react';
import type { SharedTask } from './cloud-sync';
import type { Language } from './i18n';
import { planningText, type EstimateDraft } from './shared-planning';
import './shared-planning.css';

export function SharedEstimateInputs({value,onChange,language,disabled=false}:{value:EstimateDraft;onChange:(value:EstimateDraft)=>void;language:Language;disabled?:boolean}){
 const id=useId();return <fieldset className="shared-estimate-inputs" data-no-translate disabled={disabled} aria-describedby={`${id}-hint`}><legend>{planningText('estimates',language)}</legend>
  {(['storyPoints','estimateHours'] as const).map(field=><label key={field}>{planningText(field==='storyPoints'?'points':'hours',language)}<input type="number" min="0" max="1000000" step="0.01" inputMode="decimal" value={value[field]} placeholder={planningText('unestimated',language)} onChange={event=>onChange({...value,[field]:event.target.value})}/></label>)}
  <small id={`${id}-hint`}>{planningText('independent',language)}</small>
 </fieldset>;
}
export function SharedEstimateValues({task,language}:{task:Pick<SharedTask,'storyPoints'|'estimateHours'>;language:Language}){
 const number=new Intl.NumberFormat(language,{maximumFractionDigits:2});return <dl className="shared-estimate-values" data-no-translate>{(['storyPoints','estimateHours'] as const).map(field=><div key={field}><dt>{planningText(field==='storyPoints'?'points':'hours',language)}</dt><dd>{task[field]==null?planningText('unestimated',language):number.format(task[field])}</dd></div>)}</dl>;
}
