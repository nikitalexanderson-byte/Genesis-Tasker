import type {PaymentRegion} from './billing-location';

export type PublicCurrency = 'RUB' | 'USD';
export type CurrencySource = 'manual' | 'location' | 'ip' | 'browser';
export const PUBLIC_CURRENCY_KEY = 'genesis.public-pricing-currency.v1';
const russianZones = new Set(['Europe/Kaliningrad','Europe/Moscow','Europe/Kirov','Europe/Volgograd','Europe/Astrakhan','Europe/Saratov','Europe/Ulyanovsk','Europe/Samara','Asia/Yekaterinburg','Asia/Omsk','Asia/Novosibirsk','Asia/Barnaul','Asia/Tomsk','Asia/Novokuznetsk','Asia/Krasnoyarsk','Asia/Irkutsk','Asia/Chita','Asia/Yakutsk','Asia/Khandyga','Asia/Vladivostok','Asia/Ust-Nera','Asia/Magadan','Asia/Sakhalin','Asia/Srednekolymsk','Asia/Kamchatka','Asia/Anadyr']);

export function publicCurrency(value:unknown):PublicCurrency|null {
  return value==='RUB'||value==='USD'?value:null;
}

export function savedPublicCurrency():PublicCurrency|null {
  try {return publicCurrency(localStorage.getItem(PUBLIC_CURRENCY_KEY));} catch {return null;}
}

export function savePublicCurrency(currency:PublicCurrency|null):void {
  try {
    if(currency)localStorage.setItem(PUBLIC_CURRENCY_KEY,currency);
    else localStorage.removeItem(PUBLIC_CURRENCY_KEY);
  } catch { /* Keep the current view's choice when storage is unavailable. */ }
}

/** A display preference only: it neither identifies a person nor enables a payment provider. */
export function resolvePublicCurrency(input:{manual?:PublicCurrency|null;deviceRegion?:PaymentRegion|null;ipRegion?:PaymentRegion|null;locales?:readonly string[];timeZone?:string;language?:string}):{currency:PublicCurrency;source:CurrencySource} {
  if(input.manual)return {currency:input.manual,source:'manual'};
  for(const [region,source] of [[input.deviceRegion,'location'],[input.ipRegion,'ip']] as const){
    if(region==='RU'||region==='outside-RU')return {currency:region==='RU'?'RUB':'USD',source};
  }
  // Locale and time zone are weak hints, never substitutes for a known IP/device region.
  let localeRegion:string|undefined;
  for(const locale of input.locales??[]){
    try { localeRegion=new Intl.Locale(locale).region; } catch { /* Ignore malformed browser values. */ }
    if(localeRegion)break;
  }
  if(input.timeZone&&russianZones.has(input.timeZone))return {currency:'RUB',source:'browser'};
  if(localeRegion)return {currency:localeRegion==='RU'?'RUB':'USD',source:'browser'};
  // UTC is not geographic evidence; prefer a specific regional time zone over language.
  if(input.timeZone&&/^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific)\//.test(input.timeZone))return {currency:'USD',source:'browser'};
  return {currency:(input.locales?.[0]??input.language??'en').split(/[-_]/)[0]==='ru'?'RUB':'USD',source:'browser'};
}
