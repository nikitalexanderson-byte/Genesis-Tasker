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
  return (PUBLIC_PAGES as readonly string[]).includes(page)?{language,page:page as PublicPage,explicitLanguage,edition:'domestic'}:null;
}

export function currentPublicEdition(_base=process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||''):PublicEdition {
  void _base;return 'domestic';
}
export function publicPagePath(language:RegionLanguage,page:PublicPage='home',base=process.env.NEXT_PUBLIC_GENESIS_BASE_PATH?.trim()||'',_edition:PublicEdition=currentPublicEdition(base)) {
  void _edition;const prefix=base.replace(/\/$/,'');
  const path=`${prefix}${page==='home'?'/':`/${page}`}`;
  return language==='en'?path:`${path}?lang=${language}`;
}

export function publicPageAlternates(page:PublicPage,base='',edition:PublicEdition=currentPublicEdition(base)) {
  return [...REGION_LANGUAGES.map(language=>({language,path:publicPagePath(language,page,base,edition)})),
    {language:'x-default',path:publicPagePath('en',page,base,edition)}];
}

export function publicLanguagePath(language: RegionLanguage, page: PublicPage, base = "", edition = currentPublicEdition(base),
  location?: Pick<URL, "search" | "hash">) {
  const path = publicPagePath(language, page, base, edition).split("?")[0];
  const query = new URLSearchParams(location?.search);
  query.set("lang", language);
  return `${path}?${query}${location?.hash ?? ""}`;
}

/** Compatibility export: country signals no longer select a website edition. */
export function publicDomesticDestination(_input:string,_base=''):string|null {void _input;void _base;return null;}
