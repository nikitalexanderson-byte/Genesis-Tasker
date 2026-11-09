"use client";
import { useState } from "react";
import { resetAdminAccess,updateAdminSubscription, type SubscriptionPlan, type AdminUserStats } from "./cloud-sync";
import { useDialogAccessibility } from './use-dialog-accessibility';
import { runtimeLocale, translateText } from './i18n';
import { adminUserCopy as c } from "./admin-user-copy";

export const SUBSCRIPTION_PLANS = ["free", "standart", "premium", "business", "premium4life", "elite_plus"] as const satisfies readonly SubscriptionPlan[];
export const subscriptionLabel = (plan: SubscriptionPlan) => plan === "elite_plus" ? "Elite+" : plan === "premium4life" ? "Elite" : plan;

export function SubscriptionControl({user,onSaved,onRefresh}: {user:AdminUserStats;onSaved:(plan:SubscriptionPlan,revision:number)=>void;onRefresh:()=>Promise<void>}) {
  const current=user.subscriptionPlan ?? "free";
  const [draft,setDraft]=useState<SubscriptionPlan|null>(null);
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(""),[failed,setFailed]=useState(false);
  const selected=draft ?? current;
  const t=(source:string)=>translateText(source);
  const en=runtimeLocale().startsWith('en');const [reset,setReset]=useState(false);const [email,setEmail]=useState('');
  const resetRef=useDialogAccessibility<HTMLElement>(()=>{if(!busy)setReset(false);},reset);
  return <div className="admin-subscription-control" data-no-translate>
    <small>{c("current")}: <span>{subscriptionLabel(current)}</span></small>
    <form onSubmit={async event=>{
      event.preventDefault();setBusy(true);setMessage("");setFailed(false);
      if(selected==='free'){setBusy(false);setEmail('');setReset(true);return;}
      try { const result=await updateAdminSubscription(user.id,selected,current,user.subscriptionRevision);onSaved(result.subscriptionPlan,result.subscriptionRevision);setDraft(null);setMessage(c("saved")); }
      catch(reason) {setFailed(true);setMessage(reason instanceof Error&&reason.message==="SUBSCRIPTION_STATUS_CONFLICT" ? c("conflict") : c("error"));}
      finally {setBusy(false);}
    }}>
      <select aria-label={`${c("plan")}: ${user.email}`} value={selected} disabled={busy} onChange={event=>{setDraft(event.target.value as SubscriptionPlan);setMessage("");setFailed(false);}}>
        {SUBSCRIPTION_PLANS.map(plan=><option key={plan} value={plan}>{subscriptionLabel(plan)}</option>)}
      </select>
      <button type="submit" className="secondary-button" disabled={busy||selected===current} aria-label={`${c("save")}: ${user.email}`}>{busy ? c("saving") : c("save")}</button>
    </form>
    <button type="button" className="secondary-button" disabled={busy} onClick={()=>{setEmail('');setReset(true);}}>{en?'Reset access to Free':t('Сбросить доступ до Free')}</button>
    {reset?<div className="modal-backdrop"><section className="modal" ref={resetRef} role="dialog" aria-modal="true" aria-labelledby={`access-reset-${user.id}`} tabIndex={-1}>
      <h3 id={`access-reset-${user.id}`}>{en?'Revoke access?':t('Отозвать доступ?')}</h3>
      <p>{en?'The account will become Free. Data stays intact. Signing in again or reinstalling the app will not restore the old benefit.':t('Аккаунт перейдёт на Free. Данные сохранятся. Повторный вход и переустановка не вернут прежнюю льготу.')}</p>
      <label>{en?'Enter the user’s email':t('Введите e-mail пользователя')}<input type="email" value={email} onChange={event=>setEmail(event.target.value)} autoComplete="off"/></label>
      <footer><button type="button" disabled={busy} onClick={()=>setReset(false)}>{en?'Cancel':t('Отмена')}</button><button type="button" disabled={busy||email.trim().toLowerCase()!==user.email.toLowerCase()} onClick={async()=>{
        setBusy(true);setFailed(false);setMessage('');try{const result=await resetAdminAccess(user.id,current,user.subscriptionRevision??0);onSaved(result.subscriptionPlan,result.subscriptionRevision);setReset(false);setDraft(null);setMessage(c('saved'));await onRefresh();}
        catch{setFailed(true);setMessage(c('conflict'));}finally{setBusy(false);}
      }}>{en?'Revoke and set Free':t('Отозвать и установить Free')}</button></footer>
    </section></div>:null}
    {message ? <p className={failed ? "auth-error" : "admin-success"} role={failed ? "alert" : "status"}>{message}</p> : null}
    {failed ? <button type="button" className="secondary-button" disabled={busy} onClick={async()=>{
      setBusy(true);
      try {await onRefresh();setDraft(null);setMessage("");setFailed(false);}
      finally {setBusy(false);}
    }}>{c("refresh")}</button> : null}
  </div>;
}
