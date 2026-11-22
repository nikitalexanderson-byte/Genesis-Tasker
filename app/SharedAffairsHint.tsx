import {useState,useSyncExternalStore} from 'react';
import type {Language} from './i18n';
import copy from './account-discovery-copy.json';
import {ExperimentalIcon} from './ExperimentalIcon';

const subscribe=(listener:()=>void)=>{window.addEventListener('storage',listener);return()=>window.removeEventListener('storage',listener);};
export default function SharedAffairsHint({ownerId,language,onGuide}:{ownerId:string;language:Language;onGuide:()=>Promise<void>}){
  const text=copy[language],key=`genesis:shared-affairs-discovery:v2:${ownerId}`;
  const [dismissed,setDismissed]=useState(false),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const opened=useSyncExternalStore(subscribe,()=>{try{return localStorage.getItem(key)==='opened';}catch{return false;}},()=>false);
  if(opened||dismissed)return null;
  const open=async()=>{if(busy)return;setBusy(true);setFailed(false);try{await onGuide();try{localStorage.setItem(key,'opened');}catch{/* The discovery hint can reappear when local storage is unavailable. */}setDismissed(true);}catch{setFailed(true);}finally{setBusy(false);}};
  return <aside className="shared-affairs-hint" role="note">
    <ExperimentalIcon name="team"/>
    <p data-no-translate>{text.sharedBefore}<button type="button" className="account-guide-link" disabled={busy} onClick={()=>void open()}>{text.account}</button>{text.sharedAfter}{failed?<span role="alert"> {text.sharedRetry}</span>:null}</p>
  </aside>;
}
