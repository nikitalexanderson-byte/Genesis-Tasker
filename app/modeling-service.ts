import definition from '../server/resources/modeling-service.json';
import copy from './modeling-service-copy.json';
import type {Language} from './i18n';

export type ModelingPaymentMethod = {provider:'yookassa';amountMinor:number;currency:'RUB'|'USD';available:boolean};
export type ModelingPaymentCatalog = {service:string;methods:ModelingPaymentMethod[];routing:import('./billing-location').PaymentRouting;forecastElitePlus?:boolean;includedInPlan?:boolean;testingAccess?:boolean};
export type ModelingPaymentOrder = {id:string;resultId:string;service:string;provider:ModelingPaymentMethod['provider'];amountMinor:number;currency:string;
  status:'pending'|'paid'|'cancelled'|'refunded';checkoutUrl:string|null};
export function modelingServiceCopy(language:Language) {return copy[language];}
export const MODELING_SERVICE_PRICES=definition.prices;
export function modelingPaymentAmount(method:ModelingPaymentMethod) {
  return method.provider==='yookassa'?{currency:'RUB',amountMinor:definition.prices.RUB}:{currency:'USD',amountMinor:definition.prices.USD};
}
export function modelingAvailableMethod(method:ModelingPaymentMethod):boolean {
  if(method.provider!=='yookassa')return false;
  const fixed=modelingPaymentAmount(method);
  return method.available===true&&method.currency===fixed.currency&&method.amountMinor===fixed.amountMinor;
}
export function modelingCheckoutUrl(order:ModelingPaymentOrder):string|null {
  if(order.provider!=='yookassa')return null;
  const expected=modelingPaymentAmount({...order,available:true} as ModelingPaymentMethod);
  if(order.status!=='pending'||order.currency!==expected.currency||![expected.amountMinor,order.provider==='yookassa'?222200:2200].includes(order.amountMinor)||!order.checkoutUrl)return null;
  try {const url=new URL(order.checkoutUrl);const host=url.hostname;
    const allowed=['yoomoney.ru','yookassa.ru'].includes(host);
    return url.protocol==='https:'&&!url.username&&!url.password&&!url.port&&allowed?url.toString():null;
  }catch{return null;}
}
export function modelingReturnOrderId(url:string):string|null {
  try {const id=new URL(url).searchParams.get('modelingOrder');return id&&/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(id)?id:null;}catch{return null;}
}
