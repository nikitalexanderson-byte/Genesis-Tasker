"use client";
import {useEffect,useRef,useState} from 'react';
import {GenesisApiError,modelingServiceAccess,type GenesisUser} from './cloud-sync';
import {billingMoney} from './billing';
import {MODELING_SERVICE_PRICES,modelingAvailableMethod,modelingCheckoutUrl,modelingServiceCopy,type ModelingPaymentCatalog,type ModelingPaymentMethod,type ModelingPaymentOrder} from './modeling-service';
import type {Language} from './i18n';
import {DialogCloseButton} from './DialogCloseButton';
import {useDialogAccessibility} from './use-dialog-accessibility';

export function FutureModelingPrice({language}:{language:Language}) {
  const text=modelingServiceCopy(language);
  return <aside className="future-modeling-price" data-testid="modeling-service-price" data-no-translate>
    <strong>{text.title} · {billingMoney(MODELING_SERVICE_PRICES.RUB,language,'RUB')} / {billingMoney(MODELING_SERVICE_PRICES.USD,language,'USD')}</strong>
    <p>{text.description}</p>
  </aside>;
}

/** Mount only for the immutable result prepared by the completed test/dialogue. */
type ResultPaymentProps={user:GenesisUser;resultId:string;onUnlocked:(result:unknown)=>void};
export function FutureModelingPayment(props:ResultPaymentProps) {
  return <ResultPayment key={`${props.user.uid}:${props.resultId}`} {...props}/>;
}
function ResultPayment({user,resultId,onUnlocked}:ResultPaymentProps) {
  const text=modelingServiceCopy(user.language);const access=useRef(modelingServiceAccess(user.uid));
  const [catalog,setCatalog]=useState<ModelingPaymentCatalog|null>(null);const [method,setMethod]=useState<ModelingPaymentMethod|null>(null);
  const [order,setOrder]=useState<ModelingPaymentOrder|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const live=useRef(true);const pending=useRef(false);const key=useRef('');
  useEffect(()=>{live.current=true;const api=modelingServiceAccess(user.uid);access.current=api;const controller=new AbortController();
    void api.request<ModelingPaymentCatalog>('/billing/modeling/catalog?client=web',{signal:controller.signal}).then(value=>{
      if(!live.current)return;setCatalog(value);setMethod(value.methods.find(row=>modelingAvailableMethod(row)&&row.provider===value.routing.preferredProvider)??value.methods.find(modelingAvailableMethod)??null);
    }).catch(()=>{if(live.current)setError(text.error);});
    return()=>{live.current=false;controller.abort();};
  },[user.uid,text.error]);
  async function check(value:ModelingPaymentOrder) {
    const current=await access.current.request<ModelingPaymentOrder>(`/billing/modeling/orders/${value.id}`);
    if(!live.current)return;if(current.resultId!==resultId)throw new Error('MODELING_RESULT_MISMATCH');setOrder(current);
    if(current.status==='paid')await openResult();
  }
  async function openResult() {
    const result=await access.current.request<{id:string;solution:unknown}>(`/billing/modeling/results/${resultId}`);
    if(live.current&&result.id===resultId)onUnlocked(result);
  }
  const pay=async()=>{
    if((!catalog?.forecastElitePlus&&!method?.available)||pending.current)return;pending.current=true;setBusy(true);setError('');
    try {key.current ||= crypto.randomUUID();
      if(catalog?.forecastElitePlus){await openResult();return;}
      const value=await access.current.request<ModelingPaymentOrder>('/billing/modeling/orders',{method:'POST',body:JSON.stringify({resultId,provider:method!.provider,client:'web',idempotencyKey:key.current})});
      if(!live.current)return;if(value.resultId!==resultId)throw new Error('MODELING_RESULT_MISMATCH');setOrder(value);
      if(value.status==='paid')await check(value);
      else {const url=modelingCheckoutUrl(value);if(url)window.location.assign(url);else setError(text.pending);}
    }catch(error){if(error instanceof GenesisApiError&&error.payload?.error==='MODELING_PAYMENT_NOT_REQUIRED'){
      try{await openResult();}catch{if(live.current)setError(text.error);}
    }else if(live.current)setError(text.error);}finally{pending.current=false;if(live.current)setBusy(false);}
  };
  return <section className="future-modeling-checkout" data-no-translate>
    {catalog?.forecastElitePlus?<p className="admin-elite-plus">{text.privileged}</p>:<FutureModelingPrice language={user.language}/>}
    {!catalog?.forecastElitePlus&&catalog?.methods.filter(modelingAvailableMethod).map(row=><label key={row.provider}><input type="radio" name={`modeling-provider-${resultId}`} checked={row.provider===method?.provider} disabled={busy||!!order} onChange={()=>setMethod(row)}/>{row.provider==='yookassa'?'YooKassa':'Lemon Squeezy'} · {billingMoney(row.amountMinor,user.language,row.currency)}</label>)}
    <button type="button" className="primary-button" disabled={busy||(!catalog?.forecastElitePlus&&!method)||order?.status==='paid'} onClick={()=>void pay()}>{catalog?.forecastElitePlus?text.open:text.pay}{!catalog?.forecastElitePlus&&method?` · ${billingMoney(method.amountMinor,user.language,method.currency)}`:''}</button>
    {catalog&&!catalog.forecastElitePlus&&!method?<p role="status">{text.unavailable}</p>:null}
    {order?<button type="button" className="secondary-button" disabled={busy} onClick={()=>{if(pending.current)return;pending.current=true;setBusy(true);void check(order).catch(()=>{if(live.current)setError(text.error);}).finally(()=>{pending.current=false;if(live.current)setBusy(false);});}}>{text.check}</button>:null}
    {error?<p role="alert">{error}</p>:null}
  </section>;
}

/** A redirect carries an order ID only. It can never grant access or submit an amount. */
export function FutureModelingPaymentReturn({user,orderId,onClose}:{user:GenesisUser;orderId:string;onClose:()=>void}) {
  const text=modelingServiceCopy(user.language);const native=useRef<HTMLDialogElement|null>(null);const focus=useDialogAccessibility<HTMLDialogElement>(onClose);
  const [order,setOrder]=useState<ModelingPaymentOrder|null>(null);const [failed,setFailed]=useState(false);const [revision,setRevision]=useState(0);
  useEffect(()=>{native.current?.showModal();return()=>native.current?.close();},[]);
  useEffect(()=>{const controller=new AbortController();let live=true;
    void modelingServiceAccess(user.uid).request<ModelingPaymentOrder>(`/billing/modeling/orders/${orderId}`,{signal:controller.signal})
      .then(value=>{if(live){setOrder(value);setFailed(false);}}).catch(()=>{if(live)setFailed(true);});return()=>{live=false;controller.abort();};
  },[user.uid,orderId,revision]);
  return <dialog ref={element=>{native.current=element;focus(element);}} className="future-modeling-dialog" aria-labelledby="modeling-return-title" data-no-translate onCancel={event=>{event.preventDefault();onClose();}}>
    <header><h2 id="modeling-return-title">{text.title}</h2><DialogCloseButton onClick={onClose}/></header>
    <p role="status">{failed?text.error:order?.status==='paid'?text.paid:order?.status==='refunded'||order?.status==='cancelled'?text.unavailable:text.pending}</p>
    {order?<p>{billingMoney(order.amountMinor,user.language,order.currency)}</p>:null}
    <button type="button" className="secondary-button" onClick={()=>setRevision(value=>value+1)}>{text.check}</button>
  </dialog>;
}
