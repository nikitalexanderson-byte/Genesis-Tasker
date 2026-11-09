import type { FeatureAccess } from './feature-access';
import {resolvedFeatureAccess, type BillingTrial} from './billing-trial.ts';
import approvedPolicy from '../server/resources/feature-access-policy.json' with {type:'json'};
import approvedCatalog from '../server/resources/billing-catalog.json' with {type:'json'};
export type BillingProvider = 'google-play' | 'lemon-squeezy' | 'yookassa';
export type BillingPrice={amountMinor:number;currency:string};
export type BillingForeignRate={quotePerBase:string;effectiveDate:string;source?:string};
export type BillingOffer = {id:string;plan:string;periodMonths:number;amountMinor:number|null;currency:string|null;availableProviders:BillingProvider[];seatLimit?:number;pricesByProvider?:Partial<Record<BillingProvider,BillingPrice>>};
export type BillingPolicy = {features:Record<string,string[]>;limits:Record<string,Record<string,number|null>>;disabledFeatures:string[]};
export type BillingCatalog = {schemaVersion:1;checkoutEnabled:boolean;providers:{id:BillingProvider;name:string;available:boolean;reason:string|null}[];
  offers:BillingOffer[];lifetimeSeats:{total:number;remaining:number};policy:BillingPolicy;
  trial?:BillingTrial;
  routing?:import('./billing-location').PaymentRouting;foreignPricing?:{pricingModel?:'fixed'|'fx-snapshot';rate?:BillingForeignRate|null}};
export type BillingQuote = {offerId:string;plan:string;periodMonths:number;currentPlan:string;currency:string;listAmountMinor:number;creditMinor:number;amountMinor:number;quotedAt:string;validUntil:string|null;availableProviders:BillingProvider[];provider?:BillingProvider;pendingOrderId?:string|null;settlementOrderId?:string|null;upgradeUnavailableReason?:'shorter-period'|'upgrade-pending'|'already-lifetime'|'credit-covers-price'|'lifetime-credit-unavailable'|'credit-currency-unavailable'|'credit-source-unverified'|'credit-checkout-unavailable'|'settlement-required'|null;recommendedPeriodMonths?:number|null};
export type BillingSettlement = {status:'verifying'|'refund-required'|'refund-pending'|'refunded'|'cancelled'|'failed';reason:string|null;deficitMinor:number;refundAmountMinor:number|null;currency:string;retryAt:string|null;errorCode:string|null};
export type BillingOrder = {id:string;plan:string;periodMonths:number;provider:BillingProvider;status:string;settlement:BillingSettlement|null;checkoutUrl:string|null;productId:string;amountMinor:number;currency:string;listAmountMinor:number;creditMinor:number};
export const BILLING_PLANS = ['free','standart','premium','business','premium4life'] as const;
export type BillingPlan = typeof BILLING_PLANS[number];
export const BILLING_RESOURCES = ['personal-projects','habits','mindmaps','diary','shared-projects','shared-mindmaps'] as const;
export const BILLING_FALLBACK_POLICY:BillingPolicy = approvedPolicy;
/** Fixed USD amounts are independent of RUB; only a legacy catalog can carry an FX note. */
export function billingForeignRate(catalog:BillingCatalog|null):BillingForeignRate|null {
  return catalog?.foreignPricing?.pricingModel==='fixed'?null:catalog?.foreignPricing?.rate??null;
}
export function billingMoney(amount:number,language:string,currency='RUB'):string {
  const decimals=amount%100===0?0:2;
  return new Intl.NumberFormat(language,{style:'currency',currency,minimumFractionDigits:decimals,maximumFractionDigits:decimals}).format(amount/100);
}
export function billingPlanLimits(policy:BillingPolicy,plan:BillingPlan) {return policy.limits[plan==='premium4life'?'business':plan]??{};}
export const BILLING_PLAN_LIMITS = Object.fromEntries(BILLING_PLANS.map(plan=>[plan,BILLING_RESOURCES.map(resource=>billingPlanLimits(BILLING_FALLBACK_POLICY,plan)[resource]===null?null:billingPlanLimits(BILLING_FALLBACK_POLICY,plan)[resource]??0)])) as Record<BillingPlan,(number|null)[]>;
export function billingPlanAllows(policy:BillingPolicy,plan:BillingPlan,feature:string):boolean {
  if(policy.disabledFeatures.includes(feature))return false;
  const allowed=policy.features[feature]??[];
  return allowed.includes(plan)||(plan==='premium4life'&&allowed.includes('business'));
}
/** An unavailable shared feature has no sellable capacity, even without a numeric quota row. */
export function billingResourceCapacity(policy:BillingPolicy,plan:BillingPlan,resource:string):number {
  if((resource==='shared-projects'||resource==='shared-mindmaps')&&!billingPlanAllows(policy,plan,'shared-projects'))return 0;
  return billingPlanLimits(policy,plan)[resource]??Infinity;
}
export function billingPlanName(plan:string):string {return plan==='elite_plus'?'Elite+':plan==='standart'?'Standard':BILLING_PLANS.includes(plan as BillingPlan)?({free:'Free',premium:'Premium',business:'Business',premium4life:'Elite'} as Record<string,string>)[plan]:'…';}
/** Approved public display amounts are not proof that a provider or checkout is enabled. */
export function billingDisplayAmount(plan:BillingPlan,months:number,catalog:BillingCatalog|null):number|null {
  if(plan==='free')return 0;
  const offer=catalog?.offers.find(offer=>offer.plan===plan&&offer.periodMonths===(plan==='premium4life'?0:months));
  if(offer?.amountMinor!==null&&offer?.amountMinor!==undefined)return offer.amountMinor;
  if(plan==='premium4life')return approvedCatalog.lifetimeOffer.amountMinor;
  const prices=(approvedCatalog as {prices?:Record<string,Record<string,number>>}).prices;
  return prices?.[plan]?.[String(months)]??null;
}
export function billingOfferPrice(offer:BillingOffer,provider:BillingProvider):BillingPrice|null {
  const price=offer.pricesByProvider?.[provider];
  if(price)return price;
  return offer.amountMinor!==null&&offer.currency?{amountMinor:offer.amountMinor,currency:offer.currency}:null;
}
/** Display-only fallback uses the same fixed USD catalog as the server; API prices take precedence. */
export function billingDisplayPrice(plan:BillingPlan,months:number,catalog:BillingCatalog|null,provider:BillingProvider):BillingPrice|null {
  if(plan==='free')return {amountMinor:0,currency:provider==='lemon-squeezy'?'USD':'RUB'};
  const offer=catalog?.offers.find(value=>value.plan===plan&&value.periodMonths===(plan==='premium4life'?0:months));
  if(offer?.pricesByProvider?.[provider])return offer.pricesByProvider[provider]!;
  if(provider==='lemon-squeezy'){
    const foreign=approvedCatalog.foreignPricing;
    const amount=plan==='premium4life'?foreign.lifetimeAmountMinor:(foreign.prices as Record<string,Record<string,number>>)[plan]?.[String(months)];
    return typeof amount==='number'?{amountMinor:amount,currency:foreign.currency}:null;
  }
  const amount=billingDisplayAmount(plan,months,catalog);
  return amount===null?null:{amountMinor:amount,currency:offer?.currency??'RUB'};
}
export function billingCheckoutReady(catalog:BillingCatalog|null,offer:BillingOffer|undefined,quote:BillingQuote|null|undefined,provider:BillingProvider):boolean {
  const price=offer?billingOfferPrice(offer,provider):null;
  const pending=typeof quote?.pendingOrderId==='string'&&/^[a-zA-Z0-9_-]{16,100}$/.test(quote.pendingOrderId);
  return Boolean(catalog?.checkoutEnabled&&offer&&quote&&!quote.upgradeUnavailableReason&&quote.offerId===offer.id&&quote.plan===offer.plan&&quote.periodMonths===offer.periodMonths
    &&[quote.amountMinor,quote.listAmountMinor,quote.creditMinor].every(Number.isSafeInteger)&&quote.amountMinor>0&&quote.creditMinor>=0&&quote.listAmountMinor-quote.creditMinor===quote.amountMinor
    &&/^[A-Z]{3}$/.test(quote.currency)&&(pending||quote.currency===price?.currency&&quote.listAmountMinor===price?.amountMinor)
    &&(!quote.provider||quote.provider===provider)
    &&quote.availableProviders?.includes(provider)&&offer.availableProviders.includes(provider)&&catalog.providers.some(method=>method.id===provider&&method.available));
}
export function effectiveBillingPlan(access?:FeatureAccess):string {const current=resolvedFeatureAccess(access);return current?.lifetimePremium?'premium4life':current?.effectivePlan??'free';}
