"use client";
import {createContext,useContext,useState,type InputHTMLAttributes,type ReactNode} from 'react';
import {draftNumberValue} from './draft-number';

export type NumberDrafts=Record<string,string>;
const DraftContext=createContext<{values:NumberDrafts;change:(key:string,value:string)=>void}|null>(null);
export function NumberDraftProvider({values,onChange,children}:{values:NumberDrafts;onChange:(values:NumberDrafts)=>void;children:ReactNode}){
 return <DraftContext.Provider value={{values,change:(key,value)=>onChange({...values,[key]:value})}}>{children}</DraftContext.Provider>;
}
export function reportDraftValidity(root:HTMLElement|null):boolean{
 const invalid=root?Array.from(root.querySelectorAll<HTMLInputElement>('input:invalid,select:invalid,textarea:invalid')).find(node=>!node.disabled&&node.getClientRects().length>0):undefined;
 if(invalid){invalid.reportValidity();return false;}return true;
}
/** Text input preserves intermediate signs/decimals; only valid numbers reach wire models. */
export function DraftNumberInput({draftKey,value,onValue,invalidMessage,integer=false,min,max,optional=false,...props}:Omit<InputHTMLAttributes<HTMLInputElement>,'type'|'value'|'onChange'|'min'|'max'> & {draftKey:string;value:number|null;onValue:(value:number|null)=>void;invalidMessage:string;integer?:boolean;min?:number;max?:number;optional?:boolean}){
 const context=useContext(DraftContext),[local,setLocal]=useState<{base:number|null;raw:string}|null>(null);
 const raw=context?.values[draftKey]??(local?.base===value?local.raw:String(value??''));
 const invalid=draftNumberValue(raw,{integer,min,max,optional})===undefined;
 return <input {...props} type="text" inputMode={integer?'numeric':'decimal'} value={raw} aria-invalid={invalid||undefined} onChange={event=>{
  const raw=event.target.value;context?.change(draftKey,raw);const next=draftNumberValue(raw,{integer,min,max,optional});
  setLocal({base:next===undefined?value:next,raw});event.currentTarget.setCustomValidity(next===undefined?invalidMessage:'');if(next!==undefined)onValue(next);
 }} ref={node=>{node?.setCustomValidity(invalid?invalidMessage:'');}}/>;
}
