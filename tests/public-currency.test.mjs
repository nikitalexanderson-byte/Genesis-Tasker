import { REGION_LANGUAGES } from "../app/region-language.ts";
import assert from 'node:assert/strict';
import {test} from 'node:test';
import {resolvePublicCurrency,publicCurrency} from '../app/public-currency.ts';
import copy from '../app/public-pricing-copy.json' with {type:'json'};

test('manual currency survives contradictory and late automatic signals',()=>{
  for(const manual of ['USD','RUB'])assert.deepEqual(resolvePublicCurrency({manual,deviceRegion:'RU',ipRegion:'outside-RU',locales:['ru-RU'],timeZone:'Europe/Moscow'}),{currency:manual,source:'manual'});
  for(const invalid of ['usd','EUR','',null,{},'__proto__'])assert.equal(publicCurrency(invalid),null);
});
test('consented device region beats VPN IP and language cannot override an IP region',()=>{
  assert.deepEqual(resolvePublicCurrency({deviceRegion:'RU',ipRegion:'outside-RU',locales:['en-US']}),{currency:'RUB',source:'location'});
  assert.deepEqual(resolvePublicCurrency({deviceRegion:'outside-RU',ipRegion:'RU',locales:['ru-RU']}),{currency:'USD',source:'location'});
  assert.deepEqual(resolvePublicCurrency({deviceRegion:'unknown',ipRegion:'outside-RU',locales:['ru-RU'],timeZone:'Europe/Moscow'}),{currency:'USD',source:'ip'});
  assert.deepEqual(resolvePublicCurrency({ipRegion:'RU',locales:['en-US'],timeZone:'America/New_York'}),{currency:'RUB',source:'ip'});
});
test('unknown IP falls back to explicit regional hints before language',()=>{
  for(const timeZone of ['Europe/Moscow','Asia/Yakutsk','Asia/Kamchatka'])assert.equal(resolvePublicCurrency({timeZone,locales:['en-US']}).currency,'RUB');
  assert.equal(resolvePublicCurrency({locales:['ru-KZ'],timeZone:'Asia/Almaty'}).currency,'USD');
  assert.equal(resolvePublicCurrency({locales:['en-RU']}).currency,'RUB');
  assert.equal(resolvePublicCurrency({locales:['ru'],timeZone:'Europe/Berlin'}).currency,'USD');
  assert.equal(resolvePublicCurrency({locales:['ru'],timeZone:'UTC'}).currency,'RUB');
  assert.equal(resolvePublicCurrency({locales:['bad_locale'],language:'en'}).currency,'USD');
  assert.equal(resolvePublicCurrency({}).currency,'USD');
});
test('currency, consent and unavailable USD checkout explanations cover all supported languages',()=>{
  assert.deepEqual(Object.keys(copy).sort(),[...REGION_LANGUAGES].sort());
  for(const [language,strings]of Object.entries(copy)){
    assert.deepEqual(Object.keys(strings).sort(),Object.keys(copy.en).sort(),language);
    for(const text of Object.values(strings))assert.ok(typeof text==='string'&&text.trim(),language);
    assert.match(strings.usdPending,/USD|美元/);
  }
});
