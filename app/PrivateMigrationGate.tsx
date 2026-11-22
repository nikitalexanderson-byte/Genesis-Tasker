'use client';
import {useEffect,useRef,useState,useSyncExternalStore,type FormEvent} from 'react';
import {currentPrivateMigrationStatus,prepareCurrentPrivateMigration,prepareCurrentSharedPrivateMigration,finishCurrentSharedPrivateMigration,completeCurrentPrivateSpaceCreation,completeCurrentPrivateProjectCreation,previewCurrentPrivateProjectCreation,confirmCurrentPrivateProjectCreationReview,resolveCurrentPrivateProjectCreation,loadGenesisSession,unlockCurrentPrivateAccount,signOutFromGoogle,type GenesisUser} from './cloud-sync';
import {privateMigrationUi,subscribePrivateMigrationUi,showPrivateMigration,closePrivateMigrationUi,completePrivateResourceCreation,replacePrivateResourceCreation,type PrivateMigrationUi} from './private-migration-ui';
import {PRIVATE_VAULT_COPY} from './private-vault-copy';
import migrationCopy from '../contracts/e2ee/migration-copy-v1.json' with {type:'json'};
import cancelCopy from '../contracts/e2ee/migration-cancel-copy-v1.json';
import sharedCopy from '../contracts/e2ee/shared-migration-copy-v1.json';
import creationCopy from '../contracts/e2ee/private-resource-copy-v1.json';
import projectCreationCopy from '../contracts/e2ee/project-creation-copy-v1.json';
import projectRetryCopy from '../contracts/e2ee/project-creation-retry-copy-v1.json';
import {isLanguage} from './i18n';
import {createRecoveryKit,type RecoveryKit} from './e2ee/keys';
import {decodeE2eeBytes,encodeE2eeBytes} from './e2ee/envelope';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import {IndexedDbDeviceKeyStorage} from './e2ee/device-vault';
import {privateAccountRequired} from './e2ee/product-session';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {holdPrivateEditorFence} from './private-ui-fence';
import type {WebProductMigration} from './e2ee/web-product-migration';

function download(name:string,value:string,type:string){
 const url=URL.createObjectURL(new Blob([value],{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function PrivateMigrationEntry({user}:{user:GenesisUser}){
 const [available,setAvailable]=useState(false),[resume,setResume]=useState(false);
 const language=isLanguage(user.language)?user.language:'en',copy=migrationCopy[language];
 useEffect(()=>{let live=true;void currentPrivateMigrationStatus().then(status=>{
  if(!live||status.ownerId!==user.uid)return;const pending=status.scopes.some(row=>row.kind==='personal'&&row.resourceId===user.uid&&!['active','retirement'].includes(row.state));
  setAvailable(!user.privateVault&&(status.pilotAllowed||pending));setResume(pending);
 }).catch(()=>{if(live)setAvailable(false);});return()=>{live=false;};},[user.uid,user.privateVault]);
 return available?<section className="account-preferences" data-no-translate><h3>{copy.entry}</h3><p>{copy.intro}</p><button type="button" onClick={()=>showPrivateMigration(user.uid,language,resume?'resume':'setup')}>{resume?copy.resume:copy.title}</button></section>:null;
}
export function PrivateMigrationGate(){
 const state=useSyncExternalStore(subscribePrivateMigrationUi,privateMigrationUi,()=>null);
 return state?<MigrationForm key={state.id} state={state}/>:null;
}
function MigrationForm({state}:{state:PrivateMigrationUi}){
 const language=isLanguage(state.language)?state.language:'en',copy={...migrationCopy[language],...(state.target?sharedCopy[language]:{})},cancellation=cancelCopy[language],vaultCopy=PRIVATE_VAULT_COPY[language];
 const [phase,setPhase]=useState<'loading'|'intro'|'generated'|'confirm'|'running'|'done'|'cancelled'>(state.target||state.reason==='resume'?'confirm':'loading');
 const [generated,setGenerated]=useState<{secret:string;kit:RecoveryKit}|null>(null),[savedFile,setSavedFile]=useState(false),[savedSecret,setSavedSecret]=useState(false);
 const [secret,setSecret]=useState(''),[kit,setKit]=useState<RecoveryKit>(),[fileBusy,setFileBusy]=useState(false),[busy,setBusy]=useState(false);
 const [stopping,setStopping]=useState(false);
 const [cancelConfirmed,setCancelConfirmed]=useState(false),[cancelling,setCancelling]=useState(false);
 const [error,setError]=useState(''),[progress,setProgress]=useState<'snapshot'|'sources'|'reconciliation'|'uploading'|'active'>('snapshot');
 const projectCreation=Boolean(state.creationId&&state.target?.kind==='project'),projectText=projectCreationCopy[language];
 const [projectReview,setProjectReview]=useState<Awaited<ReturnType<typeof previewCurrentPrivateProjectCreation>>|null>(null),[reviewBusy,setReviewBusy]=useState(false);
 const [reviewReload,setReviewReload]=useState(0),[resolving,setResolving]=useState(false),retryText=projectRetryCopy[language];
 const creationReady=!projectCreation||Boolean(projectReview?.intent.review);
 const controller=useRef<WebProductMigration|null>(null),alive=useRef(true),started=useRef(false),fileRequest=useRef(0),ownerId=state.ownerId;
 const attempt=useRef<{stopping:boolean;drained:Promise<void>}|null>(null);
 const dialogRef=useDialogAccessibility<HTMLFormElement>(()=>{});
 const current=()=>{if(!alive.current||privateMigrationUi()?.id!==state.id)throw new Error('E2EE_ACCOUNT_CHANGED');};
 const frozen=()=>{current();if(attempt.current?.stopping)throw new Error('E2EE_OPERATION_STOPPED');const content=document.getElementById('genesis-app-content');if(!content?.inert||!document.contains(dialogRef.current)||document.visibilityState!=='visible')throw new Error('E2EE_EDITOR_FENCE_REQUIRED');};
 useEffect(()=>{
  alive.current=true;const releaseFence=holdPrivateEditorFence();
  const clearSecrets=()=>{if(document.visibilityState==='visible')return;fileRequest.current++;controller.current?.close();controller.current=null;setSecret('');setKit(undefined);setFileBusy(false);setGenerated(null);setSavedFile(false);setSavedSecret(false);setCancelConfirmed(false);setPhase(state.target||started.current?'confirm':'intro');setError(copy.error);};
  document.addEventListener('visibilitychange',clearSecrets);
  return()=>{alive.current=false;fileRequest.current++;controller.current?.close();controller.current=null;document.removeEventListener('visibilitychange',clearSecrets);
   releaseFence();};
 },[copy.error]);
 useEffect(()=>{let live=true;if(!state.target&&state.reason==='setup')void new IndexedDbDeviceKeyStorage().get(ownerId).then(record=>{if(live)setPhase(record?'confirm':'intro');}).catch(()=>{if(live){setError(copy.error);setPhase('confirm');}});return()=>{live=false;};},[ownerId,state.reason,state.target,copy.error]);
 const failure=(reason:unknown)=>{
  const code=reason instanceof Error?reason.message:'';
  return code==='E2EE_RESOURCE_CREATION_RESOLUTION_REQUIRED'?retryText.notice:code==='E2EE_PROJECT_TOPOLOGY_CHANGED'?projectText.changed:['E2EE_RECIPIENT_REVIEW_REQUIRED','E2EE_PROJECT_RECIPIENT_REVIEW_REQUIRED'].includes(code)?creationCopy[language].recipients:code==='E2EE_OTHER_WINDOWS_OPEN'?copy.otherWindows:/E2EE_.*(?:CONFLICT|REVIEW_REQUIRED|ATTRIBUTION_REQUIRED)/.test(code)?copy.reviewRequired:copy.error;
 };
 const reviewProject=async(confirm=false)=>{
  if(!projectCreation||!state.creationId||busy||reviewBusy)return;setReviewBusy(true);setError('');
  try{frozen();const review=confirm
    ?await confirmCurrentPrivateProjectCreationReview(state.creationId,projectReview?.topologyHash??'',frozen)
    :await previewCurrentPrivateProjectCreation(state.creationId,true,frozen);frozen();
   if(review.intent.scopeId!==state.target?.scopeId||review.intent.resourceId!==state.target.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');setProjectReview(review);
  }catch(reason){if(alive.current){if(!confirm||reason instanceof Error&&reason.message==='E2EE_PROJECT_TOPOLOGY_CHANGED')setProjectReview(null);setError(failure(reason));}}finally{if(alive.current)setReviewBusy(false);}
 };
 useEffect(()=>{if(!projectCreation||!state.creationId)return;let live=true;setReviewBusy(true);
  void previewCurrentPrivateProjectCreation(state.creationId,false,frozen).then(review=>{if(!live)return;frozen();
   if(review.intent.scopeId!==state.target?.scopeId||review.intent.resourceId!==state.target.resourceId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');setProjectReview(review);
  }).catch(reason=>{if(live&&alive.current)setError(failure(reason));}).finally(()=>{if(live&&alive.current)setReviewBusy(false);});return()=>{live=false;};
 },[state.id,reviewReload]);
 const submit=async(event:FormEvent,cancel=false,resolve=false)=>{
  event.preventDefault();if(busy||fileBusy||reviewBusy||!creationReady||!kit||attempt.current||cancel&&!cancelConfirmed||resolve&&(!projectCreation||!projectReview?.intent.started||projectReview.intent.preparation))return;setBusy(true);setCancelling(cancel);setResolving(resolve);setCancelConfirmed(false);setError('');started.current=true;let held:Uint8Array|undefined;
  let drained!:()=>void;const active={stopping:false,drained:new Promise<void>(resolve=>{drained=resolve;})};attempt.current=active;
  try{
   frozen();held=decodeE2eeBytes(secret.trim(),32);setSecret('');setPhase('running');
   if(resolve&&state.creationId){const replacement=await resolveCurrentPrivateProjectCreation(state.creationId,held,kit,frozen);frozen();setKit(undefined);replacePrivateResourceCreation(state.id,replacement.target,replacement.creationId);return;}
   if(state.creationId&&!cancel){
    const finish=projectCreation?completeCurrentPrivateProjectCreation:completeCurrentPrivateSpaceCreation;
    const result=await finish(state.creationId,held,kit,frozen,value=>{current();setProgress(value);},value=>{controller.current=value;});current();
    setKit(undefined);completePrivateResourceCreation(state.id,result);return;
   }
   if(state.creationId&&cancel)throw new Error('E2EE_RESOURCE_CREATION_PAUSED');
   const opened=state.target?await prepareCurrentSharedPrivateMigration(state.target,held,kit,frozen):await prepareCurrentPrivateMigration(held,kit,frozen);current();controller.current=opened;
   if(cancel){
    await opened.cancel(held,kit);current();opened.close();controller.current=null;
    const identity=await loadGenesisSession();current();if(identity?.uid!==ownerId||!state.target&&identity.privateVault)throw new Error('E2EE_ACCOUNT_CHANGED');
    setKit(undefined);setPhase('cancelled');return;
   }
   await opened.run(held,kit,value=>{current();setProgress(value);});current();opened.close();controller.current=null;
   setPhase('done');if(state.target){await finishCurrentSharedPrivateMigration(state.target);current();setKit(undefined);closePrivateMigrationUi(state.id);return;}
   const identity=await loadGenesisSession();current();if(identity?.uid!==ownerId)throw new Error('E2EE_ACCOUNT_CHANGED');
   privateAccountRequired(ownerId,language);await unlockCurrentPrivateAccount(encodeE2eeBytes(held),kit);current();
   setKit(undefined);window.dispatchEvent(new Event('genesis-private-migration-complete'));closePrivateMigrationUi(state.id);
  }catch(reason){if(alive.current&&privateMigrationUi()?.id===state.id){if(reason instanceof Error&&reason.message==='E2EE_PROJECT_TOPOLOGY_CHANGED')setProjectReview(null);setError(active.stopping?'':failure(reason));setPhase('confirm');}}
  finally{held?.fill(0);controller.current?.close();controller.current=null;if(attempt.current===active)attempt.current=null;drained();if(alive.current){setCancelling(false);setResolving(false);if(projectCreation)setReviewReload(value=>value+1);if(!active.stopping)setBusy(false);}}
 };
 const pause=async()=>{
  const active=attempt.current;if(!active||active.stopping)return;active.stopping=true;setStopping(true);
  try{await controller.current?.stop();await active.drained;}
  finally{if(alive.current&&privateMigrationUi()?.id===state.id){setStopping(false);setBusy(false);setSecret('');setKit(undefined);setPhase('confirm');}}
 };
 return <div className="private-vault-gate" data-no-translate lang={language}>
  <form ref={dialogRef} className="workspace-recovery-dialog private-vault-dialog private-migration-dialog" role="dialog" aria-modal="true" aria-labelledby="private-migration-title" aria-describedby="private-migration-description" tabIndex={-1} onSubmit={submit}>
   <div className="workspace-recovery-heading"><h2 id="private-migration-title">{copy.title}</h2><p id="private-migration-description">{copy.intro}</p></div>
   {phase==='loading'?<p role="status">{vaultCopy.busy}</p>:null}
   {phase==='intro'?<button type="button" className="primary-button" disabled={busy} onClick={async()=>{if(busy)return;setBusy(true);setError('');let bytes:Uint8Array|undefined;
    try{current();const recovery=await createRecoveryKit(ownerId);bytes=recovery.secret;current();setGenerated({kit:recovery.kit,secret:encodeE2eeBytes(bytes)});setSavedFile(false);setSavedSecret(false);setPhase('generated');}
    catch(reason){if(alive.current)setError(failure(reason));}finally{bytes?.fill(0);if(alive.current)setBusy(false);}
   }}>{copy.generate}</button>:null}
   {phase==='generated'&&generated?<>
    <p>{copy.generated}</p><p>{copy.secretNote}</p>
    <div className="workspace-recovery-actions"><button type="button" className="text-button" onClick={()=>{download('genesis-recovery.json',JSON.stringify(generated.kit,null,2),'application/json');setSavedFile(true);}}>{copy.saveFile}</button>
     <button type="button" className="text-button" onClick={()=>{download('genesis-recovery-secret.txt',generated.secret+'\n','text/plain');setSavedSecret(true);}}>{copy.saveSecret}</button></div>
    <button type="button" className="primary-button" disabled={!savedFile||!savedSecret} onClick={()=>{setGenerated(null);setSecret('');setKit(undefined);setPhase('confirm');}}>{copy.saved}</button>
   </>:null}
   {phase==='confirm'?<>
    {projectCreation?<section className="account-preferences" aria-labelledby="project-creation-review-title">
     <h3 id="project-creation-review-title">{projectText.title}</h3><p>{projectText.intro}</p>
     {reviewBusy?<p role="status">{vaultCopy.busy}</p>:null}
     {projectReview?<><p>{projectReview.intent.input.title}</p><ul>{projectReview.members.map(row=><li key={row.userId}>{row.displayName?<span>{row.displayName} · </span>:null}{projectText.roles[row.role]}<br/><small>{row.userId}</small></li>)}</ul>
      {projectReview.intent.review?<p role="status">{projectText.reviewed}</p>:<button type="button" disabled={busy||reviewBusy||fileBusy} onClick={()=>{void reviewProject(true);}}>{projectText.confirm}</button>}
     </>:null}
     {!projectReview?.intent.started?<button type="button" disabled={busy||reviewBusy||fileBusy} onClick={()=>{void reviewProject();}}>{projectReview?projectText.refresh:projectText.load}</button>:null}
    </section>:null}
    {creationReady?<>
    <p>{copy.confirm}</p>
    <label className="workspace-recovery-field"><span>{vaultCopy.kit}</span><input type="file" accept=".json,application/json" disabled={busy||fileBusy} required={!kit} onChange={async event=>{
     const input=event.currentTarget,file=input.files?.[0],request=++fileRequest.current;setKit(undefined);setError('');if(!file)return;setFileBusy(true);
     try{if(file.size<1||file.size>65536)throw new Error('E2EE_INVALID_RECOVERY_KIT');const value=parseLegacyMigrationJson(await file.text(),'E2EE_INVALID_RECOVERY_KIT',65536) as RecoveryKit;
      current();if(request!==fileRequest.current)return;if(value.protocol!==1||value.ownerId!==ownerId)throw new Error('E2EE_SCOPE_BINDING_MISMATCH');setKit(value);
     }catch(reason){if(alive.current&&request===fileRequest.current){setError(failure(reason));input.value='';}}finally{if(alive.current&&request===fileRequest.current)setFileBusy(false);}
    }}/></label>
    <label className="workspace-recovery-field"><span>{vaultCopy.secret}</span><div><input data-dialog-initial-focus type="password" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={64} value={secret} onChange={event=>setSecret(event.target.value)} disabled={busy||fileBusy} required/></div></label>
    <button type="submit" className="primary-button" disabled={busy||fileBusy||reviewBusy||!kit||!secret.trim()}>{state.reason==='resume'||started.current?copy.resume:copy.begin}</button>
    {projectReview?.intent.started&&!projectReview.intent.preparation?<><p>{retryText.notice}</p><button type="button" className="text-button" disabled={busy||fileBusy||reviewBusy||!kit||!secret.trim()} onClick={event=>{void submit(event,false,true);}}>{retryText.action}</button></>:null}
    {!state.creationId&&(state.reason==='resume'||started.current)?<><label className="backup-check"><input type="checkbox" checked={cancelConfirmed} disabled={busy||fileBusy} onChange={event=>setCancelConfirmed(event.target.checked)}/>{cancellation.confirm}</label>
     <button type="button" className="text-button" disabled={busy||fileBusy||!kit||!secret.trim()||!cancelConfirmed} onClick={event=>{void submit(event,true);}}>{cancellation.action}</button></>:null}
    </>:null}
   </>:null}
   {phase==='running'||phase==='done'?<p role="status" aria-live="polite">{resolving?retryText.action:cancelling?cancellation.action:phase==='done'||progress==='active'?copy.done:copy[progress]}</p>:null}
   {phase==='cancelled'?<><p role="status">{cancellation.done}</p><button type="button" className="text-button" disabled={busy} onClick={()=>closePrivateMigrationUi(state.id)}>{copy.close}</button></>:null}
   {phase==='running'?<button type="button" className="text-button" disabled={stopping} onClick={()=>{void pause();}}>{stopping?vaultCopy.busy:copy.stop}</button>:null}
   {error?<p role="alert" className="workspace-recovery-error">{error}</p>:null}
   <p className="workspace-recovery-hint">{copy.kept}</p>
   <div className="workspace-recovery-actions">
    {state.target||state.reason==='setup'&&!started.current?<button type="button" className="text-button" disabled={busy||fileBusy||reviewBusy} onClick={()=>{setSecret('');setKit(undefined);setGenerated(null);closePrivateMigrationUi(state.id);}}>{copy.close}</button>:null}
    <button type="button" className="text-button" disabled={busy||fileBusy||reviewBusy} onClick={()=>{setSecret('');setKit(undefined);setGenerated(null);void signOutFromGoogle().catch(()=>{if(alive.current)setError(copy.error);});}}>{vaultCopy.exit}</button>
   </div><small className="workspace-recovery-privacy">{vaultCopy.privacy}</small>
  </form>
 </div>;
}
