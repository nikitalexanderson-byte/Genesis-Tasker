"use client";

import {useState,type ReactNode} from "react";
import {createCloudTipsCheckout} from "./cloud-sync";
import {SUPPORT_TIPS_URL} from "./public-service";
import {translateText,type Language} from "./i18n";
import {useWebsiteRegion,websiteDonationsAvailable} from "./website-region";
import regionCopy from "./website-region-copy.json";

/** Open synchronously for browser popup rules; only the server binds a donation to an account. */
export function DonationLink({children,className,language,authenticated=true,onOpen}:{
  children:ReactNode|((available:boolean)=>ReactNode);className?:string;language:Language;authenticated?:boolean;onOpen?:()=>void;
}) {
  const region=useWebsiteRegion(),available=websiteDonationsAvailable(region),copy=regionCopy[language]??regionCopy.en;
  const content=typeof children==='function'?children(available):children;
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  if(!available)return <button type="button" className={[className,'genesis-donation-disabled'].filter(Boolean).join(' ')} disabled aria-disabled="true" title={copy.donationUnavailable}>{content}</button>;
  return <><a className={className} href={SUPPORT_TIPS_URL} target="_blank" rel="noopener noreferrer"
    aria-busy={busy || undefined} aria-disabled={busy || undefined}
    onClick={event=>{
      if(!authenticated){onOpen?.();return;}
      event.preventDefault();
      if(busy||!available)return;
      setBusy(true);setFailed(false);
      const destination=window.open("about:blank","_blank");
      if(destination)destination.opener=null;
      void createCloudTipsCheckout().then(result=>{
        const url=new URL(result.url);
        if(url.protocol!=="https:"||url.hostname!=="pay.cloudtips.ru"||url.port||url.username||url.password
          ||!/^\/p\/[A-Za-z0-9-]{8,100}$/.test(url.pathname))throw new Error("INVALID_DONATION_DESTINATION");
        if(destination&&!destination.closed)destination.location.replace(url.href);
        else window.location.assign(url.href);
        onOpen?.();
      }).catch(()=>{
        destination?.close();setFailed(true);
      }).finally(()=>setBusy(false));
    }}>{content}</a>{failed?<span role="alert">{translateText("Не удалось открыть ссылку в браузере.",language)}</span>:null}</>;
}
