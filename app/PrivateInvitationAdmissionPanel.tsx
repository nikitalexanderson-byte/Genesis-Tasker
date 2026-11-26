'use client';
import {useEffect,useRef,useState} from 'react';
import {requirePrivateAccount,subscribePrivateAccount} from './e2ee/product-session';
import {pendingCurrentPrivateInvitationAdmissions,createCurrentPrivateMembershipOperation} from './cloud-sync';
import type {InvitationAdmissionItem} from './e2ee/invitation-admission';
import {invitationSecurityCopy} from './invitation-security-copy';
import commonCopy from '../contracts/e2ee/shared-security-copy-v1.json';
import {showPrivateMembershipOperation} from './private-membership-ui';

export function PrivateInvitationAdmissionPanel({ownerId,language}:{ownerId:string;language:string}){
 const c=invitationSecurityCopy(language),common=commonCopy[language as keyof typeof commonCopy]??commonCopy.en;
 const [items,setItems]=useState<InvitationAdmissionItem[]>([]),[busy,setBusy]=useState(false),[loaded,setLoaded]=useState(false),[message,setMessage]=useState(''),generation=useRef(0);
 useEffect(()=>{const reset=()=>{generation.current++;setItems([]);setBusy(false);setLoaded(false);setMessage('');};const unsubscribe=subscribePrivateAccount(reset);return()=>{generation.current++;unsubscribe();};},[ownerId]);
 const run=async(work:(current:()=>void)=>Promise<void>)=>{if(busy)return;const number=++generation.current;setBusy(true);setMessage('');
  try{const account=requirePrivateAccount(ownerId),current=()=>{account.requireOpen();if(generation.current!==number||requirePrivateAccount(ownerId)!==account)throw new Error('E2EE_ACCOUNT_CHANGED');};await work(current);current();}
  catch{if(generation.current===number)setMessage(common.error);}finally{if(generation.current===number)setBusy(false);}
 };
 return <section className="private-invitation-admissions" data-no-translate><h4>{c.ownerTitle}</h4><p>{c.ownerNotice}</p>
  <button type="button" disabled={busy} onClick={()=>void run(async current=>{const rows=await pendingCurrentPrivateInvitationAdmissions();current();setItems(rows);setLoaded(true);})}>{common.load}</button>
  {loaded&&!items.length?<p>{common.empty}</p>:null}
  <ul>{items.map(item=><li key={item.scopeId+':'+item.operation.invitationId}><strong>{item.title}</strong><code className="private-membership-code" dir="ltr">{item.operation.userId}</code>
   <button type="button" disabled={busy} onClick={()=>void run(async current=>{const draft=await createCurrentPrivateMembershipOperation(item.operation);current();showPrivateMembershipOperation(ownerId,language,draft.intentId);})}>{c.ownerReview}</button>
  </li>)}</ul>{message?<p role="status">{message}</p>:null}
 </section>;
}
