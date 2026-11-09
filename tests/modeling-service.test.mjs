import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {calendarModule} from './helpers/calendar-modules.mjs';
const api=calendarModule('app/modeling-service.ts');

test('a result checkout accepts only the exact fixed total and the matching payment provider',()=>{
  const order={id:'12345678-1234-4123-8123-123456789abc',resultId:'12345678-1234-4123-8123-123456789abc',service:'future-modeling-result',
    provider:'yookassa',amountMinor:2000000,currency:'RUB',status:'pending',checkoutUrl:'https://yoomoney.ru/checkout/synthetic'};
  assert.deepEqual(api.MODELING_SERVICE_PRICES,{RUB:2000000,USD:20000});
  assert.equal(api.modelingCheckoutUrl(order),order.checkoutUrl);
  for(const change of [{amountMinor:2222},{currency:'USD'},{status:'paid'},{status:'refunded'},{provider:'untrusted'},
    {checkoutUrl:'https://yoomoney.ru.evil.invalid/'},{checkoutUrl:'https://yoomoney.ru@evil.invalid/'},{checkoutUrl:'javascript:alert(1)'},
    {checkoutUrl:'http://yoomoney.ru/'},{checkoutUrl:'https://user:secret@yoomoney.ru/'},{checkoutUrl:'https://yoomoney.ru:444/'}])
    assert.equal(api.modelingCheckoutUrl({...order,...change}),null,JSON.stringify(change));
  const usd={...order,provider:'lemon-squeezy',amountMinor:20000,currency:'USD',checkoutUrl:'https://genesis.lemonsqueezy.com/checkout/synthetic'};
  assert.equal(api.modelingCheckoutUrl(usd),usd.checkoutUrl);
  assert.equal(api.modelingCheckoutUrl({...usd,checkoutUrl:order.checkoutUrl}),null);
  assert.equal(api.modelingAvailableMethod({provider:'lemon-squeezy',amountMinor:20000,currency:'USD',available:true}),true);
  assert.equal(api.modelingAvailableMethod({provider:'lemon-squeezy',amountMinor:2000000,currency:'RUB',available:true}),false);
  assert.equal(api.modelingAvailableMethod({provider:'yookassa',amountMinor:2000000,currency:'RUB',available:false}),false);
});

test('return parameters are only well-formed order references and cannot declare a payment',()=>{
  const id='12345678-1234-4123-8123-123456789abc';
  assert.equal(api.modelingReturnOrderId(`https://genesiscalendar.com/?modelingOrder=${id}&paid=true&amount=1`),id);
  for(const value of ['','paid','../orders','-'.repeat(36),'not-a-url'])
    assert.equal(api.modelingReturnOrderId(`https://genesiscalendar.com/?modelingOrder=${encodeURIComponent(value)}`),null);
});

test('service terms, Elite+ administration and dictation errors have complete copy in every shipped language',()=>{
  for(const file of ['modeling-service-copy','release-319-copy']){
    const data=JSON.parse(readFileSync(new URL(`../app/${file}.json`,import.meta.url),'utf8'));
    const keys=Object.keys(data.ru).sort();
    for(const language of ['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja']){
      assert.deepEqual(Object.keys(data[language]).sort(),keys);
      for(const value of Object.values(data[language])){
        assert.equal(typeof value,'string');assert(value.trim());assert(!/undefined|\[object Object\]|�/.test(value));
        if(!['ru','sr','uk'].includes(language))assert(!/[А-Яа-яЁё]/u.test(value));
      }
    }
  }
});

test('an existing frozen invoice retains its historical amount after the price change',()=>{
 assert.equal(api.modelingCheckoutUrl({id:'old',resultId:'r',service:'future-modeling-result',provider:'yookassa',amountMinor:222200,currency:'RUB',status:'pending',checkoutUrl:'https://yoomoney.ru/checkout/old'}),'https://yoomoney.ru/checkout/old');
 assert.equal(api.modelingAvailableMethod({provider:'yookassa',amountMinor:222200,currency:'RUB',available:true}),false);
});
