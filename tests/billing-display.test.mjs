import assert from 'node:assert/strict';
import {test} from 'node:test';
import {BILLING_FALLBACK_POLICY,BILLING_PLANS,billingPlanAllows,billingPlanLimits,billingResourceCapacity,billingDisplayAmount,billingCheckoutReady} from '../app/billing.ts';
import {requestUpgrade,notifyUpgradeError,UPGRADE_REQUEST_EVENT} from '../app/upgrade-events.ts';
import {requireQuotaGrowth} from '../app/feature-access.ts';

test('3.1.5 access matrix keeps letters free and gates timers and each oracle mode independently',()=>{
  const expected={
    'stoicheion':[true,true,true,true,true],
    'stoicheion-letters':[true,true,true,true,true],
    'stoicheion-timeline':[false,true,true,true,true],
    'stoicheion-spread':[false,false,true,true,true],
    'stoicheion-restoration':[false,false,true,true,true],
    'future-modeling':[false,false,true,true,true],
    'habit-timer':[false,true,true,true,true],
    'theokyklos-olympians':[false,true,true,true,true],
  };
  for(const [feature,values] of Object.entries(expected))
    assert.deepEqual(BILLING_PLANS.map(plan=>billingPlanAllows(BILLING_FALLBACK_POLICY,plan,feature)),values,feature);
});

test('lifetime comparison inherits Business limits and ordinary features, with exclusive Physis and no assistant',()=>{
  assert.deepEqual(billingPlanLimits(BILLING_FALLBACK_POLICY,'premium4life'),billingPlanLimits(BILLING_FALLBACK_POLICY,'business'));
  for(const [feature,plans]of Object.entries(BILLING_FALLBACK_POLICY.features))if(plans.includes('business')&&!BILLING_FALLBACK_POLICY.disabledFeatures.includes(feature))assert.equal(billingPlanAllows(BILLING_FALLBACK_POLICY,'premium4life',feature),true,feature);
  for(const plan of BILLING_PLANS){assert.equal(billingPlanAllows(BILLING_FALLBACK_POLICY,plan,'assistant'),false);assert.equal(billingPlanAllows(BILLING_FALLBACK_POLICY,plan,'physis'),plan==='premium4life');}
});

test('Business and lifetime provide 100 independent personal maps, shared maps and shared projects',()=>{
  for(const plan of ['business','premium4life']) {
    const limits=billingPlanLimits(BILLING_FALLBACK_POLICY,plan);
    for(const resource of ['mindmaps','shared-mindmaps','shared-projects'])assert.equal(limits[resource],100,`${plan}: ${resource}`);
  }
  for(const [plan,maps]of [['free',1],['standart',5],['premium',100]]) {
    const limits=billingPlanLimits(BILLING_FALLBACK_POLICY,plan);
    assert.equal(limits.mindmaps,maps);assert.equal(billingPlanAllows(BILLING_FALLBACK_POLICY,plan,'shared-projects'),false);
  }
});

test('file import and export are paid features from Standard through lifetime Elite',()=>{
  assert.deepEqual(BILLING_PLANS.map(plan=>billingPlanAllows(BILLING_FALLBACK_POLICY,plan,'data-export')),[false,true,true,true,true]);
});

test('a shared quota at 100 cannot suggest an unavailable lower plan as extra capacity',()=>{
  for(const resource of ['shared-projects','shared-mindmaps']) {
    assert.deepEqual(BILLING_PLANS.map(plan=>billingResourceCapacity(BILLING_FALLBACK_POLICY,plan,resource)),[0,0,0,100,100]);
    assert.equal(BILLING_PLANS.some(plan=>billingResourceCapacity(BILLING_FALLBACK_POLICY,plan,resource)>100),false);
  }
});

test('public display prices never make an unconfigured checkout ready',()=>{
  assert.equal(billingDisplayAmount('free',1,null),0);
  assert.equal(billingDisplayAmount('premium4life',12,null),1290000);
  for(const [plan,monthly,yearly]of [['standart',33300,333000],['premium',55500,555000],['business',77700,777000]]){assert.equal(billingDisplayAmount(plan,1,null),monthly);assert.equal(billingDisplayAmount(plan,12,null),yearly);}
  for(const plan of BILLING_PLANS)assert.equal(billingPlanAllows(BILLING_FALLBACK_POLICY,plan,'calendar-sync'),true);
  assert.equal(billingCheckoutReady(null,undefined,null,'yookassa'),false);
  const offer={id:'premium:1',plan:'premium',periodMonths:1,currency:'RUB',amountMinor:55500,availableProviders:['yookassa']};
  const quote={offerId:offer.id,plan:offer.plan,periodMonths:1,currency:'RUB',amountMinor:40000,creditMinor:15500,listAmountMinor:55500,availableProviders:['yookassa']};
  const catalog={checkoutEnabled:false,offers:[offer],providers:[{id:'yookassa',available:true}]};
  assert.equal(billingCheckoutReady(catalog,offer,quote,'yookassa'),false);
  assert.equal(billingCheckoutReady({...catalog,checkoutEnabled:true},offer,quote,'yookassa'),true);
  for(const changed of [{offerId:'business:1'},{plan:'business'},{periodMonths:12},{currency:'USD'},{amountMinor:-1},{amountMinor:1.5},{availableProviders:[]},{upgradeUnavailableReason:'shorter-period'}])assert.equal(billingCheckoutReady({...catalog,checkoutEnabled:true},offer,{...quote,...changed},'yookassa'),false,JSON.stringify(changed));
  assert.equal(billingCheckoutReady({...catalog,checkoutEnabled:true,providers:[{id:'yookassa',available:false}]},offer,quote,'yookassa'),false);
});

test('upgrade events explain blocked growth without changing quotas or upselling free Google sync',()=>{
  const previous=globalThis.window;const target=new EventTarget();globalThis.window=target;const events=[];
  target.addEventListener(UPGRADE_REQUEST_EVENT,event=>events.push(event.detail));
  try{
    requestUpgrade({reason:'compare'});notifyUpgradeError('FEATURE_SUBSCRIPTION_REQUIRED','calendar-sync');notifyUpgradeError('FEATURE_SUBSCRIPTION_REQUIRED','assistant');notifyUpgradeError('OTHER_ERROR');
    assert.equal(events.length,1);
    notifyUpgradeError('FEATURE_SUBSCRIPTION_REQUIRED','shared-projects');notifyUpgradeError('SUBSCRIPTION_QUOTA_diary');
    assert.equal(events.at(-2).feature,'shared-projects');assert.equal(events.at(-1).resource,'diary');
    const access={enforcementEnabled:true,effectivePlan:'free',lifetimePremium:false,limits:{habits:5}};
    assert.throws(()=>requireQuotaGrowth(access,'habits',5,6),{code:'SUBSCRIPTION_QUOTA_habits'});
    assert.deepEqual(events.at(-1),{resource:'habits',limit:5,used:5,reason:'quota'});
    const count=events.length;requireQuotaGrowth(access,'habits',6,5);assert.equal(events.length,count);assert.equal(access.limits.habits,5);
  }finally{if(previous===undefined)delete globalThis.window;else globalThis.window=previous;}
});
