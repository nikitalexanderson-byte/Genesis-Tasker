"use client";

import {useState,type ReactNode} from "react";
import {createCloudTipsCheckout} from "./cloud-sync";
import {SUPPORT_TIPS_URL} from "./public-service";
import {translateText,type Language} from "./i18n";

/** Open synchronously for browser popup rules; only the server binds a donation to an account. */
export function DonationLink({children,className,language,authenticated=true,onOpen}:{
  children:ReactNode;className?:string;language:Language;authenticated?:boolean;onOpen?:()=>void;
}) {
  const [busy,setBusy]=useState(false);
  const [failed,setFailed]=useState(false);
  return <><a className={className} href={SUPPORT_TIPS_URL} target="_blank" rel="noopener noreferrer"
    aria-busy={busy || undefined} aria-disabled={busy || undefined}
    onClick={event=>{
      if(!authenticated){onOpen?.();return;}
      event.preventDefault();
      if(busy)return;
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
    }}>{children}</a>{failed?<span role="alert">{translateText("Не удалось открыть ссылку в браузере.",language)}</span>:null}</>;
}
