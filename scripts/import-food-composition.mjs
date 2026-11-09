// Run with an official downloaded USDA SR Legacy JSON, then review every explicit mapping.
// node scripts/import-food-composition.mjs path/to/FoodData_Central_sr_legacy_food_json_2018-04.json
import {readFileSync,writeFileSync} from 'node:fs';
import {NUTRIENTS} from '../app/physis/nutrition-domain.ts';
const source=JSON.parse(readFileSync(process.argv[2],'utf8'));
const foods=new Map(source.SRLegacyFoods.map(food=>[String(food.fdcId),food]));
const mappings=readFileSync(new URL('./food-composition-usda-map.tsv',import.meta.url),'utf8').trim().split(/\r?\n/).filter(line=>!line.startsWith('#')).map(line=>line.split('\t'));
const result={};
for(const [id,fdcId,state,descriptionRu] of mappings){
  if(result[id])throw Error('Duplicate catalog ID: '+id);
  const food=foods.get(fdcId);if(!food)throw Error('Missing FDC ID: '+fdcId);
  const values={},estimated=[];
  for(const [key,meta] of Object.entries(NUTRIENTS)){
    const row=food.foodNutrients.find(row=>row.nutrient.id===meta.usda);
    if(!row || typeof row.amount!=='number')continue;
    if(row.nutrient.unitName.toLowerCase().replace(/[µμ]g/g,'mcg')!==meta.unit)throw Error('Unexpected unit: '+id+' '+key);
    values[key]=row.amount;
    if(/calculated|imputed|assumed|estimated/i.test(row.foodNutrientDerivation?.description??''))estimated.push(key);
  }
  result[id]={state,basis:'100g',densityGPerMl:null,descriptionRu,descriptionEn:food.description,source:`https://fdc.nal.usda.gov/food-details/${fdcId}/nutrients`,
    version:`USDA SR Legacy 2018 / ${food.publicationDate}; checked 2026-11-02`,license:'CC0 — USDA FoodData Central',provider:'USDA',values,estimated,trace:[]};
}
const extra=new URL('./food-composition-additional.json',import.meta.url);
Object.assign(result,JSON.parse(readFileSync(extra,'utf8')));
writeFileSync(new URL('../app/physis/food-composition-data.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(Object.keys(result).length+' food compositions; '+Object.values(result).reduce((n,x)=>n+Object.keys(x.values).length,0)+' sourced values.');
