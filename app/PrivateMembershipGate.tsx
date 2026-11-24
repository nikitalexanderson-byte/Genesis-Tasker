'use client';
import {invitationSecurityCopy} from './invitation-security-copy';
import {useEffect,useId,useRef,useState,useSyncExternalStore} from 'react';
import {PrivateMembershipModal} from './PrivateMembershipModal';
import copy from '../contracts/e2ee/membership-review-copy-v2.json';
import rolesCopy from '../contracts/e2ee/device-access-copy-v1.json';
import projectCopy from '../contracts/e2ee/project-creation-copy-v1.json';
import {isLanguage} from './i18n';
import {PermissionChecks} from './SharedSpaceForm';
import {useDialogAccessibility} from './use-dialog-accessibility';
import {holdPrivateEditorFence} from './private-ui-fence';
import {requirePrivateAccount} from './e2ee/product-session';
import {parseLegacyMigrationJson} from './e2ee/legacy-json';
import {privateMembershipUi,subscribePrivateMembershipUi,closePrivateMembershipUi,completePrivateMembershipUi,replacePrivateMembershipOperation,type PrivateMembershipUi} from './private-membership-ui';
import {loadCurrentPrivateMembershipOperation,previewCurrentPrivateMembershipOperation,confirmCurrentPrivateMembershipOperation,composeCurrentPrivateMembershipOperation,pendingCurrentPrivateAtomicOwnerReviews,
 reviewCurrentPrivateAtomicOwners,approveCurrentPrivateAtomicOwner,acceptCurrentPrivateAtomicOwnerApproval,exportCurrentPrivateAtomicOwnerApproval,prepareCurrentPrivateMembershipPackets,
 describeCurrentPrivateAtomicMembership,confirmCurrentPrivateAtomicMembership,submitCurrentPrivateAtomicMembership,reconcileCurrentPrivateAtomicMembership,cancelCurrentPrivateMembershipOperation,resolveCurrentPrivateMembershipOperation,
  describeCurrentPrivateMembershipScope,exportCurrentPrivateMembershipReviewFile,importCurrentPrivateMembershipReviewFile,completedCurrentPrivateMembershipOperation} from './cloud-sync';
import {readCurrentPrivateAtomicOwnerPart} from './cloud-sync';
import type {MembershipAtomicOwnerApproval} from './e2ee/membership-atomic-review';
import type {MembershipAtomicOperationHeader} from './e2ee/membership-atomic-contract';
import type {MembershipPermissions,MembershipOperation} from './e2ee/membership-operation-plan';
import type {MembershipChange} from './e2ee/membership-contract';

type Draft=Awaited<ReturnType<typeof loadCurrentPrivateMembershipOperation>>;
type Review=Awaited<ReturnType<typeof reviewCurrentPrivateAtomicOwners>>;
type ScopeDetail=Awaited<ReturnType<typeof describeCurrentPrivateMembershipScope>>;
type Final=Awaited<ReturnType<typeof describeCurrentPrivateAtomicMembership>>;
function download(name:string,parts:BlobPart[],type='application/octet-stream'){
 const url=URL.createObjectURL(new Blob(parts,{type})),link=document.createElement('a');link.href=url;link.download=name;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
export function PrivateMembershipGate(){const state=useSyncExternalStore(subscribePrivateMembershipUi,privateMembershipUi,()=>null);return state?<MembershipReview key={state.id} state={state}/>:null;}
function MembershipReview({state}:{state:PrivateMembershipUi}){
 const language=isLanguage(state.language)?state.language:'en',c=copy[language],roles=rolesCopy[language].roles,productRoles=projectCopy[language].roles,titleId=useId();
 const [draft,setDraft]=useState<Draft|null>(null),[review,setReview]=useState<Review|null>(null),[fingerprint,setFingerprint]=useState(state.fingerprint??''),[choices,setChoices]=useState<{fingerprint:string}[]>([]);
 const [ownerOperation,setOwnerOperation]=useState<MembershipAtomicOperationHeader|null>(null),[effects,setEffects]=useState<{tasks:number;categories:number;events:number}|null>(null);
 const [desiredPermissions,setDesiredPermissions]=useState<MembershipPermissions|null>(null);
  const [ownerGrants,setOwnerGrants]=useState<Extract<MembershipOperation,{kind:'project-grants'}>['grants']>([]),[grantPage,setGrantPage]=useState(0);
 const [scopeIndex,setScopeIndex]=useState(0),[detail,setDetail]=useState<ScopeDetail|null>(null),[final,setFinal]=useState<Final|null>(null),[ack,setAck]=useState(false),[finalAck,setFinalAck]=useState(false),[cancelAck,setCancelAck]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState(''),alive=useRef(true),lock=useRef(false),version=useRef(0);
 const current=()=>{requirePrivateAccount(state.ownerId).requireOpen();if(!alive.current||privateMembershipUi()?.id!==state.id||document.visibilityState!=='visible')throw new Error('E2EE_ACCOUNT_CHANGED');};
 const close=()=>{if(!lock.current)closePrivateMembershipUi(state.id);},dialogRef=useDialogAccessibility<HTMLDivElement>(close);
 const failure=(reason:unknown)=>{const code=reason instanceof Error?reason.message:'';return code==='E2EE_BROWSER_EXPORT_LIMIT'?c.fileLimit:code==='E2EE_MEMBERSHIP_CANCELLED'?c.cancelled:/STALE|CONFLICT|DIVERGED|REVIEW_MISMATCH/.test(code)?c.stale:/OUTCOME|RECEIPT|FINAL_REVIEW/.test(code)?c.unknown:c.error;};
 const run=async(work:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;const token=++version.current;setBusy(true);setError('');setMessage('');
  try{current();await work();current();}catch(reason){if(alive.current&&privateMembershipUi()?.id===state.id&&version.current===token)setError(failure(reason));}
  finally{lock.current=false;if(alive.current&&version.current===token)setBusy(false);}};
 const labels=async(scopeId:string)=>{try{const value=await describeCurrentPrivateMembershipScope(scopeId);current();setDetail(value);}catch{current();setDetail(null);}};
 const loadOwners=async(value:string)=>{const result=await reviewCurrentPrivateAtomicOwners(value);current();const index=state.mode==='owner'?Math.max(0,result.scopes.findIndex(row=>row.ownerId===state.ownerId)):0;
   const inputs=await pendingCurrentPrivateAtomicOwnerReviews();current();const request=inputs.find(row=>row.fingerprint===value)?.request;if(!request)throw new Error('E2EE_MEMBERSHIP_PLAN_REQUIRED');const counts={tasks:0,categories:0,events:0},acl:MembershipChange[]=[],grants:Extract<MembershipOperation,{kind:'project-grants'}>['grants']=[];let header:MembershipAtomicOperationHeader|null=null;
   for(const [at,ref]of request.plan.pages.entries())if(ref.kind==='operation'||ref.kind==='product-operations'||ref.kind==='acl'||ref.kind==='operation-grants'){
   const part=await readCurrentPrivateAtomicOwnerPart(value,'plan',at);current();const page=part.page;if('items'in page&&page.kind==='operation')header=page.items[0];if('items'in page&&page.kind==='acl')acl.push(...page.items);
   if('items'in page&&page.kind==='product-operations')for(const batch of page.items)for(const operation of batch.operations){if(operation.kind==='task')counts.tasks++;else if(operation.kind==='category')counts.categories++;else if(operation.kind==='history')counts.events++;}
    if('items'in page&&page.kind==='operation-grants')grants.push(...page.items);
   }setOwnerGrants(grants);setGrantPage(0);setOwnerOperation(header);const target=header as MembershipAtomicOperationHeader|null,targetUser=target&&'userId'in target?target.userId:null,targetCategory=target&&'categoryId'in target?target.categoryId:null;
  const row=acl.find(row=>row.table==='shared_space_members'&&row.key.user_id===targetUser||row.table==='shared_member_categories'&&row.key.id===targetCategory),raw=row?.after?.permissions_json;
  setDesiredPermissions(typeof raw==='string'?parseLegacyMigrationJson(raw,'E2EE_MEMBERSHIP_PERMISSION_INVALID',16384) as MembershipPermissions:null);
  setEffects(counts);setFingerprint(value);setReview(result);setScopeIndex(index);setAck(false);setFinal(null);if(result.scopes[index])await labels(result.scopes[index].scopeId);};
 const load=async()=>{if(state.mode==='owner'){await loadOwners(state.fingerprint!);return;}
  const saved=await loadCurrentPrivateMembershipOperation(state.intentId!);current();setDraft(saved);let value=saved;
  if(!saved.started&&!saved.cancelled){value=await previewCurrentPrivateMembershipOperation(saved.intentId);current();setDraft(value);}
  const pending=await pendingCurrentPrivateAtomicOwnerReviews();current();const matches=pending.filter(row=>row.request.plan.intentId===value.intentId);setChoices(matches.map(row=>({fingerprint:row.fingerprint})));
  if(matches.length===1)await loadOwners(matches[0].fingerprint);
  else{const scope=value.proposal?.plan.requiredScopes[0];if(scope)await labels(scope.scopeId);}
 };
 useEffect(()=>{alive.current=true;void run(load);return()=>{alive.current=false;version.current++;};},[state.id]);
  useEffect(()=>holdPrivateEditorFence(),[]);
 const scope=review?.scopes[scopeIndex],operation=draft?.operation??ownerOperation;
 const permissions=operation&&'permissions'in operation&&operation.permissions?operation.permissions:desiredPermissions;
  const roleName=(value:string|null)=>value===null||value==='none'?c.noAccess:value==='admin'?c.admin:value==='guest'?c.guest:(roles as Record<string,string>)[value]??(productRoles as Record<string,string>)[value]??value;
  const grants=draft?.operation.kind==='project-grants'?draft.operation.grants:ownerGrants;
 const name=(id:string)=>detail?.members.find(row=>row.userId===id)?.displayName||id;
  const finish=async()=>{const result=await completedCurrentPrivateMembershipOperation(state.intentId!);current();if(!result)throw new Error('E2EE_MEMBERSHIP_OUTCOME_REVIEW_REQUIRED');completePrivateMembershipUi(state.id,result);};
 const build=async()=>{if(!draft)return;if(!draft.review){const saved=await confirmCurrentPrivateMembershipOperation(draft.intentId,draft.proposal!.fingerprint);current();setDraft(saved);}
   const result=await composeCurrentPrivateMembershipOperation(draft.intentId);current();if(result.state==='unchanged'){setMessage(c.unchanged);await finish();return;}await loadOwners(result.fingerprint);
 };
 const saveReview=async()=>{
  type Writer={write:(bytes:Uint8Array)=>Promise<void>;close:()=>Promise<void>;abort:()=>Promise<void>};
  const picker=(window as unknown as {showSaveFilePicker?:(options:unknown)=>Promise<{createWritable:()=>Promise<Writer>}>}).showSaveFilePicker;
  const handle=picker?await picker({suggestedName:'genesis-access-review.genesis-review'}):null;current();const stream=await exportCurrentPrivateMembershipReviewFile(fingerprint);current();
  if(handle){const writer=await handle.createWritable();try{for await(const bytes of stream){current();await writer.write(bytes);}current();await writer.close();}catch(reason){await writer.abort();throw reason;}}
  else{const parts:BlobPart[]=[];let size=0;for await(const bytes of stream){current();size+=bytes.length;if(size>48*1024*1024)throw new Error('E2EE_BROWSER_EXPORT_LIMIT');parts.push(new Uint8Array(bytes));}current();download('genesis-access-review.genesis-review',parts);}
 };
 const importApproval=async(file:File)=>{if(file.size<1||file.size>2*1024*1024)throw new Error('E2EE_MEMBERSHIP_REVIEW_MISMATCH');const approval=parseLegacyMigrationJson(await file.text(),'E2EE_MEMBERSHIP_REVIEW_MISMATCH',2*1024*1024) as MembershipAtomicOwnerApproval;current();await acceptCurrentPrivateAtomicOwnerApproval(fingerprint,approval);current();setMessage(c.approvalSaved);};
 const displayFingerprint=(value:string)=><code className="private-membership-code" dir="ltr">{value}</code>;
 return <PrivateMembershipModal titleId={titleId} onRequestClose={close}><div ref={dialogRef} className="workspace-recovery-dialog private-vault-dialog private-migration-dialog private-membership-dialog" tabIndex={-1}>
  <header className="workspace-recovery-heading"><h2 id={titleId}>{c.title}</h2><p>{c.notice}</p></header>
  {operation?<section aria-label={c.review}><h3>{c.actions[operation.kind]}</h3>{detail?.title?<p>{detail.title}</p>:null}
   {'userId'in operation?<p>{name(operation.userId)}{name(operation.userId)!==operation.userId?<small>{displayFingerprint(operation.userId)}</small>:null}</p>:null}
   {'role'in operation?<p>{roleName(operation.role)}</p>:null}
   {operation.kind==='invitation-admit'?<><p>{invitationSecurityCopy(language).ownerNotice}</p><p>{invitationSecurityCopy(language).inviter}: {name(operation.createdBy)} {displayFingerprint(operation.createdBy)}</p>{displayFingerprint(operation.invitationId)}{displayFingerprint(operation.resourceId)}</>:null}
   {operation.kind==='category-permissions'&&operation.rename&&operation.privateTitle!==undefined?<p><strong>{c.categoryTitle}: </strong>{operation.privateTitle}</p>:null}
   {review?.privateEffects.flatMap(row=>row.effects.renames.map(value=><section key={row.scopeId+':'+value.entityId} aria-label={c.categoryTitle}><h4>{c.categoryTitle}</h4><dl><div><dt>{c.beforeValue}</dt><dd>{value.before}</dd></div><div><dt>{c.afterValue}</dt><dd>{value.after}</dd></div></dl></section>))}
   {permissions?<PermissionChecks language={language} value={permissions} onChange={()=>{}} disabled/>:null}
    {operation.kind==='project-grants'?<><label className="backup-check"><input type="checkbox" checked={operation.allProjects} disabled/>{c.allProjects}</label><ul className="private-membership-roster">{grants.slice(grantPage*20,grantPage*20+20).map(grant=><li key={grant.projectId}>{displayFingerprint(grant.projectId)}<strong>{roleName(grant.role)}</strong><span>{grant.includeDescendants?c.includeDescendants:c.onlyProject}</span></li>)}</ul>{grants.length>20?<nav className="workspace-recovery-actions" aria-label={c.actions['project-grants']}><button type="button" disabled={busy||grantPage===0} onClick={()=>setGrantPage(page=>page-1)}>{c.previous}</button><span>{new Intl.NumberFormat(language).format(grantPage+1)} / {new Intl.NumberFormat(language).format(Math.ceil(grants.length/20))}</span><button type="button" disabled={busy||(grantPage+1)*20>=grants.length} onClick={()=>setGrantPage(page=>page+1)}>{c.next}</button></nav>:null}</>:null}
   {draft?.proposal?<dl><div><dt>{c.scopes}</dt><dd>{new Intl.NumberFormat(language).format(draft.proposal.plan.scopeIds.length)}</dd></div><div><dt>{c.changes}</dt><dd>{new Intl.NumberFormat(language).format(draft.proposal.plan.changes.length)}</dd></div></dl>:null}
   {effects?<dl><div><dt>{c.taskAssignments}</dt><dd>{new Intl.NumberFormat(language).format(effects.tasks)}</dd></div><div><dt>{c.categories}</dt><dd>{new Intl.NumberFormat(language).format(effects.categories)}</dd></div><div><dt>{c.events}</dt><dd>{new Intl.NumberFormat(language).format(effects.events)}</dd></div></dl>:null}
  </section>:null}
  {!review&&!final&&draft&&!draft.cancelled?<>
   {choices.length>1?<ul className="private-membership-choices">{choices.map(row=><li key={row.fingerprint}><button type="button" disabled={busy} onClick={()=>void run(()=>loadOwners(row.fingerprint))}>{displayFingerprint(row.fingerprint)}</button></li>)}</ul>:null}
   <label className="backup-check"><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>{c.planAck}</label>
   <button type="button" className="primary-button" disabled={busy||!ack||!draft.proposal} onClick={()=>void run(build)}>{draft.started?c.prepare:c.confirm}</button>
  </>:null}
  {review&&scope&&!final?<section aria-label={c.owners}><h3>{c.owners}</h3>{detail?.title?<h4>{detail.title}</h4>:<h4>{c.scopes}</h4>}{displayFingerprint(scope.scopeId)}
   <p>{name(scope.ownerId)}{name(scope.ownerId)!==scope.ownerId?<small>{displayFingerprint(scope.ownerId)}</small>:null}</p>
   <details><summary>{c.review}</summary>{displayFingerprint(fingerprint)}</details>
   <h4>{c.recipients}</h4><ul className="private-membership-roster">{scope.roles.map(row=><li key={row.deviceId}><span>{name(row.userId)}</span><strong>{roleName(row.role)}</strong><small>{displayFingerprint(row.userId)}{displayFingerprint(row.deviceId)}</small></li>)}</ul>
   <nav className="workspace-recovery-actions" aria-label={c.scopes}><button type="button" disabled={busy||scopeIndex===0} onClick={()=>void run(async()=>{const next=scopeIndex-1;setScopeIndex(next);setAck(false);await labels(review.scopes[next].scopeId);})}>{c.previous}</button><span>{new Intl.NumberFormat(language).format(scopeIndex+1)} / {new Intl.NumberFormat(language).format(review.scopes.length)}</span><button type="button" disabled={busy||scopeIndex+1>=review.scopes.length} onClick={()=>void run(async()=>{const next=scopeIndex+1;setScopeIndex(next);setAck(false);await labels(review.scopes[next].scopeId);})}>{c.next}</button></nav>
   {scope.ownerId===state.ownerId?<><label className="backup-check"><input type="checkbox" checked={ack} disabled={busy} onChange={event=>setAck(event.target.checked)}/>{c.ack}</label>
    <button type="button" disabled={busy||!ack} onClick={()=>void run(async()=>{await approveCurrentPrivateAtomicOwner(fingerprint,scope.scopeId,fingerprint,scope.roles);current();setAck(false);setMessage(c.approvalSaved);})}>{c.approve}</button>
    <button type="button" disabled={busy} onClick={()=>void run(async()=>{const approval=await exportCurrentPrivateAtomicOwnerApproval(fingerprint,scope.scopeId);current();download('genesis-owner-approval.json',[JSON.stringify(approval)],'application/json');})}>{c.exportApproval}</button>
   </>:<p>{c.awaiting}</p>}
   <button type="button" disabled={busy} onClick={()=>void run(saveReview)}>{c.exportReview}</button>
   {state.mode==='operation'?<><label>{c.importApproval}<input type="file" accept=".json,application/json" disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void run(()=>importApproval(file));}}/></label>
    <button type="button" disabled={busy} onClick={()=>void run(async()=>{await prepareCurrentPrivateMembershipPackets(state.intentId!,fingerprint);current();const value=await describeCurrentPrivateAtomicMembership(state.intentId!);current();setFinal(value);setFinalAck(false);})}>{c.finalReview}</button>
   </>:null}
  </section>:null}
  {final?<section aria-label={c.apply}><h3>{c.apply}</h3><p>{c.notice}</p>{displayFingerprint(final.fingerprint)}
   <label className="backup-check"><input type="checkbox" checked={finalAck} disabled={busy} onChange={event=>setFinalAck(event.target.checked)}/>{c.finalAck}</label>
    <button type="button" className="primary-button" disabled={busy||!finalAck} onClick={()=>void run(async()=>{await confirmCurrentPrivateAtomicMembership(state.intentId!,final.fingerprint);current();await submitCurrentPrivateAtomicMembership(state.intentId!);current();await finish();})}>{c.apply}</button>
  </section>:null}
   {state.mode==='operation'?<div className="workspace-recovery-actions"><button type="button" disabled={busy} onClick={()=>void run(async()=>{await reconcileCurrentPrivateAtomicMembership(state.intentId!);current();await finish();})}>{c.check}</button>
   <button type="button" disabled={busy} onClick={()=>void run(async()=>{const result=await resolveCurrentPrivateMembershipOperation(state.intentId!);current();replacePrivateMembershipOperation(state.id,result.intentId);})}>{c.resolve}</button></div>:null}
  {state.mode==='operation'?<details><summary>{c.cancel}</summary><label className="backup-check"><input type="checkbox" checked={cancelAck} disabled={busy} onChange={event=>setCancelAck(event.target.checked)}/>{c.cancelAck}</label><button type="button" disabled={busy||!cancelAck} onClick={()=>void run(async()=>{const result=await cancelCurrentPrivateMembershipOperation(state.intentId!);current();if(result.outcome==='reconcile-required'){setError(c.unknown);return;}closePrivateMembershipUi(state.id,'E2EE_MEMBERSHIP_CANCELLED');})}>{c.cancel}</button></details>:null}
  {busy?<p role="status" aria-live="polite">{c.busy}</p>:null}{message?<p role="status">{message}</p>:null}{error?<p className="workspace-recovery-error" role="alert">{error}</p>:null}
  <button data-dialog-initial-focus type="button" className="text-button" disabled={busy} onClick={close}>{c.keep}</button>
 </div></PrivateMembershipModal>;
}

export function PrivateMembershipEntry({ownerId,language}:{ownerId:string;language:string}){
 const lang=isLanguage(language)?language:'en',c=copy[lang],[items,setItems]=useState<Draft[]>([]),[ownerItems,setOwnerItems]=useState<{fingerprint:string;count:number}[]>([]),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const alive=useRef(true),turn=useRef(0),locked=useRef(false);
  // eslint-disable-next-line react-hooks/set-state-in-effect -- Owner changes retire private review state and its previous account capability.
  useEffect(()=>{alive.current=true;locked.current=false;setBusy(false);setError('');setItems([]);setOwnerItems([]);setLoaded(false);return()=>{alive.current=false;turn.current++;};},[ownerId]);
  const run=async(work:(current:()=>void)=>Promise<void>)=>{if(locked.current)return;locked.current=true;const token=turn.current;setBusy(true);setError('');
   try{const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(!alive.current||turn.current!==token||requirePrivateAccount(ownerId)!==account||document.visibilityState!=='visible')throw new Error('E2EE_ACCOUNT_CHANGED');};current();await work(current);current();}
   catch{if(alive.current&&turn.current===token)setError(c.error);}finally{if(turn.current===token){locked.current=false;if(alive.current)setBusy(false);}}};
  const load=()=>run(async current=>{const {pendingCurrentPrivateMembershipOperations}=await import('./cloud-sync');current();const rows=await pendingCurrentPrivateMembershipOperations();current();const owners=await pendingCurrentPrivateAtomicOwnerReviews();current();setItems(rows);setOwnerItems(owners.filter(row=>row.request.plan.actorId!==ownerId).map(row=>({fingerprint:row.fingerprint,count:row.request.plan.scopeIds.length})));setLoaded(true);});
 return <section className="private-membership-entry"><h4>{c.pending}</h4><button type="button" disabled={busy} onClick={()=>void load()}>{c.review}</button>
   {items.length?<ul>{items.map(row=><li key={row.intentId}><button type="button" disabled={busy} onClick={()=>void run(async current=>{const api=await import('./private-membership-ui');current();api.showPrivateMembershipOperation(ownerId,language,row.intentId);})}>{c.actions[row.operation.kind]}</button></li>)}</ul>:null}
   {ownerItems.length?<ul>{ownerItems.map(row=><li key={row.fingerprint}><button type="button" disabled={busy} onClick={()=>void run(async current=>{const api=await import('./private-membership-ui');current();api.showPrivateMembershipOwner(ownerId,language,row.fingerprint);})}>{c.owners}: {new Intl.NumberFormat(lang).format(row.count)}<code className="private-membership-code" dir="ltr">{row.fingerprint}</code></button></li>)}</ul>:null}
  {loaded&&!items.length&&!ownerItems.length?<p>{c.empty}</p>:null}
   <label>{c.importReview}<input type="file" accept=".genesis-review,application/octet-stream" disabled={busy} onChange={event=>{const file=event.currentTarget.files?.[0];event.currentTarget.value='';if(file)void run(async current=>{const result=await importCurrentPrivateMembershipReviewFile(file);current();const api=await import('./private-membership-ui');current();api.showPrivateMembershipOwner(ownerId,language,result.fingerprint);});}}/></label>
  {error?<p role="alert">{error}</p>:null}
 </section>;
}
