'use client';
import {useEffect,useRef,useState} from 'react';
import type {BackupPayload} from './backup-format';
import type {PersonalRestoreJournal} from './e2ee/personal-content-restore';
import {currentPrivatePersonalRestore,prepareCurrentPrivatePersonalRestore} from './cloud-sync';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import copy from '../contracts/e2ee/personal-content-restore-copy-v1.json';
import commonCopy from '../contracts/e2ee/shared-security-copy-v1.json';

type Selection={sectionIndex:number;entryIndex:number;versionId:string};
export function PrivatePersonalContentRestore({ownerId,language,payload,selection}:{ownerId:string;language:string;payload:BackupPayload|null;selection:Selection|null}){
 const c=copy[language as keyof typeof copy]??copy.en,common=commonCopy[language as keyof typeof commonCopy]??commonCopy.en;
 const [view,setView]=useState<PersonalRestoreJournal|null>(null),[pending,setPending]=useState<PersonalRestoreJournal[]>([]),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),generation=useRef(0),running=useRef(false);
 useEffect(()=>{const clear=()=>{generation.current++;setView(null);setPending([]);setAck(false);setFailed(false);},hide=()=>{if(document.visibilityState!=='visible')clear();};const unsubscribe=subscribePrivateAccount(clear);document.addEventListener('visibilitychange',hide);return()=>{generation.current++;unsubscribe();document.removeEventListener('visibilitychange',hide);};},[ownerId]);
 const run=async(action:(current:()=>void)=>Promise<void>)=>{if(running.current)return;running.current=true;setBusy(true);setFailed(false);const token=++generation.current;
  try{const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(generation.current!==token||requirePrivateAccount(ownerId)!==account||document.visibilityState!=='visible')throw new Error('E2EE_ACCOUNT_CHANGED');};current();await action(current);current();}
  catch{if(generation.current===token)setFailed(true);}finally{running.current=false;setBusy(false);}
 };
 const load=async(id:string,current:()=>void)=>{const value=await currentPrivatePersonalRestore('inspect',id,undefined,current);current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);setAck(false);};
 return <section className="backup-panel" data-no-translate><h3>{c.title}</h3><p>{c.notice}</p>
  {payload&&selection?<button type="button" disabled={busy} onClick={()=>void run(async current=>{const value=await prepareCurrentPrivatePersonalRestore(payload,selection.sectionIndex,selection.entryIndex,selection.versionId,current);current();setView(value);setAck(false);})}>{c.prepare}</button>:null}
  <button type="button" disabled={busy} onClick={()=>void run(async current=>{const values=await currentPrivatePersonalRestore('pending',undefined,undefined,current);current();if(!Array.isArray(values))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setPending(values);})}>{common.load}</button>
  {pending.map(item=><button type="button" key={item.intentId} disabled={busy} onClick={()=>void run(current=>load(item.intentId,current))}>{c.resume} · {item.backupId}</button>)}
  {view?.proposal?<><dl><dt>{c.added}</dt><dd>{view.proposal.added}</dd><dt>{c.skipped}</dt><dd>{view.proposal.skipped}</dd></dl>
   {view.complete?<p role="status">{c.done}</p>:!view.started?<><label className="backup-check"><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>{c.ack}</label>
    <button type="button" disabled={busy||!ack} onClick={()=>void run(async current=>{await currentPrivatePersonalRestore('confirm',view.intentId,view.proposal!.fingerprint,current);current();const value=await currentPrivatePersonalRestore('apply',view.intentId,undefined,current);current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);setAck(false);})}>{c.apply}</button>
   </>:<button type="button" disabled={busy} onClick={()=>void run(async current=>{const value=await currentPrivatePersonalRestore('apply',view.intentId,undefined,current);current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);})}>{c.resume}</button>}
  </>:view?<button type="button" disabled={busy} onClick={()=>void run(async current=>{const value=await currentPrivatePersonalRestore('preview',view.intentId,undefined,current);current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);setAck(false);})}>{c.prepare}</button>:null}
  {failed?<p role="alert">{common.error}</p>:null}
 </section>;
}
