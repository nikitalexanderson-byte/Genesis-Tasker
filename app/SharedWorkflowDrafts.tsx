"use client";
import type {Language} from './i18n';
import {translateText} from './i18n';
import {workflowText} from './workflow-copy';
import {workflowDraftText,workflowDraftError} from './workflow-draft-copy';
import {WorkDraftError,type WorkDraft} from './shared-work-draft-journal';
import type {WorkflowDeviceDraft} from './workflow-device-drafts';
import {IconActionButton} from './IconActionButton';

export function SharedWorkflowDrafts({rows,status,error,blocked,editing,onRestore,onRemove,onRefresh,language}:{rows:WorkDraft<WorkflowDeviceDraft>[];status:'idle'|'saving'|'saved'|'error';error:unknown;blocked:boolean;editing:boolean;onRestore:(row:WorkDraft<WorkflowDeviceDraft>)=>void;onRemove:(row:{id:string;raw:string})=>void;onRefresh:()=>void;language:Language}){
 const t=(key:Parameters<typeof workflowDraftText>[0])=>workflowDraftText(key,language),g=(text:string)=>translateText(text,language),damaged=error instanceof WorkDraftError?error.record:undefined;
 const download=()=>{if(!damaged)return;const url=URL.createObjectURL(new Blob([damaged.raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`genesis-workflow-draft-recovery-${damaged.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 if(!rows.length&&!error&&status==='idle')return null;
 return <section className="shared-workflow-device" aria-label={t('heading')}>
  {status==='saving'||status==='saved'?<p role="status" data-workflow-device-state={status}>{t(status)}</p>:null}
  {error?<div role="alert"><p>{workflowDraftError(error,language)}</p><div className="shared-planning-actions"><button type="button" className="secondary-button" disabled={blocked} onClick={onRefresh}>{g('Обновить')}</button>{damaged?<><button type="button" className="secondary-button" disabled={blocked} onClick={download}>{t('download')}</button><button type="button" className="secondary-button" disabled={blocked} onClick={()=>onRemove(damaged)}>{t('discard')}</button></>:null}</div></div>:null}
  {rows.length?<details open><summary>{t('heading')} · {new Intl.NumberFormat(language).format(rows.length)}</summary><ul>{rows.map(row=><li key={row.id} data-workflow-device-draft={row.id}>
   <time dateTime={row.at}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(row.at))}</time>
   <div className="shared-planning-actions shared-work-draft-actions"><IconActionButton icon="edit" label={t('restore')} disabled={blocked||editing||error instanceof Error&&error.message==='DRAFT_CHANGED'} onClick={()=>onRestore(row)}/><IconActionButton icon="delete" label={t('discard')} disabled={blocked||Boolean(row.value.pending)} onClick={()=>{if(!row.value.pending)onRemove(row);}}/></div>
   <small>{workflowText('revision',language)}: {new Intl.NumberFormat(language).format(row.value.draft?.config.revision??row.value.pending?.expectedRevision??row.value.snapshot.config.revision)}{row.value.pending?` · ${t('pending')}`:''}</small>
  </li>)}</ul></details>:null}
 </section>;
}
