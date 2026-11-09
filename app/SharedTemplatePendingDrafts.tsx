"use client";
import {useCallback,useEffect} from 'react';
import {translateText,type Language} from './i18n';
import {workflowDraftText,workflowDraftError} from './workflow-draft-copy';
import {useSharedWorkDrafts} from './use-shared-work-drafts';
import {validateTemplateApplyDeviceDraft,type TemplateApplySnapshot} from './template-apply-device-drafts';
import {canDiscardEditorDraft,type EditorDeviceDraft} from './shared-editor-device-drafts';
import {WorkDraftError,type WorkDraft} from './shared-work-draft-journal';
import {IconActionButton} from './IconActionButton';

export function SharedTemplatePendingDrafts({userId,spaceId,projectId,language,opened,busy,onOpen,onError}:{userId:string;spaceId:string;projectId:string;language:Language;opened:boolean;busy:boolean;onOpen:(row:WorkDraft<EditorDeviceDraft<TemplateApplySnapshot>>)=>void;onError:(reason:unknown)=>void}){
 const validate=useCallback((raw:unknown)=>validateTemplateApplyDeviceDraft(raw,spaceId,projectId),[spaceId,projectId]);
 const device=useSharedWorkDrafts(userId,projectId,'template-apply',!opened,validate),rows=device.rows.filter(row=>row.value.editor.contextKey==='library');
 const refresh=device.refresh;
 useEffect(()=>{if(!opened)void refresh();},[opened,refresh]);
 const d=(key:Parameters<typeof workflowDraftText>[0])=>workflowDraftText(key,language);
 const damaged=device.error instanceof WorkDraftError?device.error.record:undefined;
 const download=()=>{if(!damaged)return;const url=URL.createObjectURL(new Blob([damaged.raw],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download=`genesis-template-apply-draft-${damaged.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 if(!rows.length&&!device.error)return null;
 return <section className="shared-editor-recovery" aria-label={d('heading')}>
  {device.error?<div role="alert"><p>{workflowDraftError(device.error,language)}</p><div className="template-actions"><IconActionButton icon="map-refresh" label={translateText('Обновить',language)} disabled={busy} onClick={()=>void device.refresh().catch(onError)}/>{damaged?<><IconActionButton icon="file" label={d('download')} disabled={busy} onClick={download}/><IconActionButton icon="delete" label={d('discard')} disabled={busy} onClick={()=>{if(window.confirm(d('discard')))void device.remove(damaged).catch(onError);}}/></>:null}</div></div>:null}
  {!opened&&rows.length?<details open><summary>{d('heading')} · {new Intl.NumberFormat(language).format(rows.length)}</summary><ul>{rows.map(row=><li key={row.id} data-template-apply-recovery={row.id}><div className="shared-editor-draft-copy"><strong data-no-translate>{row.value.editor.title}</strong><time dateTime={row.at}>{new Intl.DateTimeFormat(language,{dateStyle:'medium',timeStyle:'medium'}).format(new Date(row.at))}</time></div><div className="template-actions">
   <IconActionButton icon="edit" label={d('restore')} disabled={busy} onClick={()=>onOpen(row)}/><IconActionButton icon="delete" label={d('discard')} disabled={busy||!canDiscardEditorDraft(row.value)} onClick={()=>{if(canDiscardEditorDraft(row.value)&&window.confirm(d('discard')))void device.remove(row).catch(onError);}}/>
  </div></li>)}</ul></details>:null}
 </section>;
}
