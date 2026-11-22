import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PUBLIC_PAGES,publicRouteForPath,publicPagePath,publicPageAlternates} from '../app/public-route.ts';
import {REGION_LANGUAGES} from '../app/region-language.ts';

test('public locale paths round-trip without changing the API or OAuth origin',()=>{
  for(const base of ['', '/preview'])for(const page of PUBLIC_PAGES)for(const language of REGION_LANGUAGES){
    const url=new URL(publicPagePath(language,page,base),'https://genesiscalendar.com');
    assert.equal(url.origin,'https://genesiscalendar.com');
    const route=publicRouteForPath(url.pathname,base);
    assert.equal(route.page,page);
    assert.equal(route.language,language==='ru'?'ru':'en');
    assert.equal(url.searchParams.get('lang'),['ru','en'].includes(language)?null:language);
  }
  for(const path of ['/api','/api/auth/google','/api/auth/google/callback','/ru/api','/_public-locales/en','/en/terms','/private','/preview-other/ru'])assert.equal(publicRouteForPath(path),null,path);
  assert.equal(publicRouteForPath('/ru/terms.html').page,'terms');
  assert.equal(publicRouteForPath('/preview/ru/login','/preview/').language,'ru');
  assert.equal(publicRouteForPath('/ru/login','/preview/'),null);
});

test('every public page exposes fourteen unique canonical alternates and an English default',()=>{
  for(const page of PUBLIC_PAGES){
    const rows=publicPageAlternates(page);
    assert.equal(rows.length,15);
    assert.equal(new Set(rows.map(row=>row.language)).size,15);
    assert.equal(rows.find(row=>row.language==='x-default').path,publicPagePath('en',page));
  }
});
