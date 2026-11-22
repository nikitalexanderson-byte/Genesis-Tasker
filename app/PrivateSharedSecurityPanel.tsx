'use client';
import {useEffect,useRef,useState} from 'react';
import {requirePrivateAccount,subscribePrivateAccount,type PrivateScopeSummary} from './e2ee/product-session';
import {E2eeSharedTrust,type SharedTrustProposal} from './e2ee/shared-trust';
import copy from '../contracts/e2ee/shared-security-copy-v1.json';
import migrationCopy from '../contracts/e2ee/shared-migration-copy-v1.json';
import {showPrivateMigration} from './private-migration-ui';
import {sharedTransitionTargets} from './e2ee/shared-transition-targets';
import type {WebSharedMigrationTarget} from './e2ee/web-product-migration';
import creationCopy from '../contracts/e2ee/private-resource-copy-v1.json';
import {pendingCurrentPrivateCreations} from './cloud-sync';

export function PrivateSharedSecurityPanel({ownerId,language}:{ownerId:string;language:string}){
 const migration=migrationCopy[language as keyof typeof migrationCopy]??migrationCopy.en;
 const [targets,setTargets]=useState<WebSharedMigrationTarget[]>([]),[transition,setTransition]=useState('');
 const [creations,setCreations]=useState<Awaited<ReturnType<typeof pendingCurrentPrivateCreations>>>([]),creationText=creationCopy[language as keyof typeof creationCopy]??creationCopy.en;
 const text=copy[language as keyof typeof copy]??copy.en,version=useRef(0),[scopes,setScopes]=useState<PrivateScopeSummary[]>([]),[loaded,setLoaded]=useState(false),[selected,setSelected]=useState(''),[candidate,setCandidate]=useState<{proposal:SharedTrustProposal;fingerprint:string}|null>(null),[compared,setCompared]=useState(''),[accepted,setAccepted]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 useEffect(()=>subscribePrivateAccount(()=>{version.current++;setCandidate(null);setCompared('');setAccepted(false);setBusy(false);setMessage('');setScopes([]);setTargets([]);setCreations([]);setLoaded(false);setTransition('');}),[ownerId]);
 useEffect(()=>()=>{version.current++;},[]);
 const run=async(work:(current:()=>void)=>Promise<void>)=>{if(busy)return;const token=++version.current;setBusy(true);setMessage('');
  try{const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(version.current!==token||requirePrivateAccount(ownerId)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');};await work(current);current();}
  catch{if(version.current===token)setMessage(text.error);}finally{if(version.current===token)setBusy(false);}
 };
 const choose=(id:string)=>{setSelected(id);setCandidate(null);setCompared('');setAccepted(false);if(id)void run(async current=>{const value=await requirePrivateAccount(ownerId).proposeSharedTrust(id);current();setCandidate(value);const known=await new E2eeSharedTrust(ownerId).list();current();setAccepted(known.some(row=>row.scopeId===id&&row.fingerprint===value.fingerprint));});};
 return <section className="account-preferences private-shared-security" data-no-translate><h3>{text.title}</h3><p>{text.notice}</p>
  <button type="button" disabled={busy} onClick={()=>void run(async current=>{const account=requirePrivateAccount(ownerId),rows=await account.scopeSummaries();current();await account.personal().client.refresh();current();
   const owned=sharedTransitionTargets(await account.personal().client.readTransitionCandidates());current();const pending=await pendingCurrentPrivateCreations();current();setScopes(rows.filter(row=>row.kind!=='personal'));setTargets(owned);setCreations(pending);setLoaded(true);})}>{text.load}</button>
  {creations.length?<div><h4>{creationText.pending}</h4>{creations.map(row=><button key={row.intentId} type="button" disabled={busy} onClick={()=>showPrivateMigration(ownerId,language,'resume',{scopeId:row.scopeId,kind:row.kind,resourceId:row.resourceId},row.intentId)}>{creationText.resume}: {row.input.title}</button>)}</div>:null}
  {loaded&&!scopes.length&&!targets.length&&!creations.length?<p>{text.empty}</p>:null}
  {targets.length?<><label>{migration.transfer}<select value={transition} disabled={busy} onChange={event=>setTransition(event.target.value)}><option value="">—</option>{targets.map(row=><option key={row.scopeId} value={row.scopeId}>{row.resourceId}</option>)}</select></label>
   <button type="button" disabled={busy||!targets.some(row=>row.scopeId===transition)} onClick={()=>{const target=targets.find(row=>row.scopeId===transition);if(target)showPrivateMigration(ownerId,language,'resume',target);}}>{migration.transfer}</button></>:null}
  {scopes.length?<label>{text.select}<select value={selected} disabled={busy} onChange={event=>choose(event.target.value)}><option value="">—</option>{scopes.map(row=><option key={row.scopeId} value={row.scopeId}>{row.resourceId}</option>)}</select></label>:null}
  {candidate?<><code className="private-shared-fingerprint">{candidate.fingerprint}</code>
   {candidate.proposal.ownerId===ownerId&&scopes.find(row=>row.scopeId===selected)?.state!=='retirement'?<button type="button" disabled={busy} onClick={()=>showPrivateMigration(ownerId,language,'resume',{scopeId:selected,kind:candidate.proposal.kind,resourceId:candidate.proposal.resourceId})}>{migration.transfer}</button>:null}
   {!accepted&&scopes.find(row=>row.scopeId===selected)?.state==='active'?<><label>{text.compare}<input autoComplete="off" spellCheck={false} value={compared} maxLength={64} disabled={busy} onChange={event=>setCompared(event.target.value.trim())}/></label><button type="button" disabled={busy||compared!==candidate.fingerprint} onClick={()=>void run(async current=>{await new E2eeSharedTrust(ownerId).accept(candidate.proposal,compared);current();await new E2eeSharedTrust(ownerId).open(selected);current();setAccepted(true);setMessage(text.saved);})}>{text.accept}</button></>:null}
   {accepted&&candidate.proposal.ownerId===ownerId?<button type="button" disabled={busy} onClick={()=>void run(async current=>{const account=requirePrivateAccount(ownerId);await new E2eeSharedTrust(ownerId).open(selected);current();const {bootstrap}=await account.sharedRecords(selected,candidate.proposal.kind,candidate.proposal.resourceId);await bootstrap.prepare();current();await bootstrap.flush();current();setMessage(text.complete);})}>{text.baseline}</button>:null}
  </>:null}{message?<p role="status">{message}</p>:null}
 </section>;
}
