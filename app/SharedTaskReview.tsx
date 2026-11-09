"use client";
import {useState} from "react";
import {setSharedTaskReview,type SharedTask,type SharedReviewKind} from "./cloud-sync";
import "./shared-review.css";
const kinds:SharedReviewKind[]=["checked","confirmed","deletable"];
const labels={checked:"Проверено",confirmed:"Подтверждено",deletable:"Можно удалять"};
export function SharedTaskReview({task,userId,onChanged}:{task:SharedTask;userId:string;onChanged:()=>Promise<void>}) {
 const [open,setOpen]=useState(false);const [pending,setPending]=useState<{kind:SharedReviewKind;enabled:boolean}|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState("");
 if(!task.completedAt||!task.review?.enabled)return null;
 const data=task.review;
 return <div className="shared-task-review" onPointerDown={event=>event.stopPropagation()}>
  {kinds.map(kind=>{const entries=data.entries.filter(entry=>entry.kind===kind);return entries.length?<span className={`shared-review-badge review-${kind}`} key={kind}>{labels[kind]}: <span data-no-translate>({entries.map(entry=>entry.displayName).join(", ")})</span></span>:null;})}
  {kinds.some(kind=>data.allowed[kind])?<button type="button" className="secondary-button" aria-expanded={open} onClick={()=>setOpen(value=>!value)}>Проверка выполнения</button>:null}
  {open?<fieldset disabled={busy}><legend>Отметки выполненной задачи</legend>{kinds.filter(kind=>data.allowed[kind]).map(kind=><label key={kind}><input type="checkbox" checked={pending?.kind===kind?pending.enabled:data.entries.some(entry=>entry.kind===kind&&entry.userId===userId)} onChange={async event=>{const enabled=event.target.checked;setPending({kind,enabled});setBusy(true);setError("");try{await setSharedTaskReview(task,kind,enabled);await onChanged();}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setPending(null);setBusy(false);}}}/>{labels[kind]}</label>)}</fieldset>:null}
  {error?<p role="alert">{error}</p>:null}
 </div>;
}
