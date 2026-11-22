import referralCopy from './referral-copy.json';
import catalog from '../server/resources/billing-catalog.json';
import policy from '../server/resources/feature-access-policy.json';
import copy from './public-product-copy.json';
import domesticCopy from './public-domestic-service-copy.json';
import paymentCopy from './public-payment-copy.json';
import type {PublicCurrency} from './public-currency';
import {publicGalleryItems} from './public-gallery';
import {publicPagePath,currentPublicEdition,type PublicPage,type PublicEdition} from './public-route';
import type {RegionLanguage} from './region-language';

const APP_BASE=(process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||'').replace(/\/$/,'');
const publicLink=(language:string,page:PublicPage,base=APP_BASE,edition:PublicEdition=currentPublicEdition())=>publicPagePath(Object.hasOwn(copy,language)?language as RegionLanguage:'en',page,base,edition);

export const PADDLE_SUPPORT = 'demiurge.soft@gmail.com';
export const publicProductCopy = (language:string,edition:PublicEdition=currentPublicEdition())=>{const selected=copy[language as keyof typeof copy]??copy.en;return edition==='domestic'?{...selected,...(domesticCopy[language as keyof typeof domesticCopy]??domesticCopy.en)}:selected;};
export const escapePublicText = (value: string | number) => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));

/** The public page and its no-JavaScript response share the approved price and quota sources. */
export function publicPricingCardsHtml(language:string,currency:PublicCurrency,base=APP_BASE,edition:PublicEdition=currentPublicEdition()):string {
  const c = publicProductCopy(language,edition), escape = escapePublicText;
  const money = (minor: number) => new Intl.NumberFormat(language).format(minor / 100);
  const plans = ['standart','premium','business','premium4life'] as const;
  return plans.map((plan, index) => {
    const lifetime = plan === 'premium4life';
    const limits = policy.limits[lifetime ? 'business' : plan];
    const source = currency==='USD'?catalog.foreignPricing.prices:catalog.prices;
    const prices = source[plan as keyof typeof source];
    const lifetimePrice = currency==='USD'?catalog.foreignPricing.lifetimeAmountMinor:catalog.lifetimeOffer.amountMinor;
    return `<article class="public-plan"><h3>${['Standard','Premium','Business','Elite'][index]}</h3>
      <p class="public-price">${money(lifetime ? lifetimePrice : prices['1'])}<span> ${currency} / ${escape(lifetime ? c.once : c.month)}</span></p>
      ${lifetime ? `<p>${escape(c.lifetime)}</p>` : `<p class="public-yearly">${money(prices['12'])} ${currency} / ${escape(c.year)}</p>`}
      <ul>${[c.projects.replace('{n}', String(limits['personal-projects'])), c.habits.replace('{n}', String(limits.habits)), c.mindmaps.replace('{n}', String(limits.mindmaps)), c.diary.replace('{n}', String(limits.diary)), ...(index > 0 ? [c.gno] : []), ...(index > 1 ? [c.team] : [])].map(text => `<li>${escape(text)}</li>`).join('')}</ul>
      <a class="public-action" href="${publicLink(language,'login',base,edition)}#sign-in">${escape(c.getStarted)}</a></article>`;
  }).join('');
}

export function publicFeatureIntroHtml(language:string,edition:PublicEdition=currentPublicEdition()):string {
  const c=publicProductCopy(language,edition),escape=escapePublicText;
  return `<h2 id="public-features-title">${escape(c.benefits)}</h2>
    <div class="public-features">${c.featureTitles.map((title, index) => `<article><h3>${escape(title)}</h3><p>${escape(c.featureBodies[index])}</p></article>`).join('')}</div>
    <h2>${escape(c.previews)}</h2>`;
}

export function publicFeaturesHtml(language:string,edition:PublicEdition=currentPublicEdition()):string {
  const c=publicProductCopy(language,edition),escape=escapePublicText;
  return `<section class="public-section" id="features" aria-labelledby="public-features-title">${publicFeatureIntroHtml(language,edition)}
    <div class="public-previews" tabindex="0" role="region" aria-label="${escape(c.previews)}">${publicGalleryItems(language).map((item,index)=>`<figure><a href="${item.src}" target="_blank" rel="noreferrer"><img src="${item.src}" alt="${escape(item.caption)}" width="1440" height="1000" loading="lazy"></a><figcaption><span aria-hidden="true">${String(index+1).padStart(2,'0')} / 20</span>${escape(item.caption)}</figcaption></figure>`).join('')}</div>
    <p class="public-caption">${escape(c.sampleData)}</p></section>`;
}

export function publicPricingTermsHtml(language:string,currency:PublicCurrency,base=APP_BASE,edition:PublicEdition=currentPublicEdition()):string {
  const c=publicProductCopy(language,edition),p=paymentCopy[language as keyof typeof paymentCopy]??paymentCopy.en,escape=escapePublicText;
  return `<div data-price-currency="${currency}"><p class="public-billing-terms">${escape(p.period)}</p><p>${escape(p.checkout)}</p><p><a href="${publicLink(language,'refund',base,edition)}">${escape(c.refund)}</a> · ${escape(c.refundSummary)}</p></div>`;
}

export function publicFooterHtml(language:string,base=APP_BASE,edition:PublicEdition=currentPublicEdition()):string {
  const c=publicProductCopy(language,edition),escape=escapePublicText;
  return `<footer class="welcome-footer public-footer"><span>© 2026 GENESIS</span><nav aria-label="${escape(c.legal)}">${(['terms','privacy','refund','support','delete-account'] as const).map(page=>`<a href="${publicLink(language,page,base,edition)}">${escape(page==='delete-account'?c.deleteAccount:c[page])}</a>`).join('')}</nav><a href="mailto:${PADDLE_SUPPORT}">${PADDLE_SUPPORT}</a></footer>`;
}

/** No-JavaScript visitors still see localized, approved prices and payment availability. */
export function publicProductHtml(language:string,base=APP_BASE,edition:PublicEdition=currentPublicEdition()):string {
  const c=publicProductCopy(language,edition),escape=escapePublicText,currency=edition==='domestic'&&language==='ru'?'RUB':'USD';
  return `${publicFeaturesHtml(language,edition)}<section class="public-section" id="pricing" aria-labelledby="public-pricing-title"><h2 id="public-pricing-title">${escape(c.pricing)}</h2><p>${escape(c.free)}</p><div class="public-plans">${publicPricingCardsHtml(language,currency,base,edition)}</div>${publicPricingTermsHtml(language,currency,base,edition)}</section>${publicFooterHtml(language,base,edition)}`;
}

export function publicMerchantHtml(language:string,page:string,base=APP_BASE,edition:PublicEdition=currentPublicEdition()):string {
  const c = publicProductCopy(language,edition), escape = escapePublicText;
  const roles=[c.creator,c.infrastructure,c.paymentRoles].map(text=>`<p>${escape(text)}</p>`).join('');
  if(page==='home')return `<div class="public-merchant" data-no-translate><p>${escape(c.creator)}</p><p>${escape(c.infrastructure)}</p><p><a href="${publicLink(language,'support',base,edition)}">${escape(c.support)}</a> · <a href="${publicLink(language,'privacy',base,edition)}">${escape(c.privacy)}</a> · <a href="${publicLink(language,'refund',base,edition)}">${escape(c.refund)}</a></p></div>`;
  const r=referralCopy[language as keyof typeof referralCopy]??referralCopy.en;
  const referrals=page==='terms'?`<section data-no-translate><h2>${escape(r.title)}</h2><p>${escape(r.rules)}</p><p>${escape(r.monthlyOnly)}</p></section>`:page==='privacy'?`<section data-no-translate><h2>${escape(r.title)}</h2><p>${escape(r.privacy)}</p></section>`:'';
  return `${referrals}<section class="public-merchant" data-no-translate><h2>${escape(c.merchantTitle)}</h2>${roles}<p>${escape(c.merchant)}</p><p>${escape(c.pending)}</p><p>${escape(c.merchantPrivacy)}</p>${page === 'terms' || page === 'refund' ? `<p>${escape(c.renew)}</p><p>${escape(c.refundSummary)}</p>` : ''}<p><a href="mailto:${PADDLE_SUPPORT}">${PADDLE_SUPPORT}</a> · <a href="${publicLink(language,'refund',base,edition)}">${escape(c.refund)}</a></p></section>`;
}
