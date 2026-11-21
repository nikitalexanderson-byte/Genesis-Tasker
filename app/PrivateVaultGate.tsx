'use client';
import {useEffect,useState,useSyncExternalStore,type FormEvent} from 'react';
import {privateAccountView,subscribePrivateAccount,type PrivateAccountView} from './e2ee/product-session';
import {unlockCurrentPrivateAccount,signOutFromGoogle} from './cloud-sync';
import {privateMigrationUi,subscribePrivateMigrationUi,showPrivateMigration} from './private-migration-ui';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import type {RecoveryKit} from './e2ee/keys';
import {IndexedDbDeviceKeyStorage} from './e2ee/device-vault';
import {isLanguage} from './i18n';
import {PRIVATE_VAULT_COPY} from './private-vault-copy';
import {useDialogAccessibility} from './use-dialog-accessibility';

const initial:PrivateAccountView=Object.freeze({ownerId:null,phase:'closed',reason:'unlock',language:'en'});
/** A protected account's workspace does not mount from legacy plaintext while
 * this gate waits. Dismissal never grants access; sign-out retires capabilities. */
export function PrivateVaultGate(){
 const state=useSyncExternalStore(subscribePrivateAccount,privateAccountView,()=>initial);
 const migration=useSyncExternalStore(subscribePrivateMigrationUi,privateMigrationUi,()=>null);
 return migration?.ownerId!==state.ownerId&&(state.phase==='locked'||state.phase==='unlocking')?<PrivateVaultForm key={state.ownerId} state={state}/>:null;
}
function PrivateVaultForm({state}:{state:PrivateAccountView}){
 const [secret,setSecret]=useState(''),[kit,setKit]=useState<RecoveryKit>(),[error,setError]=useState(false),[fileBusy,setFileBusy]=useState(false),[canOffline,setCanOffline]=useState(false);
 const copy=PRIVATE_VAULT_COPY[isLanguage(state.language)?state.language:'en'],busy=state.phase==='unlocking'||fileBusy;
 const dialogRef=useDialogAccessibility<HTMLFormElement>(()=>{});
 useEffect(()=>{let active=true;if(state.ownerId)void new IndexedDbDeviceKeyStorage().get(state.ownerId).then(row=>{if(active)setCanOffline(row!==null);}).catch(()=>{if(active)setCanOffline(false);});return()=>{active=false;};},[state.ownerId]);
 useEffect(()=>{
  const content=document.getElementById('genesis-app-content'),overflow=document.body.style.overflow;
  const previousInert=content?.inert,previousHidden=content?.getAttribute('aria-hidden');
  if(content){content.inert=true;content.setAttribute('aria-hidden','true');}document.body.style.overflow='hidden';
  return()=>{if(content){content.inert=previousInert??false;if(previousHidden===null)content.removeAttribute('aria-hidden');else if(previousHidden!==undefined)content.setAttribute('aria-hidden',previousHidden);}document.body.style.overflow=overflow;};
 },[]);
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(busy)return;setError(false);
  try{await unlockCurrentPrivateAccount(secret,kit);}catch(reason){
   if(reason instanceof Error&&reason.message==='E2EE_MIGRATION_RESUME_REQUIRED'&&state.ownerId)showPrivateMigration(state.ownerId,state.language,'resume');else setError(true);
  }finally{setSecret('');}
 };
 return <div className="private-vault-gate">
  <form ref={dialogRef} className="workspace-recovery-dialog private-vault-dialog" role="dialog" aria-modal="true" aria-labelledby="private-vault-title" aria-describedby="private-vault-description" tabIndex={-1} onSubmit={submit} lang={isLanguage(state.language)?state.language:'en'}>
   <svg className="private-vault-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="12" rx="3"/><path d="M12 15v3"/></svg>
   <div className="workspace-recovery-heading"><h2 id="private-vault-title">{copy.title}</h2><p id="private-vault-description">{copy.description}</p></div>
   <label className="workspace-recovery-field"><span>{copy.secret}</span><div><input data-dialog-initial-focus type="password" value={secret} onChange={event=>setSecret(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} disabled={busy} required aria-invalid={error} aria-describedby="private-vault-hint"/></div></label>
   <label className="workspace-recovery-field"><span>{copy.kit}</span><input type="file" accept=".json,application/json" disabled={busy} required={state.reason==='recovery'} onChange={async event=>{
    const file=event.target.files?.[0];setKit(undefined);if(!file)return;setError(false);setFileBusy(true);
    try{if(file.size<1||file.size>65536)throw new Error('E2EE_INVALID_RECOVERY_KIT');
     const parsed=parseLegacyMigrationJson(await file.text(),'E2EE_INVALID_RECOVERY_KIT',65536) as RecoveryKit;
     if(parsed?.ownerId!==state.ownerId||parsed.protocol!==1)throw new Error('E2EE_INVALID_RECOVERY_KIT');setKit(parsed);
    }catch{setError(true);event.target.value='';}finally{setFileBusy(false);}
   }}/></label>
   <p id="private-vault-hint" className="workspace-recovery-hint">{copy.kitHint}</p>
   {error?<p role="alert" className="workspace-recovery-error">{copy.error}</p>:null}
   {canOffline?<button type="button" className="text-button private-vault-offline" disabled={busy||!secret.trim()} onClick={async()=>{setError(false);try{await unlockCurrentPrivateAccount(secret,undefined,'offline');}catch{setError(true);}finally{setSecret('');}}}>{copy.offline}</button>:null}
   <div className="workspace-recovery-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>{setSecret('');setKit(undefined);void signOutFromGoogle().catch(()=>setError(true));}}>{copy.exit}</button><button type="submit" className="primary-button" disabled={busy||!secret.trim()}>{busy?copy.busy:copy.unlock}</button></div>
   <small className="workspace-recovery-privacy">{copy.privacy}</small>
  </form>
 </div>;
}
