'use client';
import {useEffect,useLayoutEffect,useState,useSyncExternalStore,type FormEvent} from 'react';
import {privateAccountView,subscribePrivateAccount,type PrivateAccountView} from './e2ee/product-session';
import {unlockCurrentPrivateAccount,signOutFromGoogle,privateAccountAppearance} from './cloud-sync';
import {privateMigrationUi,subscribePrivateMigrationUi,showPrivateMigration} from './private-migration-ui';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import type {RecoveryKit} from './e2ee/keys';
import {IndexedDbDeviceKeyStorage} from './e2ee/device-vault';
import {isLanguage} from './i18n';
import {PRIVATE_VAULT_COPY} from './private-vault-copy';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {PrivatePersonalDeviceEntry} from './PrivatePersonalDeviceEntry';
import personalEntryCopy from '../contracts/e2ee/personal-device-entry-copy-v1.json';
import {holdPrivateEditorFence} from './private-ui-fence';
import {normalizeWebTheme} from './web-theme';
import {effectiveDarkPalette} from './dark-palettes';

const initial:PrivateAccountView=Object.freeze({ownerId:null,phase:'closed',reason:'unlock',language:'en'});
/** A protected account's workspace does not mount from legacy plaintext while
 * this gate waits. Dismissal never grants access; sign-out retires capabilities. */
export function PrivateVaultGate(){
 const state=useSyncExternalStore(subscribePrivateAccount,privateAccountView,()=>initial);
 const migration=useSyncExternalStore(subscribePrivateMigrationUi,privateMigrationUi,()=>null);
 useEffect(()=>{if(state.phase!=='ready'||!state.ownerId)return;let disposed=false,stop:(()=>void)|undefined;void import('./e2ee/shared-execution-pump').then(({startPrivateExecutionPump})=>{if(!disposed)stop=startPrivateExecutionPump(state.ownerId!);}).catch(()=>undefined);return()=>{disposed=true;stop?.();};},[state.phase,state.ownerId]);
 return migration?.ownerId!==state.ownerId&&(state.phase==='locked'||state.phase==='unlocking')?<PrivateVaultForm key={state.ownerId} state={state}/>:null;
}
function PrivateVaultForm({state}:{state:PrivateAccountView}){
 const appearance=state.ownerId?privateAccountAppearance(state.ownerId):null;
 const theme=normalizeWebTheme(appearance?.theme),palette=effectiveDarkPalette(appearance?.darkPalette,appearance?.featureAccess);
 useLayoutEffect(()=>{
  // These are public display preferences. They grant no vault capability and
  // must be painted while the ordinary account observer waits for unlock.
  const root=document.documentElement,previousTheme=root.getAttribute('data-genesis-theme'),previousPalette=root.getAttribute('data-genesis-palette');
  root.setAttribute('data-genesis-theme',theme);root.setAttribute('data-genesis-palette',palette);
  return()=>{
   if(privateAccountView().phase==='ready')return;
   for(const [name,value,painted]of [['data-genesis-theme',previousTheme,theme],['data-genesis-palette',previousPalette,palette]] as const){
    if(root.getAttribute(name)!==painted)continue;
    if(value===null)root.removeAttribute(name);else root.setAttribute(name,value);
   }
  };
 },[theme,palette]);
 const [trusted,setTrusted]=useState(false);
 const [secret,setSecret]=useState(''),[kit,setKit]=useState<RecoveryKit>(),[error,setError]=useState(false),[fileBusy,setFileBusy]=useState(false),[canOffline,setCanOffline]=useState(false);
 const copy=PRIVATE_VAULT_COPY[isLanguage(state.language)?state.language:'en'],busy=state.phase==='unlocking'||fileBusy;
 const dialogRef=useDialogAccessibility<HTMLFormElement>(()=>{});
 useEffect(()=>{let active=true;if(state.ownerId)void new IndexedDbDeviceKeyStorage().get(state.ownerId).then(row=>{if(active)setCanOffline(row!==null);}).catch(()=>{if(active)setCanOffline(false);});return()=>{active=false;};},[state.ownerId]);
 useEffect(()=>holdPrivateEditorFence(),[]);
 const submit=async(event:FormEvent)=>{
  event.preventDefault();if(busy||trusted)return;setError(false);
  try{await unlockCurrentPrivateAccount(secret,kit);}catch(reason){
   if(reason instanceof Error&&reason.message==='E2EE_MIGRATION_RESUME_REQUIRED'&&state.ownerId)showPrivateMigration(state.ownerId,state.language,'resume');else setError(true);
  }finally{setSecret('');}
 };
 return <div className="private-vault-gate">
  <form ref={dialogRef} className="workspace-recovery-dialog private-vault-dialog" role="dialog" aria-modal="true" aria-labelledby="private-vault-title" aria-describedby="private-vault-description" tabIndex={-1} onSubmit={submit} lang={isLanguage(state.language)?state.language:'en'}>
   <svg className="private-vault-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="4" y="10" width="16" height="12" rx="3"/><path d="M12 15v3"/></svg>
   <div className="workspace-recovery-heading"><h2 id="private-vault-title">{copy.title}</h2><p id="private-vault-description">{copy.description}</p></div>
   {!trusted?<><label className="workspace-recovery-field"><span>{copy.secret}</span><div><input data-dialog-initial-focus type="password" value={secret} onChange={event=>setSecret(event.target.value)} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} disabled={busy} required aria-invalid={error} aria-describedby="private-vault-hint"/></div></label>
   <label className="workspace-recovery-field"><span>{copy.kit}</span><input type="file" accept=".json,application/json" disabled={busy} required={state.reason==='recovery'} onChange={async event=>{
    const file=event.target.files?.[0];setKit(undefined);if(!file)return;setError(false);setFileBusy(true);
    try{if(file.size<1||file.size>65536)throw new Error('E2EE_INVALID_RECOVERY_KIT');
     const parsed=parseLegacyMigrationJson(await file.text(),'E2EE_INVALID_RECOVERY_KIT',65536) as RecoveryKit;
     if(parsed?.ownerId!==state.ownerId||parsed.protocol!==1)throw new Error('E2EE_INVALID_RECOVERY_KIT');setKit(parsed);
    }catch{setError(true);event.target.value='';}finally{setFileBusy(false);}
   }}/></label>
   <p id="private-vault-hint" className="workspace-recovery-hint">{copy.kitHint}</p></>:state.ownerId?<PrivatePersonalDeviceEntry ownerId={state.ownerId} language={state.language}/>:null}
   <button type="button" className="text-button" disabled={busy} onClick={()=>{setSecret('');setKit(undefined);setError(false);setTrusted(value=>!value);}}>{personalEntryCopy[isLanguage(state.language)?state.language:'en'][trusted?'back':'title']}</button>
   {error?<p role="alert" className="workspace-recovery-error">{copy.error}</p>:null}
   {!trusted&&canOffline?<button type="button" className="text-button private-vault-offline" disabled={busy||!secret.trim()} onClick={async()=>{setError(false);try{await unlockCurrentPrivateAccount(secret,undefined,'offline');}catch{setError(true);}finally{setSecret('');}}}>{copy.offline}</button>:null}
   <div className="workspace-recovery-actions"><button type="button" className="text-button" disabled={busy} onClick={()=>{setSecret('');setKit(undefined);void signOutFromGoogle().catch(()=>setError(true));}}>{copy.exit}</button>{!trusted?<button type="submit" className="primary-button" disabled={busy||!secret.trim()}>{busy?copy.busy:copy.unlock}</button>:null}</div>
   <small className="workspace-recovery-privacy">{copy.privacy}</small>
  </form>
 </div>;
}
