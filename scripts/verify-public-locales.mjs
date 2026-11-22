import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertPublicDocumentReferences} from './public-document-references.mjs';

const readJson=async name=>JSON.parse(await readFile(new URL(`../app/${name}.json`,import.meta.url),'utf8'));
const [copy,pageCopy,retention,weather,international]=await Promise.all(['public-product-copy','public-page-copy','account-retention-legal-copy','weather-legal-copy','public-international-copy'].map(readJson));
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pages=['home','login','privacy','terms','refund','support','delete-account'];
const route=(language,page)=>`${language==='ru'?'/ru':''}${page==='home'?'/':`/${page}`}${language==='ru'||language==='en'?'':`?lang=${language}`}`;

/** Independent public contract: named parties, complete authored disclosures,
 * HTTPS/canonical/alternate URLs and every public locale without JavaScript. */
export async function verifyPublicLocales(output) {
  let verified=0;
  for(const [language,c]of Object.entries(copy))for(const page of pages) {
    const directory=language==='en'?'':language==='ru'?'ru/':`_public-locales/${language}/`;
    const html=await readFile(new URL(`${directory}${page==='home'?'index':page}.html`,output),'utf8');
    const label=`${language}/${page}`,body=html.split('<body>')[1]?.split('</body>')[0];assert.ok(body,label);
    assert.ok(html.includes(`<html lang="${language}"`),`${label}: document language`);
    assert.ok(html.includes(`rel="canonical" href="https://genesiscalendar.com${route(language,page)}"`),`${label}: canonical`);
    for(const alternate of Object.keys(copy).filter(code=>code!=='ru'||language==='ru'))assert.ok(html.includes(`hreflang="${alternate}" href="https://genesiscalendar.com${route(alternate,page)}"`),`${label}: alternate ${alternate}`);
    if(language!=='ru'){assert.doesNotMatch(html,/<link\s+rel="alternate"[^>]*hreflang="ru"/,`${label}: separate Russian edition is not advertised in international head`);assert.doesNotMatch(body,/nikitalexanderson@gmail\.com|Nikita Aleksandrovich Lyapin|Ляпин|Ляпін|772495179010|GigaChat|ГигаЧат|YooKassa|ЮKassa/i,`${label}: international commercial edition`);assert.doesNotMatch(html,/<meta name="author" content="nikitalexanderson"/,`${label}: neutral product author metadata`);}
    assert.ok(html.includes('hreflang="x-default"'),`${label}: default locale`);
    assert.doesNotMatch(html,/https:\/\/(?:ru|en|de|fr)\.genesiscalendar\.com/,`${label}: one application origin`);
    for(const text of (page==='home'||page==='login'?[c.creator,c.infrastructure]:[c.creator,c.infrastructure,c.paymentRoles]))assert.ok(body.includes(escape(text)),`${label}: actual parties`);
    for(const name of ['terms','privacy','refund','support'])assert.ok(body.includes(`href="${route(language,name)}"`),`${label}: localized ${name}`);
    if(page==='home'||page==='login') {
      if(language!=='ru')assert.doesNotMatch(body,/YooKassa|ЮKassa|RUB|Russian tax|for Russia|Россия|России|772495179010/i,`${label}: international storefront`);
      assert.ok(body.includes(escape(pageCopy[language].title)),`${label}: product title`);
      assert.ok(body.includes('Google Calendar')&&body.includes('Google Tasks')&&/AI NCII|АИ НЦИИ/.test(body),`${label}: product description`);
    } else {
      assertPublicDocumentReferences(html,page,language);
      assert.ok(body.includes('2026-11-22'),`${label}: policy revision`);
      if(page==='privacy')assert.ok(body.includes('AES-256-GCM'),`${label}: existing backup cryptography disclosure`);
      if(page==='privacy')for(const text of [retention[language].privacyBody,weather[language].solarBody,weather[language].androidSolarBody,weather[language].weatherBody])assert.ok(body.includes(escape(language==='ru'?text:text.replaceAll('nikitalexanderson@gmail.com','demiurge.soft@gmail.com').replaceAll('CloudTips',international[language].paymentProvider).replace('a signed the external payment provider notification','a signed notification from the external payment provider').replace(/(^|[.!?]\s+)the external payment provider/g,(_match,prefix)=>prefix+'The external payment provider'))),`${label}: complete privacy disclosure`);
    }
    verified++;
  }
  const sitemap=await readFile(new URL('sitemap.xml',output),'utf8');
  for(const language of Object.keys(copy))for(const page of pages.filter(page=>page!=='login'))assert.ok(sitemap.includes(`<loc>https://genesiscalendar.com${route(language,page)}</loc>`),`sitemap ${language}/${page}`);
  console.log(`Public locales: ${verified} HTML variants, 14 languages, international operator, separate /ru, canonical/alternate/sitemap and authored privacy disclosures PASS.`);
}
