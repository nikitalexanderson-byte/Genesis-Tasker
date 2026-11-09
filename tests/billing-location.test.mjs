import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFile} from 'node:fs/promises';
import {paymentRegionFromPosition,paymentProviderOrder,preferredPaymentProvider,locatePaymentRegion,grantedDevicePaymentRegion} from '../app/billing-location.ts';
import {billingDisplayPrice,billingCheckoutReady,billingForeignRate,billingMoney} from '../app/billing.ts';
import catalog from '../server/resources/billing-catalog.json' with {type:'json'};
import locationCopy from '../app/billing-location-copy.json' with {type:'json'};
const boundary=JSON.parse(await readFile(new URL('../app/billing-russia-boundary.json',import.meta.url),'utf8')).coordinates;

test('device location only prioritizes methods and preserves manual choices',()=>{
  assert.deepEqual(paymentProviderOrder('RU'),['yookassa','lemon-squeezy','google-play']);
  assert.deepEqual(paymentProviderOrder('outside-RU'),['lemon-squeezy','yookassa','google-play']);
  assert.equal(preferredPaymentProvider('RU',['yookassa','lemon-squeezy'],'lemon-squeezy'),'lemon-squeezy');
  assert.equal(preferredPaymentProvider('outside-RU',['yookassa','lemon-squeezy'],'yookassa'),'yookassa');
  assert.equal(preferredPaymentProvider('RU',['lemon-squeezy']),'lemon-squeezy');
  assert.equal(preferredPaymentProvider('outside-RU',['yookassa']),'yookassa');
});
test('local country geometry handles mainland, Kaliningrad, other countries and uncertainty',()=>{
  for(const [name,lat,lon]of [['Moscow',55.75,37.61],['Yekaterinburg',56.84,60.61],['Yakutsk',62.03,129.73],['Kaliningrad',54.71,20.51]])
    assert.equal(paymentRegionFromPosition(lat,lon,100,boundary),'RU',name);
  for(const [name,lat,lon]of [['London',51.507,-.128],['Tokyo',35.68,139.69],['New York',40.71,-74.01],['Kyiv',50.45,30.52]])
    assert.equal(paymentRegionFromPosition(lat,lon,100,boundary),'outside-RU',name);
  const [lon,lat]=boundary[0][0][0];assert.equal(paymentRegionFromPosition(lat,lon,0,boundary),'unknown');
  for(const args of [[NaN,37,100],[55,Infinity,100],[91,37,100],[55,181,100],[55,37,-1],[55,37,50001]])assert.equal(paymentRegionFromPosition(...args,boundary),'unknown');
  const withHole=[[[[0,0],[10,0],[10,10],[0,10],[0,0]],[[4,4],[6,4],[6,6],[4,6],[4,4]]]];
  assert.equal(paymentRegionFromPosition(5,5,0,withHole),'outside-RU');
  assert.equal(paymentRegionFromPosition(2,2,0,withHole),'RU');
});
test('local location lookup uses low accuracy and reports denied reads',async()=>{
  let calls=0;
  const geo={getCurrentPosition(resolve,_reject,options){calls++;assert.equal(options.enableHighAccuracy,false);resolve({coords:{latitude:55.75,longitude:37.61,accuracy:50}});}};
  assert.equal(calls,0);assert.equal(await locatePaymentRegion(geo),'RU');assert.equal(calls,1);
  await assert.rejects(locatePaymentRegion({getCurrentPosition(_resolve,reject){reject(new Error('permission denied'));}}),/permission denied/);
});

test('automatic routing never requests location without an already granted permission',async()=>{
  let calls=0;const geo={getCurrentPosition(){calls++;throw Error('Unexpected device request');}};
  for(const state of ['prompt','denied'])assert.equal(await grantedDevicePaymentRegion({query:async()=>({state})},geo),null);
  assert.equal(await grantedDevicePaymentRegion(undefined,geo),null);
  assert.equal(await grantedDevicePaymentRegion({query:async()=>({state:'granted'})},undefined),null);
  assert.equal(await grantedDevicePaymentRegion({query:async()=>{throw Error('unsupported permission');}},geo),null);
  assert.equal(calls,0);
});

test('existing location consent refines payment order while uncertainty retains the IP fallback',async()=>{
  const permissions={query:async()=>({state:'granted'})};
  const geo=(latitude,longitude,accuracy=50)=>({getCurrentPosition(resolve){resolve({coords:{latitude,longitude,accuracy}});}});
  assert.equal(await grantedDevicePaymentRegion(permissions,geo(55.75,37.61)),'RU');
  assert.equal(await grantedDevicePaymentRegion(permissions,geo(51.507,-.128)),'outside-RU');
  assert.equal(await grantedDevicePaymentRegion(permissions,geo(55.75,37.61,60000)),null);
  assert.equal(await grantedDevicePaymentRegion(permissions,{getCurrentPosition(_resolve,reject){reject(Error('unavailable'));}}),null);
});

test('canceled location work cannot start a read after permission or apply a late position',async()=>{
  const controller=new AbortController();controller.abort();let calls=0;
  assert.equal(await grantedDevicePaymentRegion({query:async()=>{calls++;return {state:'granted'};}},{getCurrentPosition(){calls++;}},controller.signal),null);
  assert.equal(calls,0);
  const pendingPermission=new AbortController();let allow;
  const permission=grantedDevicePaymentRegion({query:()=>new Promise(resolve=>{allow=resolve;})},{getCurrentPosition(){calls++;}},pendingPermission.signal);
  pendingPermission.abort();allow({state:'granted'});assert.equal(await permission,null);assert.equal(calls,0);
  const pendingPosition=new AbortController();let position;
  const located=grantedDevicePaymentRegion({query:async()=>({state:'granted'})},{getCurrentPosition(resolve){position=resolve;}},pendingPosition.signal);
  await Promise.resolve();pendingPosition.abort();position({coords:{latitude:55.75,longitude:37.61,accuracy:50}});assert.equal(await located,null);
});
const fixedUsdPrices={standart:{1:400,12:4000},premium:{1:700,12:7000},business:{1:1000,12:10000}};
const unchangedRubPrices={standart:{1:33300,12:333000},premium:{1:55500,12:555000},business:{1:77700,12:777000}};
test('fixed USD catalog preserves RUB and offers only approved month/year periods',()=>{
  assert.equal(catalog.foreignPricing.pricingModel,'fixed');
  assert.equal(catalog.foreignPricing.rate,undefined);
  assert.deepEqual(catalog.periodMonths,[1,12]);
  assert.deepEqual(catalog.foreignPricing.prices,fixedUsdPrices);
  assert.deepEqual(catalog.prices,unchangedRubPrices);
  assert.equal(catalog.foreignPricing.lifetimeAmountMinor,16000);
  assert.equal(catalog.lifetimeOffer.amountMinor,1290000);
  assert.equal(catalog.checkoutEnabled,false);assert.equal(catalog.creditCheckoutEnabled,false);
  for(const [plan,prices]of Object.entries(fixedUsdPrices))for(const [period,usd]of Object.entries(prices)){
    assert.deepEqual(billingDisplayPrice(plan,Number(period),null,'lemon-squeezy'),{amountMinor:usd,currency:'USD'});
    for(const provider of ['yookassa','google-play'])assert.deepEqual(billingDisplayPrice(plan,Number(period),null,provider),{amountMinor:unchangedRubPrices[plan][period],currency:'RUB'});
  }
  for(const period of [1,12]){
    assert.deepEqual(billingDisplayPrice('premium4life',period,null,'lemon-squeezy'),{amountMinor:16000,currency:'USD'});
    assert.deepEqual(billingDisplayPrice('premium4life',period,null,'yookassa'),{amountMinor:1290000,currency:'RUB'});
  }
  assert.equal(billingDisplayPrice('premium',6,null,'lemon-squeezy'),null);
});
test('fixed USD offers, quotes and checkout agree exactly without cosmetic rounding',()=>{
  const matrix=[...Object.entries(fixedUsdPrices).flatMap(([plan,prices])=>Object.entries(prices).map(([months,amount])=>[plan,Number(months),amount])),['premium4life',0,16000]];
  for(const [plan,periodMonths,amountMinor]of matrix){
    const offer={id:`${plan}:${periodMonths}`,plan,periodMonths,amountMinor:plan==='premium4life'?1290000:unchangedRubPrices[plan][periodMonths],currency:'RUB',availableProviders:['yookassa','lemon-squeezy'],pricesByProvider:{'lemon-squeezy':{amountMinor,currency:'USD'}}};
    const available={checkoutEnabled:true,offers:[offer],providers:[{id:'yookassa',available:true},{id:'lemon-squeezy',available:true}]};
    const quote={offerId:offer.id,plan,periodMonths,listAmountMinor:amountMinor,creditMinor:0,amountMinor,currency:'USD',provider:'lemon-squeezy',availableProviders:['lemon-squeezy']};
    for(const tab of plan==='premium4life'?[1,12]:[periodMonths])assert.deepEqual(billingDisplayPrice(plan,tab,available,'lemon-squeezy'),{amountMinor,currency:'USD'});
    assert.equal(billingCheckoutReady(available,offer,quote,'lemon-squeezy'),true);
    assert.equal(billingCheckoutReady(available,offer,{...quote,currency:'RUB'},'lemon-squeezy'),false);
    assert.equal(billingCheckoutReady(available,offer,quote,'yookassa'),false);
    for(const wrong of [amountMinor+1,amountMinor+.5,offer.amountMinor])assert.equal(billingCheckoutReady(available,offer,{...quote,amountMinor:wrong,listAmountMinor:wrong},'lemon-squeezy'),false);
  }
  const legacyOffer={id:'standart:1',plan:'standart',periodMonths:1,amountMinor:33300,currency:'RUB',pricesByProvider:{'lemon-squeezy':{amountMinor:413,currency:'USD'}}};
  assert.deepEqual(billingDisplayPrice('standart',1,{offers:[legacyOffer]},'lemon-squeezy'),{amountMinor:413,currency:'USD'});
});
test('localized money retains cents and fixed catalogs never show a stale FX note',()=>{
  for(const language of Object.keys(locationCopy))for(const amount of [400,700,1000,4000,7000,10000,16000]){
    const formatted=billingMoney(amount,language,'USD');
    assert.equal(formatted,new Intl.NumberFormat(language,{style:'currency',currency:'USD',minimumFractionDigits:0,maximumFractionDigits:0}).format(amount/100));
  }
  assert.equal(billingMoney(413,'en','USD'),'$4.13');
  assert.match(billingMoney(413,'ru','USD'),/4,13/);
  assert.match(billingMoney(413,'fr','USD'),/4,13/);
  assert.equal(billingMoney(400,'en','USD'),'$4');
  const rate={quotePerBase:'80.5573',effectiveDate:'2026-10-31'};
  assert.equal(billingForeignRate(null),null);
  assert.equal(billingForeignRate({foreignPricing:{pricingModel:'fixed',rate}}),null);
  assert.equal(billingForeignRate({foreignPricing:{rate}}),rate);
});
test('location and payment copy covers every supported locale',()=>{
  assert.deepEqual(Object.keys(locationCopy).sort(),['ru','en','el','de','fr','es','it','pt','pl','sr','uk','zh','tr','ja'].sort());
  for(const [language,copy]of Object.entries(locationCopy)){assert.deepEqual(Object.keys(copy).sort(),Object.keys(locationCopy.en).sort(),language);for(const value of Object.values(copy))assert.ok(typeof value==='string'&&value.trim());}
});
