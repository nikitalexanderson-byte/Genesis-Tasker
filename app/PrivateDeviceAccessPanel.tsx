'use client';
import {useEffect,useRef,useState} from 'react';
import {requirePrivateAccount,subscribePrivateAccount,type PrivateScopeSummary} from './e2ee/product-session';
import {pendingCurrentPrivateDeviceAccess,createCurrentPrivateDeviceAccess,loadCurrentPrivateDeviceAccess,approveCurrentPrivateDeviceAccess,submitCurrentPrivateDeviceAccess} from './cloud-sync';
import {verifyDeviceAccessRequest,deviceAccessFingerprint,type DeviceAccessRequest} from './e2ee/device-access-contract';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import copy from '../contracts/e2ee/device-access-copy-v1.json';
import sharedCopy from '../contracts/e2ee/shared-security-copy-v1.json';

export function PrivateDeviceAccessPanel({ownerId,language}:{ownerId:string;language:string}){
 const text=copy[language as keyof typeof copy]??copy.en,common=sharedCopy[language as keyof typeof sharedCopy]??sharedCopy.en;
 const [scopes,setScopes]=useState<PrivateScopeSummary[]>([]),[selected,setSelected]=useState(''),[pending,setPending]=useState<Awaited<ReturnType<typeof pendingCurrentPrivateDeviceAccess>>>([]);
 const [view,setView]=useState<Awaited<ReturnType<typeof loadCurrentPrivateDeviceAccess>>|null>(null),[incoming,setIncoming]=useState(''),[approval,setApproval]=useState('');
 const [preview,setPreview]=useState<{request:DeviceAccessRequest;fingerprint:string}|null>(null),[compared,setCompared]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const epoch=useRef(0);
 useEffect(()=>{const clear=()=>{epoch.current++;setView(null);setIncoming('');setApproval('');setPreview(null);setCompared('');setBusy(false);setMessage('');};
  const changed=()=>{if(document.visibilityState!=='visible')clear();},unsubscribe=subscribePrivateAccount(()=>{clear();setScopes([]);setPending([]);setSelected('');});
  document.addEventListener('visibilitychange',changed);return()=>{epoch.current++;unsubscribe();document.removeEventListener('visibilitychange',changed);};
 },[ownerId]);
 const run=async(work:(current:()=>void)=>Promise<void>)=>{if(busy)return;const token=++epoch.current;setBusy(true);setMessage('');
  try{const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(epoch.current!==token||requirePrivateAccount(ownerId)!==account||document.visibilityState!=='visible')throw new Error('E2EE_ACCOUNT_CHANGED');};
   current();await work(current);current();}catch(reason){if(epoch.current===token)setMessage(reason instanceof Error&&reason.message==='E2EE_CHALLENGE_EXPIRED'?text.expired:common.error);}finally{if(epoch.current===token)setBusy(false);}
 };
 return <section className="account-preferences" data-no-translate><h4>{text.title}</h4><p>{text.notice}</p>
  <button type="button" disabled={busy} onClick={()=>void run(async current=>{const rows=await requirePrivateAccount(ownerId).scopeSummaries();current();const saved=await pendingCurrentPrivateDeviceAccess();current();setScopes(rows.filter(row=>row.state==='active'));setPending(saved);})}>{common.load}</button>
  {scopes.length?<><label className="workspace-recovery-field"><span>{text.scope}</span><select value={selected} disabled={busy} onChange={event=>setSelected(event.target.value)}><option value="">—</option>{scopes.map(row=><option key={row.scopeId} value={row.scopeId}>{row.resourceId}</option>)}</select></label>
   <button type="button" disabled={busy||!selected} onClick={()=>void run(async current=>{const result=await createCurrentPrivateDeviceAccess(selected);current();setView(result);setApproval('');setPending(await pendingCurrentPrivateDeviceAccess());current();})}>{text.create}</button></>:null}
  {pending.length?<ul>{pending.map(row=><li key={row.id}><button type="button" disabled={busy} onClick={()=>void run(async current=>{const result=await loadCurrentPrivateDeviceAccess(row.id);current();setView(result);setApproval('');})}>{row.mode==='grant'?text.approval:text.request}: {row.scopeId}</button></li>)}</ul>:null}
  {view?.state.request?<><label className="workspace-recovery-field"><span>{text.request}</span><textarea readOnly rows={5} value={JSON.stringify(view.state.request)} /></label><code className="private-shared-fingerprint">{view.fingerprint}</code>
   {view.state.approval?<label className="workspace-recovery-field"><span>{text.approval}</span><textarea readOnly rows={5} value={JSON.stringify(view.state.approval)}/></label>:null}
   {view.state.mode==='request'&&!view.state.complete?<><label className="workspace-recovery-field"><span>{text.approval}</span><textarea rows={5} value={approval} maxLength={128*1024} disabled={busy||Boolean(view.state.approval)} onChange={event=>setApproval(event.target.value)} /></label>
    <button type="button" disabled={busy||!view.state.approval&&!approval.trim()} onClick={()=>void run(async current=>{const result=await submitCurrentPrivateDeviceAccess(view.state.id,approval);current();setView(result);setApproval('');setMessage(text.saved);setPending(await pendingCurrentPrivateDeviceAccess());current();})}>{text.submit}</button></>:null}
  </>:null}
  <label className="workspace-recovery-field"><span>{text.incoming}</span><textarea rows={5} value={incoming} maxLength={128*1024} disabled={busy} onChange={event=>{setIncoming(event.target.value);setPreview(null);setCompared('');}} /></label>
  <button type="button" disabled={busy||!incoming.trim()} onClick={()=>void run(async current=>{const request=await verifyDeviceAccessRequest(parseLegacyMigrationJson(incoming,'E2EE_DEVICE_ACCESS_INVALID',128*1024));current();const fingerprint=await deviceAccessFingerprint(request);current();setPreview({request,fingerprint});setCompared('');})}>{common.load}</button>
  {preview?<><p>{preview.request.target.scopeId}<br/>{preview.request.challenge.userId}<br/>{preview.request.challenge.deviceId}<br/>{text.roles[preview.request.challenge.role]}</p>
   <code className="private-shared-fingerprint">{preview.fingerprint}</code><label className="workspace-recovery-field"><span>{text.compare}</span><input value={compared} disabled={busy} maxLength={64} autoComplete="off" spellCheck={false} onChange={event=>setCompared(event.target.value.trim())}/></label>
   <button type="button" disabled={busy||compared!==preview.fingerprint} onClick={()=>void run(async current=>{const result=await approveCurrentPrivateDeviceAccess(JSON.stringify(preview.request),compared);current();setView(result);setCompared('');setPending(await pendingCurrentPrivateDeviceAccess());current();})}>{text.approve}</button>
  </>:null}
  {message?<p role="status">{message}</p>:null}
 </section>;
}
