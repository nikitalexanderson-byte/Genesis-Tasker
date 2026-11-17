"use client";
import {useCallback,useEffect,useState} from 'react';
import {referralApi} from './cloud-sync';
import type {Language} from './i18n';
import copy from './referral-copy.json';
import './referrals.css';

type Discount={month:string;firstCount:number;recurringCount:number;percent:number};
type Dashboard={code:string|null;link:string|null;month:string;nextMonth:string;registeredThisMonth:number;monthlyLimit:number;current:Discount;next:Discount;used:boolean;reserved:boolean;canRedeemFreeMonth:boolean};
export function ReferralsPanel({language,onAccessChange}:{language:Language;onAccessChange?:()=>void|Promise<void>}){
  const c=copy[language as keyof typeof copy]??copy.en;
  const [data,setData]=useState<Dashboard|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(false),[message,setMessage]=useState('');
  const load=useCallback(async(signal?:AbortSignal)=>{try{const result=await referralApi<Dashboard>('/referrals/me',{signal});if(!signal?.aborted){setData(result);setError(false);}}catch{if(!signal?.aborted)setError(true);}},[]);
  useEffect(()=>{const controller=new AbortController();
    void referralApi<Dashboard>('/referrals/me',{signal:controller.signal}).then(result=>{if(!controller.signal.aborted){setData(result);setError(false);}}).catch(()=>{if(!controller.signal.aborted)setError(true);});
    return()=>controller.abort();},[]);
  async function create(){if(busy)return;setBusy(true);setError(false);try{setData(await referralApi<Dashboard>('/referrals/code',{method:'POST',body:'{}'}));}catch{setError(true);}finally{setBusy(false);}}
  async function redeem(){if(busy)return;setBusy(true);setError(false);try{await referralApi('/referrals/redeem',{method:'POST',body:'{}'});setMessage(c.success);await load();await onAccessChange?.();}catch{setError(true);}finally{setBusy(false);}}
  async function copyText(text:string){try{await navigator.clipboard.writeText(text);setMessage(c.copied);}catch{setError(true);}}
  return <section className="account-preferences referral-panel" data-no-translate><h3>{c.title}</h3><p>{c.intro}</p><p>{c.rules}</p><p>{c.monthlyOnly}</p>
    {data?<><dl className="referral-stats"><div><dt>{c.registered}</dt><dd>{data.registeredThisMonth} / {data.monthlyLimit}</dd></div><div><dt>{c.current} · {data.month}</dt><dd>{data.current.percent}%</dd></div><div><dt>{c.next} · {data.nextMonth}</dt><dd>{data.next.percent}%</dd></div></dl>
    {data.link&&data.code?<><label className="referral-field"><span>{c.code}</span><input readOnly value={data.code} onFocus={event=>event.currentTarget.select()}/></label><button type="button" disabled={busy} onClick={()=>void copyText(data.code!)}>{c.copy}</button><label className="referral-field"><span>{c.link}</span><input readOnly value={data.link} onFocus={event=>event.currentTarget.select()}/></label><button type="button" disabled={busy} onClick={()=>void copyText(data.link!)}>{c.copy}</button></>:<button type="button" disabled={busy} onClick={()=>void create()}>{c.create}</button>}
    {data.used?<p>{c.used}</p>:null}{data.canRedeemFreeMonth?<button type="button" disabled={busy} onClick={()=>void redeem()}>{c.freeMonth}</button>:null}</>:null}
    <p>{c.privacy}</p>{message?<p role="status">{message}</p>:null}{error?<><p role="alert">{c.error}</p><button type="button" disabled={busy} onClick={()=>void load()}>{c.retry}</button></>:null}
  </section>;
}
