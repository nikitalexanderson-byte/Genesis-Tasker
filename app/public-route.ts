import {REGION_LANGUAGES,type RegionLanguage} from './region-language.ts';

export const PUBLIC_PAGES=['home','login','privacy','terms','refund','support','delete-account'] as const;
export type PublicPage=typeof PUBLIC_PAGES[number];
export type PublicRoute=Readonly<{language:RegionLanguage;page:PublicPage;explicitLanguage:boolean}>;

/** Public localization never changes the application, OAuth or API origin. */
export function publicRouteForPath(pathname:string,base=''):PublicRoute|null {
  const prefix=base.replace(/\/$/,'');
  if(prefix&&pathname!==prefix&&!pathname.startsWith(`${prefix}/`))return null;
  const path=pathname.slice(prefix.length).replace(/^\/+|\/+$/g,'');
  const parts=path?path.split('/'):[];
  const explicitLanguage=parts[0]==='ru';
  const language=explicitLanguage?parts.shift() as RegionLanguage:'en';
  if(parts.length>1)return null;
  const page=(parts[0]??'home').replace(/\.html$/,'');
  return (PUBLIC_PAGES as readonly string[]).includes(page)?{language,page:page as PublicPage,explicitLanguage}:null;
}

export function publicPagePath(language:RegionLanguage,page:PublicPage='home',base='') {
  const prefix=base.replace(/\/$/,'');
  const locale=language==='en'?'':`/${language}`;
  const path=`${prefix}${language==='ru'?locale:''}${page==='home'?'/':`/${page}`}`;
  return language==='ru'||language==='en'?path:`${path}?lang=${language}`;
}

export function publicPageAlternates(page:PublicPage,base='') {
  return [...REGION_LANGUAGES.map(language=>({language,path:publicPagePath(language,page,base)})),
    {language:'x-default',path:publicPagePath('en',page,base)}];
}
