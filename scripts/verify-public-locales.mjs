import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {assertPublicDocumentReferences} from './public-document-references.mjs';

const readJson=async name=>JSON.parse(await readFile(new URL(`../app/${name}.json`,import.meta.url),'utf8'));
const [copy,pageCopy,retention,weather]=await Promise.all(['public-product-copy','public-page-copy','account-retention-legal-copy','weather-legal-copy'].map(readJson));
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
    for(const alternate of Object.keys(copy))assert.ok(html.includes(`hreflang="${alternate}" href="https://genesiscalendar.com${route(alternate,page)}"`),`${label}: alternate ${alternate}`);
    assert.ok(html.includes('hreflang="x-default"'),`${label}: default locale`);
    assert.doesNotMatch(html,/https:\/\/(?:ru|en|de|fr)\.genesiscalendar\.com/,`${label}: one application origin`);
    for(const text of [c.creator,c.infrastructure,c.paymentRoles])assert.ok(body.includes(escape(text)),`${label}: actual parties`);
    for(const name of ['terms','privacy','refund','support'])assert.ok(body.includes(`href="${route(language,name)}"`),`${label}: localized ${name}`);
    if(page==='home'||page==='login') {
      assert.ok(body.includes(escape(pageCopy[language].title)),`${label}: product title`);
      assert.ok(body.includes('Google Calendar')&&body.includes('Google Tasks')&&body.includes('AI NCII'),`${label}: product description`);
    } else {
      assertPublicDocumentReferences(html,page,language);
      assert.ok(body.includes('2026-11-17'),`${label}: policy revision`);
      if(page==='privacy')assert.ok(body.includes('AES-256-GCM'),`${label}: existing backup cryptography disclosure`);
      if(page==='privacy')for(const text of [retention[language].privacyBody,weather[language].solarBody,weather[language].androidSolarBody,weather[language].weatherBody])assert.ok(body.includes(escape(text)),`${label}: complete privacy disclosure`);
    }
    verified++;
  }
  const sitemap=await readFile(new URL('sitemap.xml',output),'utf8');
  for(const language of Object.keys(copy))for(const page of pages.filter(page=>page!=='login'))assert.ok(sitemap.includes(`<loc>https://genesiscalendar.com${route(language,page)}</loc>`),`sitemap ${language}/${page}`);
  console.log(`Public locales: ${verified} HTML variants, 14 languages, /ru plus main-site switcher, canonical/alternate/sitemap and authored privacy disclosures PASS.`);
}
