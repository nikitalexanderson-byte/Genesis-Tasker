"use client";
import { DialogCloseButton } from "./DialogCloseButton";
import {useCallback,useEffect,useRef,useState} from "react";
import {listSharedTrash,restoreSharedTrash,purgeSharedTask,type SharedTrashEntry} from "./cloud-sync";
import {useDialogAccessibility} from "./use-dialog-accessibility";
import "./shared-review.css";
import {translateText as t} from "./i18n";
import {IconActionButton} from './IconActionButton';
import {workflowError,workflowText} from './workflow-copy';
const trashError=(reason:unknown)=>workflowError(reason)??t(reason instanceof Error?reason.message:String(reason));
export function SharedTrash({spaceId,onClose,onChanged,onWorkflow}:{spaceId:string;onClose:()=>void;onChanged:()=>Promise<void>;onWorkflow:(project:{id:string;title:string})=>void}) {
 const ref=useDialogAccessibility<HTMLDivElement>(onClose);const [items,setItems]=useState<SharedTrashEntry[]>([]);const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [loaded,setLoaded]=useState(false);
 const refresh=useCallback(async()=>{setItems(await listSharedTrash(spaceId));setLoaded(true);},[spaceId]);
 useEffect(()=>{let active=true;void listSharedTrash(spaceId).then(value=>{if(active){setItems(value);setLoaded(true);}}).catch(e=>{if(active)setError(String(e));});return()=>{active=false;};},[spaceId]);
 return <div className="modal-backdrop"><div className="editor-modal shared-trash-dialog" role="dialog" aria-modal="true" aria-label="Корзина" ref={ref} tabIndex={-1}>
 <header><h2>Корзина</h2><DialogCloseButton type="button" aria-label="Закрыть" onClick={onClose} /></header>
 <p>Удалённые задачи и проекты можно восстановить до окончания срока хранения. Максимальный срок — 30 дней.</p>
 {!loaded?<p role="status">Загрузка…</p>:!items.length?<p>Корзина пуста.</p>:items.map(item=><article className="shared-trash-item" key={`${item.kind}:${item.id}`}><h3 data-no-translate>{item.title}</h3><p>{item.kind==="task"?"Задача":"Проект"} · <time dateTime={item.expiresAt}>{new Date(item.expiresAt).toLocaleDateString(document.documentElement.lang)}</time></p>
 <div>{item.canManageWorkflow&&item.projectId?<IconActionButton icon="settings" className="shared-trash-icon-action" label={workflowText('heading')} data-workflow-repair={item.projectId} disabled={busy} onClick={()=>onWorkflow({id:item.projectId!,title:item.projectTitle??item.title})}/>:null}<label>Срок хранения, дней<input type="number" min={1} max={30} defaultValue={item.retentionDays} disabled={busy||!item.canRestore} onBlur={async event=>{const value=Number(event.target.value);if(value===item.retentionDays)return;setBusy(true);setError("");try{await restoreSharedTrash(spaceId,item,value);await refresh();}catch(e){setError(trashError(e));event.target.value=String(item.retentionDays);}finally{setBusy(false);}}}/></label><button type="button" disabled={busy||!item.canRestore} onClick={async()=>{setBusy(true);setError("");try{await restoreSharedTrash(spaceId,item);await refresh();await onChanged();}catch(e){setError(trashError(e));}finally{setBusy(false);}}}>Восстановить</button>{item.kind==="task" && item.canPurge ? <IconActionButton icon="delete" className="shared-trash-icon-action shared-trash-purge" label={t("Удалить навсегда")} disabled={busy} onClick={async()=>{
   if(!window.confirm(t("Удалить навсегда задачу, её подзадачи, комментарии и вложения? Это действие нельзя отменить.")+"\n"+item.title))return;
   setBusy(true);setError("");try{await purgeSharedTask(spaceId,item);await refresh();await onChanged();}catch(error){setError(String(error));}finally{setBusy(false);}
 }}/> : null}</div></article>)}
 {error?<p role="alert">{error}</p>:null}</div></div>;
}
export function SharedTrashConfirmation({title,onClose,onConfirm}:{title:string;onClose:()=>void;onConfirm:(days:number)=>Promise<void>}) {
 const [days,setDays]=useState(30);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 const focusRef=useDialogAccessibility<HTMLDialogElement>(()=>{if(!busy)onClose();});const dialogRef=useRef<HTMLDialogElement|null>(null);
 const ref=useCallback((element:HTMLDialogElement|null)=>{dialogRef.current=element;focusRef(element);},[focusRef]);
 useEffect(()=>{const dialog=dialogRef.current;dialog?.showModal();return()=>dialog?.close();},[]);
 return <dialog className="editor-modal shared-trash-confirmation" aria-label="Переместить в корзину" ref={ref} tabIndex={-1} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
 <header><h2>Переместить в корзину</h2><DialogCloseButton type="button" aria-label="Закрыть" disabled={busy} onClick={onClose} /></header><p data-no-translate>{title}</p>
 <p>До окончания срока хранения объект можно восстановить. Затем он будет удалён автоматически.</p><p>{t("Подзадачи перемещаются вместе с родителем. Ранее удалённые подзадачи сохраняют свой срок хранения.")}</p><label>Срок хранения, дней<input type="number" min={1} max={30} value={days} disabled={busy} onChange={event=>setDays(Number(event.target.value))}/></label>
 <button type="button" disabled={busy} onClick={onClose}>Отмена</button><button type="button" className="danger-button" disabled={busy||!Number.isInteger(days)||days<1||days>30} onClick={async()=>{setBusy(true);try{await onConfirm(days);onClose();}catch(e){setError(String(e));}finally{setBusy(false);}}}>В корзину</button>{error?<p role="alert">{error}</p>:null}</dialog>;
}
