import assert from 'node:assert/strict';
import {test} from 'node:test';
import {PUBLIC_PAGES,publicRouteForPath,publicPagePath,publicPageAlternates,publicDomesticDestination,publicLanguagePath} from '../app/public-route.ts';
import {REGION_LANGUAGES} from '../app/region-language.ts';

test('a flag selects an explicit language and keeps the current document, invitation and fragment', () => {
  const current = new URL('https://genesiscalendar.com/preview/privacy?invite=abc&lang=he#data');
  for (const language of REGION_LANGUAGES) {
    const next = new URL(publicLanguagePath(language, 'privacy', '/preview', 'domestic', current), current);
    assert.equal(next.pathname, '/preview/privacy');
    assert.equal(next.searchParams.get('invite'), 'abc');
    assert.deepEqual(next.searchParams.getAll('lang'), [language]);
    assert.equal(next.hash, '#data');
    assert.equal(publicRouteForPath(next.pathname, '/preview', next.search).explicitLanguage, true);
  }
});

test('all supported languages share one website without changing the API or OAuth origin',()=>{
  for(const edition of ['international','domestic'])for(const base of ['', '/preview'])for(const page of PUBLIC_PAGES)for(const language of REGION_LANGUAGES){
    const url=new URL(publicPagePath(language,page,base,edition),'https://genesiscalendar.com');
    assert.equal(url.origin,'https://genesiscalendar.com');
    const route=publicRouteForPath(url.pathname,base,url.search);
    assert.equal(route.page,page);assert.equal(route.language,language);assert.equal(route.edition,'domestic');
    assert.equal(url.searchParams.get('lang'),language==='en'?null:language);
    assert.equal(url.pathname.includes('/ru'),false);
  }
  for(const path of ['/api','/api/auth/google','/api/auth/google/callback','/ru/api','/_public-locales/en','/en/terms','/private','/preview-other/ru'])assert.equal(publicRouteForPath(path),null,path);
  assert.equal(publicRouteForPath('/ru/terms.html').page,'terms');
  assert.equal(publicRouteForPath('/ru/index.html').edition,'domestic');
  assert.equal(publicRouteForPath('/preview/ru/login','/preview/').language,'ru');
  assert.equal(publicRouteForPath('/ru/login','/preview/'),null);
  assert.equal(publicRouteForPath('/','', '?lang=ru').edition,'domestic');
  assert.equal(publicRouteForPath('/ru/','', '?lang=en').edition,'domestic');
  for(const language of ['unknown','__proto__','toString'])assert.equal(publicRouteForPath('/ru/','', '?lang='+language).language,'ru');
});

test('legacy edition arguments expose the same unique language alternates',()=>{
  for(const edition of ['international','domestic'])for(const page of PUBLIC_PAGES){
    const rows=publicPageAlternates(page,'',edition);
    assert.equal(rows.length,REGION_LANGUAGES.length+1);assert.equal(new Set(rows.map(row=>row.path)).size,REGION_LANGUAGES.length);
    assert.equal(new Set(rows.map(row=>row.language)).size,REGION_LANGUAGES.length+1);
    assert.equal(rows.find(row=>row.language==='x-default').path,publicPagePath('en',page,'',edition));
    for(const row of rows)assert.equal(publicRouteForPath(new URL(row.path,'https://genesiscalendar.com').pathname).edition,'domestic');
  }
});

test('country signals never redirect any public, private or OAuth flow to another edition',()=>{
  assert.equal(publicDomesticDestination('https://genesiscalendar.com/?ref=friend#pricing'),null);
  assert.equal(publicDomesticDestination('https://genesiscalendar.com/privacy?lang=en#data'),null);
  assert.equal(publicDomesticDestination('https://genesiscalendar.com/preview/support?lang=de','/preview'),null);
  assert.equal(publicDomesticDestination('https://genesiscalendar.com/?lang=ru#sign-in'),null);
  for(const path of ['/ru/','/ru/privacy?lang=en','/api/auth/google','/#today','/#settings','/?code=abc&state=def','/login?auth=callback','/?token=abc','/?error=denied'])assert.equal(publicDomesticDestination('https://genesiscalendar.com'+path),null,path);
});
