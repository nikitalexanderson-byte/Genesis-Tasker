import type {PaymentRegion} from './billing-location';
import {languageForRegion,regionFromLocales,REGION_LANGUAGES,type RegionLanguage} from './region-language.ts';

export type WebsiteRegion=Readonly<{ip:PaymentRegion;device:PaymentRegion|null;loading:boolean;locating:boolean;error:boolean}>;

/** Device location takes priority over an IP country, including a VPN exit. */
export function websiteRegionRussia(region:Pick<WebsiteRegion,'ip'|'device'>){return region.device==='RU'||region.device!=='outside-RU'&&region.ip==='RU';}
/** A regional hint selects a starting language without changing the list of choices. */
export function suggestedWebsiteLanguage(region:Pick<WebsiteRegion,'ip'|'device'>,
    locales:readonly string[],timeZone:string|undefined):RegionLanguage {
  if(websiteRegionRussia(region))return 'ru';
  for(const locale of locales){
    const base=locale.split(/[-_]/,1)[0].toLowerCase();
    const canonical = base === "iw" ? "he" : base;
    const supported=REGION_LANGUAGES.find(language=>language===canonical);
    if(supported)return supported;
  }
  return languageForRegion(timeZone,regionFromLocales(locales));
}
/** A language or IP alone never forces a change of website edition. */
export function websiteDomesticRedirect(_region:Pick<WebsiteRegion,'device'>){void _region;return false;}
export function websiteDonationsAvailable(_region:Pick<WebsiteRegion,'ip'|'device'|'loading'>){void _region;return true;}
