"use client";
import {createPortal} from "react-dom";
import {useEffect,useId,useState,type ReactNode} from "react";
import {createCloudTipsCheckout,captureAccountSessionGuard} from "./cloud-sync";
import {SUPPORT_TIPS_URL} from "./public-service";
import {useWebsiteRegion,websiteRegionRussia} from "./website-region";
import {loadDonationMethods,type DonationMethods} from "./donation-methods";
import {useDialogAccessibility} from "./use-dialog-accessibility";
import {DialogCloseButton} from "./DialogCloseButton";
import copy from "./donation-method-copy.json";
import type {Language} from "./i18n";
import "./donation-methods.css";

function DonationMethodsDialog({language,authenticated,onClose,onOpen}:{language:Language;authenticated:boolean;onClose:()=>void;onOpen?:()=>void}){
  const text=copy[language],id=useId(),region=useWebsiteRegion();
  const [methods,setMethods]=useState<DonationMethods|null>(null),[busy,setBusy]=useState(false),[failed,setFailed]=useState(false);
  const close=()=>{if(!busy)onClose();},dialog=useDialogAccessibility<HTMLElement>(close);
  useEffect(()=>{const controller=new AbortController();void loadDonationMethods(controller.signal).then(setMethods).catch(()=>{});return()=>controller.abort();},[]);
  const domestic=region.device!==null||region.ip!=='unknown'?websiteRegionRussia(region):methods?.region==='RU';
  const options=domestic?['cloudtips','boosty'] as const:['boosty','cloudtips'] as const;
  const open=(provider:'cloudtips'|'boosty')=>{
    if(busy)return;
    const foreign=provider==='boosty'?methods?.boosty:null;
    if(provider==='boosty'&&(!foreign?.available||!foreign.url))return;
    const destination=window.open('about:blank','_blank');if(destination)destination.opener=null;
    setBusy(true);setFailed(false);const guard=captureAccountSessionGuard();
    const checkout=provider==='boosty'?Promise.resolve({url:foreign!.url!,tracked:false}):authenticated?createCloudTipsCheckout():Promise.resolve({url:SUPPORT_TIPS_URL,tracked:false});
    void checkout.then(result=>{
      guard();const url=new URL(result.url);
      if(provider==='cloudtips'&&(url.protocol!=='https:'||url.hostname!=='pay.cloudtips.ru'||url.port||url.username||url.password||!/^\/p\/[A-Za-z0-9-]{8,100}$/.test(url.pathname)))throw new Error('INVALID_DONATION_DESTINATION');
      if(destination&&!destination.closed)destination.location.replace(url.href);else window.location.assign(url.href);
      onClose();onOpen?.();
    }).catch(()=>{destination?.close();setFailed(true);}).finally(()=>setBusy(false));
  };
  return <div className="modal-backdrop donation-method-backdrop"><section className="donation-method-dialog" role="dialog" aria-modal="true" aria-labelledby={id} ref={dialog} tabIndex={-1} data-no-translate data-dialog-header="none">
    <header><h2 id={id}>{text.title}</h2><DialogCloseButton disabled={busy} onClick={close}/></header>
    <p>{text.note}</p><div className="donation-method-options">{options.map(provider=><button type="button" key={provider} data-donation-method={provider} disabled={busy||provider==='boosty'&&!methods?.boosty.available} onClick={()=>open(provider)}>{provider==='cloudtips'?text.domestic:text.international}</button>)}</div>
    {!methods?.boosty.available?<p role="status">{text.pending}</p>:null}{failed?<p role="alert">{text.error}</p>:null}
  </section></div>;
}

/** Region changes the suggested order only; the donor can choose the card's actual method. */
export function DonationLink({children,className,language,authenticated=true,onOpen}:{children:ReactNode|((available:boolean,methodLabel:string)=>ReactNode);className?:string;language:Language;authenticated?:boolean;onOpen?:()=>void}){
  const [open,setOpen]=useState(false),text=copy[language];
  return <><a className={className} href="#donation-method" aria-haspopup="dialog" onClick={event=>{event.preventDefault();setOpen(true);}}>{typeof children==='function'?children(true,text.choose):children}</a>{open?createPortal(<DonationMethodsDialog language={language} authenticated={authenticated} onClose={()=>setOpen(false)} onOpen={onOpen}/>,document.querySelector(".genesis-app")??document.body):null}</>;
}
