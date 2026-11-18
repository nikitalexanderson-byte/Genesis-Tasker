import assert from 'node:assert/strict';
import test from 'node:test';
import {localizedModule} from './helpers/localized-modules.mjs';
const {PUBLIC_PAGES,publicPagePath,publicRouteForPath,publicPageAlternates}=localizedModule('app/public-route.ts');
const {REGION_LANGUAGES}=localizedModule('app/region-language.ts');

test('Russian has one dedicated section; every other language stays on the main origin and switcher',()=>{
  for(const language of REGION_LANGUAGES)for(const page of PUBLIC_PAGES) {
    const url=new URL(publicPagePath(language,page),'https://genesiscalendar.com');
    assert.equal(url.origin,'https://genesiscalendar.com');
    assert.equal(url.pathname.startsWith('/ru/'),language==='ru');
    assert.equal(url.searchParams.get('lang'),['en','ru'].includes(language)?null:language);
    const route=publicRouteForPath(url.pathname);assert.equal(route.page,page);assert.equal(route.explicitLanguage,language==='ru');
  }
  assert.equal(publicPageAlternates('terms').length,15);
  assert.equal(publicPagePath('de','login'),'/login?lang=de');
});

test('public localization cannot intercept API, callbacks, downloads or unrelated private paths',()=>{
  for(const path of ['/api/session','/api/auth/google/callback','/downloads/app.apk','/ru/api/session','/ru/tasks','/de/terms','/unknown','/ru/terms/extra'])assert.equal(publicRouteForPath(path),null,path);
  assert.deepEqual(publicRouteForPath('/ru/privacy.html'),{language:'ru',page:'privacy',explicitLanguage:true});
  assert.equal(publicPagePath('ja','home','/preview/'),'/preview/?lang=ja');
  assert.equal(publicRouteForPath('/preview/ru/terms','/preview/').language,'ru');
  assert.equal(publicRouteForPath('/preview-other/terms','/preview'),null);
});

test('explicit Russian path wins; root defaults to English and a switcher link is reproducible',()=>{
  const original=globalThis.window,{browserLanguage}=localizedModule('app/i18n.ts');
  try {
    globalThis.window={location:{pathname:'/ru/',search:'?lang=de'},localStorage:{getItem:()=> 'ja'}};
    assert.equal(browserLanguage(),'ru');
    globalThis.window.location={pathname:'/',search:''};assert.equal(browserLanguage(),'en');
    globalThis.window.location.search='?lang=pl';assert.equal(browserLanguage(),'pl');
    globalThis.window.location={pathname:'/terms',search:'?lang=fr'};assert.equal(browserLanguage(),'fr');
  }finally{if(original===undefined)delete globalThis.window;else globalThis.window=original;}
});
