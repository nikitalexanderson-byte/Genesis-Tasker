'use client';
import {useEffect,useRef,useState} from 'react';
import {sharedCollaborationRequest,approveSharedTask,type SharedTask} from './cloud-sync';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import type {ProductVersion} from './e2ee/shared-product';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {translateText,type Language} from './i18n';
import copy from '../contracts/e2ee/approval-review-copy-v1.json';
type Proposal={proposalId:string;payloadHash:string;version:ProductVersion;task:SharedTask};

/** Only the immutable version shown here can be signed. Retrying a failed
 * confirmation retains the same local decision and request identity. */
export function PrivateTaskCompletionReview({ownerId,task,language,onClose,onApproved}:{ownerId:string;task:SharedTask;language:Language;onClose:()=>void;onApproved:(task:SharedTask)=>void}){
 const text=copy[language],dialog=useDialogAccessibility<HTMLDivElement>(onClose),generation=useRef(0),closeRef=useRef(onClose),[rows,setRows]=useState<Proposal[]|null>(null),[selected,setSelected]=useState(''),[reviewed,setReviewed]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState(false),ids=useRef(new Map<string,string>());closeRef.current=onClose;
 useEffect(()=>{const current=++generation.current,account=requirePrivateAccount(ownerId),controller=new AbortController();
  const unsubscribe=subscribePrivateAccount(()=>{generation.current++;controller.abort();setRows(null);closeRef.current();});
  void sharedCollaborationRequest<{proposals:Proposal[]}>(`/projects/${encodeURIComponent(task.projectId)}/tasks/${encodeURIComponent(task.id)}/approval-preview`,{method:'POST',body:'{}',signal:controller.signal}).then(result=>{account.requireOpen();if(generation.current!==current)return;if(!Array.isArray(result.proposals)||result.proposals.length>200)throw new Error('E2EE_PRODUCT_PROPOSAL_STALE');setRows(result.proposals);setSelected(result.proposals[0]?.proposalId??'');}).catch(()=>{if(generation.current===current)setError(true);});
  return()=>{generation.current++;controller.abort();unsubscribe();};
 },[ownerId,task.projectId,task.id]);
 const proposal=rows?.find(row=>row.proposalId===selected),confirm=async()=>{if(!proposal||!reviewed||busy)return;const current=generation.current,account=requirePrivateAccount(ownerId);setBusy(true);setError(false);
  try{let requestId=ids.current.get(selected);if(!requestId){requestId=crypto.randomUUID();ids.current.set(selected,requestId);}const {proposalId,payloadHash,version}=proposal;
   const result=await approveSharedTask(task.projectId,task.id,{review:{proposalId,payloadHash,version},requestId});account.requireOpen();if(current===generation.current)onApproved(result);
  }catch{if(current===generation.current)setError(true);}finally{if(current===generation.current)setBusy(false);}
 };
 return <div className="private-vault-gate"><div ref={dialog} role="dialog" aria-modal="true" aria-labelledby="private-approval-title" className="workspace-recovery-dialog private-vault-dialog" tabIndex={-1} data-no-translate>
  <h2 id="private-approval-title">{text.title}</h2><p>{text.notice}</p>
  {rows?.length===0?<p>{text.empty}</p>:null}
  {rows&&rows.length>1?<select value={selected} disabled={busy} onChange={event=>{setSelected(event.target.value);setReviewed(false);}} aria-label={text.details}>{rows.map(row=><option key={row.proposalId} value={row.proposalId}>{row.task.title} · {row.proposalId.slice(0,8)}</option>)}</select>:null}
  {proposal?<><h3>{proposal.task.title}</h3><p style={{whiteSpace:'pre-wrap'}}>{proposal.task.description}</p><details><summary>{text.details}</summary><pre style={{overflow:'auto',maxHeight:'40vh',whiteSpace:'pre'}}>{JSON.stringify(proposal.task,null,2)}</pre></details>
   <label className="backup-check"><input type="checkbox" checked={reviewed} disabled={busy} onChange={event=>setReviewed(event.target.checked)}/>{translateText('Подтвердить выполнение',language)}</label></>:null}
  {error?<p role="alert">{translateText('Не удалось выполнить действие. Черновик сохранён; повторите попытку.',language)}</p>:null}
  <div className="workspace-recovery-actions"><button type="button" disabled={busy} onClick={onClose}>{translateText('Отмена',language)}</button><button type="button" className="primary-button" disabled={busy||!proposal||!reviewed} onClick={()=>void confirm()}>{translateText('Подтвердить',language)}</button></div>
 </div></div>;
}
