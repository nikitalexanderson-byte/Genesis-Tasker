"use client";
import {useEffect,useRef,useState} from 'react';
import {loadBillingOrder,loadGenesisSession,type GenesisUser} from './cloud-sync';
import {billingPlanName,type BillingOrder} from './billing';
import {billingReturnState} from './billing-return';
import returnCopy from './billing-return-copy.json';
import safetyCopy from './billing-safety-copy.json';
import {upgradeCopy} from './upgrade-copy';
import {DialogCloseButton} from './DialogCloseButton';
import {ExperimentalIcon} from './ExperimentalIcon';
import {useDialogAccessibility} from './use-dialog-accessibility';

/** A return URL is only an order reference; all status and account data come from authenticated GETs. */
export function PaymentReturnDialog({user,orderId,onClose,onUserChange}:{user:GenesisUser;orderId:string;onClose:()=>void;onUserChange?:(user:GenesisUser)=>void}) {
  const text=returnCopy[user.language];const safety=safetyCopy[user.language];const shared=upgradeCopy(user.language);
  const [order,setOrder]=useState<BillingOrder|null>(null);const [revision,setRevision]=useState(0);
  const [busy,setBusy]=useState(true);const [error,setError]=useState<'loadError'|'refreshError'|null>(null);const [paused,setPaused]=useState(false);
  const nativeRef=useRef<HTMLDialogElement|null>(null);const focusRef=useDialogAccessibility<HTMLDialogElement>(onClose);
  const userChangeRef=useRef(onUserChange);useEffect(()=>{userChangeRef.current=onUserChange;},[onUserChange]);
  useEffect(()=>{const dialog=nativeRef.current;dialog?.showModal();return()=>dialog?.close();},[]);
  useEffect(()=>{
    const controller=new AbortController();let live=true;let timer:ReturnType<typeof setTimeout>|undefined;let attempt=0;
    async function check() {
      attempt++;
      try {
        const next=await loadBillingOrder(orderId,controller.signal);if(!live)return;
        if(next.id!==orderId)throw new Error('BILLING_ORDER_MISMATCH');
        setOrder(next);const state=billingReturnState(next);
        // Cancellation/refund can revoke a previously cached entitlement as well.
        if(!state.poll) {
          try {const fresh=await loadGenesisSession(controller.signal);if(!live)return;if(fresh?.uid!==user.uid)throw new Error('BILLING_SESSION_CHANGED');userChangeRef.current?.(fresh);}
          catch {if(live)setError('refreshError');}
        }
        if(state.poll&&attempt<10)timer=setTimeout(()=>{void check();},Math.min(1000*2**(attempt-1),10000));
        else if(state.poll)setPaused(true);
      } catch {if(live)setError('loadError');}
      finally {if(live)setBusy(false);}
    }
    void check();return()=>{live=false;controller.abort();clearTimeout(timer);};
  },[orderId,user.uid,revision]);
  const state=order?billingReturnState(order):null;
  const message=state?safety[state.message]:safety.settlementVerifying;
  const money=order&&Number.isSafeInteger(order.amountMinor)&&order.amountMinor>=0&&/^[A-Z]{3}$/.test(order.currency)?new Intl.NumberFormat(user.language,{style:'currency',currency:order.currency}).format(order.amountMinor/100):null;
  return <dialog ref={element=>{nativeRef.current=element;focusRef(element);}} className="billing-comparison-dialog upgrade-dialog payment-return-dialog" aria-labelledby="payment-return-title" data-no-translate onClose={onClose} onCancel={event=>{event.preventDefault();onClose();}}>
    <header><h2 id="payment-return-title">{text.title}</h2><DialogCloseButton onClick={onClose}/></header>
    <p className="payment-return-status" role="status" aria-live="polite">{message}</p>
    {order?<p className="payment-return-amount"><strong>{billingPlanName(order.plan)}</strong>{money?<span>{money}</span>:null}</p>:null}
    <dl className="payment-return-order"><div><dt>{text.order}</dt><dd>{orderId}</dd></div></dl>
    {error?<p role="alert">{text[error]}</p>:null}
    {paused?<p className="payment-return-help">{text.paused}</p>:null}
    <p className="payment-return-help">{text.support}</p>
    <button type="button" className="upgrade-inline-action" disabled={busy} onClick={()=>{setBusy(true);setError(null);setPaused(false);setRevision(value=>value+1);}}><ExperimentalIcon name="map-refresh"/>{busy?shared.loading:text.check}</button>
  </dialog>;
}
