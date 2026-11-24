"use client";
import {useEffect,useState} from 'react';
import {publicFeatureIntroHtml,publicFooterHtml,publicPricingCardsHtml,publicPricingTermsHtml,publicProductCopy} from './public-product';
import {PublicGallery} from './PublicGallery';
import {PUBLIC_CURRENCY_KEY,publicCurrency,resolvePublicCurrency,savedPublicCurrency,savePublicCurrency,type PublicCurrency} from './public-currency';
import pricingCopy from './public-pricing-copy.json';
import {currentPublicEdition,type PublicEdition} from './public-route';

export function PublicProduct({language,edition=currentPublicEdition()}:{language:string;edition?:PublicEdition}) {
  const c=publicProductCopy(language,edition),p=pricingCopy[language as keyof typeof pricingCopy]??pricingCopy.en;
  const [manual,setManual]=useState(savedPublicCurrency);
  useEffect(()=>{
    const storage=(event:StorageEvent)=>{if(event.key===PUBLIC_CURRENCY_KEY)setManual(publicCurrency(event.newValue));};
    window.addEventListener('storage',storage);
    return()=>window.removeEventListener('storage',storage);
  },[]);
  const selection=resolvePublicCurrency({manual,language});
  const choose=(currency:PublicCurrency|null)=>{
    setManual(currency);
    savePublicCurrency(currency);
  };
  return <div className="public-product" data-no-translate>
    <section className="public-section" id="features" aria-labelledby="public-features-title">
      <div dangerouslySetInnerHTML={{__html:publicFeatureIntroHtml(language,edition)}} />
      <PublicGallery key={language} language={language} title={c.previews} />
      <p className="public-caption">{c.sampleData}</p>
    </section>
    <section className="public-section" id="pricing" aria-labelledby="public-pricing-title">
      <h2 id="public-pricing-title">{c.pricing}</h2><p>{c.free}</p>
      <div className="public-currency-controls">
        <span id="public-currency-label">{p.currency}</span>
        <div className="public-currency-switch" role="group" aria-labelledby="public-currency-label">
          {(['RUB','USD'] as const).map(currency=><button key={currency} type="button" aria-pressed={selection.currency===currency} onClick={()=>choose(currency)}>{currency}</button>)}
        </div>
        <button className="public-currency-auto" type="button" aria-pressed={manual===null} onClick={()=>choose(null)}>{p.auto}</button>
      </div>
      <div className="public-plans" data-currency={selection.currency} dangerouslySetInnerHTML={{__html:publicPricingCardsHtml(language,selection.currency,undefined,edition)}} />
      <div dangerouslySetInnerHTML={{__html:publicPricingTermsHtml(language,selection.currency,undefined,edition)}} />
    </section>
    <div dangerouslySetInnerHTML={{__html:publicFooterHtml(language,undefined,edition)}} />
  </div>;
}
