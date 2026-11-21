"use client";
import {useEffect,useRef,useState} from 'react';
import {publicFeatureIntroHtml,publicFooterHtml,publicPricingCardsHtml,publicPricingTermsHtml,publicProductCopy} from './public-product';
import {PublicGallery} from './PublicGallery';
import {grantedDevicePaymentRegion,locatePaymentRegion,type PaymentRegion} from './billing-location';
import {PUBLIC_CURRENCY_KEY,publicCurrency,resolvePublicCurrency,type PublicCurrency} from './public-currency';
import pricingCopy from './public-pricing-copy.json';

export function PublicProduct({language}:{language:string}) {
  const c=publicProductCopy(language),p=pricingCopy[language as keyof typeof pricingCopy]??pricingCopy.en;
  const [manual,setManual]=useState<PublicCurrency|null>(()=>{
    try {return publicCurrency(localStorage.getItem(PUBLIC_CURRENCY_KEY));} catch {return null;}
  });
  const [signals,setSignals]=useState<{ipRegion?:PaymentRegion;deviceRegion?:PaymentRegion;locales?:string[];timeZone?:string}>(()=>typeof navigator==='undefined'?{}:{locales:[...navigator.languages],timeZone:Intl.DateTimeFormat().resolvedOptions().timeZone});
  const [locating,setLocating]=useState(false),[locationError,setLocationError]=useState(false);
  const locationRequest=useRef({generation:0});
  useEffect(()=>{
    if(language!=='ru')return;
    const requests=locationRequest.current;
    requests.generation++;
    const controller=new AbortController();
    const timeout=window.setTimeout(()=>controller.abort(),5000);
    const base=(process.env.NEXT_PUBLIC_GENESIS_API_URL?.trim()||'/api').replace(/\/$/,'');
    void fetch(`${base}/billing/location`,{credentials:'omit',cache:'no-store',signal:controller.signal})
      .then(response=>response.ok?response.json():null).then(value=>{
        if(!controller.signal.aborted&&value?.source==='ip'&&['RU','outside-RU'].includes(value.region))setSignals(previous=>({...previous,ipRegion:value.region}));
      }).catch(()=>undefined).finally(()=>window.clearTimeout(timeout));
    const consent=new AbortController();
    void grantedDevicePaymentRegion(navigator.permissions,navigator.geolocation,consent.signal).then(region=>{
      if(!consent.signal.aborted&&region)setSignals(previous=>({...previous,deviceRegion:region}));
    });
    const storage=(event:StorageEvent)=>{if(event.key===PUBLIC_CURRENCY_KEY)setManual(publicCurrency(event.newValue));};
    window.addEventListener('storage',storage);
    return()=>{controller.abort();consent.abort();requests.generation++;window.clearTimeout(timeout);window.removeEventListener('storage',storage);};
  },[language]);
  const selection=language==='ru'?resolvePublicCurrency({...signals,manual,language}):{currency:'USD' as const,source:'manual' as const};
  const choose=(currency:PublicCurrency|null)=>{
    locationRequest.current.generation++;setLocating(false);setLocationError(false);setManual(currency);
    try {if(currency)localStorage.setItem(PUBLIC_CURRENCY_KEY,currency);else localStorage.removeItem(PUBLIC_CURRENCY_KEY);} catch { /* Keep this visit's choice even without persistence. */ }
  };
  const locate=async()=>{
    const request=++locationRequest.current.generation;setLocating(true);setLocationError(false);
    try {
      if(!navigator.geolocation)throw Error('Location unavailable');
      const region=await locatePaymentRegion(navigator.geolocation);
      if(request!==locationRequest.current.generation)return;
      if(region==='unknown')throw Error('Location uncertain');
      setSignals(previous=>({...previous,deviceRegion:region}));
      // A deliberate request for automatic location is distinct from a late background response.
      setManual(null);try {localStorage.removeItem(PUBLIC_CURRENCY_KEY);} catch { /* No persistent storage. */ }
    } catch {if(request===locationRequest.current.generation)setLocationError(true);}
    finally {if(request===locationRequest.current.generation)setLocating(false);}
  };
  return <div className="public-product" data-no-translate>
    <section className="public-section" id="features" aria-labelledby="public-features-title">
      <div dangerouslySetInnerHTML={{__html:publicFeatureIntroHtml(language)}} />
      <PublicGallery key={language} language={language} title={c.previews} />
      <p className="public-caption">{c.sampleData}</p>
    </section>
    <section className="public-section" id="pricing" aria-labelledby="public-pricing-title">
      <h2 id="public-pricing-title">{c.pricing}</h2><p>{c.free}</p>
      {language==='ru'?<><div className="public-currency-controls">
        <span id="public-currency-label">{p.currency}</span>
        <div className="public-currency-switch" role="group" aria-labelledby="public-currency-label">
          {(['USD','RUB'] as const).map(currency=><button key={currency} type="button" aria-pressed={selection.currency===currency} onClick={()=>choose(currency)}>{currency}</button>)}
        </div>
        <button className="public-currency-auto" type="button" aria-pressed={manual===null} onClick={()=>choose(null)}>{p.auto}</button>
        <button className="public-currency-locate" type="button" onClick={()=>void locate()} disabled={locating} title={p.privacy}>{locating?p.locating:p.locate}</button>
      </div>
      <p className="public-currency-status" role="status">{locationError?p.unavailable:p[selection.source]}</p>
      <p className="public-currency-privacy">{p.privacy}</p></>:null}
      <div className="public-plans" data-currency={selection.currency} dangerouslySetInnerHTML={{__html:publicPricingCardsHtml(language,selection.currency)}} />
      <div dangerouslySetInnerHTML={{__html:publicPricingTermsHtml(language,selection.currency)}} />
    </section>
    <div dangerouslySetInnerHTML={{__html:publicFooterHtml(language)}} />
  </div>;
}
