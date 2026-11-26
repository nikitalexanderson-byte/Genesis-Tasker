"use client";
import {useEffect,useState} from 'react';
import {hasPendingPrivateAdvice,pendingPrivateStoicheion,resumePrivateAdvice,resumePrivateStoicheion,usesPrivateProductStorage,type StoicheionDrawKind} from './cloud-sync';
import copy from '../contracts/e2ee/pending-copy-v1.json';
import type {Language} from './i18n';
import {translateText} from './i18n';
import {subscribePrivateAccount} from './e2ee/product-session';

/** Discovery reads protected local intent records only. Network retry requires
 * an explicit click and uses the exact previously saved operation. */
export function PrivatePendingOperations({ownerId,language,feature,onResolved}:{ownerId:string;language:Language;feature:'advice'|'stoicheion';onResolved:()=>void}){
 const [pending,setPending]=useState<string[]>([]),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false),[revision,setRevision]=useState(0),text=copy[language];
 useEffect(()=>{let active=true;const load=()=>{if(!usesPrivateProductStorage(ownerId)){setPending([]);return;}
   void(feature==='advice'?hasPendingPrivateAdvice().then(value=>value?['advice']:[]):pendingPrivateStoicheion()).then(rows=>{if(active)setPending(rows);}).catch(()=>undefined);};
  const unsub=subscribePrivateAccount(load);window.addEventListener('genesis-private-pending-change',load);window.addEventListener('focus',load);load();
  return()=>{active=false;unsub();window.removeEventListener('genesis-private-pending-change',load);window.removeEventListener('focus',load);};
 },[ownerId,feature,revision]);
 if(!pending.length)return null;
 const retry=async(id:string)=>{if(busy)return;setBusy(true);setFailed(false);try{if(feature==='advice')await resumePrivateAdvice();else await resumePrivateStoicheion(id as StoicheionDrawKind);setRevision(value=>value+1);onResolved();}catch{setFailed(true);}finally{setBusy(false);}};
 return <aside className="daily-advice-saved-status" data-no-translate><p role="status">{failed?text.error:text.message}</p>
  <div>{pending.map(id=><button key={id} type="button" className="secondary-button" disabled={busy} onClick={()=>void retry(id)}>{text.retry}{pending.length>1?' · '+(id==='daily'?translateText('Карта дня',language):id==='spread'?text.spread:text.timeline):''}</button>)}</div>
 </aside>;
}
