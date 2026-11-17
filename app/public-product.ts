import referralCopy from './referral-copy.json';
import catalog from '../server/resources/billing-catalog.json';
import policy from '../server/resources/feature-access-policy.json';
import copy from './public-product-copy.json';

export const PADDLE_OWNER = 'Iurii Logvinov';
export const PADDLE_SUPPORT = 'demiurge.soft@gmail.com';
export const publicProductCopy = (language: string) => copy[language as keyof typeof copy] ?? copy.en;
export const escapePublicText = (value: string | number) => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]!));

/** The public page and its no-JavaScript response share the approved price and quota sources. */
export function publicProductHtml(language: string): string {
  const c = publicProductCopy(language), escape = escapePublicText;
  const rub = (minor: number) => new Intl.NumberFormat(language).format(minor / 100);
  const plans = ['standart','premium','business','premium4life'] as const;
  const cards = plans.map((plan, index) => {
    const lifetime = plan === 'premium4life';
    const limits = policy.limits[lifetime ? 'business' : plan];
    const prices = catalog.prices[plan as keyof typeof catalog.prices];
    return `<article class="public-plan"><h3>${['Standard','Premium','Business','Elite'][index]}</h3>
      <p class="public-price">${rub(lifetime ? catalog.lifetimeOffer.amountMinor : prices['1'])}<span> RUB / ${escape(lifetime ? c.once : c.month)}</span></p>
      ${lifetime ? `<p>${escape(c.lifetime)}</p>` : `<p class="public-yearly">${rub(prices['12'])} RUB / ${escape(c.year)}</p>`}
      <ul>${[c.projects.replace('{n}', String(limits['personal-projects'])), c.habits.replace('{n}', String(limits.habits)), c.mindmaps.replace('{n}', String(limits.mindmaps)), c.diary.replace('{n}', String(limits.diary)), ...(index > 0 ? [c.gno] : []), ...(index > 1 ? [c.team] : [])].map(text => `<li>${escape(text)}</li>`).join('')}</ul>
      <a class="public-action" href="/login#sign-in">${escape(c.getStarted)}</a></article>`;
  }).join('');
  return `<section class="public-section" id="features" aria-labelledby="public-features-title"><h2 id="public-features-title">${escape(c.benefits)}</h2>
    <div class="public-features">${c.featureTitles.map((title, index) => `<article><h3>${escape(title)}</h3><p>${escape(c.featureBodies[index])}</p></article>`).join('')}</div>
    <h2>${escape(c.previews)}</h2><div class="public-previews"><figure><a href="/product-preview/calendar.png"><img src="/product-preview/calendar.png" alt="${escape(c.calendarPreview)}" width="1440" height="1000" loading="lazy"></a><figcaption>${escape(c.calendarPreview)}</figcaption></figure><figure><a href="/product-preview/habits.png"><img src="/product-preview/habits.png" alt="${escape(c.habitsPreview)}" width="1440" height="1000" loading="lazy"></a><figcaption>${escape(c.habitsPreview)}</figcaption></figure></div>
    <p class="public-caption">${escape(c.sampleData)}</p></section>
    <section class="public-section" id="pricing" aria-labelledby="public-pricing-title"><h2 id="public-pricing-title">${escape(c.pricing)}</h2><p>${escape(c.free)}</p><div class="public-plans">${cards}</div>
    <p class="public-billing-terms">${escape(c.renew)}</p><p>${escape(c.tax)}</p><p>${escape(c.pending)}</p><p><a href="/refund">${escape(c.refund)}</a> · ${escape(c.refundSummary)}</p></section>
    <footer class="welcome-footer public-footer"><span>© 2026 GENESIS. Owned and operated by Iurii Logvinov.</span><a href="mailto:${PADDLE_SUPPORT}">${PADDLE_SUPPORT}</a><nav aria-label="${escape(c.legal)}"><a href="/terms">${escape(c.terms)}</a><a href="/privacy">${escape(c.privacy)}</a><a href="/refund">${escape(c.refund)}</a><a href="/support">${escape(c.support)}</a><a href="/delete-account">${escape(c.deleteAccount)}</a></nav></footer>`;
}

export function publicMerchantHtml(language: string, page: string): string {
  const c = publicProductCopy(language), escape = escapePublicText;
  if(page==='home')return `<div class="public-merchant" data-no-translate><p>${escape(c.merchant)}</p><p><a href="mailto:${PADDLE_SUPPORT}">${PADDLE_SUPPORT}</a> · <a href="/privacy">${escape(c.privacy)}</a> · <a href="/refund">${escape(c.refund)}</a></p></div>`;
  const r=referralCopy[language as keyof typeof referralCopy]??referralCopy.en;
  const referrals=page==='terms'?`<section data-no-translate><h2>${escape(r.title)}</h2><p>${escape(r.rules)}</p><p>${escape(r.monthlyOnly)}</p></section>`:page==='privacy'?`<section data-no-translate><h2>${escape(r.title)}</h2><p>${escape(r.privacy)}</p></section>`:'';
  return `${referrals}<section class="public-merchant" data-no-translate><h2>${escape(c.merchantTitle)}</h2><p>${escape(c.merchant)}</p><p>${escape(c.merchantPrivacy)}</p>${page === 'terms' || page === 'refund' ? `<p>${escape(c.renew)}</p><p>${escape(c.refundSummary)}</p>` : ''}<p><a href="mailto:${PADDLE_SUPPORT}">${PADDLE_SUPPORT}</a> · <a href="/refund">${escape(c.refund)}</a></p></section>`;
}
