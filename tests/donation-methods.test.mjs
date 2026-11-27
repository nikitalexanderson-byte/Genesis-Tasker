import assert from 'node:assert/strict';
import test from 'node:test';
import {verifiedBoostyUrl,readDonationMethods} from '../app/donation-methods.ts';
import copy from '../app/donation-method-copy.json' with {type:'json'};

test('only verified Boosty donation destinations are usable without account data',()=>{
  const url='https://boosty.to/genesiscalendar/donate';
  assert.equal(verifiedBoostyUrl(url),url);
  for(const value of [null,{},'https://boosty.to.evil.invalid/genesiscalendar/donate','http://boosty.to/genesiscalendar/donate','https://owner@boosty.to/genesiscalendar/donate','https://boosty.to:443/genesiscalendar/donate',url+'?email=private@example.invalid',url+'#token',url+'/other','https://boosty.to/app/offer/user','https://boosty.to/../donate'])assert.equal(verifiedBoostyUrl(value),null);
  for(const region of ['RU','outside-RU','unknown']){
    assert.equal(readDonationMethods({schemaVersion:1,region,boosty:{available:true,url}}).boosty.url,url);
    assert.equal(readDonationMethods({schemaVersion:1,region,boosty:{available:false,url:null}}).boosty.url,null);
  }
  for(const boosty of [{available:true,url:null},{available:false,url},{available:'true',url},{available:true,url:url+'?uid=someone'}])assert.throws(()=>readDonationMethods({schemaVersion:1,region:'RU',boosty}));
});

test('donation choices preserve complete localized copy in eighteen languages',()=>{
  assert.equal(Object.keys(copy).length,18);
  for(const [language,text]of Object.entries(copy)){
    assert.deepEqual(Object.keys(text),Object.keys(copy.en),language);
    for(const value of Object.values(text))assert.ok(typeof value==='string'&&value.trim(),language);
    assert.match(text.domestic,/CloudTips/);assert.match(text.international,/Boosty/);
  }
});
