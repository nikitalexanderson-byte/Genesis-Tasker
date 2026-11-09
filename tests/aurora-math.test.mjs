import test from 'node:test';
import assert from 'node:assert/strict';
import {calendarModule} from './helpers/calendar-modules.mjs';
const greek=calendarModule('app/aurora/greek.ts');
const registry=calendarModule('app/aurora/registry.ts');
const spread=calendarModule('app/aurora/spread.ts');
const math=calendarModule('app/aurora/potentials.ts');
const graph=calendarModule('app/aurora/graph.ts');
const near=(actual,expected,tolerance=1e-12)=>assert.ok(Math.abs(actual-expected)<tolerance,`${actual} ≠ ${expected}`);
function fixture(orientations,withTrump=true){
  const ids=withTrump?['alpha','beta','delta','epsilon','kappa','zeta','eta','theta','xi']:['alpha','beta','delta','epsilon','rho','zeta','eta','theta','xi'];
  return spread.makePrimarySnapshot({id:'fixture',sourceDay:'2026-11-05',sourceSeed:123,createdAt:'2026-11-05T00:00:00Z',cards:ids.map((cardId,i)=>({cardId,reversed:orientations[i],positionId:registry.SECTOR_IDS[i]}))});
}
test('Aurora registry fixes all fourteen ancient forms and thirteen curators',()=>{
  assert.equal(Object.keys(registry.DEITIES).length,14);assert.equal(registry.CURATOR_IDS.length,13);
  for(const deity of Object.values(registry.DEITIES)){assert.equal(greek.isopsephy(deity.greekDisplayName),deity.sum);assert.equal(greek.normalizeGreek(deity.greekDisplayName),deity.canonicalForm);assert.ok(deity.sourceUrl);}
  assert.equal(registry.DEITIES.kronos.curatorEligible,false);
});
test('Greek normalization rejects lookalikes and supports polytonic iota and explicit archaic signs',()=>{
  for(const value of ['AKMH','ΑKΜΗ','АΚΜΗ','ΑΚМΗ','Α ΚΜΗ','Α🙂'])assert.throws(()=>greek.isopsephy(value));
  const cases={'ΑΚΜΗ':69,'ΚΙΘΙΚ':69,'ΜΙΘΙΜ':109,'ΣΕΡΑΑΡΕΣ':612,'σ':200,'ς':200,'ᾳ':11,'ΣΤ':500,'Ϛ':6,'Ϝ':6,'Ϟ':90,'Ϡ':900,'ΚΡΟΝΟΣ':510,'Χρόνος':1090,'Ἀθήνη':76,'Ἀθηναία':80,'Διώνυσος':1734};
  for(const [value,sum] of Object.entries(cases)){assert.equal(greek.isopsephy(value),sum,value);assert.equal(greek.isopsephy(value.normalize('NFD')),sum,value);}
});
test('Kronos control examples, inverse channels, zero and nonaccumulation',()=>{
  const positive=fixture([false,false,false,false,false,true,true,true,true]);const summary=math.summarizeDraw(positive);
  near(summary.positive,5.981186751752024);near(summary.negative,2.675054410450107);
  const negative=fixture([false,false,false,false,true,true,true,true,true]);
  near(math.summarizeDraw(negative).negative,5.981186751752024);
  const all=fixture([true,true,true,true,false,true,true,true,true]);near(math.summarizeDraw(all).negative,5.350108820900214);
  const onlyTrump=fixture([false,false,false,false,true,false,false,false,false]);
  assert.equal(math.summarizeDraw(onlyTrump).negative,0);assert.equal(JSON.stringify(spread.eligibleSectors(onlyTrump)),JSON.stringify(['center']));
  assert.throws(()=>spread.assertEligibleSector(onlyTrump,'east'));
  const b=summary.base;assert.throws(()=>math.applyKronos(summary.adjusted,'upright'));
  near(math.total(summary.adjusted.values.slice(0,9))*math.total(summary.adjusted.values.slice(9)),16);
  assert.equal(JSON.stringify(math.summarizeDraw(positive)),JSON.stringify(summary));
  near(math.total(b.values),8);
});
test('The source-sector adapter links the two models without relabelling letter cards',()=>{
  const snapshot=fixture(Array(9).fill(false),false),projection=math.semanticProjection(snapshot);
  assert.equal(projection.status,'complete');near(projection.mass,9);
  const apollo=registry.CURATOR_IDS.indexOf('apollo');near(projection.z0[apollo].reduce((a,b)=>a+b,0),1);
  const ares=registry.CURATOR_IDS.indexOf('ares'),aphrodite=registry.CURATOR_IDS.indexOf('aphrodite');
  near(projection.z0[ares][7],0.5);near(projection.z0[aphrodite][7],0.5);
  const changed=JSON.parse(JSON.stringify(snapshot));changed.cards[0].cardId='gamma';
  assert.equal(math.semanticProjection(changed).status,'complete');
  assert.deepEqual(projection.z0,math.semanticProjection(changed).z0);
  changed.cards[0].functions=[{deityId:'zeus',share:1}];
  assert.throws(()=>math.semanticProjection(changed),/UNAPPROVED_PROJECTION/);
  assert.throws(()=>spread.validatePrimarySnapshot({...snapshot,cards:snapshot.cards.slice(1)}));
});
test('Old fourteen-part model stays separate and the new nine-part canon is exact',()=>{
 const {SOURCE_CIRCLE_REFERENCE}=calendarModule('app/aurora/source-model.ts');
 assert.equal(SOURCE_CIRCLE_REFERENCE.length,14);
 const expected={north:'Афина',northeast:'Артемида',east:'Гермес и Пейто',southeast:'Гефест и Аглая',south:'Арес и Афродита',southwest:'Деметра',west:'Посейдон и Амфитрита',northwest:'Аполлон',zenith:'Зевс и Гера',nadir:'Аид и Персефона',hearth:'Гестия',center:'Дионис и Ариадна',entrance:'Эфир и Гемера',exit:'Эрос и Психея'};
 for(const source of SOURCE_CIRCLE_REFERENCE)assert.equal(source.patrons.ru,expected[source.id]);
 assert.notEqual(SOURCE_CIRCLE_REFERENCE.find(s=>s.id==='center').id,SOURCE_CIRCLE_REFERENCE.find(s=>s.id==='hearth').id);
 assert.deepEqual(registry.SECTORS.map(s=>[s.id,[...s.deities]]),[
  ['northwest',['hera','artemis']],['north',['poseidon']],['northeast',['zeus']],['west',['hermes']],
  ['center',['kronos','hestia']],['east',['apollo','athena']],['southwest',['demeter','hephaestus']],['south',['ares']],['southeast',['aphrodite','dionysus']],
 ]);
 const noTrump=fixture(Array(9).fill(false),false);noTrump.cards[0].cardId='omega';
 assert.equal(spread.kronosOrientation(noTrump),'absent');
});
test('Stable graph conserves columns and gives 5/6 and 1/6 for the channel control example',()=>{
  const z=math.zeros(26,9),p=math.zeros(26,26);for(let i=0;i<26;i++)p[i][i]=1;
  z[0][0]=1;p[0][0]=0.75;p[13][0]=0.25;p[0][13]=0.25;p[13][13]=0.75;
  const result=graph.propagate(z,p);near(result.values[0][0],5/6);near(result.values[13][0],1/6);near(result.mass,1);assert.ok(result.errorBound<1e-12);assert.equal(result.iterations,48);
  const identity=math.zeros(26,26);for(let i=0;i<26;i++)identity[i][i]=1;
  assert.equal(JSON.stringify(graph.propagate(z,identity).values),JSON.stringify(z));
});
