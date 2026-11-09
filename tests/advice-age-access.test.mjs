import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {ADVICE_AGE_POLICY,adviceAlcoholJurisdiction,adviceAlcoholAllowed,advicePsychopompiaAllowed,advicePsychopompiaPreferences,adviceNotificationSafe} from '../app/advice-age-access.ts';
import {advicePreferences,adviceCardVisible,todayAdviceHistory} from '../app/daily-advice.ts';

const card={id:'advice-'+'a'.repeat(24),dayKey:'2026-11-01',body:'Synthetic preserved text',language:'en',categories:['psychopompia'],dismissed:false,sources:[],requiresAdult:true,containsAlcohol:false,psychopompiaPublished:true,subcategories:['inner-work'],review:{status:'cleared'}};
const published={...ADVICE_AGE_POLICY,corpusEnabled:true};
const adult=()=>({...advicePsychopompiaPreferences(),adultConfirmed:true});
const wine=(country,subdivision,age)=>({...adult(),alcohol:{consent:true,countryCode:country,subdivisionCode:subdivision,ageAtLeast:age,policyVersion:ADVICE_AGE_POLICY.policyVersion}});

test('rules are conservative app floors with explicit country/subdivision and unknown fails closed',()=>{
  for(const[country,subdivision,age]of[['RU','',18],['GB','',18],['US','',21],['DE','',18],['JP','',20],['TH','',20],['KR','',19],['CA','CA-QC',18],['CA','CA-ON',19],['IN','IN-DL',25],['ID','ID-BA',21],['AE','AE-DU',21]]){
    assert.deepEqual(adviceAlcoholJurisdiction(country,subdivision),{state:'verified',minimumAge:age});
    assert.equal(adviceAlcoholAllowed(wine(country,subdivision,age)),true);
    assert.equal(adviceAlcoholAllowed(wine(country,subdivision,age===18?19:18)),false);
  }
  for(const[country,subdivision]of[['ZZ',''],['IN','IN-KA'],['CA',''],['ID',''],['AE',''],['RS','']])assert.notEqual(adviceAlcoholJurisdiction(country,subdivision).state,'verified');
  for(const[country,subdivision]of[['KW',''],['IR',''],['SA',''],['IN','IN-BR'],['ID','ID-AC'],['AE','AE-SH']])assert.equal(adviceAlcoholJurisdiction(country,subdivision).state,'blocked');
  assert.equal(adviceAlcoholAllowed(wine('ZZ','',18)),false);
});
test('18+ and wine are separate acknowledgements; no language, DOB or Google inference',()=>{
  const defaults=advicePsychopompiaPreferences();assert.equal(defaults.adultConfirmed,false);assert.equal(defaults.alcohol.consent,false);assert.equal(defaults.alcohol.countryCode,'');
  assert.equal(advicePsychopompiaAllowed(card,adult(),['psychopompia'],published),true);
  assert.equal(advicePsychopompiaAllowed({...card,containsAlcohol:true},adult(),['psychopompia'],published),false);
  assert.equal(advicePsychopompiaAllowed({...card,containsAlcohol:true},wine('US','',21),['psychopompia'],published),true);
  assert.equal(advicePsychopompiaAllowed({...card,containsAlcohol:true},wine('IN','IN-DL',21),['psychopompia'],published),false);
  assert.equal(advicePsychopompiaAllowed(card,{...adult(),alcohol:wine('ZZ','',18).alcohol},['psychopompia'],published),true,'Unknown jurisdiction blocks only alcohol, not nonalcohol18+ content');
  assert.equal(adviceAlcoholAllowed({...wine('US','',21),adultConfirmed:false}),false);
  assert.equal(adviceAlcoholAllowed({...wine('US','',21),alcohol:{...wine('US','',21).alcohol,policyVersion:'2025-01-01'}}),false);
  assert.deepEqual(advicePsychopompiaPreferences({...adult(),adultConfirmed:false}).subcategories,adult().subcategories);
  assert.deepEqual(Object.keys(defaults.alcohol),['consent','countryCode','subdivisionCode','ageAtLeast','policyVersion']);
});
test('unreviewed, blocked, missing metadata, unselected and unreleased content are inaccessible',()=>{
  assert.equal(ADVICE_AGE_POLICY.corpusEnabled,true,'The reviewed first release is enabled');
  assert.equal(advicePsychopompiaAllowed(card,adult(),['psychopompia'],{...published,corpusEnabled:false}),false);
  for(const patch of [{categories:['aretology']},{requiresAdult:false},{containsAlcohol:undefined},{psychopompiaPublished:false},{review:{status:'unreviewed'}},{review:{status:'blocked'}},{subcategories:[]},{subcategories:['unknown']}])assert.equal(advicePsychopompiaAllowed({...card,...patch},adult(),['psychopompia'],published),false);
  assert.equal(advicePsychopompiaAllowed(card,{...adult(),subcategories:[]},['psychopompia'],published),false);
  assert.equal(advicePsychopompiaAllowed(card,adult(),['aretology'],published),false);
  assert.equal(advicePsychopompiaAllowed({...card,subcategories:['muses','inner-work']},{...adult(),subcategories:['muses']},['psychopompia'],published),true);
  const prefs=advicePreferences({aphrodisiaAdult:true});
  assert.equal(adviceCardVisible(card,prefs),false);
  assert.deepEqual(todayAdviceHistory({state:'ready',dayKey:card.dayKey,advice:card,history:[card]},prefs),[]);
});
test('notifications remain adult-free even after both acknowledgements',()=>{
  for(const value of [card,{...card,categories:['aphrodisia'],containsAlcohol:false},{...card,categories:['aretology'],requiresAdult:true},{...card,categories:['aretology'],requiresAdult:false,containsAlcohol:true}])assert.equal(adviceNotificationSafe(value),false);
  assert.equal(adviceNotificationSafe({...card,categories:['aretology'],requiresAdult:false,containsAlcohol:false}),true);
});
test('all14 gate locales contain11 stable subcategory labels and clear unknown/blocked messages',async()=>{
  const copy=JSON.parse(await readFile(new URL('../app/advice-psychopompia-copy.json',import.meta.url),'utf8'));
  const locales='ru en el de fr es it pt pl sr uk zh tr ja'.split(' ');assert.deepEqual(Object.keys(copy).sort(),locales.sort());
  const ids=ADVICE_AGE_POLICY.subcategories.map(row=>row.id).sort();
  for(const row of Object.values(copy)){
    for(const key of ['adult','age','country','region','unknown','blocked','privacy','pending'])assert.ok(row[key]?.trim().length>0,key);
    assert.ok(row.age.includes('{age}'));assert.deepEqual(Object.keys(row.subcategories).sort(),ids);
  }
  for(const row of Object.values(ADVICE_AGE_POLICY.jurisdictions))for(const rule of row.subdivisions?Object.values(row.subdivisions):[row]){
    assert.equal(rule.reviewedAt,'2026-11-01');assert.ok(rule.sourceIds?.length>0);
    assert.ok(rule.sourceIds.every(id=>ADVICE_AGE_POLICY.sources[id]?.url.startsWith('https://')&&ADVICE_AGE_POLICY.sources[id]?.summary));
  }
});
