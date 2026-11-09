import assert from 'node:assert/strict';
import test from 'node:test';
import { foodTypeCategories, foodResearchCategories, foodMacrosPer100g } from '../app/physis/food-catalog-domain.ts';
import { readFileSync } from 'node:fs';

test('food type filters exclude health tags and normalize legacy categories', () => {
  const entry={food:{category:'Орехи'},reference:{id:'example',family:'Орехи и семена',tags:['Сердце и сосуды','Обмен веществ','Суперфуды']}};
  assert.deepEqual(foodTypeCategories(entry),['Орехи и семена']);
  assert.deepEqual(foodResearchCategories(entry),['Сердце и сосуды','Обмен веществ']);
  assert.deepEqual(foodTypeCategories({food:{category:'Суперфуды'},reference:{id:'PHY-1195',family:'Суперфуды',tags:['Обмен веществ']}}),['Кулинарные ингредиенты']);
  assert.deepEqual(foodTypeCategories({food:{category:'Сердце и сосуды'}}),['Другое']);
});

test('food cards convert per-volume nutrition only with known density and preserve zero and unknown', () => {
  const food={basis:'100ml',densityGPerMl:1.25,nutrients:{energy:{value:100,basis:'100ml'},protein:{value:0,basis:'100ml'},fat:{value:null,basis:'100ml'},carbohydrate:{value:10,basis:'100g'}}};
  assert.deepEqual(foodMacrosPer100g(food),{values:[80,0,null,10],needsDensity:false});
  assert.deepEqual(foodMacrosPer100g({...food,densityGPerMl:null}),{values:[null,null,null,10],needsDensity:true});
  assert.deepEqual(foodMacrosPer100g({...food,densityGPerMl:0}).values,[null,null,null,10]);
});
import {
  blankFood, nutrient, baseAmount, itemNutrients, totalNutrients, snapshotItem, copyMeal,
  recipeFood, foodWarnings, resolveTargets, startingNutritionTargets, estimateEnergy, energyDifference, summaryForDay,
  importUsdaFood, validateNutritionRecord, suggestPortion, compareNutrientReference, NUTRIENT_REFERENCES,
} from '../app/physis/nutrition-domain.ts';
import { calendarModule } from './helpers/calendar-modules.mjs';
import { newPhysisRecord } from '../app/physis/types.ts';
import { defaultNutritionProfile } from '../app/physis/personal-profile-domain.ts';

test('reviewed catalog imports exactly the approved main-sheet entries with Russian names',()=>{
  const seed=calendarModule('app/physis/reference-catalog-seed.ts').default;
  assert.equal(seed.length,1163);assert.equal(new Set(seed.map(row=>row.id)).size,1163);
  assert.equal(seed.filter(row=>row.kind==='food').length,274);
  assert.equal(seed.filter(row=>row.kind==='supplement').length,889);
  assert.equal(seed.filter(row=>row.restricted).length,215);
  for(const row of seed){
    assert.match(row.nameRu,/[А-Яа-яЁё]/);assert.ok(row.description&&row.evidence&&row.risks);
    assert.ok(row.sources.length);for(const url of row.sources)assert.match(new URL(url).protocol,/^https?:$/);
    assert.ok(!['PHY-0248','PHY-0249','PHY-0250','PHY-0252','PHY-1109'].includes(row.id));
    assert.doesNotMatch([row.nameRu,row.nameEn].join(' '),/omega.?3|омега.?3|mucuna|мукун|5.?htp|5.?гидрокситриптофан|ретатрутид|семаглутид|остарин/i);
  }
  const kola=seed.find(row=>row.nameEn==='Cola Nut');assert.equal(kola.kind,'supplement');
  const apricot=seed.find(row=>row.id==='PHY-1196');assert.equal(apricot.family,'Суперфуды');assert.equal(apricot.restricted,true);assert.match(apricot.risks,/цианид/);
  assert.equal(seed.find(row=>row.id==='PHY-0498').kind,'supplement');
  assert.equal(seed.find(row=>row.id==='PHY-0596').kind,'supplement');
});

test('shared catalog preserves detailed references and supports any/all category matching',()=>{
  const {CATALOG_SEED,matchesCatalog,catalogCategories,identityKey,mergeCatalog,catalogFoodId}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entries=mergeCatalog([]),magnesium=entries.find(row=>row.legacyId==='magnesium');
  assert.ok(magnesium.sources.some(url=>url.includes('ods.od.nih.gov')));
  assert.ok(matchesCatalog(magnesium,'магний',['Минералы и электролиты','Несуществующая'],'any'));
  assert.equal(matchesCatalog(magnesium,'магний',['Минералы и электролиты','Несуществующая'],'all'),false);
  assert.ok(matchesCatalog(magnesium,'MAGNESIUM',catalogCategories(magnesium).slice(0,2),'all'));
  assert.notEqual(identityKey('Магний (цитрат)'),identityKey('Магний (оксид)'));
  const legacy=calendarModule('app/physis/supplement-reference-data.ts').SUPPLEMENT_REFERENCES;
  for(const row of legacy)assert.equal(CATALOG_SEED.filter(item=>item.legacyId===row.id).length,1,row.id);
  const ids=CATALOG_SEED.map(row=>catalogFoodId(row.id));assert.equal(new Set(ids).size,ids.length);
  for(const id of ids)assert.match(id,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('substance search finds card text and aliases independently of category headings',()=>{
  const {mergeCatalog,matchesCatalog,catalogCategories}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entries=mergeCatalog([]),magnesium=entries.find(row=>row.legacyId==='magnesium');
  assert.ok(magnesium);
  assert.ok(matchesCatalog(magnesium,'MAGNESIUM',[]));
  for(const field of ['uses','evidence','scopeNote','risks','status','mechanism','contraindications','interactions']) {
    const card={...magnesium,[field]:'Особая проверка совместимости: жёлтый маркер'};
    assert.ok(matchesCatalog(card,'ЖЕЛТЫЙ совместимости',[]),field);
    assert.equal(matchesCatalog(card,'жёлтый отсутствует',[]),false,field);
    assert.equal(matchesCatalog(card,'жёлтый',['Несуществующая категория']),false,field);
  }
  const revised={...magnesium,interactions:'Уникальное взаимодействие'};
  assert.ok(matchesCatalog(revised,'уникальное взаимодействие',catalogCategories(magnesium),'all'));
  assert.equal(matchesCatalog({...revised,interactions:''},'уникальное взаимодействие',[]),false);
});

test('substance search includes the displayed mineral, terminology and food sections in both languages',()=>{
  const {mergeCatalog,matchesCatalog}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entries=mergeCatalog([]);
  const magnesium=entries.find(row=>row.legacyId==='magnesium');
  const calcium=entries.find(row=>row.legacyId==='calcium');
  const carnitine=entries.find(row=>row.legacyId==='carnitine');
  for(const query of ['ХЕЛАТ','chelate']) assert.ok(matchesCatalog(magnesium,query,[]),query);
  for(const query of ['йогурт цельномолочный','YOGURT whole milk']) assert.ok(matchesCatalog(calcium,query,[]),query);
  for(const query of ['авокадо','Avocado','42–122']) assert.ok(matchesCatalog(carnitine,query,[]),query);
  assert.equal(matchesCatalog({...magnesium,legacyId:''},'chelate',[]),false);
  assert.equal(matchesCatalog({...magnesium,legacyId:'missing-section'},'chelate',[]),false);
});

test('shared entries stay valid when copied into bounded personal food and supplement records',()=>{
  const {CATALOG_SEED,catalogDrug,catalogFood}=calendarModule('app/physis/reference-catalog-domain.ts');
  const {validDrug}=calendarModule('app/physis/care-domain.ts');
  for(const entry of CATALOG_SEED)for(const language of ['ru','en']){
    if(entry.kind==='food')assert.ok(validateNutritionRecord(newPhysisRecord('food',catalogFood(entry,language))),entry.id);
    else assert.ok(validDrug(catalogDrug(entry,language)),entry.id);
  }
  const full={...CATALOG_SEED[0],nameRu:'я'.repeat(240),nameEn:'x'.repeat(500),family:'я'.repeat(80),tags:['я'.repeat(80)],
    risks:'Риск: '+ 'я'.repeat(9994),scopeNote:'я'.repeat(5000),description:'я'.repeat(10000),evidence:'я'.repeat(10000),
    sources:Array.from({length:16},(_,i)=>'https://example.org/'+i+'?q='+'a'.repeat(1970))};
  for(const language of ['ru','en']){
    const drug=catalogDrug(full,language);assert.ok(validDrug(drug));assert.equal(drug.notes,full.risks);
    assert.ok(drug.source.split('\n').every(url=>full.sources.includes(url)));
  }
  assert.equal(full.nameEn.length,500);assert.equal(full.description.length,10000);
});

test('research covers every substance with scoped evidence and valid sources after legacy merges',()=>{
  const {CATALOG_SEED}=calendarModule('app/physis/reference-catalog-domain.ts');
  const {SUBSTANCE_RESEARCH}=calendarModule('app/physis/substance-research.ts');
  const substances=CATALOG_SEED.filter(entry=>entry.kind!=='food');
  assert.equal(substances.length,1108);
  assert.equal(substances.filter(entry=>entry.kind==='medicine').length,208);
  assert.deepEqual(Object.keys(SUBSTANCE_RESEARCH).sort(),substances.map(entry=>entry.id).sort());
  for(const entry of substances){
    for(const field of ['description','mechanism','evidence','risks','contraindications','interactions']){
      assert.ok(entry[field]?.trim(),`${entry.id}: ${field}`);
      assert.doesNotMatch(entry[field],/^@(?:pregnancy|unknown|investigational)$/);
    }
    assert.equal(entry.description,entry.mechanism,entry.id);
    assert.equal(entry.uses,'',entry.id); // Do not restore inferred indications from the imported sheet.
    assert.equal(entry.reviewedAt,'2026-11-02',entry.id);
    assert.ok(entry.sources.length>0&&entry.sources.length<=16,entry.id);
    assert.equal(entry.sources.length,new Set(entry.sources).size,entry.id);
    for(const url of entry.sources)assert.match(new URL(url).protocol,/^https?:$/);
    assert.doesNotMatch([entry.nameRu,entry.nameEn].join(' '),/omega.?3|омега.?3|mucuna|мукун|5.?htp|5.?гидрокситриптофан/i);
  }
  const niacin=substances.find(entry=>entry.legacyId==='niacin');
  assert.equal(niacin.evidence,SUBSTANCE_RESEARCH[niacin.id].evidence);
  assert.ok(niacin.sources.some(url=>url.includes('ods.od.nih.gov')));
  assert.ok(niacin.sources.some(url=>url.includes('rxlist.com')));
  assert.ok(substances.find(entry=>entry.id==='PHY-1121').restricted);
  for(const id of ['PHY-0553','PHY-0577','PHY-0753','PHY-1112','PHY-1188'])assert.ok(substances.find(entry=>entry.id===id).hidden,id);
});

test('administrator research edits and source choices override the complete seed without mutating it',()=>{
  const {CATALOG_SEED,mergeCatalog,catalogItem}=calendarModule('app/physis/reference-catalog-domain.ts');
  const original=CATALOG_SEED.find(entry=>entry.id==='PHY-0171');
  const edited={...structuredClone(original),description:'Редакция администратора',mechanism:'Уточнённый механизм',
    evidence:'Уточнённые данные',risks:'Уточнённые ограничения',contraindications:'Уточнённые группы',interactions:'Уточнённые сочетания',
    sources:['https://ods.od.nih.gov/factsheets/VitaminD-HealthProfessional/'],reviewedAt:'2026-11-03',tags:['Новая категория'],hidden:true};
  const merged=mergeCatalog([{id:edited.id,entry:edited,revision:7,updatedAt:'2026-11-03T00:00:00Z'}]);
  const actual=merged.find(entry=>entry.id===edited.id);
  assert.equal(actual.revision,7);assert.deepEqual(catalogItem(actual),{...edited,composition:undefined});
  assert.equal(original.reviewedAt,'2026-11-02');assert.equal(original.hidden,false);
  assert.notEqual(original.mechanism,edited.mechanism);
  assert.deepEqual(catalogItem(mergeCatalog([]).find(entry=>entry.id===original.id)),original);
});

test('shared food edits keep label nutrients and personal snapshots while allowing hide and move',()=>{
  const {mergeCatalog,catalogFood,combineCatalogFoods}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entries=mergeCatalog([]),reference=entries.find(row=>row.id==='PHY-1196');
  const unknown=catalogFood(reference,'ru');assert.equal(unknown.compositionKnown,false);
  for(const value of Object.values(unknown.nutrients))assert.equal(value.value,null);
  assert.ok(validateNutritionRecord(newPhysisRecord('food',unknown)));
  const {manualReferenceFoods}=calendarModule('app/physis/food-reference-domain.ts');
  const label=manualReferenceFoods('ru').find(row=>row.food.provenance.id==='reference:apricot-kernels');
  const base={...label,record:{...newPhysisRecord('food',label.food),id:label.id}};
  const renamed={...reference,nameRu:'Ядра абрикоса — новая редакция',aliases:[],revision:1};
  const changed=entries.map(row=>row.id===reference.id?renamed:row);
  const visible=combineCatalogFoods([], [base], changed,'ru');
  const attached=visible.find(row=>row.id===base.id);
  assert.equal(attached.food.name,renamed.nameRu);
  assert.deepEqual(attached.food.nutrients,base.food.nutrients);
  assert.equal(visible.filter(row=>row.reference?.id===reference.id).length,1);
  for(const change of [{hidden:true},{kind:'supplement'}]){
    const next=changed.map(row=>row.id===reference.id?{...row,...change}:row);
    assert.equal(combineCatalogFoods([],[base],next,'ru').some(row=>row.id===base.id),false);
    assert.deepEqual(combineCatalogFoods([base],[],next,'ru').find(row=>row.id===base.id).food,base.food);
  }
  const countBefore=JSON.stringify(entries);
  combineCatalogFoods([], [base], changed,'ru');assert.equal(JSON.stringify(entries),countBefore);
});

test('custom food rules match whole normalized phrases without changing recorded food', () => {
  const original = food('Мёд натуральный');
  original.ingredients = 'Мёд, глюкозный сироп';
  const snapshot = structuredClone(original);
  const rule = { id: 'custom-honey', name: 'Мой выбор', terms: ['МЕД', 'глюкозный сироп'], text: 'Обратить внимание на состав', enabled: true, reviewedAt: '2026-11-01' };
  const notices = foodWarnings(original, [], 'ru', [rule]);
  assert.equal(notices.filter(value => value.type === 'personal').length, 1);
  assert.match(notices[0].text, /Мой выбор/);
  assert.deepEqual(original, snapshot);
  assert.equal(foodWarnings(food('Медальон'), [], 'ru', [rule]).some(value => value.type === 'personal'), false);
  assert.equal(foodWarnings(original, [], 'ru', [{ ...rule, enabled: false }]).some(value => value.type === 'personal'), false);
});

test('custom food rules survive nutrition-profile validation and old profiles stay valid', () => {
  const profile = defaultNutritionProfile();
  const record = newPhysisRecord('nutrition-profile', profile);
  assert.equal(validateNutritionRecord(record), true);
  const rule = { id: 'custom-one', name: 'My rule', terms: ['sugar'], text: 'Review the portion', enabled: true, reviewedAt: '2026-11-01' };
  const next = { ...record, data: { ...profile, customFoodRules: [rule] } };
  assert.equal(validateNutritionRecord(next), true);
  assert.equal(validateNutritionRecord({ ...next, data: { ...next.data, customFoodRules: [rule, rule] } }), false);
  for (const terms of [[], [''], ['x'.repeat(81)], Array(21).fill('term')]) {
    assert.equal(validateNutritionRecord({ ...next, data: { ...next.data, customFoodRules: [{ ...rule, terms }] } }), false);
  }
  assert.equal(validateNutritionRecord({ ...next, data: { ...next.data, customFoodRules: [{ ...rule, name: '' }] } }), false);
});

test('nutrition enrichment preserves state, provenance, known zero, trace and unknown',()=>{
  const {FOOD_COMPOSITIONS,applyFoodComposition}=calendarModule('app/physis/food-composition-domain.ts');
  const source=FOOD_COMPOSITIONS['protein-collagen'];
  const enriched=applyFoodComposition(blankFood(),source);
  assert.equal(enriched.state,'dry');assert.equal(enriched.nutrients.protein.value,90);
  assert.equal(enriched.nutrients.fat.value,null);assert.equal(enriched.nutrients.carbohydrate.quality,'unknown');
  assert.equal(enriched.provenance.provider,'label');assert.equal(enriched.nutrients.protein.source,source.source);
  const traced=applyFoodComposition(blankFood(),{...source,values:{protein:0},estimated:[],trace:['fat']});
  assert.equal(traced.nutrients.protein.quality,'zero');assert.equal(traced.nutrients.fat.quality,'trace');assert.equal(traced.nutrients.fat.value,null);
  for(const [id,profile] of Object.entries(FOOD_COMPOSITIONS))assert.ok(validateNutritionRecord(newPhysisRecord('food',{...applyFoodComposition(blankFood(),profile),name:id})),id);
});

test('catalog policy excludes legumes and seed oils while keeping cocoa, coffee and history',()=>{
  const {excludedCatalogFood}=calendarModule('app/physis/food-composition-domain.ts');
  for(const name of ['Чечевица варёная','Соевый протеин','Гороховый изолят','Подсолнечное масло','Масло из семян винограда','Kidney beans','Арахис'])assert.equal(excludedCatalogFood(food(name)),true,name);
  for(const name of ['Какао-бобы','Бобы какао','Coffee beans','Vanilla beans','Масло оливковое','Яичный протеин','Говяжий протеин — изолят','Орех кола'])assert.equal(excludedCatalogFood(food(name)),false,name);
  const historical=snapshotItem('old-lentils',food('Чечевица варёная'),80,'g');
  const copy=structuredClone(historical);excludedCatalogFood(food('Чечевица варёная'));assert.deepEqual(historical,copy);
});

test('admin can independently edit old raw and cooked foods without duplicates',()=>{
  const {combineCatalogFoods,mergeCatalog,catalogFoodId}=calendarModule('app/physis/reference-catalog-domain.ts');
  const entries=mergeCatalog([]),original=entries.find(x=>x.kind==='food'&&x.composition);
  const make=(state,id)=>{const value={...food(original.nameRu),state};return {id,food:value,record:{...newPhysisRecord('food',value),id}};};
  const raw=make('raw','11111111-1111-4111-8111-111111111111'),cooked=make('cooked','22222222-2222-4222-8222-222222222222');
  const before=combineCatalogFoods([],[raw,cooked],entries,'ru');
  const ref=before.find(x=>x.id===raw.id).reference;
  assert.equal(ref.id,'food-'+raw.id);assert.equal(catalogFoodId(ref.id),raw.id);
  const changed={...ref,nameRu:'Редакция сырого продукта',revision:1,composition:{...ref.composition,values:{energy:42}}};
  const after=combineCatalogFoods([],[raw,cooked],[...entries,changed],'ru');
  assert.equal(after.filter(x=>x.id===raw.id).length,1);assert.equal(after.find(x=>x.id===raw.id).food.nutrients.energy.value,42);
  assert.equal(after.find(x=>x.id===cooked.id).food.state,'cooked');assert.equal(after.find(x=>x.id===cooked.id).food.nutrients.energy.value,120);
  assert.equal(combineCatalogFoods([],[raw,cooked],[...entries,{...changed,hidden:true}],'ru').some(x=>x.id===raw.id),false);
  assert.deepEqual(combineCatalogFoods([raw],[],[...entries,changed],'ru').find(x=>x.id===raw.id).food,raw.food);
});

test('pharmacology is complete and separate; dietary proteins belong to foods',()=>{
  const {CATALOG_SEED,catalogDrug,catalogFood}=calendarModule('app/physis/reference-catalog-domain.ts');
  const pharma=CATALOG_SEED.filter(x=>x.kind==='medicine');assert.equal(pharma.length,208);
  assert.equal(new Set(pharma.map(x=>x.family)).size,25);assert.ok(pharma.every(x=>x.id.startsWith('pharma-')&&x.status&&x.sources.length));
  assert.ok(pharma.some(x=>/Семаглутид/.test(x.nameRu)));assert.ok(pharma.some(x=>/Ретатрутид/.test(x.nameRu)));
  assert.equal(catalogDrug(pharma[0],'ru').category,'medicine');
  for(const name of ['Сывороточный протеин — концентрат','Сывороточный протеин — изолят','Сывороточный протеин — гидролизат','Казеин — мицеллярный','Казеин — гидролизат','Яичный протеин','Говяжий протеин — изолят','Коллаген пищевой — гидролизат','Желатин']){
    const item=CATALOG_SEED.find(x=>x.nameRu===name);assert.equal(item?.kind,'food',name);assert.equal(item.family,'Протеины');
    if(/Коллаген пищевой|Желатин/.test(name))assert.ok(catalogFood(item,'ru').collections.includes('superfoods'));
  }
});

function food(name = 'Label food', nutrients = { energy: 120, protein: 10, fat: 4, carbohydrate: 11 }) {
  return { ...blankFood(), name, compositionKnown: true, nutrients: Object.fromEntries(Object.entries(nutrients).map(([key, value]) => [key, nutrient(value, key, '100g', 'Label', '2026-10')])) };
}
function meal(items, status = 'actual') {
  return { date: '2026-10-24', time: '12:00', timeZone: 'Europe/Moscow', name: 'Lunch', status, items, note: '' };
}

test('known zero, unknown and trace remain distinct in totals', () => {
  const first = food('Known', { energy: 100, protein: 0, fiber: 2 });
  const second = food('Unknown', { energy: 200, protein: null });
  second.nutrients.fiber = nutrient(null, 'fiber', '100g', 'Label', '1', 'trace');
  const totals = totalNutrients([snapshotItem('a', first, 100, 'g'), snapshotItem('b', second, 50, 'g')]);
  assert.equal(totals.energy.value, 200);
  assert.equal(totals.protein.value, null);
  assert.equal(totals.protein.knownValue, 0);
  assert.equal(totals.protein.knownItems, 1);
  assert.equal(totals.fiber.value, null);
  assert.equal(totals.fiber.knownValue, 2);
  assert.equal(first.nutrients.protein.quality, 'zero');
  assert.equal(second.nutrients.protein.quality, 'unknown');
  assert.equal(second.nutrients.fiber.quality, 'trace');
});

test('liquid conversion requires explicit density and portions use their own basis', () => {
  const oil = food('Oil', { energy: 900, fat: 100 });
  assert.throws(() => baseAmount(oil, 10, 'ml'), /плотность/);
  oil.densityGPerMl = .92;
  assert.ok(Math.abs(baseAmount(oil, 10, 'ml') - 9.2) < 1e-9);
  oil.servingAmount = 15;
  assert.equal(baseAmount(oil, 2, 'serving'), 30);
  const liquid = { ...food(), basis: '100ml', densityGPerMl: 1.2 };
  assert.equal(baseAmount(liquid, 120, 'g'), 100);
  assert.throws(() => baseAmount(oil, 0, 'g'));
  assert.throws(() => baseAmount(oil, Infinity, 'g'));
});

test('meal snapshot and history are unaffected by catalog changes; copy remains a plan', () => {
  const original = food();
  const item = snapshotItem('food-id', original, 150, 'g');
  const originalMeal = meal([item]);
  original.name = 'Renamed'; original.nutrients.protein.value = 999;
  assert.equal(item.food.name, 'Label food');
  assert.equal(itemNutrients(item).protein.value, 15);
  const copied = copyMeal(originalMeal, '2027-01-01', 'original-meal');
  assert.equal(copied.status, 'planned');
  assert.equal(copied.items[0].food.nutrients.protein.value, 10);
  assert.notEqual(copied.items[0].id, item.id);
  copied.items[0].food.name = 'Changed copy';
  assert.equal(item.food.name, 'Label food');
  assert.throws(() => copyMeal(originalMeal, '2026-02-30'));
});

test('daily actual and planned totals stay separate across dates and fortified sources', () => {
  const ordinary = food(); const fortified = { ...food('Fortified'), fortified: true };
  const actual = newPhysisRecord('meal', meal([snapshotItem('a', ordinary, 100, 'g'), snapshotItem('b', fortified, 50, 'g')]));
  const planned = newPhysisRecord('meal', meal([snapshotItem('a', ordinary, 200, 'g')], 'planned'));
  const other = newPhysisRecord('meal', { ...meal([snapshotItem('a', ordinary, 1000, 'g')]), date: '2026-10-25' });
  const summary = summaryForDay({ records: [actual, planned, other] }, '2026-10-24');
  assert.equal(summary.actual.energy.value, 180);
  assert.equal(summary.planned.energy.value, 240);
  assert.equal(summary.food.energy.value, 120);
  assert.equal(summary.fortified.energy.value, 60);
});

test('recipe yield changes concentration, not total nutrients, and missing composition propagates', () => {
  const lentils = { ...food('Lentils', { energy: 100, protein: 10, fiber: 5 }), contains: ['legume'], legumePreparation: 'adequately-cooked' };
  const oil = { ...food('Seed oil', { energy: 900, protein: 0, fat: 100 }), contains: ['seed-oil'], compositionKnown: false };
  const ingredients = [snapshotItem('lentils', lentils, 200, 'g'), snapshotItem('oil', oil, 10, 'g')];
  const recipe = recipeFood('Soup', ingredients, 500, 2);
  assert.equal(recipe.nutrients.energy.value, 58);
  assert.equal(recipe.nutrients.protein.value, 4);
  assert.equal(recipe.nutrients.fiber.value, null);
  assert.equal(recipe.servingAmount, 250);
  assert.equal(itemNutrients(snapshotItem('soup', recipe, 2, 'serving')).energy.value, 290);
  assert.deepEqual(recipe.contains, ['legume', 'seed-oil']);
  assert.equal(recipe.compositionKnown, false);
  assert.equal(recipe.legumePreparation, 'adequately-cooked');
  assert.equal(recipe.nutrients.energy.quality, 'estimate');
  assert.throws(() => recipeFood('Broken', ingredients, 0, 2));
});

test('personal food rules do not prevent facts, and legume cooking warnings are conditional', () => {
  const soy = { ...food('Soy'), contains: ['soy', 'legume'], legumePreparation: 'undercooked' };
  assert.ok(foodWarnings(soy).some(warning => warning.type === 'personal'));
  assert.ok(foodWarnings(soy).some(warning => warning.type === 'allergen'));
  assert.ok(foodWarnings(soy).some(warning => warning.type === 'preparation'));
  assert.ok(validateNutritionRecord(newPhysisRecord('meal', meal([snapshotItem('soy', soy, 100, 'g')]))));
  soy.legumePreparation = 'adequately-cooked';
  assert.equal(foodWarnings(soy).some(warning => warning.type === 'preparation'), false);
  assert.equal(foodWarnings(soy, []).some(warning => warning.type === 'personal'), false);
  const genericOil = { ...food('Vegetable oil'), compositionKnown: false };
  assert.equal(foodWarnings(genericOil).some(warning => warning.type === 'personal'), false);
  assert.ok(foodWarnings(genericOil).some(warning => warning.type === 'incomplete'));
});

test('energy percentages are not mass percentages and g/kg needs body mass', () => {
  const inputs = { mode: 'calories', unit: 'energy-percent', energy: 2000, protein: 30, fat: 30, carbohydrate: 40, weightKg: 80 };
  const result = resolveTargets(inputs);
  assert.equal(result.protein, 150);
  assert.ok(Math.abs(result.fat - 66.66666666666667) < 1e-6);
  assert.equal(result.carbohydrate, 200);
  assert.throws(() => resolveTargets({ ...inputs, carbohydrate: 30 }), /100%/);
  assert.throws(() => resolveTargets({ ...inputs, unit: 'g', protein: 30, fat: 30, carbohydrate: 30 }), /согласованы/);
  const byWeight = resolveTargets({ mode: 'macros', unit: 'g-per-kg', protein: 2, fat: 1, carbohydrate: 3, energy: 0, weightKg: 80 });
  assert.equal(byWeight.protein, 160);
  assert.equal(byWeight.energy, 2320);
  assert.throws(() => resolveTargets({ ...inputs, unit: 'g-per-kg', weightKg: null }), /массу/);
});

test('food label energy is preserved even when 4/9/4 differs', () => {
  const label = food('High fiber label', { energy: 100, protein: 10, fat: 0, carbohydrate: 30, fiber: 20 });
  assert.equal(energyDifference(label), -60);
  assert.equal(itemNutrients(snapshotItem('label', label, 200, 'g')).energy.value, 200);
  assert.equal(label.nutrients.energy.value, 100);
});

test('Mifflin estimate has version/source, does not add activity calories twice and rejects exclusions', () => {
  const input = { age: 30, heightCm: 180, weightKg: 80, formulaSex: 'male', activityFactor: 1.5, excluded: false };
  const result = estimateEnergy(input);
  assert.equal(result.resting, 1780);
  assert.equal(result.maintenance, 2670);
  assert.match(result.source, /10.1093/);
  assert.match(result.version, /1990/);
  assert.throws(() => estimateEnergy({ ...input, age: 17 }));
  assert.throws(() => estimateEnergy({ ...input, excluded: true }));
  assert.throws(() => estimateEnergy({ ...input, activityFactor: 0 }));
});

test('USDA starter IDs, version, real composition and estimated zeros retain provenance', () => {
  const raw = JSON.parse(readFileSync(new URL('../app/physis/nutrition-seed.json', import.meta.url), 'utf8').replace(/^\uFEFF/, ''));
  assert.equal(raw.length, 43);
  assert.equal(new Set(raw.map(entry => entry.fdcId)).size, raw.length);
  for (const id of [171688, 171077, 169705, 172421]) assert.ok(raw.some(entry => entry.fdcId === id));
  for (const entry of raw) {
    const imported = importUsdaFood(entry);
    assert.equal(imported.provenance.provider, 'USDA');
    assert.match(imported.provenance.license, /CC0/);
    assert.equal(imported.provenance.id, String(entry.fdcId));
    assert.ok(validateNutritionRecord(newPhysisRecord('food', imported)));
  }
  const apple = importUsdaFood(raw.find(entry => entry.fdcId === 171688));
  assert.equal(apple.nutrients.energy.value, 52);
  assert.equal(apple.nutrients.protein.value, .26);
  assert.equal(apple.nutrients.transFat.value, 0);
  assert.equal(apple.nutrients.transFat.quality, 'estimate');
  assert.equal(apple.compositionKnown, false);
  assert.throws(() => importUsdaFood({ description: 'No ID', foodNutrients: [] }));
  const unsupported = importUsdaFood({ fdcId: 1, description: 'Wrong unit', foodNutrients: [{ nutrient: { id: 1090, unitName: 'IU' }, amount: 5 }] });
  assert.equal(unsupported.nutrients.magnesium, undefined);
});

test('portion suggestions honor a limit and never invent unknown nutrients', () => {
  const known = food();
  assert.deepEqual(suggestPortion(known, 'protein', 20), { quantity: 200, unit: 'g', fulfills: true });
  assert.deepEqual(suggestPortion(known, 'protein', 200), { quantity: 1000, unit: 'g', fulfills: false });
  assert.equal(suggestPortion(known, 'magnesium', 20), null);
  assert.equal(suggestPortion(known, 'protein', 0), null);
});

test('decode/import validation rejects malformed quantities, hidden unit mismatch and forged recipe results', () => {
  const valid = newPhysisRecord('food', food());
  assert.ok(validateNutritionRecord(valid));
  const mismatch = structuredClone(valid); mismatch.data.nutrients.protein.unit = 'IU';
  assert.equal(validateNutritionRecord(mismatch), false);
  const zero = structuredClone(valid); zero.data.nutrients.protein.quality = 'zero';
  assert.equal(validateNutritionRecord(zero), false);
  const badDate = newPhysisRecord('meal', { ...meal([snapshotItem('a', food(), 100, 'g')]), date: '2026-02-30' });
  assert.equal(validateNutritionRecord(badDate), false);
  const items = [snapshotItem('a', food(), 100, 'g')];
  const recipe = newPhysisRecord('recipe', { name: 'Meal', ingredients: items, yieldGrams: 200, servings: 2, note: '', food: recipeFood('Meal', items, 200, 2) });
  assert.ok(validateNutritionRecord(recipe));
  recipe.data.food.nutrients.protein.value = 400;
  assert.equal(validateNutritionRecord(recipe), false);
  const liquid = newPhysisRecord('meal', meal([{ ...snapshotItem('a', food(), 100, 'g'), unit: 'ml' }]));
  assert.equal(validateNutritionRecord(liquid), false);
});

test('magnesium supplemental UL excludes food and enforces age, units and incomplete sources', () => {
  const reference = NUTRIENT_REFERENCES[0];
  const person = { age: 30, sex: 'female', state: 'general' };
  const sources = { food: 1000, supplement: 300, medicine: 25, unit: 'mg' };
  const comparison = compareNutrientReference(reference, person, sources);
  assert.equal(comparison.value, 325);
  assert.equal(comparison.aboveUpperLimit, false);
  assert.equal(compareNutrientReference(reference, person, { ...sources, medicine: 100 }).aboveUpperLimit, true);
  assert.equal(compareNutrientReference(reference, { ...person, age: 17 }, sources), null);
  assert.equal(compareNutrientReference(reference, { ...person, age: null }, sources), null);
  assert.equal(compareNutrientReference(reference, person, { ...sources, unit: 'mcg' }), null);
  assert.equal(compareNutrientReference(reference, person, { ...sources, supplement: null }), null);
  assert.equal(compareNutrientReference(reference, person, { ...sources, food: null }).value, 325);
});

test('structured JSON round trip preserves snapshots and unknown values', () => {
  const record = newPhysisRecord('meal', meal([snapshotItem('a', food('Unknown iron', { energy: 100, iron: null }), 125, 'g')]));
  const restored = JSON.parse(JSON.stringify(record));
  assert.ok(validateNutritionRecord(restored));
  assert.deepEqual(restored, record);
  assert.equal(restored.data.items[0].food.nutrients.iron.value, null);
});


test('starting nutrition targets apply editable goal adjustments and consistent macros within adult formula limits', () => {
  const p={age:30,heightCm:175,weightKg:80,activityFactor:1.4,formulaSex:'male',goal:'maintain',excluded:false};
  const maintained=startingNutritionTargets(p), lost=startingNutritionTargets({...p,goal:'lose'}), gained=startingNutritionTargets({...p,goal:'gain'});
  assert.equal(lost.adjustment,.9);assert.equal(gained.adjustment,1.1);
  assert.ok(Math.abs(lost.target.energy/maintained.target.energy-.9)<.001);
  assert.ok(Math.abs(gained.target.energy/maintained.target.energy-1.1)<.001);
  const target=maintained.target;
  assert.ok(Math.abs(target.protein*4+target.fat*9+target.carbohydrate*4-target.energy)<1e-6);
  assert.equal(target.fiber,14*target.energy/1000);
  assert.throws(()=>startingNutritionTargets({...p,age:17}));
  assert.throws(()=>startingNutritionTargets({...p,excluded:true}));
  assert.throws(()=>startingNutritionTargets({...p,goal:'custom'}));
  assert.throws(()=>startingNutritionTargets({...p,weightKg:30,heightCm:120,age:80,activityFactor:1,goal:'lose'}));
});


test('reference foods use sourced labels while retaining unknown nutrients and ordinary categories', () => {
  const { FOOD_REFERENCES, manualReferenceFoods, isTopFood } = calendarModule('app/physis/food-reference-domain.ts');
  assert.equal(FOOD_REFERENCES.length, 48);
  const manual = manualReferenceFoods('ru');
  assert.equal(manual.length, 9);
  for (const { food: item } of manual) {
    assert.ok(validateNutritionRecord(newPhysisRecord('food', item)));
    assert.ok(isTopFood(item));
    assert.notEqual(item.category, 'ТОП СУПЕРФУДОВ');
    assert.equal(item.compositionKnown, false);
    assert.equal(item.provenance.provider, 'label');
    assert.ok(item.nutrients.energy.value > 0);
    assert.ok(item.nutrients.protein.value >= 0);
    assert.ok(Object.values(item.nutrients).some(n => n.value === null && n.quality === 'unknown'));
    assert.ok(Object.values(item.nutrients).every(n => n.basis === '100g' && n.source === item.provenance.source));
  }
  const label = { ...food(), collections: ['superfoods'], category: 'Фрукты' };
  assert.ok(validateNutritionRecord(newPhysisRecord('food', label)));
  assert.equal(isTopFood(label), true);
  for (const collections of [null, 'superfoods', [5], Array(21).fill('x')]) {
    assert.equal(validateNutritionRecord(newPhysisRecord('food', { ...label, collections })), false);
  }
});

// Nutrition periods follow the display calendar, including its actual month boundaries.
test('nutrition plan uses a seven-day Gregorian interval and an exact five-day sacred pyata', () => {
  const { nutritionPeriodRange } = calendarModule('app/physis/nutrition-periods.ts');
  const { sacredToCivilDate } = calendarModule('app/calendar-astronomy.ts');
  const context = { version: 2, timeZone: 'Europe/Moscow', gregorianYearStart: 'january' };
  assert.deepEqual(nutritionPeriodRange('2026-10-25', 'profane', 'week', context), { start: '2026-10-25', end: '2026-10-31' });
  const sacredDay = day => sacredToCivilDate(2026, 7, day, context);
  assert.deepEqual(nutritionPeriodRange(sacredDay(14), 'sacred', 'week', context), { start: sacredDay(11), end: sacredDay(15) });
  assert.deepEqual(nutritionPeriodRange(sacredDay(30), 'sacred', 'week', context), { start: sacredDay(26), end: sacredDay(30) });
  assert.deepEqual(nutritionPeriodRange(sacredDay(14), 'sacred', 'month', context), { start: sacredDay(1), end: sacredDay(30) });
});

test('vitamin food quantities preserve source units, preparation and edible portion without inventing missing values', () => {
  const profiles = JSON.parse(readFileSync(new URL('../app/physis/vitamin-food-sources.json', import.meta.url), 'utf8'));
  const foods = JSON.parse(readFileSync(new URL('../app/physis/nutrition-seed.json', import.meta.url), 'utf8'));
  const essential = ['vitamin-a', 'vitamin-c', 'vitamin-d', 'vitamin-e', 'vitamin-k', 'thiamin', 'riboflavin', 'niacin', 'pantothenate', 'vitamin-b6', 'biotin', 'folate', 'vitamin-b12'];
  for (const id of essential) {
    assert.ok(profiles[id].items.length >= 3);
    for (const item of profiles[id].items) {
      assert.ok(Number.isFinite(item.amount) && item.amount >= 0);
      assert.ok(item.food.every(Boolean) && item.portion.every(Boolean));
      assert.equal(new URL(item.source).protocol, 'https:');
      if (item.fdcId) {
        const source = foods.find(food => food.fdcId === item.fdcId).foodNutrients.find(n => n.nutrient.id === item.nutrientId);
        assert.equal(item.amount, source.amount);
        assert.equal(item.unit.replace(' RAE', ''), source.nutrient.unitName);
        assert.equal(item.portion[1], '100 g edible portion');
      }
    }
  }
  assert.equal(profiles.biotin.items[0].amount, 30.8);
  assert.match(profiles.biotin.items[0].portion[1], /85 g/);
  assert.ok(profiles['vitamin-k'].items.some(item => item.food[1].startsWith('K1:')));
  assert.ok(profiles['vitamin-k'].items.some(item => item.food[1].startsWith('K2 / MK-4:')));
  const { matchingNutrientTerms } = calendarModule('app/physis/nutrient-terminology.ts');
  assert.equal(matchingNutrientTerms('В15')[0].id, 'pangamic-acid');
  assert.equal(matchingNutrientTerms('B10')[0].id, 'paba');
});

test('mineral food quantities retain USDA preparation, NIH portions, fluoride ranges and calculated chloride provenance', () => {
  const profiles = JSON.parse(readFileSync(new URL('../app/physis/mineral-food-sources.json', import.meta.url), 'utf8'));
  const foods = JSON.parse(readFileSync(new URL('../app/physis/nutrition-seed.json', import.meta.url), 'utf8'));
  assert.equal(Object.keys(profiles).length, 15);
  assert.equal(Object.values(profiles).flatMap(profile => profile.items).length, 80);
  for (const profile of Object.values(profiles)) for (const item of profile.items) {
    assert.ok(Number.isFinite(item.amount) && item.amount >= 0);
    assert.ok(item.food.every(Boolean) && item.portion.every(Boolean));
    assert.equal(new URL(item.source).protocol, 'https:');
    if (item.fdcId) {
      const source = foods.find(food => food.fdcId === item.fdcId).foodNutrients.find(n => n.nutrient.id === item.nutrientId);
      assert.equal(item.amount, source.amount);
      assert.equal(item.unit, source.nutrient.unitName);
      assert.equal(item.portion[1], '100 g edible portion');
    }
    if (item.amountMax !== undefined) assert.ok(item.amountMax >= item.amount);
  }
  assert.equal(profiles.fluoride.items[0].amount, 0.07);
  assert.equal(profiles.fluoride.items[0].amountMax, 1.5);
  assert.equal(profiles.molybdenum.items[0].amount, 288);
  assert.match(profiles.molybdenum.items[0].portion[1], /½ cup/);
  assert.equal(profiles.iodine.items[0].amount, 146);
  assert.equal(profiles.chromium.items[0].amount, 3.3);
  assert.equal(profiles.chloride.items.length, 1);
  assert.equal(profiles.chloride.items[0].approximate, true);
  assert.equal(profiles.chloride.items[0].amount, 600);
  assert.equal(profiles.sodium.items[0].amount, 400);
});

test('lunar nutrition decades and months use real 29/30-day lunar boundaries', () => {
  const { nutritionPeriodRange } = calendarModule('app/physis/nutrition-periods.ts');
  const { lunarMonthStartDate, firstLunarMonthAfterSpringEquinox } = calendarModule('app/calendar-astronomy.ts');
  const { addCivilDays, civilDayNumber } = calendarModule('app/calendar-context.ts');
  const context = { version: 2, timeZone: 'Europe/Moscow', gregorianYearStart: 'january' };
  const lengths = new Set();
  const first = firstLunarMonthAfterSpringEquinox(2026);
  for (let index = first; index < first + 13; index++) {
    const start = lunarMonthStartDate(index, context), next = lunarMonthStartDate(index + 1, context);
    const length = civilDayNumber(next) - civilDayNumber(start); lengths.add(length);
    assert.deepEqual(nutritionPeriodRange(addCivilDays(start, 14), 'lunar', 'week', context), { start: addCivilDays(start, 10), end: addCivilDays(start, 19) });
    assert.deepEqual(nutritionPeriodRange(addCivilDays(next, -1), 'lunar', 'week', context), { start: addCivilDays(start, 20), end: addCivilDays(next, -1) });
    assert.deepEqual(nutritionPeriodRange(addCivilDays(start, 14), 'lunar', 'month', context), { start, end: addCivilDays(next, -1) });
  }
  assert.deepEqual([...lengths].sort(), [29, 30]);
});

test('apricot kernel label keeps safety text and does not invent a health benefit', () => {
  const { FOOD_REFERENCES, manualReferenceFoods } = calendarModule('app/physis/food-reference-domain.ts');
  const entry = FOOD_REFERENCES.find(item => item.id === 'apricot-kernels');
  assert.equal(entry.top, true);
  assert.match(entry.health[0], /цианид/);
  assert.match(entry.limits[0], /интоксикация/);
  const item = manualReferenceFoods('ru').find(item => item.food.provenance.id === 'reference:apricot-kernels');
  assert.equal(item.food.compositionKnown, false);
  assert.equal(item.food.nutrients.energy.value, 612);
  assert.equal(item.food.nutrients.protein.value, 25);
  assert.equal(item.food.nutrients.vitaminB12.value, null);
  assert.ok(validateNutritionRecord(newPhysisRecord('food', item.food)));
});

test('TOP food labels normalize serving grams once and never copy absent nutrients as zero', () => {
  const { FOOD_REFERENCES, manualReferenceFoods } = calendarModule('app/physis/food-reference-domain.ts');
  assert.equal(new Set(FOOD_REFERENCES.map(entry=>entry.id)).size,48);
  const records=manualReferenceFoods('ru');
  assert.equal(new Set(records.map(item=>item.id)).size,9);
  const find=id=>records.find(item=>item.food.provenance.id===`reference:${id}`).food;
  assert.equal(find('brewers-yeast').nutrients.energy.value,375);
  assert.equal(find('brewers-yeast').nutrients.protein.value,43.75);
  assert.equal(find('brewers-yeast').nutrients.folate.value,null);
  assert.equal(find('psyllium-food').nutrients.fiber.value,70);
  assert.equal(find('psyllium-food').nutrients.protein.quality,'zero');
  assert.equal(find('uryuk').nutrients.fat.value,null);
  assert.equal(find('cod-liver').nutrients.vitaminD.value,null);
  for(const {food:item} of records){
    assert.ok(item.provenance.source.startsWith('https://'));
    assert.ok(item.brand);
    assert.ok(item.nutrients.energy.value>0);
  }
});
