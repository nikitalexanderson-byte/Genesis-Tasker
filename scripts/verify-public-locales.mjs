import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertPublicDocumentReferences} from './public-document-references.mjs';

const readJson=async name=>JSON.parse(await readFile(new URL('../app/'+name+'.json',import.meta.url),'utf8'));
const [copy,domestic,pageCopy,retention,weather,regionCopy,availability,paddle]=await Promise.all(['public-product-copy','public-domestic-service-copy','public-page-copy','account-retention-legal-copy','weather-legal-copy','website-region-copy','service-availability-copy','paddle-legal-copy'].map(readJson));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages=['home','login','privacy','terms','refund','support','delete-account'];
const route=(language,page)=>(page==='home'?'/':'/'+page)+(language==='en'?'':'?lang='+language);

/** Independent document contract: edition and language vary independently;
 * complete authored disclosures and working local navigation remain required. */
export async function verifyPublicLocales(output) {
  let verified=0;
  for(const [language,baseCopy]of Object.entries(copy))for(const page of pages) {
    const c={...baseCopy,...domestic[language]};
    const directory=language==='en'?'':'_public-locales/'+language+'/';
    const html=await readFile(new URL(directory+(page==='home'?'index':page)+'.html',output),'utf8');
    const label=language+'/'+page,body=html.split('<body>')[1]?.split('</body>')[0];assert.ok(body,label);
    assert.ok(html.includes('<html lang="'+language+'"'),label+': document language');
    assert.ok(html.includes('rel="canonical" href="https://genesiscalendar.com'+route(language,page)+'"'),label+': canonical');
    for(const alternate of Object.keys(copy))assert.ok(html.includes('hreflang="'+alternate+'" href="https://genesiscalendar.com'+route(alternate,page)+'"'),label+': alternate '+alternate);
    assert.ok(html.includes('hreflang="x-default"'),label+': default locale');
    assert.doesNotMatch(html,/https:\/\/(?:ru|en|de|fr)\.genesiscalendar\.com/,label+': one application origin');
    if (['terms','privacy','refund'].includes(page)) {
      assert.ok(paddle[language]&&body.includes(escape(paddle[language])),label+': conditional Paddle disclosure');
    }
    assert.doesNotMatch(html,/(?:href|content)="(?:https:\/\/genesiscalendar\.com)?\/ru(?:\/|[?"#])/,label+': one website');
    for(const text of (page==='home'||page==='login'?[c.creator,c.infrastructure]:[c.creator,c.infrastructure,c.paymentRoles]))assert.ok(body.includes(escape(text)),label+': actual parties');
    for(const name of ['terms','privacy','refund','support'])assert.ok(body.includes('href="'+route(language,name)+'"'),label+': localized '+name);
    if(page==='home'||page==='login') {
      const footer=body.match(/<footer class="welcome-footer public-footer">[\s\S]*?<\/footer>/)?.[0];
      assert.ok(footer?.includes(escape(c.merchant))&&footer.includes('772495179010'),label+': performer and tax ID in the visible footer');
      assert.ok(footer.includes('href="'+route(language,'home')+'#pricing"'),label+': current pricing linked from the footer');
      assert.ok(body.includes(escape(pageCopy[language].title)),label+': product title');
      assert.ok(body.includes('Google Calendar')&&body.includes('Google Tasks')&&/AI NCII|АИ НЦИИ/.test(body),label+': product description');
      const pricing=body.match(/<section class="public-section" id="pricing"[\s\S]*?<\/section>/)?.[0];assert.ok(pricing,label+': pricing');
      assert.ok(pricing.includes(language==='ru'?'RUB':'USD'),label+': regional price currency');
      for(const alternate of Object.keys(copy))assert.ok(body.includes('lang="'+alternate+'" hreflang="'+alternate+'"'),label+': language '+alternate+' available without JavaScript');
    } else {
      assertPublicDocumentReferences(html,page,language);
      if(['terms','support','refund'].includes(page))assert.ok(body.includes(escape(availability[language].body)),label+': truthful service availability');
      assert.ok(body.includes('2026-11-24'),label+': policy revision');
      if(page==='privacy'){
        assert.ok(body.includes('AES-256-GCM'),label+': backup cryptography disclosure');
        assert.ok(body.includes(escape(regionCopy[language].privacy)),label+': IP and device location privacy disclosure');
        for(const text of [retention[language].privacyBody,weather[language].solarBody,weather[language].androidSolarBody,weather[language].weatherBody])assert.ok(body.includes(escape(text)),label+': complete privacy disclosure');
      }
    }
    verified++;
  }
  const sitemap=await readFile(new URL('sitemap.xml',output),'utf8');
  for(const language of Object.keys(copy))for(const page of pages.filter(page=>page!=='login'))assert.ok(sitemap.includes('<loc>https://genesiscalendar.com'+route(language,page)+'</loc>'),'sitemap '+language+'/'+page);
  console.log('Public locales: '+verified+' HTML variants, 14 languages on one website, pricing, canonical/alternate/sitemap and complete privacy disclosures PASS.');
}
