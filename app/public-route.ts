import {REGION_LANGUAGES,type RegionLanguage} from './region-language.ts';

export const PUBLIC_PAGES=['home','login','privacy','terms','refund','support','delete-account'] as const;
export type PublicPage=typeof PUBLIC_PAGES[number];
export type PublicEdition='international'|'domestic';
export type PublicRoute=Readonly<{language:RegionLanguage;page:PublicPage;explicitLanguage:boolean;edition:PublicEdition}>;

/** Public localization never changes the application, OAuth or API origin. */
export function publicRouteForPath(pathname:string,base='',search=''):PublicRoute|null {
  const prefix=base.replace(/\/$/,'');
  if(prefix&&pathname!==prefix&&!pathname.startsWith(`${prefix}/`))return null;
  const path=pathname.slice(prefix.length).replace(/^\/+|\/+$/g,'');
  const parts=path?path.split('/'):[];
  const domestic=parts[0]==='ru';if(domestic)parts.shift();
  const requested=new URLSearchParams(search).get('lang');
  const selected=REGION_LANGUAGES.find(language=>language===requested);
  const language=selected??(domestic?'ru':'en'),explicitLanguage=!!selected||domestic;
  if(parts.length>1)return null;
  const slug=(parts[0]??'home').replace(/\.html$/,''),page=slug==='index'?'home':slug;
  return (PUBLIC_PAGES as readonly string[]).includes(page)?{language,page:page as PublicPage,explicitLanguage,edition:domestic?'domestic':'international'}:null;
}

export function currentPublicEdition(base=process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||''):PublicEdition {
  return typeof window==='undefined'?'international':publicRouteForPath(window.location.pathname,base)?.edition??'international';
}
export function publicPagePath(language:RegionLanguage,page:PublicPage='home',base='',edition:PublicEdition=currentPublicEdition(base)) {
  const prefix=base.replace(/\/$/,'');
  const path=`${prefix}${edition==='domestic'?'/ru':''}${page==='home'?'/':`/${page}`}`;
  return language===(edition==='domestic'?'ru':'en')?path:`${path}?lang=${language}`;
}

export function publicPageAlternates(page:PublicPage,base='',edition:PublicEdition=currentPublicEdition(base)) {
  return [...REGION_LANGUAGES.map(language=>({language,path:publicPagePath(language,page,base,edition)})),
    {language:'x-default',path:publicPagePath(edition==='domestic'?'ru':'en',page,base,edition)}];
}

/** Preserve an explicit language, document, query and anchor when GPS selects /ru. */
export function publicDomesticDestination(input:string,base=''):string|null {
  const url=new URL(input),route=publicRouteForPath(url.pathname,base,url.search);
  if(!route||route.edition==='domestic'||['code','state','token','auth','error'].some(key=>url.searchParams.has(key))||route.page==='home'&&url.hash&&!['#features','#pricing','#sign-in'].includes(url.hash))return null;
  const next=new URL(publicPagePath(route.explicitLanguage?route.language:'ru',route.page,base,'domestic'),url.origin);
  url.pathname=next.pathname;
  if(next.searchParams.has('lang'))url.searchParams.set('lang',next.searchParams.get('lang')!);else url.searchParams.delete('lang');
  return url.href;
}
