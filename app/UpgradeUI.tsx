"use client";
import {useEffect,useId,useRef,useState,type PointerEvent} from 'react';
import {loadBillingCatalog,loadBillingQuote,createBillingOrder,createBillingTrial,loadGenesisSession,captureAccountSessionGuard,GenesisApiError,type GenesisUser} from './cloud-sync';
import {BILLING_PLANS,BILLING_RESOURCES,BILLING_FALLBACK_POLICY,billingForeignRate,billingMoney,billingPlanAllows,billingPlanLimits,billingResourceCapacity,billingPlanName,billingDisplayPrice,billingCheckoutReady,effectiveBillingPlan,type BillingCatalog,type BillingPlan,type BillingProvider,type BillingQuote} from './billing';
import {paymentProviderOrder,preferredPaymentProvider} from './billing-location';
import {useAutomaticPaymentRegion} from './use-payment-region';
import {PaymentReturnDialog} from './PaymentReturnDialog';
import {FutureModelingPaymentReturn} from './FutureModelingPayment';
import {modelingReturnOrderId} from './modeling-service';
import {billingReturnCloseUrl,billingReturnOrderId} from './billing-return';
import billingLocationCopy from './billing-location-copy.json';
import billingSafetyCopy from './billing-safety-copy.json';
import billingFeatureCopy from './billing-feature-copy.json';
import {UPGRADE_REQUEST_EVENT,requestUpgrade,type UpgradeRequest} from './upgrade-events';
import {upgradeActionName,upgradeCopy,upgradeLabel,UPGRADE_FEATURES,UPGRADE_RESOURCE_NAMES,BILLING_FEATURE_COPY_KEYS} from './upgrade-copy';
import {DialogCloseButton} from './DialogCloseButton';
import {ExperimentalIcon} from './ExperimentalIcon';
import {useDialogAccessibility} from './use-dialog-accessibility';
import type {Language} from './i18n';
import './billing.css';
import {useBillingTrialLifecycle} from './use-billing-trial';
import {BillingTrialStatus,billingTrialText} from './BillingTrialStatus';
import {availableBillingTrials,billingTrialFrom,billingTrialImprovesPaid,billingTrialName,isBillingTrial,latestBillingTrial,requestBillingTrialRefresh,type BillingTrialPlan} from './billing-trial';
import trialCopy from './billing-trial-copy.json';

const DEFAULT_UPGRADE_REQUEST:UpgradeRequest={reason:'compare'};

export function UpgradeSpark({glow=false}:{glow?:boolean}) {
  const id=`upgrade-glow-${useId().replace(/[^a-z0-9]/gi,'')}`;
  const points=Array.from({length:24},(_,index)=>{const radius=index%2===0?12:7;const angle=-Math.PI/2+index*Math.PI/12;return `${(16+Math.cos(angle)*radius).toFixed(2)},${(16+Math.sin(angle)*radius).toFixed(2)}`;}).join(' ');
  return <svg className={`upgrade-spark${glow?' upgrade-spark-glowing':''}`} viewBox="0 0 32 32" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
    {glow?<defs><filter id={id} x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="1.4"/><feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>:null}
    <polygon points={points} fill="currentColor" fillOpacity=".12" filter={glow?`url(#${id})`:undefined}/>
    <circle cx="16" cy="16" r="2" fill="currentColor" stroke="none"/>
  </svg>;
}

function pointerGlow(event:PointerEvent<HTMLButtonElement>) {
  if(event.pointerType==='touch'||window.matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  const bounds=event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--upgrade-pointer-x',`${Math.round((event.clientX-bounds.left)/bounds.width*100)}%`);
  event.currentTarget.style.setProperty('--upgrade-pointer-y',`${Math.round((event.clientY-bounds.top)/bounds.height*100)}%`);
}

export function UpgradeButton({language,feature,resource,sidebar=false,compare=false}:{language:Language;feature?:string;resource?:string;sidebar?:boolean;compare?:boolean}) {
  const label=compare?upgradeCopy(language).compare:upgradeActionName(language);
  return <button type="button" className={`upgrade-open-button${sidebar?' upgrade-sidebar-button':''}`} aria-label={label} data-tooltip={label} data-no-translate aria-haspopup="dialog"
    onPointerMove={pointerGlow} onPointerLeave={event=>{event.currentTarget.style.removeProperty('--upgrade-pointer-x');event.currentTarget.style.removeProperty('--upgrade-pointer-y');}}
    onClick={()=>requestUpgrade({feature,resource,reason:feature?'feature':resource?'quota':'compare'})}><UpgradeSpark glow/><span>{label}</span></button>;
}

export function isFreeBillingUser(user:GenesisUser):boolean {
  return user.featureAccess?effectiveBillingPlan(user.featureAccess)==='free':user.subscriptionPlan==='free';
}

function suggestedPlan(request:UpgradeRequest,user:GenesisUser):BillingPlan {
  if(request.plan&&['standart','premium','business'].includes(request.plan))return request.plan;
  const policy=BILLING_FALLBACK_POLICY;
  const current=(user.featureAccess?effectiveBillingPlan(user.featureAccess):user.subscriptionPlan??'free') as BillingPlan;
  if(!request.feature&&!request.resource)return current!=='free'&&BILLING_PLANS.includes(current)?current:'standart';
  return BILLING_PLANS.find(plan=>plan!=='free'&&(request.feature?billingPlanAllows(policy,plan,request.feature)
    :request.resource?billingResourceCapacity(policy,plan,request.resource)>(request.limit??billingResourceCapacity(policy,current,request.resource)):plan==='standart'))??(BILLING_PLANS.includes(current)?current:'standart');
}

/** One host serves the sidebar, settings comparison and feature/quota explanations. */
export function UpgradeAccessUI({user,onUserChange}:{user:GenesisUser|null;onUserChange?:(user:GenesisUser)=>void}) {
  const [request,setRequest]=useState<UpgradeRequest|null>(null);
  const [returnOrder,setReturnOrder]=useState<string|null>(null);
  const [modelingOrder,setModelingOrder]=useState<string|null>(null);
  useBillingTrialLifecycle(user,onUserChange);
  if(request?.reason==='trial-expired'&&user&&!billingTrialImprovesPaid(user.featureAccess,request.plan??null))setRequest(null);
  useEffect(()=>{const read=()=>{setReturnOrder(billingReturnOrderId(window.location.href));setModelingOrder(modelingReturnOrderId(window.location.href));};read();window.addEventListener('popstate',read);return()=>window.removeEventListener('popstate',read);},[]);
  useEffect(()=>{
    const open=(event:Event)=>{if(user){setRequest((event as CustomEvent<UpgradeRequest>).detail??{reason:'compare'});requestBillingTrialRefresh();}};
    window.addEventListener(UPGRADE_REQUEST_EVENT,open);return()=>window.removeEventListener(UPGRADE_REQUEST_EVENT,open);
  },[user]);
  const showOrder=(id:string)=>{if(!billingReturnOrderId(`${window.location.origin}/?billingOrder=${encodeURIComponent(id)}`))return;setRequest(null);setReturnOrder(id);const url=new URL(window.location.href);url.searchParams.set('billingOrder',id);window.history.replaceState(window.history.state,'',url);};
  return user&&modelingOrder?<FutureModelingPaymentReturn key={`${user.uid}:${modelingOrder}`} user={user} orderId={modelingOrder} onClose={()=>{setModelingOrder(null);const url=new URL(window.location.href);url.searchParams.delete('modelingOrder');window.history.replaceState(window.history.state,'',url);}}/>:user&&returnOrder?<PaymentReturnDialog key={`${user.uid}:${returnOrder}`} user={user} orderId={returnOrder} onUserChange={onUserChange} onClose={()=>{setReturnOrder(null);window.history.replaceState(window.history.state,'',billingReturnCloseUrl(window.location.href));}}/>:user&&request?<UpgradeDialog key={user.uid} user={user} request={request} onOrder={showOrder} onUserChange={onUserChange} onClose={()=>setRequest(null)}/>:null;
}

export function UpgradeDialog({user,request=DEFAULT_UPGRADE_REQUEST,onClose,onOrder,onUserChange}:{user:GenesisUser;request?:UpgradeRequest;onClose:()=>void;onOrder?:(id:string)=>void;onUserChange?:(user:GenesisUser)=>void}) {
  const text=upgradeCopy(user.language);const [catalog,setCatalog]=useState<BillingCatalog|null>(null);
  const [selected,setSelected]=useState<BillingPlan>(()=>suggestedPlan(request,user));const [months,setMonths]=useState<1|12>(1);
  const [provider,setProvider]=useState<BillingProvider|null>(null);const [busy,setBusy]=useState(false);const [error,setError]=useState('');
  const [quoteState,setQuoteState]=useState<{offerId:string;provider:BillingProvider;quote:BillingQuote|null;failed:boolean}|null>(null);const [quoteRevision,setQuoteRevision]=useState(0);
  const [trialUpdate,setTrialUpdate]=useState<{base:GenesisUser;profile:GenesisUser}|null>(null);const [trialConfirm,setTrialConfirm]=useState<BillingTrialPlan|null>(null);
  const trialProfile=trialUpdate?.base===user?trialUpdate.profile:user;
  const [trialError,setTrialError]=useState('');const trialRequest=useRef<AbortController|null>(null);
  const [handledRequest,setHandledRequest]=useState(request);
  if(request!==handledRequest&&!busy&&!trialConfirm){
    // Keep an in-progress checkout/confirmation intact, then consume the newest explicit plan request once.
    setHandledRequest(request);
    if(request.plan&&['standart','premium','business'].includes(request.plan)) {
      setSelected(request.plan);setError('');setTrialError('');
    }
  }
  const trialStartRef=useRef<HTMLButtonElement|null>(null);const trialTitleRef=useRef<HTMLHeadingElement|null>(null);
  useEffect(()=>()=>trialRequest.current?.abort(),[]);
  useEffect(()=>{if(trialConfirm)trialTitleRef.current?.focus();},[trialConfirm]);
  const [catalogLoaded,setCatalogLoaded]=useState(false);const [catalogFailed,setCatalogFailed]=useState(false);const [catalogRevision,setCatalogRevision]=useState(0);
  const nativeRef=useRef<HTMLDialogElement|null>(null);const focusRef=useDialogAccessibility<HTMLDialogElement>(()=>{if(!busy)onClose();});
  const dialogRef=(element:HTMLDialogElement|null)=>{nativeRef.current=element;focusRef(element);};
  useEffect(()=>{const dialog=nativeRef.current;dialog?.showModal();return()=>dialog?.close();},[]);
  useEffect(()=>{let live=true;void loadBillingCatalog().then(value=>{if(live){setCatalog(value);setCatalogFailed(false);}}).catch(()=>{if(live)setCatalogFailed(true);}).finally(()=>{if(live)setCatalogLoaded(true);});return()=>{live=false;};},[user.uid,catalogRevision]);
  const policy=catalog?.policy?.features?catalog.policy:BILLING_FALLBACK_POLICY;
  const maximumReached=Boolean(request.resource&&BILLING_PLANS.every(plan=>billingResourceCapacity(policy,plan,request.resource!)<=(request.limit??billingResourceCapacity(policy,effectiveBillingPlan(user.featureAccess) as BillingPlan,request.resource!))));
  const limits=billingPlanLimits(policy,selected);
  const offer=catalog?.offers.find(value=>value.plan===selected&&value.periodMonths===(selected==='premium4life'?0:months));
  const offerId=offer?.id;
  const region=useAutomaticPaymentRegion(catalog?.routing,user.uid,busy);const methodOrder=paymentProviderOrder(region);
  const methods=[...(catalog?.providers??[{id:'google-play' as const,name:'Google Play',available:false,reason:null},{id:'lemon-squeezy' as const,name:'Lemon Squeezy',available:false,reason:null},{id:'yookassa' as const,name:'ЮKassa',available:false,reason:null}])].sort((a,b)=>methodOrder.indexOf(a.id)-methodOrder.indexOf(b.id));
  const configuredMethods=methods.filter(method=>method.available&&offer?.availableProviders.includes(method.id));
  const effectiveProvider=preferredPaymentProvider(region,configuredMethods.map(method=>method.id),provider);
  useEffect(()=>{if(!offerId)return;let live=true;void loadBillingQuote(offerId,effectiveProvider).then(quote=>{if(live){setQuoteState({offerId,provider:effectiveProvider,quote,failed:false});if(quote.pendingOrderId&&quote.availableProviders.length===1&&!quote.availableProviders.includes(effectiveProvider))setProvider(quote.availableProviders[0]);}}).catch(()=>{if(live)setQuoteState({offerId,provider:effectiveProvider,quote:null,failed:true});});return()=>{live=false;};},[offerId,effectiveProvider,quoteRevision,user.uid]);
  const quote=quoteState&&quoteState.offerId===offerId&&quoteState.provider===effectiveProvider?quoteState.quote:null;
  const quoteFailed=Boolean(quoteState&&quoteState.offerId===offerId&&quoteState.provider===effectiveProvider&&quoteState.failed);
  const availableMethods=configuredMethods.filter(method=>!quote||quote.availableProviders.includes(method.id));
  const ready=billingCheckoutReady(catalog,offer,quote,effectiveProvider);
  const currentPlan=user.subscriptionPlan??'free';
  const lifetime=user.featureAccess?.lifetimePremium===true;
  const safety=billingSafetyCopy[user.language];const locationText=billingLocationCopy[user.language];const features=billingFeatureCopy[user.language];
  const quoteReason=quote?.upgradeUnavailableReason==='shorter-period'?text.shorterPeriod:quote?.upgradeUnavailableReason==='upgrade-pending'?text.pendingUpgrade:quote?.upgradeUnavailableReason==='already-lifetime'?text.owned:quote?.upgradeUnavailableReason==='credit-covers-price'?text.coveredPrice:quote?.upgradeUnavailableReason==='lifetime-credit-unavailable'?safety.lifetimeCreditUnavailable:quote?.upgradeUnavailableReason==='credit-currency-unavailable'?safety.currencyCreditUnavailable:quote?.upgradeUnavailableReason==='credit-source-unverified'?safety.creditSourceUnverified:quote?.upgradeUnavailableReason==='credit-checkout-unavailable'?safety.creditCheckoutUnavailable:quote?.upgradeUnavailableReason==='settlement-required'?safety.settlementRequired:null;
  const money=(amount:number,currency='RUB')=>billingMoney(amount,user.language,currency);
  const foreignRate=billingForeignRate(catalog);
  const select=(plan:BillingPlan)=>{setSelected(plan);setError('');setTrialError('');setTrialConfirm(null);};
  const trialText=trialCopy[user.language];
  const applyTrialProfile=(fresh:GenesisUser)=>{
    setTrialUpdate({base:user,profile:fresh});onUserChange?.(fresh);
    setCatalog(current=>current?{...current,trial:billingTrialFrom(fresh)}:current);
  };
  const showTrialStatus=()=>requestAnimationFrame(()=>nativeRef.current?.querySelector<HTMLElement>('[data-subscription-trial]')?.focus());
  const activateTrial=async()=>{
    if(!trialConfirm||busy)return;
    const plan=trialConfirm,uid=user.uid,guard=captureAccountSessionGuard(),controller=new AbortController();
    trialRequest.current=controller;setBusy(true);setTrialError('');
    try {
      guard();
      const result=await createBillingTrial(plan,controller.signal);
      guard();
      if(controller.signal.aborted)return;
      if(result.user.uid!==uid||!isBillingTrial(result.trial))throw new Error('TRIAL_RESPONSE_INVALID');
      applyTrialProfile(result.user);setTrialConfirm(null);showTrialStatus();
    } catch(error) {
      if(controller.signal.aborted)return;
      const used=error instanceof GenesisApiError&&error.payload?.error==='TRIAL_ALREADY_USED';
      setTrialError(used?trialText.alreadyUsed:navigator.onLine?trialText.startFailed:trialText.onlineRequired);
      // An interrupted response may still have committed. Reload; never grant optimistically.
      try {
        guard();const fresh=await loadGenesisSession(controller.signal);guard();
        if(controller.signal.aborted||fresh?.uid!==uid)return;
        applyTrialProfile(fresh);
        const trial=billingTrialFrom(fresh);
        if(trial&&trial.status!=='available') {
          setTrialConfirm(null);showTrialStatus();
          if(trial.status==='active'&&trial.plan===plan)setTrialError('');
        }
      } catch { /* Keep the previous confirmed access and a visible retry explanation. */ }
    } finally {
      if(trialRequest.current===controller)trialRequest.current=null;
      if(!controller.signal.aborted)setBusy(false);
    }
  };

  // StrictMode cleanup can queue a close event before this same dialog reopens.
  return <dialog ref={dialogRef} className="billing-comparison-dialog upgrade-dialog" aria-labelledby="upgrade-dialog-title" data-no-translate
    onClose={event=>{if(!event.currentTarget.open)onClose();}} onCancel={event=>{event.preventDefault();if(!busy)onClose();}}>
    <header><h2 id="upgrade-dialog-title">{text.title}<span data-dialog-subtitle>{text.subtitle}</span></h2><DialogCloseButton disabled={busy} onClick={onClose}/></header>
    <p className="upgrade-current-plan">{trialCopy[user.language].paidPlan.replace("{plan}",billingPlanName(currentPlan))}</p>
    <BillingTrialStatus user={trialProfile} onPayment={plan=>{if(plan)select(plan);requestAnimationFrame(()=>nativeRef.current?.querySelector(".upgrade-checkout")?.scrollIntoView({block:"start"}));}}/>
    {request.reason==='quota'?<p className="upgrade-access-reason" role="status">{maximumReached?text.maximumReason:text.limitReason}</p>:request.reason==='feature'?<p className="upgrade-access-reason" role="status">{text.featureReason}</p>:null}
    {trialError?<p className="billing-trial-error" role="alert">{trialError}</p>:null}
    {trialConfirm?<section className="billing-trial-confirm" aria-labelledby="billing-trial-confirm-title">
      <h3 id="billing-trial-confirm-title" ref={trialTitleRef} tabIndex={-1}>{billingTrialText(trialText.confirmTitle,{trial:billingTrialName(trialConfirm)})}</h3>
      <p>{billingTrialText(trialText.confirmBody,{trial:billingTrialName(trialConfirm)})}</p><p>{trialText.noCharge}</p>
      <div className="billing-trial-actions">
        <button type="button" className="secondary-button" data-trial-back disabled={busy} onClick={()=>{setTrialConfirm(null);setTrialError('');requestAnimationFrame(()=>trialStartRef.current?.focus());}}>{trialText.back}</button>
        <button type="button" className="secondary-button" data-trial-confirm={trialConfirm} disabled={busy} onClick={()=>void activateTrial()}>{busy?trialText.starting:billingTrialText(trialText.confirmStart,{trial:billingTrialName(trialConfirm)})}</button>
      </div>
    </section>:<>
    {catalogLoaded&&!catalogFailed&&availableBillingTrials(latestBillingTrial(billingTrialFrom(trialProfile),catalog?.trial)).includes(selected as BillingTrialPlan)?<section className="billing-trial-offer" aria-label={trialText.offerTitle}>
      <h3>{billingTrialName(selected as BillingTrialPlan)} · {trialText.duration}</h3><p>{trialText.onceOnly}</p><p className="billing-trial-note">{trialText.noCharge}</p>
      <button type="button" className="secondary-button" ref={trialStartRef} data-trial-start={selected} disabled={busy} onClick={()=>{setTrialError('');setTrialConfirm(selected as BillingTrialPlan);}}>{billingTrialText(trialText.start,{trial:billingTrialName(selected as BillingTrialPlan)})}</button>
    </section>:null}
    <fieldset className="upgrade-period-options"><legend>{upgradeLabel('Срок доступа','Access period',user.language)}</legend>
      {[1,12].map(period=><label key={period}><input type="radio" name="upgrade-period" checked={months===period} onChange={()=>{setMonths(period as 1|12);setError('');}}/><span>{period===1?text.month:text.year}</span></label>)}
    </fieldset>
    <fieldset className="upgrade-plan-grid"><legend>{text.compare}</legend>
      {BILLING_PLANS.map(plan=>{const price=billingDisplayPrice(plan,months,catalog,effectiveProvider);return <label key={plan} className={`upgrade-plan-option upgrade-plan-${plan}${selected===plan?' is-selected':''}`}>
        <input type="radio" name="upgrade-plan" checked={selected===plan} onChange={()=>select(plan)}/>
        <span className="upgrade-plan-name">{billingPlanName(plan)}</span><strong className="upgrade-plan-price">{price===null?'—':money(price.amountMinor,price.currency)}</strong>
        <small>{plan==='free'?'Free':plan==='premium4life'?text.once:months===1?text.perMonth:text.perYear}</small>
      </label>;})}
    </fieldset>
    <section className="upgrade-plan-details" aria-labelledby="upgrade-features-title">
      <h3 id="upgrade-features-title">{billingPlanName(selected)} · {text.features}</h3>
      {selected==='premium4life'?<p className="upgrade-lifetime-note">{text.life}{catalog?.lifetimeSeats?<span>{text.seats}: <strong>{catalog.lifetimeSeats.remaining}</strong></span>:null}</p>:null}
      <dl className="upgrade-quota-grid" aria-label={text.limits}>{BILLING_RESOURCES.map((resource,index)=><div key={resource}><dt>{upgradeLabel(UPGRADE_RESOURCE_NAMES[index][0],UPGRADE_RESOURCE_NAMES[index][1],user.language)}</dt><dd>{limits[resource]===null?text.unlimited:limits[resource]??0}</dd></div>)}</dl>
      {billingPlanAllows(policy,selected,'shared-projects')?<p className="upgrade-policy-note">{features.sharedProjectPool}</p>:null}
      <ul className="upgrade-feature-list">{UPGRADE_FEATURES.map(([feature,ru,en])=>{const included=billingPlanAllows(policy,selected,feature);return <li key={feature} data-feature={feature} data-included={included}><ExperimentalIcon name={included?'check':'close'}/><span>{BILLING_FEATURE_COPY_KEYS[feature]?(features as Record<string,string>)[BILLING_FEATURE_COPY_KEYS[feature]]:upgradeLabel(ru,en,user.language)}</span><span className="sr-only">{included?text.included:text.excluded}</span></li>;})}
      </ul>
    </section>
    {selected==='free'?<p className="upgrade-free-selected">{text.freeSelected}</p>:<section className="upgrade-checkout" aria-labelledby="upgrade-payment-title">
      <h3 id="upgrade-payment-title">{text.payment}</h3>
      <fieldset className="upgrade-provider-options" disabled={busy}><legend className="sr-only">{text.payment}</legend>{methods.map(method=>{const connected=Boolean(catalog?.checkoutEnabled&&method.available&&offer?.availableProviders.includes(method.id));const blocked=!connected||effectiveProvider===method.id&&quote&&!quote.availableProviders.includes(method.id);return <label key={method.id} aria-disabled={!connected}><input type="radio" name="upgrade-provider" checked={effectiveProvider===method.id} disabled={!connected} onChange={()=>{setProvider(method.id);setError('');}}/><span>{method.name}{blocked?<small>{connected||method.reason==='client-unavailable'?text.methodUnavailable:text.notConnected}</small>:null}</span></label>;})}</fieldset>
      {effectiveProvider==='lemon-squeezy'&&foreignRate?<p className="upgrade-fx-note">{locationText.rate}: 1 USD = {foreignRate.quotePerBase} RUB · {foreignRate.effectiveDate}</p>:null}
      <p className="upgrade-policy-note">{locationText.oneTime}</p>
      {quote&&quote.creditMinor>0?<dl className="upgrade-credit"><div><dt>{text.listPrice}</dt><dd>{money(quote.listAmountMinor,quote.currency)}</dd></div><div><dt>{text.credit}</dt><dd>−{money(quote.creditMinor,quote.currency)}</dd></div><div><dt>{text.total}</dt><dd>{money(quote.amountMinor,quote.currency)}</dd></div></dl>:null}
      {quoteFailed?<p className="upgrade-quote-error" role="alert">{text.quoteError}<button type="button" className="upgrade-inline-action" onClick={()=>setQuoteRevision(value=>value+1)}><ExperimentalIcon name="map-refresh"/>{text.retry}</button></p>:null}
      {catalogFailed?<p className="upgrade-quote-error" role="alert">{text.catalogError}<button type="button" className="upgrade-inline-action" onClick={()=>setCatalogRevision(value=>value+1)}><ExperimentalIcon name="map-refresh"/>{text.retry}</button></p>:null}
      {quoteReason?<p className="upgrade-payment-status" role="status">{quoteReason}{quote?.upgradeUnavailableReason==='shorter-period'&&quote.recommendedPeriodMonths===12?<button type="button" className="upgrade-inline-action" onClick={()=>{setMonths(12);setError('');}}>{text.chooseYear}</button>:null}</p>:!catalogFailed?<p className="upgrade-payment-status" role="status">{lifetime?text.owned:!catalogLoaded||offerId&&!quote&&!quoteFailed?text.loading:!catalog?.checkoutEnabled||!configuredMethods.length?text.noPayment:quote&&!availableMethods.length?text.paymentUnavailable:text.paymentStart}</p>:null}
      {quote&&quote.creditMinor>0?<p className="upgrade-quote-hint">{text.quoteHint}</p>:null}
      {quote?.settlementOrderId&&onOrder?<button type="button" className="upgrade-inline-action" onClick={()=>onOrder(quote.settlementOrderId!)}><ExperimentalIcon name="map-refresh"/>{text.retry}</button>:null}
      <button type="button" className="upgrade-checkout-button" disabled={!ready||busy||lifetime} onClick={async()=>{
        if(!offer||!quote)return;setBusy(true);setError('');try{const order=await createBillingOrder(offer.id,effectiveProvider,crypto.randomUUID(),quote.amountMinor,quote.currency);if(order.settlement||order.status!=='pending')onOrder?.(order.id);else if(order.checkoutUrl)window.location.assign(order.checkoutUrl);else setError(text.noCheckout);}catch(error){if(error instanceof GenesisApiError&&error.payload?.error==='BILLING_QUOTE_CHANGED'){setQuoteState(null);setQuoteRevision(value=>value+1);setError(text.quoteChanged);}else setError(text.error);}finally{setBusy(false);}
      }}><span>{busy?text.opening:text.continue}</span>{quote?<strong>{money(quote.amountMinor,quote.currency)}</strong>:null}<ExperimentalIcon name="chevron"/></button>
      {error?<p role="alert">{error}</p>:null}
    </section>}
    </>}
  </dialog>;
}
