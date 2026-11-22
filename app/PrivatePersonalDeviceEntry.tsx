'use client';
import {useEffect,useRef,useState} from 'react';
import copy from '../contracts/e2ee/personal-device-entry-copy-v1.json';
import deviceCopy from '../contracts/e2ee/device-access-copy-v1.json';
import commonCopy from '../contracts/e2ee/shared-security-copy-v1.json';
import {isLanguage} from './i18n';
import {privateAccountView} from './e2ee/product-session';
import type {DeviceAccessState} from './e2ee/device-access';
import {validateDeviceAccessTarget,deviceAccessFingerprint} from './e2ee/device-access-contract';
import {personalDeviceTargetFingerprint} from './e2ee/personal-device-target';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import {encodeE2eeBytes,decodeE2eeBytes} from './e2ee/envelope';
import {IndexedDbDeviceKeyStorage} from './e2ee/device-vault';
import {freshSecret} from './e2ee/keys';
import {beginCurrentPrivatePersonalDeviceEntry,resumeCurrentPrivatePersonalDeviceEntry,unlockCurrentPrivateAccount} from './cloud-sync';
import type {WebPersonalDeviceEntry} from './e2ee/personal-device-entry';
import type {SignedE2eeCommand} from './e2ee/commands';

export function PrivatePersonalDeviceEntry({ownerId,language}:{ownerId:string;language:string}){
 const lang=isLanguage(language)?language:'en',c=copy[lang],d=deviceCopy[lang],common=commonCopy[lang];
 const [target,setTarget]=useState(''),[compared,setCompared]=useState(''),[preview,setPreview]=useState(''),[code,setCode]=useState(''),[saved,setSaved]=useState(false),[approval,setApproval]=useState('');
 const [generated,setGenerated]=useState(false),[hasLocal,setHasLocal]=useState(false);
 const [view,setView]=useState<{state:DeviceAccessState;fingerprint:string}|null>(null),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
 const entry=useRef<WebPersonalDeviceEntry|null>(null),alive=useRef(true),epoch=useRef(0),locked=useRef(false);
 const lifetime=()=>{if(!alive.current||privateAccountView().ownerId!==ownerId||document.visibilityState!=='visible')throw new Error('E2EE_ACCOUNT_CHANGED');};
 const clear=()=>{epoch.current++;entry.current?.close();entry.current=null;setCode('');setGenerated(false);setSaved(false);setApproval('');setView(null);setPreview('');setCompared('');setTarget('');setMessage('');setBusy(false);locked.current=false;};
 useEffect(()=>{let current=true;void new IndexedDbDeviceKeyStorage().get(ownerId).then(value=>{if(current)setHasLocal(value!==null);}).catch(()=>{if(current)setHasLocal(false);});return()=>{current=false;};},[ownerId]);
 useEffect(()=>{alive.current=true;const background=()=>{if(document.visibilityState!=='visible')clear();};document.addEventListener('visibilitychange',background);window.addEventListener('pagehide',clear);return()=>{alive.current=false;epoch.current++;entry.current?.close();entry.current=null;document.removeEventListener('visibilitychange',background);window.removeEventListener('pagehide',clear);};},[ownerId]);
 const run=async(work:(current:()=>void)=>Promise<void>)=>{if(locked.current)return;locked.current=true;setBusy(true);setMessage('');const token=++epoch.current,current=()=>{lifetime();if(epoch.current!==token)throw new Error('E2EE_ACCOUNT_CHANGED');};
  try{current();await work(current);current();}catch(reason){if(alive.current&&epoch.current===token)setMessage(reason instanceof Error&&reason.message==='E2EE_CHALLENGE_EXPIRED'?d.expired:common.error);}finally{if(epoch.current===token){locked.current=false;if(alive.current)setBusy(false);}}
 };
 const display=async(state:DeviceAccessState,current:()=>void)=>{if(!state.request)throw new Error('E2EE_DEVICE_ACCESS_REQUIRED');const fingerprint=await deviceAccessFingerprint(state.request);current();setView({state,fingerprint});setApproval('');};
 const open=async(resume:boolean,current:()=>void)=>{const secret=decodeE2eeBytes(code.trim(),32);let candidate:WebPersonalDeviceEntry|undefined;
  try{candidate=resume?await resumeCurrentPrivatePersonalDeviceEntry(secret,lifetime):await beginCurrentPrivatePersonalDeviceEntry(secret,target,compared,lifetime);current();const state=await candidate.request();current();entry.current?.close();entry.current=candidate;await display(state,current);}catch(reason){if(candidate!==entry.current)candidate?.close();throw reason;}finally{secret.fill(0);}
 };
 return <section data-no-translate><h3>{c.title}</h3><p>{c.notice}</p>
  <label className="workspace-recovery-field"><span>{c.localCode}</span><input value={code} disabled={busy||Boolean(entry.current)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} onChange={event=>{setCode(event.target.value);setGenerated(false);setSaved(false);}}/></label><p className="workspace-recovery-hint">{c.codeNotice}</p>
  {!entry.current?<><button type="button" disabled={busy} onClick={()=>{const secret=freshSecret();try{setCode(encodeE2eeBytes(secret));setGenerated(true);setSaved(false);}finally{secret.fill(0);}}}>{c.generate}</button>
   <label className="backup-check"><input type="checkbox" checked={saved} disabled={busy} onChange={event=>setSaved(event.target.checked)}/>{c.codeSaved}</label>
   <label className="workspace-recovery-field"><span>{c.target}</span><textarea rows={4} value={target} disabled={busy} maxLength={8192} onChange={event=>{setTarget(event.target.value);setPreview('');setCompared('');}}/></label>
   <button type="button" disabled={busy||!target.trim()} onClick={()=>void run(async current=>{const value=validateDeviceAccessTarget(parseLegacyMigrationJson(target,'E2EE_DEVICE_ACCESS_INVALID',8192));if(value.kind!=='personal'||value.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');const fingerprint=personalDeviceTargetFingerprint(value);current();setPreview(fingerprint);setCompared('');})}>{c.inspect}</button>
   {preview?<><code className="private-shared-fingerprint">{preview}</code><label className="workspace-recovery-field"><span>{d.compare}</span><input value={compared} maxLength={64} disabled={busy} autoComplete="off" spellCheck={false} onChange={event=>setCompared(event.target.value.trim())}/></label></>:null}
   <div className="workspace-recovery-actions"><button type="button" disabled={busy||!code.trim()||!saved||!generated&&!hasLocal||!preview||compared!==preview} onClick={()=>void run(current=>open(false,current))}>{d.create}</button><button type="button" disabled={busy||!code.trim()} onClick={()=>void run(current=>open(true,current))}>{c.resume}</button></div>
  </>:null}
  {view?.state.request?<><label className="workspace-recovery-field"><span>{d.request}</span><textarea rows={4} readOnly value={JSON.stringify(view.state.request)}/></label><code className="private-shared-fingerprint">{view.fingerprint}</code>
   <label className="workspace-recovery-field"><span>{d.approval}</span><textarea rows={4} value={view.state.approval?JSON.stringify(view.state.approval):approval} maxLength={128*1024} disabled={busy||Boolean(view.state.approval)} onChange={event=>setApproval(event.target.value)}/></label>
   <div className="workspace-recovery-actions"><button type="button" disabled={busy||!entry.current||!view.state.approval&&!approval.trim()} onClick={()=>void run(async current=>{const candidate=entry.current;if(!candidate)throw new Error('E2EE_DEVICE_ACCESS_REQUIRED');const packet=approval.trim()?parseLegacyMigrationJson(approval,'E2EE_DEVICE_ACCESS_INVALID',128*1024) as SignedE2eeCommand:undefined;await candidate.submit(packet);current();candidate.close();entry.current=null;const held=code;setCode('');setApproval('');await unlockCurrentPrivateAccount(held);})}>{c.finish}</button>
    <button type="button" disabled={busy||!entry.current||Boolean(view.state.approval)} onClick={()=>void run(async current=>{const candidate=entry.current;if(!candidate)throw new Error('E2EE_DEVICE_ACCESS_REQUIRED');const state=await candidate.newRequest();current();await display(state,current);})}>{c.newRequest}</button></div>
  </>:null}{message?<p role="alert">{message}</p>:null}
 </section>;
}
