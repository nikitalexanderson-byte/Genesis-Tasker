'use client';
import {useEffect,useRef,useState} from 'react';
import type {BackupPayload} from './backup-format';
import type {PersonalRestoreJournal} from './e2ee/personal-content-restore';
import type {DomainRestoreJournal} from './e2ee/domain-content-restore';
import type {SharedRestoreJournal} from './e2ee/shared-content-restore';
import {currentPrivatePersonalRestore,prepareCurrentPrivatePersonalRestore,currentPrivateDomainRestore,prepareCurrentPrivateDomainRestore,currentPrivateSharedRestore,prepareCurrentPrivateSharedRestore} from './cloud-sync';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import copy from '../contracts/e2ee/personal-content-restore-copy-v1.json';
import commonCopy from '../contracts/e2ee/shared-security-copy-v1.json';

type Selection={sectionIndex:number;entryIndex:number;versionId:string};
type RestoreJournal=PersonalRestoreJournal|DomainRestoreJournal|SharedRestoreJournal;
const restoreKind=(value:RestoreJournal|null)=>value?.format==='genesis-shared-content-restore-v1'?'shared':value?.format==='genesis-domain-content-restore-v1'?'domain':'personal';
export function PrivatePersonalContentRestore({ownerId,language,payload,selection}:{ownerId:string;language:string;payload:BackupPayload|null;selection:Selection|null}){
 const c=copy[language as keyof typeof copy]??copy.en,common=commonCopy[language as keyof typeof commonCopy]??commonCopy.en;
 const [view,setView]=useState<RestoreJournal|null>(null),[pending,setPending]=useState<RestoreJournal[]>([]),[ack,setAck]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),generation=useRef(0),running=useRef(false);
 useEffect(()=>{const clear=()=>{generation.current++;setView(null);setPending([]);setAck(false);setFailed(false);},hide=()=>{if(document.visibilityState!=='visible')clear();};const unsubscribe=subscribePrivateAccount(clear);document.addEventListener('visibilitychange',hide);return()=>{generation.current++;unsubscribe();document.removeEventListener('visibilitychange',hide);};},[ownerId]);
 const run=async(action:(current:()=>void)=>Promise<void>)=>{if(running.current)return;running.current=true;setBusy(true);setFailed(false);const token=++generation.current;
  try{const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(generation.current!==token||requirePrivateAccount(ownerId)!==account||document.visibilityState!=='visible')throw new Error('E2EE_ACCOUNT_CHANGED');};current();await action(current);current();}
  catch{if(generation.current===token)setFailed(true);}finally{running.current=false;setBusy(false);}
 };
 const command=(action:'inspect'|'preview'|'confirm'|'apply',id:string,fingerprint:string|undefined,current:()=>void,kind=restoreKind(view))=>({shared:currentPrivateSharedRestore,domain:currentPrivateDomainRestore,personal:currentPrivatePersonalRestore}[kind])(action,id,fingerprint,current);
 const load=async(item:RestoreJournal,current:()=>void)=>{const value=await command('inspect',item.intentId,undefined,current,restoreKind(item));current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);setAck(false);};
 return <section className="backup-panel" data-no-translate><h3>{c.title}</h3><p>{c.notice}</p><p>{c.localDiary}</p>
  <p>{c.sharedNotice}</p>
  {payload&&selection?<button type="button" disabled={busy} onClick={()=>void run(async current=>{const section=payload.sections[selection.sectionIndex],entry=(section?.data as {entries?:{objectId:string}[]})?.entries?.[selection.entryIndex],domain=['diary','mindmaps','physis','aurora','stoicheion'].includes(section?.id)||entry?.objectId==='personal-diary-device-live-v1';const prepare=section?.id==='shared-drafts'?prepareCurrentPrivateSharedRestore:domain?prepareCurrentPrivateDomainRestore:prepareCurrentPrivatePersonalRestore;const value=await prepare(payload,selection.sectionIndex,selection.entryIndex,selection.versionId,current);current();setView(value);setAck(false);})}>{c.prepare}</button>:null}
  <button type="button" disabled={busy} onClick={()=>void run(async current=>{const [personal,domains,shared]=await Promise.all([currentPrivatePersonalRestore('pending',undefined,undefined,current),currentPrivateDomainRestore('pending',undefined,undefined,current),currentPrivateSharedRestore('pending',undefined,undefined,current)]);current();if(!Array.isArray(personal)||!Array.isArray(domains)||!Array.isArray(shared))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setPending([...personal,...domains,...shared]);})}>{common.load}</button>
  {pending.map(item=><button type="button" key={item.intentId} disabled={busy} onClick={()=>void run(current=>load(item,current))}>{c.resume} · {item.backupId}</button>)}
  {view?.proposal?<><dl>{view.format==='genesis-shared-content-restore-v1'?<><dt>{c.sharedTarget}</dt><dd>{String((view.proposal.before.versions.find(row=>row.kind===view.source.binding.kind&&!row.deleted)?.body as {record?:{title?:string}}|undefined)?.record?.title??view.source.binding.resourceId)}</dd></>:null}<dt>{c.added}</dt><dd>{view.proposal.added}</dd><dt>{c.skipped}</dt><dd>{view.proposal.skipped}</dd></dl>
   {view.complete?<p role="status">{c.done}</p>:!view.started?<><label className="backup-check"><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>{c.ack}</label>
    <button type="button" disabled={busy||!ack} onClick={()=>void run(async current=>{await command('confirm',view.intentId,view.proposal!.fingerprint,current);current();const value=await command('apply',view.intentId,undefined,current);current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);setAck(false);})}>{c.apply}</button>
   </>:<button type="button" disabled={busy} onClick={()=>void run(async current=>{const value=await command('apply',view.intentId,undefined,current);current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);})}>{c.resume}</button>}
  </>:view?<button type="button" disabled={busy} onClick={()=>void run(async current=>{const value=await command('preview',view.intentId,undefined,current);current();if(Array.isArray(value))throw new Error('E2EE_RESTORE_CONTENT_INVALID');setView(value);setAck(false);})}>{c.prepare}</button>:null}
  {failed?<p role="alert">{common.error}</p>:null}
 </section>;
}
