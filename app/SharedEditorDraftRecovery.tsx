"use client";
import type {Language} from './i18n';
import {translateText} from './i18n';
import {IconActionButton} from './IconActionButton';
import {workflowDraftText,workflowDraftError} from './workflow-draft-copy';
import {WorkDraftError} from './shared-work-draft-journal';
import type {SharedEditorDraftController} from './use-shared-editor-drafts';
import {canDiscardEditorDraft} from './shared-editor-device-drafts';

export function SharedEditorDraftRecovery<T>({controller,language,busy,editing,onRestore,onRetry,onEdit,onError,title}:{controller:SharedEditorDraftController<T>;language:Language;busy:boolean;editing:boolean;onRestore:(value:T)=>void;onRetry:()=>void;onEdit:(value:T)=>void;onError:(reason:unknown)=>void;title:(value:T)=>string}){
 const {device,document,rows}=controller,t=(s:string)=>translateText(s,language),d=(key:Parameters<typeof workflowDraftText>[0])=>workflowDraftText(key,language);
 const attempt=(work:()=>Promise<unknown>)=>{void work().catch(onError);},damaged=device.error instanceof WorkDraftError?device.error.record:undefined;
 const download=()=>{if(!damaged)return;const url=URL.createObjectURL(new Blob([damaged.raw],{type:'application/json'})),link=window.document.createElement('a');link.href=url;link.download=`genesis-editor-draft-${damaged.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 if(!document&&!rows.length&&!device.error)return null;
 return <section className="shared-editor-recovery" aria-label={d('heading')}>
  {document?<p role="status" data-editor-device-phase={document.phase}>{document.phase==='pending'?d('pending'):document.phase==='rejected'?d('edit'):d(device.status==='error'?'error':device.status==='saving'?'saving':'saved')}</p>:null}
  {document&&document.phase!=='editing'?<div className="template-actions">
   {document.phase==='pending'||document.phase==='received'?<IconActionButton icon="map-refresh" label={t('Повторить')} disabled={busy||!navigator.onLine} onClick={onRetry}/>:null}
   {document.phase==='rejected'||document.phase==='pending'&&document.attempts===0?<IconActionButton icon="edit" label={t('Редактировать')} disabled={busy} onClick={()=>attempt(async()=>onEdit(await controller.resumeEditing()))}/>:null}
  </div>:null}
  {device.error?<div role="alert"><p>{workflowDraftError(device.error,language)}</p><div className="template-actions">
   <IconActionButton icon="map-refresh" label={t('Обновить')} disabled={busy} onClick={()=>attempt(async()=>{await device.refresh();if(document?.phase==='editing')await controller.persist(document);})}/>
   {damaged?<><IconActionButton icon="file" label={d('download')} disabled={busy} onClick={download}/><IconActionButton icon="delete" label={d('discard')} disabled={busy} onClick={()=>{if(window.confirm(d('discard')))attempt(()=>device.remove(damaged));}}/></>:null}
  </div></div>:null}
  {rows.length?<details open><summary>{d('heading')} · {new Intl.NumberFormat(language).format(rows.length)}</summary><ul>{rows.map(row=><li key={row.id} data-editor-device-draft={row.id}>
   <div className="shared-editor-draft-copy"><strong data-no-translate>{title(row.value.editor)}</strong><time dateTime={row.at}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(row.at))}</time></div><div className="template-actions">
    <IconActionButton icon="edit" label={d('restore')} disabled={busy||editing||Boolean(document)} onClick={()=>attempt(async()=>onRestore(await controller.restore(row)))}/>
    <IconActionButton icon="delete" label={d('discard')} disabled={busy||!canDiscardEditorDraft(row.value)} onClick={()=>{if(canDiscardEditorDraft(row.value)&&window.confirm(d('discard')))attempt(()=>device.remove(row));}}/>
   </div></li>)}</ul></details>:null}
 </section>;
}
