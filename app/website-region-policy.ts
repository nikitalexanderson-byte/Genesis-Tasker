import type {PaymentRegion} from './billing-location';

export type WebsiteRegion=Readonly<{ip:PaymentRegion;device:PaymentRegion|null;loading:boolean;locating:boolean;error:boolean}>;

/** Device location takes priority over an IP country, including a VPN exit. */
export function websiteRegionRussia(region:Pick<WebsiteRegion,'ip'|'device'>){return region.device==='RU'||region.device!=='outside-RU'&&region.ip==='RU';}
/** A language or IP alone never forces a change of website edition. */
export function websiteDomesticRedirect(region:Pick<WebsiteRegion,'device'>){return region.device==='RU';}
export function websiteDonationsAvailable(region:Pick<WebsiteRegion,'ip'|'device'|'loading'>){return region.device==='RU'||!region.loading&&websiteRegionRussia(region);}
