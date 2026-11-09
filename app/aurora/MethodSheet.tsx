import {useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {DialogCloseButton} from '../DialogCloseButton';
import {useDialogAccessibility} from '../use-dialog-accessibility';
import A from './adaptive-copy.ru.json';
import RU from './texts.ru.json';
import {IconActionButton} from '../IconActionButton';

/** Supporting material has its own screen and focus scope, never an accordion in the task. */
export function MethodSheet({title,children,className='',icon,label}:{title:ReactNode;children:ReactNode;className?:string;icon?:string;label?:string}){
 const [open,setOpen]=useState(false),ref=useRef<HTMLDialogElement|null>(null),id=useId();
 const focus=useDialogAccessibility<HTMLDialogElement>(()=>setOpen(false),open);
 useEffect(()=>{if(open&&!ref.current?.open)ref.current?.showModal();else if(!open)ref.current?.close();},[open]);
 return <div className={`aurora-sheet ${className}`}>
  {icon&&label?<IconActionButton icon={icon} label={label} onClick={()=>setOpen(true)}/>:<button type="button" className="secondary-button aurora-sheet-trigger" onClick={()=>setOpen(true)}>{title}</button>}
  {open?<dialog ref={node=>{ref.current=node;focus(node);}} className="aurora-method-sheet" data-dialog-header="none" aria-labelledby={id} onCancel={event=>{event.preventDefault();setOpen(false);}}>
   <header><h3 id={id}>{title}</h3><DialogCloseButton aria-label={RU.text0082} onClick={()=>setOpen(false)}/></header>
   <div className="aurora-sheet-body">{children}</div>
   <footer><button type="button" className="primary-button" onClick={()=>setOpen(false)}>{A.returnToStep}</button></footer>
  </dialog>:null}
 </div>;
}
