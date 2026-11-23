import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertPublicDocumentReferences} from './public-document-references.mjs';

const readJson=async name=>JSON.parse(await readFile(new URL('../app/'+name+'.json',import.meta.url),'utf8'));
const [copy,domestic,pageCopy,retention,weather,international,regionCopy,billingLegal]=await Promise.all(['public-product-copy','public-domestic-service-copy','public-page-copy','account-retention-legal-copy','weather-legal-copy','public-international-copy','website-region-copy','public-billing-legal-copy'].map(readJson));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages=['home','login','privacy','terms','refund','support','delete-account'];
const editions=['international','domestic'];
const route=(language,page,edition)=>(edition==='domestic'?'/ru':'')+(page==='home'?'/':'/'+page)+(language===(edition==='domestic'?'ru':'en')?'':'?lang='+language);
const internationalText=(language,text)=>text.replaceAll('nikitalexanderson@gmail.com','demiurge.soft@gmail.com').replaceAll('CloudTips',international[language].paymentProvider).replace('a signed the external payment provider notification','a signed notification from the external payment provider').replace(/(^|[.!?]\s+)the external payment provider/g,(_match,prefix)=>prefix+'The external payment provider');

/** Independent document contract: edition and language vary independently;
 * complete authored disclosures and working local navigation remain required. */
export async function verifyPublicLocales(output) {
  let verified=0;
  for(const edition of editions)for(const [language,baseCopy]of Object.entries(copy))for(const page of pages) {
    const c=edition==='domestic'?{...baseCopy,...domestic[language]}:baseCopy;
    const directory=edition==='domestic'?(language==='ru'?'ru/':'_domestic-locales/'+language+'/'):(language==='en'?'':'_public-locales/'+language+'/');
    const html=await readFile(new URL(directory+(page==='home'?'index':page)+'.html',output),'utf8');
    const label=edition+'/'+language+'/'+page,body=html.split('<body>')[1]?.split('</body>')[0];assert.ok(body,label);
    assert.ok(html.includes('<html lang="'+language+'"'),label+': document language');
    assert.ok(html.includes('rel="canonical" href="https://genesiscalendar.com'+route(language,page,edition)+'"'),label+': canonical');
    for(const alternate of Object.keys(copy))assert.ok(html.includes('hreflang="'+alternate+'" href="https://genesiscalendar.com'+route(alternate,page,edition)+'"'),label+': alternate '+alternate);
    assert.ok(html.includes('hreflang="x-default"'),label+': default locale');
    assert.doesNotMatch(html,/https:\/\/(?:ru|en|de|fr)\.genesiscalendar\.com/,label+': one application origin');
    if(edition==='international'){
      assert.doesNotMatch(body,/nikitalexanderson@gmail\.com|Nikita Aleksandrovich Lyapin|Ляпин|Ляпін|772495179010|GigaChat|ГигаЧат|YooKassa|ЮKassa/i,label+': international commercial edition');
      assert.doesNotMatch(html,/<link\s+rel="alternate"[^>]*href="https:\/\/genesiscalendar\.com\/ru\//,label+': language alternates stay within the international edition');
      assert.doesNotMatch(html,/<meta name="author" content="nikitalexanderson"/,label+': product author metadata');
    }
    for(const text of (page==='home'||page==='login'?[c.creator,c.infrastructure]:[c.creator,c.infrastructure,c.paymentRoles]))assert.ok(body.includes(escape(text)),label+': actual parties');
    for(const name of ['terms','privacy','refund','support'])assert.ok(body.includes('href="'+route(language,name,edition)+'"'),label+': localized '+name);
    if(page==='home'||page==='login') {
      assert.ok(body.includes(escape(pageCopy[language].title)),label+': product title');
      assert.ok(body.includes('Google Calendar')&&body.includes('Google Tasks')&&/AI NCII|АИ НЦИИ/.test(body),label+': product description');
      const pricing=body.match(/<section class="public-section" id="pricing"[\s\S]*?<\/section>/)?.[0];assert.ok(pricing,label+': pricing');
      assert.ok(pricing.includes(edition==='domestic'&&language==='ru'?'RUB':'USD'),label+': regional price currency');
      if(edition==='international')assert.doesNotMatch(pricing,/\bRUB\b|nine-card weekly spread|sacred calendars/i,label+': international pricing');
      for(const alternate of Object.keys(copy))assert.ok(body.includes('lang="'+alternate+'" hreflang="'+alternate+'"'),label+': language '+alternate+' available without JavaScript');
    } else {
      assertPublicDocumentReferences(html,page,language);
      if(page==='terms'&&edition==='international'){
        assert.ok(body.includes(escape(billingLegal[language])),label+': international USD terms');
        assert.doesNotMatch(body,/\bRUB\b|3330|5550|7770|12900|рубл/iu,label+': no obsolete domestic prices');
      }
      assert.ok(body.includes('2026-11-23'),label+': policy revision');
      if(page==='privacy'){
        assert.ok(body.includes('AES-256-GCM'),label+': backup cryptography disclosure');
        assert.ok(body.includes(escape(regionCopy[language].privacy)),label+': IP and device location privacy disclosure');
        for(const text of [retention[language].privacyBody,weather[language].solarBody,weather[language].androidSolarBody,weather[language].weatherBody])assert.ok(body.includes(escape(edition==='domestic'?text:internationalText(language,text))),label+': complete privacy disclosure');
      }
    }
    verified++;
  }
  const sitemap=await readFile(new URL('sitemap.xml',output),'utf8');
  for(const edition of editions)for(const language of Object.keys(copy))for(const page of pages.filter(page=>page!=='login'))assert.ok(sitemap.includes('<loc>https://genesiscalendar.com'+route(language,page,edition)+'</loc>'),'sitemap '+edition+'/'+language+'/'+page);
  console.log('Public locales: '+verified+' HTML variants, 14 languages in both editions, regional pricing, canonical/alternate/sitemap and complete privacy disclosures PASS.');
}
