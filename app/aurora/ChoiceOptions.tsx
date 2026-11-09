import {Children,isValidElement,useId,type ChangeEvent,type ReactNode} from 'react';
import RU from './texts.ru.json';
import {QuestionGuidance} from './QuestionGuidance';
import {text} from './adaptive-content';
import type {Language} from '../i18n';

/** The answer is always an explicit selection; no text entry or inferred facts. */
export function ChoiceOptions({label,value,choices,onChange,disabled=false,description}:{
 label:string;value:string|null;choices:readonly {id:string;label:string;description?:string}[];
 onChange:(value:string)=>void;disabled?:boolean;description?:ReactNode;
}) {
 const name=useId();
 return <fieldset className="aurora-choice-field" disabled={disabled}><legend>{label}</legend>
  {description}
  <div className="aurora-test-options">{choices.map(choice=><label className="aurora-choice" key={choice.id} data-selected={value===choice.id}>
   <input type="radio" name={name} value={choice.id} checked={value===choice.id} onChange={()=>onChange(choice.id)}/><span><strong>{choice.label}</strong>{choice.description?<small>{choice.description}</small>:null}</span>
  </label>)}</div>
 </fieldset>;
}

/** Existing option catalogs rendered as visible radio answers, including disabled choices. */
export function ChoiceSelect({children,value,onChange,disabled=false,description,optionDescriptions,'aria-label':label}:{
 children:ReactNode;value:string|number;onChange:(event:ChangeEvent<HTMLInputElement>)=>void;disabled?:boolean;'aria-label':string;
 description?:ReactNode;optionDescriptions?:Readonly<Record<string,string>>;
}) {
 const name=useId();
 return <>{description}<div role="radiogroup" aria-label={label} className="aurora-test-options">{Children.toArray(children).map(child=>{
  if(!isValidElement<{value:string|number;children:ReactNode;disabled?:boolean;'data-no-translate'?:boolean}>(child))return null;
  const option=child.props;
  return <label className="aurora-choice" key={String(option.value)} data-selected={String(value)===String(option.value)}>
   <input type="radio" name={name} value={String(option.value)} checked={String(value)===String(option.value)} disabled={disabled||option.disabled} onChange={onChange}/><span data-no-translate={option['data-no-translate']}>{option.children}{optionDescriptions?.[String(option.value)]?<small>{optionDescriptions[String(option.value)]}</small>:null}</span>
  </label>;
 })}</div></>;
}

/** Unknown times remain unknown. Only an explicit "just now" answer stamps a time. */
export function RecordedTimeChoices({label,value,onChange,language}:{label:string;value:string;onChange:(value:string)=>void;language:Language}) {
 return <ChoiceOptions label={label} value={value?'now':'unknown'} choices={[{id:'now',label:RU.timeJustNow},{id:'unknown',label:RU.text0134}]}
  description={<QuestionGuidance language={language} family="sequence" example={text('example_condition_before_outcome')}/>}
  onChange={choice=>onChange(choice==='now'?new Date().toISOString():'')}/>;
}
