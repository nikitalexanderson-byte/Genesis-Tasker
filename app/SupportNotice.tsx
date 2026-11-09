"use client";
import {useEffect,useId,useRef,useState} from "react";
import {claimSupportNotice,captureAccountSessionGuard,type GenesisUser} from "./cloud-sync";
import {DonationLink} from "./DonationLink";
import {DialogCloseButton} from "./DialogCloseButton";
import {useDialogAccessibility} from "./use-dialog-accessibility";
import {guidanceElementVisible} from "./plan-guidance-model";
import copy from "./support-notice-copy.json";
import "./support-notice.css";

const APP_BASE=(process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||"").replace(/\/$/,"");

function SupportDialog({language,onClose}:{language:GenesisUser["language"];onClose:()=>void}){
 const text=copy[language],title=useId(),body=useId(),dialog=useDialogAccessibility<HTMLElement>(onClose);
 return <div className="modal-backdrop support-notice-backdrop"><section className="support-notice-dialog" role="dialog" aria-modal="true" aria-labelledby={title} aria-describedby={body} ref={dialog} tabIndex={-1} data-no-translate data-dialog-header="none">
  <header className="support-notice-header"><span className="support-notice-brand" aria-hidden="true" style={{backgroundImage:`url("${APP_BASE}/icons/icon-round-v2.png")`}}/><h2 id={title}>{text.title}</h2><DialogCloseButton onClick={onClose}/></header>
  <p id={body}>{text.body}</p><div className="support-notice-actions"><DonationLink className="primary-button" language={language} onOpen={onClose}>{text.action}</DonationLink><button className="secondary-button" type="button" onClick={onClose}>{text.later}</button></div>
 </section></div>;
}
export default function SupportNotice({user}:{user:GenesisUser}){
 const [open,setOpen]=useState(false),current=useRef(user);
 useEffect(()=>{current.current=user;},[user]);
 const plan=user.featureAccess?.effectivePlan??user.subscriptionPlan,elite=user.forecastElitePlus;
 useEffect(()=>{
  let alive=true,pending=false,claimed=false;const guard=captureAccountSessionGuard(),controller=new AbortController();
  const key=`genesis-support-notice:${user.uid}`,cohort=`${plan}:${Boolean(elite)}`;
  const available=()=>{
   if(document.visibilityState!=="visible"||!navigator.onLine||Array.from(document.querySelectorAll('dialog[open],[aria-modal="true"],[role="dialog"],[role="alertdialog"]')).some(guidanceElementVisible))return false;
   const verification=current.current.emailVerification;
   return !verification?.required||Boolean(verification.dismissedUntil&&Date.parse(verification.dismissedUntil)>Date.now());
  };
  const show=async()=>{
   if(!alive||pending||!available())return;
   try{
    guard();if(claimed){claimed=false;setOpen(true);return;}
    const cached=JSON.parse(localStorage.getItem(key)||"null");if(cached?.cohort===cohort&&Date.parse(cached.nextAt)>Date.now())return;
    pending=true;const result=await claimSupportNotice(controller.signal);guard();if(!alive)return;
    localStorage.setItem(key,JSON.stringify({cohort,nextAt:result.nextAt}));
    // Keep an already claimed notice for the next foreground check if another dialog opened meanwhile.
    if(result.show){claimed=true;if(available()){claimed=false;setOpen(true);}}
   }catch{/* Retry on the next foreground check. */}finally{pending=false;}
  };
  const timer=window.setInterval(()=>void show(),60000);const resume=()=>void show();
  window.addEventListener("focus",resume);document.addEventListener("visibilitychange",resume);void show();
  return()=>{alive=false;controller.abort();window.clearInterval(timer);window.removeEventListener("focus",resume);document.removeEventListener("visibilitychange",resume);};
 },[user.uid,plan,elite]);
 return open?<SupportDialog language={user.language} onClose={()=>setOpen(false)}/>:null;
}
