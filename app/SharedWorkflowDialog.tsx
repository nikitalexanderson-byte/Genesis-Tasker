"use client";
import {useCallback,useEffect,useRef,useState} from 'react';
import {SharedWorkflow} from './SharedWorkflow';
import {DialogCloseButton} from './DialogCloseButton';
import {useDialogAccessibility} from './use-dialog-accessibility';
import type {Language} from './i18n';
import './shared-templates.css';
import './shared-planning.css';

export function SharedWorkflowDialog({userId,project,language,onClose,onChanged}:{userId:string;project:{id:string;title:string};language:Language;onClose:()=>void;onChanged:()=>Promise<void>}){
 const dialog=useRef<HTMLDialogElement|null>(null),focus=useDialogAccessibility<HTMLDialogElement>(onClose),[online,setOnline]=useState(()=>typeof navigator==='undefined'||navigator.onLine);
 const ref=useCallback((element:HTMLDialogElement|null)=>{dialog.current=element;focus(element);},[focus]);
 useEffect(()=>{const element=dialog.current;element?.showModal();return()=>element?.close();},[]);
 useEffect(()=>{const connection=()=>setOnline(navigator.onLine);window.addEventListener('online',connection);window.addEventListener('offline',connection);return()=>{window.removeEventListener('online',connection);window.removeEventListener('offline',connection);};},[]);
 return <dialog ref={ref} className="shared-templates-dialog shared-planning-dialog shared-workflow-dialog" aria-labelledby="shared-workflow-dialog-title" data-no-translate onCancel={event=>{event.preventDefault();onClose();}}>
  <header><h2 id="shared-workflow-dialog-title">{project.title}</h2><DialogCloseButton onClick={onClose}/></header>
  <SharedWorkflow userId={userId} projectId={project.id} language={language} disabled={!online} onChanged={onChanged} onAccessLost={onClose} initiallyExpanded/>
 </dialog>;
}
