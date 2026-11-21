'use client';
import {useEffect,useRef,useState} from 'react';
import {requirePrivateAccount,subscribePrivateAccount,type PrivateScopeSummary} from './e2ee/product-session';
import {E2eeSharedTrust,type SharedTrustProposal} from './e2ee/shared-trust';
import copy from '../contracts/e2ee/shared-security-copy-v1.json';

export function PrivateSharedSecurityPanel({ownerId,language}:{ownerId:string;language:string}){
 const text=copy[language as keyof typeof copy]??copy.en,version=useRef(0),[scopes,setScopes]=useState<PrivateScopeSummary[]>([]),[loaded,setLoaded]=useState(false),[selected,setSelected]=useState(''),[candidate,setCandidate]=useState<{proposal:SharedTrustProposal;fingerprint:string}|null>(null),[compared,setCompared]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>subscribePrivateAccount(()=>{version.current++;setCandidate(null);setCompared('');setAccepted(false);setBusy(false);setMessage('');}),[ownerId]);
 useEffect(()=>()=>{version.current++;},[]);
 const run=async(work:(current:()=>void)=>Promise<void>)=>{if(busy)return;const token=++version.current;setBusy(true);setMessage('');
  try{const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(version.current!==token||requirePrivateAccount(ownerId)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');};await work(current);current();}
  catch{if(version.current===token)setMessage(text.error);}finally{if(version.current===token)setBusy(false);}
 };
 const choose=(id:string)=>{setSelected(id);setCandidate(null);setCompared('');setAccepted(false);if(id)void run(async current=>{const value=await requirePrivateAccount(ownerId).proposeSharedTrust(id);current();setCandidate(value);const known=await new E2eeSharedTrust(ownerId).list();current();setAccepted(known.some(row=>row.scopeId===id&&row.fingerprint===value.fingerprint));});};
 return <section className="account-preferences private-shared-security" data-no-translate><h3>{text.title}</h3><p>{text.notice}</p>
  <button type="button" disabled={busy} onClick={()=>void run(async current=>{const rows=await requirePrivateAccount(ownerId).scopeSummaries();current();setScopes(rows.filter(row=>row.kind!=='personal'));setLoaded(true);})}>{text.load}</button>
  {loaded&&!scopes.length?<p>{text.empty}</p>:null}
  {scopes.length?<label>{text.select}<select value={selected} disabled={busy} onChange={event=>choose(event.target.value)}><option value="">—</option>{scopes.map(row=><option key={row.scopeId} value={row.scopeId}>{row.resourceId}</option>)}</select></label>:null}
  {candidate?<><code className="private-shared-fingerprint">{candidate.fingerprint}</code>
   {!accepted?<><label>{text.compare}<input autoComplete="off" spellCheck={false} value={compared} maxLength={64} disabled={busy} onChange={event=>setCompared(event.target.value.trim())}/></label><button type="button" disabled={busy||compared!==candidate.fingerprint} onClick={()=>void run(async current=>{await new E2eeSharedTrust(ownerId).accept(candidate.proposal,compared);current();await new E2eeSharedTrust(ownerId).open(selected);current();setAccepted(true);setMessage(text.saved);})}>{text.accept}</button></>:null}
   {accepted&&candidate.proposal.ownerId===ownerId?<button type="button" disabled={busy} onClick={()=>void run(async current=>{const account=requirePrivateAccount(ownerId);await new E2eeSharedTrust(ownerId).open(selected);current();const {bootstrap}=await account.sharedRecords(selected,candidate.proposal.kind,candidate.proposal.resourceId);await bootstrap.prepare();current();await bootstrap.flush();current();setMessage(text.complete);})}>{text.baseline}</button>:null}
  </>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
